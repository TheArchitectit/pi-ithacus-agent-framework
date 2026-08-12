# Sprint 5.28 — Live Dispatch Control

**Status**: 📋 DESIGN READY · **Tier**: default-local (Tier L) — no network beyond the local `pi` subprocess spawn (PREVENT-ITH-004).
**Follows**: Sprint 5.27 (live-card overlay + web toggles, just shipped).
**Builds on**: Sprint 5.17 spec `DESIGN_AUTO_COMPACT_RETRY.md` / `PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md` (auto-compact + retry — **currently spec-only, not yet implemented**; see §11 dependency note).
**Related backlog**: #54 (model fallback chain), #55 (agent hot-swap).

---

## 1. User request (verbatim intent)

> "we need a way to take actions in these agent sessions: pause, swap models, restart, stop, start, retry, cancel run, swap to different agent, add agent and split task."

Translation: a control surface over a **running** ithacus dispatch (a child `pi` subprocess spawned by `ithacus-dispatch.ts` → `spawnAgent`). Today a dispatch is fire-and-forget inside `execute()`: the child runs to completion and the parent cannot intervene. This sprint makes dispatches **controllable**: suspend, resume, reconfigure, terminate, and fan out — all with a durable audit trail.

---

## 2. Goal / Non-Goals

**Goal.** Add interactive control verbs over running (or paused) dispatches, implemented as:
1. A **module-level active-dispatch registry** (the source of truth for what is live/paused and with what config + transcript tail).
2. A **`controlDispatch(verb, dispatchId, params)`** core that performs the verb (abort child, respawn, terminate, fan out) and logs an audit action.
3. Two **control surfaces**: a `/ithacus-ctrl` slash command (human) *and* an `ithacus-control` INTERNAL MCP tool (the orchestrating LLM), both thin wrappers over `controlDispatch`.
4. A **state-machine extension** (`WorkerStatus` + `src/worker-status.ts`) so the live card/bus can show `⏸ paused` / `■ stopped` / `✕ cancelled` / `⇄ swapped` / `⑂ splitting`.
5. **Continuation summaries** (reusing 5.17's `buildContinuationSummary` / or a new canonical `src/continuation.ts`) for resume/swap/retry so respawns pick up where the child left off — never reusing a dead child's session (the claw-code PR #4 bug).

**Non-Goals.** Auto-retry/backoff/fallback (that is 5.17 — this sprint provides the *manual* equivalents). Cross-session persistence of the registry (in-memory only; durable audit goes to `events.log` + `dispatch-completions/`). Rolling back filesystem side effects a killed child already made. Re-mounting the persistent TUI overlay from a slash-command handler (best-effort only — see §9 risk R6). Modifying `ith_async.ts` (detached background runs are a separate concern; see §4.4).

---

## 3. Control verb taxonomy

Ten user-named verbs collapse to **eight distinct operations**. The control core takes a single `ControlVerb` union.

| Verb | Synonym? | Family | Distinct meaning |
|---|---|---|---|
| `pause` | — | suspend | Kill the child (SIGTERM), **preserve** dispatch state + transcript tail so it can be resumed. Dispatch enters `paused`. |
| `resume` | `start` | continue-from-tail | Resume a **paused** dispatch: spawn a fresh child primed with a continuation summary built from the preserved tail. Same agent+model. |
| `start` | = `resume` | continue-from-tail | Alias for `resume` (the user listed "resume/start" together). Provided for ergonomics; routed to the same code path. |
| `stop` | — | terminate+keep | Kill the child, mark `stopped` (user-initiated, **not** a failure). Output/transcript **kept** as a completion artifact. |
| `restart` | — | clean-slate | Kill + respawn with the **original task verbatim** (no continuation). Same agent+model. A brand-new run from scratch. |
| `retry` | — | continue-from-tail | Like `resume` but may be issued on a **running or failed** (not just paused) dispatch: abort the live child if any, then respawn with a continuation summary + same agent+model. The *manual* counterpart to 5.17's auto-retry. |
| `cancel` | — | terminate+discard | Kill the child, mark `cancelled` (abort + **discard** — no completion artifact kept). Distinct from `stop` (keep vs discard). |
| `swap_model` | — | continue-from-tail | Kill + respawn with a **different model** + continuation summary. Manual version of 5.17's model fallback. |
| `swap_agent` | — | continue-from-tail | Kill + respawn with a **different agent definition** + continuation summary. Manual version of #55 hot-swap. |
| `add_agent` / `split_task` | same op | fan-out | Create a **new** dispatch (new `dispatchId`, `parentDispatchId` link) with a *portion* of the current task; original optionally kept running (default) or paused. |

**Taxonomy rules (enforced in `controlDispatch`):**
- *Continue-from-tail family* = `{resume, retry, swap_model, swap_agent}`: abort current child (if live), build `[continuation] <summary>\n\n<originalTask>`, respawn **reusing the same `dispatchId`** (logical same dispatch, reconfigured), same agent+model unless overridden.
- *Clean-slate family* = `{restart}`: respawn with `originalTask` verbatim (no summary), same agent+model, same `dispatchId`.
- *Suspend* = `{pause}`: abort child, snapshot tail, enter `paused`, **do not** deregister.
- *Terminate* = `{stop, cancel}`: abort child, enter terminal (`stopped`/`cancelled`), deregister, write/omit completion.
- *Fan-out* = `{add_agent, split_task}`: spawn a **new** `dispatchId` child; never mutates the original's `dispatchId` (original may keep running or be paused via an implicit `pause`).

**Idempotency / no-ops:** pausing an already-paused dispatch → `no-op` audit. Stopping/cancelling a `done`/`failed`/`stopped`/`cancelled` dispatch → `no-op` (or error if the dispatch is no longer in the registry).

---

## 4. Architecture

### 4.1 Active-dispatch registry (the heart)

`spawnAgent` (per `extensions/ithacus-spawn.ts`) creates the `ChildProcess` **internally** and exposes kill only via `opts.signal: AbortSignal` (its signal handler does `SIGTERM`, then `SIGKILL` after 5 s). It does **not** return the `ChildProcess` or pid. Therefore the registry keys on an **`AbortController`**, not a pid — that is sufficient to kill the child and is the only contract `spawnAgent` offers.

A **module-level singleton** `dispatchRegistry` (in the new `extensions/ithacus-control.ts`) holds one `ActiveDispatch` per live/paused dispatch. Because the dispatch tool and the control command run in the **same parent `pi` process**, they share this module state — no IPC needed.

```ts
// extensions/ithacus-control.ts (NEW, Tier L, zero network)
export type ControlVerb =
  | "pause" | "resume" | "start"
  | "stop" | "restart" | "retry"
  | "cancel" | "swap_model" | "swap_agent"
  | "add_agent" | "split_task";

export interface ActiveDispatch {
  dispatchId: string;
  parentDispatchId?: string;       // set only for split children
  agent: string;
  task: string;                    // ORIGINAL task (never the compacted one)
  model?: string;
  provider?: string;
  cwd?: string;
  tools?: string[];
  abort: AbortController;          // kill handle for the CURRENT child
  phase: "live" | "paused" | "terminating" | "done";
  liveSnapshot: LiveProgress | null; // captured at pause (survives removeLive)
  resumedFrom?: string;            // prior dispatchId if this is a swap/resume child
  createdAt: number;
  updatedAt: number;
  log: ControlAction[];            // in-memory audit trail
}

export interface ControlAction {
  verb: ControlVerb;
  dispatchId: string;
  at: number;
  actor: string;                   // "user" | agent id | "system"
  fromAgent?: string; fromModel?: string;
  toAgent?: string; toModel?: string;
  continuation?: boolean;          // built a continuation summary
  spawnedDispatchId?: string;      // for split (new child)
  result: "ok" | "no-op" | "error";
  reason?: string; error?: string;
}

class DispatchRegistry {
  private m = new Map<string, ActiveDispatch>();
  register(d: ActiveDispatch): void;
  get(id: string): ActiveDispatch | undefined;
  list(): ActiveDispatch[];
  deregister(id: string): void;
  // TTL guard (R5): drop paused entries older than registryTtlMs
  reapStale(now: number, ttlMs: number): void;
}
export const dispatchRegistry = new DispatchRegistry();
```

### 4.2 Control command handler — `controlDispatch`

```ts
// extensions/ithacus-control.ts
export interface ControlParams {
  model?: string; provider?: string;     // swap_model
  agent?: string;                         // swap_agent
  task?: string;                          // add_agent/split_task: the sub-task prompt
  keepOriginal?: boolean;                 // split: keep original running (default true)
}
export async function controlDispatch(
  verb: ControlVerb, dispatchId: string, params?: ControlParams,
): Promise<ControlAction>;
```

Behavior by verb (all via the shared `runControlledChild` spawn+live+status wiring, §4.3):

- **`pause`**: `d.get(dispatchId).abort.abort()` → child dies with `error:"aborted"`. Capture `liveSnapshot = toLiveProgress(getLive(dispatchId))` (so it survives the card's later `removeLive`). Set `phase="paused"`, status `paused` (do **not** call `endLive` as failure — the card must show ⏸, not ❌). Audit `verb:pause`, `result:ok`. Dispatch stays registered.
- **`resume`/`start`**: require `phase==="paused"` (else `no-op`/error). Build `task = buildContinuationSummary({ live: liveSnapshot ?? toLiveProgress(getLive(id)), originalTask: d.task })`. Replace `d.abort` with a fresh `AbortController`, call `runControlledChild(dispatchId, d.agent, d.model, d.provider, task, d.abort.signal)`, set `phase="live"`, status `working`. Audit `verb:resume, continuation:true`.
- **`retry`**: like `resume` but allowed when `phase==="live"` too — first `abort.abort()` the running child, then respawn with continuation + same config. Audit `verb:retry, continuation:true`.
- **`restart`**: `abort.abort()` if live; respawn with `d.task` **verbatim** (no summary), same config, same `dispatchId`. Audit `verb:restart, continuation:false`.
- **`swap_model`**: `abort.abort()` if live; `d.model = params.model`; respawn with continuation + new model. Audit `verb:swap_model, toModel, continuation:true`.
- **`swap_agent`**: `abort.abort()` if live; `d.agent = params.agent` (resolve via `findAgent`); respawn with continuation + new agent. Audit `verb:swap_agent, toAgent, continuation:true`.
- **`stop`**: `abort.abort()`; status `stopping` then `stopped`; write a `stopped` completion artifact (KEEP output); deregister; audit `verb:stop`.
- **`cancel`**: `abort.abort()`; status `stopping` then `cancelled`; **omit** the completion artifact (DISCARD); deregister; audit `verb:cancel`.
- **`add_agent`/`split_task`**: spawn a **new** `ActiveDispatch` with `parentDispatchId = dispatchId`, `agent = params.agent ?? d.agent`, `task = params.task` (the sub-task), fresh `AbortController`; if `keepOriginal === false` also `pause` the original. New child runs via `runControlledChild` with a **new** `dispatchId`. Audit `verb:split_task, spawnedDispatchId`.

### 4.3 Shared child runner — `runControlledChild`

Extracted so `ithacus-dispatch.ts`'s `execute()` (first spawn) and `controlDispatch` (respawns) share identical live/status wiring:

```ts
// extensions/ithacus-control.ts — shared by dispatch.ts + control.ts
export async function runControlledChild(opts: {
  dispatchId: string; agent: string; task: string;
  model?: string; provider?: string; cwd?: string; tools?: string[];
  signal: AbortSignal; runtime?: IthRuntime;
  onProgress?: SpawnAgentOpts["onProgress"];
}): Promise<SpawnAgentResult>;
```

It calls `spawnAgent({...opts, signal, onProgress})` and feeds `onProgress` through the same `parseJsonlLine → updateLive → mapEventToStatus → setWorkerStatus` pipeline already in `execute()`. `ithacus-dispatch.ts` imports `runControlledChild` from `ithacus-control.ts` (no import cycle: `control.ts` imports `spawn.ts`/`live.ts`/`runtime.ts`/`continuation.ts`/`completion.ts`, **not** `dispatch.ts`).

### 4.4 Why not reuse `ith_async.ts`?

`extensions/ithacus-async.ts` + `src/async.ts` manage **detached** background runs (child `unref()`'d, pid + `.log` + `.exit` sidecar, polled via `checkAsyncRun(pid)`). Dispatches are **in-process awaited** children (the parent tool call blocks on `spawnAgent`). Two different lifecycles → two different registries. Control operates on the in-process `dispatchRegistry` only. (A future unification could register detached runs in the same map, but that is out of scope; noted so the two are not conflated.)

### 4.5 `execute()` refactor (in `ithacus-dispatch.ts`)

Today `execute()` does `res = await spawnAgent({...})` then `finally { endLive; writeDispatchCompletion; dispatchEnded }`. Refactor:
1. Before spawn: `dispatchRegistry.register({ dispatchId, agent, task, model, provider, cwd, tools, abort:new AbortController(), phase:"live", liveSnapshot:null, log:[] })`.
2. `res = await runControlledChild({...signal: abort.signal})`.
3. After await, inspect `dispatchRegistry.get(dispatchId)?.phase`:
   - `phase === "paused"` → do **not** `endLive` as failure; instead `pauseLive(dispatchId)` (status `paused`, no `markDone`/dismiss). Return a `paused` result header. Keep registered.
   - `phase === "terminating"` → `endLive` with the terminal status (`stopped`/`cancelled`), write/omit completion accordingly, `dispatchRegistry.deregister`.
   - natural terminal (`res.success` or genuine `failed`) → current behavior (`endLive`, completion, deregister).
4. The tool's return value reflects the control outcome (`paused` / `stopped` / `cancelled` / `success` / `failed`) in the status header.

This makes `execute()` return at `pause`/`stop`/`cancel` while the dispatch lives on in the registry; `resume`/`swap`/`split` are **separate** `controlDispatch` calls that spawn their own children (they do not re-enter the frozen `execute()`).

---

## 5. State machine (`WorkerStatus` + `src/worker-status.ts`)

### 5.1 New `WorkerStatus` values

Add to `src/events.ts` (the authoritative enum — note `WorkerStatus` lives in `events.ts`, **not** `types.ts`):

```ts
| "paused"     // dispatch suspended by user; child killed, tail preserved
| "stopping"   // graceful kill in progress (SIGTERM sent, awaiting exit)
| "swapped"    // swap-model/agent respawn in progress (transient)
| "splitting"  // split spawn in progress (transient, leads to a new child)
| "stopped"    // terminal: user-initiated abort + KEEP
| "cancelled"  // terminal: user-initiated abort + DISCARD
```

(5.17 adds `"retrying"` — include it in the transition table below for coordination; if 5.17 lands first, these rows merge.)

### 5.2 Transition table additions (`TRANSITIONS` in `src/worker-status.ts`)

| From \ To | new legal targets |
|---|---|
| `spawning` | + `paused`, `stopping`, `swapped`, `splitting`, `stopped`, `cancelled` |
| `trust_required` | + `paused`, `stopping`, `stopped`, `cancelled` |
| `tool_permission` | + `paused`, `stopping`, `stopped`, `cancelled` |
| `ready_for_prompt` | + `paused`, `stopping`, `swapped`, `splitting`, `stopped`, `cancelled` |
| `working` | + `paused`, `stopping`, `swapped`, `splitting`, `stopped`, `cancelled` |
| `paused` | `working` (resume), `stopping`, `swapped`, `splitting`, `stopped`, `cancelled` (self-loop ok) |
| `stopping` | `stopped`, `cancelled` (absorbing into terminal) |
| `swapped` | `spawning`, `working`, `done`, `failed`, `paused`, `stopping`, `stopped`, `cancelled` (transient → fresh child) |
| `splitting` | `spawning`, `working`, `done`, `failed`, `paused`, `stopping`, `stopped`, `cancelled` |
| `stopped` | `stopped` (absorbing) |
| `cancelled` | `cancelled` (absorbing) |
| `retrying` *(5.17)* | + `paused`, `stopping`, `swapped`, `splitting`, `stopped`, `cancelled` |
| `done` / `failed` | unchanged (absorbing) |

`paused`/`swapped`/`splitting` are **resting/transient** (not terminal); `stopped`/`cancelled` join `done`/`failed` as **terminal** in `isTerminalStatus`.

### 5.3 ASCII state diagram

```
                 pause              pause                pause
   spawning ───────────► paused ◄─────────── pause ──────────── working
      │  │  │             │  ▲  │  resume            │  ▲  │  │
      │  │  │ resume/     │  │  │ (same id)          │  │  │  │ stop/cancel
      │  │  │ retry/      │  │  └──────────► stopping ─┘  │  │  │
      │  │  │ swap/       │  │        (SIGTERM)      │     │  │  │
      │  │  │ restart     │  └──────────► swapped ───┘     │  │  │
      │  │  │ split       │      (respawn same id)        │  │  │
      │  │  └─────────────► splitting ──► (NEW dispatchId) │  │  │
      │  │                  (fan-out child boots)         │  │  │
      │  └──────────────────────► stopping ──► stopped ────┘  │  │
      └──────────────────────────────────────────► cancelled ┘  │
   (natural terminal)                                            │
   working ──► done        working ──► failed  (5.17: working ──► retrying ──► working/done/failed)
```

---

## 6. Data structures (reuse + new)

- **`LiveProgress`** (reused from 5.17 / owned here, §11): `{ agent, model?, recentTools: {tool,args}[], toolCallCount, tokensIn, tokensOut, filesAccessed, taskPreview? }`. The canonical `toLiveProgress(live: AgentLive): LiveProgress` adapter lives in `src/continuation.ts` and is the only cross-boundary type between `extensions/` and `src/`.
- **`ActiveDispatch`**, **`ControlAction`**, **`ControlVerb`**, **`ControlParams`**, **`DispatchRegistry`** — new, in `extensions/ithacus-control.ts` (§4.1–4.2).
- **`WorkerStatus`** additions — `src/events.ts`.
- **`writeDispatchCompletion`** — moved from `ithacus-dispatch.ts` into a new small `extensions/ithacus-completion.ts` (pure `node:fs`/`node:path` + `IthRuntime` type only) so **both** `dispatch.ts` and `control.ts` import it without an import cycle. Extended with optional `parentDispatchId?` and `controls?: ControlAction[]` (additive, non-breaking).

---

## 7. Continuation summary integration with 5.17

5.17's `buildContinuationSummary({ live, originalTask, keepRecent })` is exactly the primitive resume/swap/retry need: it keeps the last `keepRecent` tool calls **verbatim** (PREVENT-ITH-001 anchor floor), embeds `originalTask` unchanged, and never drops a completed tool call without its result (PREVENT-ITH-002). It prepends the summary to `task` as **user-equivalent text**, never `role:"system"` (PREVENT-ITH-003).

**Ownership decision (resolves the 5.17-not-yet-built gap, R1):** 5.28 implements `src/continuation.ts` (`LiveProgress` + `buildContinuationSummary` + `toLiveProgress`) as the **canonical home**. When 5.17 is built, it imports `buildContinuationSummary`/`LiveProgress` from `src/continuation.ts` instead of creating its own `src/auto-compact.ts` (cross-sprint coordination note recorded in §11). This keeps 5.28 self-contained and gives 5.17 a ready building block. If 5.17 already shipped `src/auto-compact.ts` by implementation time, 5.28 simply imports from there and skips `src/continuation.ts`.

For **swap_model / swap_agent**, the continuation summary is identical to retry's, only the respawn config differs — so they all call the same `buildContinuationSummary` and pass a different `model`/`agent` to `runControlledChild`.

---

## 8. Task splitting design (`add_agent` / `split_task`)

**v1 (this sprint) — explicit split instruction:**
- `controlDispatch("split_task", dispatchId, { agent, task, keepOriginal })`.
- `task` is a **user-provided** sub-task prompt (e.g. `/ithacus-ctrl split_task <id> plan "write integration tests for the auth module"`). The original `task` stays with the original dispatch.
- A **new** `ActiveDispatch` is created with `parentDispatchId = dispatchId`, a fresh `dispatchId`, and the provided `agent` (resolved via `findAgent`). It runs via `runControlledChild` and gets its own live card + completion file.
- `keepOriginal` (default `true`) keeps the original running; if `false`, the original is implicitly `pause`d (so the two agents don't both mutate the same files blindly — coordination is left to the agents via the `ithacus-mailbox` tool, which is already PUBLIC in children).
- Audit: `verb:split_task, spawnedDispatchId:<newId>, toAgent:<agent>`.

**Coordination tie-in:** the new child is a real `pi` subprocess with the mailbox extension loaded, so it can `ithacus-mailbox` the original agent (and vice-versa) — the split is naturally multi-agent without new plumbing.

**v2 (future, documented gap G1):** LLM-assisted decomposition — ask the parent's model (or a tiny `plan` agent) to split `originalTask` into `taskA` (stays) + `taskB` (new agent). Out of scope for 5.28; the `task` param already supports a model-supplied string, so v2 is an additive command-mode later.

**Concurrency:** a split that keeps the original running means **two** children of related tasks execute concurrently. That is intended (fan-out). The registry tracks both; `listLive()` + `/ithacus-status` show both. No new locking — each child is independent.

---

## 9. Control surface (how the user invokes it)

**Both**, mirroring existing conventions:

1. **Slash command** `/ithacus-ctrl` (human) — registered in `extensions/ithacus-commands.ts` via the existing `registerCmd` wrapper (same `(args, ctx) => Promise<string|void>` shape as `/ithacus-live`, `/ithacus-team`, …):
   ```
   /ithacus-ctrl list
   /ithacus-ctrl pause <dispatchId>
   /ithacus-ctrl resume <dispatchId>        # alias: start
   /ithacus-ctrl stop <dispatchId>
   /ithacus-ctrl cancel <dispatchId>
   /ithacus-ctrl restart <dispatchId>
   /ithacus-ctrl retry <dispatchId>
   /ithacus-ctrl swap_model <dispatchId> <model> [provider]
   /ithacus-ctrl swap_agent <dispatchId> <agent>
   /ithacus-ctrl split_task <dispatchId> <agent> <subtask...>
   ```
   `list` reads `dispatchRegistry.list()` (+ `listLive()`) and prints `dispatchId · agent · phase · status · model`.

2. **MCP tool** `ithacus-control` (orchestrating LLM) — registered via `registerToolWithVisibility(pi, tool, ToolVisibility.INTERNAL)` in a new `extensions/ithacus-control-tool.ts`, added to `TOOL_VISIBILITY` in `ithacus-tool-registry.ts`. INTERNAL (not PUBLIC) because only the parent orchestrator should drive control — exactly like `ithacus-dispatch` (children never control their parent). Its `execute()` parses `{ verb, dispatchId, params }` and calls `controlDispatch`.

Both wrappers delegate to the single `controlDispatch` core → one code path, one audit trail.

---

## 10. Audit trail

Every control action is durable:
- **`events.log`** (`runtime.appendEvent("dispatch_control", { verb, dispatchId, actor, fromAgent, fromModel, toAgent, toModel, continuation, spawnedDispatchId, result, reason })`) — one line per action.
- **`dispatch-completions/<id>.json`** — `writeDispatchCompletion` (now in `ithacus-completion.ts`) enriched with `parentDispatchId?` and a `controls: ControlAction[]` array (additive keys). For `stop`, status=`"stopped"` and the file is kept; for `cancel`, **no file is written** (discarded) — the only audit is the `events.log` line.
- **In-memory** `ActiveDispatch.log: ControlAction[]` — for live inspection via `/ithacus-ctrl list`.

---

## 11. Dependencies (5.17 / #54 / #55)

| Dep | Status | How 5.28 uses it |
|---|---|---|
| **5.17 auto-compact + retry** (`DESIGN_AUTO_COMPACT_RETRY`, `PLAN_SPRINT_5_17`) | **Spec-only — not implemented** (its `src/auto-compact.ts` etc. are absent in the repo today) | 5.28 needs only the **continuation-summary builder**, not 5.17's auto-loop. **Resolution:** 5.28 owns `src/continuation.ts` (`buildContinuationSummary`/`LiveProgress`/`toLiveProgress`) as canonical; 5.17 later imports it. If 5.17 ships first, 5.28 imports from `src/auto-compact.ts` and skips its own. |
| **#54 model fallback chain** (`src/model-fallback.ts`, `resolveModelFallbackChain` in `team.ts`) | Not implemented | `swap_model` does **not** need the auto chain — it swaps to an *explicit* user model via `resolveProviderForModel` (already exists in `src/provider-resolver.ts`) + `findAgent`. Independent of #54. |
| **#55 agent hot-swap** (automated) | Backlog | `swap_agent` is the **manual trigger** — discover the new agent via `discoverIthacusAgents`/`findAgent` (already exist) and respawn. #55's *automated* swap is unrelated; no dependency. |

**Hard ordering note:** 5.28 should not block on 5.17; it carries its own `src/continuation.ts`. The only shared primitive is `buildContinuationSummary`, and 5.28 is the owner of record.

---

## 12. File-by-file implementation plan (dependency order, with size caps)

All `src/` files **< 300 lines**, all `extensions/` files **< 400 lines** (CLAUDE.md guardrails). Each change is a focused, separately-committable unit.

| # | File | Change | Cap |
|---|---|---|---|
| 1 | `src/events.ts` | Add `paused`/`stopping`/`swapped`/`splitting`/`stopped`/`cancelled` to `WorkerStatus`. (`retrying` added by 5.17 if it lands first.) | <300 |
| 2 | `src/worker-status.ts` | Add the transition rows from §5.2 to `TRANSITIONS`; extend `isTerminalStatus` to include `stopped`/`cancelled`; add `isControllableStatus(s)` helper (true for `live`/`paused`). | <300 |
| 3 | `src/continuation.ts` **(NEW, pure, pi-agnostic)** | `LiveProgress`, `buildContinuationSummary({ live, originalTask, keepRecent })`, `toLiveProgress(live: AgentLive): LiveProgress`. Honors ITH-001/002/003 (anchor floor + tool-pair, continuation is task text). Reuses `src/boundary.ts` *if 5.17 ships it*; otherwise a minimal local anchor-floor (no bare `slice`). | <300 |
| 4 | `extensions/ithacus-completion.ts` **(NEW)** | Move `writeDispatchCompletion` here from `ithacus-dispatch.ts`; add `parentDispatchId?` + `controls?: ControlAction[]` (additive). Imported by both `dispatch.ts` and `control.ts` (breaks the cycle). | <400 |
| 5 | `extensions/ithacus-control.ts` **(NEW)** | `ControlVerb`, `ActiveDispatch`, `ControlAction`, `ControlParams`, `DispatchRegistry` (`dispatchRegistry` singleton, incl. `reapStale`), `runControlledChild` (shared spawn+live+status wiring), `controlDispatch(verb, id, params)` (all verb logic from §4.2), `snapshotLiveProgress(id)`. Zero network; **no `child_process` import** (uses `spawnAgent` + `AbortController` only → PREVENT-ITH-004 stays clean). | <400 |
| 6 | `extensions/ithacus-dispatch.ts` | Refactor `execute()` to register in `dispatchRegistry` (§4.5), delegate spawn to `runControlledChild` (imported from `control.ts`), handle `paused`/`terminating` returns, and import `writeDispatchCompletion` from `ithacus-completion.ts`. Keep `registerDispatchTool` signature unchanged. | <400 |
| 7 | `extensions/ithacus-live.ts` | Add `pauseLive(id)` (status `paused`, no `markDone`/dismiss) + `snapshotLiveProgress(id): LiveProgress | null` (returns `toLiveProgress(getLive(id))` or null). `setWorkerStatus` already accepts new statuses via `canTransition`. | <400 |
| 8 | `extensions/ithacus-live-card.ts` | `STATUS_ROW` add `paused` (⏸), `stopping` (■…), `stopped` (■), `cancelled` (✕), `swapped` (⇄), `splitting` (⑂). `render()` shows the icon+label. | <400 |
| 9 | `extensions/ithacus-tool-registry.ts` | Add `"ithacus-control": ToolVisibility.INTERNAL` to `TOOL_VISIBILITY`. | <400 |
| 10 | `extensions/ithacus-control-tool.ts` **(NEW)** | `registerControlTool(pi)` — the INTERNAL `ithacus-control` MCP tool; `execute()` parses `{verb, dispatchId, params}` → `controlDispatch`. Thin wrapper. | <400 |
| 11 | `extensions/ithacus-commands.ts` | Add `/ithacus-ctrl` `registerCmd` (verbs + `list` from §9) delegating to `controlDispatch`; optionally surface control state in `/ithacus-status`. | <400 |

**Optional (out of mandatory scope):** a lightweight durable `ith_dispatches` sqlite table in `src/store.ts` so `/ithacus-ctrl list` survives a session restart. Recommended to stay **in-memory + `events.log`** for 5.28 (no migration, smaller surface); the table is a documented future extension.

---

## 13. Guardrails check (PREVENT-*)

| Rule | Applies? | How honored |
|---|---|---|
| **ITH-001** (anchor floor) | yes | `buildContinuationSummary` keeps last `keepRecent` tool calls verbatim + embeds `originalTask`. If 5.17's `src/boundary.ts` exists, use `computeDropRange`/`dropBefore`; else a local anchor-floor guarded by the whitelisted names. Never a bare `messages.slice`. |
| **ITH-002** (no split toolCall/result) | yes | `LiveProgress.recentTools` are atomic (call+result captured together); continuation never drops a completed pair. The in-flight tool call (no `message_end` yet) simply isn't in the tail, so nothing to drop. |
| **ITH-003** | yes | Continuation text is prepended to `task` (user-equivalent), never `role:"system"`. |
| **ITH-004 / PI-004** | critical | No `fetch`/network in new `src/`/`extensions/`. `ithacus-control.ts` **does not import `child_process`** — it kills via `AbortController` + reuses the already-annotated `spawnAgent`. New `src/continuation.ts` uses Node built-ins only. |
| **ITH-005** | n/a | No `extensions/opt-in/*` usage. |
| **DIST-001** | yes | No tarball/symlink; version bump only via `scripts/deploy.sh`. |
| **src pi-agnostic** | yes | `src/continuation.ts` + `src/events.ts` + `src/worker-status.ts` are pure (no pi/ExtensionAPI imports). `extensions/*` holds all pi/runtime/process logic. |

Gate: `npm run guardrails` (pattern scan confirms no `fetch(`/new network in new files, confirms drop-path uses whitelisted names) + `python3 scripts/regression_check.py --all`.

---

## 14. Concurrency: graceful vs forced kill

- **Kill mechanism:** `controlDispatch` calls `ActiveDispatch.abort.abort()`. `spawnAgent`'s signal handler does `SIGTERM`, then `SIGKILL` after 5 s. For `pause`/`stop`/`cancel` we may shorten the grace window (e.g. 2 s) so pi can flush, with `SIGKILL` as the guaranteed fallback.
- **Mid-tool-call pause:** killing the child abandons an in-flight tool call. The transcript tail already in the live store is preserved (completed tool entries). The in-flight tool's **on-disk side effects are NOT rolled back** (e.g. a half-written file) — documented limitation (R2). ITH-002 still holds (we keep completed pairs; the partial call was never recorded).
- **Race (control issued after `execute()` already returned):** `controlDispatch` checks `dispatchRegistry.get(id)`; if absent → `result:"error"` (`"dispatch not active"`) or `no-op` for terminal states. Single-threaded JS event loop means no true race on the map; `reapStale` (R5) prevents a paused dispatch living forever.
- **Double control:** pausing an already-paused dispatch → `no-op` (audit). Stopping a `done` dispatch → `no-op`.

---

## 15. Smoke test outline

**smoke-src (pure `src/` — `node --experimental-strip-types`):**
1. `worker-status`: transitions `working→paused`, `paused→working`, `paused→stopped`, `paused→cancelled`, `stopping→stopped`, `stopping→cancelled`, `swapped→spawning`, `splitting→spawning`; `isTerminalStatus` true for `stopped`/`cancelled`; `canTransition` refuses `done→paused`.
2. `continuation`: `buildContinuationSummary` keeps last N tool calls verbatim, embeds `originalTask`, does **not** drop a tool result without its call (ITH-001/002); continuation is plain text (ITH-003); `toLiveProgress` maps `AgentLive` → `LiveProgress`.

**smoke-ext (injected `spawnImpl`):**
3. **pause:** `controlDispatch("pause", id)` → `spawnImpl` receives `SIGTERM` on its `signal`; registry `phase==="paused"`; `liveSnapshot` captured; `events.log` has `dispatch_control verb=pause`; status event `paused`.
4. **resume:** `controlDispatch("resume", id)` → new child spawned with task containing `[continuation]`/`[resume]`; same `dispatchId`; `spawnImpl` task asserts the summary prefix; completion updated.
5. **stop:** → child aborted; status `stopped`; completion file written with `status:"stopped"`.
6. **cancel:** → status `cancelled`; **no** completion file written.
7. **restart:** → respawn with `originalTask` verbatim (no `[continuation]` prefix); same config.
8. **retry:** on a still-`live` dispatch → `abort.abort()` then respawn with continuation + same config.
9. **swap_model:** `controlDispatch("swap_model", id, {model:"x"})` → new child spawned with `--model x` + continuation; status `swapped` transient then `working`.
10. **swap_agent:** `controlDispatch("swap_agent", id, {agent:"plan"})` → new child with `plan` agent + continuation.
11. **split_task:** `controlDispatch("split_task", id, {agent:"plan", task:"sub"})` → **new** `dispatchId` spawned, `parentDispatchId==id`; original kept running (default).
12. **concurrency/idempotency:** pause then immediate stop → consistent terminal; pause already-paused → `no-op`; control on unknown id → `error`.
13. **card render:** `STATUS_ROW` shows ⏸/■/✕/⇄/⑂ for the new snapshots.

---

## 16. Risks & spec gaps

| # | Risk / gap | Mitigation |
|---|---|---|
| R1 | **5.17 not implemented** (continuation helper absent). | 5.28 owns `src/continuation.ts` as canonical; 5.17 imports it later. No hard block. |
| R2 | **Filesystem side effects not rolled back** on pause/stop (a killed child may have half-written files). | Documented limitation; ITH-002 still holds for the transcript tail. Split's `keepOriginal:false` pauses the original to reduce blind concurrent mutation. |
| R3 | **`execute()` returns at pause** — the parent LLM sees a `paused` result, not the child's output. | Defined return contract (status header reflects `paused`/`stopped`/`cancelled`). Acceptable; dispatch lives on in the registry. |
| R4 | **Import cycle** (dispatch.ts ↔ control.ts via `writeDispatchCompletion`). | Move `writeDispatchCompletion` to new `ithacus-completion.ts`; both import it; control.ts never imports dispatch.ts. |
| R5 | **Registry grows unbounded** (paused dispatches never reaped). | `DispatchRegistry.reapStale(now, ttlMs)` drops paused entries older than a TTL (configurable; default 24 h). |
| R6 | **Overlay not re-mounted from a slash command** (control respawn has no reliable `ctx.ui`). | Control respawns update store + bus + completion (durable + inspectable via web dashboard 5.27 + `/ithacus-ctrl list` + `listLive`). Overlay re-mount from a command handler is best-effort/future work. |
| R7 | **`dispatchId` reuse** for resume/swap/restart/retry — audit/debugging shows one id for multiple children. | Each control action is a distinct `ControlAction` in `events.log` + completion `controls[]`; the continuation chain is fully reconstructable. Split uses a **new** id (clean separation). |
| R8 | **Graceful kill window** — pi mid-tool-call may not honor `SIGTERM`. | `SIGKILL` fallback after the grace window guarantees termination; acceptable per §14. |
| G1 | **Automatic task splitting** (LLM decomposition) not in v1. | `split_task` takes an explicit `task`; v2 (model-assisted) is an additive future command mode. |
| G2 | **Cross-restart registry persistence** — paused dispatch lost on parent restart. | In-memory by design; durable audit in `events.log`. Optional `ith_dispatches` table deferred. |
| G3 | **#55 automated hot-swap** could later conflict with manual `swap_agent`. | Distinct triggers (manual verb vs automated policy); no shared state today. Coordinate if #55 lands. |

---

## 17. Commit sequence (focused, one logical unit per commit)

1. `src/events.ts` + `src/worker-status.ts` (status additions + transitions) → `build` + `guardrails` + `smoke-src`.
2. `src/continuation.ts` (canonical `buildContinuationSummary`/`LiveProgress`/`toLiveProgress`) → `smoke-src`.
3. `extensions/ithacus-completion.ts` (move `writeDispatchCompletion`) + `extensions/ithacus-dispatch.ts` (refactor to registry + `runControlledChild`) → `smoke-ext`.
4. `extensions/ithacus-control.ts` (registry + `controlDispatch` + `runControlledChild`) → `smoke-ext` (pause/resume/stop/cancel/restart/retry/swap/split).
5. `extensions/ithacus-live.ts` + `ithacus-live-card.ts` (paused/stopped/cancelled/swapped/splitting render) → `guardrails` + ext smoke.
6. `extensions/ithacus-tool-registry.ts` + `ithacus-control-tool.ts` (INTERNAL `ithacus-control` MCP tool) + `ithacus-commands.ts` (`/ithacus-ctrl`) → full `smoke-ext` + `guardrails` + `regression`.
7. **Patch bump** `0.6.6 → 0.6.7` via `bash scripts/deploy.sh` (auto patch) + `npm run gate` green. Single PATCH step per sprint (`CLAUDE.md` §3); never hand-edit `package.json` version.

---

## 18. Summary (10 lines)

- **Goal:** make running ithacus dispatches controllable — pause/resume/stop/restart/retry/cancel/swap-model/swap-agent + add-agent/split-task — with a durable audit trail, no new network, `src/` stays pi-agnostic.
- **Registry:** a module-level `dispatchRegistry` (singleton in new `extensions/ithacus-control.ts`) holds one `ActiveDispatch` per live/paused dispatch, keyed on an **`AbortController`** (since `spawnAgent` exposes kill only via `signal`, not the `ChildProcess`).
- **Core:** `controlDispatch(verb, dispatchId, params)` performs each verb (abort child / respawn / terminate / fan out) and writes a `ControlAction` audit line; slash command `/ithacus-ctrl` + INTERNAL MCP tool `ithacus-control` both wrap it.
- **State machine:** add `paused`/`stopping`/`swapped`/`splitting`/`stopped`/`cancelled` to `WorkerStatus` (in `src/events.ts`) + `TRANSITIONS` (in `src/worker-status.ts`); `stopped`/`cancelled` join the terminal set.
- **Continuation:** resume/swap/retry reuse 5.17's `buildContinuationSummary` — 5.28 **owns** it as `src/continuation.ts` (canonical; 5.17 later imports) so it isn't blocked on 5.17's unbuilt state; honors ITH-001/002/003.
- **Split:** `split_task` spawns a **new** `dispatchId` child with `parentDispatchId` link + explicit user sub-task; original kept running by default (or paused); children coordinate via the existing `ithacus-mailbox` tool.
- **Kill:** `abort.abort()` → `SIGTERM` then `SIGKILL` after a grace window; transcript tail preserved in `ActiveDispatch.liveSnapshot` (survives the card's `removeLive`); in-flight tool on-disk side effects are NOT rolled back (documented).
- **Files:** new `src/continuation.ts`, `extensions/ithacus-control.ts`, `extensions/ithacus-completion.ts`, `extensions/ithacus-control-tool.ts`; edits to `events.ts`, `worker-status.ts`, `ithacus-dispatch.ts`, `ithacus-live.ts`, `ithacus-live-card.ts`, `ithacus-tool-registry.ts`, `ithacus-commands.ts`. All `src/<300`, `extensions/<400`.
- **Guardrails:** ITH-001/002/003 (continuation anchor-floor + tool-pair + task text), ITH-004 (no `child_process` import in control — only the annotated `spawnAgent`), ITH-005 n/a, DIST-001 (deploy.sh only), `src/` pi-agnostic; gate = build + smoke-src + smoke-ext + guardrails + regression.
- **Deps:** independent of #54 (explicit model swap) and #55 (manual trigger only); depends only on the continuation helper it itself provides. Risks: 5.17 unbuilt (owned here), no side-effect rollback, registry TTL (`reapStale`), overlay re-mount from command is best-effort.
