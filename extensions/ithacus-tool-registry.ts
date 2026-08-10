/**
 * ithacus-tool-registry.ts — ithacus-level ToolVisibility metadata map.
 *
 * Adapter over the pi-agnostic src/tool-visibility.ts. Wraps pi.registerTool
 * with a register-time visibility filter: a tool whose tier exceeds the
 * current caller context is simply NOT registered with pi — so pi never
 * advertises it to the LLM in that context. Cleaner than execute-time gating
 * (no per-call overhead, no error path, no tool advertised-then-refused).
 *
 * Does NOT redefine pi's registerTool contract; it sits alongside it as a
 * thin metadata layer. Pattern source: memory-mcp gateway/tool_dispatcher.py
 * (ToolDispatcher.register + ToolVisibility + ToolContext).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ToolVisibility,
  resolveCallerContext,
  isVisible,
  type ToolContext,
} from "../src/tool-visibility.js";

/** ithacus tool → visibility tier. Append future admin tools here. */
export const TOOL_VISIBILITY: Record<string, ToolVisibility> = {
  "ithacus-mailbox": ToolVisibility.PUBLIC, // children must send/read/broadcast
  "ithacus-dispatch": ToolVisibility.INTERNAL, // only the interactive parent orchestrates spawns
};

/** Module-level metadata: authoritative record of what ithacus advertised. */
export const registeredTools = new Map<string, { visibility: ToolVisibility; registered: boolean }>();

let cachedContext: ToolContext | null = null;

/**
 * Current caller context. Computed once per process from `process.env`
 * (cached) UNLESS an explicit `env` is passed (testability — smoke-ext flips
 * ITHACUS_AGENT_ID mid-process).
 */
export function currentCallerContext(
  env?: Record<string, string | undefined>,
  admin?: boolean,
): ToolContext {
  if (env) return resolveCallerContext(env, { admin });
  if (!cachedContext) cachedContext = resolveCallerContext(process.env);
  return cachedContext;
}

/** Reset the cached context (test seam). */
export function _resetCallerContextCache(): void {
  cachedContext = null;
}

/** Register a tool with pi only if its visibility tier is visible to the
 *  current caller context. Returns true if registered, false if filtered. */
export function registerToolWithVisibility(
  pi: ExtensionAPI,
  tool: { name: string },
  visibility: ToolVisibility,
): boolean {
  const ctx = currentCallerContext();
  const allowed = isVisible(visibility, ctx);
  registeredTools.set(tool.name, { visibility, registered: allowed });
  if (allowed) {
    (pi.registerTool as (t: unknown) => void)(tool);
  }
  return allowed;
}

/** Names visible to `ctx` (or the current context if omitted). */
export function availableToolNames(ctx?: ToolContext): string[] {
  const c = ctx ?? currentCallerContext();
  return Object.entries(TOOL_VISIBILITY)
    .filter(([, tier]) => isVisible(tier, c))
    .map(([name]) => name);
}
