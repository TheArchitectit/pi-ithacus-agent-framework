# Plan — Sprint 5.17: Auto-Compact + Retry on Context-Window Errors

**Source spec:** `docs/DESIGN_AUTO_COMPACT_RETRY.md` (read in full).
**Status:** Plan only — no source written. Follows `CLAUDE.md` + `docs/AGENT_GUARDRAILS.md`
(Four Laws; `src/` stays pi-agnostic; zero network at runtime — `PREVENT-ITH-004`).

---

## 1. Goal / Non-Goals

**Goal.** When a dispatched sub-agent child `pi` process dies on a context-window
overflow, automatically rebuild a *compacted continuation* from durable state
(the live-progress store + the original task text) and re-spawn a **fresh**
child with that rebuilt prompt — up to `retryPolicy.maxRetries` (default 1, hard
cap 3). Surface `retrying ↻ (attempt n/N)` on the live overlay. Never reuse the
failed child's session (the claw-code PR #4 bug we explicitly avoid).

**Non-goals.**
- Retry on `permission_denied` / `trust_required` (needs interactive grant — future).
- Cross-run / global retry budgets (policy is per-dispatch).
- Changing the durable-trim (`ctx.compact()`) path in `agent-handlers.ts` behavior.

---

## 2. Current-state deltas (what already exists vs the spec)

| Spec assumption | Reality in repo | Action |
|---|---|---|
| Detection via dispatch watching child output | `worker-status.classifyFailure` **already** returns `"context_window"` via `CONTEXT_WINDOW_MARKERS`; `endLive` already classifies | Reuse as the retry trigger (`failureKind === "context_window"`) — no new detection needed |
| `WorkerStatus += "retrying"` in `src/types.ts` | `WorkerStatus` lives in **`src/events.ts`** (5.13 split-file convention; `types.ts` is at its line budget) | Add `"retrying"` to `src/events.ts` + `src/worker-status.ts` `TRANSITIONS` + `toAgentStatus` |
| `src/retry.ts` NEW (pure `shouldRetry`) | none | Realized inside the required **`src/auto-compact.ts`** (task's mandated file list) |
| `src/checkpoint.ts buildSummary()` over child progress | `buildSummary` needs `ConversationMessage[]` w/ `exploratory` flags — not what we have at failure time | New `buildContinuationSummary` consumes `LiveProgress` (live store aggregates) + original task; reuse `estimateTokens` from `checkpoint.ts` |
| `AgentLive` attempt counter | not present | add `attempt?` + `retryMax?`; `markRetry()` helper |
| Per-agent `retry:` frontmatter | `AgentConfig` has no `retry` field; parser is flat `key: value` | add `retry?` + parse `retry_enabled` / `retry_max` / `retry_on` |

---

## 3. New `src/` files (pi-agnostic, zero deps, Node built-ins only)

### 3.1 `src/window-pressure.ts` — window-pressure snapshot
```ts
import { effectiveThresholdTokens, pressureRatio, pressureBand, type PressureBand } from "./config.js";

export interface WindowPressure {
  currentTokens: number;
  contextWindow: number;
  tierPct: number;
  threshold: number;        // effectiveThresholdTokens({tierPct,window,fallback})
  ratio: number;            // currentTokens / threshold
  band: PressureBand;       // pressureBand(ratio)
  remaining: number;        // max(0, contextWindow - currentTokens)
  overThreshold: boolean;
}

export function snapshotWindowPressure(opts: {
  currentTokens: number | null;
  contextWindow: number;
  tierPct: number;
  bootFallback: number;
}): WindowPressure;
```
Used by the retry viability check (`planRetry`) and by `src/trim.ts` / `ithacus-runtime.ts`
to expose the full `WindowPressure` object (the dashboard currently only gets a
bare `0..1` ratio via `currentPressure`).

### 3.2 `src/context-error.ts` — context-window-error detection / classifier
```ts
import type { WorkerFailureKind } from "./events.js";

/** Single source of truth for the overflow markers (mirrors worker-status's set). */
export const CONTEXT_WINDOW_MARKERS: readonly RegExp[];

export function isContextWindowError(text: string): boolean;

export interface ContextWindowSignals {
  exitCode?: number;
  lastStatus?: string;
  stderrTail?: string;
  outputTail?: string;
}

/** Pure: does the failure evidence indicate a context-window overflow? */
export function detectContextWindowFailure(s: ContextWindowSignals): boolean;

/** Returns "context_window" | null (kept separate from worker-status's wider classifier). */
export function classifyContextError(s: ContextWindowSignals): WorkerFailureKind | null;
```
**Non-breaking edit to `src/worker-status.ts`:** import `CONTEXT_WINDOW_MARKERS`
from `./context-error.js` (delete the local duplicate) so the markers have one
owner; `classifyFailure` is unchanged. This satisfies the task's "dedicated
detection/classifier module" without code duplication.

### 3.3 `src/boundary.ts` — PREVENT-ITH-001 / PREVENT-ITH-002 enforcement  ⚠
This is the canonical helper the guardrails reference and the auto-compact path
**must** use so `PREVENT-ITH-001` / `PREVENT-ITH-002` never fire.
```ts
export interface MessageLike { role: string; content?: string; [k: string]: unknown; }

export interface ComputeDropRangeOpts {
  /** preserve the most-recent N turns as the anchor floor (PREVENT-ITH-001). */
  keepRecent?: number;
  /** predicate marking messages that must survive the drop (anchor floor). */
  isAnchor?: (m: MessageLike) => boolean;
  isToolResult?: (m: MessageLike) => boolean;  // PREVENT-ITH-002
  isToolUse?: (m: MessageLike) => boolean;     // PREVENT-ITH-002 pairing
}

export interface DropRange {
  dropBefore: number;          // keep messages [dropBefore, len); drop [0, dropBefore)
  anchorUserMessages: string[];
  keptTail: number;
}

/** Walks the boundary BACK if the first kept message is a ToolResult with no ToolUse
 *  before it, and never drops the anchor floor (last keepRecent turns). */
export function computeDropRange(messages: MessageLike[], opts?: ComputeDropRangeOpts): DropRange;

/** Returns the kept tail using computeDropRange (names `dropBefore`/`keepRecent`
 *  so guardrails PREVENT-ITH-001/002 pass). */
export function dropBefore(messages: MessageLike[], dropBefore: number, anchorUserMessages: string[]): MessageLike[];
```
Naming matters: the scan's `forbidden_context` for both rules whitelists
`computeDropRange` / `dropBefore` / `keepRecent` / `anchor` — so any drop path in
`src/` or `extensions/` must route through these names (never a bare
`messages.slice(0, N)` without anchor logic, never `keep_from`/`dropEnd`/`dropStart`/`safeDrop`).

### 3.4 `src/auto-compact.ts` — auto-compact + retry loop  (spec's `src/retry.ts`)
Contains the pure policy + rebuild logic. Imported shapes are local (no
`extensions/` import → keeps `src/` pi-agnostic).
```ts
import type { RetryPolicy, WorkerFailureKind } from "./types.js";
import { estimateTokens } from "./checkpoint.js";
import { computeDropRange } from "./boundary.js";

/** Minimal progress snapshot the extension adapts from AgentLive. */
export interface LiveProgress {
  agent: string;
  model?: string;
  recentTools: Array<{ tool: string; args: string }>;
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
  filesAccessed: string[];
  taskPreview?: string;
}

export interface ContinuationArgs {
  live: LiveProgress;
  /** ORIGINAL task text (never the compacted one). */
  originalTask: string;
  keepRecent?: number;       // default = config.preserveRecent (anchor floor)
  maxBullets?: number;
  failureKind?: WorkerFailureKind;
}

/** Builds `[continuation] <summary>\n\n<remaining task>` — the rebuilt prompt. */
export function buildContinuationSummary(args: ContinuationArgs): string;

/** Pure retry gate. `attempt` = attempts ALREADY made (0-based). */
export function shouldRetry(kind: WorkerFailureKind, attempt: number, policy: RetryPolicy): boolean;

export interface RetryPlan {
  task: string;              // rebuilt compacted prompt
  attempt: number;           // next attempt index (1-based after first failure)
}

export interface PlanRetryArgs {
  dispatchId: string;        // overlay key — KEPT STABLE across attempts (see §5)
  agent: string;
  originalTask: string;
  attempt: number;           // attempts already done
  policy: RetryPolicy;
  live: LiveProgress;
  failureKind: WorkerFailureKind;
  contextWindow?: number;    // viability check (stop if still over window)
  keepRecent?: number;
}

export function planRetry(args: PlanRetryArgs): RetryPlan;
```
Behavior notes:
- `shouldRetry` ⇒ `policy.enabled && policy.on.includes(kind) && attempt < clamp(policy.maxRetries,0,3)`.
- `buildContinuationSummary` keeps the last `keepRecent` tool calls **verbatim**
  (anchor floor, PREVENT-ITH-001) and always embeds `originalTask` unchanged; it
  emits one bullet per earlier tool, capped by `maxBullets`. Tool entries are
  atomic (call+result together) so a pair is never split (PREVENT-ITH-002).
- `planRetry` calls `buildContinuationSummary`, then a **viability guard**: if
  `estimateTokens(summary) > contextWindow` the compaction bought nothing →
  returns the uncompacted `originalTask` (so the caller's `shouldRetry` stop
  prevents a doomed retry). Clamps `attempt` to `[0,3]`.

---

## 4. Edits to existing `src/` files

### 4.1 `src/types.ts`
Add (spec §3):
```ts
export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;        // default 1, hard cap 3
  on: ("context_window" | "crash")[];
}
```

### 4.2 `src/events.ts`
Add `"retrying"` to the `WorkerStatus` union. (`WorkerFailureKind` already has
`"context_window"` — no change.)

### 4.3 `src/worker-status.ts`
- `TRANSITIONS`: add `"retrying"` source row `retrying: ["retrying","working","done","failed"]`
  and append `"retrying"` to `spawning` / `working` / `failed` target lists
  (spec text: "status failed → retrying"). `isTerminalStatus`/`canTransition`
  unchanged in meaning.
- `toAgentStatus`: add `"retrying": "working"` (transient state persists as active).
- Replace local `CONTEXT_WINDOW_MARKERS` with `import { CONTEXT_WINDOW_MARKERS } from "./context-error.js"`.

### 4.4 `src/team.ts` (non-breaking — "dispatch path" config resolution)
```ts
import type { RetryPolicy } from "./types.js";
export const DEFAULT_RETRY_POLICY: RetryPolicy = { enabled: true, maxRetries: 1, on: ["context_window"] };
export interface FrontmatterRetry { enabled?: boolean; maxRetries?: number; on?: ("context_window"|"crash")[]; }
export function resolveRetryPolicy(fm?: FrontmatterRetry | null, base?: RetryPolicy): RetryPolicy;
//   clamps maxRetries to [0,3]; falls back to base when fm omitted.
```
Pure, standalone, no new deps — safe addition.

### 4.5 `src/trim.ts` (non-breaking integration)
Additive only:
```ts
import { snapshotWindowPressure } from "./window-pressure.js";
import { computeDropRange, dropBefore } from "./boundary.js";
export function windowPressure(opts: {/* same as snapshotWindowPressure */}): WindowPressure;
/** Drop the prefix outside the anchor tail, honoring PREVENT-ITH-001/002 via boundary. */
export function safeDropMessages(messages: MessageLike[], opts: ComputeDropRangeOpts): MessageLike[];
```
`decideTrim` / `currentPressure` / `detectBoundaryConflict` / `preserveHeadTail`
stay untouched — the durable-trim path still uses pi's native `ctx.compact()`.
This gives the dashboard/runtime the richer `WindowPressure` and gives the
retry builder a shared safe-drop primitive.

### 4.6 `src/store.ts` (sqlite persistence — spec §2.4)
Add idempotent schema + methods (no column changes to existing tables):
```ts
// SCHEMA += CREATE TABLE IF NOT EXISTS ith_retries (
//   dispatchId TEXT, agent TEXT, attempt INTEGER, failureKind TEXT,
//   startedAt INTEGER, durationMs INTEGER, retryOf INTEGER);
export interface RetryAttemptRecord {
  dispatchId: string; agent: string; attempt: number;
  failureKind: WorkerFailureKind; startedAt: number; durationMs: number; retryOf: number;
}
recordRetryAttempt(rec: RetryAttemptRecord): void;
getRetryAttempts(dispatchId: string): RetryAttemptRecord[];
retryCount(dispatchId: string): number;   // fleet-view attempts
```
Add to `migrateSchema()` (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## 5. Extension wiring (dispatch path)

### 5.1 `extensions/ithacus-live.ts`
- `AgentLive` add `attempt?: number; retryMax?: number;`.
- `startLive(id, agent, model?, taskPreview?, attempt?, retryMax?)` — extra
  optional args, default `0`/`undefined` (non-breaking).
- Add `markRetry(id, attempt, retryMax)` — sets `entry.attempt`/`entry.retryMax`,
  `notify()`. Called between attempts.
- `setWorkerStatus` / `endLive` unchanged (they rely on the `TRANSITIONS` table
  edited in §4.3).

### 5.2 `extensions/ithacus-live-card.ts`
- `STATUS_ROW` add `retrying: { icon: "↻", label: "retrying", color: "warning" }`.
- In `render()`, when `snap.status === "retrying"` show
  `↻ retrying${snap.attempt && snap.retryMax ? ` (attempt ${snap.attempt}/${snap.retryMax})` : ""}`.

### 5.3 `extensions/ithacus-agents.ts`
- `AgentConfig.retry?: { enabled: boolean; maxRetries: number; on: ("context_window"|"crash")[] }`.
- Frontmatter parser: read flat keys `retry_enabled` / `retry_max` / `retry_on`
  (comma-list) and assemble `retry` (matches the existing one-per-line parser;
  no nested-YAML support needed). Missing keys ⇒ `retry` undefined.

### 5.4 `extensions/ithacus-dispatch.ts` — the retry loop  (the core change)
Restructure `execute()` **without** changing the success path or the
`registerDispatchTool` signature. Keep ONE `dispatchId` for the whole
dispatch (overlay key stays valid across attempts — the card keeps rendering);
each retry is a **fresh `spawnAgent`** (new child process) with the rebuilt
`task`. Control flow:

```ts
import { resolveRetryPolicy, DEFAULT_RETRY_POLICY } from "../src/team.js";
import { shouldRetry, planRetry, type LiveProgress } from "../src/auto-compact.js";
import { classifyFailure } from "../src/worker-status.js";
import { setWorkerStatus, markRetry, getLive } from "./ithacus-live.js";

// inside execute():
const policy = resolveRetryPolicy(agentConfig?.retry);   // agentConfig from discoverIthacusAgents
let attempt = 0;
let task = params.task;
let res;
let finalized = false;
const startTime = Date.now();

startLive(dispatchId, agentType, params.model, taskPreview(task), 0, policy.maxRetries);
// ... show overlay (fire-and-forget, unchanged) ...

try {
  while (true) {
    res = await spawnAgent({ agent: agentType, task, model, provider, cwd, signal, onProgress });
    const failureKind = res.success ? undefined
      : classifyFailure({ exitCode: res.exitCode,
          stderrTail: res.stderr?.slice(-512), outputTail: res.output?.slice(-512),
          lastStatus: getLive(dispatchId)?.status });

    if (res.success || !shouldRetry(failureKind ?? "unknown", attempt, policy)) break;

    // RETRY branch
    attempt++;
    setWorkerStatus(dispatchId, "retrying");
    markRetry(dispatchId, attempt, policy.maxRetries);
    store?.recordRetryAttempt({ dispatchId, agent: agentType, attempt, failureKind: failureKind!,
      startedAt: startTime, durationMs: Date.now() - startTime, retryOf: attempt - 1 });
    const plan = planRetry({
      dispatchId, agent: agentType, originalTask: params.task, attempt,
      policy, live: toLiveProgress(getLive(dispatchId)), failureKind: failureKind!,
      contextWindow: <child context window if known>, keepRecent: config.preserveRecent,
    });
    task = plan.task;   // continuation summary becomes the next child's prompt
    // (optionally update live.taskPreview to the continuation preview)
  }
} finally {
  if (!finalized) {
    endLive(dispatchId, res?.success ?? false, res?.error, {
      exitCode: res?.exitCode,
      stderrTail: res?.stderr ? res.stderr.slice(-512) : undefined,
      outputTail: res?.output ? res.output.slice(-512) : undefined,
    });
    finalized = true;
  }
  cardRef.current?.markDone();
  runtime?.dispatchEnded(agentType);
}
```
- `toLiveProgress(live): LiveProgress` is a tiny local adapter (live store →
  src shape); `LiveProgress` is the only cross-boundary type.
- `endLive` fires **exactly once** (at loop exit / on throw) — `finalized` guard
  prevents any double terminalization. The retry flips status to `"retrying"`
  *between* attempts and only terminalizes on the final result.
- The continuation summary is prepended to the **`task` text** (becomes
  `Task: <text>` arg) — **never** injected as `role:"system"` (PREVENT-ITH-003 ✓).
- Reuses the existing local-`pi` spawn (`spawnAgent` already carries the
  `PREVENT-ITH-004` / `PREVENT-PI-004` annotation). No new network.

### 5.5 `extensions/ithacus-commands.ts` (optional, minimal)
`/ithacus-agents` fleet view: append `attempts` from `getLive(id)?.attempt` /
`store.retryCount(dispatchId)`.

---

## 6. Honoring PREVENT-ITH-001 / PREVENT-ITH-002 during auto-compact

| Rule | How the plan honors it |
|---|---|
| **ITH-001** (anchor floor — preserve recent N) | `buildContinuationSummary` keeps the last `keepRecent` tool calls **verbatim** + always embeds `originalTask`. Any prefix-drop uses `computeDropRange(..., { keepRecent, isAnchor })`/`dropBefore` (whitelisted names). Never a bare `messages.slice(0,N)` without anchor logic. |
| **ITH-002** (no split toolCall/result pair) | Tool entries in `LiveProgress.recentTools` are atomic (call+result captured together). When a message array is dropped, `computeDropRange` walks the boundary **back** if the first kept message is a ToolResult with no preceding ToolUse. Helper names (`computeDropRange`, `isToolUse`, `isToolResult`) are in the guardrails whitelist. |
| **ITH-003** | Continuation text prepended to `task` (UserMessage-equivalent), not a `system` role. |
| **ITH-004 / PI-004** | Zero network; retry reuses local `spawnAgent` (annotated). New src files use only Node built-ins. |

---

## 7. Guardrails check (PREVENT-*)

| Rule | Severity | Applies? | How honored |
|---|---|---|---|
| PREVENT-ITH-001 | error | yes | §3.3 `computeDropRange`/`dropBefore` + §3.4 anchor floor + §6 |
| PREVENT-ITH-002 | error | yes | §3.3 boundary walk-back + atomic tool entries + §6 |
| PREVENT-ITH-003 | error | — | continuation is `task` text, not `role:"system"` (§5.4) |
| PREVENT-ITH-004 | critical | — | no network in new src/ext code; reuse annotated `spawnAgent` (§5.4) |
| PREVENT-DIST-001 | error | — | no tarball/symlink; version bump via `scripts/deploy.sh` only (§9) |
| PREVENT-PI-004 | critical | — | local spawn only, annotated |

Gate must pass: `npm run guardrails` (pattern scan) + `python3 scripts/regression_check.py --all`
(no new failures registered for this sprint's patterns).

---

## 8. Test matrix

| # | Test | File | Layer |
|---|---|---|---|
| 1 | `shouldRetry` matrix: `kind × attempt × policy` (disabled, caps 0/1/3, `on` list) | `scripts/smoke-src/29-auto-compact-retry.mjs` | src |
| 2 | `computeDropRange` anchor floor (last N kept) + tool-pair walk-back (PREVENT-ITH-001/002) | `smoke-src/29` + `src/boundary.ts` | src |
| 3 | `snapshotWindowPressure` bands + `overThreshold` + null tokens | `smoke-src/29` | src |
| 4 | `isContextWindowError` / `detectContextWindowFailure` markers | `smoke-src/29` + `src/context-error.ts` | src |
| 5 | `buildContinuationSummary`: keeps recent N verbatim, embeds original task, does **not** drop a tool result without its call | `smoke-src/29` | src |
| 6 | `resolveRetryPolicy` clamping (maxRetries∈[0,3], defaults) | `smoke-src/29` (`team` export) | src |
| 7 | `planRetry`: rebuilds compacted task + bumps attempt; viability guard returns uncompacted when still over window | `smoke-src/29` | src |
| 8 | `worker-status` `"retrying"` transitions (working→retrying, retrying→working/done/failed) + `toAgentStatus("retrying")==="working"` | `scripts/smoke-src/28-worker-status.mjs` + `src/worker-status.test.ts` | src |
| 9 | `IthStore.recordRetryAttempt` / `getRetryAttempts` / `retryCount` roundtrip | `smoke-src/29` (`IthStore` export) | src |
| 10 | **Integration:** mock child fails once with context-window marker → exactly ONE fresh respawn with continuation summary → final success; `endLive` fires once | `scripts/smoke-ext.mjs` (new `smoke-extensions/dispatch-retry.mjs`) | ext |
| 11 | Agent frontmatter `retry_enabled`/`retry_max` parses to `AgentConfig.retry` | `smoke-extensions/agents.mjs` (existing) | ext |
| 12 | Card renders `↻ retrying (attempt n/N)` for a `"retrying"` snapshot | `smoke-extensions/card.mjs` (existing) or unit | ext |

**Smoke harness wiring (`scripts/smoke-src/_harness.mjs`):** import + export the
new modules so `smoke-src/29` can consume them:
```js
export const windowPressure = await import(join(buildDir, "window-pressure.ts"));
export const contextError   = await import(join(buildDir, "context-error.ts"));
export const autoCompact    = await import(join(buildDir, "auto-compact.ts"));
export const boundary       = await import(join(buildDir, "boundary.ts"));
```
**`scripts/smoke-src.mjs`:** add `import * as s29 from "./smoke-src/29-auto-compact-retry.mjs";`
and `await s29.run(ctx);` (in dependency order, after s28).

> Note: `scripts/smoke-ext.mjs` convention must be read before coding the
> integration test (harness exports/import style). The retry decision itself
> (`shouldRetry`/`planRetry`/`buildContinuationSummary`) is fully covered at the
> src layer (rows 1–9); the ext test (row 10) validates the dispatch wiring with
> an injected `spawnImpl` (the existing `spawnAgent` test seam).

---

## 9. Gate commands

```bash
npm run build                 # tsc -p tsconfig.json (type-check only)
npm run lint                  # tsc --noEmit
node --experimental-strip-types scripts/smoke-src.mjs   # includes new s29
node --experimental-strip-types scripts/smoke-ext.mjs   # dispatch-retry integration
npm run guardrails            # scripts/guardrails-scan.mjs (PREVENT-* pattern scan)
python3 scripts/regression_check.py --all
npm run semantic              # semantic-scan.mjs
npm run schema-health         # schema-health-check.mjs (new ith_retries table)
npm run gate                  # runs all of the above
```
All must pass before commit (CLAUDE.md §3 + `docs/AGENT_GUARDRAILS.md`).

---

## 10. Risks & rollback

| Risk | Mitigation |
|---|---|
| Restructuring `execute()` `finally` double-fires `endLive` | `finalized` flag (§5.4) — `endLive` runs exactly once; card + `dispatchEnded` stay in `finally`. |
| `"retrying"` transition silently refused by `canTransition` | add `retrying` rows to `TRANSITIONS` (§4.3) **and** verify in `smoke-src/28` before wiring dispatch. |
| Infinite retry loop | `shouldRetry` strictly bounds on `maxRetries` (cap 3) + `policy.enabled`; viability guard stops doomed retries. |
| Reuses failed child session (claw-code PR #4 bug) | Each retry is a **fresh `spawnAgent`** with a rebuilt prompt from durable state — never re-handles the dead child. |
| Compaction still over window → futile retry | `planRetry` viability check (§3.4) short-circuits. |
| Overlay key churn across attempts | `dispatchId` is **stable** for the whole dispatch (§5.4); retry child events keep updating the same live card. |
| `endLive` misclassifies final failure | pass `lastStatus: getLive(dispatchId)?.status` to `classifyFailure` in the retry decision. |
| Rollback | every change is a focused commit; `git checkout HEAD -- <file>` per file. DB migration is additive (`CREATE TABLE IF NOT EXISTS` + idempotent `migrateSchema`) — no destructive alter. |

---

## 11. Commit sequence (focused, one logical unit per commit)

1. **`src/` logic** — `types.ts` (`RetryPolicy`), `events.ts` (`"retrying"`),
   `worker-status.ts` (transitions + marker import), `team.ts`
   (`resolveRetryPolicy`), new `window-pressure.ts` / `context-error.ts` /
   `boundary.ts` / `auto-compact.ts`. → run `build` + `guardrails` + `smoke-src`.
2. **`src/store.ts`** — `ith_retries` table + methods. → `smoke-src` + `schema-health`.
3. **`extensions/ithacus-live.ts` + `ithacus-live-card.ts`** — `retrying` status,
   attempt counter, `↻ retrying (attempt n/N)` render. → `guardrails` + ext smoke.
4. **`extensions/ithacus-agents.ts`** — `retry?` frontmatter parse. → ext smoke.
5. **`extensions/ithacus-dispatch.ts`** — retry loop wiring (the integration). →
   full `smoke-ext` + `guardrails` + `regression`.
6. **`extensions/ithacus-commands.ts`** (optional) — fleet attempts view.
7. **Patch bump** `0.6.0 → 0.6.1` via `bash scripts/deploy.sh` (auto patch) +
   `npm run gate` green. Single PATCH step per sprint (CLAUDE.md §3).

---

## 12. Summary (10 lines)

- **Goal:** on `context_window` child failure, rebuild a compacted continuation
  from durable state and re-spawn a fresh child (max 1 retry, cap 3) — never the
  claw-code PR #4 bug.
- **4 new `src/` files:** `window-pressure.ts` (snapshot), `context-error.ts`
  (markers/classifier), `boundary.ts` (PREVENT-ITH-001/002 `computeDropRange`),
  `auto-compact.ts` (`shouldRetry`/`planRetry`/`buildContinuationSummary`).
- **Edits:** `types.ts` (`RetryPolicy`), `events.ts` (`"retrying"`),
  `worker-status.ts` (transitions + import markers), `team.ts`
  (`resolveRetryPolicy`), `trim.ts` (additive `windowPressure`/`safeDropMessages`),
  `store.ts` (`ith_retries` + methods).
- **Extensions:** `ithacus-live.ts`/`live-card.ts` (`retrying ↻ attempt n/N`),
  `ithacus-agents.ts` (`retry:` frontmatter), `ithacus-dispatch.ts` (retry loop,
  `endLive` once via `finalized` flag), optional `ithacus-commands.ts`.
- **Non-breaking:** success path unchanged; `startLive`/dispatch signature stable;
  `dispatchId` stable across attempts (overlay coherent).
- **Guardrails:** ITH-001/002 honored via `computeDropRange` anchor+tool-pair
  walk-back; ITH-003 (task text, not system role); ITH-004/PI-004 (no network,
  reuse annotated local spawn).
- **Tests:** `smoke-src/29` (policy/summary/boundary/pressure/store) +
  `smoke-src/28` (`"retrying"` transitions) + `smoke-ext` dispatch-retry
  integration (fail-once → one fresh respawn → success).
- **Gate:** `build`, `lint`, `smoke-src`, `smoke-ext`, `guardrails`,
  `regression`, `semantic`, `schema-health`, `gate`.
- **Risks:** `endLive` double-fire (flagged), transition refusal (tested first),
  infinite retry (bounded + viability guard), session reuse (fresh spawn).
- **Commits:** focused src → store → live/card → agents → dispatch → commands →
  patch bump `0.6.0 → 0.6.1`; rollback per-file `git checkout HEAD -- <file>`.
