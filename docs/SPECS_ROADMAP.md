# SPECS ROADMAP — ithacus current & future capabilities

> **Purpose**: single index of every design spec, ordered by sprint. Each spec
> lives in its own file; this doc only points at them and records provenance.
> **Provenance**: all future-sprint specs derive from three explorer reviews
> (claw-code, memory-mcp, radcode local clone) — findings and anti-patterns in
> `RESEARCH_EXTERNAL_SOURCES.md`. Nothing here adds external services
> (PREVENT-ITH-004); borrowed patterns are re-implemented on `node:sqlite` /
> in-process primitives.
> **Updated**: 2026-08-10.

## Current (spec complete, next to implement)

| Sprint | Spec | What it delivers |
|---|---|---|
| **5.13** | `DESIGN_LIVE_PROGRESS.md` | Live-progress overlay: per-agent real-time status, TPS, files accessed, tokens — shown DURING dispatch (fixes the 1-sec blue-box terminal popup) |

## Future (spec complete, ordered)

| Sprint | Spec | What it delivers | Borrowed from |
|---|---|---|---|
| **5.14** | `DESIGN_WORKER_STATUS.md` | Richer worker status state machine (7 states + failure kinds) feeding the 5.13 overlay | claw-code `WorkerStatus` |
| **5.15** | `DESIGN_PERMISSION_MODES.md` | Per-agent permission modes (read_only / workspace_write / full_access) enforced at spawn; adds `writer` agent | claw-code `AgentsPermissionArg` |
| **5.16** | `DESIGN_CHECKPOINT_MANAGER.md` | Checkpoint list/delete/archive/compare on sqlite + `/ithacus-checkpoints` overlay | memory-mcp session context |
| **5.17** | `DESIGN_AUTO_COMPACT_RETRY.md` | Auto-compact + retry on context-window errors (with claw-code PR#4 bug fixed: rebuild compacted, never reuse failed child) | claw-code PRs #1-4 |
| **5.18** | `DESIGN_MEMORY_CONSOLIDATION.md` | Memory consolidation: supersede → collapse → cluster on `ith_memories`, in-process token-overlap scoring | memory-mcp Trident |
| **5.19** | `DESIGN_TEAMS_CRONS.md` | Named team registry + cron-bound team schedules + `/ithacus-teams` overlay | claw-code Team/CronRegistry |
| **5.20** | `DESIGN_EVENT_STREAM.md` | One typed event stream, many views (overlay + dashboard + fleet view share one bus); layer into 5.13 from day one | radcode stream protocol |
| **5.21** | `DESIGN_TEAMS_AND_SIZES.md` | Named presets with discovered agent types, explicit role/slot composition, configurable size bounds, model/provider assignment, and bounded parallel dispatch | claw-code `expand_team_mode()` + TeamRegistry, adapted to ithacus |

## Recommended build order & rationale

1. **5.13 first** — highest user-visible value (dispatches stop being black
   boxes); reuses two shipped patterns; small build.
2. **5.20 layered INTO 5.13** — make the live store event-driven at birth so
   5.12 (dashboard), 5.14 (status), and fleet view subscribe to one bus.
   Cost when layered early: ~1 day. Cost bolted on later: rework.
3. **5.14 next** — direct extension of the 5.13/5.20 pipeline.
4. **5.15 before any mutating workflows** — enforcement must exist before the
   `writer` agent gets used broadly.
5. **5.17 before long-horizon agents** — retries make long tasks viable.
6. **5.16, 5.18, 5.19** in any order — independent quality-of-life sprints.
7. **5.21 after 5.19** — extend named-team persistence with versioned composition
   and size policy; require 5.15 before parallel presets may mutate files.

## Cross-cutting constraints (apply to every spec)

- **PREVENT-ITH-004**: zero network calls in extension source; no external
  services. memory-mcp's Postgres/Redis/Ollama infra is explicitly NOT adopted.
- **`src/` pi-agnostic**: all new pure logic lands in `src/` with `node --test`
  coverage; pi adapter code stays in `extensions/`.
- **Anti-pattern registry** (from explorer reviews): no stubbed dispatch loops,
  no embedding compressed text, no undocumented score semantics, no id
  truncation, no terminal-state popups in place of live progress.
- **Gate**: every sprint ends with `npm run build` + smoke + `guardrails-scan`
  + `regression_check.py --all` green before commit.

## Shipped reference specs (implemented, kept for context)

| Doc | Delivered as |
|---|---|
| `DESIGN_DISPATCH_TOOL.md` | Sprint 5.10 → v0.3.0 |
| `DESIGN_MENU_OVERLAY.md` | Sprint 5.11 → v0.3.11 |
| `DESIGN_ASYNCPROCESS.md` | Sprint 2.4 |
| `DESIGN_AGENT_SPAWNING.md` | Sprint 2.3 |
| `DESIGN_AGENT_ORCHESTRATION.md` | Sprint 2.3+ |
