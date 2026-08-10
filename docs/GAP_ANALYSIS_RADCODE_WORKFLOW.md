# Gap Analysis — ithacus vs radcode + radical + memory-mcp (Agent Workflow Only)

> Scope: agent-workflow orchestration features ONLY. Memory/RAG/KG/Trident
> compaction are EXCLUDED — those will be a separate project. Network-gated
> A2A features (HTTP/SSE/webhooks) are noted but deferred to extensions/.
>
> **Regenerated 2026-05 against ithacus v0.3.2** — statuses re-verified
> against shipped `src/` modules. Prior matrix (v0.1.0 freeze) marked nearly
> everything ⬜; sprints 5.1–5.4 delivered the bulk.

Status legend: ⬜ = not built · 🟰 = partial · ✅ = shipped in src/ (or extensions/ where noted).

## Sources reviewed

- **radcode** (`/mnt/data/git/RADOPENCODE/`) — Rust TUI client, pluggable Backend trait (LightBackend + RadicalBackend over A2A/MCP).
- **radical** (`/mnt/data/git/R.A.D.1.C.A.1/`) — heavy agent framework, swarm orchestrator, RAPTOR/CRAG/KG (memory-project scope, excluded here).
- **memory-mcp** (`/mnt/data/git/memory-mcp/`) — Python MCP server + Rust CLI/TUI. WorkQueue, SwarmOrchestrator v1+v2, WorkflowExecutor DAG, A2A protocol, SpecialistDispatcher, OperatorDispatcher. (2026-05 review: enhanced workflow tools currently disabled on main after Gemini schema saga; `.agent_ops/` inbox dirs are structure-only; A2A works.)

## ithacus workflow baseline (delivered)

`workflow.ts` (DAG phases/waves/topsort) · `team.ts` (run/agent/task/inbox, model resolution) · `parallel.ts` (execute_batch, read-only parallel) · `async.ts` (detached runs) · `presence.ts` (heartbeat/stuck) · `reservations.ts` (file-path reservation) · `goal-loops.ts` (LLM actor+judge) · `dwf.ts` (dynamic workflows) · `scheduler.ts` (cron/interval/one-shot) · `cost.ts` (tracking) · `checkpoint.ts` (rewind) · `metrics.ts` (counters) · `definitions.ts` (symbol index) · **Sprint 5.1-5.4:** `queue.ts`, `task-store.ts`, `workflow-steps.ts`, `workflow-yaml.ts`, `negotiation.ts`, `handoff.ts`, `swarm.ts`, `synthesis.ts`, `store-swarm.ts` (+ `types-sprint-5.*.ts`)

## Gap matrix

### High priority (#1-7)

| # | Gap | Source | Citation | Status | Sprint |
|---|---|---|---|---|---|
| 1 | Priority work-queue state machine | memory-mcp | `swarm.py:143-280` | ✅ `src/queue.ts` | 5.1 |
| 2 | DAG step retry/timeout/on_error | memory-mcp | `executor.py:201-305` | ✅ `src/workflow-steps.ts` | 5.2 |
| 3 | Rich step types (CONDITION/LOOP/HUMAN_REVIEW/SUBWORKFLOW) + YAML | memory-mcp | `schema.py` | ✅ `src/workflow-steps.ts` + `src/workflow-yaml.ts` | 5.2 |
| 4 | Inter-agent negotiation protocol | radcode | `crates/bus/src/negotiation.rs` | ✅ `src/negotiation.ts` | 5.3 |
| 5 | Agent handoff protocol | memory-mcp | `handoff.py:24-100` | ✅ `src/handoff.ts` | 5.3 |
| 6 | Swarm dispatch loop + result aggregation | memory-mcp | `swarm.py:421-580` | ✅ `src/swarm.ts` + `src/store-swarm.ts` | 5.4 |
| 7 | Token-budget governor (USD cap + alerts) | memory-mcp | `swarm_v2.py:155-187` | ⬜ `src/budget.ts` (planned) | 5.5 |

### Medium priority (#8-16)

| # | Gap | Source | Citation | Status | Sprint |
|---|---|---|---|---|---|
| 8 | Task lifecycle state machine + store ABC | memory-mcp | `a2a/tasks.py:34-189` | ✅ `src/task-store.ts` | 5.1 |
| 9 | Capability-based leader election + delegation | radical | `coordination/{leader_election,delegation}.rs` | ⬜ `src/leader.ts` (planned) | 5.5 |
| 10 | Keyword→role weighted task router | memory-mcp | `operators.py:733-770` | ⬜ `src/router.ts` (planned) | 5.5 |
| 11 | Swarm messaging bus / blackboard | memory-mcp + radical | — | ⬜ `src/bus.ts` (planned; note: inter-agent mailbox lands via `ith_inbox` port first — task #16/#21) | 5.6 |
| 12 | Result synthesis engine (attribution/conflict/scoring) | radical | `swarm/synthesis/` | ✅ `src/synthesis.ts` | 5.4 |
| 13 | Structured WorkflowResult | memory-mcp | `engine.py:80-90` | ✅ `src/synthesis.ts` result shape | 5.4 |
| 14 | Token-budget swarm governor | memory-mcp | — (overlaps #7) | ⬜ w/ #7 | 5.5 |
| 15 | Named failure-recovery protocol (Phoenix) | memory-mcp | `swarm_v2.py:8` | ⬜ `src/recovery.ts` (planned; runtime-level recovery only) | 5.6 |
| 16 | .agent_ops/ hive filesystem convention | memory-mcp | `swarm_v2.py:213-244` | ✅ `src/store-swarm.ts` hive dirs (`initHive`, locks, audit, artifacts) | 5.4 |

### Low priority (#17-20)

| # | Gap | Source | Citation | Status | Sprint |
|---|---|---|---|---|---|
| 17 | Distributed task claiming w/ leases + stale-expiry | radcode | `crates/inbox/src/claim.rs` | ⬜ `src/claiming.ts` (planned) | 5.7 |
| 18 | Priority queue with deadlines | radcode | `crates/inbox/src/queue.rs` | 🟰 `src/queue.ts` has priorities; deadline pop pending | 5.7 |
| 19 | SprintTracker | memory-mcp | `sprint_tracker.py:30-110` | ⬜ `src/sprint-tracker.ts` (planned) | 5.8 |
| 20 | 52-week planning scheduler + Gantt | memory-mcp | — | ⬜ (upgrade `src/scheduler.ts`) | 5.8 |

## Network-gated (extension layer)

Real network A2A is deferred to `extensions/` (Sprint 5.9) under PREVENT-ITH-004
exception annotation (same pattern as `extensions/` search.ts). These are NOT
in src/:

| Feature | Sprint | Layer |
|---|---|---|
| A2A HTTP/JSON-RPC | 5.9 | extensions/ithacus-a2a.ts (planned) |
| SSE streaming | 5.9 | extensions/ithacus-a2a.ts (planned) |
| HMAC webhooks | 5.9 | extensions/ithacus-a2a.ts (planned) |
| Agent Card discovery | 5.9 | extensions/ithacus-a2a.ts (planned) |
| Federation multi-node | 5.9 | extensions/ithacus-a2a.ts (planned) |

Local in-process equivalents (negotiation, handoff, bus, task lifecycle) ARE
in scope for src/ — they carry no network calls. 2026-05 update: A2A port
approved (task #24) — copy patterns directly from memory-mcp `a2a/` (tasks
send/status/SSE-stream, HMAC-signed push webhooks, OAuth client-credentials,
`/.well-known/agent.json` discovery), opt-in default-OFF.

## Out of scope

- Vector embeddings, RAG/RAPTOR, Knowledge Graph, Trident compaction, memory tiers → separate memory project.
- A2A HTTP/JSON-RPC, SSE, HMAC webhooks, Agent Card discovery, Federation → network-gated; local in-process equivalents ARE in scope (negotiation, handoff, bus, task lifecycle).
- Provider calls, tool runtime, TUI channels, session store → pi-layer (ithacus is a pi extension).

## TIER 5 plan summary

9 sprints (5.1-5.9); 5.1-5.4 ✅ delivered, 5.10 (dispatch) + 5.11 (menu/widget)
✅ delivered as v0.3.0-v0.3.2, 5.5-5.9 + 5.12 pending. memory-mcp ports
(#15/#16/#21-#24: agent visibility, mailbox, guardrails injection,
ToolVisibility tiers, typed workflows, A2A) approved 2026-05. See
`docs/SPRINT_PLAN.md` §TIER 5.
