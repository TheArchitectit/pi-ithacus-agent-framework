# GAP ANALYSIS: ithacus vs pi-crew vs pi-messenger

> **Generated:** 2026-07-21 · **Regenerated:** 2026-05 (post-review) 
> **ithacus** v0.3.2 (65 src files + 20 extension files, ~8.6K lines) | **pi-crew** v0.9.46 (431 files, 87K lines, 116 releases) | **pi-messenger** v0.14.1 (651 stars, 42 commits)
>
> v0.3.2 delivered TIER 1–4 plus TIER 5 sprints 5.1–5.4 (src queue/workflow-steps/
> workflow-yaml/negotiation/handoff/swarm/synthesis/task-store/store-swarm),
> 5.10 (dispatch tool), 5.11 (menu overlay + version widget). Statuses below
> re-verified against shipped code; the prior matrix was a v0.1.0 freeze.

---

## Table of Contents

1. [Feature Matrix](#1-feature-matrix)
2. [Gap Categories](#2-gap-categories)
3. [Prioritized Backlog](#3-prioritized-backlog)
4. [What Ithacus Does Better](#4-what-ithacus-does-better)
5. [Architecture Verdict](#5-architecture-verdict)

---

## 1. Feature Matrix

Legend: ✅ Full | 🟡 Partial | ⬜ Missing | 🔒 N/A (different paradigm)

### 1.1 Core Orchestration

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Multi-agent team spawning | ✅ `planRun()` mode presets (tiny→mega) + `createTeam` run/agent/task tables | ✅ 6 builtin teams, 10 agent roles, 40+ actions | ✅ Crew: plan→work→review waves |
| Agent roles | 4 (Explore, Plan, Verification, Reviewer) as `.md` frontmatter roster | 10 (analyst, critic, executor, explorer, planner, reviewer, security-reviewer, test-engineer, verifier, writer) | 3 (planner, worker, reviewer) + plan-sync analyst |
| Workflow definitions | ✅ YAML templates (`workflow-yaml.ts`) + presets | ✅ YAML workflows + `.dwf.ts` dynamic scripts | ✅ Plan→work→review with dependency DAG |
| Workflow DAG engine | ✅ `workflow.ts` phases/waves/topsort + `workflow-steps.ts` retry/timeout/on_error | ✅ Topology analyzer classifies single/sequential/concurrent/complex-dag | ✅ Wave execution with dependency resolution |
| Adaptive planning | 🟡 Plan agent role; no topology-classify pre-flight | ✅ `implementation` workflow: planner agent decides fanout | ✅ Planner auto-discovers PRDs, structures tasks for max parallelism |
| Dynamic workflows (scriptable) | ✅ `dwf.ts` with ctx-style trust model | ✅ `.dwf.ts` with `ctx.agent()`, `ctx.fanOut()`, `ctx.budget` | ⬜ |
| Workflow topology advisory | 🟡 advisor mode watches turns; no pre-flight DAG classification | ✅ Pre-flight classification + cost evidence + advisory notes | ⬜ |

### 1.2 Task Management

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Atomic task claims | ✅ SQLite `claimTask()` idempotent INSERT | ✅ FS tmp+rename atomic | ✅ File-based claim/unclaim |
| Task graph / dependencies | ✅ `ith_tasks.dependsOn` + DAG wave execution | ✅ `tasks.json` with phase-based ordering | ✅ Dependency DAG with wave execution |
| Task status tracking | ✅ `task-store.ts` full lifecycle | ✅ Full lifecycle + `needs_attention` terminal state | ✅ ready/in_progress/blocked/done + review verdicts |
| File reservations | ✅ `reservations.ts` (SQLiteed path claims) | ⬜ | ✅ Claim files/directories, block others with clear message |
| Stuck detection | ✅ `presence.ts` heartbeat + `detectStuck()` | ⬜ | ✅ Idle agents flagged, peer notification |
| Needs-attention status | ⬜ (stuck detection only, no deadletter) | ✅ Tasks completing without `submit_result` get flagged | ⬜ |

### 1.3 Isolation & Concurrency

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Parallel execution | ✅ `executeBatch()` read-only tool parallelism | ✅ Configurable concurrency, `parallelGroup` | ✅ Wave-based parallel workers |
| Worktree isolation | ✅ `src/worktree.ts` + `ithacus-worktree.ts` (per-agent, auto-cleanup) | ✅ Git worktree per task, auto-cleanup, `requireCleanWorktreeLeader` | ⬜ |
| Runtime modes | 1–2 (pi sub-agents via dispatch spawn; async detached) | 4 (auto, child-process, scaffold, live-session) | 2 (pi subprocesses, scaffold) |
| Async / background runs | ✅ `src/async.ts` + `ithacus-async.ts` (detached, survive session) | ✅ Detached runs survive session switches, completion notifications | ✅ Autonomous mode runs waves back-to-back |

### 1.4 Communication

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Inter-agent messaging | ✅ SQLite inbox tables (send/unread/markRead); **mailbox tool port queued (task #16)** | ✅ FS mailbox, kill signals, progress events | ✅ DM + broadcast + `triggerTurn` wake-up |
| Presence / discovery | ✅ `presence.ts` + `store-presence.ts` (join/leave/heartbeat/stuck) | ⬜ | ✅ Living presence (status, tokens, tool calls, themed names) |
| Activity feed | ✅ `store-events.ts` + `events.log` (activity feed events) | 🟡 Event log (events.jsonl) | ✅ Unified timeline (edits, commits, tests, messages) |
| Chat overlay (TUI) | ✅ `/ithacus-menu` overlay + above-editor version widget (5.11) | ✅ Live widget, dashboard, progress tracking | ✅ `/messenger` overlay with agents/feed/chat tabs |
| Stuck/health notifications | 🟡 stuck detection shipped; no deadletter queue | ✅ Heartbeat watching, deadletter queue | ✅ Stuck detection + peer notification |

### 1.5 Memory & Knowledge

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| SQLite memory store | ✅ `node:sqlite` decisions/facts/preferences + hindsight tables | ⬜ | ⬜ |
| Cross-run knowledge | ✅ `store-hindsight.ts` + `before_agent_start` inline injection | ✅ `.crew/knowledge.md` injected into every agent prompt | ⬜ |
| AGENTS.md feedback loop | ⬜ | ✅ `AgentSuggestion` → human review → shared learnings | ⬜ |
| Durable trim / pressure relief | ✅ `decideTrim()` + agent_end `ctx.compact()` | ✅ Compaction resilience + resume directive injection | ⬜ |
| Skill auto-discovery | ✅ 3-layer discovery (extension < user < project), SKILL.md validation | ✅ 3-layer discovery (builtin < user < project), SKILL.md validation | ✅ Crew skills (extension, user, project) with on-demand loading |

### 1.6 Observability & Metrics

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Cost reporting | ✅ `cost.ts` per-agent/role/run tracking | ✅ Per-role cost report in `team summary` (tokens, $, turns) | ⬜ (token usage in presence) |
| Metrics / observability | ✅ `metrics.ts` counters/gauges/histograms + Prometheus/OTLP export | ✅ Prometheus/OTLP exporters, metrics registry, task-level metrics | ⬜ |
| Health scoring | ⬜ | ✅ Penalty-based with time-series snapshots | ⬜ |
| Event replay | ✅ events log + store-events (seq replay via dashboard.json writer) | ✅ `RunEventBus.onWithReplay()` with seq-based dedup from JSONL | ⬜ |
| Output handling (head+tail) | ✅ head+tail preservation on compacting paths | ✅ Lossless-by-default, head+tail preservation when compacting | ⬜ |
| Import/export runs | ⬜ | ✅ Portable run bundles (tar.gz) | ⬜ |

### 1.7 Extensibility & Config

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Plugin architecture | ✅ `plugins.ts` registry (context injection hooks) | ✅ Plugin registry (Next.js, Vite, Vitest context injection) | ⬜ |
| Custom agents/teams/workflows | ✅ `extensions/agents/*.md` user-extendable roster + YAML workflows | ✅ 3-layer resource discovery, YAML/MD formats with routing metadata | ✅ Custom project agents via `.pi/messenger/crew/agents/` |
| Plan-level HITL | ✅ HUMAN_REVIEW step type in DAG executor | ✅ `requirePlanApproval` gates at plan→execute boundary | ⬜ |
| Scheduled runs | ✅ `scheduler.ts` (cron/interval/one-shot) | ✅ Cron, interval, one-shot with auto-cancel | ⬜ |
| Goal loops (autonomous judge) | ✅ `goal-loops.ts` (LLM actor+judge, threshold verdict) | ✅ LLM judge evaluates transcript against goal, multi-turn | ⬜ |
| No external service / subscription | ✅ local pi + Node built-ins only | ⬜ (OTLP exporters) | ✅ File-based coordination only |
| PREVENT-* guardrails | ✅ 6 rules (ITH-001→004, DIST-001) | ⬜ | ⬜ |
| Pi-agnostic src/ separation | ✅ No pi imports in src/ | ⬜ | ⬜ |
| Hardened secrets detection | ⬜ | ✅ Linear-time PEM/Bearer/key=value detection | ⬜ |
| Config schema validation | ⬜ (runtime validation only) | ✅ JSON schema (schema.json) | ⬜ |
| PR #3250 model chain | ✅ `resolveAgentModel` 4-tier fallthrough | ⬜ (different resolution) | ⬜ |
| 404 chain-fallthrough | 🟡 provider-resolved fast-fail + fallback; no full 404 retry chain | ⬜ | ⬜ |
| Credential injection | ✅ pi-setup config loaded at spawn (`loadPiSetupConfig`) | ⬜ | ⬜ |

---

## 2. Gap Categories

### CRITICAL (blocks adoption) — ALL CLOSED ✅

| # | Gap | Status |
|---|---|---|
| C1 | ~~No worktree isolation~~ | ✅ `src/worktree.ts` + extension |
| C2 | ~~No async/background runs~~ | ✅ `src/async.ts` + extension |
| C3 | ~~No workflow DAG engine~~ | ✅ `workflow.ts` + `workflow-steps.ts` |
| C4 | ~~No task dependency graph~~ | ✅ DAG + `ith_tasks.dependsOn` + task-store |
| C5 | ~~No presence/messaging overlay~~ | ✅ presence tables + menu/widget overlay (mailbox tool #16 pending) |

### IMPORTANT (expected by users)

| # | Gap | Status |
|---|---|---|
| I1 | ~~No file reservations~~ | ✅ `reservations.ts` |
| I2 | ~~No cost reporting~~ | ✅ `cost.ts` |
| I3 | ~~No observability/metrics~~ | ✅ `metrics.ts` |
| I4 | ~~No activity feed~~ | ✅ `store-events.ts` + events.log |
| I5 | ~~No crew overlay/dashboard~~ | ✅ menu overlay + version widget + dashboard.json |
| I6 | ~~No plugin architecture~~ | ✅ `plugins.ts` |
| I7 | ~~No skill auto-discovery~~ | ✅ 3-layer skills |
| I8 | Adaptive planning | 🟡 plan role exists; no topology-classify pre-flight |
| I9 | ~~No output head+tail~~ | ✅ head+tail preservation |
| I10 | ~~No event replay~~ | ✅ event store + replay |
| I11 | ~~Knowledge not auto-injected~~ | ✅ hindsight inject at before_agent_start |
| I12 | ~~No custom definitions~~ | ✅ agents/*.md roster + YAML workflows |
| I13 | ~~No plan-level HITL~~ | ✅ HUMAN_REVIEW DAG step |
| I14 | ~~No goal loops~~ | ✅ `goal-loops.ts` |

### NICE-TO-HAVE (differentiators)

| # | Gap | Impact | Status |
|---|---|---|---|
| N1 | ~~No scheduled runs~~ | ✅ `scheduler.ts` | shipped |
| N2 | No import/export runs | Can't share or archive run bundles | ⬜ still open |
| N3 | No health scoring | No penalty-based run health | ⬜ still open |
| N4 | Topology advisory | advisor mode partial (turn-watching, not DAG pre-flight) | 🟡 partial |
| N5 | ~~No dynamic workflows~~ | ✅ `dwf.ts` | shipped |
| N6 | No single-agent mode (cliff hedge) | ⬜ still open |
| N7 | No config schema validation | ⬜ still open |
| N8 | ~~No stuck detection~~ | ✅ `presence.detectStuck` | shipped |
| N9 | No swarm/spec-based claims | ⬜ still open |

---

## 3. Prioritized Backlog (updated 2026-05)

Everything in the prior P0 band and most of P1/P2 shipped. Remaining work,
re-prioritized for v0.4:

### P0 — In flight (this sprint)

| # | Task | Addresses | Effort | Notes |
|---|---|---|---|---|
| P0-1 | **Running-agent-type visibility** — runtime tracks active dispatch types, widget shows them | parity/transparency | S | task #15: spawn tags ITHACUS_AGENT_ID env, runtime map, widget segment |
| P0-2 | **Inter-agent mailbox tool** — send/read/broadcast over `ith_inbox` | C5 completion, P2-7 | M | task #16: claw-code PR e96c6675 pattern; agent .md tool lists updated |
| P0-3 | **memory-mcp ports** — guardrails injection, ToolVisibility tiers, typed workflows, opt-in A2A | new | M–XL | tasks #21–#24 (approved 2026-05) |

### P1 — Remaining gaps

| # | Task | Addresses | Effort |
|---|---|---|---|
| P1-1 | Import/export run bundles | N2 | S |
| P1-2 | Health scoring (penalty + time-series) | N3 | S |
| P1-3 | Topology advisory pre-flight classification | N4 | S |
| P1-4 | Config schema validation at load time | N7 | S |
| P1-5 | Single-agent cliff-hedge mode | N6 | S |
| P1-6 | Adaptive planning (fanout classifier) | I8 | M |
| P1-7 | Swarm/spec-based claims | N9 | M |

### P2 — TIER 5 continuation (memory-mcp/radical ports)

| # | Task | Sprint |
|---|---|---|
| P2-1 | Budget governor + leader election + router | 5.5 |
| P2-2 | In-process messaging bus + recovery protocol | 5.6 |
| P2-3 | Distributed task claiming + deadline queue | 5.7 |
| P2-4 | SprintTracker + 52-week planning | 5.8 |
| P2-5 | A2A protocol adapter (opt-in, default off, extensions/) | 5.9 |
| P2-6 | Local web dashboard (loopback HTTP, annotated exception) | 5.12 |

---

## 4. What Ithacus Does Better

### 4.1 No External Service / No Subscription (PREVENT-ITH-004)

Ithacus requires no external service or subscription to run — bring your own model via pi. The extension source itself makes zero network calls at runtime (scan-enforced by `scripts/guardrails-scan.mjs`); all ithacus state lives in local `node:sqlite` + the filesystem. Spawned sub-agents make LLM calls through YOUR configured pi providers, not a service ithacus depends on. pi-crew has OTLP exporters and potential external calls; pi-messenger is file-based like ithacus but doesn't enforce no-external-service as a scan rule.

### 4.2 PREVENT-* Guardrail System

Six scan-enforced rules with severity levels (error/critical):
- **PREVENT-ITH-001**: Never drop messages without an anchor floor
- **PREVENT-ITH-002**: Never split toolCall/toolResult pairs at trim boundaries
- **PREVENT-ITH-003**: Never inject context as `role:"system"` — use `systemPrompt`
- **PREVENT-ITH-004**: No external service / zero network at runtime (annotated exceptions)
- **PREVENT-DIST-001**: Distribute only via npm publish + pi install

Neither competitor has this level of automated architectural enforcement.

### 4.3 Pi-Agnostic Separation

Ithacus's `src/` imports zero pi runtime types. Every module is unit-testable with `node --test` in isolation; the pi adapter layer (`extensions/`) is the only place touching the ExtensionAPI — faster CI, future portability, clear dependency boundary.

### 4.4 PR #3250 Model Resolution Chain

The 4-tier fallthrough `explicit → subagentModel → provider model → DEFAULT`, plus `qualifyForProvider()` custom-openai prefixing, plus deduped fallback chains, plus pi-setup credential loading at spawn.

### 4.5 Lightweight Footprint

65 src files (~8.6K lines) vs 431 files (pi-crew). Zero runtime deps (`node:sqlite` + FS only). No build step required at runtime (`--experimental-strip-types`). Easiest to audit, fork, and understand.

### 4.6 Durable Trim with Anchor Floor

`decideTrim()` respects the anchor floor, never splits toolCall/toolResult pairs, triggers compaction at safe settle points.

### 4.7 Structured Memory Layer

SQLite memory + hindsight (retain/recall/reflect) per repo — self-consolidating, queryable, pressure-scaled injection.

---

## 5. Architecture Verdict

### Maturity Assessment (2026-05 update)

| Dimension | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| **Maturity** | Alpha (v0.3.2, actively built) | Production-ready (v0.9.46, 116 releases) | Stable (v0.14.1, 651 stars) |
| **Scope** | Full orchestration incl. TIER 5 5.1–5.4 | Full orchestration + observability | Communication + presence + crew |
| **Test coverage** | Smoke tests (612+ assertions) | ~5,860 tests | Unit tests |
| **Architecture** | Clean separation, pi-agnostic | Integrated, pi-native | Integrated, pi-native |
| **Primary value** | Correctness constraints, zero-network, model chain | Feature completeness, workflow flexibility | Agent communication, presence |

### Strategic Position

Ithacus occupies a **unique niche**: the only orchestrator prioritizing architectural correctness (guardrails, zero-network, pi-agnostic) over feature breadth — **and** it has now closed all CRITICAL and most IMPORTANT feature gaps. The remaining delta vs pi-crew is breadth (10 roles vs 4) and polish (health scoring, bundles), not capability.

### Remaining Path

1. ~~Close P0 gaps~~ — ✅ done (C1–C5 all closed by v0.3.2)
2. Current sprint: agent visibility + mailbox + memory-mcp ports (tasks #15,#16,#21–#24)
3. TIER 5.5–5.9 + 5.12 (budget/leader/router, bus/recovery, claiming, sprint tracking, A2A, dashboard server)
4. Don't chase pi-crew feature parity — correctness-first positioning holds.
