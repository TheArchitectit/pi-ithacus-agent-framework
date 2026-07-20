/**
 * context-handler.ts — live context-pressure tracking.
 *
 * Captures token/percent/window from the `context` event so the trim decision
 * (agent-handlers) and the dashboard have a live "how full" signal. Mirrors
 * mega-compact's context-handler gate firing on percent (reliable) not token
 * count (under-reported).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "../ithacus-runtime.js";
import { type IthacusConfig } from "../../src/config.js";

export function registerContextHandler(
  pi: ExtensionAPI,
  runtime: IthRuntime,
  _config: IthacusConfig,
): void {
  pi.on("context", async (event, ctx) => {
    const u = (event as any)?.usage ?? (event as any)?.context;
    if (u) {
      runtime.lastCtxTokens = u.tokens ?? runtime.lastCtxTokens;
      runtime.lastCtxPercent = u.percent ?? runtime.lastCtxPercent;
      runtime.lastCtxWindow = u.contextWindow ?? runtime.lastCtxWindow;
    }
    runtime.snapshotIfReady(ctx);
  });
}
