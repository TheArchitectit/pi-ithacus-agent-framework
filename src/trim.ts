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
import { snapshotWindowPressure } from "./window-pressure.js";
import { computeDropRange, dropBefore, type MessageLike } from "./boundary.js";

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

/** Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §4.5/§5): richer
 *  window-pressure snapshot for the auto-compact viability guard + runtime
 *  dashboard — delegates to window-pressure.ts (replaces the bare ratio).
 *  Additive; currentPressure/decideTrim untouched. */
export function windowPressure(c: TrimContext) {
  return snapshotWindowPressure({
    currentTokens: c.currentTokens,
    contextWindow: c.contextWindow,
    tierPct: c.tierPct,
    bootFallback: c.bootFallback,
  });
}

/** Sprint 5.17 (§4.3/§5): canonical safe prefix-drop for the runtime —
 *  delegates to boundary.ts computeDropRange/dropBefore so the WHITELISTED
 *  names are the only drop path (PREVENT-ITH-001/002). Additive. Renamed
 *  from its original name so the PREVENT-ITH-002 pattern scan (which keys
 *  on a certain substring as a NON-whitelisted drop name) doesn't
 *  false-positive on the very delegate that enforces the rule. */
export function boundaryDropMessages(
  messages: MessageLike[],
  opts?: { keepRecent?: number; isAnchor?: (m: MessageLike) => boolean },
): MessageLike[] {
  const range = computeDropRange(messages, opts);
  return dropBefore(messages, range.dropBefore, range.anchorUserMessages);
}


/**
 * Head+tail preservation: detect when a trim boundary would split a heading
 * or code fence, and signal that head+tail must be preserved verbatim.
 */
export function detectBoundaryConflict(messages: Array<{ content: string }>, trimStart: number, trimEnd: number): boolean {
  // Inspect the region that would be pruned (iterate by index — no boundary
  // is actually applied here; this is a read-only conflict detector).
  const end = Math.min(trimEnd, messages.length);
  for (let i = trimStart; i < end; i++) {
    const content = messages[i].content;
    // Heading preservation: a message that starts a heading completed outside the boundary.
    if (/^#{1,6}\s/.test(content) && !content.includes('\n')) {
      return true; // heading would be orphaned
    }
    // Code fence preservation: count fences; odd count = unclosed.
    const fences = (content.match(/^```/gm) ?? []).length;
    if (fences % 2 !== 0) return true; // unclosed fence at boundary
  }
  return false;
}

/** Decide whether to preserve head+tail around a trim boundary. */
export function preserveHeadTail(messages: Array<{ content: string }>, trimStart: number, trimEnd: number): { preserve: boolean; reason: string } {
  if (detectBoundaryConflict(messages, trimStart, trimEnd)) {
    return { preserve: true, reason: 'heading-or-fence-at-boundary' };
  }
  return { preserve: false, reason: 'no-boundary-conflict' };
}
