/**
 * types-sprint-4.5.ts — Sprint 4.5 Dynamic Workflows + Scheduled Runs types.
 * Split out because types.ts is at 300/300 (zero headroom).
 * New modules import directly from './types-sprint-4.5.js'.
 */

// ---- Dynamic workflow types (feat 4.9) ----

/** Trust level for a dynamic workflow script. */
export type DwfTrustLevel = 'trusted' | 'under-review' | 'untrusted';

/** Budget envelope for a dynamic workflow run. */
export interface DwfBudget {
  /** max concurrent agents spawned via ctx.agent(). */
  maxAgents: number;
  /** max fan-out tasks per ctx.fanOut() call. */
  maxFanOut: number;
  /** total token budget across the run; engine refuses to exceed. */
  tokenBudget: number;
  /** wall-clock deadline (ms since epoch); engine stops after. */
  deadlineMs: number;
}

/** A single agent invocation result. */
export interface DwfAgentResult {
  agentId: string;
  role: string;
  output: string;
  tokensUsed: number;
  ok: boolean;
  error?: string;
}

/** Result of a fan-out batch. */
export interface DwfFanOutResult {
  taskId: string;
  results: DwfAgentResult[];
  totalTokens: number;
}

/** The context handed to a dynamic workflow's run() function. */
export interface DwfContext {
  /** Spawn one agent for a role + goal. */
  agent(role: string, goal: string): Promise<DwfAgentResult>;
  /** Fan out N agents in parallel on the same role/goal template. */
  fanOut(role: string, goals: string[]): Promise<DwfFanOutResult>;
  /** Log a message (structured). */
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  /** The remaining budget snapshot. */
  budget: DwfBudget & { tokensUsed: number; agentsSpawned: number };
  /** The workflow run id. */
  runId: string;
}

/** A dynamic workflow definition (function-based contract; no string eval in src/). */
export interface DwfWorkflow<T = unknown> {
  name: string;
  trust: DwfTrustLevel;
  budget: DwfBudget;
  /** The workflow body. Receives a DwfContext. extensions/ loads .dwf.ts files and passes this fn. */
  run(ctx: DwfContext): Promise<T>;
}

/** Result of a workflow run. */
export interface DwfRunResult<T = unknown> {
  runId: string;
  name: string;
  status: 'ok' | 'failed' | 'budget-exceeded' | 'deadline-exceeded';
  result?: T;
  error?: string;
  tokensUsed: number;
  agentsSpawned: number;
  durationMs: number;
}

// ---- Scheduled run types (feat 4.10) ----

/** Schedule spec kind. */
export type ScheduleKind = 'cron' | 'interval' | 'one-shot';

/** A schedule specification. */
export interface ScheduleSpec {
  id?: string;
  kind: ScheduleKind;
  /** for 'cron': a 5-field cron expression (min hour dom month dow). */
  cron?: string;
  /** for 'interval': milliseconds between fires. */
  intervalMs?: number;
  /** for 'one-shot': epoch ms of the single fire. */
  atMs?: number;
  /** max fires before auto-cancel (0 = unlimited). */
  maxRuns?: number;
  /** deadline epoch ms after which auto-cancel (0 = no deadline). */
  deadlineMs?: number;
  /** the task name (for logging/inspection). */
  name: string;
}

/** Status of a schedule entry. */
export type ScheduleStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'deadline-exceeded';

/** A registered schedule entry. */
export interface ScheduleEntry {
  id: string;
  spec: ScheduleSpec;
  status: ScheduleStatus;
  /** next fire time (epoch ms), or null if done. */
  nextFire: number | null;
  fires: number;
  lastFire: number | null;
  lastError?: string;
  createdAt: number;
}
