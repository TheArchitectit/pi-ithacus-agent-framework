/**
 * store-presence.ts — presence, reservations, and cost tables + methods.
 *
 * Extends the IthStore with Sprint 1.3 tables. Separated to keep store.ts
 * under the 300-line limit.
 *
 * pi-agnostic: depends only on node:sqlite (via IthStore.db) + types.
 */

import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentPresence,
  PresenceStatus,
  FileReservation,
  ReservationScope,
  CostEntry,
  CostSummary,
  IthAgent,
} from './types.js';

const PRESENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ith_presence (
  agentId         TEXT PRIMARY KEY,
  runId           TEXT NOT NULL,
  status          TEXT NOT NULL,
  lastHeartbeat   INTEGER NOT NULL,
  stuckThresholdMs INTEGER NOT NULL,
  createdAt       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ith_reservations (
  agentId    TEXT NOT NULL,
  runId      TEXT NOT NULL,
  filePath   TEXT NOT NULL,
  scope      TEXT NOT NULL,
  createdAt  INTEGER NOT NULL,
  PRIMARY KEY (agentId, filePath)
);
CREATE TABLE IF NOT EXISTS ith_costs (
  id           TEXT PRIMARY KEY,
  agentId      TEXT NOT NULL,
  runId        TEXT NOT NULL,
  inputTokens  INTEGER NOT NULL,
  outputTokens INTEGER NOT NULL,
  model        TEXT NOT NULL,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ith_presence_run ON ith_presence(runId);
CREATE INDEX IF NOT EXISTS ix_ith_reservations_run ON ith_reservations(runId);
CREATE INDEX IF NOT EXISTS ix_ith_costs_agent ON ith_costs(agentId);
CREATE INDEX IF NOT EXISTS ix_ith_costs_run ON ith_costs(runId);
`;

export class PresenceStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(PRESENCE_SCHEMA);
  }

  // ---- presence ----
  upsertPresence(p: AgentPresence): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_presence (agentId, runId, status, lastHeartbeat, stuckThresholdMs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(p.agentId, p.runId, p.status, p.lastHeartbeat, p.stuckThresholdMs, p.createdAt);
  }
  getPresence(agentId: string): AgentPresence | undefined {
    return this.db.prepare(`SELECT * FROM ith_presence WHERE agentId = ?`).get(agentId) as AgentPresence | undefined;
  }
  presencesForRun(runId: string): AgentPresence[] {
    return this.db.prepare(`SELECT * FROM ith_presence WHERE runId = ?`).all(runId) as AgentPresence[];
  }
  setPresenceStatus(agentId: string, status: PresenceStatus): void {
    this.db.prepare(`UPDATE ith_presence SET status = ? WHERE agentId = ?`).run(status, agentId);
  }
  heartbeat(agentId: string, ts: number): void {
    this.db.prepare(`UPDATE ith_presence SET lastHeartbeat = ?, status = 'active' WHERE agentId = ?`).run(ts, agentId);
  }
  /** Find agents whose heartbeat is older than their stuckThresholdMs. */
  detectStuck(now: number): AgentPresence[] {
    return this.db.prepare(
      `SELECT * FROM ith_presence WHERE status = 'active' AND (? - lastHeartbeat) > stuckThresholdMs`,
    ).all(now) as AgentPresence[];
  }
  markStuck(now: number): number {
    return this.db.prepare(
      `UPDATE ith_presence SET status = 'stuck' WHERE status = 'active' AND (? - lastHeartbeat) > stuckThresholdMs`,
    ).run(now).changes;
  }

  // ---- reservations ----
  reserve(r: FileReservation): boolean {
    const existing = this.db.prepare(
      `SELECT * FROM ith_reservations WHERE filePath = ? AND scope IN ('write','edit')`,
    ).get(r.filePath) as FileReservation | undefined;
    if (existing && existing.agentId !== r.agentId) return false;
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_reservations (agentId, runId, filePath, scope, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(r.agentId, r.runId, r.filePath, r.scope, r.createdAt);
    return true;
  }
  release(agentId: string, filePath?: string): void {
    if (filePath) {
      this.db.prepare(`DELETE FROM ith_reservations WHERE agentId = ? AND filePath = ?`).run(agentId, filePath);
    } else {
      this.db.prepare(`DELETE FROM ith_reservations WHERE agentId = ?`).run(agentId);
    }
  }
  reservationsForRun(runId: string): FileReservation[] {
    return this.db.prepare(`SELECT * FROM ith_reservations WHERE runId = ?`).all(runId) as FileReservation[];
  }
  isReserved(filePath: string): FileReservation | undefined {
    return this.db.prepare(
      `SELECT * FROM ith_reservations WHERE filePath = ? AND scope IN ('write','edit')`,
    ).get(filePath) as FileReservation | undefined;
  }

  // ---- costs ----
  recordCost(c: CostEntry): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_costs (id, agentId, runId, inputTokens, outputTokens, model, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(c.id, c.agentId, c.runId, c.inputTokens, c.outputTokens, c.model, c.ts);
  }
  costsForRun(runId: string): CostEntry[] {
    return this.db.prepare(`SELECT * FROM ith_costs WHERE runId = ?`).all(runId) as CostEntry[];
  }
  costSummary(runId: string, agents?: IthAgent[]): CostSummary {
    const entries = this.costsForRun(runId);
    const byAgent: Record<string, { input: number; output: number }> = {};
    const byRole: Record<string, { input: number; output: number }> = {};
    const agentRoleMap = new Map<string, string>();
    if (agents) for (const a of agents) agentRoleMap.set(a.id, a.role);

    let totalInput = 0, totalOutput = 0;
    for (const e of entries) {
      totalInput += e.inputTokens;
      totalOutput += e.outputTokens;
      const aKey = e.agentId;
      byAgent[aKey] ??= { input: 0, output: 0 };
      byAgent[aKey].input += e.inputTokens;
      byAgent[aKey].output += e.outputTokens;
      const role = agentRoleMap.get(e.agentId) ?? 'unknown';
      byRole[role] ??= { input: 0, output: 0 };
      byRole[role].input += e.inputTokens;
      byRole[role].output += e.outputTokens;
    }
    return { totalInput, totalOutput, totalTokens: totalInput + totalOutput, byAgent, byRole, entryCount: entries.length };
  }
}
