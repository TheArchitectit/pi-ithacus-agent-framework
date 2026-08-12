/**
 * src/failure-kind.ts — failure-kind detection markers + full classifier
 * (Sprint 5.17, PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §2.2).
 *
 * One OWNER for every marker set + the classifyFailureKind() precedence order.
 * src/worker-status.ts delegates its classifyFailure() here (removes its local
 * CONTEXT_WINDOW_MARKERS duplicate); src/retry.ts / model-fallback.ts route on
 * the result; extensions/ithacus-retry.ts feeds this exit evidence into the
 * dispatch-resilience loop.
 *
 * Pure + pi-agnostic: no pi imports, no timers, no process control, no network
 * (PREVENT-ITH-004) — unit-testable with `node --test`.
 *
 * Marker hygiene (Risk G5): every marker is ANCHORED (numeric codes wrapped in
 * \b, phrases preferred over bare codes) and the classifier only ever scans the
 * TAIL slices (`stderrTail`/`outputTail`, last ~512 chars the caller slices)
 * — so ordinary prose in longer output cannot misclassify. Smoke tests assert
 * benign prose does NOT trip any class.
 */

import type { WorkerStatus, WorkerFailureKind } from "./events.js";

/** Existing context-window markers (kept from worker-status.ts — now owned here). */
export const CONTEXT_WINDOW_MARKERS: readonly RegExp[] = [
  /context (window|length)/i,
  /maximum context/i,
  /context_left/i,
  /prompt is too long/i,
  /too many tokens/i,
];

/** HTTP 429 / quota / provider throttling (→ backoff, else alt-provider hop). */
export const RATE_LIMIT_MARKERS: readonly RegExp[] = [
  /\b429\b/i,
  /rate.?limit/i,
  /too many requests/i,
  /quota/i,
];

/** Transport-level blips (→ bounded transient backoff retry, same model). */
export const NETWORK_MARKERS: readonly RegExp[] = [
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /fetch failed/i,
  /socket hang up/i,
  /connection refused/i,
  /network error/i,
  /dns/i,
];

/** 401/403 / bad-key / forbidden (→ skip to next hop; same creds keep failing). */
export const AUTH_MARKERS: readonly RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /unauthorized/i,
  /forbidden/i,
  /invalid api key/i,
  /authentication failed/i,
  /api key/i,
];

/** Explicit timeout / deadline trip (→ backoff retry). */
export const TIMEOUT_MARKERS: readonly RegExp[] = [
  /timed out/i,
  /deadline/i,
  /maxruntime/i,
];

/**
 * Exit-time evidence the adapter (endLive / dispatch loop) hands the
 * classifier. Mirrors the legacy worker-status WorkerFailureSignals shape.
 */
export interface FailureSignals {
  /** Child exit code, when a process ran and reported one. */
  exitCode?: number;
  /** Explicit timeout trip (maxRuntimeMs — seam for the future scheduler). */
  timedOut?: boolean;
  /** The WORKER's status just before the terminal flip (never \"done\"/\"failed\"). */
  lastStatus?: WorkerStatus;
  /** Tail slices of captured stderr / assistant output (marker scan window). */
  stderrTail?: string;
  outputTail?: string;
}

/**
 * Full classifier → WorkerFailureKind. Precedence (most-specific first):
 *   timeout(timedOut) > still-blocked→permission_denied > auth > rate_limit >
 *   network > context_window > crash > unknown.
 *
 * An explicit timeout trip is authoritative; a worker that exits still BLOCKED
 * on a grant never got permission; auth beats the transient/throttle kinds
 * (a rejected key looks like a network error to some stacks); the transient
 * markers scan only the tail; a non-zero exit before any assistant output is a
 * boot crash; anything else is honestly \"unknown\" — never guess.
 */
export function classifyFailureKind(s: FailureSignals): WorkerFailureKind {
  if (s.timedOut) return "timeout";
  const last = s.lastStatus ?? "spawning";
  if (last === "trust_required" || last === "tool_permission") return "permission_denied";
  const tail = `${s.stderrTail ?? ""}\n${s.outputTail ?? ""}`;
  if (AUTH_MARKERS.some((re) => re.test(tail))) return "auth";
  if (TIMEOUT_MARKERS.some((re) => re.test(tail))) return "timeout";
  if (RATE_LIMIT_MARKERS.some((re) => re.test(tail))) return "rate_limit";
  if (NETWORK_MARKERS.some((re) => re.test(tail))) return "network";
  if (CONTEXT_WINDOW_MARKERS.some((re) => re.test(tail))) return "context_window";
  if (typeof s.exitCode === "number" && s.exitCode !== 0 && last !== "working" && !tail.trim()) {
    return "crash";
  }
  return "unknown";
}
