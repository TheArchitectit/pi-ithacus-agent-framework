/**
 * negotiation.ts — inter-agent negotiation protocol (feat 4.16).
 *
 * Patterns from radcode crates/bus/src/negotiation.rs (TaskOffer/Accept/Reject/
 * Counter, ResourceRequest/Grant/Deny). pi-agnostic: in-process, zero-network
 * (PREVENT-ITH-004). Injectable decision callback for agent acceptance logic;
 * default = capability + load based.
 */

import type {
  NegotiationMessage, NegotiationKind, TaskOffer, TaskCounterOffer,
  ResourceRequest, ResourceGrant, AgentCapability,
} from './types-sprint-5.3.js';

let msgIdCounter = 0;

/** Injectable acceptance policy (default = capability + load based). */
export type AcceptancePolicy = (offer: TaskOffer, agent: AgentCapability) => Promise<{ accept: boolean; counter?: Partial<TaskCounterOffer> }>;

/** Injectable resource policy (default = always grant read, write if not held). */
export type ResourcePolicy = (req: ResourceRequest, holder: string | undefined) => Promise<boolean>;

const defaultAcceptance: AcceptancePolicy = async (offer, agent) => {
  if (!agent.available) return { accept: false };
  if (agent.load >= 0.9) return { accept: false, counter: { counterBudget: { ...(offer.budget ?? {}), deadlineMs: (offer.budget?.deadlineMs ?? 10000) + 5000 } } };
  return { accept: true };
};

const defaultResource: ResourcePolicy = async (req, holder) => {
  if (req.access === 'read') return true;
  if (req.access === 'write') return holder === undefined;
  return holder === undefined;  // exclusive
};

/** Negotiation manager — tracks agents, dispatches offers/requests. */
export class NegotiationManager {
  private agents = new Map<string, AgentCapability>();
  private resources = new Map<string, string>();  // resourceId -> holder agentId
  private messages: NegotiationMessage[] = [];
  private subs = new Set<(m: NegotiationMessage) => void>();
  private acceptance: AcceptancePolicy;
  private resourcePolicy: ResourcePolicy;

  constructor(acceptance: AcceptancePolicy = defaultAcceptance, resourcePolicy: ResourcePolicy = defaultResource) {
    this.acceptance = acceptance;
    this.resourcePolicy = resourcePolicy;
  }

  /** Register an agent. */
  registerAgent(cap: AgentCapability): void { this.agents.set(cap.agentId, cap); }
  /** Unregister an agent. */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    for (const [k, v] of this.resources) if (v === agentId) this.resources.delete(k);
  }
  /** Get an agent. */
  getAgent(agentId: string): AgentCapability | undefined { return this.agents.get(agentId); }
  /** List agents. */
  listAgents(): AgentCapability[] { return [...this.agents.values()]; }

  /** Offer a task to a specific agent. Returns the negotiation message (accept/reject/counter). */
  async offerTask(offer: Omit<TaskOffer, 'ts'> & { ts?: number }): Promise<NegotiationMessage> {
    const full: TaskOffer = { ...offer, ts: offer.ts ?? Date.now() };
    const agent = this.agents.get(offer.toAgent);
    if (!agent) {
      const rejectPayload = { taskId: offer.taskId, fromAgent: offer.toAgent, toAgent: offer.fromAgent, reason: 'agent not found', ts: full.ts } as TaskCounterOffer;
      return this.record('task_reject', offer.taskId, full, rejectPayload);
    }
    const decision = await this.acceptance(full, agent);
    if (decision.accept) {
      agent.load = Math.min(1, agent.load + 0.2);
      return this.record('task_accept', offer.taskId, full, full);
    }
    if (decision.counter) {
      const counter: TaskCounterOffer = {
        taskId: offer.taskId, fromAgent: offer.toAgent, toAgent: offer.fromAgent,
        counterRole: decision.counter.counterRole,
        counterBudget: decision.counter.counterBudget,
        reason: decision.counter.reason ?? 'counter-offer', ts: full.ts,
      };
      return this.record('task_counter', offer.taskId, full, counter);
    }
    const rejectPayload = { taskId: offer.taskId, fromAgent: offer.toAgent, toAgent: offer.fromAgent, reason: 'rejected', ts: full.ts } as TaskCounterOffer;
    return this.record('task_reject', offer.taskId, full, rejectPayload);
  }

  /** Request a resource. Returns the grant/deny message. */
  async requestResource(req: Omit<ResourceRequest, 'ts'> & { ts?: number }): Promise<NegotiationMessage> {
    const full: ResourceRequest = { ...req, ts: req.ts ?? Date.now() };
    const holder = this.resources.get(req.resourceId);
    const granted = await this.resourcePolicy(full, holder);
    const grant: ResourceGrant = {
      requestId: `req-${++msgIdCounter}`, resourceId: req.resourceId,
      fromAgent: req.toAgent, toAgent: req.fromAgent, granted,
      reason: granted ? undefined : (holder ? `held by ${holder}` : 'denied'), ts: full.ts,
    };
    if (granted) this.resources.set(req.resourceId, req.fromAgent);
    return this.record(granted ? 'resource_grant' : 'resource_deny', undefined, full, grant);
  }

  /** Release a held resource. */
  releaseResource(resourceId: string, agentId: string): boolean {
    if (this.resources.get(resourceId) !== agentId) return false;
    this.resources.delete(resourceId);
    return true;
  }
  /** Get the holder of a resource. */
  getResourceHolder(resourceId: string): string | undefined { return this.resources.get(resourceId); }

  /** Subscribe to all messages. */
  subscribe(fn: (m: NegotiationMessage) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  /** Get all messages (audit log). */
  getMessages(): NegotiationMessage[] { return [...this.messages]; }

  private record(kind: NegotiationKind, taskId: string | undefined, offer: TaskOffer | ResourceRequest, payload: NegotiationMessage['payload']): NegotiationMessage {
    const msg: NegotiationMessage = { id: `neg-${++msgIdCounter}`, kind, taskId, payload, ts: Date.now() };
    this.messages.push(msg);
    for (const fn of this.subs) fn(msg);
    return msg;
  }
}

export function createNegotiationManager(acceptance?: AcceptancePolicy, resourcePolicy?: ResourcePolicy): NegotiationManager {
  return new NegotiationManager(acceptance, resourcePolicy);
}
