# ithacus — a greenfield pi agent framework

> **Brand-new repo.** No PR to port, no upstream to match. `ithacus` is built
> from scratch as a **TypeScript pi coding-agent extension**. It borrows
> *patterns* (not code) from two references:
>   - **claw-code PR #3250** — team orchestration, `subagentModel` resolution,
>     parallel read-only tool execution, model-resolution fallthrough.
>   - **pi-mega-compact** — the `.pi/<name>` folder convention, a single local
>     `node:sqlite` store as source of truth, zero-network-at-runtime, and the
>     durable-trim "relieve context mid-run" lesson.
>
> **Naming rule (user-stated): the folder name is the project name.** The repo
> is `ithacus`; it is a *resident* of `<repo>/.pi/ithacus/`, the same convention
> `pi-mega-compact` uses for `<repo>/.pi/mega-compact/`. That folder holds
> `ithacus`'s own `sqlite.db`, `events.log`, and `dashboard.json`. `ithacus`
> owns the folder — it is not a tenant of another extension's store.

---

## 1. Design principles (reverse-engineered, then standalone)

| # | principle | source finding |
|---|-----------|----------------|
| P1 | The folder `<repo>/.pi/ithacus/` is the project home; bind per-repo via `git rev-parse --show-toplevel`. | mega-compact `repoStateDir()` |
| P2 | One local `node:sqlite` `DatabaseSync` store is the source of truth. No second process, no remote DB. | mega-compact `sqlite.ts`, PREVENT-PI-004 |
| P3 | Orchestrate sub-agents as *plans* (mode presets → role roster) dispatched through pi's native agent runtime. | PR #3250 `TeamCreate` |
| P4 | Resolve sub-agent model via `explicit → subagentModel → provider model → default`; `custom/`-qualify for custom-openai. | PR #3250 `resolve_agent_model`, `qualify_for_provider` |
| P5 | Execute read-only tool calls in parallel, writes sequentially. | PR #3250 `execute_batch` |
| P6 | Model-call failures (404/not-found) fall through the fallback chain; caller model is primary, fallbacks appended + deduped. | PR #3250 §4 |
| P7 | Relieve context mid-run (durable trim at settled `agent_end`) so a team run never balloons to the window limit. | mega-compact `agent-handlers.ts` |
| P8 | Persist decisions as memories; recall them as sub-agent context, scaled by pressure. | mega-compact `memory.ts`, `turn_end` review |
| P9 | Zero network at runtime; localhost dashboard is the only annotated exception. | PREVENT-PI-004 |
| P10 | Never split a toolCall/toolResult pair; never drop below the anchor floor. | PREVENT-PI-001/002/003 |
| P11 | Ship only via npm (`pi install npm:ithacus`); never `.tgz`/symlink. Folder is tracked so it travels with the repo. | PREVENT-DIST-001 |
| P12 | Expose a live localhost dashboard showing the team + tokens. | mega-compact `DashboardSnapshot.crew` |

---

## 2. Architecture

```
ithacus/                         ← the repo (= the project name)
├── package.json                 ← "type":"module", ESM, pi extension manifest
├── openclaw.plugin.json         ← pi extension descriptor (pi.extensions)
├── tsconfig.json
├── CLAUDE.md                    ← token-saving + guardrails (mirrors mega-compact)
├── src/                        ← pi-agnostic, fully unit-testable (node --test)
│   ├── adapt.ts                ← single pi↔engine message adapter
│   ├── config.ts               ← loadConfig(), per-repo scoping, env flags, pressure helpers
│   ├── store.ts                ← opens <repo>/.pi/ithacus/sqlite.db; idempotent schema
│   ├── team.ts                 ← run/agent/task/inbox model + resolve_agent_model chain
│   ├── parallel.ts             ← execute_batch: parallel-safe classification
│   ├── memory.ts               ← recall memories for sub-agent context
│   ├── trim.ts                 ← durable-trim relief (borrowed lesson P7)
│   ├── types.ts
│   └── *.test.ts
├── extensions/                 ← the pi adapter layer (mirrors mega-*.ts split)
│   ├── ithacus.ts              ← entry: default (pi) => { wire src/ into lifecycle }
│   ├── ithacus-config.ts
│   ├── ithacus-runtime.ts      ← PiRuntime: shared state + bindRepo() + snapshot
│   ├── ithacus-events/
│   │   ├── session-handlers.ts ← session_start→bindRepo, before_agent_start→inline memories
│   │   ├── agent-handlers.ts   ← agent_start/end crew counter, turn_end memory review
│   │   ├── context-handler.ts  ← pressure → durable-trim relief (P7)
│   │   └── team-handlers.ts    ← TeamCreate/Delete/Status as pi sub-agent plans
│   ├── ithacus-team.ts         ← mode presets + role distribution + spawn via pi Agent
│   ├── ithacus-commands.ts     ← /ithacus-team, /ithacus-status, /ithacus-recall
│   └── ithacus-dashboard.ts    ← localhost dashboard lifecycle (PREVENT-PI-004 annotated)
└── docs/
    ├── INDEX_MAP.md
    └── specs/
```

### Data model (tables created idempotently in `sqlite.db`)

| table | columns | purpose |
|-------|---------|---------|
| `ith_runs` | run_id, mode_preset, created_at, summary, status | one TeamCreate invocation |
| `ith_agents` | id, run_id, role, model, provider, status, last_seen | roster row per spawned sub-agent |
| `ith_tasks` | id, run_id, title, owner_claim, status | TaskClaim-style dedupe across agents |
| `ith_inbox` | id, agent_id, from_agent, payload, ts, read | inter-agent messages (in-DB mailbox, replaces PR's FS dir) |
| `ith_memories` | id, kind(decision/fact/preference), text, repo_id, ts | durable cross-run continuity |

All written through the one `node:sqlite` handle. The inter-agent mailbox is a
table, not a `~/.clawd-agents/mailbox/...` filesystem tree — pi's event loop is
the watcher.

---

## 3. PR #3250 patterns → ithacus

| PR #3250 (Rust) | ithacus (TS/pi) |
|-----------------|-----------------|
| `TeamCreate` 1–6 agents, presets | `ithacus-team.ts createRun(mode)` → N pi `Agent` dispatches, roster in `ith_agents` |
| FS mailbox + 2s watcher thread | `ith_inbox` table + `events.log`; pi events are the watcher |
| `[team]` stderr progress | `agent_start/end` update `dashboard.json` `crew`+`team` blocks |
| `resolve_agent_model` chain | `src/team.ts` resolves `explicit → subagentModel → provider → default` |
| `qualify_for_provider()` custom/ prefix | applied at spawn when provider is `custom-openai` |
| `execute_batch` parallel-safe | `src/parallel.ts` `Promise.all` over read-only batch |
| `providerFallbacks.primary` precedence | caller model = primary; fallbacks appended + deduped |
| 404 chain-fallthrough | model-call wrapper advances fallback on not-found |
| inject `/setup` creds into spawn | inject provider env before building sub-agent runtime |
| `/team on\|off\|status` | `/ithacus-team on\|off\|status` |

---

## 4. Explicitly out of scope (so the repo stays lean)

- No compression/Trident/dedup engine — that is `pi-mega-compact`'s job; ithacus
  only borrows the durable-trim *relief* pattern and the folder convention.
- No remote MCP server, no non-localhost network (P9).
- No `.tgz`/symlink distribution (P11).
- No new state directory — it lives in `.pi/ithacus`.

---

## 5. Build sequence

1. **P1 + P2**: `src/store.ts` + `src/config.ts` — bind `<repo>/.pi/ithacus/`,
   create the five tables idempotently. Verify the `.db` opens with synchronous
   `node:sqlite` and survives `pi` + tests sharing it.
2. **P3 + P4**: `extensions/ithacus.ts` skeleton + `src/team.ts` `createRun()`
   dispatching real pi sub-agents with the model-resolution chain.
3. **P5**: `src/parallel.ts` parallel-safe batch execution.
4. **P7**: durable-trim relief from `agent-handlers.ts`.
5. **P8 + P12**: memory recall into sub-agent context + `team` block in dashboard.
6. **P6 + P9 + P10 + P11**: fallback robustness, zero-network, drop-boundary
   guards, npm-only distribution + `openclaw.plugin.json` manifest.

---

*References: claw-code PR #3250 (`feat(team): team enhancements, subagentModel,
parallel tool exec`); pi-mega-compact repo (`CLAUDE.md`, `extensions/mega-config.ts`
`repoStateDir`, `extensions/mega-runtime/state.ts` `bindRepo`,
`extensions/mega-events/agent-handlers.ts` durable-trim, `src/store/sqlite/schema.ts`).*
