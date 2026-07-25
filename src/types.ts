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

// ---- Worktree types (Sprint 1.2) ----

/** Configuration for a per-agent git worktree. */
export interface WorktreeConfig {
  agentId: string;
  runId: string;
  /** absolute path to the worktree directory. */
  path: string;
  /** branch name checked out in the worktree. */
  branch: string;
  /** whether the worktree has been cleaned up. */
  cleaned: boolean;
  createdAt: number;
}

// ---- Async run types (Sprint 1.2) ----

export type AsyncRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** State of a detached background run. */
export interface AsyncRunState {
  runId: string;
  status: AsyncRunStatus;
  /** pid of the detached child process, or null if not yet spawned. */
  pid: number | null;
  /** absolute path to the log file for the child's stdout/stderr. */
  logPath: string;
  /** exit code if completed, else null. */
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  /** error message if failed, else null. */
  error: string | null;
}

// ---- Presence types (Sprint 1.3) ----

export type PresenceStatus = 'active' | 'stuck' | 'idle' | 'complete';

/** Agent presence record — heartbeat-driven liveness. */
export interface AgentPresence {
  agentId: string;
  runId: string;
  status: PresenceStatus;
  lastHeartbeat: number;
  stuckThresholdMs: number;
  createdAt: number;
}

// ---- Reservation types (Sprint 1.3) ----

export type ReservationScope = 'write' | 'edit' | 'read';

/** A file path reservation preventing conflicting writes. */
export interface FileReservation {
  agentId: string;
  runId: string;
  filePath: string;
  scope: ReservationScope;
  createdAt: number;
}

// ---- Cost types (Sprint 1.3) ----

/** Token usage for a single agent action. */
export interface CostEntry {
  id: string;
  agentId: string;
  runId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  ts: number;
}

/** Aggregated cost summary. */
export interface CostSummary {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  byAgent: Record<string, { input: number; output: number }>;
  byRole: Record<string, { input: number; output: number }>;
  entryCount: number;
}

// ---- Model Profile types (Sprint 1.4) ----

export type ProfileTier = 'speed' | 'quality' | 'reasoning' | 'code' | 'local';

/** A reusable model profile: primary model + fallbacks + cost multiplier. */
export interface ModelProfile {
  id: string;
  name: string;
  tier: ProfileTier;
  model: string;
  fallbackModels: string[];
  description: string;
  /** Relative cost multiplier vs the baseline (1.0 = standard). */
  costMultiplier: number;
  isBuiltIn: boolean;
  createdAt: number;
}

/** Per-role profile assignment for a team run. */
export interface TeamModelAssignment {
  runId: string;
  role: AgentRole;
  profileId: string;
  model: string;
  createdAt: number;
}

// ---- Reverse Prompt Validation types (Sprint 1.4) ----

/** A single dimension scored by the validator. */
export interface ScoredDimension {
  name: string;
  score: number;       // 0-100
  feedback: string;
}

/** Full validation report produced by validatePrompt(). */
export interface ValidationReport {
  prompt: string;
  dimensions: ScoredDimension[];
  overallScore: number;          // average of dimension scores
  passed: boolean;               // overallScore >= threshold AND not safety-blocked
  safetyBlocked: boolean;       // safety < 30 hard-blocks execution
  recommendedProfile: ProfileTier;
  recommendedTeamSize: number;   // 1-6
  summary: string;
}

// ---- Hashline + Checkpoint types (Sprint 2.1) ----

/** A content-hash anchored edit. The anchorHash pins the edit to a known-good
 *  state of the file; if the hash mismatches (stale anchor), the applier falls
 *  back to nearest-match recovery instead of failing. */
export interface HashlineEdit {
  filePath: string;
  /** SHA-256 hash (hex) of the exact `oldText` the edit targets. */
  anchorHash: string;
  /** The text to find and replace. Empty for a pure insertion. */
  oldText: string;
  /** The replacement text. Empty for a pure deletion. */
  newText: string;
  /** 1-based line number hint for stale-anchor recovery (optional). */
  anchorLine?: number;
}

/** Pi's native Edit-tool shape (mirrored here so src/ stays pi-agnostic). */
export interface NativeEdit {
  filePath: string;
  oldString: string;
  newString: string;
}

/** A checkpoint marker inserted into a conversation to bound pruning. */
export interface Checkpoint {
  id: string;
  runId: string;
  /** 0-indexed turn position in the conversation when the checkpoint was set. */
  turnIndex: number;
  /** Concise summary of the pruned exploratory context. */
  summary: string;
  /** Token count before pruning (estimated). */
  tokenCountBefore: number;
  /** Token count after pruning (estimated). */
  tokenCountAfter: number;
  createdAt: number;
}

/** Concise summary report produced after pruning. */
export interface CheckpointSummary {
  checkpointId: string;
  prunedMessageCount: number;
  tokensSaved: number;
  /** Bullet-list summary string preserved in the trimmed context. */
  summary: string;
}

export type MemoryKind = "decision" | "fact" | "preference";

export interface IthMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  repoId: string;
  ts: number;
}
