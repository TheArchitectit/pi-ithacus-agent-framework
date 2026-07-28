/**
 * ithacus-swarm.ts — pi adapter for swarm dispatch (feat 4.23).
 *
 * Bridges the pi-agnostic SwarmOrchestrator (src/swarm.ts) to pi's sub-agent
 * mechanism: PiSwarmExecutor implements SwarmExecutor by dispatching each
 * work item through a SpawnSubAgent callback that the caller wires to
 * ExtensionCommandContext.newSession + withSession. runSwarm() builds a
 * WorkQueue from a SwarmSpec, runs the orchestrator, and persists the
 * SwarmResult via SwarmStore. This is the adapter layer — pi types live
 * only in the caller, not in src/.
 */

import type { IthRuntime } from "./ithacus-runtime.js";
import { join } from "node:path";
import { WorkQueue } from "../src/queue.js";
import { SwarmOrchestrator, initHive } from "../src/swarm.js";
import { SwarmStore } from "../src/store-swarm.js";
import type { SwarmExecutor, SwarmItemResult, SwarmResult, HiveDirs } from "../src/types-sprint-5.4.js";
import type { WorkItem, WorkPriority } from "../src/types-sprint-5.1.js";

/** A single unit of swarm work, declared by the caller. */
export interface SwarmItemSpec {
  name: string;
  role?: string;
  priority?: number;
  /** NAMES of other items this one depends on (resolved to ids). */
  dependsOn?: string[];
  prompt: string;
}

/** A full swarm declaration. */
export interface SwarmSpec {
  name: string;
  items: SwarmItemSpec[];
  blockedWaitMs?: number;
  maxItems?: number;
  checkpointInterval?: number;
  maxBlockedPolls?: number;
  useHive?: boolean;
}

/** Outcome of runSwarm: the persisted storeRunId + the in-memory result. */
export interface SwarmRunOutcome {
  storeRunId: string;
  result: SwarmResult;
  hiveDirs?: HiveDirs;
}

/**
 * A function that spawns a sub-agent for a work item and returns its output.
 * The extension layer wires this to pi's sub-session mechanism
 * (ExtensionCommandContext.newSession + withSession); the logic layer never
 * touches pi directly (PREVENT-ITH-004).
 */
export type SpawnSubAgent = (prompt: string, opts: { role: string; itemName: string; model?: string }) => Promise<{ output: string; cancelled?: boolean }>;

/**
 * SwarmExecutor backed by an injected sub-agent spawner. Each work item is
 * dispatched as a general-purpose sub-agent with a role-prefixed prompt.
 */
export class PiSwarmExecutor implements SwarmExecutor {
  constructor(private spawn: SpawnSubAgent, private model?: string) {}

  now(): number { return Date.now(); }

  async dispatch(item: WorkItem): Promise<SwarmItemResult> {
    const start = Date.now();
    const payload = item.payload;
    const prompt = typeof payload === 'string' ? payload
      : (payload && typeof payload === 'object' && 'prompt' in payload)
        ? String((payload as { prompt: unknown }).prompt)
        : item.name;
    const role = item.assignedRole ?? 'general';
    const fullPrompt = `[ithacus-swarm ${role}] ${prompt}`;
    try {
      const { output, cancelled } = await this.spawn(fullPrompt, {
        role,
        itemName: item.name,
        model: this.model,
      });
      if (cancelled) {
        return { itemId: item.id, itemName: item.name, success: false, error: 'cancelled', durationMs: Date.now() - start, role };
      }
      return { itemId: item.id, itemName: item.name, success: true, output, durationMs: Date.now() - start, role };
    } catch (e) {
      return {
        itemId: item.id,
        itemName: item.name,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
        role,
      };
    }
  }
}

/**
 * Build a queue from a SwarmSpec, run the orchestrator, persist the result.
 * Depends-on names are resolved to 1-indexed queue ids (WorkQueue.nextId starts
 * at 1 and increments per addItem on a fresh queue, so item i = id i+1).
 */
export async function runSwarm(opts: {
  spawn: SpawnSubAgent;
  runtime: IthRuntime;
  spec: SwarmSpec;
  model?: string;
}): Promise<SwarmRunOutcome> {
  const queue = new WorkQueue();
  // Pre-resolve dependsOn names -> 1-indexed ids (queue ids are deterministic).
  const resolved = opts.spec.items.map((it) => ({
    ...it,
    _depIds: (it.dependsOn ?? []).map((n) => {
      const idx = opts.spec.items.findIndex((o) => o.name === n);
      return idx >= 0 ? idx + 1 : -1;
    }).filter((x) => x > 0),
  }));
  for (const it of resolved) {
    queue.addItem({
      name: it.name,
      assignedRole: it.role,
      priority: (it.priority ?? 2) as WorkPriority,
      dependsOn: it._depIds,
      payload: { prompt: it.prompt },
    });
  }

  const executor = new PiSwarmExecutor(opts.spawn, opts.model);
  const orch = new SwarmOrchestrator(executor, queue);

  let hiveDirs: HiveDirs | undefined;
  if (opts.spec.useHive) {
    hiveDirs = initHive(join(opts.runtime.currentStateDir, 'hive', opts.spec.name));
  }

  const result = await orch.dispatch({
    swarmName: opts.spec.name,
    blockedWaitMs: opts.spec.blockedWaitMs,
    maxItems: opts.spec.maxItems,
    checkpointInterval: opts.spec.checkpointInterval,
    maxBlockedPolls: opts.spec.maxBlockedPolls,
    ...(hiveDirs ? { dirs: hiveDirs } : {}),
  });

  // Persist to sqlite (PREVENT-ITH-004: local store only).
  const sStore = new SwarmStore(opts.runtime.store.db);
  const storeRunId = sStore.saveSwarmResult(result, Date.now());
  opts.runtime.appendEvent('swarm_run', {
    name: opts.spec.name,
    storeRunId,
    total: result.total,
    successful: result.successful,
    failed: result.failed,
    blocked: result.blocked,
  });

  return { storeRunId, result, ...(hiveDirs ? { hiveDirs } : {}) };
}
