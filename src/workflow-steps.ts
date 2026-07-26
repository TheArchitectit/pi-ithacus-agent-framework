/**
 * workflow-steps.ts — DAG step executor with retry/timeout/on_error + rich step types (feat 4.13, 4.14).
 *
 * pi-agnostic: zero-network (PREVENT-ITH-004). The actual work of a step is
 * delegated to an injectable StepExecutor (mock in tests, real subagent in
 * extensions/). Timeout via Promise.race. Rich step types: CONDITION
 * (evaluate expression), LOOP (repeat substeps), PARALLEL (run substeps
 * concurrently), HUMAN_REVIEW (await injectable Reviewer), SUBWORKFLOW
 * (execute substeps sequentially).
 */

import type { WorkflowStep, WorkflowTemplate, StepResult, WorkflowResult, RetryPredicate } from './types-sprint-5.2.js';

/** Injectable step executor (mock in tests; real subagent dispatch in extensions). */
export interface StepExecutor {
  /** Execute a task/tool_call step's goal. Returns output. */
  execute(step: WorkflowStep, vars: Record<string, unknown>): Promise<unknown>;
  /** Wall clock now (ms). */
  now(): number;
  /** Optional: return false to stop retrying early (e.g. permanent error). If undefined, all attempts are used. */
  isRetryable?: RetryPredicate;
}

/** Injectable human-review callback (HUMAN_REVIEW steps). */
export type HumanReviewer = (step: WorkflowStep, vars: Record<string, unknown>) => Promise<{ approve: boolean; comment?: string }>;

/** Options for running a workflow template. */
export interface RunWorkflowOpts {
  template: WorkflowTemplate;
  executor: StepExecutor;
  /** reviewer for HUMAN_REVIEW steps (throws if a human_review step has no reviewer). */
  reviewer?: HumanReviewer;
  /** initial variable values (merged over template.variables). */
  variables?: Record<string, unknown>;
  /** stop on first failure (default true). */
  stopOnError?: boolean;
}

/** Evaluate a simple condition expression against vars. Supports: var === 'literal', var !== 'literal', var, !var, var > N, var < N. */
export function evalCondition(expr: string, vars: Record<string, unknown>): boolean {
  const e = expr.trim();
  if (!e) return true;
  const eq = e.match(/^(\w+)\s*===?\s*(.+)$/);
  if (eq) { const v = vars[eq[1]]; const lit = parseLit(eq[2]); return v === lit; }
  const ne = e.match(/^(\w+)\s*!==?\s*(.+)$/);
  if (ne) { const v = vars[ne[1]]; const lit = parseLit(ne[2]); return v !== lit; }
  const gt = e.match(/^(\w+)\s*>\s*(\d+)$/);
  if (gt) { const v = Number(vars[gt[1]]); return v > Number(gt[2]); }
  const lt = e.match(/^(\w+)\s*<\s*(\d+)$/);
  if (lt) { const v = Number(vars[lt[1]]); return v < Number(lt[2]); }
  const not = e.match(/^!\s*(\w+)$/);
  if (not) { const v = vars[not[1]]; return !v; }
  const bare = e.match(/^(\w+)$/);
  if (bare) return !!vars[bare[1]];
  throw new Error('unrecognized condition: ' + e);
}

function parseLit(s: string): unknown {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^['"].*['"]$/.test(t)) return t.slice(1, -1);
  return t;
}

/** Run a single step with retry/timeout. Returns StepResult (never throws — captures errors). */
export async function runStep(step: WorkflowStep, vars: Record<string, unknown>, executor: StepExecutor, reviewer?: HumanReviewer): Promise<StepResult> {
  const start = executor.now();
  let attempts = 0;
  const maxAttempts = (step.retryCount ?? 0) + 1;
  if (step.type === 'condition') {
    try {
      const ok = evalCondition(step.condition ?? '', vars);
      return { stepId: step.id, status: ok ? 'completed' : 'skipped', output: ok, attempts: 1, durationMs: executor.now() - start };
    } catch (e) {
      return { stepId: step.id, status: 'failed', error: errMsg(e), attempts: 1, durationMs: executor.now() - start };
    }
  }
  if (step.type === 'human_review') {
    if (!reviewer) return { stepId: step.id, status: 'failed', error: 'no reviewer provided for human_review step', attempts: 1, durationMs: 0 };
    try {
      const r = await reviewer(step, vars);
      if (r.approve) return { stepId: step.id, status: 'completed', output: r.comment, attempts: 1, durationMs: executor.now() - start };
      return { stepId: step.id, status: 'failed', error: 'human review rejected' + (r.comment ? ': ' + r.comment : ''), output: r.comment, attempts: 1, durationMs: executor.now() - start };
    } catch (e) {
      return { stepId: step.id, status: 'failed', error: errMsg(e), attempts: 1, durationMs: executor.now() - start };
    }
  }
  if (step.type === 'parallel') {
    const subs = step.substeps ?? [];
    const subresults = await Promise.all(subs.map(s => runStep(s, vars, executor, reviewer)));
    return { stepId: step.id, status: subresults.every(r => r.status === 'completed') ? 'completed' : 'partial', output: subresults.map(r => r.output), attempts: 1, durationMs: executor.now() - start, subresults };
  }
  if (step.type === 'loop') {
    const count = step.loopCount ?? 0;
    if (count === 0) return { stepId: step.id, status: 'skipped', output: [], attempts: 1, durationMs: executor.now() - start, subresults: [] };
    const subresults: StepResult[] = [];
    for (let i = 0; i < count; i++) {
      const loopVars = { ...vars, loopIndex: i };
      for (const s of step.substeps ?? []) { subresults.push(await runStep(s, loopVars, executor, reviewer)); }
    }
    return { stepId: step.id, status: subresults.every(r => r.status === 'completed') ? 'completed' : 'partial', output: subresults.map(r => r.output), attempts: 1, durationMs: executor.now() - start, subresults };
  }
  if (step.type === 'subworkflow') {
    const subresults: StepResult[] = [];
    for (const s of step.substeps ?? []) { subresults.push(await runStep(s, vars, executor, reviewer)); }
    return { stepId: step.id, status: subresults.every(r => r.status === 'completed') ? 'completed' : 'partial', output: subresults.map(r => r.output), attempts: 1, durationMs: executor.now() - start, subresults };
  }
  let lastErr: string | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let p = executor.execute(step, vars);
      if (step.timeoutMs && step.timeoutMs > 0) {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), step.timeoutMs); });
        p = Promise.race([p, timeout]);
      }
      const output = await p;
      if (timer) clearTimeout(timer);
      return { stepId: step.id, status: 'completed', output, attempts, durationMs: executor.now() - start };
    } catch (e) {
      if (timer) clearTimeout(timer);
      lastErr = errMsg(e);
      if (typeof executor.isRetryable === 'function' && !executor.isRetryable(lastErr)) break;
    }
  }
  return { stepId: step.id, status: lastErr === 'timeout' ? 'timeout' : 'failed', error: lastErr, attempts, durationMs: executor.now() - start };
}

/** Topologically sort steps by dependsOn (DFS). Returns ordered ids, or a cycle path if cyclic. */
export function topoSort(steps: WorkflowStep[]): { order: string[]; cycle?: string[] } {
  const byId = new Map<string, WorkflowStep>();
  for (const s of steps) byId.set(s.id, s);
  const order: string[] = [];
  const state = new Map<string, 0 | 1>();
  const visit = (id: string, path: string[]): string[] | null => {
    const st = state.get(id);
    if (st === 1) return null;
    if (st === 0) return path.slice(path.indexOf(id)).concat(id);
    state.set(id, 0);
    path.push(id);
    const step = byId.get(id);
    if (step?.dependsOn) {
      for (const d of step.dependsOn) {
        if (!byId.has(d)) continue;
        const c = visit(d, path);
        if (c) return c;
      }
    }
    path.pop();
    state.set(id, 1);
    order.push(id);
    return null;
  };
  for (const s of steps) {
    const c = visit(s.id, []);
    if (c) return { order: [], cycle: c };
  }
  return { order };
}

/**
 * Run a workflow template in topological (dependsOn) order.
 * onError = cleanup/recovery step run on failure (once; tracked via executedIds).
 * stopOnError:true → handler runs, then workflow ends 'failed'.
 * stopOnError:false → handler runs, execution continues to remaining steps.
 * Executor promises are NOT cancellable (no AbortSignal in this sprint — deferred to extensions/).
 */
export async function runWorkflow(opts: RunWorkflowOpts): Promise<WorkflowResult> {
  const vars = { ...(opts.template.variables ?? {}), ...(opts.variables ?? {}) };
  const start = opts.executor.now();
  const results: StepResult[] = [];
  const errors: string[] = [];
  const stopOnError = opts.stopOnError ?? true;
  const executedIds = new Set<string>();
  let finalOutput: unknown;
  let status: WorkflowResult['status'] = 'completed';
  const topo = topoSort(opts.template.steps);
  if (topo.cycle) {
    errors.push(`cycle detected: ${topo.cycle.join(' -> ')}`);
    return { templateName: opts.template.name, status: 'failed', results, totalDurationMs: opts.executor.now() - start, finalOutput, errors, variables: vars };
  }
  const byId = new Map<string, WorkflowStep>();
  for (const s of opts.template.steps) byId.set(s.id, s);
  for (const id of topo.order) {
    if (executedIds.has(id)) continue;
    const step = byId.get(id);
    if (!step) continue;
    const r = await runStep(step, vars, opts.executor, opts.reviewer);
    executedIds.add(id);
    results.push(r);
    if (r.status === 'completed' && (step.type === 'task' || step.type === 'tool_call')) finalOutput = r.output;
    if (r.status === 'failed' || r.status === 'timeout') {
      errors.push(`${step.id}: ${r.error ?? 'failed'}`);
      if (step.onError) {
        const handler = byId.get(step.onError);
        if (handler && !executedIds.has(handler.id)) {
          const hr = await runStep(handler, vars, opts.executor, opts.reviewer);
          executedIds.add(handler.id);
          results.push(hr);
        }
      }
      if (stopOnError) { status = 'failed'; break; }
      status = 'partial';
    }
  }
  return { templateName: opts.template.name, status, results, totalDurationMs: opts.executor.now() - start, finalOutput, errors, variables: vars };
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
