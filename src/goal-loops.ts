/**
 * goal-loops.ts — autonomous multi-turn goal loops with an LLM judge.
 *
 * pi-agnostic: src/ never calls a real LLM and never opens a network channel
 * (PREVENT-ITH-004). The LLM actor + judge are injected (DI) so the loop is
 * fully unit-testable with mocks; the extension layer wires real models.
 */

import type { GoalLoop, GoalIteration, GoalStep } from './types-sprint-4.4.js';

/** Injectable LLM actor (proposes the next action given goal + history). */
export interface LlmActor {
  /** Propose an action for the current turn. */
  propose(ctx: { goal: string; history: GoalIteration[]; turn: number }): Promise<string>;
}

/** Injectable LLM judge (decides whether the goal is met or the loop should continue/stop). */
export interface LlmJudge {
  /** Evaluate the current state against the goal. */
  judge(ctx: { goal: string; action: string; history: GoalIteration[]; turn: number }): Promise<{ verdict: GoalIteration['verdict']; reasoning: string; score: number }>;
}

/** Options for creating a goal loop. */
export interface GoalLoopOpts {
  goal: string;
  maxIterations: number;
  actor: LlmActor;
  judge: LlmJudge;
  /** min judge score to declare complete (default 0.8). */
  completeThreshold?: number;
  /** called each iteration with the iteration result. */
  onIteration?: (it: GoalIteration) => void;
  /** executor: run the proposed action (default: no-op, returns action). */
  execute?: (action: string) => Promise<string>;
}

let loopCounter = 0;

/** Create a new goal loop (not yet running). */
export function createGoalLoop(goal: string, maxIterations: number): GoalLoop {
  return {
    id: `goal-${Date.now()}-${++loopCounter}`,
    goal,
    maxIterations,
    iterations: [],
    steps: [],
    status: 'running',
    createdAt: Date.now(),
  };
}

/** Run a goal loop until the judge says complete or max iterations reached. */
export async function runGoalLoop(opts: GoalLoopOpts): Promise<GoalLoop> {
  const threshold = opts.completeThreshold ?? 0.8;
  const loop = createGoalLoop(opts.goal, opts.maxIterations);
  for (let turn = 1; turn <= opts.maxIterations; turn++) {
    if (loop.status !== 'running') break;
    const action = await opts.actor.propose({ goal: opts.goal, history: loop.iterations, turn });
    const execResult = opts.execute ? await opts.execute(action) : action;
    const judgeResult = await opts.judge.judge({ goal: opts.goal, action: execResult, history: loop.iterations, turn });
    const iteration: GoalIteration = {
      turn,
      action: execResult,
      verdict: judgeResult.verdict,
      reasoning: judgeResult.reasoning,
      score: judgeResult.score,
    };
    loop.iterations.push(iteration);
    opts.onIteration?.(iteration);
    if (judgeResult.verdict === 'complete' || judgeResult.score >= threshold) {
      loop.status = 'complete';
      break;
    }
    if (judgeResult.verdict === 'failed') {
      loop.status = 'failed';
      break;
    }
  }
  if (loop.status === 'running') {
    loop.status = 'failed';  // ran out of iterations
  }
  return loop;
}

/** Add a step to a loop (manual planning). */
export function addStep(loop: GoalLoop, description: string): GoalStep {
  const step: GoalStep = { id: `step-${loop.steps.length + 1}`, description, status: 'pending', ts: Date.now() };
  loop.steps.push(step);
  return step;
}

/** Update a step's status. */
export function updateStep(loop: GoalLoop, stepId: string, status: GoalStep['status'], result?: string): boolean {
  const step = loop.steps.find(s => s.id === stepId);
  if (!step) return false;
  step.status = status;
  if (result !== undefined) step.result = result;
  return true;
}

/** Stop a running loop. */
export function stopGoalLoop(loop: GoalLoop): void {
  loop.status = 'stopped';
}

/** Summarize a loop (iterations + steps + outcome). */
export function summarizeLoop(loop: GoalLoop): string {
  const lines: string[] = [
    `# Goal Loop ${loop.id}`,
    `**Goal:** ${loop.goal}`,
    `**Status:** ${loop.status}`,
    `**Iterations:** ${loop.iterations.length}/${loop.maxIterations}`,
    '',
    '## Iterations',
  ];
  for (const it of loop.iterations) {
    lines.push(`- Turn ${it.turn}: [${it.verdict}] (score=${it.score}) ${it.action.slice(0, 100)}${it.action.length > 100 ? '…' : ''}`);
    if (it.reasoning) lines.push(`  - ${it.reasoning}`);
  }
  if (loop.steps.length > 0) {
    lines.push('', '## Steps');
    for (const s of loop.steps) {
      lines.push(`- [${s.status}] ${s.description}${s.result ? ` → ${s.result.slice(0, 80)}` : ''}`);
    }
  }
  return lines.join('\n');
}
