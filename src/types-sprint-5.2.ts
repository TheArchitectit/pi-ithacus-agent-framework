/**
 * types-sprint-5.2.ts — Sprint 5.2 DAG Step Control + Rich Step Types types.
 * Split because types.ts is at 300/300 (zero headroom).
 */

/** Optional retryability predicate: return false to stop retrying early (e.g. permanent error). If undefined, all attempts are used (backward-compatible). */
export type RetryPredicate = (error: string) => boolean;

/** Workflow step types (rich step kinds). */
export type StepType = 'task' | 'tool_call' | 'condition' | 'parallel' | 'loop' | 'human_review' | 'subworkflow';

/** Workflow step status. */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'timeout' | 'partial';

/** A workflow step definition. */
export interface WorkflowStep {
  id: string;
  name: string;
  /** step kind. */
  type: StepType;
  /** agent role for task steps. */
  role?: string;
  /** goal/prompt for the step. */
  goal?: string;
  /** max retry attempts (0 = no retry). */
  retryCount?: number;
  /** timeout in ms (0 = no timeout). */
  timeoutMs?: number;
  /** step id to route to on error (skip this step's normal successors). */
  onError?: string;
  /** condition expression for 'condition' steps (evaluated against vars; truthy = proceed). */
  condition?: string;
  /** loop count for 'loop' steps (repeat the substeps this many times). */
  loopCount?: number;
  /** substeps for 'parallel' / 'loop' / 'subworkflow' steps. */
  substeps?: WorkflowStep[];
  /** dependsOn step ids (must complete before this step). */
  dependsOn?: string[];
  /** arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/** A step execution result. */
export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  attempts: number;
  durationMs: number;
  /** substep results (for parallel/loop/subworkflow). */
  subresults?: StepResult[];
}

/** A workflow template (YAML-loaded). */
export interface WorkflowTemplate {
  name: string;
  description?: string;
  /** the entry-point step ids (top-level, usually one). */
  steps: WorkflowStep[];
  /** template variables with defaults. */
  variables?: Record<string, unknown>;
  /** template metadata. */
  metadata?: Record<string, unknown>;
}

/** A workflow execution result (structured). */
export interface WorkflowResult {
  templateName: string;
  status: 'completed' | 'failed' | 'partial' | 'cancelled';
  results: StepResult[];
  totalDurationMs: number;
  finalOutput?: unknown;
  errors: string[];
  /** variables at end of run. */
  variables?: Record<string, unknown>;
}
