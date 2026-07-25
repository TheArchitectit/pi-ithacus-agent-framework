/**
 * dwf.ts — dynamic workflow engine (feat 4.9).
 *
 * pi-agnostic: src/ NEVER evals untrusted script strings and NEVER imports
 * isolated-vm (PREVENT-ITH-004 — no network/process; isolated-vm is an
 * extension-layer concern). Workflows are provided as function-based
 * DwfWorkflow definitions; extensions/ loads .dwf.ts files (via dynamic
 * import) and passes the run() fn to this engine.
 *
 * The agent/fanOut dispatchers are injectable (DI) so the engine is fully
 * unit-testable with mocks; extensions/ wires real sub-agent teams.
 * Budget (maxAgents/maxFanOut/tokenBudget) and deadline are enforced.
 */

import type {
  DwfBudget, DwfContext, DwfWorkflow, DwfRunResult, DwfAgentResult, DwfTrustLevel,
} from './types-sprint-4.5.js';

/** Injectable agent dispatcher (mock in tests, real sub-agent team in extensions). */
export interface DwfDispatcher {
  /** Spawn one agent for a role + goal. */
  spawnAgent(role: string, goal: string): Promise<DwfAgentResult>;
  /** Wall-clock now (ms). */
  now(): number;
}

/** Options for running a workflow. */
export interface RunDwfOpts<T> {
  workflow: DwfWorkflow<T>;
  dispatcher: DwfDispatcher;
  /** run id (generated if omitted). */
  runId?: string;
  /** log sink (default: console.log). */
  log?: (message: string, level: 'info' | 'warn' | 'error') => void;
}

let runCounter = 0;

/** Run a dynamic workflow with budget + deadline enforcement. */
export async function runDwf<T>(opts: RunDwfOpts<T>): Promise<DwfRunResult<T>> {
  const wf = opts.workflow;
  const runId = opts.runId ?? `dwf-${Date.now()}-${++runCounter}`;
  const start = opts.dispatcher.now();
  const log = opts.log ?? ((msg, level) => { if (level === 'error') console.error(`[dwf:${runId}] ${msg}`); });

  // Refuse untrusted workflows (extensions/ must set trust='trusted' or 'under-review').
  if (wf.trust === 'untrusted') {
    return { runId, name: wf.name, status: 'failed', error: 'untrusted workflow refused (no isolated-vm in src/)', tokensUsed: 0, agentsSpawned: 0, durationMs: 0 };
  }

  let tokensUsed = 0;
  let agentsSpawned = 0;

  const checkBudget = (): DwfRunResult<T> | null => {
    if (tokensUsed > wf.budget.tokenBudget) {
      return { runId, name: wf.name, status: 'budget-exceeded', tokensUsed, agentsSpawned, durationMs: opts.dispatcher.now() - start };
    }
    if (opts.dispatcher.now() > wf.budget.deadlineMs) {
      return { runId, name: wf.name, status: 'deadline-exceeded', tokensUsed, agentsSpawned, durationMs: opts.dispatcher.now() - start };
    }
    return null;
  };

  const ctx: DwfContext = {
    runId,
    budget: { ...wf.budget, tokensUsed, agentsSpawned },
    log: (message, level) => log(message, level ?? 'info'),
    agent: async (role, goal) => {
      if (agentsSpawned >= wf.budget.maxAgents) {
        throw new Error(`maxAgents exceeded (${wf.budget.maxAgents})`);
      }
      const r = await opts.dispatcher.spawnAgent(role, goal);
      agentsSpawned++;
      tokensUsed += r.tokensUsed;
      ctx.budget.tokensUsed = tokensUsed;
      ctx.budget.agentsSpawned = agentsSpawned;
      const breach = checkBudget();
      if (breach) throw new Error(`workflow ${breach.status}`);
      return r;
    },
    fanOut: async (role, goals) => {
      if (goals.length > wf.budget.maxFanOut) {
        throw new Error(`maxFanOut exceeded (${wf.budget.maxFanOut} < ${goals.length})`);
      }
      const results: DwfAgentResult[] = [];
      // parallel dispatch (all in flight together)
      const settled = await Promise.all(goals.map(g => opts.dispatcher.spawnAgent(role, g)));
      for (const r of settled) {
        results.push(r);
        agentsSpawned++;
        tokensUsed += r.tokensUsed;
      }
      ctx.budget.tokensUsed = tokensUsed;
      ctx.budget.agentsSpawned = agentsSpawned;
      const breach = checkBudget();
      if (breach) throw new Error(`workflow ${breach.status}`);
      return { taskId: `fanout-${agentsSpawned}`, results, totalTokens: settled.reduce((s, r) => s + r.tokensUsed, 0) };
    },
  };

  try {
    const result = await wf.run(ctx);
    const breach = checkBudget();
    if (breach) return breach;
    return { runId, name: wf.name, status: 'ok', result, tokensUsed, agentsSpawned, durationMs: opts.dispatcher.now() - start };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status: DwfRunResult['status'] = msg.includes('budget-exceeded') ? 'budget-exceeded'
      : msg.includes('deadline-exceeded') ? 'deadline-exceeded'
      : 'failed';
    return { runId, name: wf.name, status, error: msg, tokensUsed, agentsSpawned, durationMs: opts.dispatcher.now() - start };
  }
}

/** Build a DwfWorkflow (helper for tests/extensions). */
export function defineWorkflow<T>(name: string, trust: DwfTrustLevel, budget: DwfBudget, run: DwfWorkflow<T>['run']): DwfWorkflow<T> {
  return { name, trust, budget, run };
}
