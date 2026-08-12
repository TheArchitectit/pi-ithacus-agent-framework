/**
 * src/window-pressure.ts — window-pressure snapshot (Sprint 5.17,
 * PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §4.5).
 *
 * A single structured "how full is the context window right now" view that the
 * auto-compact viability guard (planRetry) and the runtime dashboard consume.
 * Replaces the bare `currentPressure` ratio with a richer snapshot (absolute
 * tokens vs window, tier threshold, pressure band, remaining headroom, and an
 * over-threshold flag).
 *
 * Pure + pi-agnostic, pi-agnostic, zero deps, zero network (PREVENT-ITH-004).
 */

import {
  effectiveThresholdTokens,
  pressureRatio,
  pressureBand,
  type PressureBand,
} from "./config.js";

/** A full pressure snapshot for one context window. */
export interface WindowPressure {
  currentTokens: number;
  contextWindow: number;
  tierPct: number;
  threshold: number;
  ratio: number;
  band: PressureBand;
  remaining: number;
  overThreshold: boolean;
}

/**
 * Build the pressure snapshot. `currentTokens` may be null (unknown) — it is
 * treated as 0 for ratio purposes but reported as 0 (never NaN). Non-breaking
 * and additive; the dashboard/viability checks can switch to this freely.
 */
export function snapshotWindowPressure(opts: {
  currentTokens: number | null;
  contextWindow: number;
  tierPct: number;
  bootFallback: number;
}): WindowPressure {
  const current = opts.currentTokens ?? 0;
  const threshold = effectiveThresholdTokens({
    tierPct: opts.tierPct,
    window: opts.contextWindow,
    fallback: opts.bootFallback,
  });
  const ratio = pressureRatio(current, threshold);
  return {
    currentTokens: current,
    contextWindow: opts.contextWindow,
    tierPct: opts.tierPct,
    threshold,
    ratio,
    band: pressureBand(ratio),
    remaining: Math.max(0, opts.contextWindow - current),
    overThreshold: ratio > 1,
  };
}
