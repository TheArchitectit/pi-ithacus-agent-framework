/**
 * src/event-bus.test.ts — node:test unit tests for the Sprint 5.20 event-bus
 * seam layered into 5.13 (docs/DESIGN_EVENT_STREAM.md §4 "Unit (src)").
 * Pure in-process module: no pi imports, no network (PREVENT-ITH-004).
 *
 * NOTE: imports use explicit .ts specifiers because this file runs under
 * `node --experimental-strip-types --test` (no .js→.ts remap), and it is
 * excluded from the tsc build program (tsconfig exclude) so it never ships.
 * Run: node --experimental-strip-types --test src/event-bus.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createEventBus, EVENT_HISTORY_CAP, type IthacusEventBus } from "./event-bus.ts";
import type { IthacusEvent } from "./events.ts";

const ev = (n: number): IthacusEvent => ({ type: "run_started", runId: `r${n}`, ts: n });
const fin = (n: number, status = "done"): IthacusEvent => ({ type: "run_finished", runId: `r${n}`, status, ts: n });

test("factory: history cap constant matches the spec default 500", () => {
  assert.equal(EVENT_HISTORY_CAP, 500);
});

test("isolation: two buses do not see each other's events", () => {
  const a: IthacusEventBus = createEventBus();
  const b: IthacusEventBus = createEventBus();
  const gotA: IthacusEvent[] = [];
  const gotB: IthacusEvent[] = [];
  a.subscribe((e) => gotA.push(e));
  b.subscribe((e) => gotB.push(e));
  a.publish(ev(1));
  assert.equal(gotA.length, 1);
  assert.equal(gotB.length, 0);
});

test("publish: delivers to every subscriber in publish order", () => {
  const bus = createEventBus();
  const one: IthacusEvent[] = [];
  const two: IthacusEvent[] = [];
  bus.subscribe((e) => one.push(e));
  bus.subscribe((e) => two.push(e));
  bus.publish(ev(1));
  bus.publish(ev(2));
  bus.publish(fin(3));
  assert.deepEqual(one.map((e) => e.type), ["run_started", "run_started", "run_finished"]);
  assert.deepEqual(two.map((e) => e.type), one.map((e) => e.type));
  // event ordering preserved (monotonic ts within the stream)
  assert.ok(one[0].ts < one[1].ts && one[1].ts < one[2].ts);
});

test("unsubscribe: stops delivery and is idempotent", () => {
  const bus = createEventBus();
  const got: IthacusEvent[] = [];
  const unsub = bus.subscribe((e) => got.push(e));
  bus.publish(ev(1));
  unsub();
  unsub(); // double-unsubscribe must be a no-op
  bus.publish(ev(2));
  assert.equal(got.length, 1);
});

test("publish: a throwing subscriber breaks neither publish nor other subscribers", () => {
  const bus = createEventBus();
  const got: IthacusEvent[] = [];
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe((e) => got.push(e));
  assert.doesNotThrow(() => bus.publish(ev(1)));
  assert.equal(got.length, 1);
});

test("history: bounded at the default cap (last 500 retained)", () => {
  const bus = createEventBus();
  for (let i = 0; i < EVENT_HISTORY_CAP + 100; i++) bus.publish(ev(i));
  const h = bus.history();
  assert.equal(h.length, EVENT_HISTORY_CAP);
  assert.equal(h[0].runId, "r100"); // first retained = the 101st published
  assert.equal(h[h.length - 1].runId, `r${EVENT_HISTORY_CAP + 99}`);
});

test("history(limit): returns the tail slice only", () => {
  const bus = createEventBus();
  for (let i = 0; i < 5; i++) bus.publish(ev(i));
  const h = bus.history(2);
  assert.deepEqual(h.map((e) => e.runId), ["r3", "r4"]);
  assert.equal(bus.history(0).length, 0);
});

test("custom cap: history is bounded by it", () => {
  const bus = createEventBus(3);
  for (let i = 0; i < 5; i++) bus.publish(ev(i));
  assert.equal(bus.history().length, 3);
  assert.equal(bus.history()[0].runId, "r2");
});

test("typed union: every event variant constructs + publishes (compile shape)", () => {
  const bus = createEventBus();
  const got: IthacusEvent[] = [];
  bus.subscribe((e) => got.push(e));
  const batch: IthacusEvent[] = [
    { type: "run_started", runId: "r", ts: 1 },
    { type: "agent_status", runId: "r", agentId: "a", status: "working", ts: 2 },
    { type: "agent_tokens", runId: "r", agentId: "a", input: 10, output: 20, total: 30, ts: 3 },
    { type: "agent_tps", runId: "r", agentId: "a", tps: 12.5, windowMs: 1600, ts: 4 },
    { type: "tool_execution_start", runId: "r", agentId: "a", tool: "read", ts: 5 },
    { type: "tool_execution_end", runId: "r", agentId: "a", tool: "read", ok: true, durationMs: 30, ts: 6 },
    { type: "agent_done", runId: "r", agentId: "a", status: "failed", failureKind: "unknown", ts: 7 },
    { type: "run_finished", runId: "r", status: "failed", ts: 8 },
  ];
  for (const e of batch) bus.publish(e);
  assert.equal(got.length, batch.length);
  assert.equal(bus.history(bus.history().length).length, batch.length);
});
