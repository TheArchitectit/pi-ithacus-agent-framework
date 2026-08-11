/**
 * src/event-bus.ts — the in-process typed event bus (Sprint 5.20 seam,
 * docs/DESIGN_EVENT_STREAM.md §2.2), layered into Sprint 5.13 from day one.
 *
 * One subscriber API for every present + future view ("one event stream,
 * many views"): 5.13's live store publishes through the IthRuntime singleton
 * instance; richer status (5.14), the web dashboard (5.12), and fleet views
 * subscribe later without touching producers.
 *
 * Rules (DESIGN_EVENT_STREAM.md §2.2): publish NEVER throws into subscribers
 * (each wrapped in try/catch — the defensive-render rule applied to events);
 * history is a bounded ring (in-memory only, memory-safe); no networking, no
 * timers (src/ is pure — PREVENT-ITH-004). Unit-testable with
 * `node --test` (src/event-bus.test.ts).
 */

import type { IthacusEvent } from "./events.js";

/** Subscriber callback — receives every published event in publish order. */
export type IthacusEventSubscriber = (ev: IthacusEvent) => void;

/** The bus contract producers and consumers share (see createEventBus). */
export interface IthacusEventBus {
  publish(ev: IthacusEvent): void;
  subscribe(fn: IthacusEventSubscriber): () => void; // returns unsubscribe
  history(limit?: number): IthacusEvent[]; // bounded ring buffer, default 500
}

/** Default history cap: events retained for late subscribers (memory-bounded). */
export const EVENT_HISTORY_CAP = 500;

/**
 * Create a fresh, isolated bus instance. The IthRuntime singleton wires the
 * live store one time via wireLiveEventBus(); tests create their own.
 */
export function createEventBus(cap: number = EVENT_HISTORY_CAP): IthacusEventBus {
  const bound = Math.max(1, Math.floor(cap));
  const subscribers = new Set<IthacusEventSubscriber>();
  const ring: IthacusEvent[] = [];
  return {
    publish(ev: IthacusEvent): void {
      try {
        ring.push(ev);
        if (ring.length > bound) ring.splice(0, ring.length - bound);
      } catch {
        /* history retention must never break publish */
      }
      // Iterate a snapshot so a subscriber that unsubscribes mid-publish
      // cannot disturb this delivery pass.
      for (const fn of [...subscribers]) {
        try {
          fn(ev);
        } catch {
          /* one bad subscriber must not break the others or the hot path */
        }
      }
    },
    subscribe(fn: IthacusEventSubscriber): () => void {
      subscribers.add(fn);
      let active = true;
      return () => {
        if (!active) return; // unsubscribe is idempotent
        active = false;
        subscribers.delete(fn);
      };
    },
    history(limit?: number): IthacusEvent[] {
      const n = limit === undefined ? ring.length : Math.max(0, Math.floor(limit));
      return ring.slice(Math.max(0, ring.length - n));
    },
  };
}
