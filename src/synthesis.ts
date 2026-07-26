/**
 * synthesis.ts — result synthesis engine (feat 4.19, 4.20).
 *
 * Patterns from radical swarm/synthesis/{attribution,conflict,scoring,engine}.rs.
 * pi-agnostic: pure functions, zero-network (PREVENT-ITH-004). Merges
 * multiple agent outputs with attribution + conflict detection + confidence
 * scoring.
 */

import type { SynthesizedResult } from './types-sprint-5.4.js';

export interface AgentContribution {
  agent: string;
  output: unknown;
  /** weight 0-1 (e.g. capability score or load-based). */
  weight?: number;
}

export type SynthesisMethod = 'majority' | 'weighted' | 'first';

type Attribution = Array<{ agent: string; contribution: string; weight: number }>;

interface MergeResult {
  output: unknown;
  attribution: Attribution;
}

/** Detect conflicts among contributions (contradictory string outputs). */
export function detectConflicts(contribs: AgentContribution[]): Array<{ description: string; resolution: string }> {
  const conflicts: Array<{ description: string; resolution: string }> = [];
  // group by normalized string output
  const groups = new Map<string, string[]>();
  for (const c of contribs) {
    const key = JSON.stringify(c.output);
    const arr = groups.get(key) ?? [];
    arr.push(c.agent);
    groups.set(key, arr);
  }
  if (groups.size > 1) {
    const desc = Array.from(groups.entries()).map(([out, agents]) => `${agents.join(',')} => ${out.slice(0, 50)}`).join(' | ');
    conflicts.push({
      description: `${groups.size} distinct outputs from ${contribs.length} agents: ${desc}`,
      resolution: 'majority vote selected; conflicts logged',
    });
  }
  return conflicts;
}

/** Majority vote: pick the most common output. */
export function majorityVote(contribs: AgentContribution[]): MergeResult {
  const counts = new Map<string, { output: unknown; agents: string[] }>();
  for (const c of contribs) {
    const key = JSON.stringify(c.output);
    const e = counts.get(key);
    if (e) e.agents.push(c.agent);
    else counts.set(key, { output: c.output, agents: [c.agent] });
  }
  let best: { output: unknown; agents: string[]; count: number } | null = null;
  for (const [, v] of counts) {
    if (!best || v.agents.length > best.count) best = { output: v.output, agents: v.agents, count: v.agents.length };
  }
  if (!best) return { output: undefined, attribution: [] };
  const total = contribs.length;
  const out = best.output;
  const count = best.count;
  const agents = best.agents;
  return {
    output: out,
    attribution: agents.map(a => ({ agent: a, contribution: JSON.stringify(out), weight: count / total })),
  };
}

/** Weighted merge: pick the output with the highest weight sum. */
export function weightedMerge(contribs: AgentContribution[]): MergeResult {
  const scores = new Map<string, { output: unknown; weight: number; agents: Array<{ agent: string; weight: number }> }>();
  for (const c of contribs) {
    const key = JSON.stringify(c.output);
    const w = c.weight ?? 0.5;
    const e = scores.get(key);
    if (e) { e.weight += w; e.agents.push({ agent: c.agent, weight: w }); }
    else scores.set(key, { output: c.output, weight: w, agents: [{ agent: c.agent, weight: w }] });
  }
  let best: { output: unknown; weight: number; agents: Array<{ agent: string; weight: number }> } | null = null;
  for (const [, v] of scores) if (!best || v.weight > best.weight) best = v;
  if (!best) return { output: undefined, attribution: [] };
  const totalWeight = contribs.reduce((s, c) => s + (c.weight ?? 0.5), 0);
  const out = best.output;
  const agents = best.agents;
  return {
    output: out,
    attribution: agents.map(a => ({ agent: a.agent, contribution: JSON.stringify(out), weight: a.weight / totalWeight })),
  };
}

/** First-wins: take the first contribution. */
export function firstWins(contribs: AgentContribution[]): MergeResult {
  if (contribs.length === 0) return { output: undefined, attribution: [] };
  const c = contribs[0];
  return { output: c.output, attribution: [{ agent: c.agent, contribution: JSON.stringify(c.output), weight: 1 }] };
}

/** Synthesize multiple contributions into a single result. */
export function synthesize(contribs: AgentContribution[], method: SynthesisMethod = 'majority'): SynthesizedResult {
  if (contribs.length === 0) {
    return { output: undefined, attribution: [], conflicts: [], score: 0, method };
  }
  if (contribs.length === 1) {
    return { output: contribs[0].output, attribution: [{ agent: contribs[0].agent, contribution: JSON.stringify(contribs[0].output), weight: 1 }], conflicts: [], score: 1, method };
  }
  const conflicts = detectConflicts(contribs);
  let merged: MergeResult;
  if (method === 'majority') merged = majorityVote(contribs);
  else if (method === 'weighted') merged = weightedMerge(contribs);
  else merged = firstWins(contribs);
  // score: agreement ratio (1 = unanimous, 0 = all different)
  const distinct = new Set(contribs.map(c => JSON.stringify(c.output))).size;
  const score = distinct === 1 ? 1 : 1 - (distinct - 1) / contribs.length;
  return { output: merged.output, attribution: merged.attribution, conflicts, score, method };
}
