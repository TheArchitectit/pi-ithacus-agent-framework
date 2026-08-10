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

export const INTERACTIVE_ID = "interactive";

/** Sender identity: explicit override > ITHACUS_AGENT_ID env > "interactive". */
export function resolveSelfAgentId(
  env: Record<string, string | undefined>,
  override?: string,
): string {
  return override || env.ITHACUS_AGENT_ID || INTERACTIVE_ID;
}

export interface MailboxSendOpts {
  to: string;
  from: string;
  payload: string;
  now?: number;
}

export function mailboxSend(store: IthStore, opts: MailboxSendOpts): IthInboxMessage {
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
  return msg;
}

/** Fan-out: one row per recipient. Dedupes, excludes the sender. */
export function mailboxBroadcast(
  store: IthStore,
  opts: { from: string; payload: string; recipients: string[]; now?: number },
): IthInboxMessage[] {
  if (!opts.payload.trim()) throw new Error("mailboxBroadcast: `payload` must be non-empty");
  const sent: IthInboxMessage[] = [];
  const seen = new Set<string>();
  for (const to of opts.recipients) {
    if (!to || to === opts.from || seen.has(to)) continue;
    seen.add(to);
    sent.push(mailboxSend(store, { to, from: opts.from, payload: opts.payload, now: opts.now }));
  }
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
  opts: { agentId: string; markRead: boolean; includeRead?: boolean },
): MailboxInboxResult {
  const messages = opts.includeRead
    ? store.inbox(opts.agentId, true)
    : store.unread(opts.agentId);
  if (opts.markRead) {
    for (const m of messages) if (!m.read) store.markRead(m.id);
  }
  return { messages, unreadCount: store.unreadCount(opts.agentId) };
}

export function mailboxUnreadCount(store: IthStore, agentId: string): number {
  return store.unreadCount(agentId);
}

/** Known addresses: every recipient/sender ever seen in the table. */
export function mailboxKnownRecipients(store: IthStore): string[] {
  return store.inboxContacts();
}
