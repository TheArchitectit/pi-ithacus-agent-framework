/**
 * ithacus-plan.ts — pi adapter for plan synthesis + dispatch (Sprint 5.6).
 *
 * Bridges the pi-agnostic PlanSynthesizer + PlanRunner (src/plan.ts) to the
 * pi extension API. The caller (command handler) calls runtime.bindRepo(cwd)
 * before calling executePlan.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { IthRuntime } from './ithacus-runtime.js';
import { PlanSynthesizer, PlanRunner, type PlanRequest, type PlanOutcome } from '../src/plan.js';
import { PiSwarmExecutor } from './ithacus-swarm.js';
import { SwarmStore } from '../src/store-swarm.js';

export interface PlanRunOpts {
  pi: ExtensionAPI;
  runtime: IthRuntime;
  goal: string;
  agents?: Array<{ role?: string }>;
  model?: string;
  checkpointInterval?: number;
  maxBlockedPolls?: number;
}

/**
 * Execute a plan: synthesize → queue → dispatch → persist.
 * Caller must call runtime.bindRepo(cwd) before invoking.
 */
export async function executePlan(opts: PlanRunOpts): Promise<PlanOutcome> {
  const synthesizer = new PlanSynthesizer();
  const executor = new PiSwarmExecutor(opts.pi, opts.model);
  const store = new SwarmStore(opts.runtime.store.db);
  const runner = new PlanRunner(synthesizer, executor, store);

  const req: PlanRequest = {
    goal: opts.goal,
    agents: opts.agents?.length ? opts.agents : [{ role: 'Explore' }],
  };

  const outcome = await runner.execute(req, {
    checkpointInterval: opts.checkpointInterval,
    maxBlockedPolls: opts.maxBlockedPolls,
  });

  opts.runtime.appendEvent('plan_run', {
    goal: opts.goal.slice(0, 100),
    storeRunId: outcome.storeRunId,
    swarmName: outcome.swarmName,
    total: outcome.total,
    successful: outcome.successful,
    failed: outcome.failed,
    blocked: outcome.blocked,
  });

  return outcome;
}
