// ---- live-card toggles (Sprint 5.27 module 31) ---------------------------
// Tests src/live-card-toggles.ts — the pure, pi-agnostic width-size + hide/
// resume logic for the live-progress card. All assertions are against the
// PURE functions (no pi, no extensions), exactly like modules 26/27/28/29.
//
// NOTE: mirrors module 30's structure — checks run at module top-level (so
// they execute at `import * as s31` in smoke-src.mjs and appear in the gate
// log), with NO `run` export. Module 30 (30-remote-capabilities.mjs) is the
// in-flight 5.24 template the runner calls as `await s30.run(ctx)` and it has
// no `run`; keeping module 31 structurally identical means it is registered
// the same way without a phantom export.
import { failures, check, liveCardToggles } from "./_harness.mjs";

const {
  LIVE_CARD_SIZES,
  SMALL_WIDTH,
  MEDIUM_WIDTH,
  LARGE_MAX_WIDTH,
  PREFERRED_TERM_WIDTH,
  cardSizeToWidth,
  parseCardSize,
  cycleCardSize,
  parseCardHidden,
} = liveCardToggles;

// ---- size vocabulary ----------------------------------------------------
check("s31 sizes small-med-large", JSON.stringify([...LIVE_CARD_SIZES]) === JSON.stringify(["small", "medium", "large"]));
check("s31 small=50 med=76", SMALL_WIDTH === 50 && MEDIUM_WIDTH === 76);
check("s31 large max=118", LARGE_MAX_WIDTH === 118);
check("s31 preferred sentinel=120", PREFERRED_TERM_WIDTH === 120);

// ---- cardSizeToWidth ----------------------------------------------------
check("s31 small width 50", cardSizeToWidth("small", 80) === 50);
check("s31 small width independent of term", cardSizeToWidth("small", 20) === 50);
check("s31 medium width 76", cardSizeToWidth("medium", 200) === 76);
check("s31 large on 120 -> 116", cardSizeToWidth("large", PREFERRED_TERM_WIDTH) === 116);
// large = min(118, term-4)
check("s31 large on 200 -> 118 cap", cardSizeToWidth("large", 200) === 118);
check("s31 large on 100 -> 96", cardSizeToWidth("large", 100) === 96);
check("s31 large never negative", cardSizeToWidth("large", 0) === 0);
// strict total: every size yields exactly the spec width for a 120 sentinel
check("s31 all sizes < sentinel", LIVE_CARD_SIZES.every((s) => cardSizeToWidth(s, PREFERRED_TERM_WIDTH) < PREFERRED_TERM_WIDTH));

// ---- parseCardSize ------------------------------------------------------
check("s31 parse small", parseCardSize("small") === "small");
check("s31 parse medium", parseCardSize("medium") === "medium");
check("s31 parse large", parseCardSize("large") === "large");
check("s31 parse '' is null (legacy)", parseCardSize("") === null);
check("s31 parse undefined is null", parseCardSize(undefined) === null);
check("s31 parse null is null", parseCardSize(null) === null);
check("s31 parse junk rejected", parseCardSize("huge") === null);

// ---- cycleCardSize (size next: small -> medium -> large -> small) --------
check("s31 cycle from small -> medium", cycleCardSize("small") === "medium");
check("s31 cycle from medium -> large", cycleCardSize("medium") === "large");
check("s31 cycle from large -> small", cycleCardSize("large") === "small");
// When unset (legacy auto/fixed) the cycle enters at "small" — so the NEXT
// size shipped by "size next" is medium (unset → treated as small → medium).
check("s31 cycle from unset -> medium", cycleCardSize(null) === "medium");
check("s31 cycle from '' -> medium", cycleCardSize("") === "medium");
check("s31 cycle from junk -> medium", cycleCardSize("huge") === "medium");
// the cycle is closed under itself: 3 steps returns to start
check("s31 cycle closed", cycleCardSize(cycleCardSize(cycleCardSize("small"))) === "small");

// ---- parseCardHidden ----------------------------------------------------
check("s31 hidden true lit", parseCardHidden("true") === true);
check("s31 hidden 'false' visible", parseCardHidden("false") === false);
check("s31 hidden '' visible", parseCardHidden("") === false);
check("s31 hidden undefined visible", parseCardHidden(undefined) === false);
check("s31 hidden null visible", parseCardHidden(null) === false);
check("s31 hidden junk visible", parseCardHidden("TRUE") === false);
