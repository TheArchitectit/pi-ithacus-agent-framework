/**
 * src/events.ts — the typed event-stream vocabulary (Sprint 5.20,
 * docs/DESIGN_EVENT_STREAM.md §2.1), layered into Sprint 5.13 from day one
 * ("layer INTO Sprint 5.13" — make the live-progress store event-driven at
 * birth rather than bolting a bus later).
 *
 * One typed `IthacusEvent` union that every live-visibility consumer shares:
 * the 5.13 overlay store is the primary producer today; 5.14's richer status
 * rows, the 5.12 web dashboard, and future fleet views subscribe to the same
 * stream without touching producers (one event stream, many views).
 *
 * Pure types: zero runtime code, zero pi imports, zero network — src/ stays
 * pi-agnostic (PREVENT-ITH-004). Unit-tested via `node --test`
 * (src/event-bus.test.ts covers the bus that carries these).
 */

/**
 * Live/runtime worker status (7 states).
 *
 * Seam note: docs/DESIGN_WORKER_STATUS.md (Sprint 5.14) OWNS the state
 * machine that produces these; DESIGN_EVENT_STREAM.md (5.20) types the
 * stream with them; 5.13 defines the union here because the event seam must
 * compile now and src/types.ts is at its line budget (SPRINT_PLAN §Definition
 * of Done #6 — new types go in split files). 5.13's dispatch only emits
 * spawning → working → done/failed; the trust / permission / ready states
 * arrive with 5.14's detection markers. AgentStatus in types.ts stays the
 * coarse stored type (sqlite backward compat).
 */
export type WorkerStatus =
  | "spawning"             // dispatch accepted, child not yet up
  | "trust_required"       // child needs workspace trust confirmation
  | "tool_permission"      // child paused waiting for a tool-permission grant
  | "ready_for_prompt"     // child up, prompt queued, not yet running
  | "working"              // actively processing (tokens flowing)
  | "retrying"             // Sprint 5.17: a failed attempt is being retried (fresh child / fallback hop)
  // Sprint 5.28 (docs/SPRINT_5_28_LIVE_DISPATCH_CONTROL.md §5.1): live dispatch
  // control states — the card/bus render ⏸ paused / ■ stopped / ✕ cancelled /
  // ⇄ swapped / ⑂ splitting. `stopped`/`cancelled` are TERMINAL (user-initiated);
  // `paused`/`stopping`/`swapped`/`splitting` are resting/transient.
  | "paused"                // dispatch suspended by user; child killed, tail preserved
  | "stopping"              // graceful kill in progress (SIGTERM sent, awaiting exit)
  | "swapped"               // swap-model/agent respawn in progress (transient)
  | "splitting"             // split spawn in progress (transient, leads to a new child)
  | "stopped"               // terminal: user-initiated abort + KEEP completion
  | "cancelled"             // terminal: user-initiated abort + DISCARD completion
  | "done"                 // finished successfully
  | "failed";              // finished with error

/**
 * How a worker failed (carried by agent_done on failure). Sprint 5.14 refines
 * the classification; 5.13 only ever emits "unknown". Sprint 5.17
 * (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §2.1) adds the three transient
 * kinds — rate_limit / network / auth — that feed the retry + fallback loop.
 */
export type WorkerFailureKind =
  | "context_window"       // ran out of context (→ compact + bigger-window model)
  | "permission_denied"    // trust/tool permission never granted → STOP (interactive)
  | "timeout"              // exceeded maxRuntimeMs → backoff retry
  | "crash"                // child process died on boot → backoff retry (per policy.on)
  | "rate_limit"           // 429 / quota → backoff, else alt-provider hop
  | "network"              // ECONNRESET/ETIMEDOUT/... → backoff transient retry
  | "auth"                 // 401/403/invalid key → skip to next hop
  | "unknown";             // honestly unknown → STOP (never guess)

/**
 * The single typed stream every ithacus view subscribes to
 * (DESIGN_EVENT_STREAM.md §2.1 — field-for-field). `runId` scopes one
 * dispatch run; `agentId` is the agent type surfaced in the view.
 */
export type IthacusEvent =
  | { type: "run_started"; runId: string; ts: number }
  | { type: "agent_status"; runId: string; agentId: string;
      status: WorkerStatus; ts: number }
  | { type: "agent_tokens"; runId: string; agentId: string;
      input: number; output: number; total: number; ts: number }
  | { type: "agent_tps"; runId: string; agentId: string;
      tps: number; windowMs: number; ts: number }
  | { type: "tool_execution_start"; runId: string; agentId: string;
      tool: string; file?: string; ts: number }
  | { type: "tool_execution_end"; runId: string; agentId: string;
      tool: string; ok: boolean; durationMs: number; ts: number }
  | { type: "agent_done"; runId: string; agentId: string;
      status: "done" | "failed" | "stopped" | "cancelled"; failureKind?: WorkerFailureKind; ts: number }
  | { type: "run_finished"; runId: string; status: string; ts: number }
  // Sprint 5.22 (docs/DESIGN_LIVE_A2A_ACCOUNTING.md §3): live A2A accounting —
  // peer-to-peer mailbox + handoff + presence traffic made live-visible, the
  // same way parent→child dispatch is. Metadata-only (NO message bodies —
  // privacy + payload size; bodies stay in ith_inbox). runId-optional: A2A
  // traffic is run-independent, so these carry a runId only when the sender
  // is mid-dispatch (card renders under a run when attributed, else in a
  // fleet-wide strip).
  | { type: "message_sent"; from: string; to: string; msgId: string;
      kind: "direct" | "broadcast"; ts: number; runId?: string }
  | { type: "message_read"; agentId: string; count: number; ts: number; runId?: string }
  | { type: "handoff_initiated"; from: string; to: string | null;
      reason: string; ts: number; runId?: string }
  | { type: "handoff_accepted"; handoffId: string; from: string; to: string;
      ts: number; runId?: string }
  | { type: "presence_changed"; agentId: string; state: string; ts: number; runId?: string };
