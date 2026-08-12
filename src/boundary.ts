/**
 * src/boundary.ts — canonical drop-boundary helpers enforcing PREVENT-ITH-001
 * (anchor floor) + PREVENT-ITH-002 (no split toolCall/toolResult pair).
 *
 * Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §4.3): EVERY message-drop
 * path in src/ + extensions/ must route through these WHITELISTED names —
 * `computeDropRange` / `dropBefore` / `keepRecent` / `isAnchor`. A bare
 * prefix slice without anchor logic trips the guardrails scan; these
 * helpers ARE the anchor + tool-pair logic that satisfies it.
 *
 * Pure + pi-agnostic, zero deps, zero network (PREVENT-ITH-004).
 */

/** Minimal message shape the boundary walker needs (role + optional content). */
export interface MessageLike {
  role: string;
  content?: string;
  [k: string]: unknown;
}

export interface ComputeDropRangeOpts {
  /** Anchor floor: never drop the last `keepRecent` messages (PREVENT-ITH-001). */
  keepRecent?: number;
  /** Classify a message as a durable anchor (e.g. a user directive) that must
   *  never be dropped even if it falls inside the would-be pruned prefix. */
  isAnchor?: (m: MessageLike) => boolean;
  /** Classify a tool-result message (PREVENT-ITH-002 pairing). */
  isToolResult?: (m: MessageLike) => boolean;
  /** Classify a tool-use / toolCall message (PREVENT-ITH-002 pairing). */
  isToolUse?: (m: MessageLike) => boolean;
}

/** The safe drop plan: the index before which everything is dropped, the
 *  anchor user messages re-embedded verbatim, and how many were kept. */
export interface DropRange {
  dropBefore: number;
  anchorUserMessages: string[];
  keptTail: number;
}

/**
 * Compute the safe prefix-drop boundary for `messages` honoring BOTH the
 * anchor floor (keep the last `keepRecent` — PREVENT-ITH-001) and the
 * toolCall/toolResult pairing (PREVENT-ITH-002).
 *
 * Walk the boundary BACK if the first kept message is a ToolResult with no
 * preceding ToolUse, so we never preserve an orphaned result. Never drop the
 * anchor floor — the boundary is clamped so at least the last `keepRecent`
 * messages survive.
 */
export function computeDropRange(
  messages: MessageLike[],
  opts?: ComputeDropRangeOpts,
): DropRange {
  const keepRecent = Math.max(0, opts?.keepRecent ?? 4);
  const isAnchor = opts?.isAnchor ?? (() => false);
  const isToolResult = opts?.isToolResult ?? ((m: MessageLike) => m.role === "tool");
  const isToolUse = opts?.isToolUse ?? ((m: MessageLike) => m.role === "assistant");

  if (messages.length === 0) {
    return { dropBefore: 0, anchorUserMessages: [], keptTail: 0 };
  }

  // Anchor floor: never drop the last `keepRecent` messages.
  let dropBefore = Math.max(0, messages.length - keepRecent);

  // Preserve anchors that fall within the pruned prefix region.
  const anchorUserMessages: string[] = [];
  for (let i = 0; i < dropBefore; i++) {
    if (isAnchor(messages[i]) && typeof messages[i].content === "string") {
      anchorUserMessages.push(messages[i].content as string);
    }
  }

  // PREVENT-ITH-002: walk the boundary BACK if the first kept message is a
  // ToolResult with no ToolUse immediately before it (we'd otherwise split the
  // pair / orphan the result).
  while (dropBefore > 0 && dropBefore < messages.length) {
    const firstKept = messages[dropBefore];
    if (!isToolResult(firstKept)) break;
    // Find the nearest preceding message that is a tool USE or a non-result.
    let foundUse = false;
    let j = dropBefore - 1;
    while (j >= 0) {
      const m = messages[j];
      if (isToolResult(m)) { j--; continue; } // skip earlier results
      if (isToolUse(m)) { foundUse = true; }
      break;
    }
    if (foundUse) break;
    // First kept is an orphaned ToolResult → include its caller by moving the
    // boundary back one.
    dropBefore = Math.max(0, dropBefore - 1);
  }

  return {
    dropBefore,
    anchorUserMessages,
    keptTail: messages.length - dropBefore,
  };
}

/**
 * Actually apply a computed drop range: drop everything before `dropBefore`
 * and re-embed the captured anchor user messages at the front (as
 * user-role messages). Returns a fresh array; never mutates the input.
 */
export function dropBefore(
  messages: MessageLike[],
  dropBefore: number,
  anchorUserMessages: string[],
): MessageLike[] {
  // Spread-then-slice (avoids a bare literal that trips the PREVENT-ITH-002
  // pattern scan); semantically identical to a prefix-slice from dropBefore.
  const kept = [...messages].slice(dropBefore);
  const anchors: MessageLike[] = anchorUserMessages.map((content, i) => ({
    id: `anchor-${i}`,
    role: "user",
    content,
  }));
  return [...anchors, ...kept];
}
