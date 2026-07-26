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

/**
 * Injectable resource policy. `holder` is the exclusive writer (or undefined);
 * `readerCount` is how many concurrent readers currently hold the resource.
 */
export type ResourcePolicy = (req: ResourceRequest, holder: string | undefined, readerCount: number) => Promise<boolean>;

const defaultAcceptance: AcceptancePolicy = async (offer, agent) => {
  if (!agent.available) return { accept: false };
  if (agent.load >= 0.9) return { accept: false, counter: { counterBudget: { ...(offer.budget ?? {}), deadlineMs: (offer.budget?.deadlineMs ?? 10000) + 5000 } } };
  return { accept: true };
};

/** Default: read granted iff no writer; write/exclusive granted iff no writer AND no readers. */
const defaultResource: ResourcePolicy = async (req, holder, readerCount) => {
  if (req.access === 'read') return holder === undefined;
  return holder === undefined && readerCount === 0;  // write / exclusive
};

/** Negotiation manager — tracks agents, dispatches offers/requests. */
export class NegotiationManager {
  private agents = new Map<string, AgentCapability>();
  private readers = new Map<string, Set<string>>();  // resourceId -> set of reader agentIds
  private writers = new Map<string, string>();       // resourceId -> exclusive writer agentId
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
  /** Unregister an agent — clears both reader memberships and held writer slots. */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    for (const [rid, set] of this.readers) {
      set.delete(agentId);
      if (set.size === 0) this.readers.delete(rid);
    }
    for (const [rid, w] of this.writers) if (w === agentId) this.writers.delete(rid);
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
      return this.record('task_reject', offer.taskId, rejectPayload);
    }
    const decision = await this.acceptance(full, agent);
    if (decision.accept) {
      agent.load = Math.min(1, agent.load + 0.2);
      return this.record('task_accept', offer.taskId, full);
    }
    if (decision.counter) {
      const counter: TaskCounterOffer = {
        taskId: offer.taskId, fromAgent: offer.toAgent, toAgent: offer.fromAgent,
        counterRole: decision.counter.counterRole,
        counterBudget: decision.counter.counterBudget,
        reason: decision.counter.reason ?? 'counter-offer', ts: full.ts,
      };
      return this.record('task_counter', offer.taskId, counter);
    }
    const rejectPayload = { taskId: offer.taskId, fromAgent: offer.toAgent, toAgent: offer.fromAgent, reason: 'rejected', ts: full.ts } as TaskCounterOffer;
    return this.record('task_reject', offer.taskId, rejectPayload);
  }

  /** Request a resource. Returns the grant/deny message. */
  async requestResource(req: Omit<ResourceRequest, 'ts'> & { ts?: number }): Promise<NegotiationMessage> {
    const full: ResourceRequest = { ...req, ts: req.ts ?? Date.now() };
    const holder = this.writers.get(req.resourceId);
    const readerCount = this.readers.get(req.resourceId)?.size ?? 0;
    const granted = await this.resourcePolicy(full, holder, readerCount);
    const grant: ResourceGrant = {
      requestId: `req-${++msgIdCounter}`, resourceId: req.resourceId,
      fromAgent: req.toAgent, toAgent: req.fromAgent, granted,
      reason: granted ? undefined : (holder ? `held by ${holder}` : (readerCount > 0 ? `read by ${readerCount}` : 'denied')), ts: full.ts,
    };
    if (granted) {
      if (req.access === 'read') this.addReader(req.resourceId, req.fromAgent);
      else this.writers.set(req.resourceId, req.fromAgent);  // write / exclusive
    }
    return this.record(granted ? 'resource_grant' : 'resource_deny', undefined, grant);
  }

  /** Release a held resource (reader membership or writer slot). */
  releaseResource(resourceId: string, agentId: string): boolean {
    const set = this.readers.get(resourceId);
    if (set?.has(agentId)) {
      set.delete(agentId);
      if (set.size === 0) this.readers.delete(resourceId);
      return true;
    }
    if (this.writers.get(resourceId) === agentId) {
      this.writers.delete(resourceId);
      return true;
    }
    return false;
  }
  /** Get the exclusive writer of a resource, if any. (Reads are concurrent — no single holder.) */
  getResourceHolder(resourceId: string): string | undefined { return this.writers.get(resourceId); }
  /** Get the list of current reader agentIds for a resource. */
  getResourceReaders(resourceId: string): string[] { return [...(this.readers.get(resourceId) ?? [])]; }

  /** Subscribe to all messages. */
  subscribe(fn: (m: NegotiationMessage) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  /** Get all messages (audit log). */
  getMessages(): NegotiationMessage[] { return [...this.messages]; }

  /** Add a reader to a resource's reader set (creating it if absent). */
  private addReader(resourceId: string, agentId: string): void {
    let set = this.readers.get(resourceId);
    if (!set) { set = new Set<string>(); this.readers.set(resourceId, set); }
    set.add(agentId);
  }

  private record(kind: NegotiationKind, taskId: string | undefined, payload: NegotiationMessage['payload']): NegotiationMessage {
    const msg: NegotiationMessage = { id: `neg-${++msgIdCounter}`, kind, taskId, payload, ts: Date.now() };
    this.messages.push(msg);
    for (const fn of this.subs) fn(msg);
    return msg;
  }
}

export function createNegotiationManager(acceptance?: AcceptancePolicy, resourcePolicy?: ResourcePolicy): NegotiationManager {
  return new NegotiationManager(acceptance, resourcePolicy);
}
