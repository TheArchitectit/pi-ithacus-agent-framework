/**
 * store-events.ts — activity feed event table + methods.
 *
 * Separated from store.ts to keep that file under 300 lines (mirrors
 * store-presence.ts/store-hindsight.ts pattern).
 *
 * pi-agnostic: depends only on node:sqlite (via DatabaseSync) + types.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { ActivityEvent } from './types.js';

const EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS ith_events (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ith_events_run ON ith_events(runId, ts);
CREATE INDEX IF NOT EXISTS ix_ith_events_agent ON ith_events(agentId, ts);
CREATE INDEX IF NOT EXISTS ix_ith_events_action ON ith_events(action, ts);
`;

export class EventsStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(EVENTS_SCHEMA);
  }

  /** Append an event to the feed. */
  append(e: ActivityEvent): void {
    this.db.prepare(
      `INSERT INTO ith_events (id, runId, agentId, action, metadata, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(e.id, e.runId, e.agentId, e.action, JSON.stringify(e.metadata), e.ts);
  }

  /** Query events by run, optionally filtered by agent or action. */
  query(opts: { runId?: string; agentId?: string; action?: string; limit?: number }): ActivityEvent[] {
    const limit = opts.limit ?? 100;
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.runId) { where.push('runId = ?'); args.push(opts.runId); }
    if (opts.agentId) { where.push('agentId = ?'); args.push(opts.agentId); }
    if (opts.action) { where.push('action = ?'); args.push(opts.action); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM ith_events ${clause} ORDER BY ts ASC LIMIT ?`,
    ).all(...args, limit) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToEvent(r));
  }

  /** Count events matching a filter. */
  count(opts: { runId?: string; action?: string }): number {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.runId) { where.push('runId = ?'); args.push(opts.runId); }
    if (opts.action) { where.push('action = ?'); args.push(opts.action); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as n FROM ith_events ${clause}`).get(...args) as { n: number };
    return row?.n ?? 0;
  }

  /** Clear events for a run. */
  clearRun(runId: string): void {
    this.db.prepare(`DELETE FROM ith_events WHERE runId = ?`).run(runId);
  }

  private rowToEvent(row: Record<string, unknown>): ActivityEvent {
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(String(row.metadata ?? '{}')); } catch { metadata = {}; }
    return {
      id: String(row.id),
      runId: String(row.runId),
      agentId: String(row.agentId),
      action: String(row.action),
      metadata,
      ts: Number(row.ts),
    };
  }
}
