# ithacus — Live A2A Accounting

**Sprint 5.22 · Design spec**

## 1. Goal

Make **peer-to-peer agent traffic** (mailbox messages + handoffs) **live-visible
and accounted**, the same way Sprints 5.13/5.14/5.20 made parent→child dispatch
visible. Today the eventBus only carries dispatch-lifecycle events
(`run_started`, `agent_status`, `agent_tokens`, `agent_tps`,
`tool_execution_start/end`, `agent_done`, `run_finished` — see `src/events.ts`).
Mailbox sends, broadcasts, reads, and handoffs are invisible to the live card
and to any other eventBus consumer (including the future web UI, 5.23).

This is the last "live enterprise" gap identified in
`docs/GAP_ANALYSIS_2026_LANDSCAPE.md` (partial column under A2A
accounting/observability).

## 2. Current surfaces (what we extend, not rebuild)

| Module | Existing fns | Missing |
|---|---|---|
| `src/mailbox.ts` | `mailboxSend`, `mailboxBroadcast`, `mailboxInbox`, `mailboxUnreadCount`, `mailboxKnownRecipients` | event emission |
| `src/handoff.ts` | `createHandoffManager(policy)` → `registerAgent`, `findCandidates`, `execute` path, `getHistory` | event emission |
| `src/presence.ts` | `joinPresence`, `leavePresence`, `heartbeat`, `detectStuck`, `listPresences` | projection into workflow view |
| `src/event-bus.ts` | `createEventBus(cap)`, `publish`, `subscribe` (returns unsubscribe), history replay for late subscribers | new event variants |
| live card (5.13.1) | section-extensible layout (`▌ workflow`, `▌ activity`) | `▌ inbox`, `▌ handoffs` sections |

Producers must obey the **publish-never-throws** contract
(DESIGN_EVENT_STREAM.md §2.2) — event emission is best-effort, wrapped so a
bad subscriber or missing bus can never break the mailbox/handoff hot path.

## 3. New event variants

Extend `IthacusEvent` (`src/events.ts`) — file is at size budget; new variants
go into a sibling split file `src/types-sprint-5.22.ts` if `events.ts` is
over limit per CLAUDE.md convention (types.ts split-file rule applies to all
files >= limit):

```ts
| { type: "message_sent"; from: string; to: string; msgId: string;
    kind: "direct" | "broadcast"; ts: number }
| { type: "message_read"; agentId: string; count: number; ts: number }
| { type: "handoff_initiated"; from: string; to: string | null;
    reason: string; ts: number }
| { type: "handoff_accepted"; handoffId: string; from: string; to: string;
    ts: number }
| { type: "presence_changed"; agentId: string; state: string; ts: number }
```

Notes:
- `to: null` on `handoff_initiated` = open handoff (findCandidates path).
- Events carry **metadata only** — no message bodies (privacy + payload size;
  bodies stay in the ith_inbox table, reachable via `/ithacus-inbox` / 5.23
  Inbox view).
- No new runId concept: mailbox/handoff traffic is run-independent
  (peer-to-peer), so these variants runId-optional with `runId?: string` when
  the sender is mid-dispatch. Card renders them under a run when attributed,
  else in a fleet-wide strip.

## 4. Producer wiring

### 4.1 Mailbox (`src/mailbox.ts`)

- Optional 3rd-arg emitter: `mailboxSend(store, opts, ctx?: MailboxEmitCtx)`
  where `MailboxEmitCtx = { publish?: (ev: IthacusEvent) => void }`. Same for
  `mailboxBroadcast` (one `message_sent` row per wall-clock send, marked
  `kind:"broadcast"`, `to:"*"`) and `mailboxInbox` (`message_read` with the
  count of messages marked read; skip when 0).
- Default: `ctx?.publish ?? noop` — keeps `src/` pi-agnostic and keeps every
  existing call site compiling unchanged (additive optional param).
- Emission wraps in the eventBus's own fault-isolation; producers never throw.

### 4.2 Handoff (`src/handoff.ts`)

- `createHandoffManager(policy, ctx?: { publish?: ... })` — emit
  `handoff_initiated` on handoff request, `handoff_accepted` when a candidate
  accepts. Persisted history (`getHistory`) remains SSOT; events are the live
  stream, never the store.

### 4.3 Presence (`src/presence.ts`)

- `joinPresence`/`leavePresence`/`detectStuck` emit `presence_changed`
  (join/leave/stuck transitions only — NOT heartbeat; heartbeats are
  high-frequency and would flood the bus).

### 4.4 Extension layer (`extensions/`)

- `extensions/ithacus-runtime.ts`: construct the `MailboxEmitCtx` once from
  the live runtime's eventBus and thread it into mailbox + handoff factories.
- Mailbox tool handler (`ithacus-message`) passes ctx from runtime.
- CONTINUITY: Sprint 5.20's event-bus subscription surface is unchanged —
  this sprint only adds event *variants*.

## 5. Live card sections (5.13.1 layout extension)

Two new optional sections, following the 5.13.1 section-registry pattern:

```
▌ inbox   ● planner→worker "scope confirmed"  2m   ● broadcast:worker×3  5m
▌ handoffs ● explorer→writer accepted "implement fix"  1m
```

- Sections render only when events exist (no empty chrome).
- Fleet strip shows unread totals: `✉ 7 unread·3 agents`.
- `presence_changed` feeds the workflow view's node styling (stuck = ⚠),
  not a separate section.

## 6. Accounting rollups

- Extend the store with a slim rollup table `ith_a2a_stats(from_agent,
  to_agent, day, sent, read, handoffs)` — upserted alongside event emission
  (same transaction as the mailbox write where applicable).
- Powers: future dashboard widget, `/ithacus-inbox --stats`, fleet health
  view in 5.23. SQLite-only, no new deps.

## 7. Tests (smoke-src, pi-agnostic)

1. `message_sent` emitted with correct from/to/kind on send + broadcast.
2. No publish fn → zero events, zero throws (default no-op path).
3. `message_read` count matches actual newly-read rows; zero-read inbox emits
   nothing.
4. Handoff init/accept pair emitted; open handoff has `to:null`.
5. Heartbeat does NOT emit; join/leave/stuck do.
6. Rollup table upserts correct per-day counters across midnights (fake clock).
7. Subscriber throwing during a `message_sent` publish doesn't affect other
   subscribers or the mailbox write (fault isolation regression).

## 8. Guardrails

- PREVENT-ITH-001/002/003: untouched (no trim/context code).
- PREVENT-ITH-004: fully Tier L — no network; emission is in-process only.
- Publish-never-throws contract honored (DESIGN_EVENT_STREAM.md §2.2).

## 9. Dependencies

- 5.13 (event bus), 5.14 (worker status), 5.13.1 (section-extensible card
  layout), 5.20 (bus subscription surface). All shipped.
- No dependency on TIER 6 remote sprints — pure local accounting.

## 10. Provenance

- Gap flagged in `GAP_ANALYSIS_2026_LANDSCAPE.md` (A2A observability row).
- Event-shape rules: `DESIGN_EVENT_STREAM.md`; card sections: 5.13.1 layout.
