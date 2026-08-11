# DESIGN: Memory Consolidation (Sprint 5.18)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Source pattern**: memory-mcp Trident compaction (Supersede → Collapse →
> Cluster, ~7× compression) — CONCEPT borrowed only. No pgvector/FAISS/Redis
> (PREVENT-ITH-004); consolidation runs on ithacus's `ith_memories` sqlite
> table with in-process token-overlap scoring.
> **Builds on**: Sprint 3.1 (`src/hindsight.ts` — retain/recall/reflect).

## 1. Problem

`ith_memories` grows monotonically via `retain()`. Over months, recall quality
degrades: stale facts compete with current ones, near-duplicate entries from
parallel agents pile up, and `recall()` scans everything. memory-mcp's Trident
pipeline (supersede obsolete → collapse chatty → cluster similar) is the proven
shape for fixing this.

## 2. Design

### 2.1 Pipeline — `src/consolidate.ts` (pure, pi-agnostic)

```ts
consolidate(memories: MemoryRecord[], opts: ConsolidateOptions): ConsolidationPlan

// Three passes, each producing plan entries (never applied inside the fn):
// 1. SUPERSEDE — entries whose text contains a superseded marker or that
//    reflect() has flagged obsolete get action "supersede" (keep, mark
//    superseded_by, exclude from recall ranking).
// 2. COLLAPSE  — entries from the same run/kind within a time window with
//    token-overlap ≥ collapseThreshold merge into one entry (originals marked
//    collapsed_into the merged id).
// 3. CLUSTER   — remaining entries grouped by token-overlap similarity ≥
//    clusterThreshold; each cluster gets a synthetic centroid tag to speed
//    recall() (tag index, not vector search).
```

`ConsolidationPlan` is a dry-run artifact: `{ supersede: [], collapse: [],
cluster: [] }` — the store applies it only when the caller commits. This keeps
`src/` pure and the operation reversible (PREVENT-ITH-001 spirit: nothing
destructive without an audit trail).

### 2.2 Scoring — in-process only

Reuse `src/hindsight.ts` `scoreRelevance()` (token-overlap) as the similarity
kernel. NO external embedding service, NO vector DB — PREVENT-ITH-004.
Thresholds are config (`ithacus.config.json` → `consolidation` key) with safe
defaults: collapseThreshold 0.75, clusterThreshold 0.5, windowMs 24h.

### 2.3 Schema additions (`src/store.ts`)

`ith_memories` gains columns (idempotent ALTER guarded by PRAGMA check):
`superseded_by TEXT`, `collapsed_into TEXT`, `cluster_tag TEXT`.
Recall filters: `WHERE superseded_by IS NULL AND collapsed_into IS NULL`.

### 2.4 Anti-patterns avoided (memory-mcp lessons)

- Store and index the ORIGINAL text; consolidation only ADDS metadata columns —
  never rewrites entry text (memory-mcp's bug: embedding compressed text made
  recall fail).
- Similarity is token-overlap in [0,1], higher = more similar, documented in
  the type (memory-mcp inverted FAISS distance semantics).
- Real uuid keys; no id truncation.

### 2.5 Triggering

- `/ithacus-memory consolidate` command (manual, dry-run first, confirm).
- Optional auto-consolidation at `ith_store` open when memory count exceeds
  `consolidation.autoThreshold` (default 500) — scheduled via the existing
  `createScheduler` (Sprint 4.5), not a new timer.

## 3. Files changed

| File | Change |
|---|---|
| `src/consolidate.ts` | NEW — pure pipeline + plan types |
| `src/store.ts` | 3 columns + applyConsolidation(plan) |
| `src/hindsight.ts` | recall() filters superseded/collapsed |
| `src/config.ts` | `consolidation` config block |
| `extensions/ithacus-commands.ts` | `/ithacus-memory consolidate` |

## 4. Testing

- Unit (src): supersede/collapse/cluster fixtures; plan is pure (input
  unchanged); recall excludes superseded; threshold boundaries.
- Gate: build + smoke + guardrails + regression.

## 5. Out of scope

- Semantic/vector search (needs external embeddings — PREVENT-ITH-004).
- Cross-repo memory federation.
