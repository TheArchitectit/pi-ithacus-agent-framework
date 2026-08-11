# DESIGN: Auto-Compact + Retry on Context-Window Errors (Sprint 5.17)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Source pattern**: claw-code PRs #1-4 (the user's own claw-code work:
> auto-compact + retry on context-window errors) — pattern borrowed AND the
> known bug fixed (claw-code PR #4 retries with the original UNCOMPACTED
> session; this spec rebuilds with the compacted session).
> **Guardrails**: PREVENT-ITH-001 (never drop messages without anchor floor —
> compaction must preserve recent N); zero new deps.

## 1. Problem

Long-running agents hit the model context window. Today the child pi process
fails with a context-window error and the dispatch surfaces `failed` — the work
is lost. claw-code's pattern: detect the error, compact, retry. claw-code's bug
(retry on the uncompacted original) is documented and explicitly avoided.

## 2. Design

### 2.1 Detection

`extensions/ithacus-dispatch.ts` watches child output for the context-window
failure marker (JSON event type or stderr pattern — matched tolerantly, like
5.14's status detection). On detection, if `retryPolicy.enabled`:

1. Mark the live store: status `failed` → `retrying` (transient WorkerStatus
   extension from 5.14: `"retrying"` added).
2. Build a COMPACTED task for the retry: prepend a continuation summary.
   The summary comes from `src/checkpoint.ts` `buildSummary()` over the child's
   known progress (from the live store's accumulated tool-call/file events +
   the original task text) — NOT from asking the child (it's dead).
3. Re-spawn a FRESH child with the compacted prompt
   (`[continuation] <summary>\n\n<remaining task>`), same agent/model/worktree.
4. Attempt budget: default 1 retry, max 3 (`retryPolicy.maxRetries`).

### 2.2 RetryPolicy

```ts
// src/types.ts (pi-agnostic)
export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;        // default 1, hard cap 3
  on: ("context_window" | "crash")[];  // which failure kinds retry
}
```

Configurable per-agent in frontmatter (`retry: { enabled: true, maxRetries: 2 }`),
default `{ enabled: true, maxRetries: 1, on: ["context_window"] }`.

### 2.3 The bug we avoid

claw-code PR #4's retry path reuses the original session handle. ithacus NEVER
reuses a failed child: every retry is a fresh `spawnAgent` with a rebuilt
prompt. The compacted context is constructed from durable state (live store +
checkpoint summaries), so the retry cannot inherit the overflow that killed the
original.

### 2.4 User visibility

- Live overlay (5.13) shows `retrying ↻` with attempt n/N.
- Run record gets `retry_count` + per-attempt failure kind (sqlite).
- `/ithacus-agents` fleet view shows attempts.

## 3. Files changed

| File | Change |
|---|---|
| `src/types.ts` | `RetryPolicy`; `WorkerStatus` += `"retrying"` (with 5.14) |
| `src/retry.ts` | NEW — pure policy fn: shouldRetry(kind, attempt, policy) |
| `extensions/ithacus-dispatch.ts` | detection + rebuild + re-spawn loop |
| `extensions/ithacus-live.ts` | retrying status + attempt counter |

## 4. Testing

- Unit (src): shouldRetry matrix (kind × attempt × policy caps).
- Integration: mock child that fails once with context-window marker → assert
  exactly one fresh respawn with continuation summary, then success.
- Gate: build + smoke + guardrails + regression.

## 5. Out of scope

- Retry on tool-permission failures (needs interactive granting — future).
- Cross-run retry budgets (policy is per-dispatch).
