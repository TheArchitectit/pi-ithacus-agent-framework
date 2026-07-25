/**
 * store-hindsight.ts — hindsight memory table + methods.
 *
 * Extends IthStore with Sprint 3.1 hindsight columns. Separated to keep
 * store.ts under the 300-line limit (mirrors store-presence.ts pattern).
 *
 * pi-agnostic: depends only on node:sqlite (via DatabaseSync) + types.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { HindsightEntry } from './types.js';

export class HindsightStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.migrateHindsight();
  }

  /** Idempotent: add hindsight columns to ith_memories if absent. */
  private migrateHindsight(): void {
    const cols = new Set(
      (this.db.prepare(`PRAGMA table_info(ith_memories)`).all() as Array<{ name: string }>).map(r => r.name),
    );
    if (!cols.has('agentId')) this.db.exec(`ALTER TABLE ith_memories ADD COLUMN agentId TEXT`);
    if (!cols.has('runId')) this.db.exec(`ALTER TABLE ith_memories ADD COLUMN runId TEXT`);
    if (!cols.has('relevance')) this.db.exec(`ALTER TABLE ith_memories ADD COLUMN relevance REAL NOT NULL DEFAULT 0`);
    if (!cols.has('reflected')) this.db.exec(`ALTER TABLE ith_memories ADD COLUMN reflected INTEGER NOT NULL DEFAULT 0`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS ix_ith_mem_hindsight ON ith_memories(repoId, reflected, ts)`);
  }

  /** Store a hindsight entry (also creates the base memory row). */
  retain(entry: HindsightEntry): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_memories (id, kind, text, repoId, ts, agentId, runId, relevance, reflected)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(entry.id, entry.kind, entry.text, entry.repoId, entry.ts,
          entry.agentId ?? null, entry.runId ?? null, entry.relevance, entry.reflected ? 1 : 0);
  }

  /** Recall hindsight entries for a repo, optionally filtered + sorted by relevance. */
  recall(repoId: string, opts?: { kind?: string; limit?: number; minRelevance?: number }): HindsightEntry[] {
    const limit = opts?.limit ?? 8;
    const minRel = opts?.minRelevance ?? 0;
    const rows = opts?.kind
      ? this.db.prepare(`SELECT * FROM ith_memories WHERE repoId = ? AND kind = ? AND relevance >= ? ORDER BY relevance DESC, ts DESC LIMIT ?`).all(repoId, opts.kind, minRel, limit)
      : this.db.prepare(`SELECT * FROM ith_memories WHERE repoId = ? AND relevance >= ? ORDER BY relevance DESC, ts DESC LIMIT ?`).all(repoId, minRel, limit);
    return (rows as Array<Record<string, unknown>>).map(r => this.rowToEntry(r));
  }

  /** Mark an entry as reflected (survived compaction). */
  markReflected(id: string): void {
    this.db.prepare(`UPDATE ith_memories SET reflected = 1 WHERE id = ?`).run(id);
  }

  /** Get all reflected entries for a repo (compressed mental model). */
  reflectedEntries(repoId: string): HindsightEntry[] {
    return (this.db.prepare(`SELECT * FROM ith_memories WHERE repoId = ? AND reflected = 1 ORDER BY ts`).all(repoId) as Array<Record<string, unknown>>)
      .map(r => this.rowToEntry(r));
  }

  /** Clear hindsight metadata for a repo (does not delete base memories). */
  clearHindsight(repoId: string): void {
    this.db.prepare(`UPDATE ith_memories SET relevance = 0, reflected = 0, agentId = NULL, runId = NULL WHERE repoId = ?`).run(repoId);
  }

  private rowToEntry(row: Record<string, unknown>): HindsightEntry {
    return {
      id: String(row.id),
      repoId: String(row.repoId),
      agentId: String(row.agentId ?? ''),
      runId: String(row.runId ?? ''),
      kind: String(row.kind),
      text: String(row.text),
      relevance: Number(row.relevance ?? 0),
      reflected: Boolean(row.reflected),
      ts: Number(row.ts),
    };
  }
}
