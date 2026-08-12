// ---- Live A2A accounting (Sprint 5.22, module 33) ------------------------
// docs/DESIGN_LIVE_A2A_ACCOUNTING.md — peer-to-peer mailbox/handoff/presence
// traffic made live-visible via the typed event bus + the ith_a2a_stats rollup.
import {
  check, cfg, IthStore, tmpRepo, mailbox, presence, PresenceStore, createHandoffManager,
} from "./_harness.mjs";

const noopBus = { publish: () => {}, subscribe: () => () => {}, history: () => [] };
const collect = (sink) => ({ publish: (ev) => { try { sink.push(ev); } catch {} } });

export async function run(ctx) {
console.log("S33_RUN_ENTERED");
try {

// 1. Default no-op path: no publish fn → zero events, zero throws.
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  mailbox.mailboxSend(store, { to: "a2a-nop-r", from: "a2a-nop-f", payload: "no-op test", now: 1 });
  mailbox.mailboxBroadcast(store, { from: "a2a-nop-b", payload: "b", recipients: ["a2a-nop-x", "a2a-nop-y"], now: 2 });
  mailbox.mailboxInbox(store, { agentId: "a2a-nop-r", markRead: true });
  check("a2a no-op path: zero throws (no ctx)",
    mailbox.mailboxUnreadCount(store, "a2a-nop-x") === 1);
  store.close();
}

// 2. mailboxSend → message_sent (direct, correct from/to/kind/msgId).
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  const sink = [];
  const sent = mailbox.mailboxSend(store, { to: "a2a-send-r", from: "a2a-send-f", payload: "look", now: 10 }, collect(sink));
  check("a2a send emits message_sent", sink.length === 1 && sink[0].type === "message_sent");
  check("a2a send event from/to/kind/msgId",
    sink[0].from === "a2a-send-f" && sink[0].to === "a2a-send-r" &&
    sink[0].kind === "direct" && sink[0].msgId === sent.id && sink[0].ts === 10);
  store.close();
}

// 3. mailboxBroadcast → ONE message_sent (kind broadcast, to "*").
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  const sink = [];
  const sent = mailbox.mailboxBroadcast(store, { from: "a2a-bc-f", payload: "phase-2", recipients: ["a2a-bc-a", "a2a-bc-b", "a2a-bc-f", "a2a-bc-c"], now: 20 }, collect(sink));
  const broadcasts = sink.filter((e) => e.type === "message_sent" && e.kind === "broadcast");
  check("a2a broadcast emits one message_sent", broadcasts.length === 1);
  check("a2a broadcast to:* + from + ts",
    broadcasts[0].to === "*" && broadcasts[0].from === "a2a-bc-f" && broadcasts[0].ts === 20);
  check("a2a broadcast rows written per recipient (self excluded)",
    mailbox.mailboxUnreadCount(store, "a2a-bc-a") === 1 &&
    mailbox.mailboxUnreadCount(store, "a2a-bc-b") === 1 &&
    mailbox.mailboxUnreadCount(store, "a2a-bc-c") === 1 &&
    mailbox.mailboxUnreadCount(store, "a2a-bc-f") === 0);
  check("a2a broadcast msgId anchors the first sent message",
    sent.length === 3 && broadcasts[0].msgId === sent[0].id);
  store.close();
}

// 4. mailboxInbox read → message_read with count of newly-read.
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  mailbox.mailboxSend(store, { to: "a2a-rd-w", from: "a2a-rd-l", payload: "a" });
  mailbox.mailboxSend(store, { to: "a2a-rd-w", from: "a2a-rd-l", payload: "b" });
  const sink = [];
  mailbox.mailboxInbox(store, { agentId: "a2a-rd-w", markRead: true }, collect(sink));
  const reads = sink.filter((e) => e.type === "message_read");
  check("a2a read emits message_read with actual count", reads.length === 1 && reads[0].count === 2 && reads[0].agentId === "a2a-rd-w");
  mailbox.mailboxInbox(store, { agentId: "a2a-rd-w", markRead: true }, collect(sink));
  check("a2a zero-read inbox emits nothing", sink.filter((e) => e.type === "message_read").length === 1);
  const sink2 = [];
  mailbox.mailboxInbox(store, { agentId: "a2a-rd-w", markRead: false }, collect(sink2));
  check("a2a peek never emits message_read", sink2.filter((e) => e.type === "message_read").length === 0);
  store.close();
}

// 5. Handoff: init+accept pair; open handoff has to:null.
{
  const sinkRef = [];
  const hm2 = createHandoffManager(undefined, collect(sinkRef));
  hm2.registerAgent({ agentId: "a2a-h-a3", role: "reviewer", capabilities: ["ts", "review"], available: true, load: 0.1 });
  const ho = await hm2.handoff({ taskId: "t1", fromAgent: "a2a-h-lead", reason: "delegation", priority: "normal", requiredCapabilities: ["ts", "review"], ts: 30 });
  const inits = sinkRef.filter((e) => e.type === "handoff_initiated");
  const accs = sinkRef.filter((e) => e.type === "handoff_accepted");
  check("a2a handoff init emitted (open to:null)", inits.length === 1 && inits[0].from === "a2a-h-lead" && inits[0].to === null && inits[0].reason === "delegation" && inits[0].ts === 30);
  check("a2a handoff accepted emitted", accs.length === 1 && accs[0].to === "a2a-h-a3" && accs[0].from === "a2a-h-lead" && ho.accepted === true);
}

// 6. Presence: heartbeat does NOT emit; join/leave/stuck do.
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  const ps = new PresenceStore(store.db);
  const sink = [];
  const ctxP = collect(sink);
  presence.joinPresence(ps, "a2a-p1", "run-p", 30000, 1000, ctxP);
  presence.heartbeat(ps, "a2a-p1", 2000);
  const stuck = presence.detectStuck(ps, 50000, ctxP);
  presence.leavePresence(ps, "a2a-p1", ctxP);
  const states = sink.filter((e) => e.type === "presence_changed").map((e) => e.state);
  check("a2a presence join+stuck+leave emitted (3 transitions)",
    states.join(",") === "active,stuck,complete" && stuck === 1);
  check("a2a heartbeat adds no event",
    sink.filter((e) => e.type === "presence_changed").length === 3);
  store.close();
}

// 7. Fault isolation: a throwing subscriber never breaks the mailbox write.
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  const sink = [];
  const throwing = { publish: () => { throw new Error("bad subscriber"); } };
  mailbox.mailboxSend(store, { to: "a2a-fi-r", from: "a2a-fi-l", payload: "boom", now: 40 }, { publish: (ev) => { sink.push(ev); throwing.publish(); } });
  check("a2a throwing subscriber swallowed (still wrote + collected)",
    sink.length === 1 && sink[0].type === "message_sent" &&
    mailbox.mailboxUnreadCount(store, "a2a-fi-r") === 1);
  const ps = new PresenceStore(store.db);
  presence.joinPresence(ps, "a2a-fi-p", "r", 30000, 1, { publish: () => { throw new Error("x"); } });
  check("a2a presence throwing emitter swallowed",
    ps.getPresence("a2a-fi-p")?.status === "active");
  store.close();
}

// 8. ith_a2a_stats rollup roundtrip + per-day midnights boundary (fake clock).
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  const sink = [];
  const ctxS = collect(sink);
  const day1 = Date.UTC(2026, 0, 15, 12, 0, 0);
  mailbox.mailboxSend(store, { to: "a2a-stats-r", from: "a2a-stats-f", payload: "d1", now: day1 }, ctxS);
  mailbox.mailboxSend(store, { to: "a2a-stats-r", from: "a2a-stats-f", payload: "d1b", now: day1 }, ctxS);
  mailbox.mailboxBroadcast(store, { from: "a2a-stats-b", payload: "b", recipients: ["a2a-stats-x", "a2a-stats-r"], now: day1 }, ctxS);
  mailbox.mailboxInbox(store, { agentId: "a2a-stats-r", markRead: true, now: day1 }, ctxS);
  store.recordA2aEvent({ type: "handoff_accepted", from: "a2a-stats-f", to: "a2a-stats-w", ts: day1, handoffId: "h1" });
  const day2 = Date.UTC(2026, 0, 16, 1, 0, 0);
  mailbox.mailboxSend(store, { to: "a2a-stats-r", from: "a2a-stats-f", payload: "d2", now: day2 }, ctxS);

  const stats = store.getA2aStats();
  const key = (f, t, d) => stats.find((r) => r.fromAgent === f && r.toAgent === t && r.day === d);
  const d1 = new Date(day1).toISOString().slice(0, 10);
  const d2s = new Date(day2).toISOString().slice(0, 10);
  const exploreToReviewerDay1 = key("a2a-stats-f", "a2a-stats-r", d1);
  const planToStarDay1 = key("a2a-stats-b", "*", d1);
  const reviewerReadDay1 = key("a2a-stats-r", "*", d1);
  const exploreToWriterDay1 = key("a2a-stats-f", "a2a-stats-w", d1);
  const exploreToReviewerDay2 = key("a2a-stats-f", "a2a-stats-r", d2s);
  check("a2a stats sent counter (2 direct day1)",
    exploreToReviewerDay1 !== undefined && exploreToReviewerDay1.sent === 2);
  check("a2a stats broadcast accounted to (plan,*)",
    planToStarDay1 !== undefined && planToStarDay1.sent === 1);
  check("a2a stats read attributed to reader",
    reviewerReadDay1 !== undefined && reviewerReadDay1.read >= 3);
  check("a2a stats handoffs counter",
    exploreToWriterDay1 !== undefined && exploreToWriterDay1.handoffs === 1);
  check("a2a stats midnight boundary splits days",
    exploreToReviewerDay2 !== undefined && exploreToReviewerDay2.sent === 1 &&
    exploreToReviewerDay1.sent === 2);
  store.close();
}

} catch (e) {
  console.log("A2A_MODULE33_THREW: " + (e?.message ?? String(e)) + " :: " + (e?.stack ?? "").split("\n").slice(0,4).join(" | "));
}
}
