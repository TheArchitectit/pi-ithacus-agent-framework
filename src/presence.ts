/**
 * presence.ts — agent presence tracking with heartbeat + stuck detection.
 *
 * Thin orchestration layer over PresenceStore that adds:
 * - join/leave lifecycle
 * - heartbeat with configurable interval
 * - stuck detection (no heartbeat = stuck)
 *
 * pi-agnostic.
 */

import type { AgentPresence, PresenceStatus } from './types.js';
import type { PresenceStore } from './store-presence.js';

export const DEFAULT_STUCK_THRESHOLD_MS = 30_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Register an agent as present. Creates an AgentPresence row with status='active'.
 */
export function joinPresence(
  store: PresenceStore,
  agentId: string,
  runId: string,
  stuckThresholdMs = DEFAULT_STUCK_THRESHOLD_MS,
  now = Date.now(),
): AgentPresence {
  const p: AgentPresence = {
    agentId,
    runId,
    status: 'active',
    lastHeartbeat: now,
    stuckThresholdMs,
    createdAt: now,
  };
  store.upsertPresence(p);
  return p;
}

/** Mark an agent as complete (left the run). */
export function leavePresence(
  store: PresenceStore,
  agentId: string,
): void {
  store.setPresenceStatus(agentId, 'complete');
}

/**
 * Record a heartbeat for an agent. If the agent is stuck, bring it back to active.
 * @returns true if the agent was stuck and is now recovered
 */
export function heartbeat(
  store: PresenceStore,
  agentId: string,
  now = Date.now(),
): { recovered: boolean } {
  const before = store.getPresence(agentId);
  store.heartbeat(agentId, now);
  return { recovered: before?.status === 'stuck' };
}

/**
 * Detect and mark stuck agents. Returns the count of newly-stuck agents.
 */
export function detectStuck(
  store: PresenceStore,
  now = Date.now(),
): number {
  return store.markStuck(now);
}

/**
 * Get all presences for a run, optionally filtered by status.
 */
export function listPresences(
  store: PresenceStore,
  runId: string,
  status?: PresenceStatus,
): AgentPresence[] {
  const all = store.presencesForRun(runId);
  return status ? all.filter(p => p.status === status) : all;
}
