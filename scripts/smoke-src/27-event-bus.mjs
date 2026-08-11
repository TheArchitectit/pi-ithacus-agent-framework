// ---- typed event bus (Sprint 5.20 seam layered into 5.13, module 27) ------
import { failures, check, eventsMod, eventBus } from "./_harness.mjs";
export async function run(ctx) {
// events.ts is types-only — importing proves it materializes under the
// type-stripping loader used for the no-build fallback (docs: Node 26 strips).
check("events.module loads (types erase to empty module)", eventsMod !== undefined);

const { createEventBus, EVENT_HISTORY_CAP } = eventBus;
check("bus.factory exported", typeof createEventBus === "function");
check("bus.history cap is the spec default 500", EVENT_HISTORY_CAP === 500);

const bus = createEventBus();
const got = [];
const unsub = bus.subscribe((ev) => got.push(ev));
bus.publish({ type: "run_started", runId: "x", ts: 1 });
bus.publish({ type: "run_finished", runId: "x", status: "done", ts: 2 });
check("bus.subscribe/publish delivers in order",
  got.length === 2 && got[0].type === "run_started" && got[1].type === "run_finished");

// unsubscribe stops delivery + is idempotent
unsub(); unsub();
bus.publish({ type: "run_started", runId: "y", ts: 3 });
check("bus.unsubscribe stops delivery (idempotent)", got.length === 2);

// a throwing subscriber must not break others or the hot path
const got2 = [];
bus.subscribe(() => { throw new Error("boom"); });
bus.subscribe((ev) => got2.push(ev));
bus.publish({ type: "run_started", runId: "z", ts: 4 });
check("bus.throwing subscriber isolated (publish does not throw)", got2.length === 1);
check("bus.event ordering monotonic across mixed publishes",
  got[0].ts < got[1].ts && got2[0].ts === 4);

// history is the bounded ring: default cap 500, tail-slice via limit
for (let i = 0; i < 600; i++) bus.publish({ type: "run_started", runId: "h" + i, ts: i });
check("bus.history bounded at default 500", bus.history().length === 500);
check("bus.history keeps the NEWEST 500", bus.history()[0].runId === "h104");
check("bus.history(limit) tail slice", bus.history(2).length === 2 && bus.history(2)[1].runId === "h599");

// custom cap honored; instances are isolated
const small = createEventBus(3);
for (let i = 0; i < 5; i++) small.publish({ type: "run_started", runId: "s" + i, ts: i });
check("bus.custom cap honored", small.history().length === 3 && small.history()[0].runId === "s2");
check("bus.instances isolated", bus.history(500).length === 500 && small.history().length === 3);
}
