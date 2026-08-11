/**
 * src/extension-trust.ts — extension trust levels (Sprint 5.15).
 *
 * pi-agnostic + PURE: `import type` below is erased entirely by tsc and by
 * Node's --experimental-strip-types, so this module has zero runtime imports
 * and zero network (PREVENT-ITH-004), safe under strip-types.
 *
 * Derives a permission CEILING from an agent's source/layer field. This is
 * the "source-field scoping" (safe/balanced/restrictive vocabulary) +
 * "extension trust levels" mechanism: a low-trust (project) agent cannot
 * self-escalate by declaring `permission: full_access` in its own file —
 * the dispatch boundary clamps the resolved mode down to the tier's ceiling.
 */

import type { PermissionMode } from "./permissions.js"; // type-only (erased)

export type ExtensionTrustLevel = "trusted" | "standard" | "untrusted";

/** Descriptive strictness labels (the task's safe/balanced/restrictive). */
export type SourceScope = "safe" | "balanced" | "restrictive";

/**
 * Map an agent source/layer to a trust tier:
 *  - 'builtin' | 'bundled' → trusted  (package-shipped roster, authored here)
 *  - 'user'                → standard (user's own ~/.pi layer)
 *  - 'project' | unknown   → untrusted (repo-local defs travel with the repo)
 */
export function trustFromSource(
  source: "builtin" | "user" | "project" | "bundled" | string | undefined,
): ExtensionTrustLevel {
  if (source === "builtin" || source === "bundled") return "trusted";
  if (source === "user") return "standard";
  return "untrusted";
}

/** Highest mode a trust tier may opt into (the ceiling). */
export const SOURCE_TRUST_CEILING: Record<ExtensionTrustLevel, PermissionMode> = {
  trusted: "full_access",
  standard: "workspace_write",
  untrusted: "read_only",
};

/** Ordering floor: read_only < workspace_write < full_access. */
const MODE_RANK: Record<PermissionMode, number> = {
  read_only: 0,
  workspace_write: 1,
  full_access: 2,
};

/** The less powerful of two modes. */
export function minPermissionMode(a: PermissionMode, b: PermissionMode): PermissionMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

/** Clamp a requested mode down to the source's ceiling. */
export function applyTrustCeiling(
  mode: PermissionMode,
  trust: ExtensionTrustLevel,
): PermissionMode {
  return minPermissionMode(mode, SOURCE_TRUST_CEILING[trust]);
}

/** Trust tier → descriptive strictness label (decision #vocab). */
export function describeSourceScope(trust: ExtensionTrustLevel): SourceScope {
  return trust === "untrusted" ? "restrictive" : "balanced";
}
