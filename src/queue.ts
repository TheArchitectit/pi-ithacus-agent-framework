/**
 * queue.ts — priority work-queue state machine (feat 4.11).
 *
 * Patterns borrowed from memory-mcp swarm.py WorkQueue (P0-P3 priority,
 * INGRESS→NEXT→NOW→DONE/FAILED, per-item depends_on gating, audit log,
 * checkpoints). pi-agnostic + zero-network (PREVENT-ITH-004).
 */

import type { WorkItem, WorkPriority, WorkStatus, QueueCheckpoint, QueueLogEntry } from './types-sprint-5.1.js';

/** Injectable clock (DI for testability). */
export interface QueueClock {
  now(): number;
}

const defaultClock: QueueClock = { now: () => Date.now() };

/** Priority work queue with dependency gating + audit log + checkpoints. */
export class WorkQueue {
  private items = new Map<number, WorkItem>();
  private nextId = 1;
  private logId = 1;
  private log: QueueLogEntry[] = [];
  private checkpointId = 1;
  private clock: QueueClock;

  constructor(clock: QueueClock = defaultClock) {
    this.clock = clock;
  }

  /** Add a work item; returns its id. */
  addItem(opts: Pick<WorkItem, 'name'> & Partial<Omit<WorkItem, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'status'>>): number {
    const now = this.clock.now();
    const id = this.nextId++;
    const item: WorkItem = {
      id,
      name: opts.name,
      assignedRole: opts.assignedRole,
      priority: opts.priority ?? 2,
      status: 'pending',
      dependsOn: opts.dependsOn ?? [],
      payload: opts.payload,
      createdAt: now,
      updatedAt: now,
      deadlineMs: opts.deadlineMs,
    };
    this.items.set(id, item);
    this.logAction(id, 'add', item.status, opts.assignedRole);
    // auto-advance pending→ingress→next if deps satisfied
    this.tryAdvance(id);
    return id;
  }

  /** Get a single item. */
  getItem(id: number): WorkItem | undefined { return this.items.get(id); }

  /** Get all items by status. */
  getItems(status?: WorkStatus): WorkItem[] {
    const all = [...this.items.values()];
    return status ? all.filter(i => i.status === status) : all;
  }

  /** Check if an item's dependencies are satisfied (all deps done). */
  private depsMet(id: number): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    return item.dependsOn.every(depId => {
      const dep = this.items.get(depId);
      return dep?.status === 'done';
    });
  }

  /** Try to advance an item through pending→blocked→next if deps are met. */
  private tryAdvance(id: number): void {
    const item = this.items.get(id);
    if (!item) return;
    const pending = item.status === 'pending' || item.status === 'blocked';
    if (pending && this.depsMet(id)) {
      this.updateStatus(id, 'next', undefined, 'deps met');
    } else if (item.status === 'pending' && item.dependsOn.length > 0 && !this.depsMet(id)) {
      this.updateStatus(id, 'blocked', undefined, 'waiting on deps');
    }
  }

  /** Update an item's status (records timestamp + log). */
  updateStatus(id: number, status: WorkStatus, result?: string, reason?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = status;
    item.updatedAt = this.clock.now();
    if (result !== undefined) item.result = result;
    if (status === 'failed' && reason) item.error = reason;
    this.logAction(id, 'status', status, item.assignedRole, undefined, reason ? { reason } : undefined);
    // when an item completes, try to advance dependents
    if (status === 'done' || status === 'failed') {
      for (const other of this.items.values()) {
        if (other.dependsOn.includes(id) && other.status === 'blocked') this.tryAdvance(other.id);
      }
    }
    return true;
  }

  /** Get ready items (status=next) sorted by priority then created. Returns at most limit. */
  getReadyItems(limit = 10): WorkItem[] {
    return this.getItems('next')
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
      .slice(0, limit)
      .map(item => { this.updateStatus(item.id, 'now'); return item; });
  }

  /** Claim the next ready item (moves to now, returns it). */
  claimNext(): WorkItem | undefined {
    const ready = this.getReadyItems(1);
    return ready[0];
  }

  /** Mark item done with a result. */
  complete(id: number, result?: string): boolean { return this.updateStatus(id, 'done', result); }

  /** Mark item failed with an error. */
  fail(id: number, error: string): boolean { return this.updateStatus(id, 'failed', undefined, error); }

  /** Check dependencies for an item (explicit). */
  checkDependencies(id: number): { met: boolean; pending: number[] } {
    const item = this.items.get(id);
    if (!item) return { met: false, pending: [] };
    const pending = item.dependsOn.filter(depId => {
      const dep = this.items.get(depId);
      return !dep || dep.status !== 'done';
    });
    return { met: pending.length === 0, pending };
  }

  /** Get items past their deadline (status not done/failed). */
  overdueItems(): WorkItem[] {
    const now = this.clock.now();
    return [...this.items.values()].filter(i =>
      i.deadlineMs && i.deadlineMs > 0 && i.deadlineMs < now && i.status !== 'done' && i.status !== 'failed'
    );
  }

  /** Log an action (audit trail). */
  private logAction(itemId: number, action: string, status: string, role?: string, durationMs?: number, metadata?: Record<string, unknown>): void {
    this.log.push({ id: this.logId++, itemId, action, status, role, durationMs, metadata, ts: this.clock.now() });
  }

  /** Get the audit log. */
  getLog(): QueueLogEntry[] { return [...this.log]; }

  /** Save a checkpoint snapshot. */
  saveCheckpoint(): QueueCheckpoint {
    const items = [...this.items.values()].map(i => ({ ...i, dependsOn: [...i.dependsOn] }));
    const doneCount = items.filter(i => i.status === 'done').length;
    return { id: this.checkpointId++, items, createdAt: this.clock.now(), doneCount };
  }

  /** Restore from a checkpoint. */
  restoreCheckpoint(cp: QueueCheckpoint): void {
    this.items.clear();
    for (const item of cp.items) this.items.set(item.id, { ...item, dependsOn: [...item.dependsOn] });
    const maxId = Math.max(0, ...cp.items.map(i => i.id));
    this.nextId = maxId + 1;
  }

  /** Queue stats. */
  stats(): { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> } {
    const all = [...this.items.values()];
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const i of all) { byStatus[i.status] = (byStatus[i.status] ?? 0) + 1; byPriority[String(i.priority)] = (byPriority[String(i.priority)] ?? 0) + 1; }
    return { total: all.length, byStatus, byPriority };
  }

  /** Clear all items + log. */
  clear(): void { this.items.clear(); this.log = []; this.nextId = 1; this.logId = 1; this.checkpointId = 1; }
}

export function createWorkQueue(clock?: QueueClock): WorkQueue { return new WorkQueue(clock); }
