/**
 * types-sprint-5.4.ts — Sprint 5.4 Swarm Dispatch + Synthesis + Hive types.
 * Split because types.ts is at 300/300 (zero headroom).
 */

import type { WorkItem, QueueCheckpoint } from './types-sprint-5.1.js';

/** Result of executing a single work item in the swarm. */
export interface SwarmItemResult {
  itemId: number;
  itemName: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  role?: string;
}

/** Aggregated result of a full swarm dispatch. */
export interface SwarmResult {
  swarmName: string;
  total: number;
  successful: number;
  failed: number;
  results: SwarmItemResult[];
  totalDurationMs: number;
  checkpoints: QueueCheckpoint[];
  /** items that were blocked (deps unmet) when dispatch ended. */
  blocked: number;
}

/** Injectable swarm executor — dispatches a single work item to an agent. */
export interface SwarmExecutor {
  /** Execute a work item, returning its output. */
  dispatch(item: WorkItem): Promise<SwarmItemResult>;
  /** Wall clock now (ms). */
  now(): number;
}

/** A synthesized result from multiple agent contributions. */
export interface SynthesizedResult {
  /** final merged output. */
  output: unknown;
  /** per-contributor attribution. */
  attribution: Array<{ agent: string; contribution: string; weight: number }>;
  /** detected conflicts (contradictory outputs). */
  conflicts: Array<{ description: string; resolution: string }>;
  /** aggregate confidence score 0-1. */
  score: number;
  /** method used (e.g. 'majority', 'weighted', 'first'). */
  method: string;
}

/** Hive filesystem directory structure. */
export interface HiveDirs {
  root: string;
  hiveMind: string;       // 00_hive_mind (LOCKS)
  locks: string;          // 00_hive_mind/LOCKS
  communication: string; // 10_communication
  inbox: string;          // 10_communication/inbox
  handoffs: string;       // 10_communication/handoffs
  alerts: string;         // 10_communication/alerts
  workspaces: string;     // 20_workspaces
  artifacts: string;      // 30_artifacts
  audit: string;          // 90_audit
  memoryArchive: string;  // 90_audit/MEMORY_ARCHIVE
  system: string;         // 99_system
}
