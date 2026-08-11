# Plan — Sprint 5.15: Agent Permission Modes

**Status:** PLAN ONLY (no code written).
**Spec:** `docs/DESIGN_PERMISSION_MODES.md` (read in full; Status: SPEC COMPLETE).
**Guardrails:** PREVENT-ITH-001/002/003/004, PREVENT-DIST-001, AGENT_GUARDRAILS (Four Laws, NO SECRETS, NO FEATURE CREEP).
**Scope:** `src/` stays pi-agnostic + zero-dependency; new runtime behavior is enforced at the single spawn boundary in `extensions/ithacus-dispatch.ts`.

---

## 0. Goal and non-goals

**Goal:** Declare and *enforce* a per-agent permission mode (`read_only` / `workspace_write` / `full_access`) so dispatched ithacus sub-agents are safe-by-default and mutation is opt-in + auditable. Add the requested source-field trust scoping, extension-trust ceilings, and secret-redaction helpers as a tightly-scoped, guardrail-safe layer.

**In scope (design doc + task):**
- `PermissionMode` / `AgentPermissions` types (in `src/types.ts`) + pure resolver (`src/permissions.ts`).
- Source-derived trust ceiling (`src/extension-trust.ts`) — the "source-field scoping for safe/balanced/restrictive" + "extension trust levels" asks.
- Secret redaction (`src/redact.ts`) — the "ithacus-redact logic" ask.
- Minimal, non-breaking integration in `src/config.ts`, `src/team.ts`, `src/types.ts`.
- Extension hook: parse + resolve + enforce in `ithacus-agents.ts` / `ithacus-dispatch.ts`; redact in `ithacus-live.ts`.
- Roster frontmatter (`permission:` / `allow:` / `deny:`).
- Unit tests in `scripts/smoke-src/29-permissions.mjs` + harness wiring; dispatch integration test (stub-based).

**Non-goals (per design §5, kept strictly out):** interactive permission escalation; per-task narrowing; runtime network calls; new npm deps.

---

## 1. Design-doc gaps / decisions the implementer MUST confirm (read first)

The design doc is authoritative for the three modes. It does **not** contain the task's three extra asks (source trust, redact). Those are planned below as **Phase B** and flagged for scope confirmation. In addition, four concrete gaps must be resolved before coding:

1. **`writer.md` already exists** (design calls it "writer (NEW)"). It already has `tools: read, grep, find, ls, bash, write, edit, ithacus-mailbox`. Change = **add** `permission: workspace_write` (+ `allow: bash`), not create the file.
2. **`writer`'s own prompt requires `bash`** (build/test/"Use bash for building, testing"), but design §2.2 puts `bash` only in `full_access`. Pinning `writer` to `workspace_write` with no bash would break its verify gate. **Recommendation:** `writer → workspace_write` **+ `allow: bash`** (design's own allow-mechanism supports this). Flag for human sign-off.
3. **`read_only` base omits `ithacus-mailbox`** (design §2.2 = `read,grep,find,ls`). But explore/verification/reviewer/plan hand off via `ithacus-mailbox`, which is non-mutating. **Recommendation:** add `ithacus-mailbox` to the `read_only` base set (or give each read_only agent `allow: ithacus-mailbox`). Flag for human sign-off.
4. **`full_access` = "+ bash and all registered tools"** cannot be literally enumerated pi-agnostically (src/ must not know pi's full tool universe). **Recommendation:** resolve `full_access` to a bounded `KNOWN_TOOLS` universe (union of tools the roster actually uses + the tool-visibility set), then apply `deny`. Documented as a bounded-audit decision.

**Legacy `tools:` frontmatter (behavior-change risk):** explore/plan/verification/reviewer currently declare `tools:` *including* `bash`. Adding `permission: read_only` will **remove** bash from their resolved set (intended). But a *project* agent that declares only `tools:` (no `permission:`) would, under the design's strict "missing → read_only", lose bash and break. **Recommendation:** fail-safe default = read_only **only** when no declaration *and* no legacy `tools:`; otherwise a legacy `tools:` list is treated as an explicit pass-through allowlist (full_access-equivalent) **unless** `ITHACUS_PERMISSION_STRICT=true`. This keeps the change non-breaking for existing project agents while honoring the design for the bundled roster (which declares explicitly).

**"safe/balanced/restrictive" vocabulary:** the design uses `read_only/workspace_write/full_access` as the *mode* names. The task's `safe/balanced/restrictive` most cleanly maps to **trust strictness derived from the agent's `source`/`layer` field** (see §3.2). Recommended mapping (flag for confirmation): `trusted → "balanced"` (may opt into full_access), `standard → "balanced"`, `untrusted/project → "restrictive"` (ceiling read_only), and the *absence* of an explicit declaration on an untrusted source = `"safe"` (hard read_only floor, no opt-in). The three trust tiers clamp the *effective* mode; the mode enum itself keeps the design's names.

---

## 2. New `src/` files (exact signatures)

All three are **pure TypeScript, zero imports, no deps** → trivially PREVENT-ITH-004 compliant and strip-type-safe (the smoke harness copies `.ts`→`.ts` and only rewrites `.js` specifiers; files with no imports need none).

### 2.1 `src/permissions.ts` (NEW — design core)

```ts
// src/permissions.ts — pi-agnostic, pure. No imports (not even node: builtins).
// Enforces permission modes by computing an explicit --tools allowlist.

export type PermissionMode = "read_only" | "workspace_write" | "full_access";

export interface AgentPermissions {
  mode: PermissionMode;
  allow?: string[];   // extra tool names beyond the mode's base set
  deny?: string[];    // explicit denies win over mode + allow
}

/** Per-dispatch override (highest precedence at the spawn boundary). */
export interface PermissionOverride {
  mode?: PermissionMode;
  allow?: string[];
  deny?: string[];
}

export interface ResolvedPermission {
  mode: PermissionMode;        // the effective mode actually applied
  toolAllow: string[];         // the explicit --tools allowlist passed to child pi
  toolDeny: string[];          // deny list applied (documentation/audit)
}

export const PERMISSION_MODES: readonly PermissionMode[] =
  ["read_only", "workspace_write", "full_access"];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "read_only";

/** Bounded universe for full_access + deny-subtraction (see decision #4). */
export const KNOWN_TOOLS: readonly string[] = [
  "read", "grep", "find", "ls", "edit", "write", "bash", "ithacus-mailbox",
  // + any tool names surfaced by tool-visibility/registry as the agent-visible set
];

export const BASE_TOOLS: Record<PermissionMode, string[]> = {
  // decision #3: read_only includes ithacus-mailbox (non-mutating handoff)
  read_only: ["read", "grep", "find", "ls", "ithacus-mailbox"],
  workspace_write: ["read", "grep", "find", "ls", "edit", "write", "ithacus-mailbox"],
  full_access: [...KNOWN_TOOLS],
};

/** Unknown/undefined → read_only (fail-safe; design §2.3). */
export function normalizePermissionMode(s: unknown): PermissionMode;

/** Read frontmatter `permission`/`allow`/`deny`. Tolerant of both parsers:
 *  definitions.ts yields Record<string,string[]>; ithacus-agents.ts yields
 *  Record<string,string> (comma-separated). Returns null when no `permission` key. */
export function parsePermissionFrontmatter(
  fm: Record<string, string | string[]>,
): AgentPermissions | null;

/** Apply override on top of a declared permission. */
export function mergePermissions(
  base: AgentPermissions | null,
  override?: PermissionOverride,
): AgentPermissions | null;

/**
 * Single resolver. Resolution order (design §2.2): deny → mode base → allow.
 * Options:
 *  - declared: AgentPermissions from frontmatter (null if none)
 *  - legacyTools: the legacy `tools:` frontmatter list (pass-through when no
 *    declared mode and not strict — decision #legacy)
 *  - override: SpawnAgentOpts.tools-derived override (highest precedence)
 *  - defaultMode: fail-safe default when nothing declared (read_only)
 *  - strict: when true, missing declaration → read_only even if legacyTools set
 * Returns an EXPLICIT toolAllow list (deny enforced by subtraction, no denylist
 * flag needed → pi-agnostic).
 */
export function resolvePermissions(opts: {
  declared?: AgentPermissions | null;
  legacyTools?: string[];
  override?: PermissionOverride;
  defaultMode?: PermissionMode;
  strict?: boolean;
}): ResolvedPermission;
```

### 2.2 `src/extension-trust.ts` (NEW — task ask: source trust + safe/balanced/restrictive)

```ts
// src/extension-trust.ts — pi-agnostic, pure. No imports.
// Derives a permission CEILING from an agent's source/layer field. This is the
// "source-field scoping" + "extension trust levels" mechanism.

export type ExtensionTrustLevel = "trusted" | "standard" | "untrusted";
// descriptive strictness labels (task's safe/balanced/restrictive)
export type SourceScope = "safe" | "balanced" | "restrictive";

/** Map an agent source/layer to a trust tier.
 *  - 'builtin' | 'bundled' → trusted
 *  - 'user'                  → standard
 *  - 'project' | unknown     → untrusted
 */
export function trustFromSource(
  source: "builtin" | "user" | "project" | "bundled" | string | undefined,
): ExtensionTrustLevel;

/** Highest mode a trust tier may opt into. */
export const SOURCE_TRUST_CEILING: Record<ExtensionTrustLevel, PermissionMode> = {
  trusted: "full_access",
  standard: "workspace_write",
  untrusted: "read_only",
};

/** Ordering: read_only < workspace_write < full_access. */
export function minPermissionMode(a: PermissionMode, b: PermissionMode): PermissionMode;

/** Clamp a requested mode down to the source's ceiling (low-source agents
 *  cannot self-escalate). */
export function applyTrustCeiling(
  mode: PermissionMode,
  trust: ExtensionTrustLevel,
): PermissionMode;

/** Trust tier → descriptive strictness label (see decision #vocab). */
export function describeSourceScope(trust: ExtensionTrustLevel): SourceScope;
```

### 2.3 `src/redact.ts` (NEW — task ask: ithacus-redact logic)

```ts
// src/redact.ts — pi-agnostic, pure. No imports. Bounded regex list, no deps.
// Scrub secrets before anything reaches the live store / events.log / audit.
// Honors AGENT_GUARDRAILS "NO SECRETS".

/** Mask known secret shapes in a string. Patterns (bounded, no backtracking
 *  bombs): AWS AKIA*, GitHub ghp_/gho_/ghu_/ghs_/ghr_ tokens, generic
 *  `password=`/`token=`/`api_key=`/`secret=` assignments, `Bearer <token>`,
 *  `-----BEGIN ... PRIVATE KEY-----` blocks, long hex/base64 (>=32 chars). */
export function redactSecrets(text: string): string;

/** Redact + truncate a tool-args preview to N chars (mirrors live store's
 *  60/80-char preview convention). */
export function redactToolArgs(args: string, maxLen?: number): string;

/** Shallow redact of string values in an audit object (for PermissionAudit). */
export function redactForAudit(obj: Record<string, unknown>): Record<string, unknown>;
```

---

## 3. Integration points (minimal, non-breaking)

### 3.1 `src/types.ts` (design §3)
- Add the design's `PermissionMode` + `AgentPermissions` (re-exported from `permissions.ts` so `types.ts` stays the import site) and an audit type:
  ```ts
  export type { PermissionMode, AgentPermissions } from "./permissions.js";
  export interface PermissionAudit {
    agentId: string;
    mode: PermissionMode;
    resolvedTools: string[];
    sourceTrust: string;   // ExtensionTrustLevel label
    ts: number;
  }
  ```
- Add an **optional** audit column to `IthAgent` (additive, no migration pain — persisted via an idempotent `ALTER` following the existing `ith_agents` pattern in `store.ts`, or skipped in favor of `runtime.appendEvent` audit; recommended: `runtime.appendEvent` only to stay non-breaking):
  ```ts
  // optional; stamp after resolution, never required for reads
  permissionMode?: PermissionMode;
  ```

### 3.2 `src/types-sprint-3.2.ts` (home of `AgentDefinition`)
- `AgentDefinition` gains `permissions?: AgentPermissions` (add `import type { AgentPermissions } from "./types.js"` — type-only, erased at strip, no runtime cycle). Used by `definitions.ts` discovery (optional; the dispatch path uses `AgentConfig`).

### 3.3 `src/config.ts` (minimal — feeds the resolver's fail-safe)
- Add to `IthacusConfig`: `permissionModeDefault: PermissionMode` (default `"read_only"`) and `permissionStrict: boolean` (default `false`).
- `loadConfig()` reads `ITHACUS_PERMISSION_MODE_DEFAULT` and `ITHACUS_PERMISSION_STRICT`. Both additive → no behavior change at defaults.
```ts
permissionModeDefault: (envValue as PermissionMode) ?? "read_only",
permissionStrict: envBool("ITHACUS_PERMISSION_STRICT", false),
```
(`PermissionMode` imported as `import type` — erased, no runtime change.)

### 3.4 `src/team.ts` (minimal)
- `planRun` opts gain `permissionModeByRole?: Partial<Record<AgentRole, PermissionMode>>` (default `undefined`).
- When supplied, stamp `permissionMode` onto each `IthAgent` row (the `permissionMode?` field from §3.1). No other logic change. `resolvePermissions` is NOT called here (resolution stays at the spawn boundary per design §2.3 — team.ts is plan-only, pi-agnostic).

---

## 4. Extension-side hook (`extensions/`)

### 4.1 `extensions/ithacus-agents.ts` (parse permissions — non-breaking)
- Extend `AgentConfig`: `permissions?: AgentPermissions`.
- In `loadAgentsFromDir`, after reading `tools`, compute:
  ```ts
  const fmPerm = parsePermissionFrontmatter(frontmatter); // keyed by 'permission'|'allow'|'deny'
  // ...
  permissions: fmPerm ?? undefined,
  ```
- `parseFrontmatter` already yields `Record<string,string>`; `parsePermissionFrontmatter` normalizes comma-lists. Optional field → existing callers unaffected.

### 4.2 `extensions/ithacus-dispatch.ts` (resolve + enforce — the behavior change)
In `execute()`, after `const agentType = params.agent ?? "explore";` and agent lookup, insert **before** `spawnAgent(...)`:
```ts
// Sprint 5.15: resolve + enforce permission at the spawn boundary.
const trust = trustFromSource(agent.source);                 // 'bundled'|'project'
const resolved = resolvePermissions({
  declared: agent.permissions ?? null,
  legacyTools: agent.tools,
  override: params.tools ? { allow: params.tools } : undefined,
  defaultMode: runtime?.config.permissionModeDefault ?? "read_only",
  strict: runtime?.config.permissionStrict ?? false,
});
const effectiveMode = applyTrustCeiling(resolved.mode, trust); // clamp low-source agents
const effectiveTools = (effectiveMode === resolved.mode)
  ? resolved.toolAllow
  : resolvePermissions({ declared: { mode: effectiveMode } }).toolAllow;

runtime?.appendEvent("permission_resolved", redactForAudit({
  agent: agentType, mode: effectiveMode, sourceTrust: trust,
  resolvedTools: effectiveTools,
}));
```
Then pass `tools: effectiveTools` into the existing `spawnAgent({ ... })` call. `spawnAgent` already does `opts.tools ?? agent.tools` and pushes `--tools` when non-empty → enforcement is physical (the child literally cannot call tools it wasn't given). PREVENT-ITH-004 already annotated on the spawn import — unchanged.
- No change to `runtime.dispatchStarted` (audit uses the existing `appendEvent`).

### 4.3 `extensions/ithacus-live.ts` (redact — honors NO SECRETS)
- Wrap the two preview extractors so secrets never reach the overlay/event bus:
  ```ts
  import { redactSecrets } from "../src/redact.js";
  // argsPreview(): return redactSecrets(<preview>)  (preview already truncated)
  // extractFile(): return redactSecrets(<file>)      (file path could contain token)
  ```
- Also apply `redactSecrets` to `entry.currentToolArgs` on `tool_execution_start`. Pure redaction only → no shape change, non-breaking.

---

## 5. Roster frontmatter changes (`extensions/agents/*.md`)

| File | Change | Notes |
|---|---|---|
| `explore.md` | add `permission: read_only` | loses bash (intended). Keep/trim `tools:` to match or leave (permission wins). |
| `plan.md` | add `permission: read_only` | same — becomes a true read-only planner. |
| `verification.md` | add `permission: read_only` **+ `allow: bash`** | keeps `git diff`/`tsc`/`npm test` commands (design §2.4). |
| `reviewer.md` | add `permission: read_only` | loses bash (intended). |
| `writer.md` (EXISTS) | add `permission: workspace_write` **+ `allow: bash`** | design calls it NEW but it already exists; bash kept for the verify gate (decision #2). |

All changes are additive frontmatter. No system-prompt edits required.

---

## 6. Test plan

### 6.1 Unit suite `scripts/smoke-src/29-permissions.mjs` (NEW) + harness wiring
Harness (`scripts/smoke-src.mjs`) edits:
- Add imports: `export const permissions = await import(join(buildDir, "permissions.ts"));` plus `extensionTrust`, `redact` (same pattern).
- Add `import * as s29 from "./smoke-src/29-permissions.mjs";` and `await s29.run(ctx);` after s28.

`29-permissions.mjs` imports `{ permissions, extensionTrust, redact }` from `_harness.mjs` and asserts:

**permissions.ts**
1. `BASE_TOOLS.read_only` = `[read,grep,find,ls,ithacus-mailbox]` (decision #3 — flag).
2. `BASE_TOOLS.workspace_write` ⊇ read_only + `[edit,write]`; no `bash`.
3. `BASE_TOOLS.full_access` = `KNOWN_TOOLS` (incl. bash).
4. `normalizePermissionMode("")` = `normalizePermissionMode("garbage")` = `read_only`.
5. `resolvePermissions({declared:{mode:"read_only", allow:["bash"]}})` → toolAllow includes `bash`.
6. `resolvePermissions({declared:{mode:"workspace_write", deny:["edit"]}})` → toolAllow excludes `edit`.
7. deny beats allow: `resolvePermissions({declared:{mode:"read_only", allow:["bash"], deny:["bash"]}})` → no `bash`.
8. Missing declaration + `legacyTools:["read","bash"]` + `strict:false` → toolAllow = `["read","bash"]` (pass-through).
9. Missing declaration + `legacyTools` + `strict:true` → `read_only` base (no bash).
10. `parsePermissionFrontmatter({permission:"read_only", allow:"bash,edit"})` → `{mode:"read_only", allow:["bash","edit"], deny:undefined}`; no `permission` key → `null`.

**extension-trust.ts**
11. `trustFromSource("bundled")` = `trusted`; `"user"` = `standard`; `"project"` = `untrusted`; `undefined` = `untrusted`.
12. `applyTrustCeiling("full_access","untrusted")` = `read_only`; `("full_access","standard")` = `workspace_write`; `("full_access","trusted")` = `full_access`.
13. `minPermissionMode("read_only","workspace_write")` = `read_only`; ordering holds.
14. `describeSourceScope("untrusted")` = `"restrictive"` (decision #vocab).

**redact.ts**
15. `redactSecrets("token=sk_live_abc123DEF")` contains no `sk_live_abc123DEF`; contains `***REDACTED***` (or masked).
16. `redactSecrets("Authorization: Bearer ghp_xxx")` masks the token; plain prose passes through.
17. `redactSecrets("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")` masks the body.
18. `redactToolArgs("cat /tmp/x && export AWS_KEY=AKIA...", 60)` is both truncated and free of the secret.
19. `redactForAudit({agent:"explore", resolvedTools:["read"], mode:"read_only"})` returns an equal-shape object.

### 6.2 Dispatch integration test (stub-based) — recommended
The behavior flip lives in `ithacus-dispatch.ts` → `spawnAgent`. Because `spawnAgent` already supports a `spawnImpl` test seam, add a stub test (under the extensions test location / `node --test`) that:
- injects a `spawnImpl` capturing the args array,
- dispatches `explore` (read_only) and asserts the captured child args **include** `--tools` with the resolved allowlist **and exclude** `bash`,
- dispatches a `full_access`/`workspace_write+allow:bash` agent and asserts `bash` is present.
**Note:** the canonical repo gate is `scripts/smoke-src.mjs` (src-only). This integration test lives in the extensions test layer (where `spawnAgent` is already importable with the stub). Flag if no extensions-test harness exists yet → add one or run a manual smoke.

### 6.3 Gate commands (run before commit)
```
node --experimental-strip-types scripts/smoke-src.mjs   # src unit gate (CLAUDE.md §3)
node scripts/guardrails-scan.mjs                        # PREVENT-ITH-* / PREVENT-DIST-001
python3 scripts/regression_check.py --all               # failure-registry scan
npm run build                                           # optional tsc type-check
```
> Design doc §4 names `src/permissions.test.ts` — repo convention is `scripts/smoke-src/*.mjs`. **Use the smoke-src module as the gate** (per CLAUDE.md) and treat `permissions.test.ts` as a doc inconsistency.

---

## 7. Guardrails check

| Rule | Status | How the plan honors it |
|---|---|---|
| PREVENT-ITH-001 (anchor floor) | N/A | No change to trim/store message retention. |
| PREVENT-ITH-002 (tool-pair) | N/A | No trim-boundary changes. |
| PREVENT-ITH-003 (no system role) | N/A | Permissions flow via `--tools` arg + frontmatter, never `role:"system"`. |
| PREVENT-ITH-004 (critical, no network) | ✅ | `permissions.ts`/`extension-trust.ts`/`redact.ts` are pure, importless, zero-dep. Spawn boundary keeps its existing audited `guardrails-allow` annotation. |
| PREVENT-DIST-001 | ✅ | No change to distribution (still `npm publish` + `pi install npm:ithacus`). |
| AGENT_GUARDRAILS NO SECRETS | ✅ | `redact.ts` + `ithacus-live.ts` redaction + `redactForAudit` on the audit event. |
| NO FEATURE CREEP | ⚠️ | Core (types/permissions/dispatch/roster) is in-design. `extension-trust.ts` + `redact.ts` are **task-requested beyond the design doc** — flag for scope confirmation; keep them thin + pure. |

---

## 8. Risks and rollback

- **Behavior change (intended):** explore/plan/reviewer lose `bash`; verification keeps it via `allow`; writer keeps it via `allow`. Communicate in the sprint note.
- **Design gaps #2/#3:** writer needs bash; read_only needs mailbox. Implementer must confirm the two `allow:`/base-set adjustments before coding (they flip test expectations).
- **Legacy project agents:** default `strict:false` preserves their `tools:` pass-through; `ITHACUS_PERMISSION_STRICT=true` enforces the design's strict fail-safe. Rolling back = unset env (no code change needed).
- **`full_access` universe:** bounded `KNOWN_TOOLS` (decision #4) — a project agent opting into `full_access` gets the curated set, not literally every pi tool. Acceptable + auditable.
- **Rollback:** enforcement is isolated in `extensions/ithacus-dispatch.ts` (commit C3). Reverting C3 reverts all enforcement with zero src/ impact. Agent `.md` + src/ resolver can stay (harmless until wired).
- **Trim/store untouched:** audit uses the existing `appendEvent` (no schema migration) → no `store.ts` ALTER required, fully non-breaking.

---

## 9. Recommended commit sequence

> One focused commit per step; include `Co-Authored-By: Claude <noreply@anthropic.com>`.

- **C1 — `feat(permissions): add permission-mode types + pure resolvers (src)`**
  `src/types.ts` (+ re-export + optional `permissionMode` on `IthAgent`), `src/permissions.ts`, `src/extension-trust.ts`, `src/redact.ts`, `src/config.ts` (default/strict), `src/team.ts` (planRun opt), `src/types-sprint-3.2.ts` (`AgentDefinition.permissions?`), harness imports + `scripts/smoke-src/29-permissions.mjs`. No behavior change yet (dispatch still uses `agent.tools`).
- **C2 — `feat(agents): declare permission modes in roster frontmatter`**
  `extensions/agents/{explore,plan,verification,reviewer,writer}.md` (`permission:` + `allow:` per §5).
- **C3 — `feat(dispatch): resolve + enforce permissions at spawn; audit + redact`**
  `extensions/ithacus-agents.ts` (parse `permissions`), `extensions/ithacus-dispatch.ts` (resolve/ceiling/enforce/audit), `extensions/ithacus-live.ts` (redact). **This commit flips enforcement on.**
- **C4 — `chore: bump ithacus 0.6.0 → 0.6.1`**
  `package.json` version bump (one PATCH per sprint, CLAUDE.md §3). (Optionally run `scripts/deploy.sh` for the auto patch.)

After each commit run the §6.3 gates. C3 is the only behavior-changing commit and the sole rollback target.

---

*Plan generated by the ithacus plan agent. No code was written; this document is the deliverable.*
