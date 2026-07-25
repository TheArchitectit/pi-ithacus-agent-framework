/**
 * reservations.ts — file path reservation system.
 *
 * Prevents conflicting writes by allowing agents to claim exclusive write
 * access to file paths. Read reservations are non-exclusive.
 *
 * pi-agnostic.
 */

import type { FileReservation, ReservationScope } from './types.js';
import type { PresenceStore } from './store-presence.js';

/**
 * Attempt to reserve a file path for an agent.
 * Write/edit reservations are exclusive — only one agent can hold them.
 * Read reservations are always granted.
 * @returns true if the reservation was granted
 */
export function reserveFile(
  store: PresenceStore,
  opts: { agentId: string; runId: string; filePath: string; scope: ReservationScope },
): boolean {
  return store.reserve({
    agentId: opts.agentId,
    runId: opts.runId,
    filePath: opts.filePath,
    scope: opts.scope,
    createdAt: Date.now(),
  });
}

/**
 * Release a specific reservation or all reservations for an agent.
 */
export function releaseReservation(
  store: PresenceStore,
  agentId: string,
  filePath?: string,
): void {
  store.release(agentId, filePath);
}

/**
 * Check if a file path is reserved by another agent for writing.
 * @returns the reservation if blocked, undefined if available
 */
export function checkConflict(
  store: PresenceStore,
  filePath: string,
  requestingAgentId: string,
): FileReservation | undefined {
  const r = store.isReserved(filePath);
  if (r && r.agentId !== requestingAgentId) return r;
  return undefined;
}

/**
 * Release all reservations for an agent (call on completion/failure).
 */
export function releaseAll(
  store: PresenceStore,
  agentId: string,
): void {
  store.release(agentId);
}
