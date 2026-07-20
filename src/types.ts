/**
 * types.ts — ithacus-internal types (pi-agnostic).
 *
 * These are the framework's own data shapes, persisted in the local
 * node:sqlite store. They deliberately mirror the PR #3250 team primitives
 * (run / agent / task / inbox) but expressed as plain serializable rows.
 */

export type AgentRole =
  | "Explore"
  | "Plan"
  | "Verification"
  | "Reviewer";

export type RunStatus = "active" | "completed" | "deleted";
export type AgentStatus = "spawning" | "working" | "done" | "failed";
export type TaskStatus = "open" | "claimed" | "completed";

export interface IthRun {
  runId: string;
  modePreset: string;
  createdAt: number;
  summary: string;
  status: RunStatus;
}

export interface IthAgent {
  id: string;
  runId: string;
  role: AgentRole;
  model: string;
  provider: string | null;
  status: AgentStatus;
  lastSeen: number;
}

export interface IthTask {
  id: string;
  runId: string;
  title: string;
  ownerClaim: string | null;
  status: TaskStatus;
}

export interface IthInboxMessage {
  id: string;
  agentId: string;
  fromAgent: string | null;
  payload: string;
  ts: number;
  read: boolean;
}

export type MemoryKind = "decision" | "fact" | "preference";

export interface IthMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  repoId: string;
  ts: number;
}
