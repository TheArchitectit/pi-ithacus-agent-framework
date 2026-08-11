# DESIGN: Teams and Configurable Team Sizes (Future Sprint 5.21)

> **Status**: FUTURE DESIGN — not approved for implementation.
> **Provenance**: informed by claw-code PR #3250's `expand_team_mode()` and
> per-role multiplier, plus its `TeamRegistry` pattern; adapted to ithacus's
> existing `planRun()`, markdown-agent discovery, model profiles, sqlite store,
> and pi adapter boundary.
> **Depends on**: Sprint 5.19 named-team persistence; Sprint 5.15 permission
> modes is recommended before presets may include mutating roles. Sprint 5.12.5
> supplies the dynamic bundled/project discovery and model/provider configuration
> baseline; this sprint, not 5.12.5, turns arbitrary names into composition slots.
> **Relationship to 5.19**: `DESIGN_TEAMS_CRONS.md` owns named-team CRUD and
> schedules. This spec owns composition, discovery, sizing, assignment, and
> bounded execution. A 5.19 implementation should reserve a versioned JSON
> definition rather than freezing its earlier minimal slot shape.

## 1. Goal and non-goals

### Goal

Allow a user to define and reuse named team presets whose size and role mix are
explicit, validated, inspectable, and safely dispatched. A preset can select
agent types discovered at runtime, set minimum/default/maximum total size,
control per-role counts, and assign model/provider defaults by role or slot.
Every run persists the fully expanded roster snapshot so later preset edits do
not rewrite history.

### Non-goals

- No implementation in this sprint-planning task.
- No remote registry, hosted control plane, external scheduler, or provider API
  call from ithacus source.
- No automatic model benchmarking, billing lookup, or capacity discovery.
- No unconstrained autoscaling while a run is active. A run's roster is fixed
  after validation; retry replaces a slot attempt rather than adding capacity.
- No replacement of workflows, task claiming, mailbox, worktrees, permission
  modes, or scheduled runs. Team presets compose those existing facilities.
- No silent reinterpretation of today's `tiny` through `mega` aliases.

## 2. Current baseline and source-pattern decisions

Today `src/config.ts` defines six fixed presets with **1–6 total agents** and
`src/team.ts::planRun()` cycles over four compile-time `AgentRole` values.
`extensions/ithacus-team.ts::createTeam()` persists the run/roster and dispatches
agents sequentially. `extensions/ithacus-agents.ts` dynamically discovers
bundled and project markdown definitions, while `src/definitions.ts` already
has pi-agnostic three-layer agent/team discovery. Sprint 5.12.5 requires
`/ithacus-setup` to consume that dynamic roster for per-agent model/provider
bindings without widening the fixed team schema. Model profiles persist
per-role assignments, but not per-slot assignments.

claw-code's researched PR #3250 uses a different interpretation: `1x` through
`6x` means a multiplier for three builder roles plus reviewers, yielding 4–24
agents. Its useful patterns are explicit role expansion, reviewer ratio, named
team identity, independent child contexts, progress, claims, and parallel
execution. ithacus adopts those patterns but does **not** copy these constraints:

1. A size is always the **total expanded slot count**, never an ambiguous
   per-role multiplier.
2. Role counts are explicit. Ratio rules may help setup, but are materialized to
   counts before save and before dispatch.
3. Existing ithacus aliases retain their current 1–6 totals. New claw-inspired
   presets use new names such as `balanced-4`, not `1x`.
4. Persistence uses the existing per-repository `node:sqlite` store rather than
   claw-code's in-memory registry or a network service.

## 3. Terminology and proposed types

- **Agent type**: a discovered markdown agent definition such as `explore` or a
  project-defined type. It supplies prompt, tools, permission, and optional
  model/provider defaults.
- **Role**: the function a slot performs in a preset, such as `builder`,
  `reviewer`, or `verification`. A role references one agent type. Roles are
  strings after this sprint; the four legacy `AgentRole` values remain accepted.
- **Slot**: one concrete child process in an expanded roster, with a stable ID.
- **Preset**: a named, versioned composition template.
- **Size**: total slots after role-count expansion.

Proposed pi-agnostic declarations belong in a new split type file rather than
expanding the headroom-constrained `src/types.ts`:

```ts
export interface TeamSizePolicy {
  min: number;
  default: number;
  max: number;
}

export interface TeamRoleSpec {
  role: string;
  agentType: string;
  count: number;
  required?: boolean;
  model?: string;
  provider?: string;
  profileId?: string;
  dependsOnRoles?: string[];
}

export interface TeamSlotOverride {
  slotId: string;              // stable within the preset, e.g. review-primary
  role: string;
  ordinal: number;             // zero-based occurrence within role
  agentType?: string;
  model?: string;
  provider?: string;
  profileId?: string;
}

export interface TeamPresetV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  size: TeamSizePolicy;
  roles: TeamRoleSpec[];
  slots?: TeamSlotOverride[];
  maxConcurrent?: number;
  failurePolicy?: TeamFailurePolicy;
  source: "builtin" | "user" | "stored" | "project";
  revision: number;
}

export type TeamFailurePolicy =
  | { kind: "continue" }
  | { kind: "fail_fast"; cancelRunning: boolean }
  | { kind: "required_roles" }
  | { kind: "minimum_success"; count: number };
```

`default` is the normal expanded size. `min <= default <= max` is mandatory.
For V1, `sum(roles[].count)` must equal `size.default`; setup changes counts
rather than storing implicit scaling formulas. `min` and `max` define allowed
one-run count overrides and future setup edits. The framework hard limit is 24
slots, matching the largest researched claw-code preset while preventing an
accidental unbounded fan-out. Project policy may lower, but never raise, that
hard limit without a later reviewed schema version.

## 4. Named presets and role composition

Initial built-ins should be conservative and explicit:

| Preset | Composition | Total | Intended use |
|---|---:|---:|---|
| `solo-explore` | explore ×1 | 1 | Small reconnaissance |
| `plan-check` | explore ×1, plan ×1, verification ×1 | 3 | Current medium-compatible flow |
| `balanced-4` | explore ×1, plan ×1, verification ×1, reviewer ×1 | 4 | Claw-inspired builders + independent review |
| `parallel-review-8` | explore ×2, plan ×2, verification ×2, reviewer ×2 | 8 | Explicit equivalent of claw-code `2x` |

Legacy `tiny`, `small`, `medium`, `large`, `xlarge`, and `mega` remain virtual
compatibility presets with exactly today's compositions and totals. They are
not rewritten to claw-code's 4–24 totals.

Preset IDs are immutable; names may change. Bare-name resolution is deterministic:
project file > repository-stored preset > user file > builtin. The UI always
shows the source and warns on shadowing. Fully qualified `source:id` bypasses
precedence. A preset cannot reference itself or another preset in V1; composition
is flat and therefore easy to validate and snapshot.

A required role determines team success under `required_roles`; it does not
change scheduling. `dependsOnRoles` creates role waves: all dependencies must
reach a terminal success state before dependent slots become runnable. A
reviewer therefore can be configured to start after builders without baking
role names into the executor. Missing dependencies and cycles are rejected by
existing DAG-style validation before persistence or dispatch.

## 5. Dynamic agent-type discovery

Sprint 5.12.5 establishes that `/ithacus-setup` discovers the available runtime
roster on every setup entry/refresh using `discoverIthacusAgents()`: additions
are immediately configurable, while removal from the npm bundle never prunes a
surviving project definition or its frontmatter binding. That release also ships
`writer.md` and the docs-only-write bundled `plan.md` as package source of truth.
It intentionally leaves `AgentRole`, `ModePreset`, and tiny–mega composition
fixed.

Sprint 5.21 builds on that baseline: the extension adapter also discovers at
dispatch preflight and turns arbitrary discovered names into selectable team
roles and concrete composition slots. Discovery returns normalized, serializable
descriptors to `src/`; `src/` must not import pi SDK types or `extensions/`
modules.

Proposed descriptor:

```ts
export interface DiscoveredAgentType {
  id: string;
  displayName: string;
  source: "builtin" | "user" | "project";
  model?: string;
  provider?: string;
  tools: string[];
  permission?: string;
  fingerprint: string;
}
```

The fingerprint is a local content hash used for drift visibility, not an
identity. Presets persist `agentType` IDs; each run snapshot also records the
resolved source path class and fingerprint. If a referenced type disappears,
dispatch fails preflight with available replacements; it never silently
substitutes a similarly named type. If a definition changes, setup and TUI show
"changed since preset revision," but the new definition may run after explicit
confirmation. Non-interactive scheduled runs require an exact fingerprint or a
preset-level `allowDefinitionDrift` opt-in introduced only after security
review; V1 defaults to fail closed.

## 6. Size overrides and assignment precedence

A one-run override may provide a total `size` and/or per-role counts. Rules:

1. No override: use saved counts and `size.default`.
2. Per-role counts: every supplied count replaces that role's saved count;
   unspecified roles retain saved counts.
3. Total-only override: distribute the delta deterministically using saved role
   order and largest-remainder weights derived from default counts; required
   roles retain at least one slot.
4. Both forms: per-role counts are authoritative and their sum must equal the
   requested total.
5. The final sum must be within preset min/max, global hard limit 24, project
   cap, and available budget policy.

Stable expanded IDs use `<runId>:<role-slug>:<ordinal>`. Preset slot overrides
match `(role, ordinal)` and carry a human-stable `slotId`; invalid ordinals are
reported rather than ignored.

Model/profile/provider precedence for each expanded slot is:

1. explicit one-run slot override;
2. saved `TeamSlotOverride`;
3. one-run role override;
4. saved `TeamRoleSpec` assignment;
5. selected team-level model profile;
6. discovered agent definition frontmatter;
7. current session `subagentModel` / configured provider model;
8. existing `DEFAULT_AGENT_MODEL` and fallback model chain.

Provider resolution remains `resolveProviderForModel()` in the adapter. A slot
with a provider but no model uses that provider's configured default only when
one exists; otherwise validation fails with `/setup` guidance. A provider/model
mismatch fails before any child starts. Resolved model, provider, source, and
profile ID are persisted on the run snapshot for auditability.

## 7. Setup UX and commands

The primary UX is a future **Teams** section in `/setup` and the
`/ithacus-teams` overlay from Sprint 5.19:

1. **Choose action**: create, clone, edit, inspect, delete, or dry-run preset.
2. **Name/source**: validate a unique kebab-case name and show shadowing.
3. **Discover roles**: multi-select currently available agent types; show
   description, source, tools, permission, model, provider, and fingerprint.
4. **Compose**: name each role and enter its default count; show running total.
5. **Bounds**: choose min/default/max (suggest `1 / current total / min(24,
   current total * 2)`).
6. **Assignments**: accept inherited defaults or assign profile/model/provider
   by role; optionally open advanced per-slot overrides.
7. **Execution**: choose concurrency cap and failure policy; define role
   dependencies.
8. **Review**: render the exact expanded default roster, estimated profile cost,
   warnings, and validation errors.
9. **Save and optional dry run**: saving never dispatches implicitly.

Proposed command surface (pi slash commands, not a separate networked CLI):

```text
/ithacus-teams list
/ithacus-teams show <source:id|name>
/ithacus-teams setup [name]
/ithacus-teams validate <name> [--size N]
/ithacus-team run <name> [--size N] [--role role=N]
/ithacus-team <legacy-mode> <prompt>        # unchanged
```

The LLM-facing dispatch tool may later accept `preset`, `size`, and structured
`roleCounts`, but only after the same pure validator is shared by command and
tool paths. Unknown free-form keys are rejected.

## 8. Persisted schema and migration

Sprint 5.19's `ith_teams` table should evolve into or be accompanied by:

```text
ith_team_presets
  presetId TEXT PRIMARY KEY
  name TEXT NOT NULL
  source TEXT NOT NULL
  schemaVersion INTEGER NOT NULL
  revision INTEGER NOT NULL
  definitionJson TEXT NOT NULL
  status TEXT NOT NULL              # active | deleted
  createdAt INTEGER NOT NULL
  updatedAt INTEGER NOT NULL
  UNIQUE(source, name)

ith_team_preset_revisions
  presetId TEXT NOT NULL
  revision INTEGER NOT NULL
  definitionJson TEXT NOT NULL
  createdAt INTEGER NOT NULL
  PRIMARY KEY(presetId, revision)
```

Existing run tables gain nullable, additive fields:

```text
ith_runs.teamPresetId TEXT NULL
ith_runs.teamPresetRevision INTEGER NULL
ith_runs.teamSnapshotJson TEXT NULL
ith_agents.slotId TEXT NULL
ith_agents.agentType TEXT NULL
ith_agents.definitionFingerprint TEXT NULL
ith_agents.profileId TEXT NULL
```

`teamSnapshotJson` contains the validated, fully expanded roster and effective
execution policy. History therefore survives deletion or editing of a preset.
SQL uses bound parameters; JSON is parsed into `unknown`, schema-validated, and
never accessed directly without narrowing.

Migration is idempotent and transactional:

1. Create new tables if absent.
2. Add nullable run/agent columns after `PRAGMA table_info` checks.
3. Register legacy virtual presets in code; do not rewrite old rows.
4. Existing runs keep `teamPresetId = NULL` and derive visibility from their
   existing `modePreset` and `ith_agents` rows.
5. If Sprint 5.19's earlier `ith_teams.defJson` exists, migrate each active row
   once to `TeamPresetV1`, preserving IDs/names and recording revision 1. Rows
   that cannot be losslessly converted remain readable as legacy and are
   reported for manual edit; startup does not delete or partially rewrite them.
6. Commit only after all converted rows validate; otherwise roll back the
   migration transaction and continue in legacy-read mode.

No schema downgrade is attempted. Rollback disables new reads/writes while old
runs remain usable because all old columns and command forms are retained.

## 9. Dispatch and parallel execution semantics

`src/team.ts::planRun()` should be generalized to consume a validated expanded
roster, while a compatibility wrapper continues accepting `ModePreset`.
Planning remains pure and pi-agnostic. It creates the run, all slot rows, and
all workflow/task rows before execution begins.

The extension then executes runnable slots through a bounded worker pool:

- `effectiveConcurrency = min(runnableSlots, preset.maxConcurrent,
  config.teamConcurrency, 24)`.
- Proposed project default is 4; allowed range is 1–24. `1` preserves serial
  behavior and is the initial rollout default.
- Slots within the same dependency wave may run concurrently. The next wave
  begins only when its dependencies satisfy the failure policy.
- Every child remains an isolated local `pi` subprocess through `spawnAgent()`.
- Results are stored and rendered in stable roster order, independent of
  completion order.
- Read/write tool safety is not inferred from concurrency. Mutating slots need
  permission-mode enforcement and worktree/reservation isolation.
- Cancellation uses `AbortSignal`; queued slots become `cancelled`, running
  children receive the existing terminate/escalation behavior, and all terminal
  states are persisted.
- `src/parallel.ts::executeBatch()` remains tool-call batching and is not reused
  as the team scheduler; team concurrency needs slot IDs, cancellation,
  dependency waves, and failure accounting.

Concurrency is a cap, not a target. Budget governor refusal, unavailable model
capacity, dependencies, or user cancellation may reduce active children.
Runtime `runningByType`, live progress, dashboard snapshots, and event stream
should report both `active/limit` and `queued` counts.

## 10. Failure policy

Default V1 policy is `continue`, matching the current behavior of attempting
every roster member even after an earlier failure. Final run status is:

- `completed`: every required result condition passed;
- `partial`: some slots failed but the selected policy passed;
- `failed`: policy did not pass;
- `cancelled`: user/system cancellation ended the run.

Policy behavior:

- `continue`: run every eligible slot; success requires all non-optional slots.
- `fail_fast`: stop admitting queued slots after first required failure;
  optionally abort running slots.
- `required_roles`: all slots in roles marked `required` must succeed; failures
  in other roles produce `partial`.
- `minimum_success`: at least the configured number of slots must succeed;
  value must be 1..default size and cannot bypass required roles.

Retries belong to Sprint 5.17. A retry retains the same slot ID and increments
an attempt counter; it does not alter team size or quorum. Dependency-blocked
slots are terminal `skipped`, not successful. Every terminal outcome is visible
and included in synthesis; no dispatch loop may mark work completed without a
real child result.

## 11. Validation

One pure `validateTeamPreset(preset, discoveredAgents, limits)` function returns
structured errors and warnings. Persistence and dispatch both call it.
Hard errors include:

- unsupported schema version or unknown fields;
- invalid/duplicate ID, name, role, or slot ID;
- non-integer/negative counts, zero total, or sum mismatch;
- `min > default`, `default > max`, or total/cap above 24;
- missing agent type, slot ordinal out of range, duplicate slot target;
- missing provider/model/profile, or incompatible provider/model binding;
- role dependency missing or cyclic;
- impossible failure threshold or no required role under `required_roles`;
- mutating tools without the required permission mode/isolation policy;
- scheduled preset definition drift.

Warnings include shadowed names, unused discovered types, definition drift for
interactive runs, all slots pinned to an expensive profile, concurrency above
available roles, and a reviewer that runs before its builders. Validation must
be deterministic, side-effect free, and safe for dry-run rendering.

## 12. CLI/TUI visibility

All views show preset name + source + revision, size bounds, expanded total,
role counts, `active/limit/queued`, failure policy, and validation state.

- `/ithacus-menu`: compact `team balanced-4 r3 · 2/4 active · 2 queued` row.
- `/ithacus-teams`: searchable preset list; detail pane expands every slot with
  agent type, model@provider, profile/source marker, permission, and status.
- `/ithacus-status`: machine-readable snapshot includes preset identity,
  requested/effective concurrency, per-role counts, and partial/failure reason.
- Dispatch/live overlay: one row per concrete slot, stable order, with role and
  ordinal so duplicate agent types are distinguishable.
- Non-interactive command output has a `--json`-equivalent structured shape only
  if pi command APIs support it at implementation time; the design must not
  depend on discarded slash-command return strings noted in current handlers.

Secrets and provider credentials are never rendered or copied into snapshots.
Only provider/model IDs and assignment provenance are visible.

## 13. Files to change in a future implementation (dependency order)

| Order | File | Planned change |
|---:|---|---|
| 1 | `src/types-sprint-5.21.ts` | New preset, role, slot, limits, snapshot, validation, and failure-policy types; re-export from `src/types.ts`. |
| 2 | `src/team-presets.ts` | Pure normalization, size expansion, total-only allocation, precedence resolution, drift comparison, and `validateTeamPreset()`. |
| 3 | `src/definitions.ts` | Extend team-definition parsing/discovery to versioned preset fields without importing pi types; preserve existing minimal team files. |
| 4 | `src/team.ts` | Add expanded-roster planner and retain the legacy `planRun({ mode })` compatibility wrapper. |
| 5 | `src/store.ts` or focused `src/store-team-presets.ts` | Idempotent schema, revision CRUD, migration, run snapshots, and parameterized queries. Prefer a focused module to avoid a store god-file. |
| 6 | `src/team-executor.ts` | Pure bounded-pool state transitions, waves, cancellation decisions, and final policy evaluation using an injected spawn callback. |
| 7 | `src/validator.ts` | Feed RPV's `recommendedTeamSize` into preset suggestions, clamped to preset/project bounds; do not silently alter saved composition. |
| 8 | `extensions/ithacus-agents.ts` | Normalize runtime-discovered agent descriptors and expose fingerprints/source metadata to the pure planner. |
| 9 | `extensions/ithacus-team.ts` | Preflight, persist snapshot, run bounded executor through `spawnAgent()`, and persist each terminal slot outcome. |
| 10 | `extensions/ithacus-runtime.ts` | Track active/limit/queued and current preset/revision; include fields in local dashboard snapshots. |
| 11 | `extensions/ithacus-commands.ts` | Preserve legacy command syntax and register list/show/validate/run/setup entry points with visible output. |
| 12 | `extensions/ithacus-teams-overlay.ts` | Extend the 5.19 overlay with composition editor, dry-run roster, validation, drift, and execution visibility. |
| 13 | `extensions/ithacus-dispatch.ts` | Optional later addition of structured preset dispatch parameters, reusing the same validator/executor. |
| 14 | `docs/DESIGN_TEAMS_CRONS.md` | At implementation planning time, align 5.19's persisted definition and scheduled-run drift rules with this schema. |

## 14. Test plan

### Unit tests (`src/`, node test runner)

- `src/team-presets.test.ts`: valid/invalid bounds; exact per-role counts;
  deterministic total-only redistribution; required-role floor; slot override
  matching; all assignment-precedence levels; missing agent and drift cases;
  collision/source precedence; hard cap 24.
- `src/team-executor.test.ts`: never exceeds cap; stable result order; wave
  dependencies; continue/fail-fast/required/minimum-success outcomes; queued and
  running cancellation; retry keeps slot identity; spawn rejection cannot be
  counted as completion.
- `src/definitions.test.ts`: V1 MD/YAML-like parsing, legacy definition
  compatibility, malformed/unknown fields, three-layer precedence.
- Store tests on a temporary sqlite DB: fresh schema; repeated migration;
  conversion from 5.19 rows; rollback on invalid conversion; revisions; soft
  delete; immutable run snapshot; old run with nullable new columns.
- `src/team.test.ts`: every legacy mode expands to its current exact role roster
  and total; workflow/DAG behavior remains intact.
- `src/validator.test.ts`: RPV recommendation clamps to preset min/max and never
  bypasses safety blocking.

### Integration tests (`extensions/` with injected local fakes)

- Discovery of bundled/project agent types, override precedence, fingerprints,
  and missing-type preflight.
- Setup save → list/show → dry run → bounded dispatch using fake `spawnImpl`;
  assert max simultaneous children and final snapshot.
- Mixed role/slot model-provider resolution with configured provider fixture;
  unresolved binding starts zero children.
- Progress/menu/dashboard payloads show role counts and active/limit/queued.
- Legacy `/ithacus-team medium <prompt>` remains valid and initially serial.
- Cancellation and each failure policy persist truthful terminal statuses.
- Scheduled run rejects definition drift and never contacts an external service.

### Required gates

```text
npm run build
node --experimental-strip-types scripts/smoke-src.mjs
node scripts/guardrails-scan.mjs
python3 scripts/regression_check.py --all
```

Tests use temporary directories/sqlite databases and injected subprocesses; no
real provider, model, network, user database, or long-running server is used.

## 15. Guardrails check

- **PREVENT-ITH-001 / PREVENT-ITH-002**: this feature does not trim messages.
  Any future prompt/context reuse must continue through existing boundary
  helpers, preserving anchor floors and tool-call/result pairs.
- **PREVENT-ITH-003**: agent definition prompts are supplied through
  `systemPrompt` / the existing append-system-prompt path, never a fabricated
  `role: "system"` message.
- **PREVENT-ITH-004**: discovery, persistence, validation, scheduling, and
  execution control are local/in-process. Children use the already audited
  local `pi` subprocess path; no new fetch, socket, hosted registry, subscription,
  external DB, or runtime dependency is introduced.
- **PREVENT-DIST-001**: presets ship only as part of the normal npm package;
  no archive or filesystem-link distribution path is added.
- **PREVENT-001 / PREVENT-002 / PREVENT-011**: narrow parsed JSON from `unknown`,
  use parameterized SQL, and define concrete types rather than `any`.
- **Architecture**: all policy, expansion, validation, migration decisions, and
  executor state transitions remain pi-agnostic in `src/`; only discovery/UI
  and local child spawning live in `extensions/`.
- **Four Laws**: implementation requires rereading target files and registry,
  stays within the approved sprint, runs all gates, and halts on migration,
  schema, or runtime uncertainty.

## 16. Staged rollout and acceptance gates

### Stage 0 — compatibility and schema (feature off)

Land types, pure validator/expander, additive schema, migrations, and legacy
virtual presets. No command dispatch path changes. Acceptance: old DB and all
six legacy rosters are byte-for-byte equivalent at the persisted field level.

### Stage 1 — inspect and dry-run

Enable discovery, list/show/validate/setup save, and exact roster preview.
Named presets cannot dispatch. Acceptance: source shadowing, drift, assignments,
and all validation errors are visible without spawning a child.

### Stage 2 — serial named execution

Allow manual named runs with effective concurrency fixed to 1. Default failure
policy is `continue`. Acceptance: snapshots and terminal outcomes are truthful;
legacy command behavior is unchanged.

### Stage 3 — opt-in bounded parallel execution

Expose per-preset/project concurrency 2–4 behind an explicit setting. Require
permission/worktree checks for mutating slots. Acceptance: stress tests prove
active children never exceed cap, cancellation cleans up, and no file-reservation
regression occurs.

### Stage 4 — default bounded concurrency and schedules

After telemetry-free local soak/testing, default new presets to cap 4 while
legacy virtual presets retain serial behavior unless edited. Enable scheduled
named presets only with fingerprint-safe discovery. Acceptance: restart,
definition-drift, and missed/duplicate-fire integration tests pass.

### Stage 5 — advanced tool/API exposure

Optionally add structured preset invocation to `ithacus-dispatch` and future
fleet views. This is separately reviewed; free-form unvalidated composition is
never accepted.

## 17. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Existing aliases change meaning | Legacy virtual presets have golden roster tests | Disable named-preset flag; compatibility wrapper remains |
| Runaway cost/process fan-out | Hard cap 24, project/preset caps, budget preflight, serial first | Force `teamConcurrency=1` |
| Model/provider ambiguity | Explicit precedence and zero-child preflight failure | Ignore new assignments and use legacy resolver |
| Agent definition changes after save | Persist fingerprint and exact run snapshot; schedules fail closed | Pin preset revision or restore prior definition |
| Parallel writers conflict | Permission modes, worktrees, reservations, role waves | Disable parallel execution for mutating slots |
| Partial sqlite migration | Transaction, idempotent checks, legacy-read mode | Roll back transaction and disable new CRUD |
| Preset-name shadowing | Source-qualified IDs and visible warnings | Invoke immutable `source:id` |
| Failure policy hides missing work | Persist failed/skipped/cancelled separately; no stub completion | Revert policy to `continue` + all-required success |

Rollback never deletes preset revisions or run snapshots. It disables new
creation/execution paths and continues reading legacy `modePreset` runs.

## 18. Implementation acceptance criteria

- Users can create, inspect, validate, edit, soft-delete, and run a named preset.
- Runtime-discovered project agent types are selectable without extending a
  compile-time role union.
- `min <= default <= max <= 24`; expanded counts exactly equal requested size.
- Role and slot model/provider/profile precedence is deterministic and visible.
- No child starts if any roster slot fails hard validation.
- The bounded executor never exceeds the effective concurrency cap.
- Every slot reaches a truthful persisted terminal status; no stub completion.
- Existing tiny–mega commands preserve today's 1–6-agent rosters and initially
  preserve serial execution.
- Old databases migrate idempotently and old runs remain readable.
- CLI/TUI show preset revision, composition, active/limit/queued, assignments,
  drift, and failure reason without exposing credentials.
- Unit/integration tests and all required gates pass with zero network access.
