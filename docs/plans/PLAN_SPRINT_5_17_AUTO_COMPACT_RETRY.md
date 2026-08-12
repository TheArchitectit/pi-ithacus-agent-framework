# Plan — Sprint 5.17: Dispatch Resilience

> **Source spec:** `docs/DESIGN_AUTO_COMPACT_RETRY.md` (read in full).
> **Expanded scope:** subsumes **backlog #54** (per-agent + global model fallback
> chain, failure-class-aware routing) and transient-failure retry/backoff
> (`rate_limit`, `network` blips on spawned sub-agent provider calls).
> **Status:** Plan only — no source written. Follows `CLAUDE.md` +
> `docs/AGENT_GUARDRAILS.md` (Four Laws; `src/` stays pi-agnostic; zero network
> at runtime — `PREVENT-ITH-004`).

---

## 0. Scope reconciliation (design doc vs backlog #54 vs repo reality)

| Item | Design doc (`DESIGN_AUTO_COMPACT_RETRY`) | Backlog #54 | Reality in repo | Decision |
|---|---|---|---|---|
| Retry trigger | `context_window` (+ `crash`) | `rate_limit`, `auth`, `network` | `classifyFailure` only knows `context_window\|permission_denied\|timeout\|crash\|unknown` | **Extend `WorkerFailureKind`** with `rate_limit`, `network`, `auth`; add detection markers. |
| `RetryPolicy.on` | `["context_window","crash"]` | a broader kind set | typed as union in design only | **`RetryPolicy.on: WorkerFailureKind[]`** (open-ended). Default `["context_window","rate_limit","network"]`. |
| `WorkerStatus += "retrying"` | "added with 5.14" | — | **not present** (lives in `src/events.ts`, not `types.ts`) | **Add to `src/events.ts`** + `TRANSITIONS` + `toAgentStatus`. |
| Model fallback chain | implicit (config `fallbackModels`) | explicit ordered per-agent + global chain, failure-aware routing | `team.ts:buildModelChain` already appends `fallbackModels` (deduped) | **Build `ModelFallbackChain`** from per-agent + global + default; route by kind. |
| Auto-compact rebuild | `checkpoint.ts buildSummary()` over child progress | — | `buildSummary` takes `ConversationMessage[]`, not live progress | New `buildContinuationSummary(LiveProgress, originalTask)` (§4.4). |
| Backoff | none | bounded retry w/ backoff for transient | none | **New `BackoffPolicy`** + pure `computeBackoff`; sleep in extension layer. |
| `src/parallel.ts` | — | — | parallel tool-batch executor (single response) | **OUT OF SCOPE** — unrelated to spawned-sub-agent dispatch resilience. No changes. |

**Single canonical loop:** extraction of the retry+fallback+auto-compact loop into
`extensions/ithacus-retry.ts` (`dispatchWithResilience`), so `ithacus-dispatch.ts`
(single dispatch) **and** `ithacus-team.ts`/`ithacus-swarm.ts` (team/swarm
children) share one resilient spawn path. `src/` holds only **pure, testable**
policy (no `spawnAgent` import → pi-agnostic); `extensions/` holds the
`spawnAgent` orchestration + audit logging.

---

## 1. Goal / Non-Goals

**Goal.** A dispatched sub-agent child `pi` process that fails is recovered
transparently and *durably*:

1. **Auto-compact (A):** on `context_window`, rebuild a compacted continuation
   from durable state (live-progress store + original task) and re-spawn a
   **fresh** child with that rebuilt prompt — never reuse the failed child's
   session (the claw-code PR #4 bug we explicitly avoid).
2. **Transient retry (B):** on `rate_limit`/`network`, bounded retry with
   exponential backoff (same model; the throttle/blip clears).
3. **Model fallback chain (#54):** on failure, advance through an ordered
   per-agent + global fallback chain, routing by failure class
   (`context_window`→bigger-window model; `rate_limit`→different provider;
   `auth`→skip to next). Capped at `maxHops` (2–3). Every hop logged.

**Non-goals.** Retry on `permission_denied`/`trust_required` (needs interactive
grant — future). Cross-run / global retry budgets (per-dispatch only).
Modifying pi's native durable-trim (`ctx.compact()`) behavior. Parallel
tool-batch execution (`src/parallel.ts`).

---

## 2. Failure classification enum + routing logic

### 2.1 `WorkerFailureKind` (extend `src/events.ts`)

```ts
export type WorkerFailureKind =
  | "context_window"   // ran out of context        → compact + bigger-window model
  | "permission_denied"// trust/tool permission never granted → STOP (interactive)
  | "timeout"          // exceeded maxRuntimeMs      → backoff retry
  | "crash"            // child process died on boot → backoff retry (per policy.on)
  | "rate_limit"       // 429 / quota                → backoff, else alt-provider hop
  | "network"          // ECONNRESET/ETIMEDOUT/...   → backoff transient retry
  | "auth"             // 401/403/invalid key        → skip to next hop
  | "unknown";         // honestly unknown           → STOP (never guess)
```

### 2.2 Detection markers — `src/failure-kind.ts` (NEW, pure, pi-agnostic)

One owner for all marker sets (worker-status delegates to it — removes the
local `CONTEXT_WINDOW_MARKERS` duplicate and adds the new transient kinds):

```ts
export const CONTEXT_WINDOW_MARKERS: readonly RegExp[]; // existing set (kept)
export const RATE_LIMIT_MARKERS:  readonly RegExp[]; // /429/i, /rate.?limit/i, /too many requests/i, /quota/i, /rate.?limit exceeded/i
export const NETWORK_MARKERS:     readonly RegExp[]; // /econnreset/i, /etimedout/i, /enotfound/i, /fetch failed/i, /socket hang up/i, /connection refused/i, /network error/i, /dns/i
export const AUTH_MARKERS:        readonly RegExp[]; // /\b401\b/, /\b403\b/, /unauthorized/i, /forbidden/i, /invalid api key/i, /authentication failed/i, /api key/i(limited)
export const TIMEOUT_MARKERS:     readonly RegExp[]; // /timed out/i, /deadline/i, /maxruntime/i

export interface FailureSignals {
  exitCode?: number;
  timedOut?: boolean;
  lastStatus?: WorkerStatus;
  stderrTail?: string;
  outputTail?: string;
}

/** Full classifier → WorkerFailureKind. Precedence (most-specific first):
 *  timeout(timedOut) > still-blocked→permission_denied > auth > rate_limit >
 *  network > context_window > crash > unknown. */
export function classifyFailureKind(s: FailureSignals): WorkerFailureKind;
```

**Non-breaking edit to `src/worker-status.ts`:** delete the local
`CONTEXT_WINDOW_MARKERS` + the inline `classifyFailure` tail; import
`classifyFailureKind` and re-export a thin `classifyFailure(s)` that calls it
(so `endLive` and `ithacus-dispatch` keep working unchanged). Marker sets have
one owner.

> **Risk G5 (marker false-positives):** e.g. "401" appearing in benign output.
> Mitigation: anchor numeric codes (`\b401\b`), prefer whole phrases
> (`invalid api key`), and scan only the **tail slices** (`stderrTail`/
> `outputTail`, last ~512 chars) like `context_window` already does. Tests assert
> that ordinary prose does **not** misclassify.

### 2.3 Routing logic — `src/model-fallback.ts` (NEW)

```ts
export type FallbackAction =
  | { type: "compact_retry_same"; reason: string }   // transient: backoff + SAME model, rebuild compacted task
  | { type: "advance"; hop: ModelFallbackHop; reason: string } // swap model/provider (per failure class)
  | { type: "stop"; reason: string };                // exhausted / non-retriable

export function routeFallback(opts: {
  kind: WorkerFailureKind;
  chain: ModelFallbackChain;
  currentHopIndex: number;   // index of the model that just failed
  attempt: number;           // attempts already made (0-based)
  policy: RetryPolicy;
}): FallbackAction;
```

Routing table (applied per failed attempt; stops when `attempt >= maxAttempts`
or `currentHopIndex >= maxHops` or `action === "stop"`):

| `kind` | Action | Reason template |
|---|---|---|
| `context_window` | `advance` to next hop (prefer one tagged `"big-window"`; else next hop) **+** the caller ALSO rebuilds the compacted task (auto-compact). If no next hop → `stop`. | `context_window: bigger-window model` / `context_window: no larger-window fallback` |
| `rate_limit` | if a hop with a **different provider** exists later in `chain` → `advance` to it (`rate_limit: different provider`). Else `compact_retry_same` (backoff; throttle clears). | — |
| `network` | `compact_retry_same` (transient blip; backoff). | `network: transient, backing off` |
| `auth` | `advance` to next hop (`auth: skipping to next model/provider`). Same creds will keep failing. | — |
| `timeout` | `compact_retry_same` (backoff). | `timeout: backoff retry` |
| `crash` | `compact_retry_same` (fresh spawn already avoids the dead child) — only if `policy.on` includes `"crash"`. | `crash: fresh respawn` |
| `permission_denied` | `stop` (needs interactive grant). | `permission_denied: interactive grant required` |
| `unknown` | `stop` (never guess — worker-status philosophy). | `unknown: no retry` |

`compact_retry_same` ⇒ the caller applies `BackoffPolicy` (sleep) before the
re-spawn; `advance` ⇒ caller swaps `model`/`provider` from `hop` and (for
`context_window`) also rebuilds the compacted task.

---

## 3. Fallback chain data structure + config schema

### 3.1 Types — `src/types.ts` (add)

```ts
export type FallbackTag = "big-window" | "alt-provider" | "cheaper" | "faster";

export interface ModelFallbackHop {
  /** May be provider-prefixed: "plexus/claude-…" (resolved via provider-resolver). */
  model: string;
  /** Optional explicit provider pin (overrides model-prefix resolution). */
  provider?: string;
  /** Routing hints so failure-aware selection can pick the right hop. */
  tags?: FallbackTag[];
}

export interface ModelFallbackChain {
  hops: ModelFallbackHop[];  // ordered; index 0 = resolved primary model
  maxHops: number;           // distinct models tried; default 2, hard cap 3
}

export interface BackoffPolicy {
  baseMs: number;   // default 500
  factor: number;   // default 2 (exponential)
  maxMs: number;    // default 30000 (cap)
  jitter: boolean;  // default true (±50%)
}

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;          // total attempts = 1 + maxRetries; default 1, hard cap 3
  on: WorkerFailureKind[];     // which kinds trigger a retry/fallback hop
  backoff?: BackoffPolicy;     // transient backoff schedule
}
```

### 3.2 Config schema — `src/config.ts` (additive, non-breaking)

`IthacusConfig` gains optional fields (defaults preserve today's behavior):

```ts
/** Richer global fallback chain (optional). When present it REPLACES the
 *  flat `fallbackModels` semantics for global hops. */
modelFallbackChain?: ModelFallbackHop[];
/** Distinct-model cap (per-agent overrides). default 2, clamp [1,3]. */
maxFallbackHops: number;
/** Global default retry policy (per-agent frontmatter overrides). */
retryPolicy?: RetryPolicy;
/** Global default backoff (per-agent overrides). */
backoffPolicy?: BackoffPolicy;
```

`loadConfig` parsing (env, all optional — backward compatible; existing
`ITHACUS_FALLBACK_MODELS` keeps working, now treated as flat global hops):
- `ITHACUS_MAX_FALLBACK_HOPS` → `maxFallbackHops` (clamp [1,3], default 2).
- `ITHACUS_RETRY_MAX` / `ITHACUS_RETRY_ON` (comma list) → `retryPolicy` (default
  `{ enabled:true, maxRetries:1, on:["context_window","rate_limit","network"] }`).
- `ITHACUS_BACKOFF_BASE_MS` / `_FACTOR` / `_MAX_MS` → `backoffPolicy`.
- `ITHACUS_FALLBACK_MODELS=a,b,c` → each entry becomes
  `ModelFallbackHop{ model }`; honors `provider/` prefix on each entry.

### 3.3 Per-agent frontmatter — `extensions/ithacus-agents.ts`

`AgentConfig` gains:

```ts
fallback?: { models?: string[]; maxHops?: number }; // per-agent chain
retry?: RetryPolicy;                                 // per-agent override
```

Flat frontmatter keys (matches the existing one-per-line parser):
`fallback_models: a, b, c`, `fallback_max_hops: 2`, `retry_enabled: true`,
`retry_max: 2`, `retry_on: context_window,rate_limit,network`,
`backoff_base_ms: 500`. `validateAgentFile` allowlist unchanged (no new
**required** keys). The `validateAgentFile` tool-allowlist sync in
`agent-bundles.ts` is unaffected.

### 3.4 Chain resolution — `src/team.ts` (extend, non-breaking)

```ts
import type { ModelFallbackChain, ModelFallbackHop, RetryPolicy, BackoffPolicy } from "./types.js";

export const DEFAULT_RETRY_POLICY: RetryPolicy =
  { enabled: true, maxRetries: 1, on: ["context_window","rate_limit","network"] };
export const DEFAULT_BACKOFF: BackoffPolicy =
  { baseMs: 500, factor: 2, maxMs: 30000, jitter: true };

/** Per-agent frontmatter retry override (clamped). Missing ⇒ base/default. */
export function resolveRetryPolicy(fm?: RetryPolicy | null, base?: RetryPolicy): RetryPolicy;
export function resolveBackoffPolicy(fm?: BackoffPolicy | null, base?: BackoffPolicy): BackoffPolicy;

/** Build the ordered fallback chain:
 *   [ resolved primary (resolveAgentModel/explicit→subagent→provider→default) ]
 *   ++ per-agent fallback_models (frontmatter)
 *   ++ global config fallbackModels / modelFallbackChain
 *   dedupe by model+provider; clamp hops to [1,3] via maxFallbackHops. */
export function resolveModelFallbackChain(opts: {
  explicit?: string | null;
  resolved: ResolvedModel;
  perAgentFallback?: string[];
  configFallback?: ModelFallbackHop[];
  maxHops?: number;
}): ModelFallbackChain;
```

`resolveModelFallbackChain` reuses today's `buildModelChain` ordering (primary
first, then `fallbackModels`, deduped) and just adds the per-agent list +
provider-prefix awareness + `maxHops` clamp. **`buildModelChain` stays** as the
low-level primitive; `resolveModelFallbackChain` is the #54 entry point.

> **Risk G6 (how do we know a hop is "bigger-window"?):** there is **no**
> model→context-window registry. Resolution: the chain **order encodes user
> intent** (list bigger-window models earlier), plus optional `"big-window"`
> tag on a hop. `routeFallback` prefers a later hop tagged `"big-window"` for
> `context_window`. Optional future: a small static `KNOWN_MODELS` map in
> `src/` (model id → contextWindow) to auto-sort; **out of scope this sprint**.

---

## 4. New `src/` pure modules (pi-agnostic, zero deps, Node built-ins only)

### 4.1 `src/failure-kind.ts` — markers + classifier (§2.2)
See §2.2. Pure; owns all `CONTEXT_*_MARKERS` + `classifyFailureKind`.

### 4.2 `src/retry.ts` — pure retry/backoff policy (the spec's `src/retry.ts`)
```ts
import type { RetryPolicy, BackoffPolicy, WorkerFailureKind } from "./types.js";

/** attempt = attempts ALREADY made (0-based). */
export function shouldRetry(kind: WorkerFailureKind, attempt: number, policy: RetryPolicy): boolean;
//   policy.enabled && policy.on.includes(kind) && attempt < clamp(policy.maxRetries,0,3)

/** Pure backoff delay (ms) for the NEXT transient attempt. No timers here
 *  (src is unit-testable); the actual sleep lives in extensions. */
export function computeBackoff(schedule: BackoffPolicy, attempt: number, rng?: () => number): number;
//   delay = min(maxMs, baseMs * factor^attempt); if jitter: * (0.5..1.5) via rng
```
`shouldRetry` already exists conceptually in the old plan; here it is generalized
to the open `WorkerFailureKind[]` set. `computeBackoff` is new + pure (testable).

### 4.3 `src/boundary.ts` — PREVENT-ITH-001 / PREVENT-ITH-002 enforcement ⚠
Canonical helper the guardrails whitelist (`computeDropRange` / `dropBefore` /
`keepRecent` / `anchor`) expects; **every** message-drop path in `src/`/`extensions/`
must route through these names (never a bare `messages.slice(0, N)` without anchor
logic, never `keep_from`/`dropStart`/`safeDrop` misnamed).

```ts
export interface MessageLike { role: string; content?: string; [k: string]: unknown; }
export interface ComputeDropRangeOpts {
  keepRecent?: number;                    // anchor floor (PREVENT-ITH-001)
  isAnchor?: (m: MessageLike) => boolean;
  isToolResult?: (m: MessageLike) => boolean; // PREVENT-ITH-002
  isToolUse?: (m: MessageLike) => boolean;    // PREVENT-ITH-002 pairing
}
export interface DropRange { dropBefore: number; anchorUserMessages: string[]; keptTail: number; }

/** Walk boundary BACK if first kept msg is a ToolResult with no ToolUse before it;
 *  never drop the anchor floor (last keepRecent turns). */
export function computeDropRange(messages: MessageLike[], opts?: ComputeDropRangeOpts): DropRange;
export function dropBefore(messages: MessageLike[], dropBefore: number, anchorUserMessages: string[]): MessageLike[];
```

### 4.4 `src/auto-compact.ts` — auto-compact rebuild (spec's `src/retry.ts` body)
```ts
import type { WorkerFailureKind } from "./events.js";
import { estimateTokens } from "./checkpoint.js";
import { computeDropRange } from "./boundary.js";

/** Minimal progress snapshot the extension adapts from AgentLive. */
export interface LiveProgress {
  agent: string; model?: string;
  recentTools: Array<{ tool: string; args: string }>;
  toolCallCount: number; tokensIn: number; tokensOut: number;
  filesAccessed: string[]; taskPreview?: string;
}

export interface ContinuationArgs {
  live: LiveProgress;
  originalTask: string;          // NEVER the compacted one
  keepRecent?: number;           // default config.preserveRecent (anchor floor)
  maxBullets?: number;
  failureKind?: WorkerFailureKind;
}

/** Builds `[continuation] <summary>\n\n<remaining task>` — the rebuilt prompt. */
export function buildContinuationSummary(args: ContinuationArgs): string;

export interface RetryPlan { task: string; attempt: number; }
export interface PlanRetryArgs {
  dispatchId: string; agent: string; originalTask: string; attempt: number;
  policy: RetryPolicy; live: LiveProgress; failureKind: WorkerFailureKind;
  contextWindow?: number; keepRecent?: number;
}
export function planRetry(args: PlanRetryArgs): RetryPlan;
```
Behavior (unchanged from prior plan, retained here):
- Keeps the last `keepRecent` tool calls **verbatim** (anchor floor, ITH-001);
  always embeds `originalTask` unchanged; one bullet per earlier tool, capped by
  `maxBullets`. Tool entries atomic (call+result together → ITH-002).
- `planRetry` calls `buildContinuationSummary`, then a **viability guard**:
  if `estimateTokens(summary) > contextWindow` the compaction bought nothing →
  returns the uncompacted `originalTask` (so `shouldRetry`'s cap prevents a
  doomed retry). Clamps `attempt` to `[0,3]`.

### 4.5 `src/window-pressure.ts` — window-pressure snapshot (NEW, additive)
```ts
import { effectiveThresholdTokens, pressureRatio, pressureBand, type PressureBand } from "./config.js";
export interface WindowPressure {
  currentTokens: number; contextWindow: number; tierPct: number; threshold: number;
  ratio: number; band: PressureBand; remaining: number; overThreshold: boolean;
}
export function snapshotWindowPressure(opts: {
  currentTokens: number | null; contextWindow: number; tierPct: number; bootFallback: number;
}): WindowPressure;
```
Used by `planRetry`'s viability check + the runtime dashboard (replaces the bare
`currentPressure` ratio). Non-breaking.

### 4.6 `src/model-fallback.ts` — fallback chain + routing (§2.3)
See §2.3. Pure `resolveModelFallbackChain` lives in `team.ts`; `routeFallback`
lives here (or in `team.ts` — either is fine; keep `routeFallback` in
`src/model-fallback.ts` to isolate routing from resolution). Holds
`FallbackAction`, `ModelFallbackChain` helpers, the routing table.

> Note: §3.4 put `resolveModelFallbackChain` in `team.ts` (reuses
> `buildModelChain`); `routeFallback`/`FallbackAction` live in `model-fallback.ts`.
> Both are `src/` pure. Pick one home for the chain *type* (`src/types.ts` per
> §3.1) and import it everywhere.

---

## 5. Edits to existing `src/` files

| File | Change |
|---|---|
| `src/types.ts` | Add `FallbackTag`, `ModelFallbackHop`, `ModelFallbackChain`, `BackoffPolicy`, `RetryPolicy` (§3.1). |
| `src/events.ts` | Add `"retrying"` to `WorkerStatus`; add `"rate_limit"\|"network"\|"auth"` to `WorkerFailureKind`. |
| `src/worker-status.ts` | `TRANSITIONS`: add `"retrying"` source row `[retrying,working,done,failed]` + append `"retrying"` to `spawning`/`working`/`failed` targets. `toAgentStatus`: `"retrying" → "working"`. Delete local `CONTEXT_WINDOW_MARKERS`; `classifyFailure` delegates to `classifyFailureKind` (re-export thin wrapper). |
| `src/failure-kind.ts` | NEW (§2.2). |
| `src/retry.ts` | NEW (§4.2). |
| `src/boundary.ts` | NEW (§4.3). |
| `src/auto-compact.ts` | NEW (§4.4). |
| `src/window-pressure.ts` | NEW (§4.5). |
| `src/model-fallback.ts` | NEW (§2.3 / §4.6). |
| `src/team.ts` | Add `resolveRetryPolicy`, `resolveBackoffPolicy`, `resolveModelFallbackChain`, `DEFAULT_RETRY_POLICY`, `DEFAULT_BACKOFF` (§3.4). `buildModelChain` unchanged. |
| `src/config.ts` | Additive config fields + env parsing (§3.2). |
| `src/trim.ts` | Additive only: `windowPressure()` (delegates to `window-pressure.ts`) + `safeDropMessages()` (delegates to `boundary.ts`) for the dashboard/runtime. `decideTrim`/`currentPressure`/`detectBoundaryConflict`/`preserveHeadTail` untouched. |
| `src/store.ts` | Additive `ith_retries` table + methods (§7). |

---

## 6. Extension wiring (dispatch path) — the integration

### 6.1 `extensions/ithacus-retry.ts` — `dispatchWithResilience` (NEW, Tier L, zero network)
The shared resilient spawn loop. Orchestrates `spawnAgent` (which already
carries the `PREVENT-ITH-004`/`PREVENT-PI-004` annotation — no new network),
applies auto-compact + fallback + backoff, and writes the audit trail.

```ts
import { spawnAgent } from "./ithacus-spawn.js";
import type { SpawnAgentOpts, SpawnAgentResult } from "./ithacus-spawn.js";
import { setWorkerStatus, markRetry, getLive } from "./ithacus-live.js";
import type { IthRuntime } from "./ithacus-runtime.js";
import type { IthacusConfig, ModelFallbackChain, RetryPolicy } from "../src/types.js";
import { shouldRetry, computeBackoff, DEFAULT_BACKOFF } from "../src/retry.js";
import { routeFallback, type FallbackAction } from "../src/model-fallback.js";
import { buildContinuationSummary, type LiveProgress } from "../src/auto-compact.js";
import { classifyFailureKind } from "../src/failure-kind.js";

export interface RetryHopRecord {        // audit trail per hop
  index: number; kind: string; action: FallbackAction["type"];
  fromModel?: string; fromProvider?: string; toModel?: string; toProvider?: string;
  reason: string; compacted: boolean; success: boolean; durationMs: number;
}

export interface DispatchResilienceOpts {
  dispatchId: string; agent: string; task: string;     // original task kept across attempts
  model?: string; provider?: string; cwd?: string; tools?: string[];
  signal?: AbortSignal;
  onProgress?: SpawnAgentOpts["onProgress"];
  runtime?: IthRuntime; config: IthacusConfig;
  chain: ModelFallbackChain; policy: RetryPolicy;
  /** adapter live store → src LiveProgress (passed in to keep src/ agnostic). */
  toLiveProgress: (id: string) => LiveProgress | undefined;
}

export interface ResilienceResult {
  result: SpawnAgentResult;
  attempts: RetryHopRecord[];
  totalAttempts: number;
  finalModel?: string; finalProvider?: string;
}

/** AbortSignal-aware sleep (timers live HERE, not in src/). */
function sleep(ms: number, signal?: AbortSignal): Promise<void>;

export async function dispatchWithResilience(opts: DispatchResilienceOpts): Promise<ResilienceResult>;
```

Loop pseudocode (single `dispatchId` across all attempts; fresh child every time):

```
let attempt = 0; let task = opts.task;
let hopIndex = 0;                 // index into chain.hops (0 = primary)
let current = { model: opts.model, provider: opts.provider };
const attempts: RetryHopRecord[] = [];
let res: SpawnAgentResult;
while (true) {
  const t0 = Date.now();
  res = await spawnAgent({ agent, task, model: current.model, provider: current.provider,
                           cwd, tools, signal, onProgress });
  const kind = res.success ? null
    : classifyFailureKind({ exitCode: res.exitCode,
        stderrTail: res.stderr?.slice(-512), outputTail: res.output?.slice(-512),
        lastStatus: getLive(opts.dispatchId)?.status });
  if (res.success) { record hop success; break; }
  if (!shouldRetry(kind!, attempt, policy)) { record hop stop; break; }

  const action = routeFallback({ kind: kind!, chain, currentHopIndex: hopIndex, attempt, policy });
  if (action.type === "stop") { record hop stop; break; }

  // RETRY BRANCH — fresh child, durable-state rebuild
  attempt++;
  setWorkerStatus(opts.dispatchId, "retrying");
  markRetry(opts.dispatchId, attempt, policy.maxRetries);
  let nextModel = current.model, nextProvider = current.provider, compacted = false;
  let reason = action.reason;
  if (action.type === "advance") {
    hopIndex = nextHopIndex(chain, hopIndex, kind!);   // pick the right next hop
    nextModel = chain.hops[hopIndex].model;
    nextProvider = chain.hops[hopIndex].provider ?? resolveProviderPrefix(chain.hops[hopIndex].model);
  } else { // compact_retry_same
    if (kind === "context_window") {
      const live = opts.toLiveProgress(opts.dispatchId);
      task = buildContinuationSummary({ live: live!, originalTask: opts.task,
                keepRecent: opts.config.preserveRecent });
      compacted = true;
    }
    // rate_limit/network/timeout: same model, backoff first
    const backoff = computeBackoff(policy.backoff ?? DEFAULT_BACKOFF, attempt);
    await sleep(backoff, signal);   // abort-aware
  }
  auditRetry({ dispatchId, agent, attempt, kind, action,
               fromModel: current.model, fromProvider: current.provider,
               toModel: nextModel, toProvider: nextProvider, compacted, runtime });
  current = { model: nextModel, provider: nextProvider };
  record hop;
  if (attempt >= 1 + policy.maxRetries) break;       // hard cap
  if (hopIndex >= chain.maxHops) break;             // distinct-model cap
}
return { result: res, attempts, totalAttempts: attempt + 1, finalModel: res.model, finalProvider: res.provider };
```

Invariants enforced:
- **Fresh child every attempt** — `spawnAgent` is a new subprocess each loop; the
  compacted context is rebuilt from durable state (`LiveProgress` + `originalTask`),
  never from the dead child's session (claw-code PR #4 bug avoided).
- **Single `dispatchId`** for the whole dispatch → overlay stays coherent
  (`markRetry` updates the same card).
- **`endLive` fires exactly once** in the caller (`finalized` flag, §6.2).
- **Continuation prepended to `task`** (UserMessage-equivalent), **never**
  `role:"system"` (PREVENT-ITH-003 ✓).
- **AbortSignal** honored through `sleep` + passed to `spawnAgent`.

### 6.2 `extensions/ithacus-dispatch.ts` — delegate to the loop (CORE change)
Restructure `execute()` **without** changing the success path or
`registerDispatchTool` signature:

- Before the loop: `const policy = resolveRetryPolicy(agentCfg?.retry, config.retryPolicy ?? DEFAULT_RETRY_POLICY);`
  `const chain = resolveModelFallbackChain({ explicit: params.model, resolved, perAgentFallback: agentCfg?.fallback?.models, configFallback: config.modelFallbackChain, maxHops: agentCfg?.fallback?.maxHops ?? config.maxFallbackHops });`
- `startLive(dispatchId, agentType, params.model, taskPreview, 0, policy.maxRetries);` (add attempt/retryMax args — non-breaking).
- Replace the single `res = await spawnAgent({…})` with:
  `const r = await dispatchWithResilience({ dispatchId, agent: agentType, task: params.task, model: params.model, provider: params.provider, cwd, tools: effectiveTools, signal, onProgress, runtime, config, chain, policy, toLiveProgress: (id) => toLiveProgress(getLive(id)) }); res = r.result;`
- `finally { if (!finalized) { endLive(dispatchId, res?.success ?? false, res?.error, { exitCode, stderrTail, outputTail }); finalized = true; } cardRef.current?.markDone(); runtime?.dispatchEnded(agentType); writeDispatchCompletion(runtime, { …retryMeta: r }); }`
- `toLiveProgress(live): LiveProgress` — tiny local adapter (`src/auto-compact.ts`'s
  only cross-boundary type).

### 6.3 `extensions/ithacus-team.ts` / `ithacus-swarm.ts` (optional stretch)
Replace their direct `spawnAgent({…})` calls with `dispatchWithResilience({…})`
so team/swarm children also get auto-compact + fallback + backoff. Low-risk:
same return shape (`SpawnAgentResult`). **Marked optional** to keep sprint
surface bounded; the single-dispatch path (§6.2) is mandatory.

### 6.4 `extensions/ithacus-live.ts`
- `AgentLive` add `attempt?: number; retryMax?: number;`.
- `startLive(id, agent, model?, taskPreview?, attempt?, retryMax?)` — extra
  optional args (non-breaking defaults `0`/`undefined`).
- `markRetry(id, attempt, retryMax)` — sets fields, `notify()`. Called between attempts.
- `setWorkerStatus`/`endLive` unchanged (rely on edited `TRANSITIONS`).

### 6.5 `extensions/ithacus-live-card.ts`
- `STATUS_ROW` add `retrying: { icon: "↻", label: "retrying", color: "warning" }`.
- `render()`: when `snap.status === "retrying"` show
  `↻ retrying${snap.attempt && snap.retryMax ? ` (attempt ${snap.attempt}/${snap.retryMax})` : ""}`.

### 6.6 `extensions/ithacus-agents.ts`
- `AgentConfig.fallback?: { models?: string[]; maxHops?: number }`;
  `AgentConfig.retry?: RetryPolicy`.
- Frontmatter parser: read flat keys `fallback_models` / `fallback_max_hops` /
  `retry_enabled` / `retry_max` / `retry_on` / `backoff_base_ms` and assemble
  `fallback`/`retry`. Missing ⇒ `undefined`. `validateAgentFile` unchanged (no
  new required keys).

### 6.7 `extensions/ithacus-commands.ts` (optional, minimal)
`/ithacus-agents` fleet view: append attempts from `getLive(id)?.attempt` /
`store.retryCount(dispatchId)`.

---

## 7. Audit trail events (logged to `ith_events` = `events.log` via `runtime.appendEvent`)

| Event | Fields | When |
|---|---|---|
| `dispatch_start` | `{ agent }` | already emitted (unchanged) |
| `dispatch_retry` | `{ dispatchId, agent, attempt, kind, action: "compact"\|"fallback"\|"backoff", fromModel, fromProvider, toModel, toProvider, reason, compacted }` | every retry/fallback hop (in `auditRetry`) |
| `model_fallback` | `{ dispatchId, agent, hop, from, to, kind, reason }` | subset of `dispatch_retry` with `action:"fallback"` (kept for grep-ability of fallback-specific telemetry) |
| `dispatch_resolved` | `{ dispatchId, agent, success, totalAttempts, finalModel, finalProvider, kinds: string[] }` | at loop exit (one per dispatch) |
| `dispatch_end` | `{ agent }` | already emitted (unchanged) |

**`dispatch-completions/<id>.json`** (`writeDispatchCompletion`) enriched (non-breaking
additive keys):
```json
{
  "dispatchId": "…", "agent": "explore", "status": "success",
  "retryCount": 1,
  "attempts": [
    { "index": 0, "kind": "context_window", "action": "fallback",
      "fromModel": "claude-haiku-4-5", "toModel": "claude-sonnet-4-5",
      "reason": "context_window: bigger-window model", "compacted": true,
      "success": true, "durationMs": 1234 }
  ],
  "finalModel": "claude-sonnet-4-5", "finalProvider": "anthropic",
  "…": "existing fields unchanged"
}
```

**`ith_retries` sqlite table** (`src/store.ts`, additive — for fleet view):
```sql
CREATE TABLE IF NOT EXISTS ith_retries (
  dispatchId TEXT NOT NULL, agent TEXT NOT NULL, attempt INTEGER NOT NULL,
  failureKind TEXT NOT NULL, action TEXT NOT NULL,
  fromModel TEXT, toModel TEXT, reason TEXT, compacted INTEGER,
  startedAt INTEGER NOT NULL, durationMs INTEGER NOT NULL, retryOf INTEGER);
CREATE INDEX IF NOT EXISTS ix_ith_retries_dispatch ON ith_retries(dispatchId);
```
```ts
recordRetryAttempt(rec: {
  dispatchId: string; agent: string; attempt: number; failureKind: string;
  action: string; fromModel?: string; toModel?: string; reason: string;
  compacted: boolean; startedAt: number; durationMs: number; retryOf: number;
}): void;
getRetryAttempts(dispatchId: string): RetryAttemptRecord[];
retryCount(dispatchId: string): number;
```
Added to `migrateSchema()` (idempotent `CREATE TABLE IF NOT EXISTS`; no
destructive alter — safe rollback).

---

## 8. Honoring PREVENT-ITH-001 / 002 / 003 / 004

| Rule | How honored |
|---|---|
| **ITH-001** (anchor floor — preserve recent N) | `buildContinuationSummary` keeps last `keepRecent` tool calls **verbatim** + always embeds `originalTask`. Any prefix-drop uses `boundary.computeDropRange(..., { keepRecent, isAnchor })`/`dropBefore` (whitelisted names). Never a bare `messages.slice(0,N)` without anchor logic. |
| **ITH-002** (no split toolCall/result pair) | `LiveProgress.recentTools` entries are atomic (call+result captured together). When a message array is dropped, `computeDropRange` walks the boundary **back** if the first kept message is a ToolResult with no preceding ToolUse. Helper names (`computeDropRange`, `isToolUse`, `isToolResult`) are in the guardrails whitelist. |
| **ITH-003** | Continuation text prepended to `task` (UserMessage-equivalent), not a `system` role. |
| **ITH-004 / PI-004** | Zero network in new `src/`/`extensions/` code; retry reuses the annotated local `spawnAgent` (the only `// guardrails-allow` spawn). New `src/` files use only Node built-ins. |

---

## 9. Guardrails check (PREVENT-*)

| Rule | Severity | Applies? | How honored |
|---|---|---|---|
| PREVENT-ITH-001 | error | yes | §4.3 `computeDropRange`/`dropBefore` + §4.4 anchor floor + §8 |
| PREVENT-ITH-002 | error | yes | §4.3 boundary walk-back + atomic tool entries + §8 |
| PREVENT-ITH-003 | error | — | continuation is `task` text, not `role:"system"` (§6.1/6.2) |
| PREVENT-ITH-004 | critical | — | no network in new src/ext code; reuse annotated `spawnAgent` (§6.1) |
| PREVENT-DIST-001 | error | — | no tarball/symlink; version bump via `scripts/deploy.sh` only (§11) |
| PREVENT-PI-004 | critical | — | local spawn only, annotated; `sleep` is timers not network |

Gate must pass: `npm run guardrails` (pattern scan — confirms no `fetch(`/network
in new code, confirms drop-path uses whitelisted names) + `python3 scripts/regression_check.py --all`
(no new failures registered for this sprint's patterns).

---

## 10. Test matrix (smoke-src vs smoke-ext)

### smoke-src (pure `src/` decision logic — `node --experimental-strip-types`)
| # | Test | File |
|---|---|---|
| 1 | `shouldRetry` matrix: `kind × attempt × policy` (disabled, caps 0/1/3, `on` list) | `scripts/smoke-src/29-dispatch-resilience.mjs` |
| 2 | `computeBackoff`: base/factor/max/jitter determinism (seeded rng) | `smoke-src/29` (`retry` export) |
| 3 | `classifyFailureKind`: context_window/rate_limit/network/auth/timeout/permission/crash/unknown markers; benign prose does NOT misclassify | `smoke-src/29` (`failure-kind` export) + verify `worker-status.classifyFailure` delegates |
| 4 | `resolveModelFallbackChain`: ordering (primary→per-agent→global), dedupe by model+provider, `maxHops` clamp [1,3] | `smoke-src/29` (`team` export) |
| 5 | `routeFallback` actions per kind + hop exhaustion → `stop` | `smoke-src/29` (`model-fallback` export) |
| 6 | `buildContinuationSummary`: keeps recent N verbatim, embeds original task, does **not** drop a tool result without its call | `smoke-src/29` (`auto-compact` export) |
| 7 | `planRetry`: rebuilds compacted task + bumps attempt; viability guard returns uncompacted when still over window | `smoke-src/29` |
| 8 | `computeDropRange` anchor floor (last N kept) + tool-pair walk-back (ITH-001/002) | `smoke-src/29` (`boundary` export) |
| 9 | `snapshotWindowPressure` bands + `overThreshold` + null tokens | `smoke-src/29` (`window-pressure` export) |
| 10 | `WorkerStatus "retrying"` transitions (working→retrying, retrying→working/done/failed) + `toAgentStatus("retrying")==="working"` | `scripts/smoke-src/28-worker-status.mjs` + `src/worker-status.test.ts` |
| 11 | `IthStore.recordRetryAttempt` / `getRetryAttempts` / `retryCount` roundtrip (new `ith_retries` table) | `smoke-src/29` (`IthStore` export) |
| 12 | `resolveRetryPolicy`/`resolveBackoffPolicy` clamping + defaults | `smoke-src/29` (`team` export) |

### smoke-ext (extensions, injected `spawnImpl`)
| # | Test | File |
|---|---|---|
| 13 | **Integration:** child fails once with `context_window` marker → exactly ONE fresh respawn with continuation summary → final success; `endLive` fires once; `attempt`=2; `ith_retries` has 1 record; `events.log` has `dispatch_retry` + `dispatch_resolved`. | `scripts/smoke-extensions/dispatch-retry.mjs` |
| 14 | child fails with `rate_limit` → backoff delay observed (inject fake clock/rng) → respawn same model → success; `action:"backoff"`. | `smoke-extensions/dispatch-retry.mjs` |
| 15 | child fails with `auth` → skip to next hop (different model, no backoff) → success on 2nd model; `action:"fallback"`, `reason:"auth:…"`. | `smoke-extensions/dispatch-retry.mjs` |
| 16 | child fails `context_window` WITH a `"big-window"` fallback hop → respawn with bigger-window model + compacted task. | `smoke-extensions/dispatch-retry.mjs` |
| 17 | child fails permanently (`unknown`) → **no** retry; `endLive` failed. | `smoke-extensions/dispatch-retry.mjs` |
| 18 | Agent frontmatter `fallback_models`/`retry_*` parses to `AgentConfig.fallback`/`retry`. | `smoke-extensions/agents.mjs` (existing) |
| 19 | Card renders `↻ retrying (attempt n/N)` for a `"retrying"` snapshot. | `smoke-extensions/card.mjs` (existing) or unit |
| 20 | `dispatch-completions/<id>.json` enriched with `retryCount` + `attempts[]` + `finalModel`. | `smoke-extensions/dispatch-retry.mjs` |

**Smoke harness wiring (`scripts/smoke-src/_harness.mjs`):** export the new
modules so `smoke-src/29` can consume them (strip-types loader, explicit `.ts`
specifiers):
```js
export const retry         = await import(join(buildDir, "retry.ts"));
export const failureKind   = await import(join(buildDir, "failure-kind.ts"));
export const autoCompact   = await import(join(buildDir, "auto-compact.ts"));
export const boundary      = await import(join(buildDir, "boundary.ts"));
export const windowPressure= await import(join(buildDir, "window-pressure.ts"));
export const modelFallback = await import(join(buildDir, "model-fallback.ts"));
```
**`scripts/smoke-src.mjs`:** `import * as s29 from "./smoke-src/29-dispatch-resilience.mjs";` … `await s29.run(ctx);` (after s28).
**`scripts/smoke-ext.mjs`:** add `import * as extRetry from "./smoke-extensions/dispatch-retry.mjs";` … `await extRetry.run(ctx);`.

> The retry **decision** (`shouldRetry`/`routeFallback`/`buildContinuationSummary`/
> `computeBackoff`/`classifyFailureKind`) is fully covered at the `src` layer
> (rows 1–12); the `ext` tests (rows 13–20) validate the **wiring** with an
> injected `spawnImpl` (the existing `spawnAgent` test seam). Read
> `scripts/smoke-ext.mjs` convention before coding the integration test.

---

## 11. Gate commands

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
All must pass before commit (`CLAUDE.md` §3 + `docs/AGENT_GUARDRAILS.md`).

---

## 12. Risks & rollback

| Risk | Mitigation |
|---|---|
| `execute()` `finally` double-fires `endLive` | `finalized` flag (§6.2) — `endLive` runs exactly once. |
| `"retrying"` transition silently refused by `canTransition` | add `retrying` rows to `TRANSITIONS` (§5) **and** verify in `smoke-src/28` before wiring dispatch. |
| Infinite retry loop | `shouldRetry` strictly bounds on `maxRetries` (cap 3) + `policy.enabled`; `routeFallback` returns `stop` when `hopIndex >= maxHops`; viability guard stops doomed retries. |
| Reuses failed child session (claw-code PR #4 bug) | Each retry is a **fresh `spawnAgent`** with a rebuilt prompt from durable state — never re-handles the dead child. |
| Compaction still over window → futile retry | `planRetry` viability check (§4.4) short-circuits. |
| Overlay key churn across attempts | `dispatchId` is **stable** for the whole dispatch (§6.1); retry child events keep updating the same live card. |
| `endLive` misclassifies final failure | pass `lastStatus: getLive(dispatchId)?.status` to `classifyFailureKind` in the retry decision. |
| Marker false-positives (G5) | anchored patterns + tail-only scan + tests asserting benign prose does not misclassify. |
| No "bigger-window" registry (G6) | chain ORDER + `"big-window"` tag encode intent; documented limitation; optional static map deferred. |
| Backoff blocks cancellation | `sleep` is `AbortSignal`-aware; rejects on abort. |
| Store contention (WAL) | `ith_retries` uses existing `DatabaseSync` + WAL/busy_timeout (already configured). |
| Team/swarm path drift (optional §6.3) | marked optional; if adopted, identical return shape keeps callers unchanged. |
| **Rollback** | every change is a focused commit; `git checkout HEAD -- <file>` per file. DB migration is additive (`CREATE TABLE IF NOT EXISTS`) — no destructive alter. Version bump owned exclusively by `scripts/deploy.sh`. |

---

## 13. Commit sequence (focused, one logical unit per commit)

1. **`src/` logic** — `types.ts` (new types), `events.ts` (`"retrying"` + new
   kinds), `worker-status.ts` (transitions + delegate to `failure-kind`),
   `failure-kind.ts`, `retry.ts`, `boundary.ts`, `auto-compact.ts`,
   `window-pressure.ts`, `model-fallback.ts`, `team.ts` (resolvers), `config.ts`
   (additive), `trim.ts` (additive). → `build` + `guardrails` + `smoke-src`.
2. **`src/store.ts`** — `ith_retries` table + methods. → `smoke-src` + `schema-health`.
3. **`extensions/ithacus-live.ts` + `ithacus-live-card.ts`** — `retrying` status,
   attempt counter, `↻ retrying (attempt n/N)` render. → `guardrails` + ext smoke.
4. **`extensions/ithacus-agents.ts`** — `fallback`/`retry` frontmatter parse. → ext smoke.
5. **`extensions/ithacus-retry.ts`** (NEW shared loop) + **`ithacus-dispatch.ts`**
   (delegate to `dispatchWithResilience`) — the integration. → full `smoke-ext`
   + `guardrails` + `regression`.
6. **`extensions/ithacus-commands.ts`** (optional) — fleet attempts view.
7. **Optional stretch:** `ithacus-team.ts`/`ithacus-swarm.ts` adopt
   `dispatchWithResilience`.
8. **Patch bump** `0.6.0 → 0.6.1` via `bash scripts/deploy.sh` (auto patch) +
   `npm run gate` green. Single PATCH step per sprint (`CLAUDE.md` §3); never
   hand-edit `package.json` version.

---

## 14. Spec gaps & risks (explicit)

- **G1 — `RetryPolicy.on` too narrow in the design doc.** Design lists only
  `["context_window","crash"]`; backlog #54 + scope B require `rate_limit`,
  `network`, `auth`. Plan generalizes `on: WorkerFailureKind[]` and adds the
  three new kinds to `WorkerFailureKind`.
- **G2 — `"retrying"` missing though design says "added with 5.14".** Plan adds
  it to `src/events.ts` + `TRANSITIONS` + `toAgentStatus`. (Also note
  `WorkerStatus` lives in `events.ts`, **not** `types.ts` as the design text
  implies — a doc/repo drift the plan corrects.)
- **G3 — `DESIGN_AUTO_COMPACT_RETRY` references `checkpoint.ts buildSummary(progress)`
  but the real `buildSummary` takes `ConversationMessage[]`.** Plan introduces
  `buildContinuationSummary(LiveProgress, originalTask)` (§4.4) instead.
- **G4 — detection markers for `rate_limit`/`network`/`auth` do not exist.**
  Plan adds them in `src/failure-kind.ts` and delegates `worker-status`'s
  classifier to it (single owner).
- **G5 — marker false-positives.** See §2.2 + §12. Mitigated by anchoring +
  tail-only scan + tests.
- **G6 — no model→context-window registry.** `context_window`→"bigger-window"
  relies on chain **order** + optional `"big-window"` tag; documented
  limitation (§3.4 / §12). A static `KNOWN_MODELS` map is deferred.
- **G7 — transient retry needs timers** (`setTimeout`) which must stay in
  `extensions/` (src stays pure/testable). `computeBackoff` is pure; `sleep` is
  in `ithacus-retry.ts` and `AbortSignal`-aware.
- **G8 — PREVENT-ITH-001/002 enforcement** must flow through the whitelisted
  `computeDropRange`/`dropBefore`/`keepRecent`/`anchor` names (verified against
  `.guardrails/prevention-rules/pattern-rules.json`); the auto-compact path uses
  them so the guardrails scan passes.
- **G9 — `src/parallel.ts` is out of scope.** It parallelizes tool-batch
  execution within a single response, unrelated to spawned-sub-agent dispatch
  resilience. No changes proposed (named explicitly to avoid confusion).
- **G10 — config additions are non-breaking.** All new `IthacusConfig` fields are
  optional with backward-compatible defaults; existing `ITHACUS_FALLBACK_MODELS`
  keeps working.

---

## 15. Summary (10 lines)

- **Goal:** on sub-agent failure, recover durably — auto-compact + fresh respawn
  on `context_window`; bounded backoff retry on `rate_limit`/`network`; ordered
  model-fallback chain (#54) routed by failure class; capped at `maxHops` 2–3.
- **New `src/` (pure):** `failure-kind.ts` (markers + `classifyFailureKind`),
  `retry.ts` (`shouldRetry` + pure `computeBackoff`), `boundary.ts`
  (`computeDropRange`/`dropBefore` — PREVENT-ITH-001/002 whitelist),
  `auto-compact.ts` (`buildContinuationSummary`/`planRetry`), `window-pressure.ts`,
  `model-fallback.ts` (`routeFallback`). `team.ts` adds chain/resolver builders.
- **Types/`events.ts`:** add `RetryPolicy`/`BackoffPolicy`/`ModelFallbackHop`/
  `ModelFallbackChain`; extend `WorkerFailureKind` with `rate_limit`/`network`/
  `auth`; add `"retrying"` to `WorkerStatus`.
- **Extensions:** NEW `ithacus-retry.ts` `dispatchWithResilience` (shared loop,
  orchestrates annotated `spawnAgent`, logs audit); `ithacus-dispatch.ts`
  delegates to it (single `dispatchId`, `endLive` once via `finalized`);
  `ithacus-live.ts`/`live-card.ts` show `↻ retrying (attempt n/N)`;
  `ithacus-agents.ts` parses `fallback`/`retry` frontmatter; optional team/swarm
  adoption + fleet view.
- **Never reuse the dead child** (claw-code PR #4 bug): every attempt is a fresh
  `spawnAgent` with a prompt rebuilt from durable state (`LiveProgress` +
  `originalTask`), not a `system` role (ITH-003).
- **Routing:** context_window→bigger-window hop + compact; rate_limit→alt-provider
  hop else backoff; network/timeout→backoff; auth→skip to next hop;
  permission_denied/unknown→stop.
- **Audit:** `dispatch_retry` + `model_fallback` + `dispatch_resolved` to
  `events.log`; `dispatch-completions/<id>.json` enriched with `retryCount` +
  `attempts[]`; `ith_retries` sqlite table (fleet view).
- **Tests:** `smoke-src/29` (policy/summary/boundary/pressure/store/classifier) +
  `smoke-src/28` (`"retrying"`) + `smoke-ext` (fail-once → one fresh respawn →
  success; rate_limit backoff; auth skip; context_window+bigger-window;
  permanent→no retry).
- **Guardrails:** ITH-001/002 via whitelisted boundary names; ITH-003 (task text);
  ITH-004/PI-004 (no network, reuse annotated local spawn); DIST-001 (deploy.sh
  only).
- **Gate:** build, lint, smoke-src, smoke-ext, guardrails, regression, semantic,
  schema-health, gate. Commits: src → store → live/card → agents → retry/dispatch
  → commands → optional team/swarm → patch bump via `scripts/deploy.sh`.
