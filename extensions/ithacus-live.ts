/**
 * ithacus-live.ts — the module-level live-progress store + pi JSONL event
 * parser (Sprint 5.13, docs/DESIGN_LIVE_PROGRESS.md §3.1), publishing every
 * update to the Sprint 5.20 event bus from day one
 * (docs/DESIGN_EVENT_STREAM.md §2.3 — "the store is event-driven at birth").
 *
 * One `dispatchId` key per active overlay (a single ithacus-dispatch tool
 * call shows one live card). The store keeps best-effort snapshots for the
 * overlay; the bus carries the typed stream for current + future consumers —
 * the 5.12 web dashboard, fleet views (one event stream, many views).
 *
 * Sprint 5.14 (docs/DESIGN_WORKER_STATUS.md): the snapshot's `status` is the
 * RICHER WorkerStatus vocabulary (consumed from src/events.ts, not recreated
 * here). Status moves run through the src/worker-status.ts machine
 * (canTransition is the progress-validity floor: done/failed absorbing);
 * dispatch's onProgress maps raw child lines via mapEventToStatus and feeds
 * the result to setWorkerStatus; endLive classifies failureKind via
 * classifyFailure instead of the 5.13 "unknown" floor.
 *
 * Zero pi imports, zero deps, zero network (PREVENT-ITH-004). Every listener
 * notify AND every bus publish is wrapped in try/catch — live-progress
 * emission MUST NOT throw into the dispatch hot path (the overlay is an
 * enhancement, not the critical path — DESIGN_LIVE_PROGRESS.md §9.3).
 */

import type { IthacusEvent, WorkerFailureKind, WorkerStatus } from "../src/events.js";
import type { IthacusEventBus } from "../src/event-bus.js";
import { canTransition, classifyFailure, type WorkerFailureSignals } from "../src/worker-status.js";
import { redactSecrets } from "../src/redact.js";

// ---------------------------------------------------------------------------
// Public types (DESIGN_LIVE_PROGRESS.md §3.1)
// ---------------------------------------------------------------------------

export interface LiveToolEntry {
  tool: string; // e.g. "read", "edit", "bash"
  args: string; // preview: path / command / pattern (truncated to 60)
  startMs: number;
  endMs?: number;
}

export interface AgentLive {
  agent: string; // "explore" | "plan" | ...
  model?: string;
  /** Sprint 5.14 (spec §3): the WorkerStatus vocabulary — spawning at birth,
   *  richer phases via setWorkerStatus, terminal via endLive. */
  status: WorkerStatus;
  currentTool?: string;
  currentToolArgs?: string;
  recentTools: LiveToolEntry[]; // last N (cap RECENT_TOOLS_CAP, ring buffer)
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  filesAccessed: string[]; // unique file paths (cap FILES_CAP)
  startedAt: number;
  error?: string;
  /**
   * Sprint 5.13 addition: task preview the overlay's `task` row renders
   * (DESIGN_LIVE_PROGRESS.md §4 layout has a task row, but §3.1's AgentLive
   * interface omitted the field — added as an OPTIONAL extension).
   */
  taskPreview?: string;
  /** Sprint 5.14 (spec §3): classification from endLive — "unknown" floor
   *  unless the exit evidence says otherwise (context_window /
   *  permission_denied / timeout / crash). Undefined on success. */
  failureKind?: WorkerFailureKind;
  /** Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §6.4): current retry
   *  attempt (1-based) and the retry budget (policy.maxRetries), for the
   *  card's "↻ retrying (attempt n/N)" row + fleet view. Undefined until a
   *  retry is marked; retryMax may stay undefined when unbudgeted. */
  attempt?: number;
  retryMax?: number;
}

/**
 * A parsed pi `--mode json` stdout line — tolerant superset: only the fields
 * the live store consumes; tool names read from toolName | tool_name | name
 * (DESIGN_LIVE_PROGRESS.md §9.1 mitigation: schema may vary between pi
 * versions; tolerate rather than crash).
 */
export interface PiJsonEvent {
  type?: string;
  toolName?: string;
  tool_name?: string;
  name?: string;
  args?: Record<string, unknown>;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    model?: string;
    usage?: { input?: number; output?: number; cacheRead?: number };
  };
}

// ---------------------------------------------------------------------------
// Module-level store + listeners (module state per DESIGN_LIVE_PROGRESS.md §3.1)
// ---------------------------------------------------------------------------

const RECENT_TOOLS_CAP = 5;
const FILES_CAP = 8;

const live = new Map<string, AgentLive>();
const listeners = new Set<() => void>();

/** Sprint 5.20 (DESIGN_EVENT_STREAM.md §2.3): the bus this store publishes
 *  every update to. Wired one time to the IthRuntime singleton via
 *  wireLiveEventBus(); null before wiring (tests wire their own instance). */
let liveBus: IthacusEventBus | null = null;

/** Wire the store to the runtime's singleton event bus (idempotent). Called
 *  from registerDispatchTool when an IthRuntime is present. */
export function wireLiveEventBus(bus: IthacusEventBus | null): void {
  liveBus = bus;
}

/** Publish to the bus, best-effort — a broken subscriber can never throw
 *  into the dispatch hot path (the bus already wraps each subscriber; the
 *  outer guard keeps even a bus-level bug non-fatal). */
function publish(ev: IthacusEvent): void {
  const bus = liveBus;
  if (!bus) return;
  try {
    bus.publish(ev);
  } catch {
    /* event emission never throws into the hot path (§9.3) */
  }
}

/** Notify store listeners (overlay re-render), best-effort. */
function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one bad listener must not break the store or the hot path */
    }
  }
}

// ---------------------------------------------------------------------------
// JSON event parsing + helpers (zero-dep — no pi-tui import, PREVENT-ITH-004)
// ---------------------------------------------------------------------------

// pi --mode json emits JSONL events. We parse the 3 event types that matter:
//   tool_execution_start: { toolName, args: { command, path, file_path, pattern, query } }
//   tool_execution_end:   { toolName, args }
//   message_end:          { message: { usage: { input, output, cacheRead }, model } }
export function parseJsonlLine(line: string): PiJsonEvent | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as PiJsonEvent;
  } catch {
    return null; // tolerate partial lines
  }
}

/** ithacus's unique addition: tokens/sec from accumulated output tokens. */
function tps(tokensOut: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return tokensOut / (durationMs / 1000);
}

const FILE_ARG_KEYS = ["path", "file_path", "pattern", "query"];
function extractFile(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  for (const k of FILE_ARG_KEYS) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) {
      // Sprint 5.15: redact before store/bus — a file path can carry a token.
      return redactSecrets(v.split("\n")[0].slice(0, 80)); // preview
    }
  }
  return null;
}

/** Short human args preview for the tool row (60 chars max, one line).
 *  Sprint 5.15 (NO SECRETS): every preview (currentToolArgs + recentTools)
 *  is secret-redacted before it can reach the store, overlay, or bus. */
function argsPreview(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  for (const k of ["command", "path", "file_path", "pattern", "query"]) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) return redactSecrets(v.split("\n")[0].slice(0, 60));
  }
  return undefined;
}

function toolNameOf(event: PiJsonEvent, fallback: string): string {
  return event.toolName ?? event.tool_name ?? event.name ?? fallback;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

/**
 * Register a dispatch in the store (called BEFORE spawnAgent — the overlay
 * shows the run from the very first frame). Publishes run_started +
 * agent_status:"spawning" to the bus; the snapshot status IS "spawning"
 * from birth (5.14: the richly-typed vocabulary replaces the 5.13 "running").
 */
export function startLive(id: string, agent: string, model?: string, taskPreview?: string, attempt?: number, retryMax?: number): void {
  live.set(id, {
    agent,
    model,
    status: "spawning",
    recentTools: [],
    toolCallCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: 0,
    filesAccessed: [],
    startedAt: Date.now(),
    taskPreview,
    attempt,
    retryMax,
  });
  const ts = Date.now();
  publish({ type: "run_started", runId: id, ts });
  publish({ type: "agent_status", runId: id, agentId: agent, status: "spawning", ts });
  notify();
}

/** Sprint 5.17 (§6.4): mark the dispatch as entering a retry attempt. Sets the
 *  "retrying" WorkerStatus (progress-valid from spawning/working) + the
 *  attempt / retryMax counters, notifies + publishes. Called between attempts
 *  by the dispatch-with-resilience loop. Best-effort: no entry → no-op. */
export function markRetry(id: string, attempt: number, retryMax?: number): void {
  const entry = live.get(id);
  if (!entry) return;
  entry.attempt = attempt;
  if (retryMax !== undefined) entry.retryMax = retryMax;
  if (advanceStatus(id, entry, "retrying")) notify();
}

/**
 * The single WorkerStatus transition path (Sprint 5.14 progress validity).
 * Equality short-circuits (duplicate markers are idempotent); canTransition
 * is the floor — terminal states are absorbing, so a LATE child event after
 * endLive can never republish a done/failed run as "working" (a 5.13 race
 * the announceWorking flag could not prevent). Publishes the accepted
 * transition as agent_status; returns true when the store actually moved.
 */
function advanceStatus(id: string, entry: AgentLive, next: WorkerStatus): boolean {
  if (entry.status === next) return false;
  if (!canTransition(entry.status, next)) return false;
  entry.status = next;
  publish({ type: "agent_status", runId: id, agentId: entry.agent, status: next, ts: Date.now() });
  return true;
}

/** First observed tool/usage event flips the status to "working" — the
 *  detection floor (DESIGN_WORKER_STATUS.md §2.2) for when dispatch's line
 *  mapper saw nothing detectable before this. */
function announceWorking(entry: AgentLive, id: string): void {
  advanceStatus(id, entry, "working");
}

/**
 * Sprint 5.14 (spec §2.2): the adapter entry point for the richer status
 * machine — dispatch's onProgress calls mapEventToStatus(line, current) and
 * feeds accepted changes here, so trust_required / tool_permission /
 * ready_for_prompt flow onto the bus (5.13 only ever emitted
 * spawning/working) and onto the overlay. Best-effort: no entry → no-op;
 * invalid/backward transitions are refused by the machine.
 */
export function setWorkerStatus(id: string, next: WorkerStatus): void {
  const entry = live.get(id);
  if (!entry) return;
  if (advanceStatus(id, entry, next)) notify();
}

/**
 * Apply one parsed child JSON event to the snapshot. `startTime` is the
 * dispatch start (execute()'s clock) so durationMs stays per-dispatch.
 * Best-effort: unknown event types / malformed shapes update nothing.
 */
export function updateLive(id: string, event: PiJsonEvent, startTime: number): void {
  const entry = live.get(id);
  if (!entry) return;
  const now = Date.now();
  if (startTime > 0) entry.durationMs = Math.max(0, now - startTime);

  if (event.type === "tool_execution_start") {
    announceWorking(entry, id);
    const tool = toolNameOf(event, "tool");
    const preview = argsPreview(event.args);
    entry.currentTool = tool;
    entry.currentToolArgs = preview;
    entry.recentTools.push({ tool, args: preview ?? "", startMs: now });
    if (entry.recentTools.length > RECENT_TOOLS_CAP) entry.recentTools.shift();
    const file = extractFile(event.args);
    if (file) {
      if (!entry.filesAccessed.includes(file) && entry.filesAccessed.length < FILES_CAP) {
        entry.filesAccessed.push(file);
      }
      publish({ type: "tool_execution_start", runId: id, agentId: entry.agent, tool, file, ts: now });
    } else {
      publish({ type: "tool_execution_start", runId: id, agentId: entry.agent, tool, ts: now });
    }
  } else if (event.type === "tool_execution_end") {
    const tool = toolNameOf(event, "tool");
    // Close the newest still-open entry for this tool; tolerate a missed
    // start event by closing on a synthesized zero-duration entry.
    let openIdx = -1;
    for (let i = entry.recentTools.length - 1; i >= 0; i--) {
      if (entry.recentTools[i].tool === tool && entry.recentTools[i].endMs === undefined) {
        openIdx = i;
        break;
      }
    }
    if (openIdx >= 0) entry.recentTools[openIdx].endMs = now;
    else entry.recentTools.push({ tool, args: "", startMs: now, endMs: now });
    if (entry.recentTools.length > RECENT_TOOLS_CAP) entry.recentTools.shift();
    entry.toolCallCount++;
    if (entry.currentTool === tool) {
      entry.currentTool = undefined;
      entry.currentToolArgs = undefined;
    }
    publish({ type: "tool_execution_end", runId: id, agentId: entry.agent, tool, ok: true, durationMs: openIdx >= 0 ? now - entry.recentTools[openIdx].startMs : 0, ts: now });
  } else if (event.type === "message_end" && event.message) {
    announceWorking(entry, id);
    const msg = event.message;
    // The child's reported model is authoritative once it speaks (backfills
    // a run started without an explicit model override).
    if (msg.model) entry.model = msg.model;
    const usage = msg.usage;
    if (usage) {
      const input = typeof usage.input === "number" ? usage.input : 0;
      const output = typeof usage.output === "number" ? usage.output : 0;
      // tokensIn tracks the LATEST context size — each turn re-reads context,
      // so accumulating would double-count; tokensOut accumulates generated
      // tokens across turns. (DESIGN_LIVE_PROGRESS.md: usage accumulate.)
      entry.tokensIn = input;
      entry.tokensOut += output;
      publish({
        type: "agent_tokens",
        runId: id,
        agentId: entry.agent,
        input: entry.tokensIn,
        output: entry.tokensOut,
        total: entry.tokensIn + entry.tokensOut,
        ts: now,
      });
      publish({
        type: "agent_tps",
        runId: id,
        agentId: entry.agent,
        tps: Math.round(tps(entry.tokensOut, entry.durationMs) * 100) / 100,
        windowMs: entry.durationMs,
        ts: now,
      });
    }
  }
  // Other event types (message_delta etc.): no snapshot change by design.
  notify();
}

/**
 * Flip the snapshot to its terminal state and publish agent_done +
 * run_finished ("exit code 0 → done; non-zero → failed + WorkerFailureKind",
 * spec §2.2). Sprint 5.14: failureKind comes from classifyFailure() over the
 * exit evidence `signals` carries + the status the run was in just before
 * the terminal flip (a run that dies still BLOCKED on a trust/permission
 * grant is permission_denied, not unknown). Signature is backward-compatible
 * — omitting `signals` keeps the 5.13 "unknown" floor.
 */
export function endLive(id: string, success: boolean, error?: string, signals?: WorkerFailureSignals): void {
  const entry = live.get(id);
  if (!entry) return;
  const lastStatus = entry.status; // classify against the pre-terminal status
  entry.status = success ? "done" : "failed";
  entry.error = error;
  entry.currentTool = undefined;
  entry.currentToolArgs = undefined;
  entry.durationMs = Math.max(0, Date.now() - entry.startedAt);
  const ts = Date.now();
  const failureKind: WorkerFailureKind | undefined = success
    ? undefined
    : classifyFailure({ ...(signals ?? {}), lastStatus });
  entry.failureKind = failureKind;
  if (failureKind) {
    publish({ type: "agent_done", runId: id, agentId: entry.agent, status: "failed", failureKind, ts });
  } else {
    publish({ type: "agent_done", runId: id, agentId: entry.agent, status: "done", ts });
  }
  publish({ type: "run_finished", runId: id, status: success ? "done" : "failed", ts });
  notify();
}

/** Remove the snapshot (called when the overlay dismisses). No bus event —
 *  terminal state already flowed. */
export function removeLive(id: string): void {
  live.delete(id);
  notify();
}

export function getLive(id: string): AgentLive | undefined {
  return live.get(id);
}

/** Enumerate all live dispatches (active + recent terminal) for the
 *  workflow section (DESIGN_LIVE_PROGRESS.md — agent-to-agent chain view).
 *  Sorted by startedAt ascending (oldest first = execution order). */
export function listLive(): AgentLive[] {
  return [...live.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function onLiveChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
