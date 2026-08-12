/**
 * checkpoint-manager.ts — persistence + manager API for session checkpoints
 * (Sprint 5.16, docs/DESIGN_CHECKPOINT_MANAGER.md).
 *
 * Adds the `ith_checkpoints` table (CREATE TABLE IF NOT EXISTS — idempotent,
 * re-run safe) and a list/delete/archive/compare manager over the local
 * node:sqlite store. Sprint 2.1's in-conversation marks (checkpoint.ts) are
 * mirrored in via checkpoint.ts's mirrorCheckpoint → createCheckpointMeta for
 * cross-run visibility.
 *
 * compare() is METADATA-level (counts + summaries), NOT full conversation
 * diffing — conversations live in pi, not ithacus (design §6 out of scope).
 * No session-ID truncation/normalization hacks: real uuid keys only.
 *
 * pi-agnostic: depends only on node:sqlite + store/checkpoint types.
 * Zero network (PREVENT-ITH-004).
 */

import { randomUUID } from 'node:crypto';
import type { Checkpoint } from './types.js';
import type { IthStore } from './store.js';

/* ------------------------------------------------------------------ schema */

const CHECKPOINT_SCHEMA = `
CREATE TABLE IF NOT EXISTS ith_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  summary TEXT,
  message_count INTEGER,
  token_estimate INTEGER,
  archived INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ith_checkpoints_run ON ith_checkpoints(run_id);
`;

/* ------------------------------------------------------------------- types */

/** One mirrored checkpoint row (the manager's row shape). */
export interface CheckpointMeta {
  id: string;
  runId: string;
  label: string;
  createdAt: number;
  summary: string | null;
  messageCount: number | null;
  tokenEstimate: number | null;
  archived: boolean;
}

/** Metadata-level diff between two checkpoints (design §2.2). */
export interface CheckpointDiff {
  aMeta: CheckpointMeta | null;
  bMeta: CheckpointMeta | null;
  /** b.messageCount - a.messageCount; null when either side is absent. */
  deltaMessages: number | null;
  /** b.tokenEstimate - a.tokenEstimate; null when either side is absent. */
  deltaTokens: number | null;
  /** Human-readable: label/age/count deltas + summary comparison. */
  summaryDiff: string;
}

/* -------------------------------------------------------------- row mapping */

interface CheckpointRow {
  id: string;
  run_id: string;
  label: string;
  created_at: number;
  summary: string | null;
  message_count: number | null;
  token_estimate: number | null;
  archived: number;
}

function rowToMeta(r: CheckpointRow): CheckpointMeta {
  return {
    id: r.id,
    runId: r.run_id,
    label: r.label,
    createdAt: r.created_at,
    summary: r.summary ?? null,
    messageCount: r.message_count ?? null,
    tokenEstimate: r.token_estimate ?? null,
    archived: Boolean(r.archived),
  };
}

/* ------------------------------------------------------------------ public */

/** Idempotently ensure the ith_checkpoints table exists (safe on every use;
 *  CREATE TABLE IF NOT EXISTS is cheap and re-run safe — design §4). */
export function ensureCheckpointSchema(store: IthStore): void {
  store.db.exec(CHECKPOINT_SCHEMA);
}

/** Insert a checkpoint row; returns the stored CheckpointMeta. */
export function createCheckpointMeta(
  store: IthStore,
  input: {
    id?: string;
    runId: string;
    label: string;
    createdAt?: number;
    summary?: string | null;
    messageCount?: number | null;
    tokenEstimate?: number | null;
  },
): CheckpointMeta {
  ensureCheckpointSchema(store);
  const meta: CheckpointMeta = {
    id: input.id ?? randomUUID(),
    runId: input.runId,
    label: input.label,
    createdAt: input.createdAt ?? Date.now(),
    summary: input.summary ?? null,
    messageCount: input.messageCount ?? null,
    tokenEstimate: input.tokenEstimate ?? null,
    archived: false,
  };
  store.db.prepare(
    `INSERT OR REPLACE INTO ith_checkpoints
       (id, run_id, label, created_at, summary, message_count, token_estimate, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    meta.id, meta.runId, meta.label, meta.createdAt,
    meta.summary, meta.messageCount, meta.tokenEstimate, meta.archived ? 1 : 0,
  );
  return meta;
}

/**
 * List checkpoints, most-recent first. Archived rows are excluded unless
 * opts.includeArchived is true; optionally narrowed to one runId.
 */
export function listCheckpoints(
  store: IthStore,
  opts: { runId?: string; includeArchived?: boolean } = {},
): CheckpointMeta[] {
  ensureCheckpointSchema(store);
  const includeArchived = opts.includeArchived === true;
  const rows = opts.runId
    ? store.db.prepare(
        includeArchived
          ? `SELECT * FROM ith_checkpoints WHERE run_id = ? ORDER BY created_at DESC`
          : `SELECT * FROM ith_checkpoints WHERE run_id = ? AND archived = 0 ORDER BY created_at DESC`,
      ).all(opts.runId)
    : store.db.prepare(
        includeArchived
          ? `SELECT * FROM ith_checkpoints ORDER BY created_at DESC`
          : `SELECT * FROM ith_checkpoints WHERE archived = 0 ORDER BY created_at DESC`,
      ).all();
  return (rows as unknown as CheckpointRow[]).map(rowToMeta);
}

/** Fetch one checkpoint by id, or null. */
export function getCheckpoint(store: IthStore, id: string): CheckpointMeta | null {
  ensureCheckpointSchema(store);
  const row = store.db
    .prepare(`SELECT * FROM ith_checkpoints WHERE id = ?`)
    .get(id) as CheckpointRow | undefined;
  return row ? rowToMeta(row) : null;
}

/** Hard delete; returns false when absent OR when the row is archived
 *  (archived checkpoints are excluded from delete targets — design §2.2). */
export function deleteCheckpoint(store: IthStore, id: string): boolean {
  const existing = getCheckpoint(store, id);
  if (!existing) return false;
  if (existing.archived) return false;
  store.db.prepare(`DELETE FROM ith_checkpoints WHERE id = ?`).run(id);
  return true;
}

/** Soft archive (archived=1); returns false when absent. Archived rows are
 *  excluded from prune/rewind targets and from default list/delete. */
export function archiveCheckpoint(store: IthStore, id: string): boolean {
  const existing = getCheckpoint(store, id);
  if (!existing) return false;
  store.db.prepare(`UPDATE ith_checkpoints SET archived = 1 WHERE id = ?`).run(id);
  return true;
}

/** Metadata-level compare of two checkpoints (design §2.2) — counts +
 *  summaries, never full conversation text. Either side may be missing. */
export function compareCheckpoints(
  store: IthStore,
  aId: string,
  bId: string,
): CheckpointDiff {
  const a = getCheckpoint(store, aId);
  const b = getCheckpoint(store, bId);
  const deltaMessages =
    a && b && a.messageCount != null && b.messageCount != null
      ? b.messageCount - a.messageCount
      : null;
  const deltaTokens =
    a && b && a.tokenEstimate != null && b.tokenEstimate != null
      ? b.tokenEstimate - a.tokenEstimate
      : null;

  const describe = (m: CheckpointMeta | null, id: string): string =>
    m
      ? `${m.label} (@${new Date(m.createdAt).toISOString().slice(0, 19)}, ` +
        `${m.messageCount ?? '?'} msgs, ${m.tokenEstimate ?? '?'} tok` +
        `${m.archived ? ', archived' : ''})`
      : `(missing ${id})`;

  const lines: string[] = [];
  lines.push(`A: ${describe(a, aId)}`);
  lines.push(`B: ${describe(b, bId)}`);
  if (deltaMessages !== null) {
    lines.push(`messages delta: ${deltaMessages >= 0 ? '+' : ''}${deltaMessages} (B − A)`);
  }
  if (deltaTokens !== null) {
    lines.push(`tokens delta:   ${deltaTokens >= 0 ? '+' : ''}${deltaTokens} (B − A)`);
  }
  lines.push('summary A: ' + (a?.summary ?? '(none)'));
  lines.push('summary B: ' + (b?.summary ?? '(none)'));

  return { aMeta: a, bMeta: b, deltaMessages, deltaTokens, summaryDiff: lines.join('\n') };
}

/** Mirror an in-conversation Checkpoint into the manager store (used by
 *  checkpoint.ts's mirrorCheckpoint). Returns the persisted meta. */
export function mirrorCheckpoint(
  store: IthStore,
  cp: Checkpoint,
  messageCount: number | null,
  label: string,
): CheckpointMeta {
  return createCheckpointMeta(store, {
    id: cp.id,
    runId: cp.runId,
    label,
    createdAt: cp.createdAt,
    summary: cp.summary || null,
    messageCount,
    tokenEstimate: cp.tokenCountAfter ?? null,
  });
}
