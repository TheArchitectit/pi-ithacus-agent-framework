# Research: External Sources for ithacus Roadmap

> **Status**: Synthesis complete — feeds future sprint specs (Sprint 5.13+).
> **Sources reviewed**: claw-code, memory-mcp, radcode (via 3 explorer agents).
> **Date**: 2026-08-10
> **Purpose**: Capture features ithacus should adopt/borrow (and anti-patterns to
> avoid) before finalizing the live-progress plan and future sprints.

---

## 1. Source summaries

### 1.1 claw-code (`TheArchitectit/claw-code`)
A Rust reimplementation of Claude Code. **Premise correction:** the user's PRs
here are NOT "teams agent workflow" — they are auto-compact+retry (#1-4, with a
known retry-on-uncompacted-session bug) and LSP-v2 (#5). The team/agent machinery
exists as **core repo features**, not user contributions:

| Feature | Location | ithacus relevance |
|---|---|---|
| `WorkerStatus` state machine | `rust/crates/runtime/src/worker_boot.rs` | Sprint 5.13: richer status than running/success/failed |
| `TeamRegistry` + `CronRegistry` | `rust/crates/runtime/src/team_cron_registry.rs` | Future sprint: named teams + scheduled crons |
| Sequential `claw-analog agents` | `rust/crates/claw-analog/src/agents.rs` | Permission-mode presets (ReadOnly/WorkspaceWrite/Prompt/DangerFullAccess) |
| Auto-compact+retry | (user PRs #1-4) | Future sprint: durability — retry on context-window errors |

**Notably absent:** TPS counter, live progress overlay, per-agent file-access
audit log. (Confirms ithacus's TPS + files-accessed fields in Sprint 5.13 are a
genuine differentiator, not a copy.)

### 1.2 memory-mcp (`TheArchitectit/memory-mcp` — codename R.A.D.1.C.A.L.)
A unified MCP memory/context server (Python FastAPI + Rust CLI/TUI). Huge
feature surface. **CRITICAL CONSTRAINT:** this is Postgres + Redis + Ollama —
ithacus CANNOT depend on it directly (PREVENT-ITH-004: no external services).
ithacus can only borrow **patterns**, implemented on `node:sqlite` (which ithacus
already uses).

| Pattern | memory-mcp file | ithacus adaptation (node:sqlite) |
|---|---|---|
| Semantic memory w/ category/tags/project | `database.py` | ithacus store: `ith_memory` table + metadata columns (Sprint 3.1 hindsight already does this — extend) |
| Session checkpoints (list/delete/archive/compare/diff) | `session_context.py` | Future sprint: session checkpoint manager on ithacus store |
| Context chains for inter-agent handoff (capped 10) | `context_chain.py`/`operator_context.py` | Sprint 5.3 negotiation/handoff already shipped — enrich |
| AGENTS.md/CLAUDE.md convention parsing | `agents_md.py` | ithacus config.ts already parses 8 formats — verify AGENTS.md is one |
| Trident compaction (Supersede→Collapse→Cluster ~7×) | `compact.py` | Future sprint: memory consolidation on ithacus store |
| Auto-memory fire-and-forget buffer | `auto_memory.py` | Future sprint: async write buffer (in-process, zero-network) |
| A2A protocol | `docs/` | Sprint 5.9 (A2A network adapter) — already planned |
| RAG stack (KG²RAG/CRAG/RAPTOR/HyDE) | `kg2rag.py`/`crag.py`/`raptor.py` | Out of scope for ithacus (no vector store in-process) — but CRAG's web-fallback pattern could inform Sprint 3.2 search |

**Critical anti-patterns observed (DO NOT copy):**
- `dispatch_swarm` is a **no-op stub** — marks items COMPLETED without dispatching.
  Lesson: never stub the dispatch loop; ithacus's swarm actually spawns.
- `compact_session` embeds the **compressed base64** string, not the original
  text → recall scores poorly. Lesson: **embed the original**, compress only for
  storage.
- Score semantics **inverted** (FAISS cosine *distance* lower=better treated as
  *similarity* higher=better). Lesson: be explicit about units in any similarity
  API.
- Session-ID normalization truncates any long id with a dash → prefix collisions.
  Lesson: use real UUID validation.

### 1.3 radcode (`TheArchitectit/radcode`)
**Does not exist (404).** The owner's 19 public repos do not include `radcode`.
Likely a misresolution (possibly the R.A.D.1.C.A.L codename was confused with a
repo name). **Recommendation:** drop `radcode` from future planning; the existing
`docs/GAP_ANALYSIS_RADCODE_WORKFLOW.md` is likely stale and should be reviewed
for accuracy or removed.

---

## 2. Features to capture for future specs

Mapped to the existing sprint plan (Sprint 5.13 onward):

### Sprint 5.13 — Live-Progress Overlay (current spec, COMMITTED)
- ✅ Already specified in `docs/DESIGN_LIVE_PROGRESS.md`.
- **Confirmed by:** blue-box side note (overlay shows terminal state ~1s after
  completion, never live progress) + code review (setDone in factory, silent
  .catch, handleInput inert for nonCapturing).
- **Differentiator confirmed:** neither claw-code nor memory-mcp tracks TPS or
  per-agent file-access — ithacus's `AgentLive` model includes both.

### Sprint 5.14 (proposed) — Richer Worker Status State Machine
- Borrow claw-code's `WorkerStatus` states: `Spawning / TrustRequired /
  ToolPermissionRequired / ReadyForPrompt / Running / Finished / Failed` +
  `WorkerFailureKind`.
- ithacus currently has `running / success / failed` (3 states). Upgrade to 7+
  so the live overlay can show "waiting for trust", "waiting for tool
  permission", "ready for prompt", etc.
- **Scope:** `src/types.ts` (new `WorkerStatus` enum), `extensions/ithacus-live.ts`
  (use in `AgentLive.status`), `extensions/ithacus-live-card.ts` (render state-
  specific colors/icons).

### Sprint 5.15 (proposed) — Agent Permission Modes
- Borrow claw-code's permission presets: `ReadOnly / WorkspaceWrite / Prompt /
  DangerFullAccess / Allow`.
- ithacus currently has read-only agents (explore/plan/verification/reviewer) +
  the proposed `writer` agent (mutating). Generalize into a `PermissionMode`
  field in agent definitions + enforce at dispatch (tool allowlists).
- **Scope:** `extensions/agents/*.md` (add `permission` frontmatter),
  `extensions/ithacus-dispatch.ts` (resolve permission → `--tools` allowlist),
  `src/types.ts` (`PermissionMode` enum).

### Sprint 5.16 (proposed) — Session Checkpoint Manager
- Borrow memory-mcp's checkpoint pattern (list/delete/archive/compare/diff),
  implemented on ithacus's `node:sqlite` store (NOT Postgres).
- ithacus already has `src/checkpoint.ts` (Sprint 2.1) — extend with
  list/delete/archive/compare/diff operations + a `/ithacus-checkpoints` command.
- **Scope:** `src/checkpoint-manager.ts` (new — CRUD + diff), `extensions/ithacus-commands.ts`
  (command).

### Sprint 5.17 (proposed) — Auto-Compact + Retry on Context-Window Errors
- Borrow claw-code's auto-compact+retry pattern (the user's actual PR work).
- On `context_window_blocked` error from the sub-agent's child pi, auto-compact
  the child session and retry — so the parent doesn't see the error.
- **Scope:** `extensions/ithacus-dispatch.ts` (detect error in child stdout →
  retry with `--compact` flag), `src/types.ts` (`RetryPolicy` type).
- **Anti-pattern to avoid:** claw-code PR #4 has a known bug — the retry path
  uses the original uncompacted session. ithacus must rebuild the child with the
  compacted session, not reuse the original.

### Sprint 5.18 (proposed) — Memory Consolidation (Trident-inspired)
- Borrow memory-mcp's Trident compaction CONCEPT (Supersede→Collapse→Cluster),
  implemented on ithacus's `node:sqlite` store + in-process clustering (NOT
  FAISS/Postgres).
- ithacus already has `src/hindsight.ts` (Sprint 3.1 retain/recall/reflect) +
  `src/trim.ts` (durable-trim). Extend with a consolidation pass that supersedes
  obsolete facts, collapses chatty runs, and clusters semantically similar
  entries (using simple token-overlap or a lightweight in-process embedder, NOT
  an external embedding service — PREVENT-ITH-004).
- **Anti-pattern to avoid:** memory-mcp embeds the compressed text → recall
  fails. ithacus must embed/store the ORIGINAL text, compress only for storage
  display.

### Sprint 5.19 (proposed) — Named Teams + Scheduled Crons
- Borrow claw-code's `TeamRegistry` + `CronRegistry` concept.
- ithacus already has `src/team.ts` + `src/scheduler.ts` (Sprint 4.5 scheduled
  runs). Extend with named, persistent teams (CRUD) + cron-registered team runs.
- **Scope:** `src/team-registry.ts` (new — named teams CRUD on sqlite),
  `extensions/ithacus-commands.ts` (`/ithacus-teams` command), upgrade
  `src/scheduler.ts` (cron registration).

### Sprint 5.9 — A2A Protocol Adapter (already planned, confirmed)
- memory-mcp confirms the A2A protocol pattern for agent-to-agent context
  sharing. Sprint 5.9 (already in the plan) covers this — the research validates
  the existing spec direction.

---

## 3. Anti-patterns to avoid (cross-source)

| Anti-pattern | Source | ithacus mitigation |
|---|---|---|
| Stub the dispatch loop | memory-mcp `dispatch_swarm` | ithacus's swarm actually spawns (Sprint 5.4 ✅ delivered); never mark COMPLETED without dispatching |
| Embed compressed text for recall | memory-mcp `compact_session` | Embed/store the ORIGINAL; compress only for storage display |
| Invert similarity score semantics | memory-mcp FAISS consumers | Be explicit: `similarity` (higher=better) vs `distance` (lower=better); document units in every similarity API |
| Truncate session IDs with a dash | memory-mcp session-ID normalization | Use real UUID validation; never truncate |
| Show terminal state popup after completion | ithacus v0.3.11-0.3.15 | Sprint 5.13: show overlay at dispatch START, drive from live events |

---

## 4. Recommendation: finalize the plan

1. **Sprint 5.13 (live-progress) is the correct next step** — confirmed by the
   blue-box side note + code review + pi runtime review. The spec is committed
   (`docs/DESIGN_LIVE_PROGRESS.md`, commit `478843e`). Proceed to implement it.
2. **Add Sprints 5.14-5.19** to `docs/SPRINT_PLAN.md` as proposed future sprints
   (richer status, permission modes, checkpoint manager, auto-compact+retry,
   memory consolidation, named teams+crons) — each mapped to a borrowed pattern
   from claw-code/memory-mcp, adapted to ithacus's zero-external-service
   constraint.
3. **Review `docs/GAP_ANALYSIS_RADCODE_WORKFLOW.md`** — radcode doesn't exist;
   the doc is likely stale. Mark for review or remove.
4. **Do NOT adopt memory-mcp's infra** (Postgres/Redis/Ollama) — PREVENT-ITH-004
   forbids external services. Borrow patterns only; implement on `node:sqlite`
   + in-process clustering.
