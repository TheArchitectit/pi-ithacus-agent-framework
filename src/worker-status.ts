/**
 * src/worker-status.ts — the WorkerStatus state machine (Sprint 5.14,
 * docs/DESIGN_WORKER_STATUS.md — AUTHORITATIVE).
 *
 * Pure + pi-agnostic: no pi imports, no timers, no process control, no
 * network (PREVENT-ITH-004) — unit-testable with `node --test`
 * (src/worker-status.test.ts). Zero new dependencies; Node built-ins only.
 *
 * Consumes the WorkerStatus + WorkerFailureKind unions landed in ./events.js
 * (Sprint 5.13 split-file convention — src/types.ts is at its line budget,
 * so the enums live there; do NOT recreate them here).
 *
 * Spec contract:
 *  §2.1 — AgentStatus (types.ts) stays the coarse sqlite-persisted type;
 *         WorkerStatus is the live/runtime vocabulary. toAgentStatus() is
 *         the coarse mapping the spec pins: trust_required /
 *         tool_permission / ready_for_prompt persist as "spawning" until
 *         they become "working".
 *  §2.2 — mapEventToStatus(line, current) maps ONE raw sub-agent output
 *         line (a `--mode json` event or prose) to the next per-worker
 *         status. Detection markers are TOLERANT: unknown output returns
 *         `current` unchanged and never blocks the happy path. Terminal
 *         states come only from exit classification (endLive), never from
 *         a line.
 *  §2.3 — overlay icon/color rows are the adapter's job
 *         (extensions/ithacus-live-card.ts); this module owns only the
 *         vocabulary + rules.
 *
 * Beyond the mapping, the machine carries three rules the spec implies:
 *  - transitions: canTransition() is the single transition table;
 *  - progress validity: done/failed are absorbing and trust → permission →
 *    ready move forward-only (working may dip into tool_permission for a
 *    mid-run grant and resume);
 *  - blocking detection: isBlockedStatus() marks the two states where the
 *    sub-agent is paused waiting on a human (trust_required,
 *    tool_permission).
 *
 * Failure classification: classifyFailure() maps exit signals to
 * WorkerFailureKind ("exit code 0 → done; non-zero → failed +
 * WorkerFailureKind", spec §2.2).
 */

import type { WorkerStatus, WorkerFailureKind } from "./events.js";
import type { AgentStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Coarse mapping (spec §2.1)
// ---------------------------------------------------------------------------

/**
 * Map the live WorkerStatus onto the coarse sqlite-persisted AgentStatus.
 * Spec §2.1: only working/done/failed map through; the three pre-working
 * distinguishable phases persist as "spawning" until they become "working".
 */
export function toAgentStatus(status: WorkerStatus): AgentStatus {
  switch (status) {
    case "working":
      return "working";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "spawning";
  }
}

// ---------------------------------------------------------------------------
// Status predicates
// ---------------------------------------------------------------------------

/** Terminal states are absorbing: nothing transitions out of done/failed. */
export function isTerminalStatus(status: WorkerStatus): boolean {
  return status === "done" || status === "failed";
}

/** Blocking detection: the worker is paused waiting on a human grant. */
export function isBlockedStatus(status: WorkerStatus): boolean {
  return status === "trust_required" || status === "tool_permission";
}

// ---------------------------------------------------------------------------
// Transition table (progress validity)
// ---------------------------------------------------------------------------

/**
 * The single legal-transition table. Self-loops are always legal (duplicate
 * detection markers are idempotent). done/failed only self-loop — exit
 * classification owns terminal entry (spec §2.2: exit code decides).
 */
const TRANSITIONS: Readonly<Record<WorkerStatus, readonly WorkerStatus[]>> = {
  spawning: ["spawning", "trust_required", "tool_permission", "ready_for_prompt", "working", "done", "failed"],
  // Trust precedes permission/ready/work; no rewind to "spawning".
  trust_required: ["trust_required", "tool_permission", "ready_for_prompt", "working", "done", "failed"],
  tool_permission: ["tool_permission", "ready_for_prompt", "working", "done", "failed"],
  ready_for_prompt: ["ready_for_prompt", "tool_permission", "working", "done", "failed"],
  // A mid-run grant gate is real: working → tool_permission → working.
  working: ["working", "tool_permission", "done", "failed"],
  done: ["done"],
  failed: ["failed"],
};

/**
 * Progress validity: is `from → to` a legal WorkerStatus transition?
 * Unknown callers use this as the floor so a later/redundant marker can
 * never rewind a worker that already made progress.
 */
export function canTransition(from: WorkerStatus, to: WorkerStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Detection markers (spec §2.2 — tolerant by contract)
// ---------------------------------------------------------------------------

/**
 * Plain-text trust-prompt markers. The trust prompt surfaces as PROSE in
 * sub-agent output (spec §2.2: "trust-prompt marker in child output"),
 * while tool-permission requests arrive as structured JSON events.
 */
const TRUST_TEXT_MARKERS: readonly RegExp[] = [
  /do you trust/i,
  /trust the files/i,
  /trust this (folder|directory|workspace)/i,
  /untrusted (workspace|folder|directory)/i,
  /workspace trust/i,
];

/**
 * JSON `type` values meaning "the sub-agent is up but not yet running"
 * (ready_for_prompt). Tolerant superset — pi's exact boot-event vocabulary
 * varies between versions, so several plausible shapes map here.
 */
const READY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "ready",
  "ready_for_prompt",
  "session_start",
  "session_started",
  "session_init",
  "agent_start",
  "agent_ready",
]);

function messageOf(parsed: unknown): Record<string, unknown> | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const msg = (parsed as { message?: unknown }).message;
  return typeof msg === "object" && msg !== null ? (msg as Record<string, unknown>) : null;
}

/**
 * Detect the WorkerStatus a single raw sub-agent output line implies, or
 * null when the line carries no status signal (unknown prose, unknown or
 * malformed JSON — the happy path must keep moving, spec §2.2).
 */
function detectStatus(line: string): WorkerStatus | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null; // partial/broken line — tolerate
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const rawType = (parsed as { type?: unknown }).type;
    if (typeof rawType !== "string") return null;
    const type = rawType.toLowerCase();
    if (type.includes("trust")) return "trust_required";
    // "permission-request JSON event" (spec §2.2) — tolerant of exact-name
    // drift (permission_request, tool_permission_request, ...).
    if (type.includes("permission")) return "tool_permission";
    if (type === "tool_execution_start") return "working";
    // First assistant turn (streaming) — the worker is clearly doing work.
    if (type === "message_delta") return "working";
    if (type === "message_end") {
      const msg = messageOf(parsed);
      // "first assistant turn / first usage event" (spec §2.2).
      if (msg && (msg.role === "assistant" || msg.usage !== undefined)) return "working";
      return null; // tool/user message boundaries carry no worker signal
    }
    if (READY_EVENT_TYPES.has(type)) return "ready_for_prompt";
    return null; // unknown JSON event — never block the happy path
  }
  for (const re of TRUST_TEXT_MARKERS) {
    if (re.test(trimmed)) return "trust_required";
  }
  return null;
}

/**
 * The status-mapping pure function (spec §4's unit-test surface): given one
 * raw child output line and the worker's current status, return the next
 * status. Unknown lines pass through unchanged; detected phases are gated
 * by the transition table so progress can never rewind.
 */
export function mapEventToStatus(line: string, current: WorkerStatus): WorkerStatus {
  const detected = detectStatus(line);
  if (detected === null) return current;
  return canTransition(current, detected) ? detected : current;
}

// ---------------------------------------------------------------------------
// Failure classification (spec §2.2: "non-zero → failed + WorkerFailureKind")
// ---------------------------------------------------------------------------

/** Exit-time evidence the adapter (endLive) hands the classifier. */
export interface WorkerFailureSignals {
  /** Child exit code, when a process ran and reported one. */
  exitCode?: number;
  /** Explicit timeout trip (maxRuntimeMs — seam for the future scheduler). */
  timedOut?: boolean;
  /** The WORKER's status just before the terminal flip (never "done"/"failed"). */
  lastStatus?: WorkerStatus;
  /** Tail slices of captured stderr / assistant output (marker scan window). */
  stderrTail?: string;
  outputTail?: string;
}

const CONTEXT_WINDOW_MARKERS: readonly RegExp[] = [
  /context (window|length)/i,
  /maximum context/i,
  /context_left/i,
  /prompt is too long/i,
  /too many tokens/i,
];

/**
 * Order is semantic precedence: an explicit timeout trip is authoritative;
 * a worker that exits still BLOCKED on a grant never got permission; a
 * context-window marker beats the generic kinds (it drives the Sprint 5.17
 * retry seam); exiting non-zero before any assistant output (never reached
 * "working", nothing captured) means the process crashed on the way up;
 * anything else is honestly "unknown".
 */
export function classifyFailure(signals: WorkerFailureSignals): WorkerFailureKind {
  if (signals.timedOut) return "timeout";
  const last = signals.lastStatus ?? "spawning";
  if (isBlockedStatus(last)) return "permission_denied";
  const tail = `${signals.stderrTail ?? ""}\n${signals.outputTail ?? ""}`;
  if (CONTEXT_WINDOW_MARKERS.some((re) => re.test(tail))) return "context_window";
  if (typeof signals.exitCode === "number" && signals.exitCode !== 0 && last !== "working" && !tail.trim()) {
    return "crash";
  }
  return "unknown";
}
