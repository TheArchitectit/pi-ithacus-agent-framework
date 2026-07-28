/**
 * ithacus-presence.ts — presence lifecycle hooks for the extension layer.
 *
 * Hooks into agent spawn (join), heartbeat, and complete/fail (leave).
 */

import type { IthRuntime } from './ithacus-runtime.js';
import { PresenceStore } from '../src/store-presence.js';
import { joinPresence, leavePresence, heartbeat, detectStuck } from '../src/presence.js';
import { releaseAll } from '../src/reservations.js';

/** Get or create the PresenceStore for the current runtime. */
export function getPresenceStore(runtime: IthRuntime): PresenceStore {
  // Lazy-init: store the PresenceStore on the runtime as a non-enumerable property.
  const key = '__presenceStore';
  if (!(runtime as any)[key]) {
    (runtime as any)[key] = new PresenceStore(runtime.store.db);
  }
  return (runtime as any)[key] as PresenceStore;
}

/** Register an agent as present on spawn. */
export function onAgentJoin(runtime: IthRuntime, agentId: string, runId: string) {
  const ps = getPresenceStore(runtime);
  return joinPresence(ps, agentId, runId);
}

/** Record a heartbeat for an agent. */
export function onHeartbeat(runtime: IthRuntime, agentId: string) {
  const ps = getPresenceStore(runtime);
  return heartbeat(ps, agentId);
}

/** Mark agent as complete on leave. Release stale file reservations. */
export function onAgentLeave(runtime: IthRuntime, agentId: string) {
  const ps = getPresenceStore(runtime);
  leavePresence(ps, agentId);
  releaseAll(ps, agentId);
}

/** Run stuck detection, returns count of newly-stuck agents. */
export function runStuckDetection(runtime: IthRuntime) {
  const ps = getPresenceStore(runtime);
  return detectStuck(ps);
}
