# pi — an agent framework that lives directly inside `.pi/mega-compact`

> **Project name = folder name.** The framework is named `pi` because it is
> the resident agent of the `<repo>/.pi/mega-compact/` folder: the same folder
> that `pi-mega-compact` (the compression extension) already writes its SQLite
> store, vector index, events log, and dashboards into. `pi` does not replace
> the compressor — it reads and extends that folder as its native state.
>
> **Reverse-prompt method.** The design below was derived by (1) reviewing
> claw-code PR #3250 (team orchestration / `subagentModel` / parallel tools /
> model-resolution hardening) and (2) reverse-engineering `pi-mega-compact`'s
> architecture, then turning each finding into a *reverse prompt* — a directive
> to the `pi` agent expressed as if it were steering a coding agent. Those
> prompts are the actual spec; the sections around them explain the "why".

---

## 0. The one fact everything hangs off of

`pi-mega-compact` already scopes its store **per repo** at
`<repo>/.pi/mega-compact` (see `repoStateDir()` in `extensions/mega-config.ts`):

```
repoStateDir(cwd, fallback) =
  git rev-parse --show-toplevel  →  join(root, ".pi", "mega-compact")
```

That folder on disk right now contains:

```
.pi/mega-compact/
├── sqlite.db          ← the "one store": context_chunks, sessions, memories,
│                        model_snapshots, raptor_nodes, raw_transcript,
│                        checkpoint_epochs, dedup_mirror, game_state, meta
├── sqlite.db-shm / -wal
├── events.log         ← always-on structured diagnostics (dashboard live-streams it)
├── dashboard.json      ← last snapshot (token usage, store stats, crew, trigger)
├── dashboard.log
├── bloom.json.gz       ← Tier-0 exact-dedup accelerator
└── (vector index lives at ~/.pi/mega-compact-vector, cross-repo by repo_id)
```

**Design consequence:** `pi` needs *no new storage backend*. Its memory,
task-claims, agent inbox, and run-state are just more tables / rows in this
same SQLite db, written through the same `node:sqlite` `DatabaseSync` path the
compressor uses. The folder is the project; the framework is a second writer
against the folder's own store.

---

## 1. Reverse prompts (the spec, as agent directives)

These are the literal directives `pi` follows. Each is tagged with the source
finding that produced it.

### RP-1 — *"Treat the repo's `.pi/mega-compact` folder as your home, not a
resource you read."* (source: `repoStateDir`, `STATE_DIR_DEFAULT`)
- On `session_start`, resolve `repoRoot = git rev-parse --show-toplevel` and bind
  to `repoRoot/.pi/mega-compact`. Outside git, fall back to the global
  `~/.pi/agent/extensions/pi-mega-compact` the same way `loadConfig()` does.
- Never create a separate `pi/` state dir. You are a *tenant* of the
  mega-compact store, exactly like the compressor's `MegaRuntime.bindRepo()`.

### RP-2 — *"Reuse the compressor's store; add tables, do not fork files."*
(source: `src/store/sqlite/schema.ts`, `src/store.ts`)
- Open the same `sqlite.db` with `node:sqlite` `DatabaseSync`. Extend the schema
  idempotently (the compressor already does `CREATE TABLE IF NOT EXISTS` + column
  migrations — mirror that pattern).
- Proposed new tables: `pi_agents` (id, role, status, session, last_seen),
  `pi_tasks` (id, team, title, owner_claim, status), `pi_inbox` (agent_id,
  from, payload, ts), `pi_runs` (run_id, mode_preset, created, summary).
- Reuse existing tables where they already express what you need: `memories`
  (decision/fact/preference), `model_snapshots` (active model/provider),
  `sessions`, `raw_transcript` (DR rehydration), `events.log` (telemetry).

### RP-3 — *"Spin up coordinated sub-agent teams like claw-code TeamCreate,
but route them through pi's native agent runtime — not a Rust mailbox."*
(source: PR #3250 team layer; `agent_start`/`agent_end` in `mega-events`)
- The PR's `TeamCreate` spawns 1–6 agents with mode presets
  (tiny/small/medium/large/xlarge/mega) and a shared mailbox under
  `~/.clawd-agents/mailbox/team/{id}/`. **In pi, do not reimplement a filesystem
  mailbox.** pi already emits `agent_start` / `agent_end` and tracks
  `runtime.activeAgents`. Use pi's native `Agent` tool / sub-agent spawn as the
  runtime; model `TeamCreate` as a *plan* (mode preset → N role assignments:
  Explore / Plan / Verification / Reviewer) that `pi` issues as sub-agent
  dispatches, and persist the roster in `pi_agents`/`pi_runs`.
- Preserve the PR's hard-won fixes:
  - **`subagentModel` wiring** → when spawning, resolve the sub-agent model via
    `explicit → subagentModel → session provider model → DEFAULT`, exactly like
    the PR's `resolve_agent_model` chain. Store the resolved model in
    `pi_agents.model` and mirror it into `model_snapshots`.
  - **`qualify_for_provider()`** → if the active provider is `custom-openai`,
    prefix bare model names with `custom/` so sub-agents route through the same
    endpoint as the parent session.
  - **inject `/setup` creds into spawns** → before building a sub-agent
    runtime, call the equivalent of `inject_config_as_env_fallbacks()` so
    `CLAWCUSTOMOPENAI_*` (and pi's provider env) reach the child.

### RP-4 — *"Run read-only work in parallel; serialize writes."*
(source: PR #3250 `execute_batch`, `ToolExecutor::execute_batch`)
- When a response emits multiple tool calls, classify each:
  - **parallel-safe:** read_file, glob_search, grep_search, WebFetch, WebSearch,
    LSP, GitStatus/Diff/Log/Show, TaskGet/List, Agent, TeamStatus, AgentMessage.
  - **sequential:** everything that mutates state (write_file, git commit, task
    claim/complete, inbox send).
- Execute parallel-safe calls concurrently (the PR uses `std::thread::scope`;
  in a Node extension use `Promise.all` over the classified batch), then apply
  sequential calls in order. This is the single biggest throughput win the PR
  delivered — keep it.

### RP-5 — *"Make the model-resolution chain fall-through, never dead-end."*
(source: PR #3250 §4 model-resolution robustness)
- A 404 / "model not found" must advance the fallback chain (the PR adds
  `fallback_chain_eligible()` on 404/400). In `pi`, wrap every sub-agent model
  call so a dead primary falls through to the next configured model instead of
  killing the run.
- The caller's resolved model is the **primary**; `providerFallbacks.primary`
  is appended as *recovery*, deduped — never silently replaces the caller's pick
  (the PR's precedence bug fix).

### RP-6 — *"Relieve context mid-run, or the team run balloons to 150k and
never resumes."* (source: `agent-handlers.ts` durable-trim trigger)
- This is the compressor's hardest-won lesson and it is *yours too*. When you
  orchestrate sub-agents, pi's native durable compaction only fires at parent
  settle — so the transcript balloons. Reuse the compressor's `agent_end`
  durable-trim trigger logic:
  - On `agent_end` with `activeAgents === 0`, if idle + over threshold +
    past the 10s `lastCompactAt` cooldown, issue a durable `ctx.compact()`
    (race-guarded so you never throw "Already compacted"), then nudge the agent
    to continue.
  - Keep the three-way guard (truly idle, over threshold, debounce) and the
    `piCompactWouldNoop` check verbatim.

### RP-7 — *"Persist every decision as a memory; review under pressure."*
(source: `src/memory.ts`, `turn_end` memory auto-review)
- The compressor already auto-reviews the conversation every
  `memoryReviewInterval` turns and persists add/replace/remove memories scaled
  by pressure (`memoryReviewCadence`). `pi` should *consume* that store: on
  `TeamCreate` / task dispatch, recall relevant `memories` (decision/fact) and
  inline them as sub-agent context. Memory = the team's cross-run continuity.

### RP-8 — *"Zero network at runtime. Local only."* (source: PREVENT-PI-004)
- The compressor's non-negotiable constraint: no `fetch`/HTTP to remote at
  runtime; node:sqlite + FS only; the lone exception is a user-triggered
  localhost dashboard (annotated `// guardrails-allow PREVENT-PI-004`). `pi`
  inherits this. Sub-agents route through *pi's* provider config (local
  credentials), never a remote coordination service.

### RP-9 — *"Never split a toolCall/toolResult pair and never drop below the
anchor floor."* (source: PREVENT-PI-001/002/003)
- When `pi` compacts or reorders its own task memory, respect the same
  drop-boundary guards the compressor enforces (`src/boundary.ts`):
  preserve the most-recent N messages, never sever a tool call from its result.

### RP-10 — *"Expose yourself as a pi extension, split like the compressor."*
(source: `megacompact.ts` wiring + `mega-*.ts` module split)
- Entry `extensions/pi-agent.ts` default-exports `(pi) => { … }`, mirroring
  `mega-compact.ts`: `loadConfig()` → build runtime →
  `registerEventHandlers` / `registerCommands` / `registerTeamCommands`.
- Keep `src/` pi-agnostic (unit-testable without the pi runtime) and put the
  pi adapter in `extensions/pi-*.ts`, exactly as `src/` vs `extensions/` are
  separated today. The compressor's `src/adapt.ts` (single pi↔engine adapter)
  is the template for `src/piAdapt.ts`.

### RP-11 — *"Ship only via npm; the folder travels with the repo."*
(source: PREVENT-DIST-001, `repoStateDir` tracked-not-gitignored)
- Distribute as an npm package (`pi install npm:pi`); never a `.tgz` tarball or
  symlink. Keep `pi`'s rows in `.pi/mega-compact` — which is **tracked** (not
  gitignored) in the compressor design — so a team's agent state travels with
  the repo across devices, matching the PR's "shared mailbox" intent without a
  shared server.

### RP-12 — *"Make the dashboard show the team, not just tokens."*
(source: `DashboardSnapshot.crew`, `mega-dashboard.ts`)
- The compressor's snapshot already has a `crew: { activeAgents, currentTurn }`
  slot and an agents widget. `pi` extends `dashboard.json` with
  `team: { run_id, mode, agents:[{role,model,status}], tasks:[{title,owner,status}] }`
  so the live localhost dashboard renders the orchestration alongside token
  savings. Append team events to the same `events.log`.

---

## 2. Resulting architecture (reverse-engineered into a shape)

```
extensions/pi-agent.ts          entry: wires src/ into pi lifecycle (mirrors mega-compact.ts)
extensions/pi-config.ts         loadConfig(), per-repo scoping, env flags (mirrors mega-config.ts)
extensions/pi-runtime.ts        PiRuntime: shared state + bindRepo() + dashboard snapshot
extensions/pi-events/           pi.on() handlers
    session-handlers.ts         session_start → bindRepo, before_agent_start → inline memories
    agent-handlers.ts           agent_start/end (crew counter), turn_end (memory review)
    context-handler.ts         pressure → durable-trim relief (mirrors compressor)
    team-handlers.ts           TeamCreate/Delete/Status as pi sub-agent plans
extensions/pi-team.ts          mode presets + role distribution + spawn via pi Agent
extensions/pi-commands.ts      /pi-team, /pi-status, /pi-recall slash commands
extensions/pi-dashboard-cmds.ts localhost dashboard lifecycle (PREVENT-PI-004 annotated)

src/piAdapt.ts                  single pi↔engine adapter (mirrors src/adapt.ts)
src/piStore.ts                  opens <repo>/.pi/mega-compact/sqlite.db; idempotent schema add
src/piTeam.ts                   roster/task/inbox model + resolve_agent_model chain
src/piParallel.ts               execute_batch: parallel-safe classification (mirrors PR #3250)
src/piMemory.ts                 recall memories for sub-agent context (reuses src/memory*.ts)
src/piConfig.ts                 pi-agnostic config + pressure helpers (unit-testable)
src/types.ts                    pi-internal types
```

### Data model added to the existing `sqlite.db`

| table | columns | purpose |
|-------|---------|---------|
| `pi_runs` | run_id, mode_preset, created_at, summary, status | one TeamCreate invocation |
| `pi_agents` | id, run_id, role, model, provider, status, last_seen | roster row per spawned sub-agent |
| `pi_tasks` | id, run_id, title, owner_claim, status | TaskClaim-style dedupe across agents |
| `pi_inbox` | id, agent_id, from_agent, payload, ts, read | inter-agent messages (replaces the PR's `~/.clawd-agents/mailbox` FS dir with an in-db mailbox) |

All written through the same `DatabaseSync` handle the compressor owns — no
second file, no second process.

---

## 3. How the PR's team layer maps to pi (the key translation)

| PR #3250 (claw-code / Rust) | `pi` equivalent |
|------------------------------|-----------------|
| `TeamCreate` (1–6 agents, presets) | `piTeam.createRun(mode)` → N pi `Agent` dispatches, roster in `pi_agents` |
| Shared mailbox at `~/.clawd-agents/mailbox/team/{id}/` + 2s watcher thread | `pi_inbox` table + `events.log`; no FS watcher (pi event loop is the watcher) |
| Background team watcher prints `[team]` to stderr | `agent_start`/`agent_end` handlers update `dashboard.json` `crew` + `team` blocks |
| `resolve_agent_model` chain | `src/piTeam.ts` resolves `explicit → subagentModel → provider model → default` |
| `qualify_for_provider()` custom/ prefix | applied at spawn when provider is `custom-openai` |
| `execute_batch` parallel-safe | `src/piParallel.ts` `Promise.all` over read-only batch |
| `providerFallbacks.primary` precedence fix | caller model = primary; fallbacks appended + deduped |
| 404 chain-fallthrough | model-call wrapper advances fallback chain on not-found |
| inject `/setup` creds into spawn | inject provider env before building sub-agent runtime |
| `/team on\|off\|status` slash cmd | `/pi-team on\|off\|status` |

The translation keeps every robustness fix from the PR but expresses it through
pi's native agent runtime + the compressor's own folder/store — so `pi` is a
*resident* of `.pi/mega-compact`, not a second system bolted beside it.

---

## 4. What `pi` deliberately does NOT do (scope guard)

- Does **not** reimplement compression/Trident/dedup — that is
  `pi-mega-compact`'s job; `pi` only *reads* `context_chunks`/`memories` and
  *reuses* the durable-trim trigger.
- Does **not** open a remote MCP server or any non-localhost network (PREVENT-PI-004).
- Does **not** ship a `.tgz` or symlink install (PREVENT-DIST-001).
- Does **not** invent a new state directory — it lives in `.pi/mega-compact`.

---

## 5. Build order (reverse-prompt → milestone)

1. **RP-1 + RP-2**: `src/piStore.ts` opens `<repo>/.pi/mega-compact/sqlite.db`,
   adds the four tables idempotently. Verify `pi` and the compressor share one
   `.db` with no lock contention (both use synchronous `node:sqlite`).
2. **RP-10 + RP-3**: `extensions/pi-agent.ts` skeleton + `piTeam.createRun()`
   dispatching real pi sub-agents with the `resolve_agent_model` chain (RP-3).
3. **RP-4**: `src/piParallel.ts` parallel-safe batch execution.
4. **RP-6**: durable-trim relief borrowed from `agent-handlers.ts`.
5. **RP-7 + RP-12**: memory recall into sub-agent context + `team` block in
   `dashboard.json`.
6. **RP-5 + RP-8 + RP-9 + RP-11**: fallback robustness, zero-network,
   drop-boundary guards, npm-only distribution.

---

*Derived from: claw-code PR #3250 (`feat(team): team enhancements, subagentModel,
parallel tool exec`) and a full read of `pi-mega-compact` (`CLAUDE.md`,
`README.md`, `extensions/*`, `src/store/sqlite/schema.ts`, `mega-config.ts`,
`mega-runtime/state.ts`, `mega-events/agent-handlers.ts`).*
