/**
 * agent-handlers.ts — agent/turn tracking + durable-trim relief (P7).
 *
 * Mirrors mega-compact's agent_end durable-trim: on a settled agent_end
 * (activeAgents === 0, idle, over threshold, past debounce) issue a durable
 * ctx.compact() and nudge the agent to continue — so a team run relieves
 * context mid-run instead of ballooning to the window limit.
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

    if (!(config.auto || true) || runtime.activeAgents > 0) {
      runtime.snapshotIfReady(ctx);
      return;
    }

    const usage = safeUsage(ctx);
    runtime.lastCtxTokens = usage.tokens;
    runtime.lastCtxPercent = usage.percent;
    runtime.lastCtxWindow = usage.window;

    const now = Date.now();
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
    runtime.snapshotIfReady(ctx);
  });

  pi.on("turn_start", async (event, ctx) => {
    runtime.currentTurn = (event as any)?.turnIndex ?? runtime.currentTurn + 1;
  });

  pi.on("turn_end", async (_event, ctx) => {
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
