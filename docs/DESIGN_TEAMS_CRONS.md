# DESIGN: Named Teams + Scheduled Crons (Sprint 5.19)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Source pattern**: claw-code `TeamRegistry` + `CronRegistry`
> (`rust/crates/runtime/src/team_cron_registry.rs`) — Team { team_id, name,
> task_ids, status }, TeamStatus { Created/Running/Completed/Deleted }.
> **Builds on**: `src/team.ts` (planRun/resolveAgentModel/buildModelChain) +
> Sprint 4.5 (`src/scheduler.ts` — nextCronFire/createScheduler).

## 1. Problem

ithacus runs are anonymous and one-shot: `planRun()` builds a run, it executes,
done. There is no way to name a recurring team composition ("release-team",
"nightly-review") or schedule it. claw-code separates TeamRegistry (named team
definitions) from CronRegistry (scheduled executions); ithacus has the pieces
(`team.ts` + `scheduler.ts`) but no registry tying them together.

## 2. Design

### 2.1 Team registry — `src/team-registry.ts` (pi-agnostic)

```ts
export interface TeamDefinition {
  teamId: string;            // uuid
  name: string;              // unique, kebab-case
  description?: string;
  agents: TeamAgentSlot[];   // { role, modelOverride?, permission? }
  taskTemplate: string;      // run title template with {{placeholders}}
  createdAt: number;
  updatedAt: number;
}
createTeam(store, def): TeamDefinition
listTeams(store): TeamDefinition[]
getTeam(store, teamIdOrName): TeamDefinition | null
updateTeam(store, teamId, patch): TeamDefinition
deleteTeam(store, teamId): boolean   // soft: status "deleted"; keeps history
```

Storage: new `ith_teams` table (`teamId TEXT PRIMARY KEY, name TEXT UNIQUE,
defJson TEXT, status TEXT, createdAt INTEGER, updatedAt INTEGER`) — idempotent
schema like all other tables.

### 2.2 Cron registry — extends `src/scheduler.ts`

The existing `ScheduleSpec`/`createScheduler` already compute fires from cron
strings. Sprint 5.19 adds TEAM-bound schedules:

```ts
export interface TeamSchedule {
  scheduleId: string;
  teamId: string;            // FK → ith_teams
  cron: string;              // validated by existing nextCronFire()
  enabled: boolean;
  lastFiredAt?: number;
  nextFireAt: number;        // derived, not stored-computed twice
}
```

Storage: `ith_team_schedules` table. On fire, the runner:
1. loads the TeamDefinition, 2. expands the task template, 3. calls existing
`planRun()` + the async-run path (Sprint 2.4 `src/async.ts`) — NO new execution
engine. Schedules are durable (sqlite), survive restarts, and show in
`/ithacus-schedule` (existing Sprint 4.5 command — extended, not replaced).

### 2.3 User surface

- `/ithacus-teams` overlay (Component pattern, Sprint 5.11): list teams, view
  slots, enable/disable schedules, trigger manual run now.
- `/ithacus-schedule` gains team-schedule rows alongside existing runs.

### 2.4 Constraints honored

- PREVENT-ITH-004: all local; cron firing happens in-process via the existing
  scheduler task; no external scheduler service.
- One writer rule: a team run uses the same worktree isolation as regular runs
  (`ith_worktrees`).

## 3. Files changed

| File | Change |
|---|---|
| `src/team-registry.ts` | NEW — teams CRUD (pure over store) |
| `src/store.ts` | `ith_teams` + `ith_team_schedules` tables |
| `src/scheduler.ts` | team-bound schedule spec handling |
| `extensions/ithacus-commands.ts` | `/ithacus-teams` |
| `extensions/ithacus-teams-overlay.ts` | NEW — Component overlay |
| `extensions/ithacus-runtime.ts` | fire handler → planRun + async |

## 4. Testing

- Unit (src): team CRUD on temp sqlite; name uniqueness; cron validation via
  existing nextCronFire; fire-expansion of templates.
- Integration: schedule a team with cron `* * * * *` in test clock → assert
  planRun invoked once per fire.
- Gate: build + smoke + guardrails + regression.

## 5. Out of scope

- Calendar/timezone-aware schedules (scheduler slice is fixed-interval + cron).
- Team-vs-team dependencies (runs stay independent).
