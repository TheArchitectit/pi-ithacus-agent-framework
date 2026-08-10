/**
 * ithacus-message.ts — registers the `ithacus-mailbox` LLM-invoked tool.
 *
 * Adapter layer over the pi-agnostic src/mailbox.ts. Lets agents (children
 * spawned via ithacus-dispatch, addressed by their ITHACUS_AGENT_ID env) and
 * the interactive session ("interactive") pass messages through ith_inbox.
 *
 * Actions: send (to one recipient), broadcast (to all known agents),
 * read (fetch unread + consume), peek (non-destructive view).
 *
 * PREVENT-ITH-004: all ops are local sqlite via IthStore — zero network.
 */

import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { IthRuntime } from "./ithacus-runtime.js";
import { discoverIthacusAgents } from "./ithacus-agents.js";
import {
  mailboxBroadcast,
  mailboxInbox,
  mailboxKnownRecipients,
  mailboxSend,
  resolveSelfAgentId,
} from "../src/mailbox.js";

const MailboxParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("send"),
      Type.Literal("read"),
      Type.Literal("broadcast"),
      Type.Literal("peek"),
    ],
    { description: "Mailbox operation." },
  ),
  to: Type.Optional(
    Type.String({ description: "Recipient agent name (send only), e.g. 'reviewer'." }),
  ),
  payload: Type.Optional(Type.String({ description: "Message text (send/broadcast)." })),
  as: Type.Optional(
    Type.String({
      description:
        "Sender identity override; defaults to ITHACUS_AGENT_ID env, then 'interactive'.",
    }),
  ),
  includeRead: Type.Optional(
    Type.Boolean({ description: "peek: also return already-read messages (default false)." }),
  ),
});

interface MailboxDetails {
  action: string;
  self: string;
  messageIds: string[];
  unreadCount?: number;
  recipients?: string[];
  error?: string;
}

export function registerMailboxTool(pi: ExtensionAPI, runtime: IthRuntime): void {
  const tool: ToolDefinition<typeof MailboxParams, MailboxDetails> = {
    name: "ithacus-mailbox",
    label: "ithacus mailbox",
    description:
      "Inter-agent mailbox (ith_inbox): send/read/broadcast between ithacus agents. " +
      "You are identified by your ITHACUS_AGENT_ID env (set by ithacus-dispatch); " +
      "messages are read per-recipient from the shared per-repo sqlite mailbox. " +
      "'read' consumes unread; 'peek' views without consuming.",
    parameters: MailboxParams,
    async execute(
      _toolCallId,
      params: {
        action: "send" | "read" | "broadcast" | "peek";
        to?: string;
        payload?: string;
        as?: string;
        includeRead?: boolean;
      },
      _signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      runtime.bindRepo(ctx.cwd);
      const self = resolveSelfAgentId(process.env, params.as);
      const store = runtime.store;
      const fail = (error: string) => ({
        content: [{ type: "text" as const, text: `mailbox ${params.action}: ${error}` }],
        details: { action: params.action, self, messageIds: [], error },
      });

      try {
        if (params.action === "send") {
          if (!params.to) return fail("missing `to` (recipient agent name)");
          if (!params.payload) return fail("missing `payload` (message text)");
          const msg = mailboxSend(store, { to: params.to, from: self, payload: params.payload });
          runtime.appendEvent("mailbox_send", { from: self, to: params.to, id: msg.id });
          return {
            content: [{ type: "text" as const, text: `sent ${msg.id} ${self} → ${params.to}` }],
            details: { action: "send", self, messageIds: [msg.id] },
          };
        }

        if (params.action === "broadcast") {
          if (!params.payload) return fail("missing `payload` (message text)");
          const known = new Set<string>([
            ...discoverIthacusAgents().map((a) => a.name),
            ...mailboxKnownRecipients(store),
            ...runtime.runningByType.keys(),
          ]);
          const recipients = [...known].filter((n) => n !== self);
          if (recipients.length === 0) return fail("no known recipients");
          const sent = mailboxBroadcast(store, { from: self, payload: params.payload, recipients });
          runtime.appendEvent("mailbox_broadcast", { from: self, n: sent.length });
          return {
            content: [
              {
                type: "text" as const,
                text: `broadcast ${sent.length} messages ${self} → ${recipients.join(", ")}`,
              },
            ],
            details: {
              action: "broadcast",
              self,
              messageIds: sent.map((m) => m.id),
              recipients,
            },
          };
        }

        // read | peek
        const markRead = params.action === "read";
        const { messages, unreadCount } = mailboxInbox(store, {
          agentId: self,
          markRead,
          includeRead: params.includeRead ?? false,
        });
        runtime.appendEvent(markRead ? "mailbox_read" : "mailbox_peek", {
          agent: self,
          n: messages.length,
        });
        const text =
          messages.length === 0
            ? `inbox for ${self}: empty (unread: ${unreadCount})`
            : messages
                .map(
                  (m) =>
                    `[${new Date(m.ts).toISOString()}] ${m.fromAgent ?? "?"} → ${self}: ${m.payload}` +
                    (m.read ? " (read)" : ""),
                )
                .join("\n");
        return {
          content: [{ type: "text" as const, text }],
          details: {
            action: params.action,
            self,
            messageIds: messages.map((m) => m.id),
            unreadCount,
          },
        };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };

  pi.registerTool(tool);
}
