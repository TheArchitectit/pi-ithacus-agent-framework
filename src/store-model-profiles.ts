/**
 * store-model-profiles.ts — model profiles + team assignments tables + methods.
 *
 * Extends the IthStore with Sprint 1.4 tables. Separated to keep store.ts
 * under the 300-line limit (mirrors the store-presence.ts pattern).
 *
 * pi-agnostic: depends only on node:sqlite (via DatabaseSync) + types.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { ModelProfile, TeamModelAssignment, AgentRole } from './types.js';

const PROFILE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ith_model_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL,
  model         TEXT NOT NULL,
  fallbackModels TEXT NOT NULL DEFAULT '[]',
  description   TEXT NOT NULL,
  costMultiplier REAL NOT NULL,
  isBuiltIn     INTEGER NOT NULL DEFAULT 0,
  createdAt     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ith_team_model_assignments (
  runId      TEXT NOT NULL,
  role       TEXT NOT NULL,
  profileId  TEXT NOT NULL,
  model      TEXT NOT NULL,
  createdAt  INTEGER NOT NULL,
  PRIMARY KEY (runId, role)
);
CREATE INDEX IF NOT EXISTS ix_ith_assignments_run ON ith_team_model_assignments(runId);
`;

export class ModelProfileStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(PROFILE_SCHEMA);
  }

  // ---- profile CRUD ----
  upsertProfile(p: ModelProfile): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_model_profiles
         (id, name, tier, model, fallbackModels, description, costMultiplier, isBuiltIn, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.id, p.name, p.tier, p.model, JSON.stringify(p.fallbackModels),
          p.description, p.costMultiplier, p.isBuiltIn ? 1 : 0, p.createdAt);
  }
  getProfile(id: string): ModelProfile | undefined {
    const row = this.db.prepare(`SELECT * FROM ith_model_profiles WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToProfile(row) : undefined;
  }
  listProfiles(): ModelProfile[] {
    return (this.db.prepare(`SELECT * FROM ith_model_profiles ORDER BY tier`).all() as Array<Record<string, unknown>>)
      .map(r => this.rowToProfile(r));
  }
  deleteProfile(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM ith_model_profiles WHERE id = ? AND isBuiltIn = 0`).run(id);
    return r.changes > 0;
  }
  /** Seed built-in profiles if the table is empty. Idempotent. */
  seedBuiltins(profiles: ModelProfile[]): number {
    const count = (this.db.prepare(`SELECT COUNT(*) AS n FROM ith_model_profiles WHERE isBuiltIn = 1`).get() as { n: number }).n;
    if (count > 0) return 0;
    for (const p of profiles) this.upsertProfile(p);
    return profiles.length;
  }

  private rowToProfile(row: Record<string, unknown>): ModelProfile {
    return {
      id: String(row.id),
      name: String(row.name),
      tier: String(row.tier) as ModelProfile['tier'],
      model: String(row.model),
      fallbackModels: parseJsonArray(row.fallbackModels as string | null),
      description: String(row.description),
      costMultiplier: Number(row.costMultiplier),
      isBuiltIn: Boolean(row.isBuiltIn),
      createdAt: Number(row.createdAt),
    };
  }

  // ---- assignments ----
  assignRole(a: TeamModelAssignment): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_team_model_assignments (runId, role, profileId, model, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(a.runId, a.role, a.profileId, a.model, a.createdAt);
  }
  assignmentsForRun(runId: string): TeamModelAssignment[] {
    return (this.db.prepare(`SELECT * FROM ith_team_model_assignments WHERE runId = ?`).all(runId) as Array<Record<string, unknown>>)
      .map(r => ({
        runId: String(r.runId),
        role: String(r.role) as AgentRole,
        profileId: String(r.profileId),
        model: String(r.model),
        createdAt: Number(r.createdAt),
      }));
  }
  assignmentForRole(runId: string, role: AgentRole): TeamModelAssignment | undefined {
    return this.assignmentsForRun(runId).find(a => a.role === role);
  }
  clearAssignments(runId: string): void {
    this.db.prepare(`DELETE FROM ith_team_model_assignments WHERE runId = ?`).run(runId);
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.map(String) : []; }
  catch { return []; }
}
