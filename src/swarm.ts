/**
 * swarm.ts — swarm dispatch loop + hive filesystem (feat 4.18, 4.21).
 *
 * Patterns from memory-mcp swarm.py SwarmOrchestrator.swarm_dispatch
 * (priority-ordered, blocked-wait, checkpoint-every-N, result aggregation).
 * pi-agnostic: in-process, zero-network (PREVENT-ITH-004). Uses WorkQueue
 * (Sprint 5.1) + injectable SwarmExecutor (real agent dispatch in extensions/).
 */

import { mkdirSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WorkQueue } from './queue.js';
import type { WorkItem, QueueCheckpoint } from './types-sprint-5.1.js';
import type { SwarmExecutor, SwarmItemResult, SwarmResult, HiveDirs } from './types-sprint-5.4.js';

const DEFAULT_DIRS: Array<[keyof HiveDirs, string]> = [
  ['hiveMind', '00_hive_mind'],
  ['locks', '00_hive_mind/LOCKS'],
  ['communication', '10_communication'],
  ['inbox', '10_communication/inbox'],
  ['handoffs', '10_communication/handoffs'],
  ['alerts', '10_communication/alerts'],
  ['workspaces', '20_workspaces'],
  ['artifacts', '30_artifacts'],
  ['audit', '90_audit'],
  ['memoryArchive', '90_audit/MEMORY_ARCHIVE'],
  ['system', '99_system'],
];

/** Create the .pi/ithacus hive directory structure. Returns the resolved dirs. */
export function initHive(root: string): HiveDirs {
  const dirs: HiveDirs = { root, hiveMind: '', locks: '', communication: '', inbox: '', handoffs: '', alerts: '', workspaces: '', artifacts: '', audit: '', memoryArchive: '', system: '' };
  const rec = dirs as unknown as Record<string, string>;
  for (const [key, rel] of DEFAULT_DIRS) {
    const p = join(root, rel);
    mkdirSync(p, { recursive: true });
    rec[key] = p;
  }
  // seed a .hive sentinel so the dir is non-empty (git-friendly)
  const sentinel = join(root, '.hive');
  if (!existsSync(sentinel)) writeFileSync(sentinel, `ithacus hive root\ncreated ${new Date().toISOString()}\n`);
  return dirs;
}

/** Tear down a hive (recursive rm). */
export function teardownHive(root: string): void {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

/** Acquire a hive lock (file-based, advisory). Returns release fn or null if held. */
export function acquireHiveLock(dirs: HiveDirs, lockName: string, holder: string): (() => void) | null {
  const lockPath = join(dirs.locks, `${lockName}.lock`);
  if (existsSync(lockPath)) return null;
  writeFileSync(lockPath, JSON.stringify({ holder, ts: Date.now() }));
  return () => { try { rmSync(lockPath); } catch { /* already removed */ } };
}

/** Write an artifact to the hive artifacts dir. */
export function writeArtifact(dirs: HiveDirs, name: string, content: string): string {
  const p = join(dirs.artifacts, name);
  writeFileSync(p, content);
  return p;
}

/** Append an audit entry to the hive audit dir. */
export function appendAudit(dirs: HiveDirs, name: string, entry: Record<string, unknown>): string {
  const p = join(dirs.audit, `${name}.log`);
  writeFileSync(p, JSON.stringify(entry) + '\n', { flag: 'a' });
  return p;
}

/** List files in a hive dir (returns [] if missing). */
export function listHiveDir(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath);
}

/** Swarm orchestrator — dispatch loop over a WorkQueue. */
export class SwarmOrchestrator {
  private queue: WorkQueue;
  private executor: SwarmExecutor;
  constructor(executor: SwarmExecutor, queue?: WorkQueue) {
    this.executor = executor;
    this.queue = queue ?? new WorkQueue();
  }

  /** Get the underlying queue (for adding items before dispatch). */
  getQueue(): WorkQueue { return this.queue; }

  /** Dispatch the swarm: process ready items in priority order until none remain. */
  async dispatch(opts: {
    swarmName: string;
    enableCheckpoint?: boolean;
    checkpointInterval?: number;
    /** max items to process (0 = unlimited). */
    maxItems?: number;
    /** poll interval ms when blocked (default 0 = no wait, return immediately if blocked). */
    blockedWaitMs?: number;
    /** max blocked-wait poll iterations before giving up (default 100). */
    maxBlockedPolls?: number;
    /** optional hive dirs for audit logging. */
    dirs?: HiveDirs;
  }): Promise<SwarmResult> {
    const start = this.executor.now();
    const enableCheckpoint = opts.enableCheckpoint ?? true;
    const interval = opts.checkpointInterval ?? 30;
    const maxBlockedPolls = opts.maxBlockedPolls ?? 100;
    const results: SwarmItemResult[] = [];
    const checkpoints: QueueCheckpoint[] = [];
    let processed = 0;
    const max = opts.maxItems ?? 0;
    let blocked = 0;
    let polls = 0;
    while (true) {
      // P2: check max BEFORE claiming an item (getReadyItems moves it to 'now')
      if (max > 0 && processed >= max) break;
      const ready = this.queue.getReadyItems(1);
      if (ready.length === 0) {
        // check if there are next items still blocked
        const nextItems = this.queue.getItems('next');
        const blockedItems = this.queue.getItems('blocked');
        if (nextItems.length === 0 && blockedItems.length === 0) break;  // all done
        if (blockedItems.length > 0 && nextItems.length === 0) {
          blocked = blockedItems.length;
          if (opts.blockedWaitMs && opts.blockedWaitMs > 0) {
            // P1: cap polls to avoid livelock when deps failed (no progress possible)
            if (++polls > maxBlockedPolls) break;
            await sleep(opts.blockedWaitMs);
            continue;  // re-check after wait
          }
          break;  // can't progress, return
        }
        break;  // no ready items
      }
      polls = 0;  // item ready → reset no-progress counter
      const item = ready[0];
      // P3: capture a throwing executor as a failure (don't crash/strand the item)
      let r: SwarmItemResult;
      try {
        r = await this.executor.dispatch(item);
      } catch (err) {
        r = { itemId: item.id, itemName: item.name, success: false, error: err instanceof Error ? err.message : String(err), durationMs: 0 };
      }
      results.push(r);
      processed++;
      if (r.success) this.queue.complete(item.id, typeof r.output === 'string' ? r.output : JSON.stringify(r.output));
      else this.queue.fail(item.id, r.error ?? 'failed');
      if (opts.dirs) appendAudit(opts.dirs, 'swarm', { swarm: opts.swarmName, item: item.id, name: item.name, success: r.success, durationMs: r.durationMs, ts: this.executor.now() });
      // checkpoint every N completed items
      if (enableCheckpoint && processed % interval === 0) {
        const cp = this.queue.saveCheckpoint();
        checkpoints.push(cp);
      }
    }
    const all = this.queue.getItems();
    const failed = all.filter(i => i.status === 'failed').length;
    const successful = all.filter(i => i.status === 'done').length;
    const stillBlocked = all.filter(i => i.status === 'blocked').length;
    return {
      swarmName: opts.swarmName,
      total: all.length,
      successful,
      failed,
      results,
      totalDurationMs: this.executor.now() - start,
      checkpoints,
      blocked: stillBlocked,
    };
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

export function createSwarmOrchestrator(executor: SwarmExecutor, queue?: WorkQueue): SwarmOrchestrator {
  return new SwarmOrchestrator(executor, queue);
}
