/**
 * checkpoint.ts — mark a checkpoint in a conversation and prune exploratory
 * context after it, keeping a concise summary report.
 *
 * A ConversationMessage is a minimal shape sufficient for pruning decisions;
 * pi's richer message type is adapted at the extension layer.
 *
 * pi-agnostic.
 */

import type { Checkpoint, CheckpointSummary } from './types.js';

/** Minimal conversation message shape used for pruning. */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** 0-indexed turn number (monotonic). */
  turn: number;
  /** whether this message is exploratory (candidate for pruning). */
  exploratory?: boolean;
}

/** Rough token estimate: 1 token ≈ 4 chars. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

let checkpointCounter = 0;

/**
 * Mark a checkpoint at the current turn boundary. Does not mutate the
 * conversation; returns a Checkpoint record the caller persists + uses to drive
 * pruneAfterCheckpoint().
 */
export function markCheckpoint(
  messages: ConversationMessage[],
  runId: string,
  now = Date.now(),
): Checkpoint {
  const turnIndex = messages.length > 0 ? messages[messages.length - 1].turn + 1 : 0;
  const tokenCountBefore = messages.reduce((s, m) => s + estimateTokens(m.content), 0);
  return {
    id: `ckpt-${now.toString(36)}-${++checkpointCounter}`,
    runId,
    turnIndex,
    summary: '',
    tokenCountBefore,
    tokenCountAfter: tokenCountBefore,
    createdAt: now,
  };
}

/**
 * Prune exploratory messages before a checkpoint, replacing them with a single
 * concise summary message. Non-exploratory messages (user directives, tool
 * results marked keep) are preserved.
 * @returns the pruned message list + a CheckpointSummary.
 */
export function pruneAfterCheckpoint(
  messages: ConversationMessage[],
  checkpoint: Checkpoint,
): { messages: ConversationMessage[]; summary: CheckpointSummary } {
  const pruned = messages.filter(m => m.exploratory);
  const kept = messages.filter(m => !m.exploratory);
  const tokensBefore = checkpoint.tokenCountBefore;
  const prunedTokens = pruned.reduce((s, m) => s + estimateTokens(m.content), 0);
  const summaryText = buildSummary(pruned);
  const summaryMessage: ConversationMessage = {
    id: `${checkpoint.id}-summary`,
    role: 'system',
    content: `[checkpoint ${checkpoint.id}] Pruned ${pruned.length} exploratory messages.\n${summaryText}`,
    turn: checkpoint.turnIndex,
    exploratory: false,
  };
  const after = [...kept, summaryMessage];
  const tokensAfter = after.reduce((s, m) => s + estimateTokens(m.content), 0);
  return {
    messages: after,
    summary: {
      checkpointId: checkpoint.id,
      prunedMessageCount: pruned.length,
      tokensSaved: Math.max(0, tokensBefore - tokensAfter),
      summary: summaryText,
    },
  };
}

/**
 * Build a concise summary report from pruned messages: one bullet per unique
 * role, capped to keep the report short.
 */
export function buildSummary(pruned: ConversationMessage[], maxBullets = 8): string {
  if (pruned.length === 0) return 'No exploratory context to summarize.';
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const m of pruned) {
    if (bullets.length >= maxBullets) break;
    const snippet = m.content.split('\n')[0].slice(0, 40);
    const key = `${m.role}:${snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(`- [${m.role}] ${snippet}${m.content.length > 40 ? '…' : ''}`);
  }
  const remaining = pruned.length - bullets.length;
  if (remaining > 0) bullets.push(`- …and ${remaining} more`);
  return bullets.join('\n');
}

/**
 * Rewind: restore the conversation to the state at a checkpoint. Returns a
 * fresh message list truncated to the checkpoint's turn boundary.
 */
export function rewindToCheckpoint(
  messages: ConversationMessage[],
  checkpoint: Checkpoint,
): ConversationMessage[] {
  return messages.filter(m => m.turn < checkpoint.turnIndex);
}
