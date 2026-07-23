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
  /** JSON-schema string used to validate a sub-agent's result, or null. */
  resultSchema: string | null;
  /** whether the agent's last result passed `resultSchema` validation. */
  resultValidated: boolean;
}

export interface IthTask {
  id: string;
  runId: string;
  title: string;
  ownerClaim: string | null;
  status: TaskStatus;
  /** ids of tasks that must complete before this one (JSON-encoded array in DB). */
  dependsOn: string[];
  /** which execution wave (0-indexed) this task belongs to, or null if uncomputed. */
  wave: number | null;
  /** named phase grouping for the task, or null. */
  phase: string | null;
}

export interface IthInboxMessage {
  id: string;
  agentId: string;
  fromAgent: string | null;
  payload: string;
  ts: number;
  read: boolean;
}

// ---- Workflow DAG types ------------------------------------------------

/** A unit of work in a team workflow DAG. `dependsOn` lists node ids that
 *  must complete before this node runs. */
export interface WorkflowNode {
  id: string;
  taskTitle: string;
  /** optional: which role should handle this node's task. */
  role?: AgentRole;
  /** ids of nodes that must complete first. */
  dependsOn: string[];
}

/** A directed dependency edge: `from` must complete before `to` runs. */
export interface WorkflowEdge {
  from: string;
  to: string;
}

/** Result of wave generation: nodes grouped into parallel-execution waves. */
export interface WaveExecution {
  /** each wave is a list of node ids that may run in parallel. */
  waves: string[][];
  totalWaves: number;
}

export type MemoryKind = "decision" | "fact" | "preference";

export interface IthMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  repoId: string;
  ts: number;
}
