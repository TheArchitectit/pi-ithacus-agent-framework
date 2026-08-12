/**
 * mailbox.ts — pi-agnostic inter-agent mailbox over the ith_inbox table.
 *
 * Pure ops over IthStore; no pi imports (PREVENT: src/ stays pi-agnostic).
 * Zero network (PREVENT-ITH-004): everything is local sqlite.
 *
 * Addressing: an agent's mailbox address is its name — the value stamped into
 * the child's env as ITHACUS_AGENT_ID by spawnAgent. The parent/interactive
 * session falls back to "interactive". Sender identity is always recorded
 * in fromAgent.
 */

import { randomUUID } from "node:crypto";
import type { IthStore } from "./store.js";
import type { IthInboxMessage } from "./types.js";
import type { IthacusEvent } from "./events.js";

/** Sprint 5.22 (docs/DESIGN_LIVE_A2A_ACCOUNTING.md §4.1): an optional emitter
 *  ctx threaded into the mailbox producers. `publish` is best-effort per the
 *  event-stream contract (DESIGN_EVENT_STREAM.md §2.2) — a missing or throwing
 *  subscriber can never break the mailbox hot path. Defaults to noop, so every
 *  existing call site compiles unchanged (additive optional param). */
export interface MailboxEmitCtx {
  publish?: (ev: IthacusEvent) => void;
}

const NOOP_PUBLISH = (_ev: IthacusEvent): void => {
  /* noop — mailbox stays pi-agnostic when no bus is wired */
};

/** Publish one A2A event, best-effort: a throwing subscriber must not break
 *  the mailbox write. Returns/logs nothing. */
function safePublish(ctx: MailboxEmitCtx | undefined, ev: IthacusEvent): void {
  const publish = ctx?.publish ?? NOOP_PUBLISH;
  try {
    publish(ev);
  } catch {
    /* event emission never throws into the mailbox hot path */
  }
}

export const INTERACTIVE_ID = "interactive";

/** #66: children commonly address the interactive parent as "parent" (in
 *  prompts and natural language), but the interactive session reads its inbox
 *  as "interactive". Both names must hit the same mailbox. */
export const PARENT_ALIAS = "parent";

/** Resolve an inbox address to its canonical form. "parent" maps to
 *  "interactive" so messages either name land in the same mailbox. */
export function canonicalAddress(addr: string): string {
  return addr === PARENT_ALIAS ? INTERACTIVE_ID : addr;
}

/** Sender identity: explicit override > ITHACUS_AGENT_ID env > "interactive".
 *  Normalizes "parent" → "interactive" via canonicalAddress. */
export function resolveSelfAgentId(
  env: Record<string, string | undefined>,
  override?: string,
): string {
  return canonicalAddress(override || env.ITHACUS_AGENT_ID || INTERACTIVE_ID);
}

export interface MailboxSendOpts {
  to: string;
  from: string;
  payload: string;
  now?: number;
}

export function mailboxSend(
  store: IthStore,
  opts: MailboxSendOpts,
  ctx?: MailboxEmitCtx,
): IthInboxMessage {
  if (!opts.to.trim()) throw new Error("mailboxSend: recipient `to` must be non-empty");
  if (!opts.payload.trim()) throw new Error("mailboxSend: `payload` must be non-empty");
  const msg: IthInboxMessage = {
    id: `msg-${randomUUID()}`,
    agentId: opts.to,
    fromAgent: opts.from,
    payload: opts.payload,
    ts: opts.now ?? Date.now(),
    read: false,
  };
  store.sendMessage(msg);
  // Sprint 5.22: live A2A accounting — metadata-only event + rollup row.
  const event: IthacusEvent = {
    type: "message_sent",
    from: opts.from,
    to: opts.to,
    msgId: msg.id,
    kind: "direct",
    ts: msg.ts,
  };
  safePublish(ctx, event);
  store.recordA2aEvent(event);
  return msg;
}

/** Fan-out: one row per recipient. Dedupes, excludes the sender. Emits exactly
 *  ONE message_sent event per wall-clock broadcast (kind "broadcast", to "*",
 *  DESIGN_LIVE_A2A_ACCOUNTING.md §4.1) regardless of recipient count. */
export function mailboxBroadcast(
  store: IthStore,
  opts: { from: string; payload: string; recipients: string[]; now?: number },
  ctx?: MailboxEmitCtx,
): IthInboxMessage[] {
  if (!opts.payload.trim()) throw new Error("mailboxBroadcast: `payload` must be non-empty");
  const sent: IthInboxMessage[] = [];
  const seen = new Set<string>();
  const now = opts.now ?? Date.now();
  for (const to of opts.recipients) {
    if (!to || to === opts.from || seen.has(to)) continue;
    seen.add(to);
    const msg: IthInboxMessage = {
      id: `msg-${randomUUID()}`,
      agentId: to,
      fromAgent: opts.from,
      payload: opts.payload,
      ts: now,
      read: false,
    };
    store.sendMessage(msg);
    sent.push(msg);
  }
  // One message_sent per wall-clock send (the whole broadcast = one send).
  const event: IthacusEvent = {
    type: "message_sent",
    from: opts.from,
    to: "*",
    msgId: sent.length > 0 ? sent[0].id : `msg-${randomUUID()}`,
    kind: "broadcast",
    ts: now,
  };
  safePublish(ctx, event);
  store.recordA2aEvent(event);
  return sent;
}

export interface MailboxInboxResult {
  messages: IthInboxMessage[];
  unreadCount: number;
}

/**
 * Listing. markRead=true consumes the returned unread rows (a "read" action);
 * markRead=false is a non-destructive view (a "peek").
 */
export function mailboxInbox(
  store: IthStore,
  opts: { agentId: string; markRead: boolean; includeRead?: boolean; now?: number },
  ctx?: MailboxEmitCtx,
): MailboxInboxResult {
  // #66: when the interactive session reads, also match "parent"-addressed messages.
  const ids = opts.agentId === INTERACTIVE_ID ? [INTERACTIVE_ID, PARENT_ALIAS] : [opts.agentId];
  const messages = opts.includeRead
    ? ids.flatMap((id) => store.inbox(id, true))
    : ids.flatMap((id) => store.unread(id));
  let newlyRead = 0;
  if (opts.markRead) {
    for (const m of messages) {
      if (!m.read) {
        store.markRead(m.id);
        newlyRead++;
      }
    }
  }
  // Sprint 5.22: message_read carries the count of messages just marked read
  // (skip when 0 — a pure peek/read-of-empty emits nothing).
  if (newlyRead > 0) {
    const event: IthacusEvent = {
      type: "message_read",
      agentId: opts.agentId,
      count: newlyRead,
      ts: opts.now ?? Date.now(),
    };
    safePublish(ctx, event);
    store.recordA2aEvent(event);
  }
  return { messages, unreadCount: store.unreadCount(opts.agentId) };
}

export function mailboxUnreadCount(store: IthStore, agentId: string): number {
  // #66: interactive session counts both "interactive" and "parent" messages.
  if (agentId === INTERACTIVE_ID) {
    return store.unreadCount(INTERACTIVE_ID) + store.unreadCount(PARENT_ALIAS);
  }
  return store.unreadCount(agentId);
}

/** Known addresses: every recipient/sender ever seen in the table. */
export function mailboxKnownRecipients(store: IthStore): string[] {
  return store.inboxContacts();
}
