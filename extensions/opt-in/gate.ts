// guardrails-allow PREVENT-ITH-004: Tier-R capability gate — reads config only, makes zero network calls
// ----------------------------------------------------------------------------------------------------
// Sprint 5.24 (DESIGN_TWO_TIER_POLICY.md §3.3): runtime capability gate for
// Tier R (Remote, opt-in, default OFF) modules living under extensions/opt-in/.
//
// Every opt-in module's public entry point calls requireCapability() FIRST; if
// the capability is disabled it throws CapabilityDisabledError, which the
// caller converts into its Tier-L fallback / a no-op — never crashing the
// local tier. Every refusal appends a `remote_capability_blocked` audit event
// via the sink wired at boot (setAuditSink to runtime.appendEvent).
//
// The gate reads config fresh on every call (never caches env or a config
// object), so a toggle flip is respected on the next call.
//
// THIS FILE MAKES ZERO NETWORK CALLS. The PREVENT-ITH-004 annotation above is
// the opt-in self-declaration required for every extensions/opt-in/*.ts file
// (scanner-enforced). No network construct appears anywhere in this module.
// ----------------------------------------------------------------------------------------------------

import type { IthacusConfig, RemoteCapabilities } from "../../src/config.js";

/** Audit sink shape — mirrors the ithacus runtime `appendEvent(event, fields)`
 *  signature, wired via setAuditSink(). */
export type AuditSink = (event: string, fields: Record<string, unknown>) => void;

/** Event name appended when a Tier-R capability is refused. */
export const REMOTE_CAPABILITY_BLOCKED_EVENT = "remote_capability_blocked";

/** Injected audit sink (e.g. runtime.appendEvent). null until wired. */
let auditSink: AuditSink | null = null;

/** Wire the audit sink (typically runtime.appendEvent) so refusals are
 *  transparent. Pass null to detach. Not config/env — a dependency seam. */
export function setAuditSink(sink: AuditSink | null): void {
  auditSink = sink;
}

/** Thrown by requireCapability() when the capability is not enabled. Callers
 *  (Tier-R modules) catch this and degrade to their Tier-L fallback / no-op. */
export class CapabilityDisabledError extends Error {
  readonly capability: string;

  constructor(capability: string, message?: string) {
    super(message ?? `Remote capability "${capability}" is disabled.`);
    this.name = "CapabilityDisabledError";
    this.capability = capability;
  }
}

function emitBlocked(cap: string): void {
  if (auditSink) auditSink(REMOTE_CAPABILITY_BLOCKED_EVENT, { capability: cap });
}

/** Effective enablement of a single capability from a RemoteCapabilities block. */
export function capabilityEnabledFromRemote(cap: string, remote?: RemoteCapabilities): boolean {
  if (!remote) return false;
  // Master switch dominates: even with a per-capability toggle on, a disabled
  // master switch renders every Tier-R module inert.
  return remote.remoteEnabled === true && remote.capabilities[cap] === true;
}

/** True when the capability is enabled for the given config. Reads cfg.remote
 *  fresh on every call (no cached env) so a toggle flip is respected on the
 *  next call. On refusal, appends the remote_capability_blocked audit event. */
export function capabilityEnabled(cap: string, cfg: IthacusConfig): boolean {
  const enabled = capabilityEnabledFromRemote(cap, cfg.remote);
  if (!enabled) emitBlocked(cap);
  return enabled;
}

/** Require a capability; throws CapabilityDisabledError when disabled. On
 *  refusal also appends the remote_capability_blocked audit event (emitted once
 *  via capabilityEnabled). */
export function requireCapability(cap: string, cfg: IthacusConfig): void {
  if (!capabilityEnabled(cap, cfg)) {
    throw new CapabilityDisabledError(cap);
  }
}
