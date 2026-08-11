# DESIGN: One Event Stream, Many Views (Sprint 5.20)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Source pattern**: radcode (`/mnt/data/git/RADOPENCODE/`) — its session
> engine emits ONE typed stream-event protocol and every renderer (ratatui TUI
> + web UI) subscribes to the same stream. Also validated against memory-mcp's
> A2A event passing.
> **Layering note**: cheap to layer INTO Sprint 5.13 from day one — make the
> live-progress store event-driven at birth rather than bolting a bus later.

## 1. Problem

Without a shared event bus, every consumer of agent activity grows its own
ad-hoc path: the overlay (5.13) parses child JSON lines, the web dashboard
(5.12) would parse them again, the richer-status renderer (5.14) a third time.
radcode proves one typed stream serving many views is simpler and consistent.

## 2. Design

### 2.1 Event types — `src/events.ts` (pure, pi-agnostic)

```ts
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
      status: "done" | "failed"; failureKind?: WorkerFailureKind; ts: number }
  | { type: "run_finished"; runId: string; status: string; ts: number };
```

### 2.2 Bus — `src/event-bus.ts` (pure, pi-agnostic)

```ts
createEventBus(): {
  publish(ev: IthacusEvent): void;
  subscribe(fn: (ev: IthacusEvent) => void): () => void;  // returns unsubscribe
  history(limit?: number): IthacusEvent[];  // bounded ring buffer, default 500
}
```

Rules: publish never throws into subscribers (each subscriber wrapped in
try/catch — defensive render rule); history is bounded (memory-safe); no
networking, no timers in `src/` (PREVENT-ITH-004 + pi-agnostic).

### 2.3 Producers

`extensions/ithacus-live.ts` (5.13's store) becomes the PRIMARY producer:
every parseJsonlLine/updateProgress result is ALSO published to the bus.
The store keeps its snapshot map for overlay renders; the bus carries the
stream for everyone else. This is the "layer into 5.13" decision — the store is
event-driven from day one.

### 2.4 Consumers

| Consumer | Sprint | Uses |
|---|---|---|
| Live overlay | 5.13 | store snapshots (existing) |
| Richer status rows | 5.14 | agent_status events |
| Web dashboard | 5.12 | full stream over SSE from the local dashboard server (server-side subscriber; PREVENT-ITH-004: localhost only) |
| Fleet view `/ithacus-agents` | existing | agent_status + agent_done |

### 2.5 Guardrails

- `src/events.ts` + `src/event-bus.ts` are pure — unit-testable with
  `node --test`, zero pi imports.
- Dashboard SSE is localhost-only; the extension source makes zero network
  calls at runtime (dashboard server is a separate dev tool, already scoped in
  Sprint 5.12).

## 3. Files changed

| File | Change |
|---|---|
| `src/events.ts` | NEW — event types |
| `src/event-bus.ts` | NEW — bus + bounded history |
| `extensions/ithacus-live.ts` | publish to bus on every update |
| `extensions/ithacus-runtime.ts` | singleton bus instance |

## 4. Testing

- Unit (src): bus publish/subscribe/unsubscribe isolation; subscriber throw
  doesn't break others; history bound; event ordering preserved.
- Integration: dispatch → assert overlay + a test subscriber both received the
  same agent_status sequence.
- Gate: build + smoke + guardrails + regression.

## 5. Out of scope

- Remote event replication (A2A transport is Sprint 5.9).
- Event persistence/replay (history is in-memory, bounded).
