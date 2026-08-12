/**
 * ithacus-control.ts — live dispatch control core (Sprint 5.28,
 * docs/SPRINT_5_28_LIVE_DISPATCH_CONTROL.md §4).
 *
 * Module-level ACTIVE-DISPATCH REGISTRY (source of truth for what is
 * live/paused, with config + tail) + `controlDispatch(verb, id, params)` —
 * the eight control families: pause / resume(+start) / stop / restart / retry /
 * cancel / swap_model / swap_agent / add_agent (split_task). The `/ithacus-ctrl`
 * slash command AND the INTERNAL `ithacus-control` MCP tool are thin wrappers
 * over this core (one code path, one audit trail).
 *
 * Kill (§4.1): spawnAgent never exposes the ChildProcess — only an AbortSignal
 * (SIGTERM → SIGKILL after 5s). So the registry keys each dispatch on an
 * **AbortController**; controlDispatch aborts it and the awaited child dies
 * with error "aborted". PREVENT-ITH-004: zero network, no subprocess spawn
 * here — AbortController + the already-audited spawnAgent only.
 */

import type { SpawnAgentOpts } from "./ithacus-spawn.js";
import type { DispatchResilienceOpts, ResilienceResult } from "./ithacus-retry.js";
import { dispatchWithResilience } from "./ithacus-retry.js";
import {
  startLive, endLive, setWorkerStatus, getLive, parseJsonlLine, updateLive,
  pauseLive, toLiveProgress, snapshotLiveProgress,
} from "./ithacus-live.js";
import { mapEventToStatus } from "../src/worker-status.js";
import { buildContinuationSummary, type LiveProgress } from "../src/auto-compact.js";
import { writeDispatchCompletion } from "./ithacus-completion.js";
import { discoverIthacusAgents, findAgent } from "./ithacus-agents.js";
import { resolveRetryPolicy, resolveModelFallbackChain } from "../src/team.js";
import { loadConfig } from "../src/config.js";
import type { IthacusConfig } from "../src/config.js";
import type { IthRuntime } from "./ithacus-runtime.js";
// Public types (§4.1)
export type ControlVerb =
  | "pause" | "resume" | "start" | "stop" | "restart" | "retry"
  | "cancel" | "swap_model" | "swap_agent" | "add_agent" | "split_task";

export interface ControlParams {
  model?: string;
  provider?: string;      // swap_model
  agent?: string;         // swap_agent / split
  task?: string;          // add_agent/split_task: the sub-task prompt
  keepOriginal?: boolean; // split: keep original running (default true)
}

export interface ActiveDispatch {
  dispatchId: string;
  parentDispatchId?: string;       // set only for split children
  agent: string;
  task: string;                    // ORIGINAL task (never the compacted one)
  model?: string;
  provider?: string;
  cwd?: string;
  tools?: string[];
  abort: AbortController;      // kill handle for the CURRENT child
  phase: "live" | "paused" | "terminating" | "done";
  terminal?: "stopped" | "cancelled"; // set when phase → terminating
  liveSnapshot: LiveProgress | null;    // captured at pause (survives removeLive)
  resumedFrom?: string;                 // prior dispatchId if swap/resume child
  createdAt: number;
  updatedAt: number;
  log: ControlAction[];                 // in-memory audit trail
  /** spawn generation — execute() compares pre-spawn vs post-await to detect a
   *  superseding control respawn (§4.5 race guard). */
  spawnCount: number;
}

export interface ControlAction {
  verb: ControlVerb; dispatchId: string; at: number;
  actor: string;                       // "user" | agent id | "system"
  fromAgent?: string; fromModel?: string; toAgent?: string; toModel?: string;
  continuation?: boolean;              // built a continuation summary
  spawnedDispatchId?: string;          // for split (new child)
  result: "ok" | "no-op" | "error";
  reason?: string; error?: string;
}

export interface ControlEmitDetails {
  agent: string; exitCode: number; durationMs: number; success: boolean;
  model?: string; provider?: string;
}
export type ControlEmit = (text: string, details: ControlEmitDetails) => void;
const noopEmit: ControlEmit = () => {};
/** Module-level active-dispatch registry (singleton — same pi process, no IPC). */
export class DispatchRegistry {
  private m = new Map<string, ActiveDispatch>();
  register(d: ActiveDispatch): void { this.m.set(d.dispatchId, d); }
  get(id: string): ActiveDispatch | undefined { return this.m.get(id); }
  list(): ActiveDispatch[] { return [...this.m.values()]; }
  deregister(id: string): void { this.m.delete(id); }
  /** TTL guard (R5): drop paused entries older than ttlMs (default 24h). */
  reapStale(now: number, ttlMs: number): void {
    for (const [id, d] of [...this.m]) {
      if (d.phase === "paused" && now - d.updatedAt > ttlMs) this.m.delete(id);
    }
  }
}
export const dispatchRegistry = new DispatchRegistry();

/** Global policy/chain defaults for control respawns. */
function controlResiliencePolicy(runtime?: IthRuntime) {
  return {
    config: runtime?.config ?? loadConfig(),
    policy: resolveRetryPolicy(runtime?.config.retryPolicy),
    chain: resolveModelFallbackChain({
      configFallback: runtime?.config.modelFallbackChain,
      maxHops: runtime?.config.maxFallbackHops,
    }),
  };
}

// Shared child live/status pipeline (§4.3)

/**
 * onProgress pipeline used by BOTH the dispatch tool's execute() and the
 * control respawns: rawJsonLine → parseJsonlLine → updateLive →
 * mapEventToStatus → setWorkerStatus (+ flat-text fallback via emit). Keeps
 * the live store, event bus and card coherent for any spawned child.
 */
export function childOnProgress(opts: {
  dispatchId: string; agent: string; model?: string; provider?: string;
  startTime: number; emit?: ControlEmit;
}): SpawnAgentOpts["onProgress"] {
  const emit = opts.emit ?? noopEmit;
  return (info) => {
    if (info.rawJsonLine) {
      const event = parseJsonlLine(info.rawJsonLine);
      if (event) updateLive(opts.dispatchId, event, opts.startTime);
      try {
        const prev = getLive(opts.dispatchId)?.status ?? "spawning";
        const next = mapEventToStatus(info.rawJsonLine, prev);
        if (next !== prev) {
          setWorkerStatus(opts.dispatchId, next);
          const phaseNote =
            next === "trust_required" ? "  🔒 blocked: workspace-trust confirmation required"
            : next === "tool_permission" ? "  🔑 blocked: tool-permission grant pending"
            : next === "ready_for_prompt" ? "  › sub-agent up, prompt queued…"
            : null;
          if (phaseNote) {
            emit(`ithacus — ${opts.agent}${info.model ? ` · ${info.model}` : ""}\n${phaseNote}`, {
              agent: opts.agent, exitCode: -1, durationMs: 0, success: false, model: info.model ?? opts.model, provider: opts.provider,
            });
          }
        }
      } catch { /* status detection is best-effort — the stream wins */ }
    }
    if (info.phase === "json") return;
    const modelTag = info.model ? ` · ${info.model}` : "";
    const line = info.phase === "tool" ? `  → ${info.text}`
      : info.phase === "text" ? `  … ${info.text.slice(-200)}`
      : info.phase === "message_end" ? "  ✓ done"
      : "  · " + info.phase;
    const act = { agent: opts.agent, exitCode: -1, durationMs: 0, success: false, model: info.model ?? opts.model, provider: opts.provider };
    emit(`ithacus — ${opts.agent}${modelTag}\n${line}`, act);
  };
}

// Shared controlled-child runner (§4.3) — used by control respawns

export interface ControlledChildOpts {
  dispatchId: string; agent: string; task: string;
  model?: string; provider?: string; cwd?: string; tools?: string[];
  signal: AbortSignal; runtime?: IthRuntime; startTime?: number; emit?: ControlEmit;
  spawnImpl?: SpawnAgentOpts["spawnImpl"];
  config?: IthacusConfig;
  policy?: DispatchResilienceOpts["policy"];
  chain?: DispatchResilienceOpts["chain"];
}

export async function runControlledChild(opts: ControlledChildOpts): Promise<ResilienceResult> {
  const startTime = opts.startTime ?? Date.now();
  const c = opts.config
    ? {
        config: opts.config,
        policy: opts.policy ?? resolveRetryPolicy(opts.config.retryPolicy),
        chain: opts.chain ?? resolveModelFallbackChain({ configFallback: opts.config.modelFallbackChain, maxHops: opts.config.maxFallbackHops }),
      }
    : controlResiliencePolicy(opts.runtime);
  return dispatchWithResilience({
    dispatchId: opts.dispatchId, agent: opts.agent, task: opts.task,
    model: opts.model, provider: opts.provider, cwd: opts.cwd, tools: opts.tools,
    signal: opts.signal, runtime: opts.runtime,
    config: c.config, policy: opts.policy ?? c.policy, chain: opts.chain ?? c.chain,
    toLiveProgress: (id) => toLiveProgress(getLive(id)),
    onProgress: childOnProgress({
      dispatchId: opts.dispatchId, agent: opts.agent, model: opts.model,
      provider: opts.provider, startTime, emit: opts.emit,
    }),
    spawnImpl: opts.spawnImpl,
  });
}

/** A usable empty LiveProgress fallback when no live snapshot was captured. */
function emptyProgress(d: ActiveDispatch): LiveProgress {
  return {
    agent: d.agent, model: d.model,
    recentTools: [], toolCallCount: 0, tokensIn: 0, tokensOut: 0, filesAccessed: [],
  };
}

/** Build the continuation summary for this dispatch (resume/retry/swap). */
function continuationFor(d: ActiveDispatch, runtime?: IthRuntime): string {
  return buildContinuationSummary({
    live: d.liveSnapshot ?? snapshotLiveProgress(d.dispatchId) ?? emptyProgress(d),
    originalTask: d.task,
    keepRecent: runtime?.config.preserveRecent,
  });
}

// controlDispatch (§4.2)

export interface ControlCtx { runtime?: IthRuntime; spawnImpl?: SpawnAgentOpts["spawnImpl"]; }

/** Perform a control verb over a live/paused dispatch. @returns the audit record. */
export async function controlDispatch(
  verb: ControlVerb,
  dispatchId: string,
  params?: ControlParams,
  ctx?: ControlCtx,
): Promise<ControlAction> {
  const runtime = ctx?.runtime;
  const t = Date.now();
  const d = dispatchRegistry.get(dispatchId);
  const actor = process.env.ITHACUS_AGENT_ID ?? "user";

  // Build the audit record (pushed onto the dispatch log + events.log).
  const audit = (fields: Partial<ControlAction> & { result: ControlAction["result"] }): ControlAction => {
    const action: ControlAction = { verb, dispatchId, at: t, actor, ...fields };
    if (d) { d.log.push(action); d.updatedAt = t; }
    if (runtime) {
      try { runtime.bindRepo(d?.cwd); } catch { /* best-effort */ }
      runtime.appendEvent("dispatch_control", {
        verb, dispatchId, actor,
        fromAgent: action.fromAgent, fromModel: action.fromModel,
        toAgent: action.toAgent, toModel: action.toModel,
        continuation: action.continuation, spawnedDispatchId: action.spawnedDispatchId,
        result: action.result, reason: action.reason, error: action.error,
      });
    }
    return action;
  };

  if (!d) return audit({ result: "error", reason: "dispatch not active" });
  const fromAgent = d.agent;
  const fromModel = d.model;

  // terminate: abort + mark terminating; the awaiting execute() does the teardown
  if (verb === "stop" || verb === "cancel") {
    if (d.phase === "terminating" || d.phase === "done") return audit({ result: "no-op", reason: `already ${d.terminal ?? d.phase}` });
    d.abort.abort();
    d.phase = "terminating";
    d.terminal = verb === "stop" ? "stopped" : "cancelled";
    setWorkerStatus(dispatchId, "stopping");
    return audit({ result: "ok", fromAgent, fromModel, reason: `${verb} initiated` });
  }
  if (d.phase === "done" || d.phase === "terminating") {
    return audit({ result: "no-op", reason: `dispatch already ${d.terminal ?? d.phase}` });
  }

  if (verb === "pause") {
    if (d.phase === "paused") return audit({ result: "no-op", reason: "already paused" });
    d.abort.abort();
    d.liveSnapshot = snapshotLiveProgress(dispatchId) ?? d.liveSnapshot;
    d.phase = "paused";
    pauseLive(dispatchId); // status "paused" (card shows ⏸, NOT ❌)
    return audit({ result: "ok", fromAgent, fromModel, reason: "child aborted, tail preserved" });
  }

  // resume/start: only from paused
  if (verb === "resume" || verb === "start") {
    if (d.phase !== "paused") return audit({ result: "no-op", reason: "dispatch is not paused" });
    return respawnFrom(d, continuationFor(d, runtime), {
      verb, fromAgent, fromModel, continuation: true, runtime, ctx, audit,
    });
  }
  // restart: clean slate, original task verbatim, same config
  if (verb === "restart") {
    return respawnFrom(d, d.task, {
      verb, fromAgent, fromModel, continuation: false, runtime, ctx, audit,
    });
  }

  // retry: like resume but allowed from live too (abort then respawn)
  if (verb === "retry") {
    return respawnFrom(d, continuationFor(d, runtime), {
      verb, fromAgent, fromModel, continuation: true, runtime, ctx, audit,
    });
  }

  // swap_model / swap_agent: kill + respawn with different config + summary
  if (verb === "swap_model") {
    if (!params?.model) return audit({ result: "error", reason: "swap_model requires params.model" });
    d.model = params.model;
    if (params.provider) d.provider = params.provider;
    return respawnFrom(d, continuationFor(d, runtime), {
      verb, fromAgent, fromModel, toModel: params.model, continuation: true, runtime, ctx, audit,
    });
  }
  if (verb === "swap_agent") {
    if (!params?.agent) return audit({ result: "error", reason: "swap_agent requires params.agent" });
    const agents = discoverIthacusAgents();
    const target = findAgent(agents, params.agent);
    if (!target) return audit({ result: "error", reason: `unknown agent: ${params.agent}` });
    d.agent = target.name;
    return respawnFrom(d, continuationFor(d, runtime), {
      verb, fromAgent, fromModel, toAgent: target.name, continuation: true, runtime, ctx, audit,
    });
  }

  // add_agent / split_task: fan out a NEW dispatch (new dispatchId)
  if (verb === "add_agent" || verb === "split_task") {
    const agents = discoverIthacusAgents();
    const agentName = params?.agent ?? d.agent;
    const target = findAgent(agents, agentName);
    if (!target) return audit({ result: "error", reason: `unknown agent: ${agentName}` });
    if (!params?.task?.trim()) return audit({ result: "error", reason: "split_task requires params.task (the sub-task)" });
    const newId = `${dispatchId}-split-${Date.now()}`;
    dispatchRegistry.register({
      dispatchId: newId, parentDispatchId: dispatchId, agent: target.name,
      task: params.task, model: d.model, provider: d.provider, cwd: d.cwd, tools: d.tools,
      abort: new AbortController(), phase: "live", liveSnapshot: null, log: [],
      createdAt: t, updatedAt: t, spawnCount: 1,
    });
    if (params.keepOriginal === false) {
      d.abort.abort();
      d.liveSnapshot = snapshotLiveProgress(dispatchId) ?? d.liveSnapshot;
      d.phase = "paused";
      pauseLive(dispatchId);
    }
    const startTime = Date.now();
    const childId = dispatchRegistry.get(newId);
    startLive(newId, target.name, d.model, params.task.slice(0, 80), 0, 0);
    runtime?.dispatchStarted(target.name);
    const res = await runControlledChild({
      dispatchId: newId, agent: target.name, task: params.task,
      model: d.model, provider: d.provider, cwd: d.cwd, tools: d.tools,
      signal: childId?.abort.signal ?? new AbortController().signal,
      runtime, startTime, spawnImpl: ctx?.spawnImpl,
    });
    finalizeDispatch(res, newId, d, startTime, runtime, target.name, { parentDispatchId: dispatchId });
    return audit({ result: "ok", fromAgent, fromModel, toAgent: target.name, spawnedDispatchId: newId, reason: `split → ${newId}` });
  }

  return audit({ result: "error", reason: `unknown verb: ${verb}` });
}

/** Terminal finalize shared by split + respawn paths (§4.4). */
function finalizeDispatch(
  r: ResilienceResult, dispatchId: string, par: ActiveDispatch, startTime: number,
  runtime: IthRuntime | undefined, agentType: string,
  extra: { parentDispatchId?: string; controls?: ControlAction[] },
) {
  endLive(dispatchId, r.result.success ?? false, r.result.error, {
    exitCode: r.result.exitCode,
    stderrTail: r.result.stderr ? r.result.stderr.slice(-512) : undefined,
    outputTail: r.result.output ? r.result.output.slice(-512) : undefined,
  });
  writeDispatchCompletion(runtime, {
    cwd: par.cwd, dispatchId, agentType, res: r.result,
    startTime, task: par.task, paramsModel: par.model, paramsProvider: par.provider,
    parentDispatchId: extra.parentDispatchId, retryMeta: r.attempts, controls: extra.controls,
  });
  dispatchRegistry.deregister(dispatchId);
  runtime?.dispatchEnded(agentType);
}

/** Kill current child (if any), bump spawn gen, and respawn a fresh child
 *  (same dispatchId, new task/config); awaits it then finalizes. */
async function respawnFrom(
  d: ActiveDispatch,
  task: string,
  opts: {
    verb: ControlVerb; fromAgent?: string; fromModel?: string; toAgent?: string; toModel?: string;
    continuation: boolean; runtime?: IthRuntime; ctx?: ControlCtx;
    audit: (fields: Partial<ControlAction> & { result: ControlAction["result"] }) => ControlAction;
  },
): Promise<ControlAction> {
  const t = Date.now();
  d.abort.abort();
  const childAbort = new AbortController();
  d.abort = childAbort;
  d.spawnCount++;                 // execute() detects the superseded child
  d.phase = "live";
  d.updatedAt = t;
  setWorkerStatus(d.dispatchId, "spawning");
  const startTime = Date.now();
  const res = await runControlledChild({
    dispatchId: d.dispatchId, agent: d.agent, task,
    model: d.model, provider: d.provider, cwd: d.cwd, tools: d.tools,
    signal: childAbort.signal, runtime: opts.runtime, startTime, spawnImpl: opts.ctx?.spawnImpl,
  });
  finalizeDispatch(res, d.dispatchId, d, startTime, opts.runtime, d.agent, { controls: d.log });
  return opts.audit({
    fromAgent: opts.fromAgent, fromModel: opts.fromModel,
    toAgent: opts.toAgent, toModel: opts.toModel,
    continuation: opts.continuation, result: "ok", reason: "respawned",
  });
}
