// src/live-card-toggles.ts — Sprint 5.27 §3.2/§3.3 pure width-size + hide/resume
// toggle logic for the live-progress card.
//
// Pi-agnostic (ZERO pi imports, PREVENT-ITH-004) so it is unit-testable from
// scripts/smoke-src — the src/ smoke harness only compiles src/*.ts. The
// extension layer (extensions/ithacus-live-card.ts, ithacus-dispatch.ts,
// ithacus-commands.ts) delegates all parsing/width math to these pure
// functions; the TUI overlay wiring itself stays in extensions/.
//
// Semantics:
//   - card_size  ith_kv key: "small"|"medium"|"large" → 50 / 76 /
//     min(118, termWidth-4). When UNSET, behavior is UNCHANGED (legacy
//     auto/fixed via the card's widthMode). "size next" cycles
//     small → medium → large → small.
//   - card_hidden ith_kv key: "true"|"false" → resumed sessions start hidden.

export type LiveCardSize = "small" | "medium" | "large";

/** The three named sizes, in cycle order (small → medium → large). */
export const LIVE_CARD_SIZES: readonly LiveCardSize[] = ["small", "medium", "large"];

export const SMALL_WIDTH = 50;
export const MEDIUM_WIDTH = 76;
export const LARGE_MAX_WIDTH = 118;
/** Margin deducted from the terminal width for the "large" size (termWidth-4). */
export const LARGE_WIDTH_MARGIN = 4;

/** termWidth sentinel used by the overlay's component.width getter when the
 *  true terminal width isn't known at getter time — pi clamps to the real
 *  terminal at layout/render time (mirrors the legacy AUTO_MAX = 120 sentinel
 *  the card already used for "auto"). */
export const PREFERRED_TERM_WIDTH = 120;

/** Map a named card size to a preferred width given the terminal width.
 *  small=50, medium=76, large=min(118, termWidth-4). Pure + total. */
export function cardSizeToWidth(size: LiveCardSize, termWidth: number): number {
  switch (size) {
    case "small":
      return SMALL_WIDTH;
    case "medium":
      return MEDIUM_WIDTH;
    case "large":
      return Math.min(LARGE_MAX_WIDTH, Math.max(0, termWidth - LARGE_WIDTH_MARGIN));
  }
}

/** Parse the raw ith_kv card_size string; "" / null / unknown → null (unset
 *  → legacy auto/fixed behavior). Strict: never invents a size. */
export function parseCardSize(value: string | null | undefined): LiveCardSize | null {
  return value === "small" || value === "medium" || value === "large" ? value : null;
}

/** "size next" cycle from the CURRENT size: small → medium → large → small.
 *  When the current size is unset (legacy), the next cycle starts from
 *  "small" (so a user hitting `size next` out of the blue gets small). */
export function cycleCardSize(size: LiveCardSize | null | undefined): LiveCardSize {
  const from = parseCardSize(size) ?? "small";
  return LIVE_CARD_SIZES[(LIVE_CARD_SIZES.indexOf(from) + 1) % LIVE_CARD_SIZES.length];
}

/** Parse the raw ith_kv card_hidden string: only the literal "true" hides;
 *  anything else (including unset, "", "false") is visible. */
export function parseCardHidden(value: string | null | undefined): boolean {
  return value === "true";
}
