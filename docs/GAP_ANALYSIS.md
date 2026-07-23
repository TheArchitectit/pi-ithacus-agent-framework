# GAP ANALYSIS: ithacus vs pi-crew vs pi-messenger

> **Generated:** 2026-07-21
> **ithacus** v0.1.0 (14 source files, greenfield) | **pi-crew** v0.9.46 (431 files, 87K lines, 116 releases) | **pi-messenger** v0.14.1 (651 stars, 42 commits)

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
| Multi-agent team spawning | ✅ `planRun()` mode presets (tiny→mega) | ✅ 6 builtin teams, 10 agent roles, 40+ actions | ✅ Crew: plan→work→review waves |
| Agent roles | 4 (Explore, Plan, Verification, Reviewer) | 10 (analyst, critic, executor, explorer, planner, reviewer, security-reviewer, test-engineer, verifier, writer) | 3 (planner, worker, reviewer) + plan-sync analyst |
| Workflow definitions | 🟡 Preset-based (not user-defined) | ✅ YAML workflows + `.dwf.ts` dynamic scripts | ✅ Plan→work→review with dependency DAG |
| Workflow DAG engine | ⬜ Linear preset expansion only | ✅ Topology analyzer classifies single/sequential/concurrent/complex-dag | ✅ Wave execution with dependency resolution |
| Adaptive planning | ⬜ | ✅ `implementation` workflow: planner agent decides fanout | ✅ Planner auto-discovers PRDs, structures tasks for max parallelism |
| Dynamic workflows (scriptable) | ⬜ | ✅ `.dwf.ts` with `ctx.agent()`, `ctx.fanOut()`, `ctx.budget` | ⬜ |
| Workflow topology advisory | ⬜ | ✅ Pre-flight classification + cost evidence + advisory notes | ⬜ |

### 1.2 Task Management

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Atomic task claims | ✅ SQLite `claimTask()` idempotent INSERT | ✅ FS tmp+rename atomic | ✅ File-based claim/unclaim |
| Task graph / dependencies | ⬜ | ✅ `tasks.json` with phase-based ordering | ✅ Dependency DAG with wave execution |
| Task status tracking | ✅ open/claimed/completed | ✅ Full lifecycle + `needs_attention` terminal state | ✅ ready/in_progress/blocked/done + review verdicts |
| File reservations | ⬜ | ⬜ | ✅ Claim files/directories, block others with clear message |
| Stuck detection | ⬜ | ⬜ | ✅ Idle agents flagged, peer notification |
| Needs-attention status | ⬜ | ✅ Tasks completing without `submit_result` get flagged | ⬜ |

### 1.3 Isolation & Concurrency

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Parallel execution | ✅ `executeBatch()` read-only tool parallelism | ✅ Configurable concurrency, `parallelGroup` | ✅ Wave-based parallel workers |
| Worktree isolation | ⬜ | ✅ Git worktree per task, auto-cleanup, `requireCleanWorktreeLeader` | ⬜ |
| Runtime modes | 1 (pi sub-agents) | 4 (auto, child-process, scaffold, live-session) | 2 (pi subprocesses, scaffold) |
| Async / background runs | ⬜ | ✅ Detached runs survive session switches, completion notifications | ✅ Autonomous mode runs waves back-to-back |

### 1.4 Communication

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Inter-agent messaging | ✅ SQLite inbox (send/unread/markRead) | ✅ FS mailbox, kill signals, progress events | ✅ DM + broadcast + `triggerTurn` wake-up |
| Presence / discovery | ⬜ | ⬜ | ✅ Living presence (status, tokens, tool calls, themed names) |
| Activity feed | ⬜ | 🟡 Event log (events.jsonl) | ✅ Unified timeline (edits, commits, tests, messages) |
| Chat overlay (TUI) | ⬜ | ✅ Live widget, dashboard, progress tracking | ✅ `/messenger` overlay with agents/feed/chat tabs |
| Stuck/health notifications | ⬜ | ✅ Heartbeat watching, deadletter queue | ✅ Stuck detection + peer notification |

### 1.5 Memory & Learning

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| SQLite memory store | ✅ `node:sqlite` decisions/facts/preferences | ⬜ | ⬜ |
| Cross-run knowledge | 🟡 Memory table (kind+text+repoId) | ✅ `.crew/knowledge.md` injected into every agent prompt | ⬜ |
| AGENTS.md feedback loop | ⬜ | ✅ `AgentSuggestion` → human review → shared learnings | ⬜ |
| Durable trim / pressure relief | ✅ `decideTrim()` + agent_end `ctx.compact()` | ✅ Compaction resilience + resume directive injection | ⬜ |
| Skill auto-discovery | ⬜ | ✅ 3-layer discovery (builtin < user < project), SKILL.md validation | ✅ Crew skills (extension, user, project) with on-demand loading |

### 1.6 Observability & Cost

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Cost reporting | ⬜ | ✅ Per-role cost report in `team summary` (tokens, $, turns) | ⬜ (token usage in presence) |
| Metrics / observability | ⬜ | ✅ Prometheus/OTLP exporters, metrics registry, task-level metrics | ⬜ |
| Health scoring | ⬜ | ✅ Penalty-based with time-series snapshots | ⬜ |
| Event replay | ⬜ | ✅ `RunEventBus.onWithReplay()` with seq-based dedup from JSONL | ⬜ |
| Output handling (head+tail) | ⬜ | ✅ Lossless-by-default, head+tail preservation when compacting | ⬜ |
| Import/export runs | ⬜ | ✅ Portable run bundles (tar.gz) | ⬜ |

### 1.7 Extensibility & Safety

| Feature | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| Plugin architecture | ⬜ | ✅ Plugin registry (Next.js, Vite, Vitest context injection) | ⬜ |
| Custom agents/teams/workflows | ⬜ | ✅ 3-layer resource discovery, YAML/MD formats with routing metadata | ✅ Custom project agents via `.pi/messenger/crew/agents/` |
| Plan-level HITL | ⬜ | ✅ `requirePlanApproval` gates at plan→execute boundary | ⬜ |
| Scheduled runs | ⬜ | ✅ Cron, interval, one-shot with auto-cancel | ⬜ |
| Goal loops (autonomous judge) | ⬜ | ✅ LLM judge evaluates transcript against goal, multi-turn | ⬜ |
| Zero network at runtime | ✅ SQLite + FS only | ⬜ | ✅ File-based coordination only |
| PREVENT-* guardrails | ✅ 6 rules (ITH-001→004, DIST-001) | ⬜ | ⬜ |
| Pi-agnostic src/ separation | ✅ No pi imports in src/ | ⬜ | ⬜ |
| Hardened secrets detection | ⬜ | ✅ Linear-time PEM/Bearer/key=value detection | ⬜ |
| Config schema validation | ⬜ | ✅ JSON schema (schema.json) | ⬜ |
| PR #3250 model chain | ✅ `resolveAgentModel` 4-tier fallthrough | ⬜ (different resolution) | ⬜ |
| 404 chain-fallthrough | ⬜ | ⬜ | ⬜ |
| Credential injection | ⬜ | ⬜ | ⬜ |

---

## 2. Gap Categories

### CRITICAL (blocks adoption)

These gaps would prevent users from choosing ithacus over pi-crew or pi-messenger for serious multi-agent work.

| # | Gap | Impact | Who has it |
|---|---|---|---|
| C1 | **No worktree isolation** | Parallel agents editing the same files cause merge conflicts and data loss | pi-crew |
| C2 | **No async/background runs** | Runs die when the session closes; no long-running task survival | pi-crew, pi-messenger |
| C3 | **No workflow DAG engine** | Can't express dependencies between tasks; everything is flat parallel or sequential | pi-crew, pi-messenger |
| C4 | **No task dependency graph** | Tasks can't block on other tasks; no wave execution | pi-crew, pi-messenger |
| C5 | **No presence/messaging overlay** | Agents can't discover each other or communicate beyond inbox polling | pi-messenger |

### IMPORTANT (expected by users)

| # | Gap | Impact | Who has it |
|---|---|---|---|
| I1 | **No file reservations** | Agents can edit the same file simultaneously causing conflicts | pi-messenger |
| I2 | **No cost reporting** | Users can't track token spend per agent/role/run | pi-crew |
| I3 | **No observability/metrics** | No Prometheus/OTLP export, no task-level metrics | pi-crew |
| I4 | **No activity feed** | No unified timeline of agent actions (edits, commits, tests) | pi-crew, pi-messenger |
| I5 | **No crew overlay/dashboard** | No TUI for monitoring team progress | pi-crew, pi-messenger |
| I6 | **No plugin architecture** | Can't inject framework-specific context (Next.js, Vite, etc.) | pi-crew |
| I7 | **No skill auto-discovery** | Agents can't discover and load domain-specific knowledge on demand | pi-crew, pi-messenger |
| I8 | **No adaptive planning** | Planner can't decide optimal agent fanout; presets are fixed | pi-crew, pi-messenger |
| I9 | **No output head+tail preservation** | Compacted outputs lose closing code fences and headings | pi-crew |
| I10 | **No event replay** | Dashboard subscribers lose events during disconnects | pi-crew |
| I11 | **No cross-run knowledge injection** | Memory table exists but not auto-injected into agent prompts | pi-crew |
| I12 | **No custom agent/team/workflow definitions** | Users can't define their own agents or workflows | pi-crew, pi-messenger |
| I13 | **No plan-level HITL** | Can't gate execution at plan→execute boundary | pi-crew |
| I14 | **No goal loops (autonomous judge)** | No self-directed multi-turn with LLM evaluation | pi-crew |

### NICE-TO-HAVE (differentiators)

| # | Gap | Impact | Who has it |
|---|---|---|---|
| N1 | **No scheduled runs** | Can't cron/interval/one-shot team runs | pi-crew |
| N2 | **No import/export runs** | Can't share or archive run bundles | pi-crew |
| N3 | **No health scoring** | No penalty-based run health with time-series | pi-crew |
| N4 | **No topology advisory** | No pre-flight classification warning about workflow overhead | pi-crew |
| N5 | **No dynamic workflows (.dwf.ts)** | Can't script orchestration as code | pi-crew |
| N6 | **No single-agent mode (cliff hedge)** | No fallback when single large-context model outperforms multi-agent | pi-crew |
| N7 | **No config schema validation** | Config errors discovered at runtime, not load time | pi-crew |
| N8 | **No stuck detection** | Idle agents not flagged | pi-messenger |
| N9 | **No swarm/spec-based claims** | No spec-driven task decomposition | pi-messenger |

---

## 3. Prioritized Backlog

Effort estimates: S (1-2 days), M (3-5 days), L (1-2 weeks), XL (2-4 weeks)

### P0 — Foundation (blocks serious usage)

| # | Task | Addresses | Effort | Notes |
|---|---|---|---|---|
| P0-1 | **Workflow DAG engine** — parse task dependencies, topological sort, wave execution | C3, C4 | L | Model after pi-messenger's wave execution; simpler than pi-crew's YAML system |
| P0-2 | **Worktree isolation** — `git worktree add` per agent, auto-cleanup on completion | C1 | M | Port PR #3250's `setup_agent_worktree`/`teardown_agent_worktree` from Rust |
| P0-3 | **Async/background runs** — detach from session, persist to SQLite, notify on completion | C2 | M | Store run state in SQLite; spawn detached child process |
| P0-4 | **File reservations** — claim paths via SQLite, block conflicting writes | I1 | S | pi-messenger pattern: block `tool_call` hook on write/edit |
| P0-5 | **Presence system** — agent join/leave, status tracking, discovery | C5 | L | Foundation for messaging overlay; SQLite-backed agent registry |

### P1 — Core features (expected by users)

| # | Task | Addresses | Effort | Notes |
|---|---|---|---|---|
| P1-1 | **Cost reporting** — track tokens per agent/role/run, surface in summary | I2 | S | Extend agent_end handler to accumulate costs |
| P1-2 | **Activity feed** — unified timeline of agent actions | I4 | M | Append to SQLite events table; query by run/agent |
| P1-3 | **Crew overlay/dashboard** — TUI for monitoring team progress | I5 | L | Use pi's `ctx.ui.custom()` or TUI widget API |
| P1-4 | **Custom agent/team/workflow definitions** — user-defined YAML/MD configs | I12 | L | 3-layer discovery: builtin < user < project |
| P1-5 | **Skill auto-discovery** — discover SKILL.md from extension/user/project paths | I7 | M | Follow pi-crew's 3-layer pattern |
| P1-6 | **Adaptive planning** — planner agent decides optimal fanout | I8 | M | Single `assess` step before execution |
| P1-7 | **Observability** — metrics registry, task-level duration/tokens | I3 | M | SQLite metrics table + export hooks |
| P1-8 | **Output head+tail preservation** — keep fences/headings on compaction | I9 | S | Modify durable-trim to preserve boundaries |

### P2 — Advanced (competitive differentiation)

| # | Task | Addresses | Effort | Notes |
|---|---|---|---|---|
| P2-1 | **Event replay** — seq-based dedup from durable log for re-subscribing dashboards | I10 | M | Extend events.jsonl with sequence numbers |
| P2-2 | **Cross-run knowledge injection** — auto-inject memory into agent prompts | I11 | S | Prepend memory entries to system prompt at spawn |
| P2-3 | **Plan-level HITL** — gate at plan→execute boundary | I13 | S | Pause run, await approval signal |
| P2-4 | **Goal loops** — autonomous multi-turn with LLM judge | I14 | L | Separate evaluator model, achievement verdict |
| P2-5 | **Plugin architecture** — framework-aware context injection | I6 | M | Registry pattern, hook into agent spawn |
| P2-6 | **Dynamic workflows** — `.dwf.ts` script orchestration | N5 | XL | Trust model required; consider isolated-vm |
| P2-7 | **Inter-agent DM/broadcast** — direct messaging beyond inbox | C5 | M | Requires presence system (P0-5) |

### P3 — Polish (nice-to-have)

| # | Task | Addresses | Effort | Notes |
|---|---|---|---|---|
| P3-1 | **Scheduled runs** — cron/interval/one-shot | N1 | M | Requires async runs (P0-3) |
| P3-2 | **Import/export runs** — portable bundles | N2 | S | Tar/gzip artifacts + manifest |
| P3-3 | **Health scoring** — penalty-based with time-series | N3 | S | Time-series from events table |
| P3-4 | **Topology advisory** — pre-flight workflow classification | N4 | S | Pure classifier on workflow graph |
| P3-5 | **Config schema validation** — JSON schema at load time | N7 | S | Generate schema from types |
| P3-6 | **Stuck detection** — idle agent flagging | N8 | S | Timer-based on lastSeen |
| P3-7 | **Single-agent mode** — cliff hedge fallback | N6 | S | Compose all phases into one prompt |
| P3-8 | **Swarm/spec-based claims** — spec-driven task decomposition | N9 | M | Parse PRD into claim tasks |

---

## 4. What Ithacus Does Better

### 4.1 Zero-Network Runtime (PREVENT-ITH-004)

Ithacus is the **only** project that enforces zero network calls at runtime as a hard architectural constraint. All state lives in `node:sqlite` and the filesystem. This eliminates entire classes of failures: DNS, auth token expiry, API rate limits, proxy misconfiguration. The guardrail is scan-enforced (`scripts/guardrails-scan.mjs`). Neither pi-crew nor pi-messenger makes this commitment — pi-crew has OTLP exporters and potential external calls; pi-messenger is file-based but doesn't enforce it as a rule.

### 4.2 PREVENT-* Guardrail System

Six scan-enforced rules with severity levels (error/critical) that catch architectural violations at the code level:

- **PREVENT-ITH-001**: Never drop messages without an anchor floor
- **PREVENT-ITH-002**: Never split toolCall/toolResult pairs at trim boundaries
- **PREVENT-ITH-003**: Never inject context as `role:"system"` — use `systemPrompt`
- **PREVENT-ITH-004**: Zero network at runtime
- **PREVENT-DIST-001**: Distribute only via npm publish + pi install

Neither competitor has this level of automated architectural enforcement.

### 4.3 Pi-Agnostic Separation

Ithacus's `src/` directory imports zero pi runtime types. Every module (`config.ts`, `store.ts`, `team.ts`, `parallel.ts`, `trim.ts`) is unit-testable with `node --test` in isolation. The pi adapter layer (`extensions/`) is the only place that touches the ExtensionAPI. This clean separation means:

- **Unit tests run without pi runtime** — faster CI, no mock scaffolding
- **Future portability** — the core logic could power non-pi orchestrators
- **Clear dependency boundary** — no accidental coupling to pi internals

pi-crew and pi-messenger both interleave pi types throughout their codebase.

### 4.4 PR #3250 Model Resolution Chain

Ithacus faithfully ports the 4-tier model resolution from claw-code PR #3250:

```
resolveAgentModel: explicit → subagentModel → providerModel → DEFAULT_AGENT_MODEL
```

With `qualifyForProvider()` for custom-openai prefix normalization and `buildModelChain()` for deduplicated fallback ordering. This is the most robust sub-agent model routing in the ecosystem — pi-crew has its own resolution but doesn't follow the PR #3250 chain; pi-messenger uses simple per-role model config.

### 4.5 Lightweight Footprint

14 source files vs 431 (pi-crew) or 651-star community project (pi-messenger). Zero dependencies. Runs on `node:sqlite` + FS only. No build step required (`--experimental-strip-types`). This makes ithacus the easiest to audit, fork, and understand.

### 4.6 Durable Trim with Anchor Floor

The `decideTrim()` function implements PR #3250's durable-trim pattern: it respects an anchor floor (preserve recent N messages), never splits toolCall/toolResult pairs (PREVENT-ITH-002), and triggers `ctx.compaction` during idle windows. This is a more conservative and safer approach than pi-crew's compaction resilience (which detects and resumes) — ithacus proactively prevents context overflow.

### 4.7 SQLite Memory Layer

The `IthMemory` table (kind: decision/fact/preference, scoped to repoId) provides a structured, queryable memory store that neither competitor offers. pi-crew uses a markdown file (`.crew/knowledge.md`); pi-messenger has no persistent memory. SQLite enables:

- Efficient queries by kind, repo, time range
- Atomic updates without file corruption risk
- Future: embeddings, similarity search, memory consolidation

---

## 5. Architecture Verdict

### Maturity Assessment

| Dimension | ithacus | pi-crew | pi-messenger |
|---|---|---|---|
| **Maturity** | Pre-alpha (v0.1.0) | Production-ready (v0.9.46, 116 releases) | Stable (v0.14.1, 651 stars) |
| **Scope** | Orchestration core | Full orchestration + workflows + observability | Communication + presence + crew |
| **Test coverage** | Smoke tests | ~5,860 tests, 0 failures | Unit tests |
| **Architecture** | Clean separation, pi-agnostic | Integrated, pi-native | Integrated, pi-native |
| **Primary value** | Correctness constraints, zero-network, model chain | Feature completeness, workflow flexibility | Agent communication, presence |

### Strategic Position

Ithacus occupies a **unique niche**: the only orchestrator that prioritizes architectural correctness (guardrails, zero-network, pi-agnostic separation) over feature breadth. This is a defensible position — users who care about auditability, security constraints, and clean architecture will prefer ithacus.

However, the feature gap is **substantial**. pi-crew has 116 releases of iterative refinement with ~5,860 tests. pi-messenger has 651 stars and solves the communication problem that ithacus barely touches. Ithacus needs to close the CRITICAL gaps (worktree isolation, async runs, DAG engine, file reservations, presence) before it can be considered for production use.

### Recommended Path

1. **Close P0 gaps** (C1-C5) — these are table stakes for multi-agent orchestration
2. **Leverage unique strengths** — market zero-network + guardrails as the differentiator
3. **Consider hybrid approach** — ithacus core + pi-messenger for presence/messaging (complementary, not competing)
4. **Don't chase pi-crew feature parity** — focus on correctness-first orchestration, not workflow scripting

---

```json
{
  "version": "1.0",
  "status": "complete",
  "summary": "Comprehensive gap analysis comparing ithacus (v0.1.0, 14 files) against pi-crew (v0.9.46, 431 files) and pi-messenger (v0.14.1, 651 stars). 5 CRITICAL gaps (worktree isolation, async runs, DAG engine, task dependencies, presence), 14 IMPORTANT gaps (file reservations, cost reporting, observability, overlay, plugins, skills, adaptive planning, output handling, event replay, knowledge injection, custom definitions, HITL, goal loops), 9 NICE-TO-HAVE gaps. 7 identified ithacus advantages: zero-network runtime, PREVENT-* guardrails, pi-agnostic separation, PR #3250 model chain, lightweight footprint, durable trim with anchor floor, SQLite memory. Prioritized backlog: 5 P0 tasks, 8 P1 tasks, 7 P2 tasks, 8 P3 tasks.",
  "files": ["docs/GAP_ANALYSIS.md"],
  "actions": [
    "Created docs/GAP_ANALYSIS.md with feature matrix across 7 categories (42 feature rows)",
    "Identified 5 CRITICAL gaps blocking adoption (C1-C5)",
    "Identified 14 IMPORTANT gaps expected by users (I1-I14)",
    "Identified 9 NICE-TO-HAVE gaps (N1-N9)",
    "Documented 7 ithacus advantages over competitors",
    "Created prioritized backlog: 5 P0, 8 P1, 7 P2, 8 P3 tasks with effort estimates",
    "Provided architecture verdict and strategic positioning"
  ],
  "notDone": [
    "Could not access pi-crew docs/observability.md (404) — observability details inferred from README",
    "Could not access pi-crew src/ directory listing — architecture inferred from README and schema.json",
    "pi-messenger store.ts not fully analyzed — fetched but truncated",
    "No live test execution — analysis based on source reading and documentation only"
  ],
  "nextSteps": [
    "Review GAP_ANALYSIS.md for accuracy and completeness",
    "Prioritize P0 tasks based on project goals",
    "Consider hybrid approach: ithacus core + pi-messenger for presence/messaging",
    "Begin P0-1 (Workflow DAG engine) as highest-impact foundation work"
  ],
  "reasoning": [
    "pi-crew is the most feature-complete competitor with 116 releases and ~5,860 tests — feature parity is not the goal",
    "pi-messenger solves the communication/presence problem that ithacus barely touches — consider integration over competition",
    "ithacus's unique value (zero-network, guardrails, pi-agnostic) is defensible but needs CRITICAL gap closure first",
    "The workflow DAG engine (P0-1) enables everything downstream: task dependencies, wave execution, adaptive planning",
    "Worktree isolation (P0-2) is a prerequisite for safe parallel editing — without it, parallel agents cause conflicts"
  ],
  "notes": [
    "Analysis based on: ithacus source (14 files), pi-crew README (1291 lines) + schema.json, pi-messenger README (854 lines) + store.ts",
    "pi-crew version: v0.9.46 (latest, Jul 20 2026). pi-messenger version: v0.14.1",
    "Effort estimates assume single developer familiar with pi extension architecture",
    "P0 tasks are interdependent: DAG engine enables wave execution, worktree needs async runs for practical use"
  ]
}
```