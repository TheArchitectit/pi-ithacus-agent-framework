/**
 * store-swarm.ts — swarm run/result/checkpoint persistence (feat 4.22).
 *
 * Follows the store-presence.ts pattern: a SWARM_SCHEMA const + a SwarmStore
 * class whose constructor takes `db: DatabaseSync` and runs the schema. Kept
 * separate so store.ts stays under the 300-line limit.
 *
 * pi-agnostic: depends only on node:sqlite + types. Zero network
 * (PREVENT-ITH-004); output/checkpoints are JSON-encoded for safe round-trip.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { SwarmResult, SwarmItemResult } from './types-sprint-5.4.js';
import type { QueueCheckpoint } from './types-sprint-5.1.js';

const SWARM_SCHEMA = `
CREATE TABLE IF NOT EXISTS ith_swarm_runs (
  runId TEXT PRIMARY KEY,
  swarmName TEXT NOT NULL,
  total INTEGER NOT NULL,
  successful INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  blocked INTEGER NOT NULL,
  totalDurationMs INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ith_swarm_results (
  runId TEXT NOT NULL,
  itemId INTEGER NOT NULL,
  itemName TEXT NOT NULL,
  success INTEGER NOT NULL,
  output TEXT,
  error TEXT,
  durationMs INTEGER NOT NULL,
  role TEXT,
  PRIMARY KEY (runId, itemId)
);
CREATE TABLE IF NOT EXISTS ith_swarm_checkpoints (
  runId TEXT NOT NULL,
  seq INTEGER NOT NULL,
  checkpoint TEXT NOT NULL,
  PRIMARY KEY (runId, seq)
);
CREATE INDEX IF NOT EXISTS ix_ith_swarm_runs_name ON ith_swarm_runs(swarmName);
CREATE INDEX IF NOT EXISTS ix_ith_swarm_results_run ON ith_swarm_results(runId);
`;

// Instance-unique counter: seeded from Date.now() so separate module instances
// (e.g. smoke test file-copy imports) produce non-colliding runIds even when
// sharing the same SQLite DB.
let swarmRunCounter = Date.now() % 100000;

interface SwarmRunRow {
  runId: string;
  swarmName: string;
  total: number;
  successful: number;
  failed: number;
  blocked: number;
  totalDurationMs: number;
  createdAt: number;
}

interface SwarmResultRow {
  itemId: number;
  itemName: string;
  success: number;
  output: string | null;
  error: string | null;
  durationMs: number;
  role: string | null;
}

export class SwarmStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SWARM_SCHEMA);
  }

  /** Persist a full SwarmResult atomically; returns the generated runId. */
  saveSwarmResult(result: SwarmResult, now: number): string {
    // Use Date.now() for runId uniqueness (not the caller's `now` which may be
    // a fixed mock value). This prevents UNIQUE collisions across separate module
    // instances sharing the same SQLite DB (e.g. smoke test file-copy imports).
    const runId = `swarm-${Date.now().toString(36)}-${(swarmRunCounter++).toString(36)}`;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(
        `INSERT INTO ith_swarm_runs (runId, swarmName, total, successful, failed, blocked, totalDurationMs, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(runId, result.swarmName, result.total, result.successful,
        result.failed, result.blocked, result.totalDurationMs, now);
      const insItem = this.db.prepare(
        `INSERT INTO ith_swarm_results (runId, itemId, itemName, success, output, error, durationMs, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of result.results) {
        // ALWAYS JSON.stringify output (strings round-trip via JSON.parse too).
        const outStr = r.output === undefined ? null : JSON.stringify(r.output);
        insItem.run(runId, r.itemId, r.itemName, r.success ? 1 : 0,
          outStr, r.error ?? null, r.durationMs, r.role ?? null);
      }
      const insCp = this.db.prepare(
        `INSERT INTO ith_swarm_checkpoints (runId, seq, checkpoint) VALUES (?, ?, ?)`,
      );
      result.checkpoints.forEach((cp, seq) => {
        insCp.run(runId, seq, JSON.stringify(cp));
      });
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return runId;
  }

  /** Reassemble a SwarmResult by runId (undefined if absent). */
  getSwarmResult(runId: string): SwarmResult | undefined {
    const row = this.db.prepare(`SELECT * FROM ith_swarm_runs WHERE runId = ?`).get(runId) as SwarmRunRow | undefined;
    if (!row) return undefined;
    const resultRows = this.db.prepare(
      `SELECT itemId, itemName, success, output, error, durationMs, role FROM ith_swarm_results WHERE runId = ? ORDER BY itemId ASC`,
    ).all(runId) as unknown as SwarmResultRow[];
    const results: SwarmItemResult[] = resultRows.map(r => ({
      itemId: r.itemId,
      itemName: r.itemName,
      success: r.success === 1,
      output: r.output == null ? undefined : JSON.parse(r.output),
      error: r.error ?? undefined,
      durationMs: r.durationMs,
      role: r.role ?? undefined,
    }));
    const cpRows = this.db.prepare(
      `SELECT checkpoint FROM ith_swarm_checkpoints WHERE runId = ? ORDER BY seq ASC`,
    ).all(runId) as Array<{ checkpoint: string }>;
    const checkpoints: QueueCheckpoint[] = cpRows.map(r => JSON.parse(r.checkpoint));
    return {
      runId: row.runId,
      swarmName: row.swarmName,
      total: row.total,
      successful: row.successful,
      failed: row.failed,
      blocked: row.blocked,
      results,
      totalDurationMs: row.totalDurationMs,
      checkpoints,
    };
  }

  /** List recent swarm runs (newest first). */
  listSwarmRuns(limit = 20): SwarmRunRow[] {
    return this.db.prepare(
      `SELECT runId, swarmName, total, successful, failed, blocked, totalDurationMs, createdAt
       FROM ith_swarm_runs ORDER BY createdAt DESC, runId DESC LIMIT ?`,
    ).all(limit) as unknown as SwarmRunRow[];
  }

  /** Newest SwarmResult for a given swarm name (undefined if none). */
  latestSwarmRun(swarmName: string): SwarmResult | undefined {
    const row = this.db.prepare(
      `SELECT runId FROM ith_swarm_runs WHERE swarmName = ? ORDER BY createdAt DESC, runId DESC LIMIT 1`,
    ).get(swarmName) as { runId: string } | undefined;
    if (!row) return undefined;
    return this.getSwarmResult(row.runId);
  }

  /** Delete a swarm run + its results + checkpoints. */
  deleteSwarmRun(runId: string): void {
    this.db.prepare(`DELETE FROM ith_swarm_results WHERE runId = ?`).run(runId);
    this.db.prepare(`DELETE FROM ith_swarm_checkpoints WHERE runId = ?`).run(runId);
    this.db.prepare(`DELETE FROM ith_swarm_runs WHERE runId = ?`).run(runId);
  }
}

export function createSwarmStore(db: DatabaseSync): SwarmStore {
  return new SwarmStore(db);
}
