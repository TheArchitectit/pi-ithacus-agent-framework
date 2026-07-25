/**
 * task-store.ts — task lifecycle store (feat 4.12).
 *
 * TaskStore ABC + pluggable impls (in-memory for tests, SQLite for persistence).
 * Patterns from memory-mcp a2a/tasks.py TaskStore. pi-agnostic: uses node:sqlite
 * (local) only — PREVENT-ITH-004 (no network). DI: inject a DatabaseApi or
 * the store itself.
 */

import { DatabaseSync } from 'node:sqlite'; // guardrails-allow PREVENT-ITH-004: local node:sqlite
import type { TaskRecord, TaskStatus } from './types-sprint-5.1.js';

/** TaskStore ABC (pluggable backend). */
export interface TaskStore {
  create(name: string, input?: unknown): TaskRecord;
  get(id: string): TaskRecord | undefined;
  update(id: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): boolean;
  cancel(id: string, reason?: string): boolean;
  list(filter?: { status?: TaskStatus; agentId?: string }): TaskRecord[];
  count(): number;
}

/** In-memory task store (for tests). */
export class InMemoryTaskStore implements TaskStore {
  private tasks = new Map<string, TaskRecord>();
  private counter = 0;

  create(name: string, input?: unknown): TaskRecord {
    const id = `task-${++this.counter}`;
    const now = Date.now();
    const t: TaskRecord = { id, name, status: 'created', input, createdAt: now, updatedAt: now };
    this.tasks.set(id, t);
    return t;
  }
  get(id: string): TaskRecord | undefined { return this.tasks.get(id); }
  update(id: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): boolean {
    const t = this.tasks.get(id);
    if (!t) return false;
    Object.assign(t, patch, { updatedAt: Date.now() });
    return true;
  }
  cancel(id: string, reason?: string): boolean {
    return this.update(id, { status: 'cancelled', error: reason, completedAt: Date.now() });
  }
  list(filter?: { status?: TaskStatus; agentId?: string }): TaskRecord[] {
    let all = [...this.tasks.values()];
    if (filter?.status) all = all.filter(t => t.status === filter.status);
    if (filter?.agentId) all = all.filter(t => t.agentId === filter.agentId);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }
  count(): number { return this.tasks.size; }
}

/** SQLite-backed task store (persistent). */
export class SqliteTaskStore implements TaskStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_id TEXT,
      input TEXT,
      output TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )`);
  }

  create(name: string, input?: unknown): TaskRecord {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    this.db.prepare('INSERT INTO tasks (id,name,status,input,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, name, 'created', input === undefined ? null : JSON.stringify(input), now, now);
    return { ...this.get(id)!, input };
  }
  get(id: string): TaskRecord | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskDbRow | undefined;
    return row ? rowToTask(row) : undefined;
  }
  update(id: string, patch: Partial<Omit<TaskRecord, 'id' | 'createdAt'>>): boolean {
    const t = this.get(id);
    if (!t) return false;
    const updated = { ...t, ...patch, updatedAt: Date.now() };
    this.db.prepare('UPDATE tasks SET status=?,agent_id=?,input=?,output=?,error=?,updated_at=?,completed_at=? WHERE id=?')
      .run(updated.status, updated.agentId ?? null, updated.input === undefined ? (t.input === undefined ? null : JSON.stringify(t.input)) : JSON.stringify(updated.input), updated.output === undefined ? null : JSON.stringify(updated.output), updated.error ?? null, updated.updatedAt, updated.completedAt ?? null, id);
    return true;
  }
  cancel(id: string, reason?: string): boolean { return this.update(id, { status: 'cancelled', error: reason, completedAt: Date.now() }); }
  list(filter?: { status?: TaskStatus; agentId?: string }): TaskRecord[] {
    let sql = 'SELECT * FROM tasks';
    const conds: string[] = []; const params: unknown[] = [];
    if (filter?.status) { conds.push('status=?'); params.push(filter.status); }
    if (filter?.agentId) { conds.push('agent_id=?'); params.push(filter.agentId); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY created_at ASC';
    const rows = this.db.prepare(sql).all(...(params as never[])) as unknown as TaskDbRow[];
    return rows.map(rowToTask);
  }
  count(): number { return (this.db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }).c; }
}

interface TaskDbRow { id: string; name: string; status: string; agent_id: string | null; input: string | null; output: string | null; error: string | null; created_at: number; updated_at: number; completed_at: number | null; }

function rowToTask(r: TaskDbRow): TaskRecord {
  return { id: r.id, name: r.name, status: r.status as TaskStatus, agentId: r.agent_id ?? undefined, input: r.input ? JSON.parse(r.input) : undefined, output: r.output ? JSON.parse(r.output) : undefined, error: r.error ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at ?? undefined };
}

/** Create an in-memory task store. */
export function createTaskStore(): TaskStore { return new InMemoryTaskStore(); }
/** Create a SQLite-backed task store over a node:sqlite DatabaseSync. */
export function createSqliteTaskStore(db: DatabaseSync): TaskStore { return new SqliteTaskStore(db); }
