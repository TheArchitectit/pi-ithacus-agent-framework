# Plan — Sprint 5.16 Session Checkpoint Manager

**Source spec:** `docs/DESIGN_CHECKPOINT_MANAGER.md` (status: SPEC COMPLETE)
**Task scope (this plan):** checkpoint store on `node:sqlite` via `src/store.ts`,
goal/state-bound checkpoints, resume, rollback, session summary, plus the
design-doc operations (list / delete / archive / compare / diff). Extension
command(s) under `extensions/ithacus-commands.ts`. Keep `src/` pi-agnostic; zero
external services (PREVENT-ITH-004).

> **Plan only — no code written.** Implementation order, signatures, schema
> delta, test matrix, guardrails, risks, and commit sequence below.

---

## 1. Goal & Non-Goals

**Goal**

1. Persist Sprint 2.1 checkpoints into a durable `node:sqlite` table
   (`ith_checkpoints`) keyed by real uuid, with an idempotent schema.
2. Provide a pi-agnostic **manager API** (`src/checkpoint-manager.ts`) over that
   table: **list / get / create / delete / archive / compare / diff**, and the
   task-required extensions **resume / rollback / buildSessionSummary**, plus
   **goal/state-bound** checkpoints.
3. Surface it through a `/ithacus-checkpoints` slash command that opens a TUI
   overlay (Component pattern, same as `ithacus-menu.ts`) and optional
   JSON subcommands.
4. Keep `src/` free of pi runtime types and network calls (PREVENT-ITH-004).

**Non-Goals (explicit, per design doc §6)**

- Full conversation text diffing — `compare/diff` is *metadata-level* (counts +
  summaries). Conversations live in pi, not ithacus.
- Cross-repo checkpoint federation.
- **Live conversation rewind from the overlay** — the overlay/command only
  mutate *store metadata* (archive / delete / mark-superseded). Applying a
  rewind to a live conversation via `rewindToCheckpoint` (checkpoint.ts) is a
  separate follow-up concern and is explicitly OUT of this sprint's scope.
  This honors the design's "read-only otherwise; never mutates live
  conversations" and keeps PREVENT-ITH-001/002 trimming invariants owned by
  `src/checkpoint.ts`.

---

## 2. Design reconciliation (deviations from the spec, with rationale)

The design doc was written before the `store-swarm.ts` idiom (separate
`*Store`/manager file, `store.ts` kept under the ~300-line budget) became the
established norm. This plan adopts the idiomatic split and extends the schema
for the task's goal/state/resume/rollback requirements. All deviations are
behavior-preserving and flagged here:

| # | Design doc says | This plan does | Why |
|---|---|---|---|
| D1 | CRUD helpers as methods on `IthStore` (`store.ts`) | `ith_checkpoints` **schema + idempotent migration** in `src/store.ts`; all CRUD + manager logic in `src/checkpoint-manager.ts` operating on `store.db` | Keeps `store.ts` lean (currently ~379 LOC) and matches `store-swarm.ts`/`store-presence.ts` precedent; design's "manager API pure over store" is preserved. Cosmetic only. |
| D2 | Schema = 8 columns (`id, run_id, label, created_at, summary, message_count, token_estimate, archived`) | Superset: adds `goal, state_json, kind, parent_id, turn_index, token_count_before, token_count_after, status` | Needed for goal/state-bound checkpoints, resume/rollback (require `turn_index` + before/after tokens), and session-summary token accounting. Backward-shape compatible (original 8 columns preserved verbatim). |
| D3 | `src/checkpoint.ts` "mirror marks into store (small addition)" | `checkpoint.ts` gets a tiny pi-agnostic `serializeCheckpoint(c)` helper; the actual INSERT lives in the manager (mirroring how `markCheckpoint` stays store-free like every other `src/` primitive) | Avoids coupling the pi-agnostic primitive to the store; manager owns row mapping. `checkpoint.ts` still participates (owns the shape) without a `store` import. |
| D4 | Command = overlay only | Overlay **plus** best-effort JSON subcommands (`list|show|summary|resume|rollback`) | Matches `/ithacus-swarm` shape; JSON useful headless. NOTE: `registerCmd` in `ithacus-commands.ts` currently DISCARDS string returns (documented TODO) — JSON subcommands are best-effort until that is wired; overlay is the primary surface. |

No change to Sprint 2.1 `Checkpoint` semantics; the manager only *mirrors* them.

---

## 3. Files — dependency order

### 3.1 `src/store.ts` (MODIFY — schema + migration only)
No new methods on `IthStore`. Append to `SCHEMA` const and to `migrateSchema()`.

Add to `SCHEMA`:
```sql
CREATE TABLE IF NOT EXISTS ith_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  summary TEXT,
  message_count INTEGER,
  token_estimate INTEGER,
  archived INTEGER DEFAULT 0,
  goal TEXT,
  state_json TEXT,
  kind TEXT NOT NULL DEFAULT 'checkpoint',
  parent_id TEXT,
  turn_index INTEGER,
  token_count_before INTEGER,
  token_count_after INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS ix_ith_checkpoints_run ON ith_checkpoints(run_id);
CREATE INDEX IF NOT EXISTS ix_ith_checkpoints_created ON ith_checkpoints(created_at);
```

Add to `migrateSchema()` (idempotent, mirrors existing `cols(table)` helper):
```ts
const ckCols = cols("ith_checkpoints");
if (!ckCols.has("goal")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN goal TEXT`);
if (!ckCols.has("state_json")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN state_json TEXT`);
if (!ckCols.has("kind")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'checkpoint'`);
if (!ckCols.has("parent_id")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN parent_id TEXT`);
if (!ckCols.has("turn_index")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN turn_index INTEGER`);
if (!ckCols.has("token_count_before")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN token_count_before INTEGER`);
if (!ckCols.has("token_count_after")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN token_count_after INTEGER`);
if (!ckCols.has("status")) this.db.exec(`ALTER TABLE ith_checkpoints ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
```
> Brand-new table means `CREATE TABLE IF NOT EXISTS` covers fresh DBs; the
> migration block is forward-compat insurance (same pattern as the existing
> `ith_agents`/`ith_tasks` migrations). `store.ts` gains ~12 lines — stays
> within budget.

### 3.2 `src/checkpoint.ts` (MODIFY — tiny, pi-agnostic)
Add (no `store` import; pure shape helper):
```ts
/** Flatten a Sprint 2.1 Checkpoint into the column-ready fields the manager persists. */
export function serializeCheckpoint(c: Checkpoint): {
  id: string; runId: string; turnIndex: number; summary: string;
  tokenCountBefore: number; tokenCountAfter: number; createdAt: number;
} {
  return {
    id: c.id, runId: c.runId, turnIndex: c.turnIndex,
    summary: c.summary, tokenCountBefore: c.tokenCountBefore,
    tokenCountAfter: c.tokenCountAfter, createdAt: c.createdAt,
  };
}
```
(Paired by manager: `metaToCheckpoint()` rebuilds a `Checkpoint` from a row for
`rewindToCheckpoint` use — see 3.3.)

### 3.3 `src/checkpoint-manager.ts` (NEW — pi-agnostic manager)
Imports only `import type { IthStore } from "./store.js"`, `import type { Checkpoint } from "./types.js"`,
`import { serializeCheckpoint } from "./checkpoint.js"`. Operates on
`store.db` (a `DatabaseSync`). No pi runtime types, no network.

**Types**
```ts
export type CheckpointKind = "checkpoint" | "goal" | "state";
export type CheckpointStatus = "active" | "superseded";

export interface CheckpointMeta {
  id: string;
  runId: string;
  label: string;
  createdAt: number;
  summary: string | null;
  messageCount: number | null;
  tokenEstimate: number | null;
  archived: boolean;
  // task extensions
  goal: string | null;
  state: Record<string, unknown> | null;
  kind: CheckpointKind;
  parentId: string | null;
  turnIndex: number | null;
  tokenCountBefore: number | null;
  tokenCountAfter: number | null;
  status: CheckpointStatus;
}

export interface CreateCheckpointInput {
  checkpoint: Checkpoint;          // Sprint 2.1 source of truth
  label: string;
  goal?: string | null;
  state?: Record<string, unknown> | null;
  kind?: CheckpointKind;           // default 'checkpoint'
  parentId?: string | null;
  messageCount?: number | null;    // optional; stored as-is if provided
}

export interface ListCheckpointsOptions {
  runId?: string;
  includeArchived?: boolean;       // default false (design §2.2: archived excluded)
  includeSuperseded?: boolean;     // default false (rollback hides successors)
  kind?: CheckpointKind;
}

export interface CheckpointDiff {
  aMeta: CheckpointMeta;
  bMeta: CheckpointMeta;
  deltaMessages: number;           // b.messageCount - a.messageCount
  deltaTokens: number;             // b.tokenCountAfter - a.tokenCountAfter
  summaryDiff: string;             // metadata-level line diff of summaries
}

export interface SessionSummary {
  runId: string;
  checkpointCount: number;
  archivedCount: number;
  totalTokensSaved: number;        // Σ(tokenCountBefore - tokenCountAfter)
  goals: string[];                 // distinct non-null goals
  timeline: Array<{ id: string; label: string; createdAt: number; goal: string | null }>;
}
```

**Signatures**
```ts
export function createCheckpoint(store: IthStore, input: CreateCheckpointInput): CheckpointMeta;
export function getCheckpoint(store: IthStore, id: string): CheckpointMeta | null;
export function listCheckpoints(store: IthStore, opts?: ListCheckpointsOptions): CheckpointMeta[]; // created_at DESC
export function deleteCheckpoint(store: IthStore, id: string): boolean;   // hard delete; REFUSE (return false) if archived
export function archiveCheckpoint(store: IthStore, id: string): boolean; // soft: archived=1
export function compareCheckpoints(store: IthStore, aId: string, bId: string): CheckpointDiff; // throws if either missing
export function resumeCheckpoint(store: IthStore, id: string): CheckpointMeta | null;          // returns meta to resume from
export function rollbackToCheckpoint(store: IthStore, id: string): CheckpointMeta | null;      // mark target active, later (same run, created_at > target) -> 'superseded'; returns target meta
export function buildSessionSummary(store: IthStore, runId: string): SessionSummary;
export function metaToCheckpoint(meta: CheckpointMeta): Checkpoint;    // rebuild Sprint 2.1 Checkpoint (for future rewindToCheckpoint)
```

**Notes**
- `resumeCheckpoint`/`rollbackToCheckpoint` are **metadata-only** (store) — they
  never touch a live conversation. They return a `CheckpointMeta` the caller can
  pass to `metaToCheckpoint()` + `rewindToCheckpoint()` in a later, separate
  step. This satisfies "read-only otherwise" and keeps trimming invariants in
  `src/checkpoint.ts`.
- `compareCheckpoints.summaryDiff` = simple line-level added/removed via set
  difference of `summary.split("\n")` (no external diff lib). Documented as
  metadata-level.
- `rollbackToCheckpoint` uses `created_at` ordering within the same `run_id` to
  find successors to mark `'superseded'`; `listCheckpoints` (default) hides
  superseded, so a rolled-back run shows only the retained prefix.
- Prepared statements created per call (not hot path); transactions wrap
  multi-statement ops (`BEGIN`/`COMMIT`/`ROLLBACK`) like `SwarmStore`.

### 3.4 `extensions/ithacus-checkpoints-overlay.ts` (NEW — Component overlay)
Mirrors `ithacus-menu.ts` exactly (structural `render`/`handleInput`/`invalidate`,
`ctx.ui.custom<null>(...)`, `registerXCommand`). Imports `node:fs`, `node:path`
(local `stateDir` reads only — no network), manager funcs, and `IthRuntime`.

```ts
class IthCheckpoints {
  constructor(
    private runtime: IthRuntime,
    private done: (value: null) => void,
    private requestRender: () => void,
    theme?: ThemeLike,
  );
  private rows: CheckpointMeta[];        // loaded from store via manager
  private focused: number;               // list cursor
  private compareSel: string[];          // up to 2 ids for compare mode
  private confirmDelete: boolean;        // requires second 'd'
  invalidate(): void;
  handleInput(data: string): void;       // q/Esc close; r refresh; a archive;
                                         // d delete(confirm); c compare; e resume;
                                         // b rollback(mark superseded)
  render(width: number): string[];       // label, run, age, msgs, tokens, [ARCHIVED]/goal tags + key legend
}

export function registerCheckpointsCommand(pi: ExtensionAPI, runtime: IthRuntime): void;
```
- `r` reloads `rows` from `listCheckpoints(runtime.store, {})`.
- `a` → `archiveCheckpoint`; `d` (focused, non-archived) → toggle confirm, then
  `deleteCheckpoint` (refuse archived); `c` toggles compare selection (2 picks →
  render `compareCheckpoints` diff); `e`/`b` call `resumeCheckpoint` /
  `rollbackToCheckpoint` and re-render (metadata ops only).
- All mutations are **store metadata**; never the live conversation.

### 3.5 `extensions/ithacus-commands.ts` (MODIFY)
Add `registerCheckpointsCommand` (alongside `registerTeamCommands`). Reuse the
existing `registerCmd` wrapper. Implement:
```ts
registerCmd("ithacus-checkpoints", async (args, ctx) => {
  runtime.bindRepo(ctx.cwd);
  const raw = (args ?? "").trim();
  const [sub, ...rest] = raw.split(/\s+/);
  if (sub === "list")  return JSON.stringify(listCheckpoints(runtime.store, {}));
  if (sub === "show")  return JSON.stringify(getCheckpoint(runtime.store, rest[0]));
  if (sub === "summary") return JSON.stringify(buildSessionSummary(runtime.store, rest[0]));
  if (sub === "resume")  return JSON.stringify(resumeCheckpoint(runtime.store, rest[0]));   // best-effort (registerCmd discards string)
  if (sub === "rollback")return JSON.stringify(rollbackToCheckpoint(runtime.store, rest[0]));
  // default: open overlay
  await ctx.ui.custom<null>(
    (_tui, theme, _kb, done) => new IthCheckpoints(runtime, done, () => _tui.requestRender(), theme),
    { overlay: true },
  );
});
```
Import `IthCheckpoints`, `registerCheckpointsCommand` symbols; `listCheckpoints`,
`getCheckpoint`, `buildSessionSummary`, `resumeCheckpoint`,
`rollbackToCheckpoint` from `"../src/checkpoint-manager.js"`.

### 3.6 `extensions/ithacus.ts` (MODIFY — wiring)
Add `import { registerCheckpointsCommand } from "./ithacus-checkpoints-overlay.js";`
near the `ithacus-menu` import, and call `registerCheckpointsCommand(pi, runtime);`
immediately after `registerMenuCommand(pi, runtime);` (line 65).

### 3.7 Test harness (MODIFY) — `_harness.mjs` + `smoke-src.mjs`
- `_harness.mjs`: add `export const { listCheckpoints, getCheckpoint, createCheckpoint, deleteCheckpoint, archiveCheckpoint, compareCheckpoints, resumeCheckpoint, rollbackToCheckpoint, buildSessionSummary, metaToCheckpoint } = await import(join(buildDir, "checkpoint-manager.ts"));`
- `scripts/smoke-src.mjs`: add `import * as s29 from "./smoke-src/29-checkpoint-manager.mjs";` and `await s29.run(ctx);` after `s28`.

### 3.8 `scripts/smoke-src/29-checkpoint-manager.mjs` (NEW)
Mirror `07-checkpoint.mjs` + `23-swarm-store-persistence.mjs` shape: build a
temp git repo + `new IthStore(tmpRepo, cfg.loadConfig())`, import manager via
harness, run `check(...)` assertions. (Primary unit-test surface — `npm test`
runs smoke-src.)

**Test matrix (see §5).**

---

## 4. Schema delta — summary

| Column | In design? | Type | Purpose |
|---|---|---|---|
| id | ✓ | TEXT PK | uuid |
| run_id | ✓ | TEXT NOT NULL | group by run |
| label | ✓ | TEXT NOT NULL | human label |
| created_at | ✓ | INTEGER NOT NULL | ordering |
| summary | ✓ | TEXT | buildSummary() output at mark |
| message_count | ✓ | INTEGER | optional, from input |
| token_estimate | ✓ | INTEGER | = tokenCountAfter (compat) |
| archived | ✓ | INTEGER DEFAULT 0 | soft-delete flag |
| goal | ✗ (new) | TEXT | goal the checkpoint is bound to |
| state_json | ✗ (new) | TEXT | JSON state snapshot |
| kind | ✗ (new) | TEXT NOT NULL DEFAULT 'checkpoint' | checkpoint/goal/state |
| parent_id | ✗ (new) | TEXT | rollback chains |
| turn_index | ✗ (new) | INTEGER | resume/rollback boundary |
| token_count_before | ✗ (new) | INTEGER | session-summary delta |
| token_count_after | ✗ (new) | INTEGER | session-summary delta |
| status | ✗ (new) | TEXT NOT NULL DEFAULT 'active' | active/superseded |

Indexes: `ix_ith_checkpoints_run(run_id)`, `ix_ith_checkpoints_created(created_at)`.
Idempotent via `CREATE TABLE IF NOT EXISTS` + `migrateSchema()` ALTER blocks.

---

## 5. Test matrix

`scripts/smoke-src/29-checkpoint-manager.mjs` (each uses a fresh `IthStore` on a
temp git repo, like §23):

| # | Case | Assert |
|---|---|---|
| T1 | `createCheckpoint` + `getCheckpoint` | row round-trips; `meta.turnIndex`/`runId` match input `Checkpoint`; `kind` default `'checkpoint'` |
| T2 | `listCheckpoints` default | includes the row; `archived` excluded by default |
| T3 | `archiveCheckpoint` | sets `archived=true`; `listCheckpoints({})` omits it; `listCheckpoints({includeArchived:true})` includes it |
| T4 | `deleteCheckpoint` refuse archived | returns `false` on archived id; row still present |
| T5 | `deleteCheckpoint` non-archived | returns `true`; `getCheckpoint` → `null` |
| T6 | `compareCheckpoints` math | `deltaMessages = b.messageCount - a.messageCount`; `deltaTokens = b.tokenCountAfter - a.tokenCountAfter`; `summaryDiff` non-empty when summaries differ |
| T7 | `compareCheckpoints` missing | throws if either id absent |
| T8 | goal/state-bound | `createCheckpoint` with `goal` + nested `state` → `meta.goal`/`meta.state` JSON round-trip exactly |
| T9 | resume | `resumeCheckpoint(id)` returns meta with `turnIndex`; `metaToCheckpoint(meta)` yields `Checkpoint` with equal `turnIndex`/`runId`/`tokenCount*` |
| T10 | rollback | 3 checkpoints same run (t0<t1<t2); `rollbackToCheckpoint(mid)` → mid `status='active'`, t1(t2) `status='superseded'`; `listCheckpoints({})` length = 2 (mid + earlier), `listCheckpoints({includeSuperseded:true})` length = 3 |
| T11 | `buildSessionSummary` | `checkpointCount`, `archivedCount`, `totalTokensSaved = Σ(before-after)`, `goals` distinct non-null, `timeline` ordered by `createdAt` |
| T12 | idempotent schema | reopen `IthStore` on same dir → `PRAGMA table_info(ith_checkpoints)` shows all 16 columns; prior rows intact |
| T13 | migration safety | construct store, then simulate a narrow prior table is a no-op (covers `migrateSchema` ALTER path) — assert all columns present |

Optional (secondary, `node --test` style `src/checkpoint-manager.test.ts`): same
T1–T13 as a `.test.ts` file if the harness later switches to `node --test`. Not
required for `npm test` (which runs smoke-src).

---

## 6. Extension command(s)

- **`/ithacus-checkpoints`** (primary): opens the `IthCheckpoints` overlay
  (list / archive / delete-with-confirm / compare / resume / rollback /
  refresh). Interactive surface.
- **`/ithacus-checkpoints <sub> [arg]`** (best-effort JSON, mirrors
  `/ithacus-swarm`): `list`, `show <id>`, `summary <runId>`, `resume <id>`,
  `rollback <id>`. NOTE `registerCmd` currently discards string returns
  (documented TODO in `ithacus-commands.ts`) — JSON output is best-effort until
  that is wired; overlay remains the guaranteed surface.
- No new pi tool, no new schema outside `ith_checkpoints`, no network.

---

## 7. Guardrails check

| Rule | Applies? | How the plan honors it |
|---|---|---|
| **PREVENT-ITH-004** (critical, no network) | ✅ | `checkpoint-manager.ts` imports only `./store.js` type, `./types.js`, `./checkpoint.js` — all `src/` pi-agnostic, no `fetch`/`http`/`WebSocket`/`child_process`. Overlay uses only `node:fs`/`node:path` (local `stateDir`) + manager. No `// guardrails-allow` needed (zero network). Scanner pattern `(fetch\(|https?://|new (WebSocket|net\.)|XMLHttpRequest|child_process)` not introduced. |
| **PREVENT-ITH-001** (anchor floor) | N/A here | Live trimming is NOT done by this sprint. `rollbackToCheckpoint` is metadata-only (marks `superseded`); any future live `rewindToCheckpoint` call stays in `src/checkpoint.ts` and must preserve the anchor floor. Flagged as a constraint for the follow-up apply step. |
| **PREVENT-ITH-002** (tool-pair) | N/A here | Same as above — no live trim boundary created here. |
| **PREVENT-ITH-003** (no `role:"system"` injection) | N/A here | Resume re-injection of goal/state into a live conversation (future) must use `systemPrompt`, never `role:"system"`. Flagged. |
| **PREVENT-DIST-001** | N/A | No packaging/distribution change. |
| AGENT_GUARDRAILS Four Laws | ✅ | Read-before-edit (all src/ read); scope = only the 8 files in §3; verify via gate before commit; halt on any test failure. |

---

## 8. Risks & rollback

| Risk | Likelihood | Mitigation / Rollback |
|---|---|---|
| Existing dev DB already has a narrower `ith_checkpoints` (pre-sprint local experiment) | Low (sprint unshipped) | `CREATE TABLE IF NOT EXISTS` won't alter; `migrateSchema()` ALTERs in missing columns idempotently. T12/T13 cover this. |
| `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT` on a populated table | Low | sqlite fills default for existing rows; brand-new table has none. Safe. |
| Overlay accidentally mutates a live conversation | Design-forbidden | Overlay/command only call manager store-metadata ops; no `rewindToCheckpoint` invocation from the overlay. Live rewind is explicitly out of scope. |
| JSON subcommand output silently dropped | Medium | Known `registerCmd` TODO. Overlay is the primary, guaranteed surface; document limitation. |
| `store.ts` LOC growth beyond budget | Low | Only ~12 lines added (schema + migration). Manager CRUD kept out of `store.ts` (deviation D1). |
| `message_count`/`token_estimate` null when source `Checkpoint` lacks them | Low | Stored as-is; `compare`/`summary` treat null as 0 for math; acceptable for metadata view. |

**Rollback:** each file is independently revertible via `git checkout HEAD -- <file>`.
The only schema change is additive (new table + new columns) — no destructive
migration; removing the feature leaves harmless extra columns.

---

## 9. Commit sequence & gate

Implement in dependency order §3 (1→9). Run the full gate **before** committing.
Per `CLAUDE.md` ("one focused commit per task") and `docs/workflows/COMMIT_WORKFLOW.md`,
land as **one commit** for Sprint 5.16 with mandatory AI attribution.

**Gate commands (all must pass):**
```bash
node scripts/guardrails-scan.mjs            # PREVENT-* pattern scan (src/ + extensions/)
python3 scripts/regression_check.py --all   # failure-registry check
node --experimental-strip-types scripts/smoke-src.mjs   # includes new 29-* (must print ALL PASSED)
node --experimental-strip-types scripts/smoke-ext.mjs   # extension smoke (if present)
npm run build                               # tsc type-check (optional but recommended)
npm run lint                                # tsc --noEmit
# full gate before bump:
npm run gate
```

**Commit:**
```
git add src/store.ts src/checkpoint.ts src/checkpoint-manager.ts \
        extensions/ithacus-checkpoints-overlay.ts extensions/ithacus-commands.ts \
        extensions/ithacus.ts scripts/smoke-src/_harness.mjs \
        scripts/smoke-src/29-checkpoint-manager.mjs scripts/smoke-src.mjs
git commit -m "Sprint 5.16: Session Checkpoint Manager (goal/state-bound, resume, rollback, summary)" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Version bump (after gate passes, one PATCH per sprint per CLAUDE.md):**
```bash
bash scripts/deploy.sh    # auto patch: 0.6.0 -> 0.6.1
```
(Optional 2-commit split acceptable: (a) `store.ts`+`checkpoint.ts`+`checkpoint-manager.ts`+tests, (b) overlay+command+wiring — but default is the single sprint commit above.)

---

## 10. Summary (10 lines)

1. Adds durable `ith_checkpoints` table to `src/store.ts` (idempotent schema + migration), extending the design's 8 cols with goal/state/kind/parent/turn_index/token_before/after/status.
2. New pi-agnostic `src/checkpoint-manager.ts` provides list/get/create/delete/archive/compare/diff plus task-required resume/rollback/buildSessionSummary and metaToCheckpoint — all over `store.db`, no pi types, no network.
3. `src/checkpoint.ts` gains a tiny `serializeCheckpoint` helper (no store import), preserving its pi-agnostic purity.
4. New `extensions/ithacus-checkpoints-overlay.ts` is a `Component` (mirrors `ithacus-menu.ts`) for interactive list/archive/delete/compare/resume/rollback — store-metadata only, never a live conversation.
5. `extensions/ithacus-commands.ts` gains `registerCheckpointsCommand` (`/ithacus-checkpoints` overlay + best-effort JSON subcommands); wired into `extensions/ithacus.ts`.
6. Resume/rollback are metadata-only; actual live rewind stays in `src/checkpoint.ts` (future apply step) to keep PREVENT-ITH-001/002/003 owned there.
7. Tests: new `scripts/smoke-src/29-checkpoint-manager.mjs` (13 cases: CRUD, archive-refuse-delete, compare math, goal/state round-trip, resume/rollback status transitions, session summary, idempotent schema) wired into `smoke-src.mjs` + `_harness.mjs`.
8. Guardrails: PREVENT-ITH-004 honored (zero network in src/ + extensions); PREVENT-DIST-001 untouched; trimming rules flagged as out-of-scope-here.
9. Risks low (additive schema, metadata-only overlay, known registerCmd string-drop TODO documented); rollback is per-file `git checkout`.
10. Gate (guardrails + regression + smoke-src incl. 29 + build/lint) must pass before a single AI-attributed commit and `scripts/deploy.sh` patch bump 0.6.0→0.6.1.
