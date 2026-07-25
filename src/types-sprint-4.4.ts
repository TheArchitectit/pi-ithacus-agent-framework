/**
 * types-sprint-4.4.ts — Sprint 4.4 DAP + AST + Goal-Loop types.
 * Split out because types.ts is at 300/300 (zero headroom).
 * New modules import directly from './types-sprint-4.4.js'.
 */

// ---- DAP types ----

/** A DAP breakpoint. */
export interface DapBreakpoint {
  id?: number;
  /** source file path or URI. */
  source: string;
  line: number;
  column?: number;
  /** conditional breakpoint expression. */
  condition?: string;
  /** log message (for logPoints). */
  logMessage?: string;
  /** hit count condition (e.g. '>= 5'). */
  hitCondition?: string;
  verified: boolean;
  message?: string;
}

/** A stack frame from a thread's stack trace. */
export interface DapStackFrame {
  id: number;
  name: string;
  source: string;
  line: number;
  column: number;
  moduleId?: string;
  presentationHint?: 'normal' | 'label' | 'subtle';
}

/** A variable (scope variable or evaluated expression). */
export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  presentationHint?: { kind?: string; visibility?: string };
}

/** A scope (group of variables). */
export interface DapScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
  presentationHint?: string;
}

/** A thread. */
export interface DapThread {
  id: number;
  name: string;
}

/** A stopped event reason. */
export type DapStopReason =
  | 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'goto';

/** A DAP stopped event. */
export interface DapStoppedEvent {
  reason: DapStopReason;
  threadId: number;
  allThreadsStopped?: boolean;
  text?: string;
}

// ---- AST types ----

/** An AST pattern match (a node captured by a structural pattern). */
export interface AstMatch {
  /** node text (the matched source). */
  text: string;
  /** start byte offset. */
  start: number;
  /** end byte offset. */
  end: number;
  /** named captures in the pattern. */
  captures: Record<string, string>;
}

/** A structural rewrite edit. */
export interface AstRewrite {
  /** the pattern to match. */
  pattern: string;
  /** the replacement template (uses $NAME captures). */
  replacement: string;
  /** language for parsing. */
  language: string;
}

/** Result of applying a rewrite. */
export interface AstRewriteResult {
  /** the rewritten source. */
  source: string;
  /** number of matches replaced. */
  replacements: number;
  /** individual match details. */
  matches: AstMatch[];
}

// ---- Goal loop types ----

/** A single step in a goal loop. */
export interface GoalStep {
  id: string;
  /** the action description. */
  description: string;
  /** 'pending' | 'running' | 'done' | 'failed' | 'skipped'. */
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  /** model output / tool result. */
  result?: string;
  ts: number;
}

/** A goal loop iteration (LLM turn + judge verdict). */
export interface GoalIteration {
  turn: number;
  /** the LLM's proposed action. */
  action: string;
  /** the judge's verdict. */
  verdict: 'continue' | 'complete' | 'failed';
  /** judge's reasoning. */
  reasoning: string;
  /** score 0-1 (judge confidence the goal is met). */
  score: number;
}

/** A goal loop definition. */
export interface GoalLoop {
  id: string;
  /** the high-level goal. */
  goal: string;
  /** max iterations before giving up. */
  maxIterations: number;
  /** accumulated iterations. */
  iterations: GoalIteration[];
  /** steps (sub-tasks). */
  steps: GoalStep[];
  /** 'running' | 'complete' | 'failed' | 'stopped'. */
  status: 'running' | 'complete' | 'failed' | 'stopped';
  createdAt: number;
}
