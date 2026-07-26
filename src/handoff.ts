/**
 * handoff.ts — agent handoff protocol (feat 4.17).
 *
 * Patterns from memory-mcp workflows_refactored/handoff.py (HandoffReason,
 * HandoffPriority, capability-based routing). pi-agnostic: in-process, zero-
 * network (PREVENT-ITH-004). Routes handoffs to agents whose capabilities
 * match the handoff's requiredCapabilities, weighted by availability + load.
 */

import type { HandoffContext, HandoffResult, AgentCapability, HandoffReason } from './types-sprint-5.3.js';

/** Injectable handoff acceptance policy. */
export type HandoffPolicy = (ctx: HandoffContext, agent: AgentCapability) => Promise<boolean>;

const defaultPolicy: HandoffPolicy = async (ctx, agent) => {
  if (!agent.available) return false;
  if (agent.load >= 0.95) return false;
  if (ctx.requiredCapabilities && ctx.requiredCapabilities.length > 0) {
    const has = ctx.requiredCapabilities.every(c => agent.capabilities.includes(c));
    if (!has) return false;
  }
  // priority boost: high/critical accept even at higher load
  if (ctx.priority === 'critical' || ctx.priority === 'high') return agent.load < 0.85;
  return agent.load < 0.7;
};

/** Handoff manager — routes handoffs to capable + available agents. */
export class AgentHandoffManager {
  private agents = new Map<string, AgentCapability>();
  private handoffs: Array<{ ctx: HandoffContext; result?: HandoffResult }> = [];
  private policy: HandoffPolicy;

  constructor(policy: HandoffPolicy = defaultPolicy) {
    this.policy = policy;
  }

  /** Register an agent. */
  registerAgent(cap: AgentCapability): void { this.agents.set(cap.agentId, cap); }
  /** Unregister an agent. */
  unregisterAgent(agentId: string): void { this.agents.delete(agentId); }
  /** Get an agent. */
  getAgent(agentId: string): AgentCapability | undefined { return this.agents.get(agentId); }
  /** List agents. */
  listAgents(): AgentCapability[] { return [...this.agents.values()]; }

  /** Initiate a handoff. Routes to a capable agent (or a specific toAgent if set). */
  async handoff(ctx: Omit<HandoffContext, 'ts'> & { ts?: number }): Promise<HandoffResult> {
    const full: HandoffContext = { ...ctx, ts: ctx.ts ?? Date.now() };
    // specific target
    if (full.toAgent) {
      const agent = this.agents.get(full.toAgent);
      if (!agent) {
        const r: HandoffResult = { accepted: false, toAgent: full.toAgent, reason: 'target agent not found', ts: full.ts };
        this.handoffs.push({ ctx: full, result: r });
        return r;
      }
      const accepted = await this.policy(full, agent);
      if (accepted) agent.load = Math.min(1, agent.load + 0.2);
      const r: HandoffResult = { accepted, toAgent: full.toAgent, reason: accepted ? undefined : 'rejected by policy', ts: full.ts };
      this.handoffs.push({ ctx: full, result: r });
      return r;
    }
    // capability-based routing: find best candidate
    const candidates = this.findCandidates(full.requiredCapabilities ?? []);
    if (candidates.length === 0) {
      const r: HandoffResult = { accepted: false, toAgent: '', reason: 'no capable agent available', ts: full.ts };
      this.handoffs.push({ ctx: full, result: r });
      return r;
    }
    // try candidates in order (lowest load first)
    for (const agent of candidates) {
      const accepted = await this.policy(full, agent);
      if (accepted) {
        agent.load = Math.min(1, agent.load + 0.2);
        const r: HandoffResult = { accepted: true, toAgent: agent.agentId, ts: full.ts };
        this.handoffs.push({ ctx: full, result: r });
        return r;
      }
    }
    const r: HandoffResult = { accepted: false, toAgent: '', reason: 'all capable agents rejected', ts: full.ts };
    this.handoffs.push({ ctx: full, result: r });
    return r;
  }

  /** Find candidate agents matching required capabilities, sorted by load (ascending). */
  findCandidates(requiredCapabilities: string[]): AgentCapability[] {
    const all = [...this.agents.values()].filter(a => a.available);
    const matching = requiredCapabilities.length === 0
      ? all
      : all.filter(a => requiredCapabilities.every(c => a.capabilities.includes(c)));
    return matching.sort((a, b) => a.load - b.load);
  }

  /** Get handoff history. */
  getHistory(): Array<{ ctx: HandoffContext; result?: HandoffResult }> { return [...this.handoffs]; }

  /** Resolve a handoff reason to a human-readable string. */
  static reasonLabel(reason: HandoffReason): string {
    const labels: Record<HandoffReason, string> = {
      capability_mismatch: 'Capability Mismatch',
      overload: 'Overloaded',
      stuck: 'Stuck',
      complete: 'Complete',
      escalation: 'Escalation',
      delegation: 'Delegation',
      user_request: 'User Request',
    };
    return labels[reason] ?? reason;
  }
}

export function createHandoffManager(policy?: HandoffPolicy): AgentHandoffManager {
  return new AgentHandoffManager(policy);
}
