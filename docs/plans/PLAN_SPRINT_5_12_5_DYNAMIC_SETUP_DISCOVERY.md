# Plan — Sprint 5.12.5 Dynamic Setup Discovery

## Goal

Make dynamic agent discovery an explicit 0.4.0 release requirement: setup must
configure every agent returned by `discoverIthacusAgents()`, newly bundled and
project-defined agents must appear without code edits, and removal from the
bundle must never silently delete surviving project definitions or bindings.

## Non-goals

- Do not implement code in this documentation task.
- Do not implement Sprint 5.21 team composition, role slots, sizing, schemas, or
  execution.
- Do not broadly widen `AgentRole`, `ModePreset`, `src/types.ts`, `src/config.ts`,
  or the fixed tiny–mega team contracts.
- Do not add a network service, runtime dependency, or non-npm distribution path.

## Files to change/create (dependency order)

1. `extensions/agents/writer.md` — add the writer definition to the bundled 0.4.0
   source and npm payload.
2. `extensions/agents/plan.md` — make the bundled source define the docs-only-write
   planning role (Markdown writes under `docs/` only), rather than relying on
   `.pi` local state.
3. `src/agent-bundles.ts` and `src/agent-bundles.test.ts` — enumerate bundle
   fixtures dynamically, seed additions, retain removed-bundle project files,
   and test preservation without fixed counts; remain pi-agnostic.
4. `extensions/ithacus-agents.ts` — retain the already-dynamic bundled/project
   discovery and manifest-aware precedence used as setup's source of truth.
5. `extensions/ithacus-setup.ts` — remove `ROLES` and `Role`; obtain the binding
   roster from a fresh `discoverIthacusAgents()` result and persist the selected
   agent's model/provider in project frontmatter.
6. `extensions/ithacus-commands.ts` — replace fixed role-name token parsing with
   discovery-based parsing only where arbitrary agent names are applicable;
   preserve fixed team preset parsing pending Sprint 5.21.
7. `extensions/ithacus.ts` — activate dynamic, non-pruning bundle seeding and
   preservation notices.
8. `scripts/smoke-ext.mjs` — add setup UI fakes for dynamic discovery/binding,
   project-only agents, writer adoption, removal retention, payload layout, and
   fixture-derived expected counts.
9. `scripts/regression_check.py` and `scripts/deploy.sh` — validate every bundled
   definition and require `writer.md` plus updated `plan.md` in the npm payload.
10. `docs/DESIGN_AGENT_BUNDLES.md`, `docs/SPRINT_PLAN.md`, and
    `docs/DESIGN_TEAMS_AND_SIZES.md` — record release semantics, acceptance, exact
    scope, and the Sprint 5.21 boundary.

## Per-file implementation notes

- `registerSetupCommand()` should discover on setup entry and refresh after
  operations that can alter the visible roster. Bind choices must map safely to
  agent names rather than trusting display-label string replacement.
- `bindRoleFlow()` should accept an arbitrary discovered agent name/config, not a
  four-value union. `writeAgentOverride()` continues using project markdown
  frontmatter as the sole binding persistence mechanism.
- Bundle seeding treats package removal as absence of a new source file, never as
  authorization to delete project state or manifest/config history.
- Setup should sort deterministically and report an empty roster visibly.
- Core/team type changes are allowed only for a demonstrated narrow compatibility
  need; arbitrary dynamic team roles and composition slots belong to Sprint 5.21.

## Test plan

### Focused tests

- Unit: added fixture seeds; removed bundled fixture leaves project definition
  untouched and discoverable; user edits and frontmatter bindings survive.
- Extension smoke: setup choices equal discovered fixture names; `writer` appears
  without setup changes; a project-only custom name is bindable; selecting it
  updates only its model/provider frontmatter.
- Published-layout smoke: dynamically derive expected definition count and assert
  `writer.md` plus updated `plan.md` are present.
- Command smoke: arbitrary names parse dynamically only on applicable agent-facing
  commands; tiny–mega behavior remains unchanged.

### Gates

```text
npm run build
node --experimental-strip-types scripts/smoke-src.mjs
node --experimental-strip-types scripts/smoke-ext.mjs
node scripts/guardrails-scan.mjs
python3 scripts/regression_check.py --all
```

All tests use local fixtures/fakes and no provider, model, or network service.

## Guardrails check

- **PREVENT-ITH-001 / PREVENT-ITH-002**: no message trimming changes are planned;
  anchor floors and tool-call/result pairing remain untouched.
- **PREVENT-ITH-003**: agent prompts continue through the existing system-prompt
  path; no fabricated system-role message is introduced.
- **PREVENT-ITH-004**: discovery, setup, seeding, validation, and smoke tests are
  local filesystem/in-process operations. No external service or network call.
- **PREVENT-DIST-001**: the release payload is distributed only through the normal
  npm publish/install path; payload checks do not introduce an alternate handoff.
- **Architecture**: `src/` remains pi-agnostic; pi UI/discovery adaptation stays in
  `extensions/`.

## Risks and rollback

- **Stale setup snapshots**: rediscover at setup entry/refresh and resolve the
  selected name before writing.
- **Accidental project deletion**: make non-pruning semantics explicit and cover
  package-removal retention in unit and smoke tests.
- **Team schema creep**: retain compile-time legacy team types until Sprint 5.21.
- **Payload drift**: validate actual files and assert writer/plan explicitly.
- **Rollback**: revert the focused implementation commit. Seeded project files are
  additive and remain in place; rollback must not delete user/project definitions.
