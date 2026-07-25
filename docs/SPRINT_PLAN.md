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
- [ ] src/hindsight.ts: retain (store key facts from session)
- [ ] src/hindsight.ts: recall (query stored facts by relevance)
- [ ] src/hindsight.ts: reflect (compress session into mental model)
- [ ] src/hindsight.ts: extend IthMemory table with hindsight columns
- [ ] src/search.ts: search provider interface
- [ ] src/search.ts: Perplexity provider
- [ ] src/search.ts: Exa provider
- [ ] src/search.ts: Jina provider
- [ ] src/search.ts: fallback chain (try providers in order)
- [ ] src/search.ts: PREVENT-ITH-004 exception annotation
- [ ] src/schemes.ts: pr:// scheme resolution
- [ ] src/schemes.ts: issue:// scheme resolution
- [ ] src/schemes.ts: conflict:// scheme resolution
- [ ] src/types.ts: HindsightEntry, SearchResult, SchemeResolution types
- [ ] Unit tests for retain/recall/reflect, search fallback, scheme parsing
- [ ] Guardrails scan passes

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
- [ ] src/store.ts: events table for activity feed
- [ ] src/store.ts: append agent actions with metadata
- [ ] src/store.ts: query events by run/agent/action type
- [ ] src/definitions.ts: user-defined agent configs (YAML/MD)
- [ ] src/definitions.ts: user-defined team configs
- [ ] src/definitions.ts: 3-layer discovery (builtin < user < project)
- [ ] src/metrics.ts: metrics registry (counters, gauges, histograms)
- [ ] src/metrics.ts: task-level duration/tokens tracking
- [ ] src/metrics.ts: Prometheus export format
- [ ] src/metrics.ts: OTLP export format
- [ ] src/trim.ts: modify decideTrim() to preserve headings/fences
- [ ] src/trim.ts: head+tail boundary detection
- [ ] src/plugins.ts: plugin registry pattern
- [ ] src/plugins.ts: hook into agent spawn
- [ ] src/plugins.ts: framework-aware context injection
- [ ] src/types.ts: ActivityEvent, AgentDefinition, MetricPoint, Plugin types
- [ ] Unit tests for all new modules
- [ ] Guardrails scan passes
- [ ] Regression check passes

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

**Scope**: diagnostics, go-to-definition, find-references, rename, code actions, workspace symbols, document symbols, hover, signature help, formatting, folding, selection range, linked editing, semantic tokens.

**Dependencies**: TIER 3 complete. Requires language server process management.

**Approval required**: Yes

---

### Sprint 4.2 — Browser + Eval (Future, 8-10 weeks)

**Features**: 4.2 Browser automation, 4.3 Persistent eval

**Scope**: Puppeteer/CDP tab management, stealth mode. Python+Bun persistent cells with tool re-entry bridge.

**Dependencies**: TIER 3 complete. Requires process management infrastructure.

**Approval required**: Yes

---

### Sprint 4.3 — TUI + Collab (Future, 8-10 weeks)

**Features**: 4.4 TUI with differential rendering, 4.5 Collab relay

**Scope**: Tool cards, edit previews, ask picker, QR codes. /collab with read-write/read-only links.

**Dependencies**: TIER 3 complete. Requires pi TUI API. Collab needs PREVENT-ITH-004 exception.

**Approval required**: Yes

---

### Sprint 4.4 — DAP + AST + Goal Loops (Future, 10-14 weeks)

**Features**: 4.6 DAP/debug, 4.7 AST edits, 4.8 Goal loops

**Scope**: 28 DAP ops. ast-grep structural rewrites. Autonomous multi-turn with LLM judge.

**Dependencies**: TIER 3 complete. DAP requires debug adapter protocol. AST requires tree-sitter.

**Approval required**: Yes

---

### Sprint 4.5 — Dynamic Workflows + Scheduled Runs (Future, 4-6 weeks)

**Features**: 4.9 Dynamic workflows (.dwf.ts), 4.10 Scheduled runs

**Scope**: Script orchestration as code with trust model. Cron/interval/one-shot scheduling.

**Dependencies**: TIER 1 async runs. Dynamic workflows need isolated-vm for security.

**Approval required**: Yes

---

## Summary

| Tier | Sprints | Weeks | Files Added | Lines Added | Cumulative |
|---|---|---|---|---|---|
| TIER 1 (v0.2.0) | 4 sprints | 8 weeks | +11 | +1,750 | 25 files, 2,950 lines |
| TIER 2 (v0.3.0) | 3 sprints | 6 weeks | +5 | +1,500 | 28 files, 4,000 lines |
| TIER 3 (v0.4.0) | 2 sprints | 4 weeks | +6 | +1,500 | 34 files, 5,500 lines |
| TIER 4 (v1.0+) | 5 sprints | 36-48 weeks | +4 | +1,500 | ~38 files, ~7,000 lines |
| **Total** | **14 sprints** | **54-66 weeks** | **+26** | **+6,250** | **~38 files, ~7,000 lines** |

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
6. Types defined in src/types.ts
7. No single file exceeds line limit
8. Committed with AI attribution
9. Pushed to remote
