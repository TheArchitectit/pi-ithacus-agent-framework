/**
 * cost.ts — token usage tracking and cost calculation.
 *
 * Records input/output tokens per agent action and produces summary reports.
 * pi-agnostic.
 */

import type { CostEntry, CostSummary, IthAgent } from './types.js';
import type { PresenceStore } from './store-presence.js';

let costCounter = 0;

/** Record a cost entry for an agent action. */
export function recordCost(
  store: PresenceStore,
  opts: { agentId: string; runId: string; inputTokens: number; outputTokens: number; model: string },
): CostEntry {
  if (opts.inputTokens < 0 || opts.outputTokens < 0) {
    throw new Error('Token counts must be non-negative');
  }
  const entry: CostEntry = {
    id: `cost-${Date.now()}-${++costCounter}`,
    agentId: opts.agentId,
    runId: opts.runId,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    model: opts.model,
    ts: Date.now(),
  };
  store.recordCost(entry);
  return entry;
}

/**
 * Get cost summary for a run, optionally enriched with agent role info.
 */
export function getCostSummary(
  store: PresenceStore,
  runId: string,
  agents?: IthAgent[],
): CostSummary {
  return store.costSummary(runId, agents);
}

/**
 * Get per-agent cost breakdown for a run.
 */
export function getAgentCosts(
  store: PresenceStore,
  runId: string,
): Array<{ agentId: string; input: number; output: number }> {
  const summary = store.costSummary(runId);
  return Object.entries(summary.byAgent).map(([agentId, v]) => ({ agentId, ...v }));
}
