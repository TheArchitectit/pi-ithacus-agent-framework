/**
 * agent-handlers.ts — agent/turn tracking + optional durable-trim relief (P7).
 *
 * Consolidation (2026-08-12): durable compaction in the parent session is owned
 * by pi-mega-compact, so the self-trim below is GATED OFF by default
 * (config.selfCompact). It only runs when ITHACUS_SELF_COMPACT=true — used when
 * a session runs WITHOUT pi-mega-compact to relieve context mid-run instead of
 * ballooning to the window limit ("compacts but never resumes", PR #3250).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "../ithacus-runtime.js";
import { type IthacusConfig } from "../../src/config.js";
import { decideTrim } from "../../src/trim.js";

export function registerAgentHandlers(
  pi: ExtensionAPI,
  runtime: IthRuntime,
  config: IthacusConfig,
): void {
  pi.on("agent_start", async (_event, ctx) => {
    runtime.activeAgents++;
    runtime.appendEvent("agent_start", { activeAgents: runtime.activeAgents });
  });

  pi.on("agent_end", async (_event, ctx) => {
    runtime.activeAgents = Math.max(0, runtime.activeAgents - 1);
    runtime.appendEvent("agent_end", { activeAgents: runtime.activeAgents });

    if (!config.auto || runtime.activeAgents > 0) {
      runtime.snapshotIfReady(ctx);
      return;
    }

    const usage = safeUsage(ctx);
    runtime.lastCtxTokens = usage.tokens;
    runtime.lastCtxPercent = usage.percent;
    runtime.lastCtxWindow = usage.window;

    const now = Date.now();
    // Consolidation: durable compaction in the parent session is owned by
    // pi-mega-compact (single compaction authority). ithacus self-trims ONLY
    // when explicitly opted back in (config.selfCompact / ITHACUS_SELF_COMPACT=
    // true) — e.g., a session running without pi-mega-compact loaded. Usage is
    // still tracked above (lastCtx*) for the web/commands pressure readouts.
    if (config.selfCompact) {
      const decision = decideTrim({
        activeAgents: runtime.activeAgents,
        isIdle: ctx.isIdle?.() ?? true,
        currentTokens: runtime.lastCtxTokens,
        contextWindow: runtime.lastCtxWindow,
        tierPct: config.tierPct,
        bootFallback: Math.round(config.tierPct * 200_000),
        sinceLastCompactMs: runtime.lastCompactAt ? now - runtime.lastCompactAt : 1e9,
        trimDebounceMs: config.trimDebounceMs,
      });

      if (decision.shouldTrim) {
        const sinceCompact = runtime.lastCompactAt ? now - runtime.lastCompactAt : 1e9;
        if (sinceCompact >= 10_000) {
          runtime.debounceUntil = now + config.trimDebounceMs;
          runtime.lastCompactAt = now;
          runtime.appendEvent("durable_trim", { reason: decision.reason, tokens: runtime.lastCtxTokens });
          // guardrails-allow PREVENT-ITH-004: local ctx.compact() — no network; agent settled.
          try {
            ctx.compact?.({ customInstructions: undefined });
          } catch {
            /* non-fatal: pi may have just compacted */
          }
          if (now >= runtime.resumeNudgeUntil) {
            runtime.resumeNudgeUntil = now + 30_000;
            pi.sendUserMessage("[ithacus] continue from the compacted context above.");
          }
        }
      }
    }
    runtime.snapshotIfReady(ctx);
  });

  pi.on("turn_start", async (event, ctx) => {
    runtime.currentTurn = (event as any)?.turnIndex ?? runtime.currentTurn + 1;
  });

  pi.on("turn_end", async (_event, ctx) => {
    // Single-turn-recording-authority (2026-08-12), mirroring single-compaction-
    // authority: in a parent session pi-mega-compact's OWN extension records every
    // turn natively (mega's turnEndHandler/recordTurnRow), writing the FULL row
    // (ctxTokens, ctxPercent, model) to mega's own conversation id (conv_*). ithacus
    // therefore does NOT call bridge.recordTurn here. The previous echo wrote a
    // SPARSE row (model=null, no ctxTokens) to a SEPARATE "global" conversation —
    // not a race on the same (conversationId, turnIndex) as mega's conv_* writes,
    // but a useless duplicate-in-spirit that fragmented turn history and would have
    // made a later bridge.fork() read sparse rows instead of mega's real ones.
    // A later bridge.fork() still works: it reads mega's natively-recorded turns.
    // bridge.recordTurn remains in the contract for the CHILD path, where mega's
    // full extension is not loaded and nothing else records turns.
    // No parent compaction here either (single-compaction-authority).
    //
    // NOTE (C2 finding, future mega-compact fix): this change does NOT fix the
    // 557 turn_write_failed events in RADOPENCODE/.pi/mega-compact/events.log —
    // those are a SEPARATE mega-compact session-RESUME bug. When pi resumes a
    // session with the same mega sessionId, mega's conversation persists (conv_*
    // rows survive) but turnIndex restarts at 0, so mega's native recordTurnRow
    // re-attempts turns that already exist → DuplicateTurnError (logged as
    // turn_write_failed). 502/557 came from one 18h conversation resumed ~7×.
    // The bridge's own "global" duplicates were swallowed by ithacus's try/catch
    // (never logged). The 557 errors are also invisible to mega's errorRate
    // health metric (errorRate tracks API-retry errors via lastErrorCategory,
    // not store-write errors) — an observability gap. The "drift warn" on the
    // status line is unrelated too: it is the cross-repo compaction_lag signal
    // (RADOPENCODE never compacted), not an error-rate signal. Tracked for a
    // mega-compact follow-up: handle session resume in recordTurnRow (continue
    // turnIndex / skip-existing / downgrade DuplicateTurnError to non-notable)
    // and surface store-write errors in the health dashboard.
    runtime.snapshotIfReady(ctx);
  });
}

interface Usage {
  tokens: number | null;
  percent: number | null;
  window: number;
}
function safeUsage(ctx: ExtensionContext): Usage {
  try {
    const u = ctx.getContextUsage?.();
    return { tokens: u?.tokens ?? null, percent: u?.percent ?? null, window: u?.contextWindow ?? 0 };
  } catch {
    return { tokens: null, percent: null, window: 0 };
  }
}
