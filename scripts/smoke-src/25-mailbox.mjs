// ---- inter-agent mailbox (task #16, module 25) ----------------------------
import { failures, check, tmpRepo, cfg, IthStore, mailbox, mkdtempSync, join, tmpdir, execSync } from "./_harness.mjs";
export async function run(ctx) {

const mCfg = cfg.loadConfig();
const mStore = new IthStore(tmpRepo, mCfg);

// resolveSelfAgentId precedence: override > env > "interactive"
check("mailbox.identity override wins", mailbox.resolveSelfAgentId({ ITHACUS_AGENT_ID: "explore" }, "custom") === "custom");
check("mailbox.identity env used", mailbox.resolveSelfAgentId({ ITHACUS_AGENT_ID: "plan" }) === "plan");
check("mailbox.identity fallback interactive", mailbox.resolveSelfAgentId({}) === "interactive");

// send + peek (peek must NOT mark read)
const sent = mailbox.mailboxSend(mStore, { to: "reviewer", from: "explore", payload: "look at foo.ts", now: 1 });
check("mailbox.send returns row", sent.id.startsWith("msg-") && sent.read === false && sent.fromAgent === "explore");
const peek1 = mailbox.mailboxInbox(mStore, { agentId: "reviewer", markRead: false });
check("mailbox.peek shows msg", peek1.messages.length === 1 && peek1.messages[0].payload === "look at foo.ts");
check("mailbox.peek not consumed", peek1.unreadCount === 1);
check("mailbox.peek again still there", mailbox.mailboxInbox(mStore, { agentId: "reviewer", markRead: false }).messages.length === 1);

// read consumes
const read1 = mailbox.mailboxInbox(mStore, { agentId: "reviewer", markRead: true });
check("mailbox.read returns msg", read1.messages.length === 1);
check("mailbox.read consumed", mailbox.mailboxUnreadCount(mStore, "reviewer") === 0);
const hist = mailbox.mailboxInbox(mStore, { agentId: "reviewer", markRead: false, includeRead: true });
check("mailbox.history keeps read rows", hist.messages.length === 1 && hist.messages[0].read === true);

// broadcast fan-out: sender excluded, inboxes independent
const sentB = mailbox.mailboxBroadcast(mStore, { from: "plan", payload: "phase-2", recipients: ["explore", "verification", "plan", "reviewer"], now: 2 });
check("mailbox.broadcast 3 sent (self excluded)", sentB.length === 3);
check("mailbox.broadcast excluded sender", mailbox.mailboxUnreadCount(mStore, "plan") === 0);
check("mailbox.broadcast explore unread", mailbox.mailboxUnreadCount(mStore, "explore") === 1);
mailbox.mailboxInbox(mStore, { agentId: "explore", markRead: true });
check("mailbox.broadcast inboxes independent", mailbox.mailboxUnreadCount(mStore, "verification") === 1);

// send validation
let threw = false;
try { mailbox.mailboxSend(mStore, { to: "", from: "a", payload: "x" }); } catch { threw = true; }
check("mailbox.send empty to throws", threw);

// known recipients = union of senders + recipients
const known = mailbox.mailboxKnownRecipients(mStore);
check("mailbox.knownRecipients union", ["explore", "plan", "reviewer", "verification"].every((a) => known.includes(a)));

// multi-process safety: two IthStore handles on the SAME repo interleave writes
const tmp2 = mkdtempSync(join(tmpdir(), "ith-mail-"));
execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", { cwd: tmp2 });
const st1 = new IthStore(tmp2, mCfg);
const st2 = new IthStore(tmp2, mCfg);
mailbox.mailboxSend(st1, { to: "worker", from: "a1", payload: "p1" });
mailbox.mailboxSend(st2, { to: "worker", from: "a2", payload: "p2" });
mailbox.mailboxSend(st1, { to: "worker", from: "a3", payload: "p3" });
const interleaved = mailbox.mailboxInbox(st2, { agentId: "worker", markRead: false });
check("mailbox.two-handle writes all visible", interleaved.messages.length === 3);
check("mailbox.two-handle unordered rows intact", new Set(interleaved.messages.map((m) => m.payload)).size === 3);
st1.close(); st2.close();
mStore.close();
}
