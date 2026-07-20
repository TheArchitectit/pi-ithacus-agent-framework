/**
 * trim.ts — durable-trim relief (P7, borrowed from mega-compact agent-handlers).
 *
 * Lesson from the compressor + PR #3250: during a long team run, pi's native
 * durable compaction only fires at parent settle, so the transcript balloons to
 * the window limit and "compacts but never resumes." A settled `agent_end`
 * (activeAgents === 0, idle, over threshold) is a SAFE point to issue a durable
 * trim, then nudge the agent to continue.
 *
 * This module is pi-agnostic: it decides *whether* to trim (pure policy) given a
 * snapshot; the extension performs the actual ctx.compact() + nudge.
 */

import { effectiveThresholdTokens, pressureRatio } from "./config.js";

export interface TrimContext {
  activeAgents: number;
  isIdle: boolean;
  currentTokens: number | null;
  contextWindow: number;
  tierPct: number;
  bootFallback: number;
  /** ms since last compaction; guards against thrashing the transcript. */
  sinceLastCompactMs: number;
  trimDebounceMs: number;
}

export interface TrimDecision {
  shouldTrim: boolean;
  reason: string;
}

/**
 * Decide whether a durable trim should fire. Mirrors the compressor's three-way
 * guard (truly idle + over threshold + debounce) and its race cooldown.
 */
export function decideTrim(c: TrimContext): TrimDecision {
  if (c.activeAgents > 0) return { shouldTrim: false, reason: "agents-still-active" };
  if (!c.isIdle) return { shouldTrim: false, reason: "not-idle" };
  if (c.sinceLastCompactMs < c.trimDebounceMs)
    return { shouldTrim: false, reason: "debounce" };
  const threshold = effectiveThresholdTokens({
    tierPct: c.tierPct,
    window: c.contextWindow,
    fallback: c.bootFallback,
  });
  const tokens = c.currentTokens ?? 0;
  if (tokens < threshold) return { shouldTrim: false, reason: "below-threshold" };
  return { shouldTrim: true, reason: "idle-over-threshold" };
}

/** How full the window is, for the live dashboard/widget. */
export function currentPressure(c: TrimContext): number {
  const threshold = effectiveThresholdTokens({
    tierPct: c.tierPct,
    window: c.contextWindow,
    fallback: c.bootFallback,
  });
  return pressureRatio(c.currentTokens ?? 0, threshold);
}
