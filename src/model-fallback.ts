/**
 * src/model-fallback.ts — failure-aware fallback routing (Sprint 5.17,
 * PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §2.3 / §4.6).
 *
 * Given the classified failure `kind`, the ordered ModelFallbackChain, and the
 * retry policy, `routeFallback` decides the NEXT action for a failed attempt:
 *   - compact_retry_same  → backoff + SAME model, rebuild compacted task (or
 *                           just a transient backoff for non-context kinds);
 *   - advance             → swap model/provider to a later hop (failure-class
 *                           aware — context_window prefers a "big-window" hop,
 *                           rate_limit prefers a different provider);
 *   - stop                → exhausted / non-retriable, do not retry.
 *
 * Holds the routing table + chain helpers. The chain *resolution*
 * (resolveModelFallbackChain) lives in team.ts; the *type* in src/types.ts.
 * Calling shouldRetry first (src/retry.ts) bounds retries on maxRetries; this
 * module further bounds on chain.maxHops and returns stop when exhausted.
 *
 * Pure + pi-agnostic, zero deps, zero network (PREVENT-ITH-004).
 */

import type {
  ModelFallbackChain,
  ModelFallbackHop,
  RetryPolicy,
  WorkerFailureKind,
} from "./types.js";

/** The concrete next action for a failed attempt. */
export type FallbackAction =
  | { type: "compact_retry_same"; reason: string }   // transient: backoff + SAME model (+ rebuild compacted task for context_window)
  | { type: "advance"; hop: ModelFallbackHop; reason: string } // swap model/provider (per failure class)
  | { type: "stop"; reason: string };                // exhausted / non-retriable

export interface RouteFallbackOpts {
  kind: WorkerFailureKind;
  chain: ModelFallbackChain;
  /** Index of the model that just failed (0 = primary). */
  currentHopIndex: number;
  /** Attempts already made (0-based). */
  attempt: number;
  policy: RetryPolicy;
}

/** Pick the next hop index for a failure class. Prefers a hop tagged with the
 *  relevant hint; otherwise falls through to the immediate next hop. Returns
 *  -1 when there is no usable next hop (chain exhausted). */
function nextHopIndex(
  chain: ModelFallbackChain,
  currentHopIndex: number,
  kind: WorkerFailureKind,
): number {
  const rest = chain.hops.slice(currentHopIndex + 1);

  if (kind === "context_window") {
    // Prefer a later hop tagged "big-window"; else the next hop.
    const big = rest.findIndex((h) => h.tags?.includes("big-window"));
    if (big >= 0) return currentHopIndex + 1 + big;
    return rest.length > 0 ? currentHopIndex + 1 : -1;
  }

  if (kind === "rate_limit") {
    // Prefer a later hop on a DIFFERENT provider (throttling is provider-bound);
    // else fall through to the next hop.
    const current = chain.hops[currentHopIndex];
    const diff = rest.findIndex(
      (h) => (h.provider ?? h.model.split("/")[0]) !== (current.provider ?? current.model.split("/")[0]),
    );
    return diff >= 0 ? currentHopIndex + 1 + diff : (rest.length > 0 ? currentHopIndex + 1 : -1);
  }

  // auth / fallback: skip to the next hop.
  return rest.length > 0 ? currentHopIndex + 1 : -1;
}

/**
 * Route a failed attempt to its next action per the routing table
 * (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §2.3). The caller checks
 * `shouldRetry` FIRST; here we additionally require the chain has an unused
 * hop for the advance-style classes, else return stop.
 */
export function routeFallback(opts: RouteFallbackOpts): FallbackAction {
  const { kind, chain, currentHopIndex, attempt, policy } = opts;

  const exhausted = attempt >= (policy.maxRetries + 1) || currentHopIndex >= chain.maxHops;

  switch (kind) {
    case "permission_denied":
      return { type: "stop", reason: "permission_denied: interactive grant required" };
    case "unknown":
      return { type: "stop", reason: "unknown: no retry" };
    case "context_window": {
      const next = nextHopIndex(chain, currentHopIndex, "context_window");
      if (exhausted || next < 0) {
        return { type: "stop", reason: "context_window: no larger-window fallback" };
      }
      const hop = chain.hops[next];
      return { type: "advance", hop, reason: "context_window: bigger-window model" };
    }
    case "rate_limit": {
      const next = nextHopIndex(chain, currentHopIndex, "rate_limit");
      if (exhausted) return { type: "stop", reason: "rate_limit: retries exhausted" };
      if (next >= 0) {
        return { type: "advance", hop: chain.hops[next], reason: "rate_limit: different provider" };
      }
      return { type: "compact_retry_same", reason: "rate_limit: backing off" };
    }
    case "network":
      return { type: "compact_retry_same", reason: "network: transient, backing off" };
    case "timeout":
      return { type: "compact_retry_same", reason: "timeout: backoff retry" };
    case "crash": {
      if (!policy.on.includes("crash")) {
        return { type: "stop", reason: "crash: not in retry policy" };
      }
      return { type: "compact_retry_same", reason: "crash: fresh respawn" };
    }
    default:
      return { type: "stop", reason: `${kind}: no retry` };
  }
}

/** Convenience: does the chain contain another hop at all after the current? */
export function hasNextHop(chain: ModelFallbackChain, currentHopIndex: number): boolean {
  return currentHopIndex < chain.hops.length - 1;
}
