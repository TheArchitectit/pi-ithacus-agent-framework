# DESIGN: Session Checkpoint Manager (Sprint 5.16)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Source pattern**: memory-mcp session context manager
> (`session_context.py`: checkpoints, list/delete/archive/compare/diff) —
> patterns only; implemented on ithacus `node:sqlite`, NOT Postgres
> (PREVENT-ITH-004).
> **Builds on**: Sprint 2.1 (`src/checkpoint.ts`) — mark/prune/rewind/summary.

## 1. Problem

Sprint 2.1 delivered checkpoint PRIMITIVES (mark a checkpoint, prune after,
rewind, build a summary). What's missing is the MANAGER: listing checkpoints
across runs, deleting/archiving old ones, and comparing/diffing two checkpoints
to see what changed. memory-mcp proved all four operations are high-value for
agent workflows.

## 2. Design

### 2.1 Storage

New table `ith_checkpoints` in `src/store.ts` (idempotent schema, same pattern
as existing tables):

```sql
CREATE TABLE IF NOT EXISTS ith_checkpoints (
  id TEXT PRIMARY KEY,          -- uuid
  run_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  summary TEXT,                 -- buildSummary() output at mark time
  message_count INTEGER,
  token_estimate INTEGER,
  archived INTEGER DEFAULT 0
);
```

The existing in-conversation checkpoint marks (2.1) remain the source; this
manager mirrors them into sqlite for cross-run visibility.

### 2.2 Manager API — `src/checkpoint-manager.ts` (pi-agnostic)

```ts
listCheckpoints(store, opts?: { runId?: string; includeArchived?: boolean })
  : CheckpointMeta[]
getCheckpoint(store, id: string): CheckpointMeta | null
deleteCheckpoint(store, id: string): boolean      // hard delete; refuse archived
archiveCheckpoint(store, id: string): boolean     // soft: archived=1; excluded
                                                  // from prune/rewind targets
compareCheckpoints(store, aId, bId): CheckpointDiff
  // { aMeta, bMeta, deltaMessages, deltaTokens, summaryDiff }
```

`CheckpointDiff` is metadata-level (counts + summaries), NOT full conversation
diffing — full text diffing is out of scope (conversations live in pi, not
ithacus).

### 2.3 Slash command

`/ithacus-checkpoints` → overlay (Component pattern, Sprint 5.11):
- list view: label, run, age, messages, tokens, archived flag
- keys: `a` archive, `d` delete (with confirm), `c` compare-mode (pick two),
  `esc` close
- read-only otherwise; never mutates live conversations

## 3. Files changed

| File | Change |
|---|---|
| `src/store.ts` | `ith_checkpoints` table + CRUD helpers |
| `src/checkpoint-manager.ts` | NEW — manager API (pure over store) |
| `src/checkpoint.ts` | mirror marks into store (small addition) |
| `extensions/ithacus-commands.ts` | `/ithacus-checkpoints` |
| `extensions/ithacus-checkpoints-overlay.ts` | NEW — list/manage Component |

## 4. Testing

- Unit (src): manager CRUD on temp sqlite — list filters, archive excludes from
  delete targets, compare delta math, idempotent schema re-run.
- Gate: build + smoke + guardrails + regression.

## 5. Anti-patterns avoided (memory-mcp lessons)

- No session-ID truncation/normalization hacks — real uuid keys only.
- compare() documented as metadata-level; no ambiguous "similarity score"
  without units.

## 6. Out of scope

- Full conversation text diffing (pi owns conversations).
- Cross-repo checkpoint federation.
