/**
 * types-sprint-5.1.ts — Sprint 5.1 Priority Work Queue + Task Lifecycle types.
 * Split out because types.ts is at 300/300 (zero headroom).
 */

/** Work item priority (P0 highest → P3 lowest). */
export type WorkPriority = 0 | 1 | 2 | 3;

/** Work item status state machine. Transitions: PENDING→INGRESS→NEXT→NOW→DONE|FAILED. */
export type WorkStatus = 'pending' | 'ingress' | 'next' | 'now' | 'done' | 'failed' | 'blocked';

/** A unit of work in the priority queue. */
export interface WorkItem {
  id: number;
  /** human-readable name. */
  name: string;
  /** assigned agent role. */
  assignedRole?: string;
  priority: WorkPriority;
  status: WorkStatus;
  /** ids of items that must complete before this one (dependency gating). */
  dependsOn: number[];
  /** payload/context for the work. */
  payload?: unknown;
  /** epoch ms when item was created. */
  createdAt: number;
  /** epoch ms when item last changed status. */
  updatedAt: number;
  /** epoch ms deadline (0 = no deadline). */
  deadlineMs?: number;
  /** result text after completion. */
  result?: string;
  /** failure reason. */
  error?: string;
}

/** A checkpoint snapshot of the queue (for resumability). */
export interface QueueCheckpoint {
  id: number;
  items: WorkItem[];
  createdAt: number;
  /** count of items done at checkpoint time. */
  doneCount: number;
}

/** A logged queue action (audit trail). */
export interface QueueLogEntry {
  id: number;
  itemId: number;
  action: string;
  status: string;
  role?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  ts: number;
}

/** Task lifecycle (higher-level than a work item — a tracked task with lifecycle). */
export type TaskStatus = 'created' | 'running' | 'completed' | 'cancelled' | 'failed';

/** A task record (lifecycle-managed). */
export interface TaskRecord {
  id: string;
  name: string;
  status: TaskStatus;
  /** assigned agent id. */
  agentId?: string;
  /** input payload. */
  input?: unknown;
  /** output payload. */
  output?: unknown;
  /** error message on failure. */
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
