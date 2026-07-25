# Gap Analysis — ithacus vs radcode + radical + memory-mcp (Agent Workflow Only)

> Scope: agent-workflow orchestration features ONLY. Memory/RAG/KG/Trident
> compaction are EXCLUDED — those will be a separate project. Network-gated
> A2A features (HTTP/SSE/webhooks) are noted but deferred to extensions/.

Status legend: ⬜ = not started · 🟰 = partial / in-scope rewrite.

## Sources reviewed

- **radcode** (`/mnt/data/git/RADOPENCODE/`) — Rust TUI client, pluggable Backend trait (LightBackend + RadicalBackend over A2A/MCP). ~85-95% parity vs Claude Code/ClawCode/OpenCode.
- **radical** (`/mnt/data/git/R.A.D.1.C.A.1/`) — heavy agent framework, 113 MCP tools, swarm orchestrator, RAPTOR/CRAG/KG (memory-project scope, excluded here).
- **memory-mcp** (`/mnt/data/git/memory-mcp/`, R.A.D.1.C.A.L) — Python MCP server + Rust CLI/TUI. Multi-generation agent-workflow subsystem: WorkQueue, SwarmOrchestrator v1+v2, EnterpriseWorkQueue, WorkflowExecutor DAG, A2A protocol, SpecialistDispatcher, OperatorDispatcher.

## ithacus workflow baseline (delivered)

`workflow.ts` (DAG phases/waves/topsort) · `team.ts` (run/agent/task/inbox, model resolution) · `parallel.ts` (execute_batch, read-only parallel) · `async.ts` (detached runs) · `presence.ts` (heartbeat/stuck) · `reservations.ts` (file-path reservation) · `goal-loops.ts` (LLM actor+judge) · `dwf.ts` (dynamic workflows) · `scheduler.ts` (cron/interval/one-shot) · `cost.ts` (tracking) · `checkpoint.ts` (rewind) · `metrics.ts` (counters) · `definitions.ts` (symbol index)

## Gap matrix

### High priority (#1-7)

| # | Gap | Source | Citation | Status | Sprint |
|---|---|---|---|---|---|
| 1 | Priority work-queue state machine | memory-mcp | `swarm.py:143-280` | ⬜ | 5.1 |
| 2 | DAG step retry/timeout/on_error | memory-mcp | `executor.py:201-305` | ⬜ | 5.2 |
| 3 | Rich step types (CONDITION/LOOP/HUMAN_REVIEW/SUBWORKFLOW) + YAML | memory-mcp | `schema.py` | ⬜ | 5.2 |
| 4 | Inter-agent negotiation protocol | radcode | `crates/bus/src/negotiation.rs` | ⬜ | 5.3 |
| 5 | Agent handoff protocol | memory-mcp | `handoff.py:24-100` | ⬜ | 5.3 |
| 6 | Swarm dispatch loop + result aggregation | memory-mcp | `swarm.py:421-580` | ⬜ | 5.4 |
| 7 | Token-budget governor (USD cap + alerts) | memory-mcp | `swarm_v2.py:155-187` | ⬜ | 5.5 |

### Medium priority (#8-16)

| # | Gap | Source | Citation | Status | Sprint |
|---|---|---|---|---|---|
| 8 | Task lifecycle state machine + store ABC | memory-mcp | `a2a/tasks.py:34-189` | 🟰 | 5.1 |
| 9 | Capability-based leader election + delegation | radical | `coordination/{leader_election,delegation}.rs` | ⬜ | 5.5 |
| 10 | Keyword→role weighted task router | memory-mcp | `operators.py:733-770` | ⬜ | 5.5 |
| 11 | Swarm messaging bus / blackboard | memory-mcp + radical | — | ⬜ | 5.6 |
| 12 | Result synthesis engine (attribution/conflict/scoring) | radical | `swarm/synthesis/` | ⬜ | 5.4 |
| 13 | Structured WorkflowResult | memory-mcp | `engine.py:80-90` | 🟰 | 5.4 |
| 14 | Token-budget swarm governor | memory-mcp | — (overlaps #7) | ⬜ | 5.5 |
| 15 | Named failure-recovery protocol (Phoenix) | memory-mcp | `swarm_v2.py:8` | 🟰 | 5.6 |
| 16 | .agent_ops/ hive filesystem convention | memory-mcp | `swarm_v2.py:213-244` | 🟰 | 5.4 |

### Low priority (#17-20)

| # | Gap | Source | Citation | Status | Sprint |
|---|---|---|---|---|---|
| 17 | Distributed task claiming w/ leases + stale-expiry | radcode | `crates/inbox/src/claim.rs` | 🟰 | 5.7 |
| 18 | Priority queue with deadlines | radcode | `crates/inbox/src/queue.rs` | 🟰 | 5.7 |
| 19 | SprintTracker | memory-mcp | `sprint_tracker.py:30-110` | ⬜ | 5.8 |
| 20 | 52-week planning scheduler + Gantt | memory-mcp | — | ⬜ | 5.8 |

## Network-gated (extension layer)

Real network A2A is deferred to `extensions/` (Sprint 5.9) under PREVENT-ITH-004
exception annotation (same pattern as `extensions/` search.ts). These are NOT
in src/:

| Feature | Sprint | Layer |
|---|---|---|
| A2A HTTP/JSON-RPC | 5.9 | extensions/ithacus-a2a.ts |
| SSE streaming | 5.9 | extensions/ithacus-a2a.ts |
| HMAC webhooks | 5.9 | extensions/ithacus-a2a.ts |
| Agent Card discovery | 5.9 | extensions/ithacus-a2a.ts |
| Federation multi-node | 5.9 | extensions/ithacus-a2a.ts |

Local in-process equivalents (negotiation, handoff, bus, task lifecycle) ARE
in scope for src/ (Sprints 5.1, 5.3, 5.6) — they carry no network calls.

## Out of scope

- Vector embeddings, RAG/RAPTOR, Knowledge Graph, Trident compaction, memory tiers → separate memory project.
- A2A HTTP/JSON-RPC, SSE, HMAC webhooks, Agent Card discovery, Federation → network-gated; local in-process equivalents ARE in scope (negotiation, handoff, bus, task lifecycle).
- Provider calls, tool runtime, TUI channels, session store → pi-layer (ithacus is a pi extension).

## TIER 5 plan summary

9 sprints (5.1-5.9) closing all 20 gaps + network A2A extension. See
`docs/SPRINT_PLAN.md` §TIER 5.
