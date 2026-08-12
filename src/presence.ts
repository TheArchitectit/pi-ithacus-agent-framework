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
import type { IthacusEvent } from './events.js';

export const DEFAULT_STUCK_THRESHOLD_MS = 30_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/** Sprint 5.22 (docs/DESIGN_LIVE_A2A_ACCOUNTING.md §4.3): optional emitter ctx.
 *  `publish` is best-effort (publish-never-throws). Heartbeat does NOT emit
 *  (high-frequency — would flood the bus); only join/leave/stuck transitions. */
export interface PresenceEmitCtx {
  publish?: (ev: IthacusEvent) => void;
}

const NOOP_PUBLISH = (_ev: IthacusEvent): void => {
  /* noop */
};

function safePublish(ctx: PresenceEmitCtx | undefined, ev: IthacusEvent): void {
  const publish = ctx?.publish ?? NOOP_PUBLISH;
  try {
    publish(ev);
  } catch {
    /* emission never throws into the presence hot path */
  }
}

function presenceChanged(agentId: string, state: string, now: number): IthacusEvent {
  return { type: 'presence_changed', agentId, state, ts: now };
}

/**
 * Register an agent as present. Creates an AgentPresence row with status='active'.
 */
export function joinPresence(
  store: PresenceStore,
  agentId: string,
  runId: string,
  stuckThresholdMs = DEFAULT_STUCK_THRESHOLD_MS,
  now = Date.now(),
  ctx?: PresenceEmitCtx,
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
  safePublish(ctx, presenceChanged(agentId, 'active', now));
  return p;
}

/** Mark an agent as complete (left the run). */
export function leavePresence(
  store: PresenceStore,
  agentId: string,
  ctx?: PresenceEmitCtx,
): void {
  store.setPresenceStatus(agentId, 'complete');
  safePublish(ctx, presenceChanged(agentId, 'complete', Date.now()));
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
  if (!before || before.status === 'complete') return { recovered: false };
  store.heartbeat(agentId, now);
  return { recovered: before.status === 'stuck' };
}

/**
 * Detect and mark stuck agents. Returns the count of newly-stuck agents.
 * Emits one presence_changed (state "stuck") per newly-stuck agent. NOTE:
 * heartbeat does NOT emit (high frequency); only transitions (join/leave/stuck).
 */
export function detectStuck(
  store: PresenceStore,
  now = Date.now(),
  ctx?: PresenceEmitCtx,
): number {
  // Candidates detected BEFORE the transition so each newly-stuck agent gets
  // a presence_changed; markStuck returns the authoritative change count.
  const stuck = store.detectStuck(now);
  for (const p of stuck) safePublish(ctx, presenceChanged(p.agentId, 'stuck', now));
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
