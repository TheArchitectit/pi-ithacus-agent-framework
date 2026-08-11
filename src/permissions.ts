/**
 * src/permissions.ts — Agent Permission Modes (Sprint 5.15, docs/DESIGN_PERMISSION_MODES.md).
 *
 * pi-agnostic + PURE: zero imports (not even node: builtins), zero network
 * (PREVENT-ITH-004), safe under Node's --experimental-strip-types.
 *
 * Enforcement model (design §2.2/§2.3): each agent declares a permission mode
 * in frontmatter (`permission:` + optional `allow:`/`deny:`); the dispatch
 * boundary resolves it to an EXPLICIT `--tools` allowlist and passes that to
 * the child pi process — the child physically cannot call tools it was not
 * given. deny is enforced by SUBTRACTION from the allowlist, so no pi-side
 * denylist flag is needed (pi-agnostic).
 *
 * Resolution order (design §2.2): deny → mode base → allow.
 * Fail-safes (design §2.3 + plan decision #legacy):
 *   - unknown/missing mode → read_only
 *   - missing declaration → read_only, UNLESS a legacy `tools:` list exists
 *     and strict mode is off — then the legacy list is the explicit
 *     pass-through allowlist (non-breaking for existing project agents).
 *     ITHACUS_PERMISSION_STRICT=true (via config) restores the strict
 *     design behavior (missing declaration → read_only even with legacy tools).
 */

export type PermissionMode = "read_only" | "workspace_write" | "full_access";

export interface AgentPermissions {
  mode: PermissionMode;
  /** extra tool names beyond the mode's base set */
  allow?: string[];
  /** explicit denies win over mode + allow */
  deny?: string[];
}

/** Per-dispatch override (highest precedence at the spawn boundary). */
export interface PermissionOverride {
  mode?: PermissionMode;
  allow?: string[];
  deny?: string[];
}

export interface ResolvedPermission {
  /** the effective mode actually applied (audit label). */
  mode: PermissionMode;
  /** the explicit --tools allowlist passed to the child pi. */
  toolAllow: string[];
  /** deny list applied (documentation/audit — already subtracted from toolAllow). */
  toolDeny: string[];
}

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "read_only",
  "workspace_write",
  "full_access",
];

/** Unknown/undefined → read_only (fail-safe; design §2.3). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "read_only";

/**
 * Bounded universe for full_access + deny-subtraction (plan §1 decision #4):
 * pi's full tool universe cannot be enumerated pi-agnostically from src/, so
 * full_access resolves to the curated union of tools the bundled roster
 * actually uses plus the tool-visibility/registry agent-visible set
 * (PUBLIC tier = ithacus-mailbox, already present).
 */
export const KNOWN_TOOLS: readonly string[] = [
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
  "bash",
  "ithacus-mailbox",
];

export const BASE_TOOLS: Record<PermissionMode, string[]> = {
  // plan §1 decision #3: read_only includes ithacus-mailbox (non-mutating
  // handoff — explore/verification/reviewer/plan all hand off via it).
  read_only: ["read", "grep", "find", "ls", "ithacus-mailbox"],
  workspace_write: ["read", "grep", "find", "ls", "edit", "write", "ithacus-mailbox"],
  full_access: [...KNOWN_TOOLS],
};

/** Unknown/undefined → read_only (fail-safe; design §2.3). */
export function normalizePermissionMode(s: unknown): PermissionMode {
  if (typeof s !== "string") return DEFAULT_PERMISSION_MODE;
  const v = s.trim();
  for (const m of PERMISSION_MODES) {
    if (v === m) return m;
  }
  return DEFAULT_PERMISSION_MODE;
}

/** Dedupe while preserving first-occurrence order. */
function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** Tolerant list parser: comma-separated strings and string[] both normalize
 *  to a trimmed, non-empty string[]. Returns undefined when nothing usable. */
function toToolList(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const parts = Array.isArray(v) ? v : v.split(",");
  const out = parts.map((t) => t.trim()).filter((t) => t.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * Read frontmatter `permission`/`allow`/`deny` keys. Tolerant of both parsers:
 * definitions.ts yields Record<string,string[]>; ithacus-agents.ts yields
 * Record<string,string> (comma-separated). Returns null when no `permission`
 * key is present (no declaration — resolvePermissions' fail-safe path).
 */
export function parsePermissionFrontmatter(
  fm: Record<string, string | string[]>,
): AgentPermissions | null {
  const raw = fm["permission"];
  if (raw === undefined) return null;
  const modeStr = Array.isArray(raw) ? raw[0] : raw;
  const mode = normalizePermissionMode(modeStr);
  const allow = toToolList(fm["allow"]);
  const deny = toToolList(fm["deny"]);
  const out: AgentPermissions = { mode };
  if (allow) out.allow = allow;
  if (deny) out.deny = deny;
  return out;
}

/**
 * Apply an override on top of a declared permission ("on top" = override mode
 * replaces base mode when given; allow/deny lists UNION with base, deny still
 * wins at resolution time). Returns null only when neither side declares a
 * mode and no override is present.
 */
export function mergePermissions(
  base: AgentPermissions | null,
  override?: PermissionOverride,
): AgentPermissions | null {
  if (!base && !override) return null;
  const mode = override?.mode ?? base?.mode ?? DEFAULT_PERMISSION_MODE;
  const allow = dedupe([...(base?.allow ?? []), ...(override?.allow ?? [])]);
  const deny = dedupe([...(base?.deny ?? []), ...(override?.deny ?? [])]);
  const out: AgentPermissions = { mode };
  if (allow.length > 0) out.allow = allow;
  if (deny.length > 0) out.deny = deny;
  return out;
}

/**
 * Single resolver (design §2.2). Returns an EXPLICIT toolAllow list.
 *  - declared: AgentPermissions from frontmatter (null if none)
 *  - legacyTools: legacy `tools:` frontmatter list — when there is NO
 *    declaration and strict is off, this passes through verbatim as the
 *    explicit allowlist (non-breaking; plan §1 legacy decision). Note the
 *    reported mode stays the fail-safe default in that branch: the audit's
 *    ground truth is toolAllow, and the reported default mode keeps the
 *    source-trust ceiling a no-op so legacy lists survive clamping.
 *  - override: per-dispatch override merged on top of the declaration
 *    (highest precedence; declared deny still wins over override allow)
 *  - defaultMode: fail-safe default when nothing is declared (read_only)
 *  - strict: when true, a missing declaration → read_only even if legacyTools
 *    is set (ITHACUS_PERMISSION_STRICT, via config)
 */
export function resolvePermissions(opts: {
  declared?: AgentPermissions | null;
  legacyTools?: string[];
  override?: PermissionOverride;
  defaultMode?: PermissionMode;
  strict?: boolean;
}): ResolvedPermission {
  const merged = mergePermissions(opts.declared ?? null, opts.override);
  if (!merged) {
    // No declaration AND no override.
    if (!opts.strict && opts.legacyTools && opts.legacyTools.length > 0) {
      return {
        mode: opts.defaultMode ?? DEFAULT_PERMISSION_MODE,
        toolAllow: dedupe(opts.legacyTools),
        toolDeny: [],
      };
    }
    const mode = opts.defaultMode ?? DEFAULT_PERMISSION_MODE;
    return { mode, toolAllow: [...BASE_TOOLS[mode]], toolDeny: [] };
  }
  // deny → mode base → allow: deny subtracts from BOTH the base set and the
  // allow additions (deny always wins).
  const denySet = new Set(merged.deny ?? []);
  const base = BASE_TOOLS[merged.mode];
  const toolAllow = dedupe([...base, ...(merged.allow ?? [])]).filter(
    (t) => !denySet.has(t),
  );
  return { mode: merged.mode, toolAllow, toolDeny: merged.deny ?? [] };
}
