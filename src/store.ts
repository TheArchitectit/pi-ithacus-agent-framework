/** store.ts — local node:sqlite store for ithacus. Zero network (PREVENT-ITH-004). */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process"; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: read-only `git rev-parse` to scope memory per-repo
import {
  repoStateDir,
  STATE_DIR_DEFAULT,
  type IthacusConfig,
} from "./config.js";
import type {
  IthRun,
  IthAgent,
  IthTask,
  IthInboxMessage,
  IthMemory,
  MemoryKind,
  WorktreeConfig,
  AsyncRunState,
  AsyncRunStatus,
} from "./types.js";

function parseDependsOn(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.map(String) : []; }
  catch { return []; }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ith_runs (runId TEXT PRIMARY KEY, modePreset TEXT NOT NULL, createdAt INTEGER NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ith_agents (id TEXT PRIMARY KEY, runId TEXT NOT NULL, role TEXT NOT NULL, model TEXT NOT NULL, provider TEXT, status TEXT NOT NULL, lastSeen INTEGER NOT NULL, resultSchema TEXT, resultValidated INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ith_tasks (id TEXT PRIMARY KEY, runId TEXT NOT NULL, title TEXT NOT NULL, ownerClaim TEXT, status TEXT NOT NULL, dependsOn TEXT NOT NULL DEFAULT '[]', wave INTEGER, phase TEXT);
CREATE TABLE IF NOT EXISTS ith_inbox (id TEXT PRIMARY KEY, agentId TEXT NOT NULL, fromAgent TEXT, payload TEXT NOT NULL, ts INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ith_memories (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, repoId TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ith_worktrees (agentId TEXT PRIMARY KEY, runId TEXT NOT NULL, path TEXT NOT NULL, branch TEXT NOT NULL, cleaned INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ith_async_runs (runId TEXT PRIMARY KEY, status TEXT NOT NULL, pid INTEGER, logPath TEXT NOT NULL, exitCode INTEGER, startedAt INTEGER NOT NULL, completedAt INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS ith_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_ith_agents_run ON ith_agents(runId);
CREATE INDEX IF NOT EXISTS ix_ith_tasks_run ON ith_tasks(runId);
CREATE INDEX IF NOT EXISTS ix_ith_inbox_agent ON ith_inbox(agentId, read);
CREATE INDEX IF NOT EXISTS ix_ith_mem_repo ON ith_memories(repoId, kind);
CREATE INDEX IF NOT EXISTS ix_ith_worktrees_run ON ith_worktrees(runId);
CREATE INDEX IF NOT EXISTS ix_ith_async_status ON ith_async_runs(status);
`;

export class IthStore {
  readonly db: DatabaseSync;
  readonly stateDir: string;

  constructor(cwd: string | undefined, config: IthacusConfig) {
    this.stateDir = repoStateDir(cwd, STATE_DIR_DEFAULT);
    mkdirSync(this.stateDir, { recursive: true });
    this.db = new DatabaseSync(join(this.stateDir, "sqlite.db"));
    this.db.exec(SCHEMA);
    this.migrateSchema();
  }

  /** Backward-compat migration: add columns absent on existing DB. Idempotent. */
  migrateSchema(): void {
    const cols = (table: string): Set<string> =>
      new Set(
        (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (r) => r.name,
        ),
      );

    const agentCols = cols("ith_agents");
    if (!agentCols.has("resultSchema")) {
      this.db.exec(`ALTER TABLE ith_agents ADD COLUMN resultSchema TEXT`);
    }
    if (!agentCols.has("resultValidated")) {
      this.db.exec(
        `ALTER TABLE ith_agents ADD COLUMN resultValidated INTEGER NOT NULL DEFAULT 0`,
      );
    }

    const taskCols = cols("ith_tasks");
    if (!taskCols.has("dependsOn")) {
      this.db.exec(`ALTER TABLE ith_tasks ADD COLUMN dependsOn TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!taskCols.has("wave")) {
      this.db.exec(`ALTER TABLE ith_tasks ADD COLUMN wave INTEGER`);
    }
    if (!taskCols.has("phase")) {
      this.db.exec(`ALTER TABLE ith_tasks ADD COLUMN phase TEXT`);
    }
  }

  createRun(run: IthRun): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_runs (runId, modePreset, createdAt, summary, status)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(run.runId, run.modePreset, run.createdAt, run.summary, run.status);
  }
  setRunStatus(runId: string, status: IthRun["status"]): void {
    this.db.prepare(`UPDATE ith_runs SET status = ? WHERE runId = ?`).run(status, runId);
  }
  getRun(runId: string): IthRun | undefined {
    return this.db.prepare(`SELECT * FROM ith_runs WHERE runId = ?`).get(runId) as
      | IthRun
      | undefined;
  }

  upsertAgent(a: IthAgent): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_agents
         (id, runId, role, model, provider, status, lastSeen, resultSchema, resultValidated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      a.id,
      a.runId,
      a.role,
      a.model,
      a.provider,
      a.status,
      a.lastSeen,
      a.resultSchema ?? null,
      a.resultValidated ? 1 : 0,
    );
  }
  agentsForRun(runId: string): IthAgent[] {
    return this.db.prepare(`SELECT * FROM ith_agents WHERE runId = ? ORDER BY role`).all(runId).map(
      (row: Record<string, unknown>): IthAgent => ({
        ...(row as unknown as IthAgent),
        resultValidated: Boolean((row as { resultValidated?: unknown }).resultValidated),
      }),
    ) as IthAgent[];
  }

  createTask(t: IthTask): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_tasks
         (id, runId, title, ownerClaim, status, dependsOn, wave, phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      t.id,
      t.runId,
      t.title,
      t.ownerClaim,
      t.status,
      JSON.stringify(t.dependsOn ?? []),
      t.wave ?? null,
      t.phase ?? null,
    );
  }
  /** Claim a task for an agent; returns false if already claimed by someone else. */
  claimTask(taskId: string, agentId: string): boolean {
    const rawT = this.db.prepare(`SELECT * FROM ith_tasks WHERE id = ?`).get(taskId) as
      | (IthTask & { dependsOn?: string | null })
      | undefined;
    const t = rawT
      ? { ...rawT, dependsOn: parseDependsOn(rawT.dependsOn) }
      : undefined;
    if (!t) return false;
    if (t.ownerClaim && t.ownerClaim !== agentId) return false;
    this.db.prepare(`UPDATE ith_tasks SET ownerClaim = ?, status = 'claimed' WHERE id = ?`)
      .run(agentId, taskId);
    return true;
  }
  openTasks(runId: string): IthTask[] {
    return this.db.prepare(`SELECT * FROM ith_tasks WHERE runId = ? AND status != 'completed'`).all(runId).map(
      (row: Record<string, unknown>): IthTask => ({
        ...(row as unknown as IthTask),
        dependsOn: parseDependsOn((row as { dependsOn?: string | null }).dependsOn),
      }),
    ) as IthTask[];
  }

  sendMessage(m: IthInboxMessage): void {
    this.db.prepare(
      `INSERT INTO ith_inbox (id, agentId, fromAgent, payload, ts, read)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(m.id, m.agentId, m.fromAgent, m.payload, m.ts);
  }
  unread(agentId: string): IthInboxMessage[] {
    return this.db.prepare(`SELECT * FROM ith_inbox WHERE agentId = ? AND read = 0 ORDER BY ts`).all(agentId) as unknown as IthInboxMessage[];
  }
  markRead(id: string): void {
    this.db.prepare(`UPDATE ith_inbox SET read = 1 WHERE id = ?`).run(id);
  }

  addMemory(m: IthMemory): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_memories (id, kind, text, repoId, ts)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(m.id, m.kind, m.text, m.repoId, m.ts);
  }
  /** Recall memories for a repo, optionally filtered by kind. */
  recall(repoId: string, kind?: MemoryKind, limit = 8): IthMemory[] {
    const sql = kind
      ? `SELECT * FROM ith_memories WHERE repoId = ? AND kind = ? ORDER BY ts DESC LIMIT ?`
      : `SELECT * FROM ith_memories WHERE repoId = ? ORDER BY ts DESC LIMIT ?`;
    const args = kind ? [repoId, kind, limit] : [repoId, limit];
    return this.db.prepare(sql).all(...args) as unknown as IthMemory[];
  }

  saveWorktree(w: WorktreeConfig): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_worktrees (agentId, runId, path, branch, cleaned, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(w.agentId, w.runId, w.path, w.branch, w.cleaned ? 1 : 0, w.createdAt);
  }
  getWorktree(agentId: string): WorktreeConfig | undefined {
    const row = this.db.prepare(`SELECT * FROM ith_worktrees WHERE agentId = ?`).get(agentId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      agentId: String(row.agentId),
      runId: String(row.runId),
      path: String(row.path),
      branch: String(row.branch),
      cleaned: Boolean(row.cleaned),
      createdAt: Number(row.createdAt),
    };
  }
  worktreesForRun(runId: string): WorktreeConfig[] {
    return (this.db.prepare(`SELECT * FROM ith_worktrees WHERE runId = ?`).all(runId) as Array<Record<string, unknown>>).map(
      (row): WorktreeConfig => ({
        agentId: String(row.agentId),
        runId: String(row.runId),
        path: String(row.path),
        branch: String(row.branch),
        cleaned: Boolean(row.cleaned),
        createdAt: Number(row.createdAt),
      }),
    );
  }
  markWorktreeCleaned(agentId: string): void {
    this.db.prepare(`UPDATE ith_worktrees SET cleaned = 1 WHERE agentId = ?`).run(agentId);
  }

  saveAsyncRun(a: AsyncRunState): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ith_async_runs (runId, status, pid, logPath, exitCode, startedAt, completedAt, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(a.runId, a.status, a.pid ?? null, a.logPath, a.exitCode ?? null, a.startedAt, a.completedAt ?? null, a.error ?? null);
  }
  getAsyncRun(runId: string): AsyncRunState | undefined {
    return this.db.prepare(`SELECT * FROM ith_async_runs WHERE runId = ?`).get(runId) as
      | AsyncRunState
      | undefined;
  }
  asyncRunsByStatus(status: AsyncRunStatus): AsyncRunState[] {
    return this.db.prepare(`SELECT * FROM ith_async_runs WHERE status = ?`).all(status) as unknown as AsyncRunState[];
  }
  setAsyncRunStatus(runId: string, status: AsyncRunStatus, opts?: { pid?: number; exitCode?: number; completedAt?: number; error?: string }): void {
    const parts: string[] = [`status = ?`];
    const args: (string | number)[] = [status];
    if (opts?.pid !== undefined) { parts.push(`pid = ?`); args.push(opts.pid); }
    if (opts?.exitCode !== undefined) { parts.push(`exitCode = ?`); args.push(opts.exitCode); }
    if (opts?.completedAt !== undefined) { parts.push(`completedAt = ?`); args.push(opts.completedAt); }
    if (opts?.error !== undefined) { parts.push(`error = ?`); args.push(opts.error); }
    args.push(runId);
    this.db.prepare(`UPDATE ith_async_runs SET ${parts.join(', ')} WHERE runId = ?`).run(...args);
  }

  // ---- key-value (onboarding flags, etc.) ----
  getKv(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM ith_kv WHERE key = ?`).get(key) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  }
  setKv(key: string, value: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO ith_kv (key, value) VALUES (?, ?)`).run(key, value);
  }
  /**
   * Mark the first-use onboarding notice as seen for this repo. Returns TRUE
   * if this call was the first (onboarding had NOT been seen before this
   * call), FALSE if already seen. The caller shows the one-shot notice on true.
   * Per-repo: ith_kv lives in <repo>/.pi/ithacus/sqlite.db.
   */
  markOnboardingSeen(): boolean {
    if (this.getKv("onboarding_seen") === "1") return false;
    this.setKv("onboarding_seen", "1");
    return true;
  }
  isOnboardingSeen(): boolean {
    return this.getKv("onboarding_seen") === "1";
  }

  close(): void {
    this.db.close();
  }
}

/** Convenience: derive a stable repo_id from a cwd (used for memory scoping). */
export function repoIdFromCwd(cwd: string | undefined): string {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: cwd ?? ".",
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root || cwd || "global";
  } catch {
    return cwd || "global";
  }
}
