/**
 * types-sprint-5.3.ts — Sprint 5.3 Inter-Agent Negotiation + Handoff types.
 * Split because types.ts is at 300/300 (zero headroom).
 */

// ---- Negotiation protocol ----

export type NegotiationKind =
  | 'task_offer' | 'task_accept' | 'task_reject' | 'task_counter'
  | 'resource_request' | 'resource_grant' | 'resource_deny';

export interface TaskOffer {
  taskId: string;
  fromAgent: string;
  toAgent: string;
  role: string;
  goal: string;
  budget?: { tokens?: number; deadlineMs?: number };
  ts: number;
}

export interface TaskCounterOffer {
  taskId: string;
  fromAgent: string;
  toAgent: string;
  counterRole?: string;
  counterBudget?: { tokens?: number; deadlineMs?: number };
  reason?: string;
  ts: number;
}

export interface ResourceRequest {
  resourceId: string;  // e.g. file path
  fromAgent: string;
  toAgent: string;
  access: 'read' | 'write' | 'exclusive';
  durationMs?: number;
  ts: number;
}

export interface ResourceGrant {
  requestId: string;
  resourceId: string;
  fromAgent: string;
  toAgent: string;
  granted: boolean;
  reason?: string;
  ts: number;
}

export interface NegotiationMessage {
  id: string;
  kind: NegotiationKind;
  taskId?: string;
  payload: TaskOffer | TaskCounterOffer | ResourceRequest | ResourceGrant;
  ts: number;
}

// ---- Handoff protocol ----

export type HandoffReason =
  | 'capability_mismatch' | 'overload' | 'stuck' | 'complete'
  | 'escalation' | 'delegation' | 'user_request';

export type HandoffPriority = 'low' | 'normal' | 'high' | 'critical';

export interface HandoffContext {
  taskId: string;
  fromAgent: string;
  toAgent?: string;  // specific target, or undefined for capability-based routing
  reason: HandoffReason;
  priority: HandoffPriority;
  /** summary of work done so far. */
  contextSummary?: string;
  /** artifacts produced (file paths). */
  artifacts?: string[];
  /** capabilities required of the receiver. */
  requiredCapabilities?: string[];
  ts: number;
}

export interface HandoffResult {
  accepted: boolean;
  toAgent: string;
  reason?: string;
  ts: number;
}

export interface AgentCapability {
  agentId: string;
  role: string;
  capabilities: string[];  // e.g. ['typescript', 'testing', 'debugging']
  available: boolean;
  load: number;  // 0-1 (0 = idle, 1 = fully loaded)
}
