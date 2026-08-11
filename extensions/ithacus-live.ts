/**
 * ithacus-live.ts — the module-level live-progress store + pi JSONL event
 * parser (Sprint 5.13, docs/DESIGN_LIVE_PROGRESS.md §3.1), publishing every
 * update to the Sprint 5.20 event bus from day one
 * (docs/DESIGN_EVENT_STREAM.md §2.3 — "the store is event-driven at birth").
 *
 * One `dispatchId` key per active overlay (a single ithacus-dispatch tool
 * call shows one live card). The store keeps best-effort snapshots for the
 * overlay; the bus carries the typed stream for current + future consumers —
 * 5.14's richer status rows, the 5.12 web dashboard, fleet views (one event
 * stream, many views).
 *
 * Zero pi imports, zero deps, zero network (PREVENT-ITH-004). Every listener
 * notify AND every bus publish is wrapped in try/catch — live-progress
 * emission MUST NOT throw into the dispatch hot path (the overlay is an
 * enhancement, not the critical path — DESIGN_LIVE_PROGRESS.md §9.3).
 */

import type { IthacusEvent, WorkerFailureKind } from "../src/events.js";
import type { IthacusEventBus } from "../src/event-bus.js";

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
  status: "running" | "success" | "failed";
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
  /** Internal (5.13 detection floor): set once the first child event flips
   *  the bus status to "working" (DESIGN_WORKER_STATUS.md §2.2 — first
   *  assistant turn / first usage event). Not rendered. */
  workingAnnounced?: boolean;
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
      return v.split("\n")[0].slice(0, 80); // preview
    }
  }
  return null;
}

/** Short human args preview for the tool row (60 chars max, one line). */
function argsPreview(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  for (const k of ["command", "path", "file_path", "pattern", "query"]) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) return v.split("\n")[0].slice(0, 60);
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
 * agent_status:"spawning" to the bus.
 */
export function startLive(id: string, agent: string, model?: string, taskPreview?: string): void {
  live.set(id, {
    agent,
    model,
    status: "running",
    recentTools: [],
    toolCallCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: 0,
    filesAccessed: [],
    startedAt: Date.now(),
    taskPreview,
  });
  const ts = Date.now();
  publish({ type: "run_started", runId: id, ts });
  publish({ type: "agent_status", runId: id, agentId: agent, status: "spawning", ts });
  notify();
}

/** First observed child event flips the bus status to "working" (once per
 *  dispatch — DESIGN_WORKER_STATUS.md §2.2's detection floor; 5.14 adds the
 *  richer trust/permission/ready states). */
function announceWorking(entry: AgentLive, id: string): void {
  if (entry.workingAnnounced) return;
  entry.workingAnnounced = true;
  publish({ type: "agent_status", runId: id, agentId: entry.agent, status: "working", ts: Date.now() });
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
 * run_finished. 5.13 classifies every failure as WorkerFailureKind "unknown";
 * Sprint 5.14 refines (context_window / timeout / crash detection).
 */
export function endLive(id: string, success: boolean, error?: string): void {
  const entry = live.get(id);
  if (!entry) return;
  entry.status = success ? "success" : "failed";
  entry.error = error;
  entry.currentTool = undefined;
  entry.currentToolArgs = undefined;
  entry.durationMs = Math.max(0, Date.now() - entry.startedAt);
  const ts = Date.now();
  const failureKind: WorkerFailureKind | undefined = success ? undefined : "unknown";
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

export function onLiveChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
