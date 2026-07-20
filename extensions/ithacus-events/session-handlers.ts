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

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!runtime.config.memoryRecall) return;
    try {
      const repoId = runtime.repoId(ctx.cwd);
      const mems = runtime.store.recall(repoId, undefined, 8);
      if (!mems.length) return;
      const block = mems
        .map((m) => `- [${m.kind}] ${m.text}`)
        .join("\n");
      // PREVENT-ITH-003: inject as systemPrompt prepend, never role:"system" message.
      ctx.systemPrompt = `${ctx.systemPrompt ?? ""}\n\n[ithacus] recalled memory for this repo:\n${block}`;
    } catch {
      /* non-fatal: memory recall must never break the agent loop */
    }
  });

  pi.on("session_shutdown", async () => {
    runtime.dispose();
  });
  pi.on("shutdown", async () => {
    runtime.dispose();
  });
}
