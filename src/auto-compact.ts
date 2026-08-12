/**
 * src/auto-compact.ts — rebuild a compacted continuation from durable state
 * on a context_window failure (Sprint 5.17, PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §4.4).
 *
 * The combination that makes Sprint 5.17's "durable auto-compact" work WITHOUT
 * reusing the dead child's session (the claw-code PR #4 bug we explicitly
 * avoid):
 *   - buildContinuationSummary(live, originalTask) — rebuild a continuation
 *     prompt from the live-progress STORE + the ORIGINAL task text (NOT a
 *     compacted/derived task, and NEVER a `role:"system"` injection —
 *     PREVENT-ITH-003: the result is task text the caller prepends).
 *   - planRetry(...) — calls buildContinuationSummary, bumps the attempt, and
 *     runs the VIABILITY GUARD: if the rebuilt summary is still over the
 *     context window (estimateTokens > contextWindow) the compaction bought
 *     nothing, so it returns the UNCOMPACTED originalTask (so shouldRetry's cap
 *     prevents a doomed retry).
 *
 * Invariants honored here:
 *   - last `keepRecent` tool calls kept verbatim (anchor floor, ITH-001);
 *   - always embeds originalTask unchanged (ITH-001);
 *   - tool entries are atomic (call+result together → ITH-002);
 *   - one bullet per earlier tool, capped by maxBullets.
 *
 * Pure + pi-agnostic, zero deps, zero network (PREVENT-ITH-004).
 */

import type { WorkerFailureKind } from "./events.js";
import { estimateTokens } from "./checkpoint.js";
import type { RetryPolicy } from "./types.js";

/** Minimal durable progress snapshot the extension adapts from AgentLive. */
export interface LiveProgress {
  agent: string;
  model?: string;
  recentTools: Array<{ tool: string; args: string }>;
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
  filesAccessed: string[];
  taskPreview?: string;
}

export interface ContinuationArgs {
  live: LiveProgress;
  originalTask: string;          // NEVER the compacted one
  keepRecent?: number;           // default config.preserveRecent (anchor floor)
  maxBullets?: number;
  failureKind?: WorkerFailureKind;
}

/**
 * Build the rebuilt continuation prompt: `[continuation] <summary>\n\n<remaining task>`.
 *
 * Keeps the last `keepRecent` tool calls verbatim (the anchor floor), embeds
 * `originalTask` unchanged, and summarizes earlier tool calls to one bullet
 * each capped by maxBullets. The whole thing is text the caller PREPENDS to
 * the task — never `role:"system"` (PREVENT-ITH-003).
 */
export function buildContinuationSummary(args: ContinuationArgs): string {
  const keepRecent = Math.max(0, args.keepRecent ?? 4);
  const maxBullets = Math.max(0, args.maxBullets ?? 12);
  const tools = args.live.recentTools ?? [];

  const kept = tools.slice(-keepRecent);
  const summarized = tools.slice(0, Math.max(0, tools.length - keepRecent));

  const parts: string[] = [];

  // Anchor floor (ITH-001): the last keepRecent tool calls verbatim.
  if (kept.length > 0) {
    const keptLines = kept
      .map((t) => `- ${t.tool}${t.args ? `: ${t.args}` : ""}`)
      .join("\n");
    parts.push(`Recent work (verbatim):\n${keptLines}`);
  }

  // Compacted history: one bullet per earlier tool, capped.
  if (summarized.length > 0) {
    const bullets = summarized
      .slice(0, maxBullets)
      .map((t) => `- ${t.tool}${t.args ? `: ${t.args}` : ""}`);
    if (summarized.length > maxBullets) {
      bullets.push(`- …and ${summarized.length - maxBullets} more`);
    }
    parts.push(`Earlier progress summary:\n${bullets.join("\n")}`);
  }

  // Always embed the original task, unchanged.
  parts.push(`Remaining task:\n${args.originalTask}`);

  return `[continuation]\n${parts.join("\n\n")}`;
}

export interface RetryPlan {
  task: string;
  attempt: number;
}

export interface PlanRetryArgs {
  dispatchId: string;
  agent: string;
  originalTask: string;
  attempt: number;
  policy: RetryPolicy;
  live: LiveProgress;
  failureKind: WorkerFailureKind;
  contextWindow?: number;
  keepRecent?: number;
}

const MAX_ATTEMPT = 3;

function clampAttempt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_ATTEMPT, Math.trunc(n)));
}

/**
 * Plan the next retry for a failed dispatch: rebuild the compacted task from
 * durable state and bump the attempt (clamped to [0,3]). Viability guard: if
 * the rebuilt summary is still over `contextWindow` (compaction bought
 * nothing), return the UNCOMPACTED originalTask so the caller's shouldRetry
 * cap prevents a doomed retry.
 */
export function planRetry(args: PlanRetryArgs): RetryPlan {
  const attempt = clampAttempt(args.attempt + 1);
  const summary = buildContinuationSummary({
    live: args.live,
    originalTask: args.originalTask,
    keepRecent: args.keepRecent,
    failureKind: args.failureKind,
  });
  const over = args.contextWindow
    ? estimateTokens(summary) > args.contextWindow
    : false;
  return {
    task: over ? args.originalTask : summary,
    attempt,
  };
}
