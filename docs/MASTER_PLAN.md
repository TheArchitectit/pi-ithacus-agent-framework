# MASTER PLAN — ithacus v1.0 Feature Roadmap

> **Generated**: 2026-07-21  
> **Status**: Active — consolidates `GAP_ANALYSIS.md` (pi-crew, pi-messenger) and `GAP_ANALYSIS_OMP.md` (oh-my-pi)  
> **Last updated**: 2026-07-21

---

## Executive Summary

**ithacus** is a lean, safety-first pi extension (14 files, 1,216 lines of TypeScript) that orchestrates coordinated sub-agent teams. It occupies the **"lean + safe extension"** niche — the only orchestrator that enforces zero-network runtime, formal PREVENT-* guardrails, and pi-agnostic `src/` separation.

Three competitors define the feature landscape:

| Project | Profile | Scale |
|---|---|---|
| **pi-crew** | Orchestration platform | 431 files, 87K lines, 116 releases, ~5,860 tests |
| **pi-messenger** | Agent communication & presence | 651 stars, 49 forks, file-based coordination |
| **oh-my-pi** | Full platform rewrite (Rust) | 19.3k stars, 535 releases, 55K LoC Rust core, 32 built-in tools |

**Goal**: Close CRITICAL and IMPORTANT gaps across all three competitors while preserving ithacus's zero-network, guardrails, and lightweight footprint advantages.

**Strategy**: Build features as pi extension modules. Adopt oh-my-pi's best patterns in TypeScript. Integrate pi-messenger's communication model via SQLite. Do NOT replicate oh-my-pi's Rust native layer.

---

## Gap Summary Across All 3 Competitors

| Category | pi-crew gaps | pi-messenger gaps | oh-my-pi gaps | Unique to ithacus |
|---|---|---|---|---|
| **Orchestration** | DAG engine, worktree isolation, async runs, adaptive planning, dynamic workflows | Presence, file reservations, crew overlay | Schema validation, advisor mode, checkpoint/rewind, atomic commits | Zero-network (PREVENT-ITH-004), PREVENT-* guardrails |
| **Communication** | DM/broadcast, activity feed, event replay | Presence system, stuck detection, status overlay | Collab relay, hub messaging | SQLite inbox, durable trim with anchor floor |
| **Tools & Formats** | Skills discovery, plugins, export/import, cost reporting | — | 32 built-in tools, LSP (14 ops), DAP (28 ops), browser, eval, search (25 providers), hashline edits | PR #3250 model chain, pi-agnostic separation |
| **Context & Memory** | Event replay, output head+tail preservation, cross-run knowledge injection | Context injection levels | Stream rules, hashline anchoring, Hindsight memory (retain/recall/reflect), checkpoint/rewind | SQLite memory store, PREVENT-ITH-001 (anchor floor), PREVENT-ITH-002 (tool-pair preservation) |
| **Extensibility** | Custom agents/teams/workflows, plugin registry, scheduled runs | Custom crew agents | Config inheritance (8 formats), skills auto-discovery, self-update | Lightweight footprint (14 files), zero build step |

---

## Implementation Tiers

### TIER 1 — Foundation (v0.2.0, ~8 weeks)

Must-have for any serious multi-agent usage. These close the 5 CRITICAL gaps identified across pi-crew and pi-messenger.

| # | Feature | New Files | Effort | Addresses | Notes |
|---|---|---|---|---|---|
| 1.1 | **Workflow DAG engine** | `src/workflow.ts` | 2 weeks | C3 (pi-crew), C4 (pi-crew) | Phases, dependencies, wave execution, topological sort. Models after pi-messenger's wave execution. Extends `planRun` in `src/team.ts`. |
| 1.2 | **Worktree isolation** | `src/worktree.ts`, `extensions/ithacus-worktree.ts` | 1.5 weeks | C1 (pi-crew), C6 (omp) | `git worktree add` per agent, auto-cleanup. Ports PR #3250's `setup_agent_worktree`/`teardown_agent_worktree` from Rust. |
| 1.3 | **Async background runs** | `src/async.ts`, `extensions/ithacus-async.ts` | 1 week | C2 (pi-crew) | Detach from session, persist to SQLite, notify on completion. Store run state in `IthRuns`, spawn detached child process. |
| 1.4 | **Task dependencies** | Schema change in `src/store.ts` | 0.5 weeks | C4 (pi-crew) | Add `dependsOn`, `wave`, `phase` columns to `IthTasks`. Enables topological sort by `workflow.ts`. |
| 1.5 | **Presence tracking** | `src/presence.ts`, `extensions/ithacus-presence.ts` | 1.5 weeks | C5 (pi-messenger) | Heartbeat, stuck detection, agent status. SQLite-backed registry. Foundation for messaging overlay. |
| 1.6 | **File reservations** | `src/reservations.ts` | 0.5 weeks | I1 (pi-crew) | Claim paths via SQLite, block conflicting writes on write/edit hooks. pi-messenger pattern. |
| 1.7 | **Cost reporting** | `src/cost.ts` | 0.5 weeks | I2 (pi-crew) | Extend `agent_end` handler to track tokens/cost per agent/role/run. Surface in team summary. |
| 1.8 | **Schema-validated subagent results** | Schema change in `src/team.ts` | 0.5 weeks | C5 (omp) | Typed output schema on agent completion. Low effort, high reliability gain. |
| 1.9 | **Reverse Prompt Validation** | `src/validator.ts` | 0.5 weeks | Unique | Rules-based pre-execution prompt quality gate. Scores clarity/completeness/safety/scope, recommends profile + team size. Zero-cost, <10ms. See `docs/DESIGN_REVERSE_PROMPT_VALIDATION.md`. |
| 1.10 | **Interactive Model Profiles** | `src/model-profiles.ts` | 1 week | Unique | Named model configurations (Speed/Quality/Reasoning/Code/Local). Interactive prompt at team creation. Per-role model assignment. Cost estimation. See `docs/DESIGN_MODEL_PROFILES.md`. |

**TIER 1 total**: 11 new files, ~1,750 additional lines, ~8 weeks  
**After TIER 1**: 25 files, ~2,950 lines  
**CRITICAL gaps closed**: 5/5 (pi-crew), 2/7 (omp)

---

### TIER 2 — Competitive Parity (v0.3.0, ~6 weeks)

Expected by users who've experienced oh-my-pi's edit efficiency and pi-crew's advanced orchestration.

| # | Feature | New Files | Effort | Addresses | Notes |
|---|---|---|---|---|---|
| 2.1 | **Hashline edit format** | `src/hashline.ts` | 1.5 weeks | C1 (omp) | Content-hash anchored edits, stale-anchor recovery. 61% fewer output tokens. Reference oh-my-pi's implementation in TypeScript. |
| 2.2 | **Advisor mode** | `extensions/ithacus-advisor.ts` | 1 week | C3 (omp) | Second model watching turns, injecting notes inline (concern/blocker/suggestion). Separate context. Default off, budget-controlled. |
| 2.3 | **Checkpoint/Rewind** | `src/checkpoint.ts` | 1 week | C4 (omp) | Mark state, prune exploratory context, keep concise report. Complements durable trim. |
| 2.4 | **Stream rules** | `src/stream-rules.ts` | 1 week | I1 (omp) | Regex-based mid-stream injection, survives compaction. oh-my-pi's "time-traveling regex" pattern adapted. |
| 2.5 | **Config inheritance** | Extension to `src/config.ts` | 0.5 weeks | I6 (omp) | Read 8 rule formats (Cursor MDC, Cline .clinerules, Codex AGENTS.md, Copilot applyTo, etc.). |
| 2.6 | **Skills auto-discovery** | Extension to `src/config.ts` | 0.5 weeks | I7 (pi-crew, omp) | 3-layer discovery: extension < user < project. SKILL.md validation. pi-crew pattern. |
| 2.7 | **Code review** | Extension to `extensions/ithacus-events/` | 0.5 weeks | I10 (omp) | Dedicated reviewer subagents with P0-P3 priority, confidence scoring. |
| 2.8 | **Atomic commit splits** | `src/commits.ts` | 0.5 weeks | C7 (omp) | Dependency-ordered commits, source scored above tests/docs. |

**TIER 2 total**: 5 new files, ~1,500 additional lines, ~6 weeks  
**After TIER 2**: 28 files, ~4,000 lines  
**CRITICAL gaps closed**: 6/7 (omp), IMPORTANT gaps closed: 5/14 (pi-crew), 4/14 (omp)

---

### TIER 3 — Differentiation (v0.4.0, ~4 weeks)

Features that make ithacus unique — leveraging its SQLite foundation and guardrails system.

| # | Feature | New Files | Effort | Addresses | Notes |
|---|---|---|---|---|---|
| 3.1 | **Hindsight memory** | `src/hindsight.ts` | 1 week | I9 (omp) | Retain/recall/reflect, session compression into mental model. Extends existing `IthMemory` table. |
| 3.2 | **Web search providers** | `src/search.ts` | 1 week | I4 (omp) | Integrate search chain (Perplexity, Exa, Jina, etc.). Opt-in exception to PREVENT-ITH-004 with annotation. |
| 3.3 | **GitHub schemes** | `src/schemes.ts` | 0.5 weeks | I5 (omp) | `pr://`, `issue://`, `conflict://` resolution. Read PRs as files. |
| 3.4 | **Activity feed** | Extension to `src/store.ts` | 0.5 weeks | I4 (pi-crew) | Unified timeline of agent actions. Append to SQLite events table, query by run/agent. |
| 3.5 | **Custom agent/team definitions** | `src/definitions.ts` | 0.5 weeks | I12 (pi-crew) | User-defined YAML/MD configs, 3-layer discovery (builtin < user < project). |
| 3.6 | **Observability** | `src/metrics.ts` | 0.5 weeks | I3 (pi-crew) | Metrics registry, task-level duration/tokens, Prometheus/OTLP export hooks. |
| 3.7 | **Output head+tail preservation** | Extension to `src/trim.ts` | 0.5 weeks | I9 (pi-crew) | Keep fences/headings on compaction. Modify `decideTrim()` to preserve boundaries. |
| 3.8 | **Plugin architecture** | `src/plugins.ts` | 0.5 weeks | I6 (pi-crew) | Registry pattern, hook into agent spawn for framework-aware context injection. |

**TIER 3 total**: ~6 new files, ~1,500 additional lines, ~4 weeks  
**After TIER 3**: 34 files, ~5,500 lines  
**IMPORTANT gaps closed**: 10/14 (pi-crew), 7/14 (omp)

---

### TIER 4 — Aspirational (v1.0+, future)

Requires platform-level changes, significant effort, or upstream Pi API extensions. Each item needs explicit approval before starting.

| # | Feature | Effort | Blocks | Notes |
|---|---|---|---|---|
| 4.1 | **LSP integration** | XL (4-6 weeks) | C2 (omp) | 14 LSP ops (diagnostics, navigation, renames, code actions). Requires language server protocol implementation. Major effort for an extension. |
| 4.2 | **Browser automation** | XL (4-6 weeks) | I3 (omp) | Puppeteer/CDP integration. Stealth mode, tab management. Platform-level dependency. |
| 4.3 | **Persistent eval** | L (2-3 weeks) | I13 (omp) | Python+Bun cells with tool re-entry bridge. Requires process management. |
| 4.4 | **TUI with differential rendering** | XL (4-6 weeks) | I11 (omp) | Tool cards, edit previews, ask picker, QR codes. Requires pi TUI API. |
| 4.5 | **Collab relay** | L (2-3 weeks) | I12 (omp) | `/collab` with QR codes, read-write/read-only links. Conflicts with PREVENT-ITH-004. |
| 4.6 | **DAP/debug integration** | XL (4-6 weeks) | — | Breakpoints, stepping, variables, attach lldb/dlv/debugpy. 28 DAP operations. |
| 4.7 | **AST edits with preview** | L (2-3 weeks) | I14 (omp) | ast-grep structural rewrites, 50+ grammar support. Requires tree-sitter integration. |
| 4.8 | **Goal loops** | L (2-3 weeks) | I14 (pi-crew) | Autonomous multi-turn with LLM judge. Separate evaluator model, achievement verdict. |
| 4.9 | **Dynamic workflows (.dwf.ts)** | XL (3-4 weeks) | N5 (pi-crew) | Script orchestration as code. Trust model required; consider isolated-vm. |
| 4.10 | **Scheduled runs** | M (1-2 weeks) | N1 (pi-crew) | Cron, interval, one-shot. Requires async runs (TIER 1). |

---

### TIER 5 — Advanced Swarm Workflows (v1.1+, future)

Closes every agent-workflow gap found across radcode, radical, and memory-mcp. ithacus stays purely agent-workflow orchestration (no memory/KG/RAG — separate project). src/ stays pi-agnostic + zero-network; real A2A networking lives in extensions/ (Sprint 5.9, PREVENT-ITH-004 exception).

| # | Feature | Effort | Blocks | Notes |
|---|---|---|---|---|
| 4.11 | **Priority work-queue state machine** | M (1 week) | — | P0-P3, INGRESS→NEXT→NOW→DONE/FAILED, per-item deps. memory-mcp pattern. |
| 4.12 | **Task lifecycle store** | M (1 week) | 4.11 | create/get/update/cancel/list/count + TaskStore ABC + SQLite impl. |
| 4.13 | **DAG step retry/timeout/on_error** | L (1-2 weeks) | — | Per-step retry_count, asyncio.wait_for-style timeout, on_error routing. |
| 4.14 | **Rich step types** | L (1-2 weeks) | 4.13 | CONDITION/LOOP/HUMAN_REVIEW/SUBWORKFLOW + YAML templates. |
| 4.15 | **YAML workflow templates** | M (1 week) | 4.14 | Template loader + entry-point walker. |
| 4.16 | **Inter-agent negotiation protocol** | L (1-2 weeks) | 4.12 | TaskOffer/Accept/Reject/Counter, ResourceRequest/Grant/Deny. In-process. |
| 4.17 | **Agent handoff protocol** | M (1 week) | 4.12 | HandoffReason/Priority + capability-based routing. |
| 4.18 | **Swarm dispatch loop** | L (1 week) | 4.11, 4.13 | Priority-ordered, blocked-wait, checkpoint-every-N. |
| 4.19 | **Result synthesis engine** | L (1 week) | 4.18 | Attribution + conflict resolution + scoring. |
| 4.20 | **Structured WorkflowResult** | S (0.5 week) | 4.18 | tasks[], total_time, final_output, errors[]. |
| 4.21 | **Hive filesystem convention** | M (1 week) | 4.18 | .pi/ithacus/ structured dirs (hive_mind/LOCKS, communication/inbox/handoffs, workspaces/<role>, artifacts, audit). |
| 4.22 | **Token-budget governor** | M (1 week) | — | USD cap + 50%/90% alerts + refuse-to-exceed. Upgrade cost.ts. |
| 4.23 | **Capability-based leader election** | L (1 week) | 4.12 | LeaderElection::CapabilityBased + DelegationPattern. |
| 4.24 | **Keyword→role task router** | M (1 week) | 4.12 | Weighted keyword→role(s) routing. |
| 4.25 | **Swarm messaging bus** | L (1-2 weeks) | 4.18 | In-process pub/sub blackboard. |
| 4.26 | **Named recovery protocol** | M (1 week) | 4.25 | Phoenix-style structured failure-recovery states. |
| 4.27 | **Distributed task claiming** | M (1 week) | 4.11 | Leases + stale-expiry. SQLite-based. |
| 4.28 | **Priority deadline queue** | S (0.5 week) | 4.11 | pop_highest_priority/pop_earliest_deadline/overdue_tasks. |
| 4.29 | **SprintTracker** | S (0.5 week) | 4.22 | sprint/status/tasks/token-metrics/file-mod tracking. |
| 4.30 | **52-week planning scheduler** | M (1 week) | 4.29 | Dependency-aware auto-scheduling + Gantt. |
| 4.31 | **A2A protocol adapter** | XL (2-3 weeks) | 4.16,4.17,4.25 | extensions/ — HTTP/JSON-RPC, SSE, HMAC webhooks, Agent Card, Federation. PREVENT-ITH-004 exception. |

**TIER 5 total**: ~10 new files, ~2,000 additional lines, ~10-14 weeks.

---

## New File Map

| File | Tier | Lines (est.) | Purpose |
|---|---|---|---|
| `src/workflow.ts` | T1 | ~200 | DAG engine, phases, dependencies, wave execution, topological sort |
| `src/worktree.ts` | T1 | ~100 | Git worktree management per agent |
| `src/async.ts` | T1 | ~100 | Async/background run management, detached child spawning |
| `src/presence.ts` | T1 | ~120 | Agent presence, heartbeat, stuck detection |
| `src/reservations.ts` | T1 | ~60 | File path reservation system via SQLite |
| `src/cost.ts` | T1 | ~80 | Token/cost tracking per agent/role/run |
| `extensions/ithacus-worktree.ts` | T1 | ~80 | Worktree lifecycle hooks (spawn/complete/cleanup) |
| `extensions/ithacus-async.ts` | T1 | ~60 | Async run spawn/monitor hooks |
| `extensions/ithacus-presence.ts` | T1 | ~60 | Presence tracking hooks (join/leave/heartbeat) |
| `src/validator.ts` | T1 | ~200 | Rules-based prompt validation engine (RPV) |
| `src/model-profiles.ts` | T1 | ~250 | Model profile CRUD, seeding, cost estimation, resolution |
| `src/hashline.ts` | T2 | ~150 | Content-hash anchored edit format |
| `src/checkpoint.ts` | T2 | ~100 | Checkpoint/rewind context management |
| `src/stream-rules.ts` | T2 | ~80 | Regex-based mid-stream rule injection |
| `extensions/ithacus-advisor.ts` | T2 | ~100 | Second model watching turns, inline note injection |
| `src/commits.ts` | T2 | ~80 | Atomic commit splits with dependency ordering |
| `src/hindsight.ts` | T3 | ~120 | Retain/recall/reflect memory system |
| `src/search.ts` | T3 | ~100 | Web search provider chain |
| `src/schemes.ts` | T3 | ~80 | GitHub scheme resolution (pr://, issue://) |
| `src/metrics.ts` | T3 | ~80 | Metrics registry and export hooks |
| `src/plugins.ts` | T3 | ~60 | Plugin registry for framework context injection |
| `src/definitions.ts` | T3 | ~80 | Custom agent/team/workflow definitions |
| `src/queue.ts` | T5 | ~200 | Priority work-queue state machine (P0-P3, deps, get_ready_items) |
| `src/workflow-yaml.ts` | T5 | ~150 | YAML workflow template loader + StepType enum |
| `src/negotiation.ts` | T5 | ~150 | TaskOffer/Accept/Reject/Counter, ResourceRequest/Grant/Deny |
| `src/handoff.ts` | T5 | ~120 | HandoffReason/Priority + capability routing |
| `src/swarm.ts` | T5 | ~200 | Swarm dispatch loop + hive filesystem convention |
| `src/synthesis.ts` | T5 | ~150 | Attribution + conflict resolution + scoring |
| `src/budget.ts` | T5 | ~120 | Token-budget governor (USD cap + alerts + refuse) |
| `src/leader.ts` | T5 | ~120 | Capability-based leader election + delegation |
| `src/router.ts` | T5 | ~120 | Keyword→role weighted task router |
| `src/bus.ts` | T5 | ~150 | In-process messaging bus / blackboard pub/sub |
| `src/recovery.ts` | T5 | ~120 | Named failure-recovery protocol (Phoenix-style) |
| `src/claiming.ts` | T5 | ~120 | Distributed task claiming w/ leases + stale-expiry |
| `src/sprint-tracker.ts` | T5 | ~150 | Sprint/status/tasks/token-metrics/file-mod tracking |
| `extensions/ithacus-a2a.ts` | T5 | ~200 | A2A network adapter (PREVENT-ITH-004 exception) |

---

## Migration Path

```
Current (v0.1.0):     14 files  │  1,216 lines
                        │
                        ▼
After TIER 1 (v0.2.0): 25 files  │  ~2,950 lines  (+11 files, ~1,750 lines)
                        │
                        ▼
After TIER 2 (v0.3.0): 28 files  │  ~4,000 lines  (+5 files, ~1,500 lines)
                        │
                        ▼
After TIER 3 (v0.4.0): 34 files  │  ~5,500 lines  (+6 files, ~1,500 lines)
                        │
                        ▼
v1.0 target:           ~38 files  │  ~7,000 lines  (T4 items as approved)
```

Growth is linear and bounded. Each tier adds 6-8 files and ~1,300-1,500 lines. The 800-line-per-stage size gate is respected — no single file exceeds it.

---

## Decision: Integrate vs Build vs Defer

| Feature | Decision | Rationale |
|---|---|---|
| **Presence/messaging** | **BUILD** | pi-messenger is a separate system; ithacus needs lightweight SQLite-backed presence that integrates with its store |
| **Hashline edits** | **BUILD** (reference omp) | Must be TypeScript for pi extension model; reference oh-my-pi's implementation |
| **Web search** | **BUILD** | pi extension can integrate search providers directly; opt-in exception to PREVENT-ITH-004 |
| **Skills discovery** | **BUILD** | Simple 3-layer file discovery pattern; no external dependency |
| **Config inheritance** | **BUILD** | Read existing rule files from disk; pure file parsing |
| **LSP integration** | **DEFER** (T4) | Requires language server protocol implementation; major effort for an extension |
| **Browser automation** | **DEFER** (T4) | Requires Puppeteer/CDP integration; platform-level dependency |
| **Persistent eval** | **DEFER** (T4) | Requires long-running process management; complexity vs value |
| **TUI rewrite** | **DEFER** (T4) | Requires pi TUI API; use pi's default TUI for now |
| **Collab relay** | **DEFER** (T4) | Conflicts with PREVENT-ITH-004; needs explicit exception approval |
| **DAP/debug** | **DEFER** (T4) | 28 DAP operations; requires debug adapter protocol implementation |
| **Rust native tools** | **NEVER** | oh-my-pi's 55K LoC Rust layer is not replicable as a pi extension |

---

## Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Scope creep** — trying to match oh-my-pi's 32 tools | High | Critical | Strict tier system; T4 items require explicit approval; "never" list enforced |
| R2 | **Zero-network conflict with web search** | Medium | High | Make search opt-in with `// guardrails-allow PREVENT-ITH-004: user-initiated search`; document as controlled exception |
| R3 | **Worktree isolation complexity** | Medium | Medium | Start with basic `git worktree add`; advanced features (merge, conflict detection) later; test with simple parallel scenarios first |
| R4 | **SQLite performance for presence** | Low | Medium | Use polling intervals (5-10s); don't attempt real-time; benchmark with 10+ concurrent agents |
| R5 | **Advisor model cost** | Medium | Medium | Make advisor optional, default off; budget-controlled; warn on token usage |
| R6 | **Hashline edit compatibility** | Medium | High | Must be drop-in replacement for pi's edit; fallback to default format on hash mismatch |
| R7 | **Extension API limitations** | Medium | High | Some features may require upstream pi changes; document blockers; contribute upstream if needed |
| R8 | **Test coverage debt** | High | Medium | Each tier must add tests; target 50+ tests at T1, 100+ at T2, 150+ at T3 |

---

## Success Metrics

| Metric | v0.2.0 (T1) | v0.3.0 (T2) | v0.4.0 (T3) | v1.0 (T4+) |
|---|---|---|---|---|
| **Source files** | 25 | 28 | 34 | ~38 |
| **Lines of code** | 2,950 | 4,000 | 5,500 | ~7,000 |
| **CRITICAL gaps closed** | 5/5 (pi-crew), 2/7 (omp) (+ RPV unique differentiator) | 6/7 (omp) | 6/7 (omp) | 7/7 |
| **IMPORTANT gaps closed** | 2/14 (pi-crew) | 5/14 (pi-crew), 4/14 (omp) | 10/14 (pi-crew), 7/14 (omp) | 14/14 (both) |
| **Tests** | 50+ | 100+ | 150+ | 200+ |
| **npm downloads** | 100 | 500 | 1,000 | 5,000 |
| **Zero-network compliance** | ✅ | ✅ (with documented exceptions) | ✅ | ✅ |
| **PREVENT-* rules passing** | ✅ | ✅ | ✅ | ✅ |
| **Max single-file size** | <300 lines | <400 lines | <500 lines | <500 lines |

---

## Appendix: Gap ID Cross-Reference

### pi-crew / pi-messenger gaps (from GAP_ANALYSIS.md)

| ID | Category | Gap | Tier |
|---|---|---|---|
| C1 | Orchestration | No worktree isolation | T1 (1.2) |
| C2 | Orchestration | No async/background runs | T1 (1.3) |
| C3 | Orchestration | No workflow DAG engine | T1 (1.1) |
| C4 | Orchestration | No task dependency graph | T1 (1.1, 1.4) |
| C5 | Communication | No presence/messaging overlay | T1 (1.5) |
| I1 | Task Mgmt | No file reservations | T1 (1.6) |
| I2 | Observability | No cost reporting | T1 (1.7) |
| I3 | Observability | No observability/metrics | T3 (3.6) |
| I4 | Communication | No activity feed | T3 (3.4) |
| I5 | Communication | No crew overlay/dashboard | T3 (deferred to T4 TUI) |
| I6 | Extensibility | No plugin architecture | T3 (3.8) |
| I7 | Memory | No skill auto-discovery | T2 (2.6) |
| I8 | Orchestration | No adaptive planning | T2 (deferred; requires DAG) |
| I9 | Context | No output head+tail preservation | T3 (3.7) |
| I10 | Observability | No event replay | T3 (3.4) |
| I11 | Memory | No cross-run knowledge injection | T3 (3.1) |
| I12 | Extensibility | No custom agent/team definitions | T3 (3.5) |
| I13 | Orchestration | No plan-level HITL | T3 (deferred) |
| I14 | Orchestration | No goal loops | T4 (4.8) |
| N1 | Orchestration | No scheduled runs | T4 (4.10) |
| N2 | Observability | No import/export runs | T3 (deferred) |
| N3 | Observability | No health scoring | T3 (deferred) |
| N4 | Orchestration | No topology advisory | T3 (deferred) |
| N5 | Orchestration | No dynamic workflows | T4 (4.9) |
| N6 | Orchestration | No single-agent mode | T3 (deferred) |
| N7 | Safety | No config schema validation | T2 (2.5) |
| N8 | Communication | No stuck detection | T1 (1.5) |
| N9 | Orchestration | No swarm/spec-based claims | T3 (deferred) |
| Unique | Unique | Reverse Prompt Validation | T1 (1.9) |
| Unique | Unique | Interactive model profile selection | T1 (1.10) |

### oh-my-pi gaps (from GAP_ANALYSIS_OMP.md)

| ID | Category | Gap | Tier |
|---|---|---|---|
| C1 | Edit Format | Hashline edit format | T2 (2.1) |
| C2 | Tools | LSP integration | T4 (4.1) |
| C3 | Review | Advisor mode | T2 (2.2) |
| C4 | Context | Checkpoint/Rewind | T2 (2.3) |
| C5 | Orchestration | Schema-validated subagent results | T1 (1.8) |
| C6 | Isolation | Worktree isolation | T1 (1.2) |
| C7 | Git | Atomic commit splits | T2 (2.8) |
| I1 | Context | Stream rules | T2 (2.4) |
| I2 | Git | Conflict resolution | T3 (deferred) |
| I3 | Tools | Browser automation | T4 (4.2) |
| I4 | Tools | Web search (25 providers) | T3 (3.2) |
| I5 | Tools | GitHub schemes | T3 (3.3) |
| I6 | Config | Config inheritance (8 formats) | T2 (2.5) |
| I7 | Tools | Skills auto-discovery | T2 (2.6) |
| I8 | Platform | Self-update | T3 (deferred) |
| I9 | Memory | Hindsight memory | T3 (3.1) |
| I10 | Review | Code review with P0-P3 | T2 (2.7) |
| I11 | UI | TUI with differential rendering | T4 (4.4) |
| I12 | Collab | Collab relay | T4 (4.5) |
| I13 | Tools | Code execution (Python+Bun eval) | T4 (4.3) |
| I14 | Edit Format | AST edits with preview | T4 (4.7) |

---

*This roadmap consolidates findings from `docs/GAP_ANALYSIS.md` (pi-crew v0.9.46, pi-messenger v0.14.1) and `docs/GAP_ANALYSIS_OMP.md` (oh-my-pi v17.0.9). Effort estimates assume a single developer familiar with pi extension architecture. All timelines are estimates and may shift based on upstream pi API changes or unforeseen complexity.*