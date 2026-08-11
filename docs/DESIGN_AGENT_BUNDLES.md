# DESIGN_AGENT_BUNDLES.md — Sprint 5.12.5: npm-shipped agent bundles with version-gated seeding

> **Status**: SPEC COMPLETE — ready to implement.
> **Parent sprint**: Sprint 5.12 (Local Web Dashboard). This is a 5.12.x sub-item
> that closes the "agents ship but never land in the target repo" gap.
> **Provenance**: borrows the *agent presets* pattern from claw-code
> (`docs/RESEARCH_EXTERNAL_SOURCES.md` §1.1) — adapted to ithacus's
> zero-network, npm-only distribution model.
> **Guardrail framing**: PREVENT-ITH-004 (no network in seeding) + PREVENT-DIST-001
> (npm-only distribution). See §10.

---

## 1. Goal & non-goals

### Goal
When `pi install npm:ithacus` drops the extension into a *target* repo, every
bundled definition in `extensions/agents/*.md` — including
`{explore,plan,verification,reviewer,writer}.md` for the 0.4.0 payload — must be
**seeded into that repo's `.pi/ithacus/agents/`** on extension activation,
**version-gated** so a newer package upgrades untouched files, and **protected** so
a user's local edits are never destroyed. Every bundled def must also be **validated
before publish** so a broken frontmatter file can never ship.

Dynamic setup discovery is a 0.4.0 release requirement, not follow-up polish:
`/ithacus-setup` must derive its complete model/provider binding roster from a fresh
`discoverIthacusAgents()` result whenever setup is entered or refreshed. It must
never maintain a hard-coded role array. Consequently, a newly npm-bundled and seeded
definition such as `writer` appears immediately after upgrade and can be bound
without another setup code change.

### Non-goals
- NOT implementing Sprint 5.21's arbitrary-role team composition schema, slots,
  sizing, or execution. Sprint 5.12.5 only discovers and configures arbitrary agent
  definition names; the legacy `AgentRole`, `ModePreset`, and fixed tiny–mega team
  planning contracts remain narrowly unchanged unless a minimal compatibility type
  widening is proven necessary.
- NOT a config sync / push mechanism to other machines. Seeding is strictly
  per-target-repo, local-fs only.
- NOT a runtime network fetch of agent defs (forbidden by PREVENT-ITH-004).
- NOT changing the markdown frontmatter schema (name/description/tools/model) —
  only validating it.
- NOT touching `discoverIthacusAgents`'s name-merge semantics beyond adding the
  `.local.md` override tier.

---

## 2. Problem to solve (recap)

1. Bundled `extensions/agents/*.md` resolve only from the *package checkout's own*
   dir. When installed via `pi install npm:ithacus` into another repo, the user
   gets whatever tarball shipped but **nothing is written into the target repo**
   (no `.pi/ithacus/agents/`), so there is no project-side artifact a user can
   edit and commit.
2. **No upgrade path**: if a new version ships a better `explore.md`, the target
   repo has no way to receive it.
3. **No user-edit protection**: if seeding blindly overwrote, user edits would be
   destroyed.
4. **No validation gate**: a malformed frontmatter file could ship to npm.

---

## 3. Design requirements (covers all 10 from the task)

| # | Requirement | Where handled |
|---|-------------|---------------|
| 1 | Bundling in npm package (package.json `files`, npm-only) | §4 |
| 2 | Seed-on-activate + version stamp | §5, §6 |
| 3 | Upgrade semantics + user-edit protection (manifest hash) | §5, §6 |
| 4 | `.local.md` override escape hatch (resolution order) | §7 |
| 5 | `src/agent-bundles.ts` pi-agnostic module + `src/agent-bundles.test.ts` | §8 |
| 6 | `regression_check.py` validates every bundled def | §9 |
| 7 | `deploy.sh` pre-publish bundle validation + pack dry-check | §9 |
| 8 | Upgrade-path test (unit + manual) | §8.2, §11 |
| 9 | Sprint plan entry (Tier 6) | §12 |
| 10 | Guardrails (ITH-004 / DIST-001) | §10 |
| 11 | Dynamic `/ithacus-setup` roster from `discoverIthacusAgents()` | §7.1, §8.3 |
| 12 | Bidirectional add/remove discovery semantics with no silent deletion | §5.4 |
| 13 | `writer.md` + docs-only-write `plan.md` in the 0.4.0 bundled source of truth | §4 |

---

## 4. Requirement 1 — Bundling

`package.json` already whitelists the agents via `"files": ["dist/", "extensions/agents/*.md"]`.
This sprint **confirms and hardens** that:

- Keep `extensions/agents/*.md` in `files`. Do **not** rely on filesystem links or
  archive handoffs — PREVENT-DIST-001 mandates npm-only distribution.
- The 0.4.0 npm payload **must include** `extensions/agents/writer.md`. Writer is a
  first-class bundled/seeding input in this release, not merely a future example.
- The bundled `extensions/agents/plan.md` **must be updated in the package source of
  truth** to define the docs-only-write planning role: it may create/edit Markdown
  under `docs/` and must prohibit writes elsewhere. A copy that exists only in one
  checkout's `.pi/ithacus/agents/` local state does not satisfy release acceptance.
- `deploy.sh` already asserts `extensions/agents/explore.md` is in its npm payload
  dry-check output (step 2b). This sprint generalizes that check to **all** bundled
  `extensions/agents/*.md`, specifically including `writer.md` and the updated
  `plan.md` (see §9.2).
- Packaging, seeding, discovery, setup, and validation all enumerate the actual
  bundled/project definitions; none may encode an expected fixed roster count.

---

## 5. Requirement 2 & 3 — Seeding, version stamp, upgrade semantics

### 5.1 Target layout (in the target repo)

```
<repo>/.pi/ithacus/agents/
  explore.md            # seeded / user-editable
  plan.md
  verification.md
  reviewer.md
  .bundle-version       # plain text: the package version that last seeded
  .bundle-manifest.json # { "seededBy": "<pkgVersion>", "agents": { "<name>.md": "<sha256>" } }
```

- `.bundle-version` — single line, the `version` of the ithacus package that last
  seeded (read from the package's own `package.json`, same source as
  `ownVersion()` in `ithacus-version.ts`).
- `.bundle-manifest.json` — maps each seeded `<name>.md` filename to the **sha256
  of the exact bytes** that were seeded. This is the tamper/user-edit detector.

### 5.2 Seed algorithm (`seedBundledAgents`, see §8.1)

Inputs (injected, pi-agnostic): `bundledDir`, `projectAgentsDir`, `packageVersion`.

```
read stamp = readFile(.bundle-version) or null
manifest = readJson(.bundle-manifest.json) or { agents: {} }
upgrade = stamp != null && semverCompare(packageVersion, stamp) > 0

for each <name>.md in bundledDir:
    target = projectAgentsDir/<name>.md
    bundledHash = sha256(bundled content)

    if target does NOT exist:
        copy in; manifest.agents[<name>.md] = bundledHash   # first seed/new agent
    else if upgrade AND manifest has a prior hash
            AND sha256(target) === manifest.agents[<name>.md]:
        copy in; manifest.agents[<name>.md] = bundledHash   # untouched, safe upgrade
    else:
        preserve target                                    # pre-existing or user-edited
        if upgrade: report it in skippedModified

if stamp is null OR upgrade:
    atomically write .bundle-version = packageVersion
if any file was seeded/upgraded OR stamp is null OR upgrade:
    atomically write .bundle-manifest.json with updated hashes
# downgrade: preserve stamp and existing files; missing-agent adoption may update manifest
```

### 5.4 Bidirectional discovery and retention semantics

- **Added bundled type:** package upgrade exposes it through bundled discovery; the
  seed pass creates a missing project definition; the next `/ithacus-setup` roster
  refresh displays it and permits model/provider binding immediately.
- **Added project type:** creating a valid project agent definition makes it
  discoverable and configurable on the next discovery call, without changing an
  extension role list.
- **Removed bundled type:** seeding and upgrade logic never deletes or prunes its
  project definition. While that project file exists, discovery and setup continue
  to show it as a project agent, even if the package no longer bundles that name.
- **Removed project type:** disappearance is explicit because the user removed the
  project definition; setup reflects the next discovery result. Ithacus does not
  silently rewrite another config file to erase bindings.
- No setup, seed, validation, or upgrade path may silently delete agent markdown,
  model/provider frontmatter, manifest ownership history, or other project config.
  Removal from the npm bundle is not authorization to remove project state.

**Invariants (the safety contract):**
- First activation copies **missing files only**. A pre-existing `<name>.md` with no
  trustworthy manifest hash is conservatively treated as user-owned and preserved.
- A file is **only overwritten** when its current sha256 equals the recorded seeded
  hash (i.e. the user never touched it).
- A modified file is **never** removed or overwritten. Its manifest entry retains
  the prior seeded hash; it is never replaced with the user's content hash.
- The core returns `skippedModified`; the extension adapter emits a friendly notice
  (`console.log`, pre-TUI, like `maybeShowVersionBump`). Logging is not hidden in
  the pi-agnostic module.
- Stamp and manifest writes use temp-file + rename in the same directory so an
  interrupted activation cannot leave partial JSON. Per-file copy is likewise
  temp-file + rename.
- Seeding is **best-effort**: expected fs failures (read-only dir, permission) are
  represented in `SeedResult.errors` and caught by the activate adapter so extension
  activation can never be blocked. (Same posture as `ithacus-version.ts`.)
- An unreadable/malformed manifest is untrusted: preserve existing files, seed only
  missing files, and report the manifest error. Never infer ownership without a hash.

### 5.3 Semver comparison
A small `semverCompare(a, b)` helper returns -1/0/1 using `a.split(".").map(Number)`
on the leading `major.minor.patch` (ignores pre-release/build for the gate decision).
Pure, no deps.

---

## 6. Requirement 2 — Wiring seeding into activate()

In `extensions/ithacus.ts`, the extension entry is the `default function (pi)` — this
is the actual activation hook (the file is currently only ~53 lines; the prompt's
line estimate is stale). Add the call after `loadConfig`/`new IthRuntime`, before
command registration:

```ts
import { seedBundledAgents } from "../src/agent-bundles.js";
import { bundledAgentsDir, projectAgentsDir } from "./ithacus-agents.js";
// ...
const seed = seedBundledAgents({
  bundledDir: bundledAgentsDir(),
  projectAgentsDir: projectAgentsDir(),
  packageVersion: ownVersion(),
});
for (const name of seed.skippedModified) console.log(/* preserved-edit notice */);
```

Export the two existing path helpers from `extensions/ithacus-agents.ts`; the adapter
injects paths and the already-existing `ownVersion()`. This honors the requirement
that `src/agent-bundles.ts` contain all **seeding/manifest decisions** while remaining
pi-agnostic and easy to unit test. The extension owns package-layout resolution and
user-facing notices; `src/` owns no pi/package-layout assumptions.

---

## 7. Requirement 4 — `.local.md` override escape hatch

Resolution order in `extensions/ithacus-agents.ts` `discoverIthacusAgents()` becomes:

**user-owned repo `<name>.md` > `<name>.local.md` > untouched seeded `<name>.md` > package bundled**

The manifest distinguishes the otherwise-identical repo path:
- `<name>.md` whose hash differs from its manifest hash (or has no manifest entry)
  is a user-owned repo override and remains highest priority.
- `<name>.md` whose hash equals the manifest hash is an untouched seeded copy;
  `<name>.local.md` wins over it.
- package `extensions/agents/<name>.md` remains the final fallback if no repo file
  is usable.

Implement this as a small classification/merge change in `discoverIthacusAgents()`:
load package bundled defs, seeded/user repo defs, local defs, and the bundle manifest;
then merge per name in the order above. Reuse the exported hash/manifest readers from
`src/agent-bundles.ts` rather than duplicating ownership logic. `loadAgentsFromDir`
gains an optional suffix filter (`".local"` loads only `*.local.md`; default excludes
`*.local.md` and dotfiles). The `.local.md` file is never written by seeding.

Required focused resolver cases: untouched seeded + `.local.md` resolves local;
modified `<name>.md` + `.local.md` resolves modified `<name>.md`; no repo files
resolves the package bundled def.

---

### 7.1 Dynamic `/ithacus-setup` binding roster

`extensions/ithacus-setup.ts` currently has the only fixed roster bottleneck:
`const ROLES = ["explore", "plan", "verification", "reviewer"]`. Discovery and
dispatch are already dynamic. Sprint 5.12.5 must remove that setup-only list and
build the binding choices from `discoverIthacusAgents()` at setup entry and after
operations that can change the visible roster. Agent names remain strings from the
discovered definitions; selection must resolve against that same snapshot or a
fresh discovery result before writing the project override.

The saved binding remains the selected agent's project markdown frontmatter
(`model` and `provider`), preserving the existing persistence model. Setup must not
introduce a second role-binding registry. The roster should be deterministically
ordered (for example, normalized name sort), handle an empty discovery result with
a visible message, and avoid unsafe display-label parsing when mapping `Bind: <name>`
back to an agent. If `extensions/ithacus-commands.ts` parses agent/role tokens for a
surface that is part of this setup/configuration flow, replace its fixed-name parser
with discovery-based parsing; do **not** widen unrelated legacy team-mode parsing.

This dynamic configuration surface deliberately stops short of Sprint 5.21. Sprint
5.21 (`DESIGN_TEAMS_AND_SIZES.md`) is where arbitrary discovered agent names become
team composition roles/slots, with schema, persistence, validation, sizing, and
execution changes.

## 8. Requirement 5 — `src/agent-bundles.ts` (pi-agnostic) + tests

### 8.1 Module surface (`src/agent-bundles.ts`)

Pure Node-built-ins only (`node:fs`, `node:path`, `node:crypto`). **No pi import,
no network.** Exports (all accept injected paths so they are unit-testable):

```ts
export const AGENT_TOOL_ALLOWLIST: ReadonlySet<string> =
  new Set(["read", "grep", "find", "ls", "bash", "edit", "write", "ithacus-mailbox"]);

export interface AgentBundleManifest { seededBy: string; agents: Record<string, string>; }
export interface SeedResult {
  seeded: string[]; upgraded: string[]; skippedModified: string[]; errors: string[];
}
export interface SeedOptions {
  bundledDir: string; projectAgentsDir: string; packageVersion: string;
}

export function sha256(content: Buffer | string): string; // exact content bytes
export function semverCompare(a: string, b: string): number; // -1|0|1
export function parseFrontmatter(content: string): { frontmatter: Record<string,string>; body: string };
export function validateAgentFile(content: string, filename: string): string[]; // [] = ok; errors[]
export function readManifest(dir: string): AgentBundleManifest | null;
export function seedBundledAgents(options: SeedOptions): SeedResult; // §5.2
```

`validateAgentFile` (shared shape with `regression_check.py`, see §9):
- frontmatter parses (must start with `---` … `---`),
- required keys present: `name`, `description`, `tools`, `model`,
- every token in `tools` is in `AGENT_TOOL_ALLOWLIST`,
- `name` (after trim) === filename stem (e.g. `explore.md` → `explore`).
Returns a list of human-readable error strings (empty = valid).

### 8.2 Test file (`src/agent-bundles.test.ts`)

`node --test` + `node:test` + `node:assert`, temp dirs via `os.tmpdir()` +
`crypto.randomUUID()`. No external deps (matches `scripts/smoke-src.mjs` runner).
Cases:

1. **First seed**: empty project dir → every fixture definition is copied;
   `.bundle-version` equals `packageVersion`; `.bundle-manifest.json` has one correct
   sha256 entry per discovered fixture. No assertion hard-codes four agents.
2. **Idempotent re-seed** (same version): no file changes; all result lists and
   `errors` are empty; stamp and manifest bytes remain unchanged.
3. **Upgrade untouched**: first seed v0.4.0, replace bundle fixture content, then
   activate v0.4.1 → every untouched definition shows in `upgraded`, files equal
   the new bundle, and the stamp updates; expected counts derive from fixtures.
4. **User edit preserved** (the §11 scenario): seed v0.4.0; user edits `explore.md`
   (content hash no longer matches manifest); seed v0.4.1 → `explore.md` is in
   `skippedModified`, its bytes unchanged; every other fixture upgrades.
5. **New-agent adoption**: add `writer.md` after the initial seed → `writer.md` is
   seeded, discovered, and available to setup on the next activation/refresh.
6. **`validateAgentFile`**: valid file → `[]`; missing `model` → error; unknown
   tool (`rm`) → error; `name: Explorer` in `explore.md` → name/filename mismatch error.
7. **Pre-existing file on first activation**: put user-authored `explore.md` in
   an unstamped target → it is preserved; every missing fixture is seeded.
8. **Corrupt/missing manifest**: existing files are preserved, missing files seed,
   and an error is returned; no ownership is guessed.
9. **Downgrade**: v0.4.1 stamp + v0.4.0 package makes no overwrite and does not
   move the stamp backward.
10. **`.local.md` precedence** (resolver-focused test): untouched seeded +
   `explore.local.md` resolves local; modified `explore.md` resolves that repo
   override over `.local.md`; package bundled is fallback.
11. **Removed-bundle retention**: seed a definition, remove it only from the bundle
   fixture, upgrade, and assert its project file is not deleted and remains visible
   through `discoverIthacusAgents()`.
12. **Bundled source requirements**: validation/payload checks require
   `extensions/agents/writer.md` and verify bundled `plan.md` carries the
   docs-only-write role instructions rather than relying on `.pi` local state.

### 8.3 Extension smoke coverage for dynamic setup

Update `scripts/smoke-ext.mjs` to copy and count the actual `extensions/agents/*.md`
fixture roster rather than asserting `4`. Import/register the real setup module with
an injected/fake UI and provider/model fixture, then assert:

- every discovered bundled/project name appears as a bindable setup choice;
- adding `writer.md` makes `writer` appear without changing setup source;
- a project-only custom agent is bindable;
- removing a name from the bundle does not hide or delete its surviving project
  definition;
- selecting an agent writes `model` and `provider` to that agent's project
  frontmatter and does not alter/delete another agent definition;
- compiled/published-layout discovery assertions use dynamic expected counts and
  explicitly verify `writer` and the updated `plan` payload.

Where `extensions/ithacus-commands.ts` has applicable fixed role-token parsing,
cover its discovery-based behavior. Keep tiny–mega/team assertions fixed because
those are legacy team-schema behavior deferred to Sprint 5.21.

---

## 9. Requirement 6 & 7 — validation gates

### 9.1 `scripts/regression_check.py` — bundle validation in the normal gate

Add `validate_agent_bundles(repo_root)` and call it on **every normal invocation**
(including the existing `--all` used by `npm run regression`), so malformed bundles
fail the ordinary gate, not only publish. Also add `--validate-agent-bundles` as a
bundle-only mode for `deploy.sh` reuse.

- Locates `extensions/agents/` relative to the script-derived repo root; globs
  `*.md`; zero files is itself an error.
- For each file: implement the same simple frontmatter parser/validator in Python
  (self-contained; no PyYAML dependency). Reject missing/unterminated delimiters,
  malformed key lines, missing required keys (`name`, `description`, `tools`,
  `model`), empty values, unknown tools, and name/filename mismatch.
- Allowlist (Python constant, kept in sync with `AGENT_TOOL_ALLOWLIST`):
  `{"read","grep","find","ls","bash","edit","write","ithacus-mailbox"}`.
- Validation issues always exit non-zero, even without `--pre-commit` (unlike the
  historical advisory regression findings), and print per-file errors.
- Usage: `python3 scripts/regression_check.py --validate-agent-bundles` performs
  only this validation; `python3 scripts/regression_check.py --all` performs both
  bundle validation and the existing regression scan.

> **Sync contract**: the Python allowlist and the TS `AGENT_TOOL_ALLOWLIST` must
> list the same tokens. A comment in both flags this. Plan author: when adding a
> tool, edit both.

### 9.2 `scripts/deploy.sh` — pre-publish bundle validation + pack dry-check

Insert a new step **between the full gate (step 2) and the existing npm payload
verify (step 2b)** (i.e. right after `node scripts/schema-health-check.mjs`):

```bash
# --- 2b0. agent-bundle validation + pack dry-check (Sprint 5.12.5) ------------
echo "[deploy] validating bundled agent defs (frontmatter + tool allowlist)"
python3 scripts/regression_check.py --validate-agent-bundles
echo "[deploy] agent-bundle validation OK."
```

And generalize the existing step-2b pack loop to assert **every** bundled
`extensions/agents/*.md` is in the tarball (replace the single `explore.md`
requirement with a loop over the actual files):
```bash
shopt -s nullglob
for f in extensions/agents/*.md; do
  if ! grep -qF "$f" <<<"$PACK_LIST"; then
    echo "[deploy] ERROR: npm payload missing '$f' — package would be broken." >&2
    exit 1
  fi
done
shopt -u nullglob
echo "[deploy] npm payload verified (all extensions/agents/*.md present)."
```
No `npm publish` side effect is added; the existing local npm payload dry-check
is only inspected and asserted. Pure local checks remain PREVENT-ITH-004 friendly.

---

## 10. Requirement 10 — Guardrails

| Rule | How the design honors it |
|------|--------------------------|
| **PREVENT-ITH-004** (critical, no external service / no network in extension source) | All seeding logic lives in `src/agent-bundles.ts` using **only `node:fs`, `node:path`, `node:crypto`** — zero `fetch`/`https`/`execSync`/spawn. Seeding is pure local-fs copy + hash. `deploy.sh` validation and payload inspection are local read-only checks — no publish, no network. `regression_check.py` is fully offline. No runtime network call is introduced. |
| **PREVENT-DIST-001** (error, npm-only distribution) | Agents ship exclusively via the npm `files` whitelist (`extensions/agents/*.md`); install is `pi install npm:ithacus`; `deploy.sh` publishes only through npm. No alternate archive or filesystem-link handoff. Seeding copies *from the installed package's own bundled dir* — the package is the single source of truth. |
| **PREVENT-ITH-001/002/003** | Not in scope (these govern context trimming / system-role injection). Seeding only writes agent-def markdown + two dotfiles; it never touches message history, so it cannot violate the anchor-floor, tool-pair, or system-role rules. Noted so the audit stays clean. |

`// guardrails-allow` annotations: **none required** — seeding introduces no network
call, so no PREVENT-ITH-004 exception is needed.

---

## 11. Requirement 8 — Testing the upgrade path (unit + manual)

### 11.1 Unit (covered by §8.2 cases 3 & 4)
`v0.4.0 seeds → user edits explore.md → v0.4.1 activate`:
- assert `explore.md` bytes are **unchanged** vs the user edit,
- assert `explore.md` appears in `SeedResult.skippedModified`,
- assert every untouched definition appears in `upgraded` and equals the v0.4.1
  bundled content,
- assert `.bundle-version` equals `0.4.1`; manifest hashes match the new bytes for
  every upgrade, while `explore.md` retains its **v0.4.0 seeded hash** (not the
  user's edited hash).

### 11.2 Manual end-to-end (for the release notes)
1. On device A: `pi install npm:ithacus@0.4.0` into repo R. Confirm every
   packaged agent — including `writer.md` and updated `plan.md` — exists under
   `R/.pi/ithacus/agents/`, together with `.bundle-version` (0.4.0) and
   `.bundle-manifest.json`.
2. User opens `R/.pi/ithacus/agents/explore.md` and edits the system prompt; saves.
3. Publish `ithacus@0.4.1` with an improved `explore.md` (and a tweaked `plan.md`).
4. On device A: `pi install npm:ithacus@0.4.1`, restart pi in R.
5. Confirm: the edited `explore.md` is **preserved** (user's text intact, manifest
   still records old hash for it), `plan.md` is **upgraded** to the new bundled
   content, `.bundle-version` now reads `0.4.1`, and a one-line console notice says
   the edited `explore.md` was kept.
6. Escape hatch check: drop `R/.pi/ithacus/agents/explore.local.md`; confirm
   `discoverIthacusAgents()` resolves `explore` → the `.local.md` body, not the
   seeded one.

---

## 12. Requirement 9 — Sprint plan entry (Tier 6)

The Tier 6 Sprint 5.12.5 entry in `docs/SPRINT_PLAN.md` is the release-facing
acceptance summary. It must stay aligned with this design: dynamic setup roster,
bidirectional add/remove retention semantics, required writer/plan package source,
dynamic smoke counts, the exact implementation scope, and the Sprint 5.21 team
composition boundary.

---

## 13. File change list (dependency order)

1. `extensions/agents/writer.md` — new bundled/seeding source definition required
   in the 0.4.0 npm payload.
2. `extensions/agents/plan.md` — update the bundled source to the docs-only-write
   planning role; do not rely on a `.pi` local override.
3. `src/agent-bundles.ts` — new pi-agnostic seed/manifest/hash/validation logic;
   enumerate definitions dynamically and never prune removed bundled names.
4. `src/agent-bundles.test.ts` — unit coverage for dynamic counts, add/remove
   semantics, upgrade preservation, and validation (§8.2).
5. `extensions/ithacus-agents.ts` — export injected path helpers and preserve
   manifest-aware dynamic bundled/project/`.local.md` resolution (§7).
6. `extensions/ithacus-setup.ts` — remove `ROLES`/`Role`; derive every bindable
   model/provider row from `discoverIthacusAgents()` and persist bindings in the
   selected project definition frontmatter (§7.1).
7. `extensions/ithacus-commands.ts` — where applicable, replace fixed agent-name
   token parsing with discovery-based parsing; leave legacy team preset parsing
   and team composition types unchanged for Sprint 5.21.
8. `extensions/ithacus.ts` — call injected `seedBundledAgents(...)` in activation
   and emit preservation notices (§6).
9. `scripts/smoke-ext.mjs` — setup/discovery smoke coverage; replace fixed roster
   count assertions with fixture-derived counts; verify writer/plan in source and
   published layouts (§8.3).
10. `scripts/regression_check.py` — `--validate-agent-bundles` mode (§9.1).
11. `scripts/deploy.sh` — pre-publish validation + generalized payload dry-check
    that requires every definition, including writer and updated plan (§9.2).
12. `src/types.ts`, `src/config.ts`, `src/team.ts` — no broad arbitrary-role/team
    widening in this sprint. Change only if a narrow setup/discovery compatibility
    need is demonstrated; Sprint 5.21 owns dynamic composition schemas and slots.
13. `docs/SPRINT_PLAN.md` — amend Sprint 5.12.5 release acceptance.
14. `docs/DESIGN_TEAMS_AND_SIZES.md` — cross-reference the 5.12.5 discovery/config
    baseline and retain Sprint 5.21 ownership of dynamic team composition.
15. `docs/DESIGN_AGENT_BUNDLES.md` — this specification.

---

## 14. Risks & rollback

- **Risk**: a future bundled def edit changes a seeded file the user *did* want to
  keep but they only changed whitespace → hash mismatch → treated as "user edit",
  not upgraded. *Mitigation*: this is the safe default (never clobber); user can
  delete their copy to receive the upgrade, or use `.local.md`. Documented.
- **Risk**: `.bundle-manifest.json` / `.bundle-version` committed by the user into
  their repo and then drift. *Mitigation*: seed only updates them; never deletes
  user `<name>.md`. They are plain dotfiles; safe to gitignore.
- **Rollback**: revert the 7 files above (one focused commit per task, per CLAUDE.md
  §3). Seeding is additive — reverting leaves previously-seeded files in place but
  stops further upgrades (no data loss). `git checkout HEAD -- <file>` per
  AGENT_GUARDRAILS.md Quick Reference.
- **Risk**: Python version on the publish machine. *Mitigation*: use only
  stdlib (`argparse`, `json`, `re`, `hashlib`, `pathlib`) — available on the same
  Python 3.x already running `regression_check.py` today.

---

## 15. Acceptance criteria

- [ ] `node --experimental-strip-types --test src/agent-bundles.test.ts` passes
      (all §8.2 cases).
- [ ] `python3 scripts/regression_check.py --validate-agent-bundles` exits 0 on
      current `extensions/agents/*.md` and non-zero if a def is broken.
- [ ] `bash scripts/deploy.sh` payload preflight asserts every
      `extensions/agents/*.md` file is present.
- [ ] A manual 5.11→5.12.5 install reproduces the §11.2 upgrade-without-clobber
      behavior.
- [ ] `/ithacus-setup` has no hard-coded agent-name roster and renders every fresh
      `discoverIthacusAgents()` result as bindable model/provider choices.
- [ ] Adding bundled/seeded `writer.md` or a project-only agent requires no setup
      code edit; removing a bundled name never deletes or hides its surviving
      project definition and never silently deletes binding config.
- [ ] The 0.4.0 npm payload contains `extensions/agents/writer.md` and the bundled
      `extensions/agents/plan.md` source defines the docs-only-write planning role.
- [ ] `scripts/smoke-ext.mjs` covers dynamic setup discovery and uses dynamic
      roster counts; applicable command parsing is discovery-based while legacy
      team composition remains fixed pending Sprint 5.21.
- [ ] Guardrails gate (`npm run gate`) still green — no new network calls, npm-only.
