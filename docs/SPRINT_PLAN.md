# SPRINT PLAN — ithacus v0.2.0 through v1.0

> Generated: 2026-07-23
> Status: Active
> Based on: docs/MASTER_PLAN.md

## Sprint Cadence
- 2-week sprints
- Sprint planning: day 1
- Daily standup: async (update in sprint doc)
- Sprint review: last day (demo + guardrails scan)
- Retrospective: after each tier completion

---

## TIER 1 — Foundation (v0.2.0)

8 weeks, 4 sprints

### Sprint 1.1 — Schema + DAG Engine (Weeks 1-2)

**Goal**: Build the foundation layer — schema changes and workflow DAG engine that everything else depends on.

**Features**:
- 1.4 Task dependencies (schema change)
- 1.1 Workflow DAG engine
- 1.8 Schema-validated subagent results

**Deliverables**:
- [x] src/store.ts: add dependsOn, wave, phase columns to ith_tasks
- [x] src/store.ts: add schema validation columns to ith_agents
- [x] src/workflow.ts: DAG engine with topological sort
- [x] src/workflow.ts: wave execution (parallel within wave, sequential across)
- [x] src/types.ts: WorkflowNode, WorkflowEdge, WaveExecution types
- [x] Unit tests for topological sort, cycle detection, wave generation
- [x] Guardrails scan passes

**Acceptance Criteria**:
- DAG correctly identifies execution waves from dependency graph
- Cycle detection throws clear error
- planRun() in src/team.ts can accept a workflow definition
- Schema migration is backward-compatible (new columns have defaults)
- 10+ tests passing

**Dependencies**: None (foundation sprint)

**Risk**: Schema migration must not break existing store. Mitigation: test migration on copy of store.

---

### Sprint 1.2 — Worktree + Async (Weeks 3-4)

**Goal**: Enable parallel agent execution with isolation. Agents can run in git worktrees and in background.

**Features**:
- 1.2 Worktree isolation
- 1.3 Async background runs

**Deliverables**:
- [x] src/worktree.ts: git worktree add/remove/list per agent
- [x] src/worktree.ts: auto-cleanup on agent completion or failure
- [x] extensions/ithacus-worktree.ts: worktree lifecycle hooks
- [x] src/async.ts: detach run from session, persist state to SQLite
- [x] src/async.ts: spawn detached child process
- [x] src/async.ts: notify on completion (store callback)
- [x] extensions/ithacus-async.ts: async run spawn/monitor hooks
- [x] src/types.ts: WorktreeConfig, AsyncRunState types
- [x] Unit tests for worktree creation, cleanup, async spawn
- [x] Guardrails scan passes

**Acceptance Criteria**:
- git worktree add creates isolated directory per agent
- Worktree auto-cleaned on completion (no orphaned directories)
- Async run persists to IthRuns table and can be queried
- Detached process survives parent session disconnect
- 15+ tests passing

**Dependencies**: Sprint 1.1 (schema changes, DAG engine)

**Risk**: Worktree cleanup on failure. Mitigation: register cleanup in finally block + periodic orphan sweep.

---

### Sprint 1.3 — Presence + Reservations + Cost (Weeks 5-6)

**Goal**: Track agent status, prevent file conflicts, report costs.

**Features**:
- 1.5 Presence tracking
- 1.6 File reservations
- 1.7 Cost reporting

**Deliverables**:
- [x] src/presence.ts: SQLite-backed agent status registry
- [x] src/presence.ts: heartbeat (configurable interval, default 10s)
- [x] src/presence.ts: stuck detection (no heartbeat = stuck)
- [x] extensions/ithacus-presence.ts: join/leave/heartbeat hooks
- [x] src/reservations.ts: claim file paths via SQLite
- [x] src/reservations.ts: block conflicting writes on write/edit
- [x] src/reservations.ts: release on agent completion
- [x] src/cost.ts: track input/output tokens per agent
- [x] src/cost.ts: calculate cost per role and per run
- [x] src/cost.ts: surface in team summary output
- [x] src/types.ts: AgentPresence, FileReservation, CostSummary types
- [x] src/store.ts: ith_presence, ith_reservations, ith_costs tables
- [x] Unit tests for presence, reservations, cost calculation
- [x] Guardrails scan passes

**Acceptance Criteria**:
- Agent status shows as active/stuck/idle/complete
- Stuck detection fires after 30s of no heartbeat
- File reservation blocks second agent from writing same path
- Cost summary shows per-agent and per-run totals
- 20+ tests passing (cumulative: 45+)

**Dependencies**: Sprint 1.1 (schema), Sprint 1.2 (worktree for per-agent paths)

**Risk**: SQLite polling performance. Mitigation: benchmark with 10 concurrent agents.

---

### Sprint 1.4 — Model Profiles + RPV + Integration (Weeks 7-8)

**Goal**: Add the two unique differentiators and integrate everything.

**Features**:
- 1.10 Interactive Model Profiles
- 1.9 Reverse Prompt Validation
- Integration testing of all TIER 1 features

**Deliverables**:
- [x] src/model-profiles.ts: profile CRUD (create, read, update, delete)
- [x] src/model-profiles.ts: 5 pre-seeded profiles (Speed, Quality, Reasoning, Code, Local)
- [x] src/model-profiles.ts: cost estimation per profile
- [x] src/model-profiles.ts: profile resolution (highest precedence in chain)
- [x] src/store.ts: ith_model_profiles, ith_team_model_assignments tables
- [x] extensions/ithacus-commands.ts: /ithacus-profiles command
- [x] extensions/ithacus-commands.ts: interactive profile selection prompt
- [x] extensions/ithacus-team.ts: per-role profile assignment flow
- [x] src/validator.ts: rules-based prompt scoring (4 dimensions)
- [x] src/validator.ts: ValidationReport generation
- [x] src/validator.ts: profile + team size recommendation
- [x] extensions/ithacus-commands.ts: validation before createTeam
- [x] src/types.ts: ModelProfile, TeamModelAssignment, ValidationReport, ScoredDimension types
- [x] Integration tests: full team creation flow with profiles + validation
- [x] Guardrails scan passes
- [x] Regression check passes
- [x] Smoke test passes

**Acceptance Criteria**:
- /ithacus-team shows profile selection prompt
- Per-role assignment works (Explorer=Speed, Reviewer=Quality)
- Validation scores prompt and shows feedback for low scores
- Validation recommends profile based on complexity
- Safety hard-block works (safety < 30 blocks execution)
- Full team creation flow: validate → select profile → create team → execute
- 50+ tests passing (cumulative)
- All guardrails green

**Dependencies**: Sprint 1.1 (DAG), Sprint 1.2 (async), Sprint 1.3 (presence, cost)

**Risk**: Integration complexity. Mitigation: end-to-end test with simple team.

---

## TIER 2 — Competitive Parity (v0.3.0)

6 weeks, 3 sprints

### Sprint 2.1 — Hashline + Checkpoint/Rewind (Weeks 9-10)

**Goal**: Reduce edit token cost and enable context management for long sessions.

**Features**:
- 2.1 Hashline edit format
- 2.3 Checkpoint/Rewind

**Deliverables**:
- [x] src/hashline.ts: content-hash anchored edit format
- [x] src/hashline.ts: hash computation from file content
- [x] src/hashline.ts: stale-anchor recovery (find nearest match)
- [x] src/hashline.ts: conversion to/from pi's native edit format
- [x] src/checkpoint.ts: mark checkpoint in conversation
- [x] src/checkpoint.ts: prune exploratory context after checkpoint
- [x] src/checkpoint.ts: keep concise summary report
- [x] src/types.ts: HashlineEdit, Checkpoint, CheckpointSummary types
- [x] Unit tests for hashline parsing, anchor matching, checkpoint creation
- [x] Guardrails scan passes

**Acceptance Criteria**:
- Hashline edit produces correct file modification
- Stale anchor finds nearest match within 3 lines
- Token reduction measured at 40%+ vs native format
- Checkpoint preserves summary while pruning detail
- 20+ tests passing (cumulative: 70+)

**Dependencies**: TIER 1 complete

**Risk**: Hashline format must be drop-in for pi's edit. Mitigation: fallback to native on mismatch.

---

### Sprint 2.2 — Stream Rules + Config Inheritance + Skills (Weeks 11-12)

**Goal**: Adopt oh-my-pi's best config patterns and enable rule injection.

**Features**:
- 2.4 Stream rules
- 2.5 Config inheritance
- 2.6 Skills auto-discovery

**Deliverables**:
- [x] src/stream-rules.ts: regex-based rule definition
- [x] src/stream-rules.ts: mid-stream injection on pattern match
- [x] src/stream-rules.ts: compaction survival (rules persist)
- [x] src/config.ts: read Cursor MDC format
- [x] src/config.ts: read Cline .clinerules format
- [x] src/config.ts: read Codex AGENTS.md format
- [x] src/config.ts: read Copilot applyTo format
- [x] src/config.ts: read 4 additional formats (Aider, Continue, Cody, generic)
- [x] src/config.ts: 3-layer skill discovery (extension < user < project)
- [x] src/config.ts: SKILL.md validation
- [x] src/types.ts: StreamRule, ConfigFormat, SkillDefinition types
- [x] Unit tests for each config format parser, skill discovery, stream rules
- [x] Guardrails scan passes

**Acceptance Criteria**:
- Stream rules fire on matching text mid-generation
- Rules survive context compaction
- 8 config formats parsed correctly (test with sample files)
- Skills discovered from all 3 layers with correct precedence
- 20+ tests passing (cumulative: 90+)

**Dependencies**: TIER 1 complete

**Risk**: Config format complexity. Mitigation: start with 4 formats, add 4 more in follow-up.

---

### Sprint 2.3 — Advisor + Code Review + Atomic Commits (Weeks 13-14)

**Goal**: Add review intelligence and commit automation.

**Features**:
- 2.2 Advisor mode
- 2.7 Code review
- 2.8 Atomic commit splits

**Deliverables**:
- [x] extensions/ithacus-advisor.ts: second model watching turns
- [x] extensions/ithacus-advisor.ts: inline note injection (concern/blocker/suggestion)
- [x] extensions/ithacus-advisor.ts: separate context from main agent
- [x] extensions/ithacus-advisor.ts: budget control (max notes per session)
- [x] extensions/ithacus-events/: dedicated reviewer subagent spawn
- [x] extensions/ithacus-events/: P0-P3 priority scoring
- [x] extensions/ithacus-events/: confidence scoring
- [x] src/commits.ts: analyze working tree changes
- [x] src/commits.ts: split unrelated changes into atomic commits
- [x] src/commits.ts: dependency ordering between commits
- [x] src/commits.ts: source files scored above tests/docs
- [x] src/types.ts: AdvisorNote, ReviewVerdict, AtomicCommit types
- [x] Unit tests for advisor injection, review scoring, commit splitting
- [x] Guardrails scan passes

**Acceptance Criteria**:
- Advisor injects notes without disrupting main agent flow
- Advisor budget respected (default: 10 notes per session)
- Review verdict includes priority (P0-P3) and confidence (0-100)
- Unrelated changes split into separate commits
- Commit order respects dependencies
- 15+ tests passing (cumulative: 105+)

**Dependencies**: Sprint 2.1 (checkpoint for advisor context isolation)

**Risk**: Advisor cost. Mitigation: default off, budget-controlled, warn on usage.

---

## TIER 3 — Differentiation (v0.4.0)

4 weeks, 2 sprints

### Sprint 3.1 — Memory + Search + GitHub (Weeks 15-16)

**Goal**: Add persistent memory, web search, and GitHub integration.

**Features**:
- 3.1 Hindsight memory
- 3.2 Web search providers
- 3.3 GitHub schemes

**Deliverables**:
- [x] src/hindsight.ts: retain (store key facts from session)
- [x] src/hindsight.ts: recall (query stored facts by relevance)
- [x] src/hindsight.ts: reflect (compress session into mental model)
- [x] src/hindsight.ts: extend IthMemory table with hindsight columns
- [x] src/search.ts: search provider interface
- [x] src/search.ts: Perplexity provider
- [x] src/search.ts: Exa provider
- [x] src/search.ts: Jina provider
- [x] src/search.ts: fallback chain (try providers in order)
- [x] src/search.ts: PREVENT-ITH-004 exception annotation
- [x] src/schemes.ts: pr:// scheme resolution
- [x] src/schemes.ts: issue:// scheme resolution
- [x] src/schemes.ts: conflict:// scheme resolution
- [x] src/types.ts: HindsightEntry, SearchResult, SchemeResolution types
- [x] Unit tests for retain/recall/reflect, search fallback, scheme parsing
- [x] Guardrails scan passes

**Acceptance Criteria**:
- Retain stores facts with metadata (agent, run, timestamp)
- Recall returns relevant facts sorted by relevance score
- Reflect compresses 10+ messages into 1-page summary
- Search provider chain falls back on failure
- pr://123 returns same shape as read src/foo.ts
- 20+ tests passing (cumulative: 125+)

**Dependencies**: TIER 2 complete

**Risk**: Search conflicts with PREVENT-ITH-004. Mitigation: explicit opt-in annotation.

---

### Sprint 3.2 — Activity Feed + Observability + Plugins + Definitions (Weeks 17-18)

**Goal**: Complete the differentiation layer with extensibility and observability.

**Features**:
- 3.4 Activity feed
- 3.5 Custom agent/team definitions
- 3.6 Observability
- 3.7 Output head+tail preservation
- 3.8 Plugin architecture

**Deliverables**:
- [x] src/store.ts: events table for activity feed
- [x] src/store.ts: append agent actions with metadata
- [x] src/store.ts: query events by run/agent/action type
- [x] src/definitions.ts: user-defined agent configs (YAML/MD)
- [x] src/definitions.ts: user-defined team configs
- [x] src/definitions.ts: 3-layer discovery (builtin < user < project)
- [x] src/metrics.ts: metrics registry (counters, gauges, histograms)
- [x] src/metrics.ts: task-level duration/tokens tracking
- [x] src/metrics.ts: Prometheus export format
- [x] src/metrics.ts: OTLP export format
- [x] src/trim.ts: modify decideTrim() to preserve headings/fences
- [x] src/trim.ts: head+tail boundary detection
- [x] src/plugins.ts: plugin registry pattern
- [x] src/plugins.ts: hook into agent spawn
- [x] src/plugins.ts: framework-aware context injection
- [x] src/types.ts: ActivityEvent, AgentDefinition, MetricPoint, Plugin types
- [x] Unit tests for all new modules
- [x] Guardrails scan passes
- [x] Regression check passes

**Acceptance Criteria**:
- Activity feed shows timeline of agent actions
- Custom agent definition loaded from .pi/ithacus/agents/
- Metrics export in Prometheus and OTLP format
- Trim preserves headings and code fences
- Plugin can inject context into agent spawn
- 25+ tests passing (cumulative: 150+)
- All guardrails green

**Dependencies**: Sprint 3.1 (memory for activity context)

**Risk**: Plugin security. Mitigation: plugins run in same context, no eval().

---

## TIER 4 — Aspirational (v1.0+)

As-needed sprints, each requires explicit approval.

### Sprint 4.1 — LSP Integration (Future, 6-8 weeks)

**Features**: 4.1 LSP integration (14 ops)

**Status**: ✅ Complete (src/ pi-agnostic layer)

**Scope**: diagnostics, go-to-definition, find-references, rename, code actions, workspace symbols, document symbols, hover, signature help, formatting, folding, selection range, linked editing, semantic tokens.

**Dependencies**: TIER 3 complete. Requires language server process management.

**Approval required**: Yes

---

### Sprint 4.2 — Browser + Eval (Future, 8-10 weeks)

**Features**: 4.2 Browser automation, 4.3 Persistent eval

**Status**: ✅ Complete (src/ pi-agnostic layer)

**Scope**: Puppeteer/CDP tab management, stealth mode. Python+Bun persistent cells with tool re-entry bridge.

**Dependencies**: TIER 3 complete. Requires process management infrastructure.

**Approval required**: Yes

---

### Sprint 4.3 — TUI + Collab (Future, 8-10 weeks)

**Features**: 4.4 TUI with differential rendering, 4.5 Collab relay

**Status**: ✅ Complete (src/ pi-agnostic layer)

**Scope**: Tool cards, edit previews, ask picker, QR codes. /collab with read-write/read-only links.

**Dependencies**: TIER 3 complete. Requires pi TUI API. Collab needs PREVENT-ITH-004 exception.

**Approval required**: Yes

---

### Sprint 4.4 — DAP + AST + Goal Loops (Future, 10-14 weeks)

**Features**: 4.6 DAP/debug, 4.7 AST edits, 4.8 Goal loops

**Status**: ✅ Complete (src/ pi-agnostic layer; extension wiring deferred)

**Scope**: 28 DAP ops. ast-grep structural rewrites. Autonomous multi-turn with LLM judge.

**Dependencies**: TIER 3 complete. DAP requires debug adapter protocol. AST requires tree-sitter.

**Approval required**: Yes

---

### Sprint 4.5 — Dynamic Workflows + Scheduled Runs (Future, 4-6 weeks)

**Features**: 4.9 Dynamic workflows (.dwf.ts), 4.10 Scheduled runs

**Status**: ✅ Complete (src/ pi-agnostic layer; extension wiring deferred)

**Scope**: Script orchestration as code with trust model. Cron/interval/one-shot scheduling.

**Dependencies**: TIER 1 async runs. Dynamic workflows need isolated-vm for security.

**Approval required**: Yes

---

## TIER 5 — Advanced Swarm Workflows (Future, 10-14 weeks)

Goal: close every agent-workflow gap found across radcode, radical, and memory-mcp. ithacus is purely agent-workflow orchestration (no memory/KG/RAG — separate project). All src/ modules stay pi-agnostic + zero-network (PREVENT-ITH-004); real network A2A lives in extensions/ (Sprint 5.9).

### Sprint 5.1 — Priority Work Queue + Task Lifecycle Store (2 weeks)

**Status**: ✅ Delivered — `src/queue.ts`, `src/task-store.ts`, `src/types-sprint-5.1.ts`.

**Features**: 4.11 Priority work-queue state machine, 4.12 Task lifecycle store

**Scope**: `src/queue.ts` — priority state machine (P0-P3, INGRESS→NEXT→NOW→DONE/FAILED), per-item `depends_on` gating, `get_ready_items`, `get_items(status)`, dependency resolution. Upgrade `team.ts`: task lifecycle (create/get/update/cancel/list/count) + TaskStore ABC + pluggable impls (SQLite-default).

**Dependencies**: TIER 1 workflow.ts, team.ts.

**Approval required**: Yes

### Sprint 5.2 — DAG Step Control + Rich Step Types + YAML (2 weeks)

**Status**: ✅ Delivered — `src/workflow-steps.ts`, `src/workflow-yaml.ts`, `src/types-sprint-5.2.ts`.

**Features**: 4.13 Step retry/timeout/on_error, 4.14 CONDITION/LOOP/HUMAN_REVIEW/SUBWORKFLOW step types, 4.15 YAML workflow templates

**Scope**: Upgrade `workflow.ts` — WorkflowStep with retry_count/timeout/on_error routing. New `src/workflow-yaml.ts` — YAML template loader + entry-point walker, StepType enum.

**Dependencies**: Sprint 5.1.

**Approval required**: Yes

### Sprint 5.3 — Inter-Agent Negotiation + Handoff (1-2 weeks)

**Status**: ✅ Delivered — `src/negotiation.ts`, `src/handoff.ts`, `src/types-sprint-5.3.ts`.

**Features**: 4.16 Negotiation protocol (TaskOffer/Accept/Reject/Counter, ResourceRequest/Grant/Deny), 4.17 Agent handoff (HandoffReason/Priority + capability routing)

**Scope**: `src/negotiation.ts`, `src/handoff.ts`. In-process (zero-network).

**Dependencies**: Sprint 5.1.

**Approval required**: Yes

### Sprint 5.4 — Swarm Dispatch Loop + Result Synthesis + Hive FS (2 weeks)

**Status**: ✅ Delivered — `src/swarm.ts`, `src/synthesis.ts`, `src/store-swarm.ts`, `src/types-sprint-5.4.ts`.

**Features**: 4.18 Swarm dispatch (priority-ordered, blocked-wait, checkpoint-every-N), 4.19 Result synthesis (attribution/conflict/scoring), 4.20 Structured WorkflowResult, 4.21 .pi/ithacus/ hive filesystem convention

**Scope**: `src/swarm.ts` (dispatch loop + hive dirs: 00_hive_mind/LOCKS, 10_communication/inbox/handoffs, 20_workspaces/<role>, 30_artifacts, 90_audit, 99_system). `src/synthesis.ts`.

**Dependencies**: Sprints 5.1, 5.2.

**Approval required**: Yes

### Sprint 5.5 — Budget Governor + Leader Election + Keyword Router (2 weeks)

**Features**: 4.22 Token-budget governor (USD cap + 50%/90% alerts + refuse-to-exceed), 4.23 Capability-based leader election + delegation, 4.24 Keyword→role weighted task router

**Scope**: Upgrade `cost.ts` → `src/budget.ts`. `src/leader.ts`. `src/router.ts`.

**Dependencies**: TIER 1 cost.ts, Sprint 5.1.

**Approval required**: Yes

### Sprint 5.6 — In-Process Messaging Bus + Recovery Protocol (1-2 weeks)

**Features**: 4.25 Swarm messaging bus / blackboard (in-process pub/sub), 4.26 Named failure-recovery protocol (Phoenix-style structured states)

**Scope**: `src/bus.ts`. `src/recovery.ts`.

**Dependencies**: Sprint 5.4.

**Approval required**: Yes

### Sprint 5.7 — Distributed Task Claiming + Deadline Queue (1-2 weeks)

**Features**: 4.27 Distributed task claiming with leases + stale-expiry, 4.28 Priority queue with deadlines (pop_highest_priority/pop_earliest_deadline/overdue_tasks)

**Scope**: `src/claiming.ts`. Upgrade `queue.ts` (deadline ops). SQLite-based (extensible to multi-node via extensions/).

**Dependencies**: Sprint 5.1.

**Approval required**: Yes

### Sprint 5.8 — Project Tracking + Long-Horizon Planning (1 week)

**Features**: 4.29 SprintTracker (sprint/status/tasks/token-metrics/file-mod), 4.30 52-week planning scheduler + Gantt-style dependency-aware auto-scheduling

**Scope**: `src/sprint-tracker.ts`. Upgrade `scheduler.ts` (52-week + Gantt). Deferred execution.

**Dependencies**: TIER 1 scheduler.ts, Sprint 5.5.

**Approval required**: Yes

### Sprint 5.9 — A2A Protocol Adapter (extensions/, network-gated — re-scoped as Tier R) (2-3 weeks)

**Status**: 📋 SPEC — re-scoped under `docs/DESIGN_OPTIN_ENTERPRISE.md` §A;
blocked on Sprint 5.24 (two-tier policy gate) landing first

**Features**: A2A v0.3.0 wire surface — AgentCard at `/.well-known/agent-card.json`,
JSON-RPC 2.0 over HTTP(S) (`message/send`), SSE streaming (`message/stream`),
`tasks/get`/`tasks/cancel`, Bearer/OAuth2/API-key auth (defer gRPC)

**Scope**: `extensions/opt-in/a2a-server.ts` + `a2a-client.ts`. Bridges A2A
messages ↔ local `ith_inbox` so remote peers look identical to local ones.
Loopback-only tests; mesh exposure deferred to Sprint 5.26. Anti-pattern
guard: no no-op dispatch stubs (memory-mcp lesson).

**Dependencies**: Sprint 5.24 (two-tier gate); Sprints 5.1, 5.3, 5.4, 5.6.

---

### Sprint 5.10 — Dispatch Tool Migration (registerTool + markdown agents) (1 week)

**Status**: ✅ Delivered v0.3.0 — `ithacus-dispatch` tool + 4 markdown agents (`explore`/`plan`/`verification`/`reviewer`) + provider resolution.

**Features**: Replace phantom `pi.callTool()` dispatch with the canonical `pi.registerTool()` + subprocess-spawn pattern from `pi-subagents`.

**Scope**: `extensions/ithacus-dispatch.ts` (new — registers `ithacus-dispatch` tool via `pi.registerTool()`; `execute()` spawns real `pi` subprocesses per agent with `--model` overrides), `extensions/agents/{explore,plan,verification,worker}.md` (new — ithacus role roster as markdown, matching the `pi-subagents` frontmatter convention), `extensions/ithacus-team.ts` + `extensions/ithacus-swarm.ts` (swap `pi.callTool` → local `spawnAgent` helper). Clears the 2 tsc errors left as the honest red flag from the gate-fix pass — no stubs.

**Dependencies**: None — but unblocks all of TIER 5 (Sprints 5.1–5.9 were all built on the phantom `callTool` and cannot actually run until this lands).

**Approval required**: Yes — architecture decision (dispatch layer re-architecture). Full spec: [DESIGN_DISPATCH_TOOL.md](DESIGN_DISPATCH_TOOL.md).

### Sprint 5.11 — TUI Status Overlay Menu (1 week)

**Status**: ✅ Delivered v0.3.1/0.3.2 — `/ithacus-menu` overlay + above-editor version widget + update-bump notice.

**Features**: `/ithacus-menu` slash command opens a pi overlay component (`ctx.ui.custom(..., { overlay: true })`) giving a persistent on-screen status surface: package version, live pressure gauge, crew counters (active agents, current turn), context budget (tokens/percent/window), agent roster with model@provider bindings (bundled vs project-override marker), and dashboard snapshot paths (dashboard.json mtime, events.log size). Keys: `r` refresh, `q`/Esc close.

**Scope**: `extensions/ithacus-menu.ts` (new — overlay component implementing pi's `Component` interface structurally: `render(width)`, `handleInput`, `invalidate`), wired in `ithacus.ts`. Closes the disabled-output gap noted in ithacus-commands.ts: slash-command string returns are currently discarded by the registerCmd wrapper, so this overlay is the *first persistently visible status surface*. Local fs reads only (package.json, state dir) — zero network (PREVENT-ITH-004 compliant, no exception needed).

**Dependencies**: None — builds on IthRuntime (already tracks pressure/crew/context) + ithacus-agents roster + ithacus-providers providerSnapshot().

**Approval required**: Yes — first TUI wiring into extensions/ (Sprint 4.3 src/tui.ts is the pi-agnostic base; this is the long-deferred extension-side wiring of gap I5).

---

### Sprint 5.12 — Local Web Dashboard (2-3 weeks)

**Features**: Optional, user-triggered localhost dashboard server serving the `dashboard.json` snapshot + `events.log` tail as a small read-only HTML page + JSON endpoint. Slash commands: `/ithacus-dashboard` (start/status), `/ithacus-dashboard stop`, `/ithacus-dashboard open` (opens default browser). Port.pid marker in the state dir; stale-runner bounce on version mismatch; version stamped in the runner script at write time.

**Scope**: `extensions/ithacus-dashboard-cmds.ts` (command + lifecycle management), `extensions/ithacus-dashboard-server.ts` (standalone ESM server module, Node built-ins only — loopback HTTP serving the snapshot; compiled dist copy is the canonical launch artifact since `--experimental-strip-types` refuses .ts under node_modules). ithacus keeps zero build assets — plain JSON-over-HTTP serving of the runtime snapshot). Loopback HTTP requires `guardrails-allow PREVENT-ITH-004` annotations on the spawn + probe lines (audited, user-triggered, localhost-only — same as ithacus-dispatch's pi-subprocess exception).

**Dependencies**: Sprint 5.11 (menu links to dashboard state; snapshot writer already in IthRuntime.snapshotIfReady).

**Approval required**: Yes — first loopback-HTTP exception annotation (PREVENT-ITH-004) for an optional server.

---

### Tier 6: Live Visibility, Status, Permissions & Memory (post-v0.3.x)

#### Sprint 5.12.5: npm-shipped Agent Bundles with Version-Gated Seeding
**Status**: SPEC COMPLETE. **Doc**: `DESIGN_AGENT_BUNDLES.md`.
Seed every bundled definition into `<repo>/.pi/ithacus/agents/` on activation;
stamp `.bundle-version`; track seeded sha256 values in `.bundle-manifest.json`;
upgrade untouched files while preserving user edits; support manifest-aware
precedence: user-owned repo `<name>.md` > `<name>.local.md` > untouched seeded
copy > package bundled fallback. Added bundled or project agent names are
immediately discovered and configurable; removing a name from the bundle never
deletes/prunes its surviving project definition or silently deletes its saved
model/provider frontmatter. Validate every bundled definition in the normal
regression gate and deploy preflight. Zero network (PREVENT-ITH-004), npm-only
distribution (PREVENT-DIST-001).

**0.4.0 release requirements**:
- `/ithacus-setup` derives its binding roster from a fresh
  `discoverIthacusAgents()` result, never a hard-coded role/name array. A newly
  bundled/seeded `writer` and any valid project-defined agent appear without a
  setup source edit and can persist `model`/`provider` bindings in project
  frontmatter.
- The npm payload includes `extensions/agents/writer.md`; the bundled source of
  truth `extensions/agents/plan.md` contains the docs-only-write planning role
  (Markdown writes under `docs/` only), rather than that role existing only in
  `.pi` local state.
- Setup and published-layout smoke coverage uses discovered/fixture-derived
  counts, tests add/remove retention and binding behavior, and updates every
  stale fixed-count assertion. Applicable fixed agent-token parsing in
  `extensions/ithacus-commands.ts` becomes discovery-based.
- Arbitrary names are configurable/discoverable only. Do not broadly widen
  `src/types.ts`, `src/config.ts`, `src/team.ts`, `AgentRole`, `ModePreset`, or
  the tiny–mega team schema: Sprint 5.21 owns arbitrary dynamic team roles and
  composition slots.

**Implementation scope (dependency order)**:
1. `extensions/agents/writer.md`, `extensions/agents/plan.md` — required bundled
   definitions/source prompts.
2. `src/agent-bundles.ts`, `src/agent-bundles.test.ts` — pi-agnostic dynamic
   seeding, preservation, validation, and add/remove tests.
3. `extensions/ithacus-agents.ts`, `extensions/ithacus-setup.ts` — dynamic
   discovery/precedence and setup roster/binding flow.
4. `extensions/ithacus-commands.ts` — dynamic parsing only where agent-name
   parsing applies; preserve legacy team preset parsing.
5. `extensions/ithacus.ts`, `scripts/smoke-ext.mjs` — activation and dynamic
   setup/published-layout smoke coverage, with no fixed roster count.
6. `scripts/regression_check.py`, `scripts/deploy.sh` — validate all discovered
   bundled definitions and require all of them in the npm payload.

**Acceptance criteria**:
- Adding a bundled or project definition makes it visible and bindable on the
  next setup discovery; `writer` is proven through smoke coverage.
- Removing a bundled definition does not delete, prune, hide, or silently
  rewrite a surviving project definition/config; it remains configurable while
  its project markdown exists.
- The 0.4.0 npm payload includes `writer.md` and the docs-only-write bundled
  `plan.md`; validation and smoke tests reject their absence.
- Setup and applicable command parsing have no fixed agent-name roster; all
  roster counts are derived dynamically. Legacy team schemas remain unchanged.
- Unit tests, extension smoke, build, guardrails, and regression gates pass
  offline.

**Dependencies**: Sprint 5.10 (markdown agents), Sprint 5.11 (activation wiring).
Sprint 5.21 consumes this dynamic discovery/configuration baseline to make
arbitrary names team composition roles/slots.

**Approval required**: Yes.

> Source: three explorer-agent reviews of claw-code, memory-mcp, and radcode
> (`docs/RESEARCH_EXTERNAL_SOURCES.md`, `docs/SPECS_ROADMAP.md`). Every sprint
> below is spec'd in its own DESIGN_*.md. Zero external services — borrowed
> patterns re-implemented on node:sqlite / in-process primitives.
> **Build order**: 5.13 first (5.20 layered into it), then 5.14, 5.15, 5.17,
> then 5.16/5.18/5.19 in any order.

#### Sprint 5.13: Live-Progress Overlay
**Status**: ✅ SHIPPED (v0.5.0) — event-bus primitives (`src/events.ts` + `src/event-bus.ts`, `node --test` 9/9, smoke-src §27) + spawn extraction (`ithacus-spawn.ts` rawJsonLine pass-through) + live store/card wired into the dispatch execute() path; smoke-ext §3d added. **Doc**: `DESIGN_LIVE_PROGRESS.md`.
Builds on Sprint 5.10 (dispatch onProgress) + Sprint 5.11 (Component overlay).
Fix the black-box dispatch: persistent overlay shown at dispatch START, driven
per-event from the child's --mode json stream — per-agent real-time status,
TPS, files accessed, tokens. Replaces the 1-sec terminal-state popup.
Validated against radcode's stream-event TUI architecture.

#### Sprint 5.20: One Event Stream, Many Views
**Status**: SPEC COMPLETE — layer INTO Sprint 5.13 from day one. **Doc**: `DESIGN_EVENT_STREAM.md`.
Single typed event bus (`src/events.ts` + `src/event-bus.ts`, pi-agnostic) so
the overlay (5.13), web dashboard (5.12), richer status (5.14), and fleet view
all subscribe to ONE stream. Borrowed from radcode's stream protocol.

#### Sprint 5.14: Richer Worker Status State Machine
**Status**: ✅ SHIPPED (v0.6.0) — `src/worker-status.ts` state machine (`mapEventToStatus` + `canTransition` + `classifyFailure`, `node --test` 14/14, smoke-src §28) + live store/card on the 7-state `WorkerStatus` vocabulary + dispatch line detection (trust/permission/ready → richer `agent_status` bus events + flat-fallback phase lines) with classified `WorkerFailureKind`; smoke-ext §3d extended. **Doc**: `DESIGN_WORKER_STATUS.md`.
Upgrade `AgentStatus` (4 states) to `WorkerStatus` (7 states: spawning,
trust_required, tool_permission, ready_for_prompt, working, done, failed) +
`WorkerFailureKind`. Borrowed from claw-code's `WorkerStatus`.

#### Sprint 5.15: Agent Permission Modes
**Status**: ✅ SHIPPED (v0.6.2) — pure permission resolvers (`src/permissions.ts` / `src/extension-trust.ts` / `src/redact.ts`, smoke-src §29) + `permission:`/`allow:` roster frontmatter + single spawn-boundary enforcement in `ithacus-dispatch` (resolved `--tools` allowlist + source-trust ceiling + redacted `permission_resolved` audit event); legacy `tools:` pass-through preserved unless `ITHACUS_PERMISSION_STRICT=true`; live-store tool-arg previews secret-redacted. **Doc**: `DESIGN_PERMISSION_MODES.md`.
Per-agent `PermissionMode` (read_only / workspace_write / full_access) declared
in frontmatter, enforced at spawn via child `--tools` allowlist; deny wins.
Adds the `writer` agent. Borrowed from claw-code's `AgentsPermissionArg`.

#### Sprint 5.17: Auto-Compact + Retry on Context-Window Errors
**Status**: SPEC COMPLETE. **Doc**: `DESIGN_AUTO_COMPACT_RETRY.md`.
Detect context-window failure, rebuild a compacted continuation, respawn a
FRESH child (never reuse the failed session — fixes claw-code PR #4's bug).
Borrowed from claw-code PRs #1-4.

#### Sprint 5.16: Session Checkpoint Manager
**Status**: SPEC COMPLETE. **Doc**: `DESIGN_CHECKPOINT_MANAGER.md`.
Checkpoint list/delete/archive/compare on sqlite + `/ithacus-checkpoints`
overlay. Builds on Sprint 2.1 primitives. Borrowed from memory-mcp session
context (patterns only — no Postgres).

#### Sprint 5.18: Memory Consolidation
**Status**: SPEC COMPLETE. **Doc**: `DESIGN_MEMORY_CONSOLIDATION.md`.
Supersede → collapse → cluster pipeline on `ith_memories`, in-process
token-overlap scoring (no embeddings/vector DB). Borrowed from memory-mcp
Trident (concept only).

#### Sprint 5.19: Named Teams + Scheduled Crons
**Status**: SPEC COMPLETE. **Doc**: `DESIGN_TEAMS_CRONS.md`.
Named `TeamRegistry` + cron-bound team schedules + `/ithacus-teams` overlay,
reusing Sprint 4.5 scheduler + Sprint 2.4 async-run path. Borrowed from
claw-code Team/CronRegistry.

#### Sprint 5.21: Teams + Configurable Team Sizes
**Status**: FUTURE SPEC COMPLETE — implementation requires explicit approval.
**Doc**: `DESIGN_TEAMS_AND_SIZES.md`.
Extend 5.19's named teams into versioned presets with dynamically discovered
agent types, explicit role and slot composition, min/default/max total size,
per-role counts, model/provider/profile assignments, validation, run snapshots,
and bounded parallel execution. Preserve tiny–mega as today's 1–6 total-agent
compatibility presets; claw-code's 4–24-agent multiplier pattern is available
only under new unambiguous preset names. Roll out from inspect/dry-run, through
serial named execution, to opt-in capped concurrency.

**Dependencies**: Sprint 5.19 for named-team CRUD/persistence; Sprint 5.15 before
mutating roles execute concurrently; Sprints 5.13/5.20 recommended for live
visibility.

**Approval required**: Yes — schema migration and dispatch semantics change.

---

## TIER 6: FULL ENTERPRISE — WEB UI, TWO-TIER POLICY & OPT-IN REMOTE (2026 landscape response)

> Response to `docs/GAP_ANALYSIS_2026_LANDSCAPE.md`: ithacus v1.0 = local-first
> enterprise harness + opt-in fleet. Tier L stays pristine (PREVENT-ITH-004);
> Tier R (remote) ships default-OFF behind setup-panel toggles.

### Sprint 5.22: Live A2A Accounting

**Status**: 📋 SPEC — `docs/DESIGN_LIVE_A2A_ACCOUNTING.md`

**Scope**: Emit `message_sent`/`message_read`/`handoff_initiated`/
`handoff_accepted` events onto the existing eventBus from mailbox + handoff
paths; add `▌ inbox` and `▌ handoffs` sections to the live card (the 5.13.1
layout made the card section-extensible); wire `src/presence.ts` fleet state
into the workflow view. Peer-to-peer becomes visible, not just parent→child
dispatch.

**Dependencies**: 5.13/5.14 (event bus, worker status, card layout).

---

### Sprint 5.23: Web Interface & Setup Panel

**Status**: 📋 SPEC — `docs/DESIGN_WEB_INTERFACE.md`

**Scope**: Local-first web UI on `node:http`, loopback-only (127.0.0.1,
default port 7447), bundled static assets (no CDN/deps), SSE fed from the
eventBus. Views: Dashboard, Live dispatch detail, Inbox, **Setup panel**
(agent models via `discoverIthacusAgents()`, Tier R toggles, limits, about),
Guardrails readout. Setup panel is THE toggle surface for all opt-in remote
capabilities. Observe + configure in v1; no agent control buttons.

**Dependencies**: Sprint 5.24 first (config schema + capability gate the
panel writes into).

---

### Sprint 5.24: Two-Tier Trust & Connectivity Policy

**Status**: 📋 SPEC — `docs/DESIGN_TWO_TIER_POLICY.md`

**Scope**: Evolve PREVENT-ITH-004 into explicit tiers. Tier L (local, always
on, scan-enforced as today). Tier R (`extensions/opt-in/`, default OFF):
scanner honors `guardrails-allow PREVENT-ITH-004` annotations ONLY in that
subtree; every opt-in file must self-declare; new PREVENT-ITH-005 forbids
non-opt-in code importing opt-in modules without the capability gate.
`RemoteCapabilities` config (master switch + per-capability toggles, env >
project config > defaults-all-off). `extensions/opt-in/gate.ts` runtime gate.
No network code ships in this sprint — policy + scanner + config only.

**Dependencies**: None (foundation).

---

### Sprint 5.25: External Memory Tier (opt-in)

**Status**: 📋 SPEC — `docs/DESIGN_OPTIN_ENTERPRISE.md` §B

**Scope**: Opt-in `MemoryBackend` adapter (Postgres + pgvector reference
impl, DSN via env only, local Ollama embeddings in v1). Augments — never
replaces — sqlite hindsight. Consolidation hooks into Sprint 5.18. Avoids
memory-mcp anti-patterns (compacted-text embedding, inverted scores,
prefix-truncated IDs).

**Dependencies**: Sprint 5.18 (consolidation pipeline), Sprint 5.24 (gate).

---

### Sprint 5.26: Fleet Mesh (opt-in)

**Status**: 📋 SPEC — `docs/DESIGN_OPTIN_ENTERPRISE.md` §C

**Scope**: Ride BYO Tailscale-class mesh (ithacus ships no mesh of its own).
Peer registry via AgentCards over mesh DNS, presence heartbeats, routing via
the Sprint 5.9 A2A client. Loopback A2A server binds to mesh interface only
when mesh enabled + peer allowlist. No libp2p/custom NAT/own PKI.

**Dependencies**: Sprint 5.9 (A2A adapter), Sprint 5.24 (gate).

---

### Sprint 5.27: Live-Card Overlay UX + Web Interface Toggle Surface

**Status**: 📋 SPEC READY — `docs/SPRINT_5_27_UI_OVERLAYS_AND_WEB_TOGGLES.md`
(captured from user reports 2026-08-11)

**Scope**: Fix the live card to render as a true centered overlay
(`overlayOptions.anchor:"center"`, floats above message flow), add size
toggles (small/medium/large via `/ithacus-live size`) and hide/resume
(`/ithacus-live hide|show`, persisted in `ith_kv`); pull forward Sprint 5.23
web interface (loopback `node:http` + SSE + Setup panel) as the opt-out
surface; add `UiFlags` in `src/config.ts` — all local UI flags **default ON**
(Tier R remote caps stay default-OFF per Sprint 5.24).

**Dependencies**: Sprint 5.24 commit first (uncommitted writer changes in
tree); Sprint 5.23 spec for web interface.

**Approval required**: Yes — all three remote sprints (5.9-rework, 5.25,
5.26) require explicit approval per their Tier R status. Sprint 5.27 itself
is Tier L local-only.

---

## Summary

> Note: per-tier counts for Tiers 1-5 predate Sprints 5.5-5.12; the
> TIER 6 row above is the authoritative estimate for the new sprints.

| Tier | Sprints | Weeks | Files Added | Lines Added | Cumulative |
|---|---|---|---|---|---|
| TIER 1 (v0.2.0) | 4 sprints | 8 weeks | +11 | +1,750 | 25 files, 2,950 lines |
| TIER 2 (v0.3.0) | 3 sprints | 6 weeks | +5 | +1,500 | 28 files, 4,000 lines |
| TIER 3 (v0.4.0) | 2 sprints | 4 weeks | +6 | +1,500 | 34 files, 5,500 lines |
| TIER 4 (v1.0+) | 5 sprints | 36-48 weeks | +4 | +1,500 | ~38 files, ~7,000 lines |
| TIER 5 (v1.1+) | 9 sprints | 10-14 weeks | +10 | +2,000 | ~62 files, ~7,700 lines |
| TIER 6 (post-v0.3.x) | 9 sprints | 10-12 weeks | +11 | +2,100 | ~17 files, ~2,600 lines |
| **Total** | **32 sprints** | **74-92 weeks** | **+47** | **+10,350** | **~79 files, ~10,300 lines** |

---

## Sprint Velocity Targets

| Metric | Target |
|---|---|
| Tests per sprint | 15-25 new |
| Guardrails scan | Pass every sprint |
| Regression check | Pass every sprint |
| Max file size | <300 lines (T1), <400 (T2), <500 (T3+) |
| Commit frequency | 1 per feature, not 1 per sprint |
| Documentation | Every new file gets JSDoc header |

---

## Definition of Done

A feature is DONE when:
1. Code is written and passing all tests
2. Guardrails scan passes (node scripts/guardrails-scan.mjs)
3. Regression check passes (python3 scripts/regression_check.py --all)
4. Smoke test passes (node --experimental-strip-types scripts/smoke-src.mjs)
5. JSDoc comments on all exported functions
6. Types defined in src/types.ts or src/types-sprint-N.N.ts split files (types.ts is at 300/300 zero-headroom)
7. No single file exceeds line limit
8. Committed with AI attribution
9. Pushed to remote
