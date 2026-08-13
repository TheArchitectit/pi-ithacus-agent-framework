/**
 * session-handlers.ts — pi session lifecycle handlers for ithacus.
 *   - session_start / session_tree: bindRepo + reset per-session state
 *   - before_agent_start: inline recalled memories as sub-agent context
 *   - model_select: capture active model/provider for the resolve chain
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "../ithacus-runtime.js";
import { type IthacusConfig } from "../../src/config.js";

export function registerSessionHandlers(
  pi: ExtensionAPI,
  runtime: IthRuntime,
  _config: IthacusConfig,
): void {
  const reset = (sessionId: string | undefined, cwd: string | undefined) => {
    runtime.bindRepo(cwd);
    runtime.sessionId = sessionId ?? "global";
    runtime.activeAgents = 0;
    runtime.currentTurn = 0;
    runtime.lastCompactAt = null;
  };

  pi.on("session_start", async (event, ctx) => {
    reset((event as any)?.sessionId, ctx.cwd);
    runtime.appendEvent("session_start", { cwd: ctx.cwd });
  });

  pi.on("session_tree", async (event, ctx) => {
    reset((event as any)?.sessionId, ctx.cwd);
  });

  pi.on("model_select", async (event, ctx) => {
    const m = (event as any)?.model ?? ctx.model;
    if (m) {
      runtime.appendEvent("model_select", { id: m.id, provider: m.provider });
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!runtime.config.memoryRecall) return;
    try {
      const repoId = runtime.repoId(ctx.cwd);
      const mems = runtime.store.recall(repoId, undefined, 8);
      if (!mems.length) return;
      const block = mems
        .map((m) => `- [${m.kind}] ${m.text}`)
        .join("\n");
      // PREVENT-ITH-003: inject as systemPrompt prepend, never role:"system" message.
      // before_agent_start result carries systemPrompt: string (the handler RETURNS
      // the new prompt — it does not mutate ctx, which is read-only here).
      const sp = ctx.getSystemPrompt();
      return { systemPrompt: `${sp}\n\n[ithacus] recalled memory for this repo:\n${block}` };
    } catch {
      /* non-fatal: memory recall must never break the agent loop */
    }
  });

  // B4 (Sprint 5.29): optionally ALSO inject durable memories from pi-mega-compact
  // when the flag-gated bridge is resolved. RECALL-ONLY here — the bridge does not
  // compact the parent (single-compaction-authority: mega's own extension owns
  // parent compaction). Triple-redundancy: (a) config.megaBridge flag gate,
  // (b) runtime.megaBridge null-check (fire-and-forget load may not have resolved,
  // or mega may be absent / flag-off → null), (c) try/catch non-fatal so a bridge
  // failure never breaks the agent loop. The ith_memories block above injects
  // unchanged whether or not the mega recall runs.
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!runtime.config.megaBridge || !runtime.megaBridge) return;
    try {
      const query = (event as { prompt?: string }).prompt ?? "";
      if (!query.trim()) return;
      const res = await runtime.megaBridge.recallMemories({ query, limit: 5 });
      if (!res || res.empty || !res.block) return;
      // Pi CHAINS before_agent_start returns: each handler receives the prior
      // handler's modified prompt via `event.systemPrompt` (NOT ctx.getSystemPrompt(),
      // which returns the original base prompt and would clobber the ith_memories
      // block the first handler above already prepended). Prepend onto the chained
      // value so both recall blocks compose.
      const sp = (event as { systemPrompt?: string }).systemPrompt ?? "";
      return { systemPrompt: `${sp}\n\n[mega-compact] recalled memory:\n${res.block}` };
    } catch {
      /* non-fatal: mega recall must never break the agent loop */
    }
  });

  pi.on("session_shutdown", async () => {
    runtime.dispose();
  });
}
