/**
 * src/retry.ts — pure retry / backoff policy (Sprint 5.17,
 * PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §4.2).
 *
 * Pure decision + math only — NO timers here (src stays unit-testable with
 * `node --test`); the actual AbortSignal-aware sleep lives in the extension
 * layer (extensions/ithacus-retry.ts, G7). Extensions orchestrate the loop;
 * this module answers the two policy questions:
 *   1. shouldRetry(kind, attempt, policy)? — bounded by policy.on + maxRetries.
 *   2. computeBackoff(schedule, attempt, rng)? — bounded exponential + jitter.
 *
 * pi-agnostic, zero deps, zero network (PREVENT-ITH-004).
 */

import type { BackoffPolicy, RetryPolicy, WorkerFailureKind } from "./types.js";

/** Hard cap on maxRetries — total attempts = 1 + maxRetries never exceeds 4. */
export const MAX_RETRIES_CAP = 3;

function clampRetries(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_RETRIES_CAP, Math.trunc(n)));
}

/**
 * Should a retry/fallback hop be attempted for `kind` on the (0-based)
 * attempt `attempt`? True only when the policy has the kind enabled, retries
 * are enabled, and we haven't exhausted the cap. Strictly bounded — this is
 * the infinite-loop guard.
 */
export function shouldRetry(
  kind: WorkerFailureKind,
  attempt: number,
  policy: RetryPolicy,
): boolean {
  if (!policy.enabled) return false;
  if (!policy.on.includes(kind)) return false;
  return attempt < clampRetries(policy.maxRetries);
}

/**
 * Pure backoff delay (ms) for the NEXT transient attempt.
 *   delay = min(maxMs, baseMs * factor^attempt)
 * and, when jitter is on, multiplied by (0.5..1.5) drawn from `rng` (defaults
 * to Math.random). Deterministic when a seeded `rng` is injected → testable.
 */
export function computeBackoff(
  schedule: BackoffPolicy,
  attempt: number,
  rng: () => number = Math.random,
): number {
  const base = schedule.baseMs > 0 ? schedule.baseMs : 0;
  const factor = schedule.factor > 0 ? schedule.factor : 2;
  const max = schedule.maxMs > 0 ? schedule.maxMs : 30000;
  const raw = base * Math.pow(factor, Math.max(0, attempt));
  const capped = Math.min(max, raw);
  if (!schedule.jitter) return Math.round(capped);
  const j = 0.5 + rng(); // 0.5..1.5 (±50%)
  return Math.round(capped * j);
}
