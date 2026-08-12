/**
 * handoff.ts — agent handoff protocol (feat 4.17).
 *
 * Patterns from memory-mcp workflows_refactored/handoff.py (HandoffReason,
 * HandoffPriority, capability-based routing). pi-agnostic: in-process, zero-
 * network (PREVENT-ITH-004). Routes handoffs to agents whose capabilities
 * match the handoff's requiredCapabilities, weighted by availability + load.
 */

import type { HandoffContext, HandoffResult, AgentCapability, HandoffReason } from './types-sprint-5.3.js';
import type { IthacusEvent } from './events.js';

/** Sprint 5.22 (docs/DESIGN_LIVE_A2A_ACCOUNTING.md §4.2): optional emitter ctx
 *  for the handoff manager. `publish` is best-effort (publish-never-throws) —
 *  a throwing subscriber can never break the routing hot path. Persisted
 *  history (getHistory) stays SSOT; these events are the live stream only. */
export interface HandoffEmitCtx {
  publish?: (ev: IthacusEvent) => void;
}

const NOOP_PUBLISH = (_ev: IthacusEvent): void => {
  /* noop */
};

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
  private publish: (ev: IthacusEvent) => void;
  private handoffSeq = 0;

  constructor(policy: HandoffPolicy = defaultPolicy, ctx?: HandoffEmitCtx) {
    this.policy = policy;
    this.publish = ctx?.publish ?? NOOP_PUBLISH;
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
    this.handoffSeq++;
    // Sprint 5.22: handoff_initiated on every request (open handoffs carry
    // to:null — capability-based routing). Best-effort. The STORE/history is
    // still the SSOT; the event is the live stream.
    this.safeEmit({
      type: 'handoff_initiated',
      from: full.fromAgent,
      to: full.toAgent ?? null,
      reason: full.reason,
      ts: full.ts,
    });
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
      if (accepted) this.safeEmit(this.acceptedEvent(r, full));
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
        this.safeEmit(this.acceptedEvent(r, full));
        return r;
      }
    }
    const r: HandoffResult = { accepted: false, toAgent: '', reason: 'all capable agents rejected', ts: full.ts };
    this.handoffs.push({ ctx: full, result: r });
    return r;
  }

  /** Best-effort listener emission — a throwing subscriber can never break
   *  the handoff routing hot path (DESIGN_EVENT_STREAM.md §2.2 contract). */
  private safeEmit(ev: IthacusEvent): void {
    try {
      this.publish(ev);
    } catch {
      /* emission never throws into routing */
    }
  }

  /** Build the handoff_accepted event for a successful result. */
  private acceptedEvent(r: HandoffResult, full: HandoffContext): IthacusEvent {
    return {
      type: 'handoff_accepted',
      handoffId: `ho-${this.handoffSeq}-${full.ts}`,
      from: full.fromAgent,
      to: r.toAgent || (full.toAgent ?? ''),
      ts: full.ts,
    };
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

export function createHandoffManager(policy?: HandoffPolicy, ctx?: HandoffEmitCtx): AgentHandoffManager {
  return new AgentHandoffManager(policy, ctx);
}
