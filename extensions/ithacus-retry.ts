/**
 * extensions/ithacus-retry.ts — shared resilient spawn loop (Sprint 5.17,
 * PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §6.1).
 *
 * `dispatchWithResilience` is the single canonical recovery loop for a
 * dispatched (or team/swarm) sub-agent: on a failed child it applies
 *   A — auto-compact (context_window → rebuild compacted continuation from
 *       durable state, fresh child, NEVER reuse the failed child's session);
 *   B — bounded backoff retry (rate_limit/network/timeout → same model, exp.
 *       backoff; the sleep lives HERE, not in src/ — G7);
 *   C — model fallback chain (#54, per-agent + global, failure-class-aware
 *       routing via routeFallback, capped at maxHops).
 * Every hop is audited (ith_events via runtime.appendEvent + ith_retries via
 * runtime.store) and the overlay stays coherent on ONE stable dispatchId
 * (markRetry flips the same card to ↻ retrying (attempt n/N)).
 *
 * PREVENT-ITH-004 / PREVENT-PI-004: this module makes ZERO network calls — it
 * only orchestrates the already-audited local `spawnAgent` (whose spawn line
 * carries the `// guardrails-allow` annotation in ithacus-spawn.ts). `sleep`
 * is timers, not network.
 */
import { spawnAgent } from "./ithacus-spawn.js";
import type { SpawnAgentOpts, SpawnAgentResult } from "./ithacus-spawn.js";
import { setWorkerStatus, markRetry, getLive } from "./ithacus-live.js";
import type { IthRuntime } from "./ithacus-runtime.js";
import type { IthacusConfig } from "../src/config.js";
import type { ModelFallbackChain, RetryPolicy } from "../src/types.js";
import { shouldRetry, computeBackoff } from "../src/retry.js";
import { DEFAULT_BACKOFF } from "../src/team.js";
import { routeFallback, type FallbackAction } from "../src/model-fallback.js";
import { buildContinuationSummary, type LiveProgress } from "../src/auto-compact.js";
import { classifyFailureKind } from "../src/failure-kind.js";
export interface RetryHopRecord {
  index: number;
  kind: string;
  action: FallbackAction["type"];
  fromModel?: string;
  fromProvider?: string;
  toModel?: string;
  toProvider?: string;
  reason: string;
  compacted: boolean;
  success: boolean;
  durationMs: number;
}
export interface DispatchResilienceOpts {
  dispatchId: string;
  agent: string;
  task: string;                       // ORIGINAL task kept across attempts
  model?: string;
  provider?: string;
  cwd?: string;
  tools?: string[];
  signal?: AbortSignal;
  onProgress?: SpawnAgentOpts["onProgress"];
  runtime?: IthRuntime;
  config: IthacusConfig;
  chain: ModelFallbackChain;
  policy: RetryPolicy;
  /** adapter live store → src LiveProgress (passed in to keep src/ agnostic). */
  toLiveProgress: (id: string) => LiveProgress | undefined;
  /** Test seam: inject a fake spawn (passed through to spawnAgent). */
  spawnImpl?: SpawnAgentOpts["spawnImpl"];
}
export interface ResilienceResult {
  result: SpawnAgentResult;
  attempts: RetryHopRecord[];
  totalAttempts: number;
  finalModel?: string;
  finalProvider?: string;
}
/** AbortSignal-aware sleep (timers live HERE, not in src/ — G7). Rejects on
 *  abort so the loop stops promptly instead of blocking cancellation. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = (): void => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
/** Resolve a provider pin from a model's provider/ prefix, if present. */
function resolveProviderPrefix(model: string): string | undefined {
  const idx = model.indexOf("/");
  return idx > 0 ? model.slice(0, idx) : undefined;
}
/** Compute the next hop index by failure class (mirrors model-fallback's
 *  preference; advance always lands on a real hop here). */
function nextHopIndex(
  chain: ModelFallbackChain,
  currentHopIndex: number,
  kind: string,
): number {
  const rest = chain.hops.slice(currentHopIndex + 1);
  if (kind === "context_window") {
    const big = rest.findIndex((h) => h.tags?.includes("big-window"));
    if (big >= 0) return currentHopIndex + 1 + big;
  }
  if (kind === "rate_limit") {
    const current = chain.hops[currentHopIndex];
    const curProv = current.provider ?? current.model.split("/")[0];
    const diff = rest.findIndex(
      (h) => (h.provider ?? h.model.split("/")[0]) !== curProv,
    );
    if (diff >= 0) return currentHopIndex + 1 + diff;
  }
  return rest.length > 0 ? currentHopIndex + 1 : -1;
}
/**
 * Realize a `compact_retry_same` action: apply the backoff sleep (for transient
 * kinds) and, for context_window, rebuild the compacted task from durable state
 * (LiveProgress + originalTask — ITH-003 text, never a system role).
 */
async function realizeCompactRetry(
  opts: DispatchResilienceOpts,
  kind: string,
  attempt: number,
  baseTask: string,
): Promise<{ task: string; compacted: boolean }> {
  let task = baseTask;
  let compacted = false;
  if (kind === "context_window") {
    const live = opts.toLiveProgress(opts.dispatchId);
    if (live && typeof live.agent === "string") {
      task = buildContinuationSummary({
        live,
        originalTask: opts.task,
        keepRecent: opts.config.preserveRecent,
      });
      compacted = true;
    }
  } else {
    // rate_limit / network / timeout (and crash): transient — sleep first.
    const backoff = computeBackoff(opts.policy.backoff ?? DEFAULT_BACKOFF, attempt);
    await sleep(backoff, opts.signal);
  }
  return { task, compacted };
}
/** Audit one retry/fallback hop: events.log (dispatch_retry/model_fallback) +
 *  ith_retries table + the completion record the loop carries. */
function auditRetry(
  opts: DispatchResilienceOpts,
  rec: {
    attempt: number;
    kind: string;
    action: FallbackAction["type"];
    fromModel?: string;
    fromProvider?: string;
    toModel?: string;
    toProvider?: string;
    reason: string;
    compacted: boolean;
    startedAt: number;
    durationMs: number;
  },
): void {
  const base = {
    dispatchId: opts.dispatchId,
    agent: opts.agent,
    attempt: rec.attempt,
    kind: rec.kind,
    action: rec.action === "compact_retry_same" ? "compact" : rec.action === "advance" ? "fallback" : "backoff",
    fromModel: rec.fromModel,
    fromProvider: rec.fromProvider,
    toModel: rec.toModel,
    toProvider: rec.toProvider,
    reason: rec.reason,
    compacted: rec.compacted,
  };
  opts.runtime?.appendEvent("dispatch_retry", base);
  if (rec.action === "advance") {
    opts.runtime?.appendEvent("model_fallback", {
      dispatchId: opts.dispatchId,
      agent: opts.agent,
      hop: rec.toModel,
      from: rec.fromModel,
      to: rec.toModel,
      kind: rec.kind,
      reason: rec.reason,
    });
  }
  try {
    opts.runtime?.store?.recordRetryAttempt({
      dispatchId: opts.dispatchId,
      agent: opts.agent,
      attempt: rec.attempt,
      failureKind: rec.kind,
      action: base.action,
      fromModel: rec.fromModel,
      toModel: rec.toModel,
      reason: rec.reason,
      compacted: rec.compacted,
      startedAt: rec.startedAt,
      durationMs: rec.durationMs,
      retryOf: 0,
    });
  } catch {
    /* store audit is best-effort — never breaks the loop */
  }
}
/**
 * Run one resilient dispatch: spawn a FRESH child per attempt, classify
 * failures, decide retry/fallback/compact via the pure src/ policies, and loop
 * until success, a stop, or the caps. The compacted prompt is rebuilt from
 * durable state + originalTask and passed as `task` text (never reusing the
 * failed child's session — claw-code PR #4 bug avoided).
 */
export async function dispatchWithResilience(
  opts: DispatchResilienceOpts,
): Promise<ResilienceResult> {
  let attempt = 0;
  let task = opts.task;
  let hopIndex = 0;
  let current = { model: opts.model, provider: opts.provider };
  const attempts: RetryHopRecord[] = [];
  const maxRetries = opts.policy.maxRetries;
  let res: SpawnAgentResult = await spawnAgent({
    agent: opts.agent,
    task,
    model: current.model,
    provider: current.provider,
    cwd: opts.cwd,
    tools: opts.tools,
    signal: opts.signal,
    onProgress: opts.onProgress,
    spawnImpl: opts.spawnImpl,
  });
  attempts.push({
    index: 0,
    kind: res.success ? "success" : "unknown",
    action: res.success ? "stop" : "stop",
    fromModel: current.model,
    fromProvider: current.provider,
    reason: res.success ? "success" : "first attempt failed",
    compacted: false,
    success: res.success,
    durationMs: res.durationMs,
  });
  while (!res.success) {
    // Sprint 5.28 (§4.4): a user-initiated abort (controlDispatch's
    // AbortController → SIGTERM/SIGKILL) must NEVER auto-resume via the 5.17
    // retry/auto-compact/fallback loop — pause dance again, stop stays dead.
    // Break out immediately; the dispatch execute()'s control-aware ending
    // performs the pause/stop/cancel teardown from the registry phase.
    if (opts.signal?.aborted) {
      attempts[attempts.length - 1].kind = "aborted";
      attempts[attempts.length - 1].reason = "aborted by control (pause/stop/cancel)";
      break;
    }
    const kind = classifyFailureKind({
      exitCode: res.exitCode,
      stderrTail: res.stderr ? res.stderr.slice(-512) : undefined,
      outputTail: res.output ? res.output.slice(-512) : undefined,
      lastStatus: getLive(opts.dispatchId)?.status,
    });
    if (!shouldRetry(kind, attempt, opts.policy)) {
      attempts[attempts.length - 1].kind = kind;
      break;
    }
    const action = routeFallback({
      kind,
      chain: opts.chain,
      currentHopIndex: hopIndex,
      attempt,
      policy: opts.policy,
    });
    if (action.type === "stop") {
      attempts[attempts.length - 1].kind = kind;
      attempts[attempts.length - 1].reason = action.reason;
      break;
    }
    // RETRY BRANCH — fresh child, durable-state rebuild.
    attempt++;
    setWorkerStatus(opts.dispatchId, "retrying");
    markRetry(opts.dispatchId, attempt, maxRetries);
    const hopStartedAt = Date.now();
    let nextModel = current.model;
    let nextProvider = current.provider;
    let compacted = false;
    let reason = action.reason;
    if (action.type === "advance") {
      const next = nextHopIndex(opts.chain, hopIndex, kind);
      if (next < 0) {
        attempts[attempts.length - 1].kind = kind;
        attempts[attempts.length - 1].reason = `${kind}: no usable fallback hop`;
        break;
      }
      hopIndex = next;
      const hop = opts.chain.hops[hopIndex];
      nextModel = hop.model;
      nextProvider = hop.provider ?? resolveProviderPrefix(hop.model);
    } else {
      // compact_retry_same
      let rebuilt: { task: string; compacted: boolean } = { task, compacted: false };
      try {
        rebuilt = await realizeCompactRetry(opts, kind, attempt, task);
        if (opts.signal?.aborted) {
          attempts[attempts.length - 1].kind = "aborted";
          attempts[attempts.length - 1].reason = "aborted by control";
          break;
        }
      } catch (e) {
        // realization's abort-aware sleep can reject on a user abort — treat
        // as control-abort (never let it throw out of the resilience loop).
        attempts[attempts.length - 1].kind = "aborted";
        attempts[attempts.length - 1].reason = e instanceof Error ? e.message : "aborted by control";
        break;
      }
      task = rebuilt.task;
      compacted = rebuilt.compacted;
    }

    const fromModel = current.model;
    const fromProvider = current.provider;
    auditRetry(opts, {
      attempt,
      kind,
      action: action.type,
      fromModel,
      fromProvider,
      toModel: nextModel,
      toProvider: nextProvider,
      reason,
      compacted,
      startedAt: hopStartedAt,
      durationMs: Date.now() - hopStartedAt,
    });

    current = { model: nextModel, provider: nextProvider };
    attempts[attempts.length - 1].kind = kind;
    attempts[attempts.length - 1].action = action.type;
    attempts[attempts.length - 1].reason = reason;
    attempts[attempts.length - 1].toModel = nextModel;
    attempts[attempts.length - 1].toProvider = nextProvider;
    attempts[attempts.length - 1].compacted = compacted;
    // Hard caps: attempt budget (1 + maxRetries) and distinct-model cap.
    if (attempt >= 1 + maxRetries) break;
    if (hopIndex >= opts.chain.maxHops) break;

    // Sprint 5.28-§4.4: re-check abort right before respawning a fresh child
    // so a just-issued pause/stop/cancel never starts a NEW child.
    if (opts.signal?.aborted) {
      attempts[attempts.length - 1].kind = "aborted";
      attempts[attempts.length - 1].reason = "aborted by control";
      break;
    }

    res = await spawnAgent({
      agent: opts.agent,
      task,
      model: current.model,
      provider: current.provider,
      cwd: opts.cwd,
      tools: opts.tools,
      signal: opts.signal,
      onProgress: opts.onProgress,
      spawnImpl: opts.spawnImpl,
    });
    attempts.push({
      index: attempt,
      kind: res.success ? "success" : "unknown",
      action: res.success ? "stop" : "stop",
      fromModel: current.model,
      fromProvider: current.provider,
      reason: res.success ? "success" : "attempt failed",
      compacted,
      success: res.success,
      durationMs: res.durationMs,
    });
  }

  opts.runtime?.appendEvent("dispatch_resolved", {
    dispatchId: opts.dispatchId,
    agent: opts.agent,
    success: res.success,
    totalAttempts: attempt + 1,
    finalModel: res.model ?? current.model,
    finalProvider: res.provider ?? current.provider,
    kinds: attempts.map((a) => a.kind),
  });

  return {
    result: res,
    attempts,
    totalAttempts: attempt + 1,
    finalModel: res.model ?? current.model,
    finalProvider: res.provider ?? current.provider,
  };
}
