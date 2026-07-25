/**
 * scheduler.ts — scheduled runs (feat 4.10): cron, interval, one-shot.
 *
 * pi-agnostic: src/ uses an injectable ScheduleClock (now + setTimeout +
 * clearTimeout) so the engine is fully unit-testable with a fake clock;
 * extensions/ wires node:timers or a real cron daemon. Zero network
 * (PREVENT-ITH-004 — no annotation needed).
 *
 * Cron parser is a minimal 5-field subset (min hour dom month dow):
 * supports '*', 'step/N', single integers, and comma lists. No ranges/L/W/#
 * (extensions/ can inject a full cron library via ScheduleTransport).
 */

import type { ScheduleSpec, ScheduleEntry } from './types-sprint-4.5.js';

/** Injectable clock + timer transport (DI for testability). */
export interface ScheduleClock {
  now(): number;
  /** schedule a callback at ms-after-now; returns a cancel handle. */
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The task to run on each fire. */
export type ScheduleTask = (entry: ScheduleEntry) => Promise<void>;

let entryCounter = 0;

/** Parse a single 5-field cron field into a sorted list of allowed values. */
function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) out.add(i);
    } else if (trimmed.startsWith('*/')) {
      const step = parseInt(trimmed.slice(2), 10);
      if (isNaN(step) || step <= 0) throw new Error(`invalid step: ${trimmed}`);
      for (let i = min; i <= max; i += step) out.add(i);
    } else {
      const v = parseInt(trimmed, 10);
      if (isNaN(v) || v < min || v > max) throw new Error(`invalid value: ${trimmed} (range ${min}-${max})`);
      out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Compute the next fire time (epoch ms) for a 5-field cron expr after `from`. */
export function nextCronFire(cron: string, from: number): number {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron must have 5 fields, got ${fields.length}`);
  const minutes = parseField(fields[0], 0, 59);
  const hours = parseField(fields[1], 0, 23);
  const doms = parseField(fields[2], 1, 31);
  const months = parseField(fields[3], 1, 12);
  const dows = parseField(fields[4], 0, 6);
  const d = new Date(from);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);  // start searching from next minute
  // search up to ~366 days to avoid infinite loop
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (months.includes(d.getUTCMonth() + 1) && doms.includes(d.getUTCDate()) && dows.includes(d.getUTCDay()) && hours.includes(d.getUTCHours()) && minutes.includes(d.getUTCMinutes())) {
      return d.getTime();
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  throw new Error('no fire time found within 366 days');
}

/** Compute the next fire time for any spec kind. */
export function nextFire(spec: ScheduleSpec, from: number): number | null {
  if (spec.kind === 'one-shot') return spec.atMs ?? null;
  if (spec.kind === 'interval') return from + (spec.intervalMs ?? 0);
  if (spec.kind === 'cron') return spec.cron ? nextCronFire(spec.cron, from) : null;
  return null;
}

/** The scheduler. */
export class Scheduler {
  private entries = new Map<string, ScheduleEntry>();
  private handles = new Map<string, unknown>();
  private clock: ScheduleClock;
  private task: ScheduleTask;
  constructor(clock: ScheduleClock, task: ScheduleTask) {
    this.clock = clock;
    this.task = task;
  }

  /** Register a schedule; returns the entry id. */
  register(spec: ScheduleSpec): string {
    if (spec.kind === 'interval' && (!spec.intervalMs || spec.intervalMs <= 0)) throw new Error('intervalMs must be > 0');
    if (spec.kind === 'one-shot' && !spec.atMs) throw new Error('atMs required for one-shot');
    if (spec.kind === 'cron' && !spec.cron) throw new Error('cron expression required for cron kind');
    const id = spec.id ?? `sched-${++entryCounter}`;
    if (this.entries.has(id)) throw new Error(`schedule already registered: ${id}`);
    const now = this.clock.now();
    const nf = nextFire(spec, now);
    const entry: ScheduleEntry = { id, spec, status: nf === null ? 'completed' : 'pending', nextFire: nf, fires: 0, lastFire: null, createdAt: now };
    this.entries.set(id, entry);
    if (nf !== null) this.arm(id, nf - now);
    return id;
  }

  private arm(id: string, ms: number): void {
    if (ms < 0) ms = 0;
    const handle = this.clock.setTimeout(() => { void this.fire(id); }, ms);
    this.handles.set(id, handle);
  }

  private async fire(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.status === 'cancelled') return;
    // deadline auto-cancel
    if (entry.spec.deadlineMs && entry.spec.deadlineMs > 0 && this.clock.now() > entry.spec.deadlineMs) {
      entry.status = 'deadline-exceeded';
      entry.nextFire = null;
      return;
    }
    entry.status = 'running';
    entry.lastFire = this.clock.now();
    entry.fires++;
    try {
      await this.task(entry);
    } catch (e) {
      entry.status = 'failed';
      entry.lastError = e instanceof Error ? e.message : String(e);
      return;
    }
    if ((entry.status as ScheduleEntry['status']) === 'cancelled') { entry.nextFire = null; return; }
    // maxRuns auto-cancel
    if (entry.spec.maxRuns && entry.spec.maxRuns > 0 && entry.fires >= entry.spec.maxRuns) {
      entry.status = 'completed';
      entry.nextFire = null;
      return;
    }
    // schedule next fire
    if (entry.spec.kind === 'one-shot') {
      entry.status = 'completed';
      entry.nextFire = null;
    } else {
      const nf = nextFire(entry.spec, this.clock.now());
      entry.nextFire = nf;
      entry.status = 'pending';
      if (nf !== null) this.arm(id, nf - this.clock.now());
    }
  }

  /** List all entries. */
  list(): ScheduleEntry[] { return [...this.entries.values()]; }
  /** Get one entry. */
  get(id: string): ScheduleEntry | undefined { return this.entries.get(id); }
  /** Cancel a schedule. */
  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const handle = this.handles.get(id);
    if (handle !== undefined) this.clock.clearTimeout(handle);
    this.handles.delete(id);
    entry.status = 'cancelled';
    entry.nextFire = null;
    return true;
  }
  /** Cancel all. */
  cancelAll(): void {
    for (const id of [...this.entries.keys()]) this.cancel(id);
  }
}

/** Create a scheduler over an injected clock. */
export function createScheduler(clock: ScheduleClock, task: ScheduleTask): Scheduler {
  return new Scheduler(clock, task);
}
