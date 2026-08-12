/**
 * ithacus-dispatch.ts — the LLM-invoked entry point (`ithacus-dispatch` tool).
 *
 * Replaces the phantom `pi.callTool(name, args)` dispatch (never existed on
 * `ExtensionAPI`) with the canonical pi pattern from pi-subagents + pi's
 * example subagent extension: `pi.registerTool(ToolDefinition)` whose
 * `execute()` body spawns a real `pi` subprocess per agent.
 *
 * Sprint 5.13 (docs/DESIGN_LIVE_PROGRESS.md §3.3/§5): the subprocess layer
 * moved to extensions/ithacus-spawn.ts (spawnAgent + SpawnAgentOpts /
 * SpawnAgentResult + fmtDuration + the rawJsonLine pass-through) and the
 * static terminal-popup card class was replaced by the PERSISTENT
 * live-progress overlay (ithacus-live.ts store + ithacus-live-card.ts
 * component): shown at dispatch START, fed per event from the child's
 * `--mode json` stream (rawJsonLine → parseJsonlLine → updateLive), flipped
 * terminal via endLive + card.markDone() (3s auto-dismiss). Sprint 5.20
 * seam: the store publishes through the runtime's typed event bus, wired
 * here one time via wireLiveEventBus(runtime.eventBus). Sprint 5.14
 * (docs/DESIGN_WORKER_STATUS.md §2.2): every raw stream line ALSO runs
 * through the WorkerStatus machine (mapEventToStatus → setWorkerStatus) so
 * trust_required / tool_permission / ready_for_prompt reach the store, the
 * bus, the card, and the flat onUpdate fallback; endLive classifies the
 * WorkerFailureKind from the exit evidence instead of flooring at
 * "unknown".
 *
 * Exports:
 *   - re-export: spawnAgent (+ SpawnAgentOpts/SpawnAgentResult types) from
 *     ./ithacus-spawn.js — the export site stays stable so the existing
 *     dispatch sites (extensions/ithacus-team.ts, ithacus-swarm.ts — both
 *     `import { spawnAgent } from "./ithacus-dispatch.js"`) stay untouched.
 *   - registerDispatchTool(pi, runtime?): registers `ithacus-dispatch` — the
 *     LLM tool that invokes spawnAgent. This is the entry point the model
 *     calls.
 *
 * PREVENT-ITH-004 + PREVENT-PI-004: this file spawns nothing itself — the
 * local-subprocess spawn import + its audited guardrails-allow annotation
 * live in ithacus-spawn.ts. Zero network in this file.
 *
 * Mission made literal: each dispatch IS a different agent with a different
 * model, in an isolated context window.
 */

import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { spawnAgent, fmtDuration } from "./ithacus-spawn.js";
import {
  startLive,
  updateLive,
  endLive,
  parseJsonlLine,
  wireLiveEventBus,
  getLive,
  setWorkerStatus,
} from "./ithacus-live.js";
import {
  IthLiveCard,
  getLiveCardPreferredWidth,
  loadLiveCardWidthMode,
  loadLiveCardSize,
  loadLiveCardHidden,
  getLiveCardHidden,
} from "./ithacus-live-card.js";
import { mapEventToStatus } from "../src/worker-status.js";
import {
  resolveRetryPolicy,
  resolveModelFallbackChain,
} from "../src/team.js";
import type { LiveProgress } from "../src/auto-compact.js";
import { dispatchWithResilience } from "./ithacus-retry.js";
import type { ResilienceResult, RetryHopRecord } from "./ithacus-retry.js";
import type { IthRuntime } from "./ithacus-runtime.js";
import { loadConfig } from "../src/config.js";
import type { IthacusConfig } from "../src/config.js";
import { maybeShowFirstDispatchNotice } from "./ithacus-onboarding.js";
import { registerToolWithVisibility } from "./ithacus-tool-registry.js";
import { ToolVisibility } from "../src/tool-visibility.js";
import { resolvePermissions } from "../src/permissions.js";
import { applyTrustCeiling, trustFromSource } from "../src/extension-trust.js";
import { redactForAudit } from "../src/redact.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { discoverIthacusAgents, findAgent } from "./ithacus-agents.js";

// Compat re-export (Sprint 5.13 spawn-layer extraction): ithacus-team.ts:22
// and ithacus-swarm.ts:19 import spawnAgent from THIS module — keep the site
// stable now that the implementation lives in ithacus-spawn.ts.
export { spawnAgent };
export type { SpawnAgentOpts, SpawnAgentResult } from "./ithacus-spawn.js";

// Sprint 5.17 (§6.1): adapter from the extensions AgentLive store to the src/
// LiveProgress shape the durability compact-rebuild uses. Pi-agnostic (pure
// field mapping); keeps src/ auto-compact free of extension imports.
function liveToProgress(live: { agent: string; model?: string; recentTools: Array<{ tool: string; args: string }>; toolCallCount: number; tokensIn: number; tokensOut: number; filesAccessed: string[]; taskPreview?: string } | undefined): LiveProgress | undefined {
  if (!live) return undefined;
  return {
    agent: live.agent,
    model: live.model,
    recentTools: live.recentTools ?? [],
    toolCallCount: live.toolCallCount ?? 0,
    tokensIn: live.tokensIn ?? 0,
    tokensOut: live.tokensOut ?? 0,
    filesAccessed: live.filesAccessed ?? [],
    taskPreview: live.taskPreview,
  };
}

// ---------------------------------------------------------------------------
// registerDispatchTool — the LLM-invoked `ithacus-dispatch` tool
// ---------------------------------------------------------------------------

interface DispatchDetails {
  agent: string;
  exitCode: number;
  model?: string;
  provider?: string;
  providerSource?: string;
  durationMs: number;
  success: boolean;
}

/**
 * Write a completion summary to `<repo>/.pi/ithacus/dispatch-completions/<id>.json`
 * so every dispatch leaves a durable artifact (dispatch id, agent, status,
 * duration, tail of the transcript). Best-effort + non-fatal — a dispatch must
 * never fail because the audit trail could not be written. The filename is a
 * sanitized version of the pi tool-call id + timestamp. Zero network.
 *
 * The target dir is the RUNTIME's per-repo state dir (runtime.currentStateDir,
 * refreshed with a no-op-safe bindRepo), NOT a direct config import — keeps
 * this module's import graph free of src/config.ts (whose ./permissions.js
 * specifier the smoke-ext harness cannot remap). When there is no runtime
 * (headless/stub), the completion file is skipped (belt-and-braces only).
 */
function writeDispatchCompletion(runtime: IthRuntime | undefined, info: {
  cwd: string | undefined;
  dispatchId: string;
  agentType: string;
  res: { success: boolean; exitCode: number; durationMs: number; model?: string; provider?: string; output?: string; stderr?: string; error?: string } | undefined;
  startTime: number;
  task: string;
  paramsModel?: string;
  paramsProvider?: string;
  /** Sprint 5.17: per-attempt resilience record from dispatchWithResilience. */
  retryMeta?: RetryHopRecord[];
}): void {
  try {
    if (!runtime) return;
    runtime.bindRepo(info.cwd);
    const dir = join(runtime.currentStateDir, "dispatch-completions");
    mkdirSync(dir, { recursive: true });
    const safeId = info.dispatchId.replace(/[^A-Za-z0-9._-]/g, "_");
    const res = info.res;
    writeFileSync(
      join(dir, `${safeId}.json`),
      JSON.stringify(
        {
          dispatchId: info.dispatchId,
          agent: info.agentType,
          status: res?.success ? "success" : "failed",
          exitCode: res?.exitCode ?? 1,
          durationMs: res?.durationMs ?? Date.now() - info.startTime,
          startedAt: new Date(info.startTime).toISOString(),
          finishedAt: new Date().toISOString(),
          model: res?.model ?? info.paramsModel,
          provider: res?.provider ?? info.paramsProvider,
          error: res?.error,
          task: info.task.slice(0, 200),
          outputTail: res?.output ? res.output.slice(-2000) : undefined,
          stderrTail: res?.stderr ? res.stderr.slice(-500) : undefined,
          // Sprint 5.17: resilience audit trail for Fleet/audit surfaces.
          ...(info.retryMeta && info.retryMeta.length > 0
            ? { retries: info.retryMeta.map((a) => ({
                attempt: a.index,
                kind: a.kind,
                action: a.action,
                fromModel: a.fromModel,
                toModel: a.toModel,
                reason: a.reason,
                compacted: a.compacted,
                success: a.success,
              })) }
            : {}),
        },
        null,
        2,
      ),
    );
  } catch {
    /* non-fatal */
  }
}

const DispatchParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      description:
        'ithacus agent role: "explore", "plan", "verification", or "reviewer". Defaults to "explore".',
    }),
  ),
  task: Type.String({ description: "Task for the sub-agent." }),
  model: Type.Optional(
    Type.String({ description: "Per-agent model override (different models per child). Accepts a bare id (`claude-haiku-4-5`) or a provider-prefixed id (`plexus/claude-mythos-5`)." }),
  ),
  provider: Type.Optional(
    Type.String({
      description:
        "Per-dispatch provider override (e.g. 'plexus'). When unset, the provider is resolved from the model id prefix, the agent's frontmatter `provider:`, or pi-setup's config. If none resolves, dispatch fast-fails with a hint to run /setup.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the child pi process." }),
  ),
  // Sprint 5.15 (DESIGN_PERMISSION_MODES.md §2.3): the per-dispatch override
  // channel — highest-precedence permission input at the spawn boundary.
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Per-dispatch tool allowlist override (Sprint 5.15): merged on top of the agent's declared permission mode as an additive allow — the agent's deny list still wins, and the trust ceiling still clamps low-source agents.",
    }),
  ),
});

/**
 * Register the `ithacus-dispatch` tool. The LLM invokes this to spawn a
 * coordinated ithacus sub-agent (real pi subprocess, isolated context,
 * per-agent model). ithacus's existing team/swarm orchestration in src/ drives
 * the dispatch loop; this tool is the single LLM entry point.
 */
export function registerDispatchTool(pi: ExtensionAPI, runtime?: IthRuntime): void {
  // Sprint 5.20 seam (DESIGN_EVENT_STREAM.md §2.3 / ithacus-live.ts): the
  // live store publishes every update through the runtime's singleton typed
  // event bus — one event stream, many views (5.12 dashboard, 5.14 status,
  // fleet views subscribe later without touching producers).
  if (runtime) wireLiveEventBus(runtime.eventBus);
  // Sprint 5.13.1: sync the persisted live-card width pref (ith_kv
  // "live_card_width_mode") into the card module's widthMode at registration.
  // Sprint 5.13.1 + 5.27: sync the persisted live-card prefs (ith_kv
  // "live_card_width_mode", "card_size", "card_hidden") into the card module
  // at registration. Best-effort — a store-less runtime just keeps defaults.
  if (runtime?.store) {
    loadLiveCardWidthMode((k) => runtime.store.getKv(k));
    loadLiveCardSize((k) => runtime.store.getKv(k));
    loadLiveCardHidden((k) => runtime.store.getKv(k));
  }
  const tool: ToolDefinition<typeof DispatchParams, DispatchDetails> = {
    name: "ithacus-dispatch",
    label: "ithacus dispatch",
    description:
      "Dispatch a coordinated ithacus sub-agent — a real pi subprocess with an isolated context window and a per-agent model. " +
      'Roles: explore (fast read-only recon), plan (implementation planner), verification (feasibility + post-check), reviewer (senior code review).',
    parameters: DispatchParams,
    async execute(
      toolCallId: string,
      params: { agent?: string; task: string; model?: string; provider?: string; cwd?: string; tools?: string[] },
      signal: AbortSignal | undefined,
      onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details: DispatchDetails }) => void) | undefined,
      ctx: ExtensionContext,
    ) {
      // First-dispatch onboarding notice (one-shot, per-repo). Persisted in the
      // ith_kv store table via markOnboardingSeen(). Silent after the first
      // dispatch in a repo. Only fires when a runtime is wired (entry passes
      // it; the smoke harness calls registerDispatchTool without one).
      if (runtime) maybeShowFirstDispatchNotice(runtime);
      const agentType = params.agent ?? "explore";
      // Sprint 5.15 (DESIGN_PERMISSION_MODES.md §2.3): resolve + enforce the
      // agent's declared permission mode at the spawn boundary — the child pi
      // physically cannot call tools it wasn't given (--tools allowlist).
      // trustFromSource + applyTrustCeiling clamp low-source (project) agents
      // so they cannot self-escalate by declaring a higher mode in their own
      // file; redactForAudit keeps secrets out of the events.log record
      // (AGENT_GUARDRAILS NO SECRETS). Best-effort: the whole block is
      // failure-isolated — on any error effectiveTools stays undefined and
      // spawnAgent falls back to its own `opts.tools ?? agent.tools`
      // (permission resolution NEVER breaks dispatch).
      let effectiveTools: string[] | undefined;
      // Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §6.2): per-agent
      // retry + model-fallback resolution. Global defaults first, then the
      // agent's frontmatter override (agentCfg.retry / agentCfg.fallback);
      // consumed by the dispatch-with-resilience loop below. Best-effort —
      // on any error we keep the global defaults, never break dispatch.
      let retryPolicy = resolveRetryPolicy(runtime?.config.retryPolicy);
      let fallbackChain = resolveModelFallbackChain({
        primaryModel: params.model,
        primaryProvider: params.provider,
        configFallback: runtime?.config.modelFallbackChain,
        maxHops: runtime?.config.maxFallbackHops,
      });
      try {
        const agentCfg = findAgent(discoverIthacusAgents(), agentType);
        if (agentCfg) {
          const trust = trustFromSource(agentCfg.source);
          const resolved = resolvePermissions({
            declared: agentCfg.permissions ?? null,
            legacyTools: agentCfg.tools,
            override: params.tools ? { allow: params.tools } : undefined,
            defaultMode: runtime?.config.permissionModeDefault ?? "read_only",
            strict: runtime?.config.permissionStrict ?? false,
          });
          const effectiveMode = applyTrustCeiling(resolved.mode, trust);
          // A clamped mode re-resolves from the mode alone (dropping allow
          // extras) — the ceiling deliberately cannot carry escalations over.
          effectiveTools = effectiveMode === resolved.mode
            ? resolved.toolAllow
            : resolvePermissions({ declared: { mode: effectiveMode } }).toolAllow;
          runtime?.appendEvent("permission_resolved", redactForAudit({
            agent: agentType,
            mode: effectiveMode,
            sourceTrust: trust,
            resolvedTools: effectiveTools,
          }));
          // Sprint 5.17: fold the agent's per-agent fallback + retry overrides
          // into the resolved policy/chain (frontmatter wins over globals).
          retryPolicy = resolveRetryPolicy(agentCfg.retry, retryPolicy);
          fallbackChain = resolveModelFallbackChain({
            primaryModel: params.model,
            primaryProvider: params.provider,
            perAgentFallback: agentCfg.fallback?.models,
            configFallback: runtime?.config.modelFallbackChain,
            maxHops: agentCfg.fallback?.maxHops ?? runtime?.config.maxFallbackHops,
          });
        }
      } catch { /* permission resolution is best-effort — dispatch still proceeds */ }
      const dispatchId = `${toolCallId}-${Date.now()}`;
      const startTime = Date.now(); // execute()'s clock (updateLive durations)
      runtime?.dispatchStarted(agentType);
      let res;
      // Sprint 5.17 (§6.1): resilience result (attempts/total) survives into
      // the finally for the completion-file audit trail.
      let resilience;
      // Mutable holder for the card ref: the ctx.ui.custom factory closure
      // assigns it — TS flow analysis can't see closure writes, and reading
      // a plain `let cardRef: IthLiveCard | null` in the finally below would
      // narrow the still-null local to `never` (a compile break; the v0.3.x
      // code avoided this by reading its ref only from within closures).
      const cardRef: { current: IthLiveCard | null } = { current: null };
      try {
        const taskPreview = params.task.slice(0, 80) + (params.task.length > 80 ? "…" : "");
        // Live visibility (task #25): flat-text fallback via onUpdate — the
        // parent UI still sees dispatch start + each child event in headless
        // runs where no TUI overlay can composite.
        const emit = (text: string, details: DispatchDetails): void => {
          onUpdate?.({ content: [{ type: "text" as const, text }], details });
        };

        // Sprint 5.13 §3.3 (1): register the run in the live store BEFORE
        // spawnAgent — the overlay renders real data from its first frame.
        // Sprint 5.17 (§6.2): pass the retry budget (0-based attempt + max) so
        // the card can paint "↻ retrying (attempt n/N)" on a later markRetry.
        startLive(dispatchId, agentType, params.model, taskPreview, 0, retryPolicy.maxRetries);

        // Sprint 5.13 §3.3 (2): show the live overlay IMMEDIATELY (before
        // spawnAgent) — a bordered box, ithacus's own look, at the dynamic
        // preferred width (5.13.1's auto/fixed toggle), top-center. FIRE-AND-FORGET (never await ctx.ui.custom — awaiting
        // blocks the tool return and the overlay never composites during
        // tool execution, the v0.3.14/15 lesson). nonCapturing shows it
        // visually WITHOUT stealing keyboard focus; onHandle hands the card
        // its hide() channel; markDone()'s own 3s timer auto-dismisses even
        // when onHandle never fires (DESIGN_LIVE_PROGRESS.md §9 risk 5).
        try {
          ctx.ui.custom<null>(
            (_tui, theme, _kb, done) => {
              cardRef.current = new IthLiveCard(theme, dispatchId, done, () => _tui.requestRender());
              return cardRef.current;
            },
            {
              overlay: true,
              // Sprint 5.27 §3.2: center-anchored with a 1-col margin, capped
              // at 70% height, hidden below 60 cols; width resolves to the
              // preferred (auto/fixed/legacy, or the named card_size) which pi
              // clamps to the real terminal at layout time.
              overlayOptions: {
                width: getLiveCardPreferredWidth(),
                nonCapturing: true,
                anchor: "center",
                maxHeight: "70%",
                margin: 1,
                visible: (termWidth: number) => termWidth >= 60,
              },
              // Sprint 5.27 §3.3: the card stores its handle here for hide()/
              // setHidden() reachable from /ithacus-live; we ALSO hand it to
              // runtime.liveCardHandle so commands can toggle the currently
              // mounted card without coupling to cardRef's closure. When a
              // resumed session persisted card_hidden=true, start hidden.
              onHandle: (handle: { hide(): void; setHidden(hidden: boolean): void }) => {
                cardRef.current?.setHandle(handle);
                if (runtime) runtime.liveCardHandle = handle;
                if (getLiveCardHidden()) {
                  try { handle.setHidden(true); } catch { /* best-effort */ }
                }
              },
            },
          ).catch(() => { /* fire-and-forget — never block the tool result */ });
        } catch { /* ctx.ui.custom unavailable (headless mode) — overlay is best-effort */ }

        emit(`ithacus — ${agentType}\ntask: ${taskPreview}\n  ⟳ spawning sub-agent…`, {
          agent: agentType, exitCode: -1, durationMs: 0, success: false,
          model: params.model, provider: params.provider,
        });

        // Sprint 5.13 §3.3 (3): spawn; every raw `--mode json` stdout line
        // passes through (spawnAgent's rawJsonLine hook) into the live store
        // — parseJsonlLine tolerates non-JSON/partial lines (returns null),
        // updateLive drives the overlay via the onLiveChanged listener.
        // Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §6.1): route the
        // spawn through dispatchWithResilience so transient failures retry
        // (bounded backoff), context-window collapses auto-compact from
        // durable state, and the model chain falls forward (#54). A fresh
        // child is ALWAYS spawned per attempt — never reused session (we avoid
        // re-hydrating the dead child per the claw-code PR #4 lesson) — and
        // the compacted prompt is rebuilt from live store + originalTask.
        resilience = await dispatchWithResilience({
          dispatchId,
          agent: agentType,
          task: params.task,
          model: params.model,
          provider: params.provider,
          cwd: params.cwd,
          tools: effectiveTools, // Sprint 5.15: physically enforced permission
          signal: signal ?? undefined,
          // Sprint 5.17: resolved policy/chain + the live→src adapter the
          // durability loop uses to rebuild the compacted continuation.
          config: runtime?.config ?? loadConfig(),
          policy: retryPolicy,
          chain: fallbackChain,
          toLiveProgress: (id) => liveToProgress(getLive(id)),
          onProgress: (info) => {
            if (info.rawJsonLine) {
              const event = parseJsonlLine(info.rawJsonLine);
              if (event) updateLive(dispatchId, event, startTime);
              // Sprint 5.14 (DESIGN_WORKER_STATUS.md §2.2): run every raw
              // stream line through the pure WorkerStatus machine. Accepted
              // transitions advance the store + publish the richer
              // agent_status on the bus; the BLOCKED/ready phases also
              // mirror into flat onUpdate text so headless runs see WHY a
              // dispatch is paused (the card reads them from the store).
              // Best-effort: detection never blocks the happy path.
              try {
                const prev = getLive(dispatchId)?.status ?? "spawning";
                const next = mapEventToStatus(info.rawJsonLine, prev);
                if (next !== prev) {
                  setWorkerStatus(dispatchId, next);
                  const phaseNote =
                    next === "trust_required" ? "  🔒 blocked: workspace-trust confirmation required"
                    : next === "tool_permission" ? "  🔑 blocked: tool-permission grant pending"
                    : next === "ready_for_prompt" ? "  › sub-agent up, prompt queued…"
                    : null;
                  if (phaseNote) {
                    emit(`ithacus — ${agentType}${info.model ? ` · ${info.model}` : ""}\n${phaseNote}`, {
                      agent: agentType, exitCode: -1, durationMs: 0, success: false,
                      model: info.model ?? params.model, provider: params.provider,
                    });
                  }
                }
              } catch { /* status detection is best-effort — the stream wins */ }
            }
            // Flat-text fallback keeps the pre-5.13 visible phases only; the
            // raw "json" pass-through line itself is consumed by the store.
            if (info.phase === "json") return;
            const modelTag = info.model ? ` · ${info.model}` : "";
            const line = info.phase === "tool" ? `  → ${info.text}`
              : info.phase === "text" ? `  … ${info.text.slice(-200)}`
              : info.phase === "message_end" ? `  ✓ done`
              : `  · ${info.phase}`;
            emit(`ithacus — ${agentType}${modelTag}\n${line}`, {
              agent: agentType, exitCode: -1, durationMs: 0, success: false,
              model: info.model ?? params.model, provider: params.provider,
            });
          },
        });
        res = resilience.result;
      } finally {
        // Sprint 5.13 §3.3 (4): flip the store to its terminal state — the
        // card paints ✓/✗, holds 3s, then auto-dismisses (its dismiss path
        // calls removeLive, purging the snapshot). Sprint 5.14: hand the
        // classifier the exit evidence (exit code + stderr/output tail
        // slices) so failureKind is real, not the 5.13 "unknown" floor.
        endLive(dispatchId, res?.success ?? false, res?.error, {
          exitCode: res?.exitCode,
          stderrTail: res?.stderr ? res.stderr.slice(-512) : undefined,
          outputTail: res?.output ? res.output.slice(-512) : undefined,
        });
        cardRef.current?.markDone();
        runtime?.dispatchEnded(agentType);
        // Durable audit trail: every dispatch leaves a completion file at
        // <repo>/.pi/ithacus/dispatch-completions/<id>.json (best-effort).
        writeDispatchCompletion(runtime, {
          cwd: ctx.cwd,
          dispatchId,
          agentType,
          res,
          startTime,
          task: params.task,
          paramsModel: params.model,
          paramsProvider: params.provider,
          retryMeta: resilience?.attempts,
        });
      }
      // Final result: a visible status header (agent/model/duration/status)
      // PREPENDED to the child's output — so the parent LLM and any tool
      // result renderer see what actually ran, not just the prose.
      const modelStr = res.model ? `${res.model}${res.provider ? `@${res.provider}` : ""}` : "default";
      const dur = fmtDuration(res.durationMs);
      // Clean plain-text result for the tool card (pi renders this natively;
      // no ANSI/box — those render as literal escapes in tool-result text).
      const statusMark = res.success ? "✓ success" : `✗ failed (exit ${res.exitCode})`;
      // ithacus identity line uses em-dash (—) like the /ithacus-menu title;
      // `·` is the inline stat separator.
      const header = `ithacus — ${res.agent}\nmodel: ${modelStr} · ${dur} · ${statusMark}`;
      return {
        content: [
          { type: "text" as const, text: `${header}\n\n${res.output || res.stderr || "(no output)"}` },
        ],
        details: {
          agent: res.agent,
          exitCode: res.exitCode,
          model: res.model,
          provider: res.provider,
          providerSource: res.providerSource,
          durationMs: res.durationMs,
          success: res.success,
        },
      };
    },
  };

  registerToolWithVisibility(pi, tool, ToolVisibility.INTERNAL);
}
