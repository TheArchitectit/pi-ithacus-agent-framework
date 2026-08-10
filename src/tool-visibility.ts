/**
 * tool-visibility.ts — pi-agnostic ToolVisibility tier model.
 *
 * Port of memory-mcp's gateway/tool_dispatcher.py ToolVisibility concept:
 * a PUBLIC < INTERNAL < ADMIN hierarchy that filters which ithacus tools
 * are advertised to which caller context (child agent vs interactive parent
 * vs admin command) — WITHOUT redefining pi's registerTool contract.
 *
 * Pure logic, no pi imports (src/ stays pi-agnostic). Zero network
 * (PREVENT-ITH-004).
 *
 * NOTE: uses `const ... as const` + a union type instead of a TypeScript
 * `enum`, because Node's `--experimental-strip-types` (the smoke-harness
 * runtime) only STRIPS type annotations — it does not transpile enums
 * (which need runtime codegen). tsc accepts both; strip mode rejects enums.
 *
 * Caller context is resolved once per session via resolveCallerContext:
 *   admin flag (explicit code path, not env)  → ADMIN
 *   ITHACUS_AGENT_ID env present               → PUBLIC  (spawned child)
 *   else                                       → INTERNAL (interactive parent)
 *
 * ADMIN is deliberately opt-in via an explicit flag (not env), so a child
 * cannot spoof it by setting an env var.
 */

export const ToolVisibility = {
  PUBLIC: 0,
  INTERNAL: 1,
  ADMIN: 2,
} as const;
export type ToolVisibility = (typeof ToolVisibility)[keyof typeof ToolVisibility];

export interface ToolContext {
  tier: ToolVisibility;
  caller: "child" | "interactive" | "admin";
  /** Optional session id for telemetry. */
  sessionId?: string;
}

export const TIER_LABEL: Record<ToolVisibility, string> = {
  [ToolVisibility.PUBLIC]: "public",
  [ToolVisibility.INTERNAL]: "internal",
  [ToolVisibility.ADMIN]: "admin",
};

/** Resolve the caller context from an env map (+ optional admin flag). */
export function resolveCallerContext(
  env: Record<string, string | undefined>,
  opts?: { admin?: boolean; sessionId?: string },
): ToolContext {
  if (opts?.admin) {
    return { tier: ToolVisibility.ADMIN, caller: "admin", sessionId: opts.sessionId };
  }
  if (env.ITHACUS_AGENT_ID) {
    return { tier: ToolVisibility.PUBLIC, caller: "child", sessionId: opts?.sessionId };
  }
  return { tier: ToolVisibility.INTERNAL, caller: "interactive", sessionId: opts?.sessionId };
}

/** A tool at `toolTier` is visible to a context iff toolTier <= ctx.tier
 *  (ADMIN sees all, INTERNAL sees INTERNAL+PUBLIC, PUBLIC sees PUBLIC only). */
export function isVisible(toolTier: ToolVisibility, ctx: ToolContext): boolean {
  return toolTier <= ctx.tier;
}

/** Filter a name→tier registry down to the names visible to `ctx`. */
export function filterToolNames(
  registry: Record<string, ToolVisibility>,
  ctx: ToolContext,
): string[] {
  return Object.entries(registry)
    .filter(([, tier]) => isVisible(tier, ctx))
    .map(([name]) => name);
}
