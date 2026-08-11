# Plan — Sprint 5.19: Named Teams + Scheduled Crons

> **Source design**: `docs/DESIGN_TEAMS_CRONS.md`
> **Status**: PLAN (write-only — no code produced)
> **Unblocks**: Sprint 5.21 (legacy `tiny..mega` mode parsing → stored `TeamAgentSlot[]` roster)
> **Constraint recap**: `src/` is pi-agnostic, fully unit-testable with `node --test` /
> `node --experimental-strip-types`. No network in extension source (PREVENT-ITH-004).
> Crons are **local** (in-process `Scheduler` instance), not a hosted service.

---

## 0. Design discrepancies found (must resolve before coding)

| # | Design claim | Reality | Resolution in this plan |
|---|---|---|---|
| D1 | New `TeamDefinition` interface in `team-registry.ts` | `TeamDefinition` **already exists** in `src/types-sprint-3.2.ts` (config-file shape: `agents:{role,agentId?}`, `workflow`, `layer`, `sourcePath`, re-exported via `src/types.ts`) | Rename the old config type to **`TeamConfigDefinition`** in `types-sprint-3.2.ts`; keep `export type TeamDefinition = TeamConfigDefinition` alias so `src/types.ts` re-export + existing importers don't break. The **registry** type (new) is `TeamDefinition` in `team-registry.ts`. |
| D2 | "`/ithacus-schedule` (existing Sprint 4.5 command — extended)" | **No such command exists.** Only `src/scheduler.ts` + smoke `18-dwf-scheduler.mjs`. | **Create** `/ithacus-schedule` (new) + `/ithacus-teams` (new). Flag design claim as stale. |
| D3 | "Component pattern, Sprint 5.11" overlay | No `registerComponent`/`registerOverlay` API in pi docs or current code. Real reference = live-progress persistent card (`ithacus-live.ts` + `ithacus-live-card.ts`). | Overlay **stretch**: mirror `ithacus-live.ts` persistent-card + `ithacus-menu.ts`, OR pi TUI component per `docs/tui.md`. Confirm exact API at build time. See §6. |
| D4 | Fire "calls existing `planRun()` + async-run path (src/async.ts)" | `planRun()` is mode-preset (`tiny..mega`) based; the **working** dispatch is `createTeam()` in `ithacus-team.ts` → `spawnAgent()` (Sprint 5.10). `async.ts` = *detached* background runs, different concern. | Add **`planTeamRun()`** to `team.ts` (per-slot roster, no mode preset). Fire path uses `spawnAgent` like regular teams (local subprocess, already PREVENT-ITH-004-annotated in `ithacus-spawn.ts`). `async.ts` only if a detached long-run is later desired. |

---

## 1. Goal

Persist named team compositions (`TeamDefinition`) in the local sqlite store and bind them to
local cron schedules (`TeamSchedule`) so a team fires on a schedule through the **existing**
`Scheduler` + `spawnAgent` dispatch — no new execution engine, no external service.

### Non-goals (this sprint)
- Calendar/timezone-aware schedules (cron is fixed 5-field UTC; `nextCronFire` already enforces this).
- Team→team dependencies (runs stay independent, worktree-isolated via `ith_worktrees`).
- Sending crons to a hosted scheduler. **Verboten by PREVENT-ITH-004.**
- The actual `TeamConfigDefinition` (D1) unification — that is 5.21's job; we only rename it.

---

## 2. Files to change / create (dependency order)

| Order | File | Action | Why |
|---|---|---|---|
| 1 | `src/types-sprint-3.2.ts` | EDIT | Resolve D1: rename old `TeamDefinition` → `TeamConfigDefinition` + alias. |
| 2 | `src/types-sprint-4.5.ts` | EDIT | Add optional `teamScheduleId?` / `teamId?` to `ScheduleSpec` (backwards-compatible; routes team fires in the runtime task callback). |
| 3 | `src/team.ts` | EDIT | Add `planTeamRun()` (per-slot roster planner) — pure, pi-agnostic. |
| 4 | `src/team-registry.ts` | CREATE | Team + schedule CRUD over `IthStore` (pure), template expansion, `TeamDefinition`/`TeamAgentSlot`/`TeamSchedule` types. |
| 5 | `src/store.ts` | EDIT | Add `ith_teams` + `ith_team_schedules` tables to `SCHEMA`; add CRUD methods to `IthStore`. |
| 6 | `src/team-registry.test.ts` | CREATE | node:test unit tests (temp sqlite). |
| 7 | `src/team.test.ts` | CREATE/EDIT | Unit test `planTeamRun()` slot→agent mapping. |
| 8 | `scripts/smoke-src/29-teams-crons.mjs` | CREATE | Fake-clock integration smoke (mirror `18-dwf-scheduler.mjs`). |
| 9 | `scripts/smoke-src.mjs` | EDIT | Import + run `s29`. |
| 10 | `extensions/ithacus-runtime.ts` | EDIT | Hold a `Scheduler` instance; re-arm enabled team schedules on `bindRepo`; single team-routing task callback. |
| 11 | `extensions/ithacus-team-cron.ts` | CREATE | `fireTeamSchedule()` (load team → `planTeamRun` → `spawnAgent`) + `registerTeamSchedules()`. |
| 12 | `extensions/ithacus-commands.ts` | EDIT | Register `/ithacus-teams` + `/ithacus-schedule` (resolve D2). |
| 13 | `extensions/ithacus-teams-overlay.ts` | CREATE | Persistent overlay (stretch, D3). |

---

## 3. Per-file change description

### 3.1 `src/types-sprint-3.2.ts` (D1)
- Rename `export interface TeamDefinition` → `export interface TeamConfigDefinition` (keep all fields).
- Add `export type TeamDefinition = TeamConfigDefinition;` so `src/types.ts` line
  `export type { ActivityEvent, AgentDefinition, TeamDefinition, ... } from './types-sprint-3.2.js';`
  still resolves. Grep importers of `TeamDefinition` after: only `types.ts` + anything in `extensions/` —
  none currently import it (verified). Safe.

### 3.2 `src/types-sprint-4.5.ts` (ScheduleSpec routing)
Add two optional fields to `ScheduleSpec` (non-breaking — all existing callers omit them):
```ts
export interface ScheduleSpec {
  id?: string;
  kind: ScheduleKind;
  cron?: string;
  intervalMs?: number;
  atMs?: number;
  maxRuns?: number;
  deadlineMs?: number;
  name: string;
  /** Sprint 5.19: when set, the runtime task callback routes the fire to a team. */
  teamScheduleId?: string;
  teamId?: string;
}
```
No change to `Scheduler` logic in `scheduler.ts` — `register()` already copies `spec` verbatim into
`ScheduleEntry`, so the callback can read `entry.spec.teamScheduleId`/`teamId`. This is the minimal
"extends scheduler" seam and keeps `scheduler.ts` fully stable/testable.

### 3.3 `src/team.ts` — `planTeamRun()` (D4)
Pure planner (no dispatch). Mirrors `planRun` but takes an explicit roster instead of a `ModePreset`.
Reuses `resolveAgentModel` + `qualifyForProvider` + `buildModelChain` (already exported).
```ts
import type { TeamAgentSlot } from "./team-registry.js"; // or local type

export interface PlanTeamRunOpts {
  runId: string;
  agents: TeamAgentSlot[];          // explicit roster (the new 5.21 roster shape)
  prompt: string;
  resolved: ResolvedModel;
  fallbackModels: string[];
  now: number;
  workflow?: WorkflowNode[];        // optional DAG → tasks via tasksFromWorkflow()
}

export function planTeamRun(opts: PlanTeamRunOpts): TeamPlan {
  // for each slot i:
  //   role = slot.role (AgentRole)
  //   model = qualifyForProvider(resolveAgentModel(slot.modelOverride, resolved), resolved.provider)
  //   agent = { id:`${runId}-a${i}`, runId, role, model, provider: resolved.provider,
  //             status:"spawning", lastSeen: now, resultSchema:null, resultValidated:false }
  // returns { run:{runId, modePreset:"team:"+teamId-ish|"custom", createdAt, summary, status:"active"},
  //           agents, ...(workflow?{tasks: tasksFromWorkflow()}:{}) }
}
```
Note: `modePreset` on `IthRun` is `TEXT NOT NULL`; use a stable non-preset token like `"team"` (or
`"team:"+teamId`) — do NOT add a new enum to `RunStatus`/`ModePreset`. Keep `run.summary = prompt.slice(0,200)`.

### 3.4 `src/team-registry.ts` (NEW — pi-agnostic)
Header comment: "pi-agnostic: runs over `IthStore`; pure CRUD + template expansion. Zero network
(PREVENT-ITH-004 — no annotation needed, mirrors scheduler.ts)."

Types:
```ts
export interface TeamAgentSlot {
  role: AgentRole;          // "Explore" | "Plan" | "Verification" | "Reviewer"
  modelOverride?: string;   // per-slot model; falls through resolve chain when absent
  permission?: string;      // hint (ties to DESIGN_PERMISSION_MODES); stored as-is
}
export interface TeamDefinition {
  teamId: string;           // uuid
  name: string;             // unique, kebab-case
  description?: string;
  agents: TeamAgentSlot[];
  taskTemplate: string;     // "{{goal}} for {{repo}}" placeholders
  status: "active" | "deleted";  // soft delete
  createdAt: number;
  updatedAt: number;
}
export type TeamDefinitionInput = Omit<TeamDefinition, "teamId" | "createdAt" | "updatedAt" | "status">
  & { teamId?: string };
export interface TeamSchedule {
  scheduleId: string;
  teamId: string;           // FK → ith_teams
  cron: string;             // validated by nextCronFire()
  enabled: boolean;
  lastFiredAt?: number | null;
  nextFireAt: number;       // computed at register time; refreshed on fire (not recomputed per read)
}
```

Functions (all `(store: IthStore, ...)`):
- `createTeam(store, def: TeamDefinitionInput): TeamDefinition`
  - generate `teamId` (`team-<base36 ms>-<hr counter>` pattern from `ithacus-team.ts genId`), validate
    name against `KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`, enforce `agents.length >= 1`, check
    `name` uniqueness (SELECT by name → throw `TeamNameConflictError` if hit), serialize def to `defJson`,
    insert row `status='active'`.
- `getTeam(store, teamIdOrName: string): TeamDefinition | null` — match by `teamId` OR `name`.
- `listTeams(store, opts?: { includeDeleted?: boolean }): TeamDefinition[]` — exclude `deleted` by default.
- `updateTeam(store, teamId: string, patch: Partial<TeamDefinitionInput>): TeamDefinition`
  - reject rename to an already-taken name; bump `updatedAt`; re-serialize.
- `deleteTeam(store, teamId: string): boolean` — **soft**: `UPDATE ... SET status='deleted', updatedAt=now`.
  Keeps history. Returns false if team missing. (Schedules for a deleted team refuse to fire — see 3.11.)
- `expandTeamTaskTemplate(def: TeamDefinition, vars: Record<string,string>): string`
  — reuse `expandTemplate` from `src/ast.ts` (already imported in smoke harness). Validate placeholders
  against `validateTemplate` semantics if needed.
- `scheduleTeamFire(store, teamId: string, cron: string): TeamSchedule`
  — validate cron via existing `nextCronFire(cron, Date.now())` (throws on bad cron → surface error),
  insert `ith_team_schedules` (`enabled=1`, `nextFireAt` = computed), return row.
- `listTeamSchedules(store, teamId?: string): TeamSchedule[]`
- `setTeamScheduleEnabled(store, scheduleId: string, enabled: boolean): void` — flips `enabled`.
- `cancelTeamSchedule(store, scheduleId: string): boolean` — delete row (or soft via `enabled=0` + prune).
- `touchTeamScheduleFire(store, scheduleId: string, firedAt: number, nextFireAt: number): void`
  — update `lastFiredAt` + recompute `nextFireAt` (caller computes via `nextCronFire`).

### 3.5 `src/store.ts` — schema + methods
Add to the `SCHEMA` constant (idempotent `CREATE TABLE IF NOT EXISTS`, same pattern as all other tables):
```sql
CREATE TABLE IF NOT EXISTS ith_teams (
  teamId TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  defJson TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ith_team_schedules (
  scheduleId TEXT PRIMARY KEY,
  teamId TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  lastFiredAt INTEGER,
  nextFireAt INTEGER NOT NULL,
  FOREIGN KEY(teamId) REFERENCES ith_teams(teamId)
);
CREATE INDEX IF NOT EXISTS ix_ith_teams_name ON ith_teams(name);
CREATE INDEX IF NOT EXISTS ix_ith_team_schedules_team ON ith_team_schedules(teamId);
```
Methods on `IthStore` (map rows ↔ types; `defJson` parsed with `JSON.parse`; `enabled` is `INTEGER` →
`Boolean`; `agents`/`taskTemplate` live inside `defJson`):
`createTeamRow`, `getTeamRow`, `listTeamRows`, `updateTeamRow`, `softDeleteTeamRow`,
`createTeamScheduleRow`, `listTeamScheduleRows`, `setTeamScheduleEnabled`, `deleteTeamScheduleRow`,
`touchTeamScheduleFireRow`. No `migrateSchema()` change needed (new tables only).

### 3.6 `src/team-registry.test.ts` (NEW — node:test)
Run via `node --experimental-strip-types --test src/team-registry.test.ts`. Header mirrors
`src/event-bus.test.ts` (explicit `.ts` specifiers; excluded from tsc build program). Uses a temp
`IthStore` (use `new IthStore(undefined, cfg)` against a tmp dir like smoke `_harness.mjs`'s `tmpRepo`,
or `:memory:` — prefer the harness's `IthStore` import pattern). Cases:
- create → get by id; create → get by name.
- name uniqueness throws on conflict.
- kebab-case validation rejects `Release Team`, `release_team`, `Release-Team` (uppercase), accepts `release-team`.
- `updateTeam` rename conflict; `agents` patch; `updatedAt` advances.
- `deleteTeam` soft: `getTeam` returns `status:'deleted'`; `listTeams()` excludes it; `listTeams({includeDeleted:true})` includes it.
- `scheduleTeamFire` stores `nextFireAt` matching `nextCronFire`; bad cron throws (reuse `nextCronFire` contract).
- `setTeamScheduleEnabled(false)` then `true`; `cancelTeamSchedule` removes row.
- `touchTeamScheduleFire` updates `lastFiredAt` + `nextFireAt`.
- FK integrity note: deleting a team does NOT cascade-delete schedules (keeps history); fire path refuses deleted teams.

### 3.7 `src/team.test.ts` (NEW)
- `planTeamRun` with 3 slots (mixed `modelOverride`) → 3 `IthAgent`s, correct `role` order, each `model`
  equals `qualifyForProvider(resolveAgentModel(slot.modelOverride, resolved), provider)`; custom-openai
  prefix applied for bare names.
- `planTeamRun` with `workflow` → `tasks` populated via `tasksFromWorkflow`.
- `runId`/`run.runId` propagated; `modePreset="team"`.

### 3.8 `scripts/smoke-src/29-teams-crons.mjs` (NEW — integration)
Mirror `18-dwf-scheduler.mjs` fake-clock pattern. Import `team`, `IthStore`, `createScheduler`,
`nextCronFire`, `planTeamRun`, `expandTemplate` from `_harness.mjs` (add `planTeamRun` + registry fns to
the harness export list). Scenario:
1. fake `ScheduleClock` (makeClock) + a `planTeamRun` spy counter.
2. `createTeam(store, {name:"nightly-review", agents:[{role:"Explore"},{role:"Reviewer",modelOverride:"claude-..."}], taskTemplate:"review {{repo}}"})`.
3. `scheduleTeamFire(store, teamId, "* * * * *")` → register into `createScheduler(clk, task)` where
   `task` loads team + calls `planTeamRun` spy.
4. advance clock 3× (1 min each) → `_fireDue()` → assert spy called **exactly 3 times**; `touchTeamScheduleFire`
   persisted `lastFiredAt`.
5. `expandTeamTaskTemplate` → `"review acme"` for `vars={repo:"acme"}`.
6. `setTeamScheduleEnabled(false)` then advance → no additional fire.
Register in `scripts/smoke-src.mjs` as `s29` (import + `await s29.run(ctx)`) — keep `try/finally` close.
Add `team`, `planTeamRun` to `_harness.mjs` exports (`import { ... } from join(buildDir,'team-registry.ts')` /
`'team.ts'`).

### 3.9 `extensions/ithacus-runtime.ts` (EDIT)
- Add a held `Scheduler` instance: `readonly scheduler: Scheduler` constructed in `constructor` with a
  **node:timers-backed `ScheduleClock`** (prod) — but allow injection for tests. Single `ScheduleTask`
  callback:
  ```ts
  this.scheduler = createScheduler(this.clock, async (entry) => {
    if (entry.spec.teamScheduleId) await fireTeamSchedule(this, entry.spec.teamScheduleId);
  });
  ```
- `bindRepo(cwd)`: after rebuilding `store`, call `registerTeamSchedules(this)` (load enabled
  `ith_team_schedules` for the repo, register each into `this.scheduler` with `spec.id="team-"+scheduleId`,
  `spec.teamScheduleId`, `spec.teamId`, `spec.kind="cron"`, `spec.cron`, `spec.name=team.name`). This is
  the **restart re-arm** (PREVENT-ITH-004: local only; schedules survive in sqlite).
- `dispose()`: `this.scheduler.cancelAll()` before `store.close()`.
- Optional (5.20 seam): on fire, `this.eventBus.publish({type:"team_fired", teamId, scheduleId, ts})` for
  the overlay to subscribe.

### 3.10 `extensions/ithacus-team-cron.ts` (NEW)
```ts
export async function fireTeamSchedule(runtime: IthRuntime, scheduleId: string): Promise<void> {
  const sched = runtime.store.getTeamScheduleRow(scheduleId);
  if (!sched || !sched.enabled) return;
  const def = runtime.store.getTeamRow(sched.teamId);
  if (!def || def.status === "deleted") return;           // refuse deleted teams
  const runId = genId("run");
  const now = Date.now();
  const title = expandTeamTaskTemplate(def, { repo: runtime.activeRepoRoot ?? "", ts: String(now) });
  const plan = planTeamRun({ runId, agents: def.agents, prompt: title,
                             resolved: captureResolvedFromRuntime(runtime),
                             fallbackModels: runtime.config.fallbackModels, now });
  runtime.store.createRun(plan.run);
  for (const a of plan.agents) runtime.store.upsertAgent(a);
  const chain = buildModelChain(null, resolved, runtime.config.fallbackModels);
  for (const a of plan.agents) {
    await spawnAgent({ agent: a.role, task: `[ithacus ${a.role}] ${title}`, model: a.model, cwd: runtime.activeRepoRoot ?? "." });
  }
  const next = nextCronFire(sched.cron, now);
  runtime.store.touchTeamScheduleFireRow(scheduleId, now, next);
}
export function registerTeamSchedules(runtime: IthRuntime): void {
  for (const s of runtime.store.listTeamScheduleRows(/*repo-scoped*/)) {
    if (!s.enabled) continue;
    runtime.scheduler.register({ id: `team-${s.scheduleId}`, kind: "cron", cron: s.cron,
      name: s.teamId, teamScheduleId: s.scheduleId, teamId: s.teamId });
  }
}
```
`spawnAgent` import + its PREVENT-ITH-004 annotation already live in `ithacus-spawn.ts` (no new
network; the boundary is honored — note in file header).

### 3.11 `extensions/ithacus-commands.ts` (EDIT — resolve D2)
Add (inside `registerTeamCommands` or a new `registerTeamCronCommands`):
- `/ithacus-teams`:
  - no args / `list` → `JSON.stringify(registry.listTeams(store))`
  - `create <name> <role1> [role2 ...] [--model <m>]` → `createTeam`
  - `show <name|id>` → `getTeam`
  - `delete <name|id>` → `deleteTeam` (soft)
  - `run <name|id>` → fire once now (calls `fireTeamSchedule` with a synthetic schedule id / direct `planTeamRun`+`spawnAgent`)
  - `schedule <name|id> <cron>` → `scheduleTeamFire`
  - `enable|disable <scheduleId>` → `setTeamScheduleEnabled`
- `/ithacus-schedule` (NEW): `list` → `JSON.stringify(listTeamSchedules(store))` alongside any
  existing `ith_async_runs` rows (the doc's "gains team-schedule rows alongside existing runs").

### 3.12 `extensions/ithacus-teams-overlay.ts` (NEW — STRETCH, D3)
Persistent overlay mirroring `ithacus-live.ts` (store) + `ithacus-live-card.ts` (component). Lists teams,
slots, schedule enable/disable toggles, "run now". **Discovery item**: confirm the exact pi registration
API from `docs/tui.md` (no `registerComponent`/`registerOverlay` found in current code or pi docs) — fall
back to mirroring `ithacus-live.ts`'s persistent-card pattern + `ithacus-menu.ts`. Subscribes to
`runtime.eventBus` `team_fired` events (3.9). If the API can't be confirmed this sprint, ship the two
slash commands (3.11) and defer the overlay to a follow-up; the core (teams + cron firing) is complete
without it.

---

## 4. Schema delta (idempotent)

Tables added to `SCHEMA` in `src/store.ts` (see §3.5 for full DDL):
- `ith_teams(teamId PK, name UNIQUE, defJson, status DEFAULT 'active', createdAt, updatedAt)`
- `ith_team_schedules(scheduleId PK, teamId FK→ith_teams, cron, enabled DEFAULT 1, lastFiredAt, nextFireAt, FK)`
- Indexes `ix_ith_teams_name`, `ix_ith_team_schedules_team`.

`migrateSchema()` needs **no** ALTERs (new tables only). `schema-health-check.mjs` must pass on a fresh
DB (no migration drift).

---

## 5. Test matrix

| Test | File | Command | Asserts |
|---|---|---|---|
| Team CRUD | `src/team-registry.test.ts` | `node --experimental-strip-types --test src/team-registry.test.ts` | create/get/list/name-unique/kebab/soft-delete/update |
| Schedule CRUD | `src/team-registry.test.ts` | same | scheduleTeamFire validates cron, enable/disable, cancel, touch |
| planTeamRun | `src/team.test.ts` | `node --experimental-strip-types --test src/team.test.ts` | slot→agent mapping, model qualify, workflow→tasks |
| Integration fire | `scripts/smoke-src/29-teams-crons.mjs` | `node --experimental-strip-types scripts/smoke-src.mjs` | fake clock → planTeamRun spy called N times; template expansion; enable/disable |
| Guardrails | `scripts/guardrails-scan.mjs` | `npm run guardrails` | zero PREVENT-ITH-004 network hits in new src/ + extension fire path |
| Regression | `scripts/regression_check.py --all` | `python3 scripts/regression_check.py --all` | no new failures in `.guardrails/failure-registry.jsonl` |
| Build | `tsc` (type-check only) | `npm run build` | new types compile; `TeamDefinition` alias resolves |

**Gate sequence before commit**: `npm run build` → `node --experimental-strip-types scripts/smoke-src.mjs`
→ `npm run guardrails` → `python3 scripts/regression_check.py --all` → `node scripts/schema-health-check.mjs`.

---

## 6. Guardrails check (PREVENT-*)

- **PREVENT-ITH-004 (critical)**: New `src/team-registry.ts` + `planTeamRun` make **zero** network
  calls (pure over `IthStore`; template expansion is local string subst). The fire path in
  `ithacus-team-cron.ts` calls `spawnAgent` — a **local** `pi` subprocess, already annotated
  `// guardrails-allow PREVENT-ITH-004` in `ithacus-spawn.ts`. Crons fire **in-process** via the held
  `Scheduler` (node:timers), re-armed from sqlite on restart. No hosted scheduler, no subscription.
  Explicitly annotate the boundary in `ithacus-team-cron.ts` + `ithacus-runtime.ts` headers.
- **PREVENT-ITH-001/002/003**: not implicated (no message trimming/context injection here). Fire path
  reuses existing `createTeam`/`spawnAgent` which already honor these.
- **PREVENT-DIST-001**: no distribution this sprint (ship only via `npm publish` + `pi install` per
  project rules; not relevant to internal source changes).
- Four Laws honored: Read Before Editing (design + src read), Stay in Scope (only src/ + extension
  seams listed), Verify Before Committing (gate sequence §5), Halt When Uncertain (D1–D4 flagged,
  overlay deferred if API uncertain).

---

## 7. Risks & rollback

| Risk | Mitigation / Rollback |
|---|---|
| D1 rename breaks an importer | Alias `TeamDefinition = TeamConfigDefinition` preserves `src/types.ts` re-export; grep `TeamDefinition` usage pre-merge. Rollback: revert `types-sprint-3.2.ts`. |
| `Scheduler.register` throws on duplicate id | Use `spec.id="team-"+scheduleId` (globally unique); `registerTeamSchedules` skips already-registered. |
| Restart loses armed timers | Re-arm from `ith_team_schedules` in `bindRepo` (§3.9). Verified by smoke re-arm scenario. |
| `planRun` mode-preset coupling | `planTeamRun` is a **separate** function; `planRun` untouched. 5.21 can later converge both onto `TeamAgentSlot[]`. |
| Overlay API unknown (D3) | Ship slash commands (§3.11); overlay is stretch. If API unconfirmable, defer overlay, core still complete. |
| `expandTemplate` placeholder mismatch | Validate `taskTemplate` placeholders at `createTeam`/`scheduleTeamFire` time; surface missing-var errors at fire. |
| FK: deleted team with live schedule | Fire path refuses `status==='deleted'` (§3.10); `cancelTeamSchedule` cleans up. |

Rollback unit = per commit (§8). Each commit independently reverts via `git revert`; no migration
down-step needed (new tables only; dropping is a `git revert` of the schema commit + a manual
`DROP TABLE` if a DB must be cleaned — noted in commit message).

---

## 8. Commit sequence (one focused commit per task)

1. **`feat(team): planTeamRun slot-based planner`** — `src/team.ts` (+ `src/team.test.ts`). Pure planner.
2. **`feat(store): ith_teams + ith_team_schedules schema`** — `src/types-sprint-3.2.ts` (D1 rename+alias),
   `src/types-sprint-4.5.ts` (ScheduleSpec routing), `src/store.ts` (tables+methods).
3. **`feat(team): named-team + cron registry`** — `src/team-registry.ts` (+ `src/team-registry.test.ts`).
4. **`test(smoke): teams-crons fake-clock integration`** — `scripts/smoke-src/29-teams-crons.mjs` +
   `scripts/smoke-src.mjs` + `_harness.mjs` exports.
5. **`feat(ext): team cron dispatch + commands`** — `extensions/ithacus-runtime.ts`,
   `extensions/ithacus-team-cron.ts`, `extensions/ithacus-commands.ts` (`/ithacus-teams`, `/ithacus-schedule`).
6. **`feat(ext): teams overlay (stretch)`** — `extensions/ithacus-teams-overlay.ts` (only if D3 API confirmed).
7. **`chore: version 0.6.0 → 0.6.1`** — `scripts/deploy.sh` auto patch bump (per project version rules; one
   PATCH step per sprint).

Each commit: AI-attribution `Co-Authored-By: Claude <noreply@anthropic.com>` (COMMIT_WORKFLOW.md),
gate §5 green before push.

---

## 9. How this unblocks 5.21

`planTeamRun` + `TeamAgentSlot[]` establish the **canonical stored roster model** that Sprint 5.21 will
use to replace the legacy `tiny..mega` `MODE_PRESETS` branching in `/ithacus-team` (currently frozen per
`ithacus-commands.ts` note: "Legacy team-mode parsing (tiny–mega in /ithacus-team) intentionally stays
fixed until Sprint 5.21"). 5.21 can consume `TeamDefinition.agents` directly and route through
`planTeamRun`, deleting the preset switch.
