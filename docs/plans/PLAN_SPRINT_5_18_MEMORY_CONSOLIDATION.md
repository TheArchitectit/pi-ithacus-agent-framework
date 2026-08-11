# Plan — Sprint 5.18 Memory Consolidation

## Goal

Implement the Trident-style memory consolidation pipeline (Supersede → Collapse →
Cluster) over `ith_memories`, purely in `src/` (pi-agnostic, zero network), with
a dry-run `ConsolidationPlan` that is only persisted when the caller commits it.
Wire a manual `/ithacus-memory consolidate` command (dry-run first, `--apply`
commits). Keep the original entry `text` immutable; consolidation only ADDS
metadata columns (`superseded_by`, `collapsed_into`, `cluster_tag`).

## Non-goals

- No semantic/vector search, no embeddings, no external service (PREVENT-ITH-004).
- No cross-repo memory federation.
- No changes to message trimming, anchor floors, or tool-call/result pairing
  (PREVENT-ITH-001 / PREVENT-ITH-002 are unaffected).
- No `role:"system"` injection — consolidation is data/metadata only
  (PREVENT-ITH-003 honored by construction).
- Auto-consolidation via `createScheduler` is **optional** (design marks it
  optional); the committed scope is the manual command. Auto-trigger is
  described as a follow-up extension step, not in the primary commit sequence.

## Key architectural finding (design-doc deviation — read first)

`docs/DESIGN_MEMORY_CONSOLIDATION.md` §3 lists `src/store.ts` for the 3 new
columns + `applyConsolidation`. That doc predates the **Sprint 3.1 split**:
`ith_memories` is now owned by **two** classes:

- `IthStore` (`src/store.ts`) — base `IthMemory` rows; `migrateSchema()` runs on
  **every** store open (the canonical, always-on migration path).
- `HindsightStore` (`src/store-hindsight.ts`) — hindsight columns
  (`agentId`, `runId`, `relevance`, `reflected`) and `retain/recall/reflect`,
  which is what consolidation builds on.

Routing decision (faithful to intent, correct for current code):

| Concern | File | Why |
|---|---|---|
| Add 3 columns (`superseded_by`, `collapsed_into`, `cluster_tag`) | `src/store.ts` `IthStore.migrateSchema()` | ALTER must run even when only `IthStore` is opened (no `HindsightStore`), so recall filters never hit missing columns. |
| `applyConsolidation(plan)` + `recallForConsolidation(repoId)` + recall filter | `src/store-hindsight.ts` `HindsightStore` | Hindsight columns + hindsight `recall()` are the consolidation targets; design's "hindsight recall() filters" is satisfied here (and `hindsight.ts recall()` delegates to it, so it needs **no edit**). |
| `consolidate()` pure pipeline + plan types | `src/consolidate.ts` (NEW) | pi-agnostic, pure. |
| `MemoryRecord` type | `src/types-sprint-5.18.ts` (NEW) + re-export `src/types.ts` | matches established `types-sprint-*.ts` split pattern. |
| `consolidation` config block | `src/config.ts` | additive, optional field + defaults helper. |
| `/ithacus-memory consolidate` | `extensions/ithacus-commands.ts` | command wiring; instantiates `new HindsightStore(runtime.store.db)` (same pattern as `SwarmStore`/`PresenceStore`). |

`src/hindsight.ts` requires **no change**: its `recall()` calls
`HindsightStore.recall`, which gains the filter.

## Files to change/create (dependency order)

### 1. `src/types-sprint-5.18.ts` — NEW
Pure type declarations only (no logic), re-exported by `src/types.ts`.

```ts
/** Minimal structural shape consumed by the consolidation pipeline.
 *  `HindsightEntry` (Sprint 3.1) is structurally compatible. */
export interface MemoryRecord {
  id: string;
  repoId: string;
  agentId: string;
  runId: string;
  kind: string;
  text: string;
  relevance: number;
  reflected: boolean;
  ts: number;
}

export type ConsolidationAction = "supersede" | "collapse" | "cluster";

export interface SupersedePlanEntry {
  action: "supersede";
  id: string;            // entry being marked obsolete
  supersededBy: string;  // successor id, or "" if no successor
  reason: string;
}
export interface CollapsePlanEntry {
  action: "collapse";
  id: string;            // entry being collapsed
  collapsedInto: string; // survivor id
}
export interface ClusterPlanEntry {
  action: "cluster";
  id: string;
  clusterTag: string;
}
export interface ConsolidationPlan {
  supersede: SupersedePlanEntry[];
  collapse: CollapsePlanEntry[];
  cluster: ClusterPlanEntry[];
}

export interface ConsolidateOptions {
  /** token-overlap ≥ this merges near-duplicates (same run/kind/window). */
  collapseThreshold: number; // 0..1
  /** token-overlap ≥ this groups into a centroid cluster tag. */
  clusterThreshold: number;  // 0..1
  /** max age gap (ms) for two entries to be collapse-eligible. */
  windowMs: number;
}

export interface ConsolidationConfig {
  collapseThreshold: number;
  clusterThreshold: number;
  windowMs: number;
  autoThreshold: number; // active-entry count that triggers auto-consolidation
}
```

`src/types.ts`: add `export type { MemoryRecord, ConsolidationPlan, ConsolidateOptions, ConsolidationConfig, ... } from './types-sprint-5.18.js';` (alphabetized with the other sprint re-exports).

### 2. `src/consolidate.ts` — NEW (pure, pi-agnostic)
No DB, no pi types. Imports only `MemoryRecord`, plan types, and
`scoreRelevance` from `./hindsight.js`.

```ts
import type { MemoryRecord, ConsolidationPlan, ConsolidateOptions,
  SupersedePlanEntry, CollapsePlanEntry, ClusterPlanEntry } from './types-sprint-5.18.js';
import { scoreRelevance } from './hindsight.js';

/** Entries whose text signals obsolescence. */
export const SUPERSEDE_BY_RE = /SUPERSEDED BY\s+([\w:-]+)/i;
export const SUPERSEDE_KEYWORDS = ["OBSOLETE", "DEPRECATED", "NO LONGER VALID"];

/** Symmetric token overlap in [0,1] using scoreRelevance as the kernel. */
export function overlap(a: MemoryRecord, b: MemoryRecord): number;

/** True iff `text` carries a supersede marker. Returns the successor id ("" for none). */
export function parseSupersedeMarker(text: string): { obsolete: boolean; supersededBy: string };

/**
 * Produce a dry-run ConsolidationPlan for `memories` (expected to be the
 * ACTIVE set only — callers must exclude already-superseded/collapsed rows so
 * the pipeline is idempotent across runs). NEVER mutates `memories`.
 */
export function consolidate(memories: MemoryRecord[], opts: ConsolidateOptions): ConsolidationPlan;
```

Pipeline semantics (inside `consolidate`):
- **Pass 1 — SUPERSEDE**: for each entry, `parseSupersedeMarker(text)`; if
  `obsolete`, emit `SupersedePlanEntry{ id, supersededBy, reason }`.
  `reason` = `"SUPERSEDED BY <id>"` or `"keyword:<KW>"`.
- **Pass 2 — COLLAPSE**: consider only non-superseded entries; group by
  `(runId, kind)`; within each group, connect two entries if
  `|a.ts - b.ts| <= windowMs` AND `overlap(a,b) >= collapseThreshold`
  (connected components). For each component with >1 member, choose survivor =
  max by `(relevance, ts)`; remaining members get
  `CollapsePlanEntry{ id, collapsedInto: survivor.id }`. Original `text` of the
  survivor is untouched (design anti-pattern guard: never rewrite text).
- **Pass 3 — CLUSTER**: consider remaining active, non-superseded,
  non-collapsed entries; union-find by `overlap(a,b) >= clusterThreshold`
  (any run/kind, same `repoId`). For each cluster (size ≥ 2), compute a
  synthetic, deterministic `clusterTag` (e.g.
  `cluster:<repoId>:<stableHashOfMemberIdsSorted>` — reuse an existing hash
  helper or a small FNV-1a over the sorted member ids) and emit a
  `ClusterPlanEntry` per member.
- Return `{ supersede, collapse, cluster }`. Input array is not mutated.

### 3. `src/config.ts` — consolidation block
Add to `IthacusConfig` an **optional** `consolidation?: ConsolidationConfig`
(optional so existing inline config literals in tests/extensions keep compiling).
Add a defaults helper and read from env:

```ts
export function defaultConsolidationConfig(): ConsolidationConfig {
  return {
    collapseThreshold: envNum("ITHACUS_CONSOLIDATION_COLLAPSE", 0.75),
    clusterThreshold:  envNum("ITHACUS_CONSOLIDATION_CLUSTER", 0.5),
    windowMs:          envNum("ITHACUS_CONSOLIDATION_WINDOW_MS", 86_400_000),
    autoThreshold:     envNum("ITHACUS_CONSOLIDATION_AUTO", 500),
  };
}
```
In `loadConfig()`, set `consolidation: defaultConsolidationConfig()` and add a
`resolveConsolidation(cfg?: IthacusConfig): ConsolidationConfig` helper that
returns `cfg?.consolidation ?? defaultConsolidationConfig()` for callers that may
receive a partial config.

### 4. `src/store.ts` — `IthStore` schema + base recall filter
In `migrateSchema()`, idempotently add the three columns to `ith_memories`
(guarded by the existing `cols(table)` PRAGMA helper):

```ts
const memCols = cols("ith_memories");
if (!memCols.has("superseded_by")) this.db.exec(`ALTER TABLE ith_memories ADD COLUMN superseded_by TEXT`);
if (!memCols.has("collapsed_into")) this.db.exec(`ALTER TABLE ith_memories ADD COLUMN collapsed_into TEXT`);
if (!memCols.has("cluster_tag"))    this.db.exec(`ALTER TABLE ith_memories ADD COLUMN cluster_tag TEXT`);
```

Update both `IthStore.recall` queries to append
`AND superseded_by IS NULL AND collapsed_into IS NULL`. Keep signature
`recall(repoId, kind?, limit=8): IthMemory[]`. (Base `IthMemory` rows are never
consolidated, so this is a no-op for them but keeps the table consistent.)

### 5. `src/store-hindsight.ts` — `HindsightStore` recall filter + apply + recallAll
- `migrateHindsight()`: ensure the three columns exist (idempotent — same PRAGMA
  guard; defensive in case `IthStore` migration hasn't run, e.g. when a
  `HindsightStore` is opened directly in a test).
- `recall(repoId, opts?)`: append `AND superseded_by IS NULL AND collapsed_into IS NULL`
  to **both** SQL branches (kind / no-kind). This is the design's
  "hindsight recall() filters superseded/collapsed".
- NEW `recallForConsolidation(repoId): HindsightEntry[]` — returns **all active**
  entries for the repo with **no limit and no minRelevance** and **no**
  superseded/collapsed filter (consolidation must see the full active set to
  recompute clusters; already-superseded/collapsed rows are excluded so the
  pipeline stays idempotent):
  `SELECT * FROM ith_memories WHERE repoId = ? AND superseded_by IS NULL AND collapsed_into IS NULL`.
- NEW `applyConsolidation(plan: ConsolidationPlan): { superseded: number; collapsed: number; clustered: number }`
  — wraps all updates in a single transaction
  (`this.db.exec("BEGIN"); ...; this.db.exec("COMMIT")` with rollback on throw)
  and issues per-action `UPDATE ith_memories SET <col> = ? WHERE id = ?`:
  - supersede → `superseded_by = entry.supersededBy`
  - collapse  → `collapsed_into = entry.collapsedInto`
  - cluster   → `cluster_tag = entry.clusterTag`
  Returns counts of rows actually updated.

### 6. `extensions/ithacus-commands.ts` — `/ithacus-memory consolidate`
Uses the existing `registerCmd` helper (same wrapper pattern as
`/ithacus-swarm`). Add imports:
`import { HindsightStore } from "../src/store-hindsight.js";`
`import { consolidate } from "../src/consolidate.js";`
`import { resolveConsolidation } from "../src/config.js";`

```ts
registerCmd("ithacus-memory", async (args, ctx) => {
  const sub = (args as string)?.trim().split(/\s+/)[0] ?? "";
  if (sub !== "consolidate") return "usage: /ithacus-memory consolidate [--apply]";
  const apply = /--apply/.test(args ?? "");
  runtime.bindRepo(ctx.cwd);
  const repoId = runtime.repoId(ctx.cwd);
  const hs = new HindsightStore(runtime.store.db);
  const active = hs.recallForConsolidation(repoId);
  const cfg = resolveConsolidation(runtime.config);
  const plan = consolidate(active, {
    collapseThreshold: cfg.collapseThreshold,
    clusterThreshold: cfg.clusterThreshold,
    windowMs: cfg.windowMs,
  });
  const summary = `ithacus memory consolidation (dry-run): ${plan.supersede.length} supersede, ${plan.collapse.length} collapse, ${plan.cluster.length} cluster over ${active.length} active entries.`;
  if (!apply) return summary + "  Re-run with --apply to commit.";
  const res = hs.applyConsolidation(plan);
  return `ithacus memory consolidated: ${res.superseded} superseded, ${res.collapsed} collapsed, ${res.clustered} clustered.`;
});
```
(`runtime.config` and `runtime.store.db` already exist on `IthRuntime`; the
`SwarmStore(runtime.store.db)` precedent confirms the store-reuse pattern.)

### Optional follow-up (NOT in primary commits): auto-consolidation
If desired later, register a `createScheduler` one-shot/interval in
`extensions/ithacus-memory.ts` (or `ithacus-runtime.ts`) whose task counts
`hs.recallForConsolidation(repoId).length` and, when `> cfg.autoThreshold`,
runs the same `consolidate` + `applyConsolidation` flow. Pure `src/` functions
keep this pi-agnostic. Leave out of the committed sprint to keep scope tight.

## Test plan

### Unit (`node --test`, files under `src/`)
| File | Cases |
|---|---|
| `src/consolidate.test.ts` (NEW) | `overlap` symmetric & bounded [0,1]; `parseSupersedeMarker` (`SUPERSEDED BY x` → id; keyword → `""`); **supersede** via marker + via keyword; **collapse** merges two same-run/kind near-duplicates within window into survivor (text preserved), survivor selection by `(relevance, ts)`; **collapse boundary** at exactly `collapseThreshold` collapses, just-below does not; **cluster** assigns same `clusterTag` to related pair, different tags to unrelated pair; **pure** — input array deep-equal before/after `consolidate`; returned plan has all three arrays. |
| `src/store-hindsight.test.ts` (NEW) | `migrateHindsight` adds the 3 columns idempotently (run twice, schema stable); `recallForConsolidation` returns all active with no limit; `applyConsolidation` sets the 3 columns and returns correct counts; `recall` excludes superseded AND collapsed; re-applying the same plan is safe (counts stable, no throw). Use an in-memory/`node:sqlite` temp DB. |
| `src/config.test.ts` (NEW) | `defaultConsolidationConfig()` returns the documented defaults (0.75/0.5/86400000/500); env overrides (`ITHACUS_CONSOLIDATION_*`) are honored; `resolveConsolidation(undefined)` falls back to defaults. |

### Smoke (`scripts/smoke-src/29-consolidation.mjs` + wiring)
- Exercises the full path without a real pi: build `HindsightStore` over a temp
  sqlite DB (reuse `_harness.mjs` `mkdtempSync`/`execSync` git init + `IthStore`
  for `db`), `retain` a few fixtures, `consolidate`, `applyConsolidation`, then
  assert `recall` omits the superseded/collapsed entries and the surviving
  `text` is intact. Assert `consolidate` output is pure (input unchanged).
- `scripts/smoke-src/_harness.mjs`: add
  `export const consolidate = await import(join(buildDir, "consolidate.ts"));`
  (and ensure `HindsightStore`/`hindsight` are already exported — they are).
- `scripts/smoke-src.mjs`: add
  `import * as s29 from "./smoke-src/29-consolidation.mjs";` and an
  `await s29.run(ctx);` call after `s28`, before the `finally` cleanup.

### Gates (run before commit)
```text
npm run build
node --experimental-strip-types scripts/smoke-src.mjs
node --experimental-strip-types scripts/smoke-ext.mjs
node scripts/guardrails-scan.mjs
python3 scripts/regression_check.py --all
```
All tests use local fixtures/fakes; no provider, model, or network service.

## Guardrails check

- **PREVENT-ITH-001** (anchor floor): consolidation only ADDS metadata columns
  and never deletes rows or rewrites `text`; recall still returns survivors. The
  dry-run `ConsolidationPlan` + explicit `--apply` keeps every action auditable
  and reversible. **Honored.**
- **PREVENT-ITH-002** (toolCall/toolResult pairing): memory rows carry no
  tool-call/result pairs; out of scope. **N/A.**
- **PREVENT-ITH-003** (no `role:"system"` injection): consolidation is pure
  data/metadata; `cluster_tag` is stored metadata only and is never prepended as
  a system message. **Honored by construction.**
- **PREVENT-ITH-004** (no external service): scoring is in-process
  `scoreRelevance` token-overlap over local `node:sqlite`; no network, no
  embedding service. **Honored.**
- **Architecture**: all logic lives in `src/` (pi-agnostic); the only `extensions/`
  change adapts the command/UI. **Honored.**

## Risks and rollback

- **Dual table ownership** (`IthStore` + `HindsightStore` both write
  `ith_memories`): ALTERs are placed in `IthStore.migrateSchema` (always runs) so
  columns exist regardless of which store opens the DB; `HindsightStore`
  re-checks defensively. `IthStore.addMemory` does `INSERT OR REPLACE` without
  the new columns and would null them for that row — mitigated by keeping
  hindsight ids in a distinct `hindsight-*` namespace (never written via
  `addMemory`), and consolidation only operates on the hindsight active set.
- **Recall regression**: adding the `superseded_by/collapsed_into` filter to
  `IthStore.recall` is a no-op for base `IthMemory` (never consolidated); covered
  by existing recall behavior + the new store-hindsight tests.
- **Non-deterministic cluster tags**: derive `clusterTag` from sorted member ids
  (FNV-1a) so re-runs are stable; do not use random uuid.
- **Over-eager collapse**: `collapseThreshold` 0.75 default + same-run/same-kind
  + window guard prevents merging unrelated memories; boundary test pins `>=`.
- **Rollback**: revert the feature commits. Schema ALTERs are additive; existing
  rows keep `NULL` in the new columns and behave exactly as before (no migration
  down-step required because the columns are optional/permissive).

## Commit sequence (one focused commit per step; AI-attributed)

1. **types + pure core** — `src/types-sprint-5.18.ts`, `src/types.ts` re-export,
   `src/consolidate.ts`. (`Co-Authored-By: Claude <noreply@anthropic.com>`)
2. **config** — `src/config.ts` `ConsolidationConfig` + `defaultConsolidationConfig`
   + `resolveConsolidation`.
3. **store schema + hindsight apply/filter** — `src/store.ts` `migrateSchema`
   ALTERs + base `recall` filter; `src/store-hindsight.ts` `migrateHindsight`
   guard + `recall` filter + `recallForConsolidation` + `applyConsolidation`.
4. **extension command** — `extensions/ithacus-commands.ts` `/ithacus-memory consolidate`.
5. **tests + smoke** — `src/consolidate.test.ts`, `src/store-hindsight.test.ts`,
   `src/config.test.ts`, `scripts/smoke-src/29-consolidation.mjs`, plus
   `_harness.mjs` import and `smoke-src.mjs` wiring.

Each commit passes the full gate above before being finalized.
