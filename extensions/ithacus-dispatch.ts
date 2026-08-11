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
 * here one time via wireLiveEventBus(runtime.eventBus).
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
} from "./ithacus-live.js";
import { IthLiveCard } from "./ithacus-live-card.js";
import type { IthRuntime } from "./ithacus-runtime.js";
import { maybeShowFirstDispatchNotice } from "./ithacus-onboarding.js";
import { registerToolWithVisibility } from "./ithacus-tool-registry.js";
import { ToolVisibility } from "../src/tool-visibility.js";

// Compat re-export (Sprint 5.13 spawn-layer extraction): ithacus-team.ts:22
// and ithacus-swarm.ts:19 import spawnAgent from THIS module — keep the site
// stable now that the implementation lives in ithacus-spawn.ts.
export { spawnAgent };
export type { SpawnAgentOpts, SpawnAgentResult } from "./ithacus-spawn.js";

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
  const tool: ToolDefinition<typeof DispatchParams, DispatchDetails> = {
    name: "ithacus-dispatch",
    label: "ithacus dispatch",
    description:
      "Dispatch a coordinated ithacus sub-agent — a real pi subprocess with an isolated context window and a per-agent model. " +
      'Roles: explore (fast read-only recon), plan (implementation planner), verification (feasibility + post-check), reviewer (senior code review).',
    parameters: DispatchParams,
    async execute(
      toolCallId: string,
      params: { agent?: string; task: string; model?: string; provider?: string; cwd?: string },
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
      const dispatchId = `${toolCallId}-${Date.now()}`;
      const startTime = Date.now(); // execute()'s clock (updateLive durations)
      runtime?.dispatchStarted(agentType);
      let res;
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
        startLive(dispatchId, agentType, params.model, taskPreview);

        // Sprint 5.13 §3.3 (2): show the live overlay IMMEDIATELY (before
        // spawnAgent) — a bordered box, ithacus's own look, width 52,
        // top-center. FIRE-AND-FORGET (never await ctx.ui.custom — awaiting
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
              overlayOptions: { width: 52, nonCapturing: true, anchor: "top-center", offsetY: 1 },
              onHandle: (handle: { hide(): void }) => {
                cardRef.current?.setHandle(handle);
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
        res = await spawnAgent({
          agent: agentType,
          task: params.task,
          model: params.model,
          provider: params.provider,
          cwd: params.cwd,
          signal: signal ?? undefined,
          onProgress: (info) => {
            if (info.rawJsonLine) {
              const event = parseJsonlLine(info.rawJsonLine);
              if (event) updateLive(dispatchId, event, startTime);
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
      } finally {
        // Sprint 5.13 §3.3 (4): flip the store to its terminal state — the
        // card paints ✓/✗, holds 3s, then auto-dismisses (its dismiss path
        // calls removeLive, purging the snapshot).
        endLive(dispatchId, res?.success ?? false, res?.error);
        cardRef.current?.markDone();
        runtime?.dispatchEnded(agentType);
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
