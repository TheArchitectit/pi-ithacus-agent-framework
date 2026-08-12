/**
 * ithacus-live-card.ts — the persistent live-progress overlay Component
 * (Sprint 5.13, docs/DESIGN_LIVE_PROGRESS.md §3.2 + §4; enterprise layout in
 * Sprint 5.13.1).
 *
 * Shown at dispatch START (before `await spawnAgent`, fire-and-forget),
 * reads the module-level store in ithacus-live.ts, re-renders on each
 * onLiveChanged() callback, and on completion flips to the terminal state
 * (✓ success / ✗ failed) and auto-dismisses after 3s.
 *
 * Sprint 5.13.1 (enterprise layout): the 8-row squashed layout became
 * multi-row WRAPPED sections — `▌ task` (word-wrapped, NO 40-char
 * truncation), `▌ workflow` (the agent-to-agent chain from listLive(), the
 * current dispatch highlighted), `▌ activity` (recentTools ring, one row
 * per entry; the separate files/calls rows folded away). Width is a
 * TOGGLABLE model ("auto" = clamp terminal width to 60..120 / "fixed" 88):
 * `width` is now a GETTER returning getLiveCardPreferredWidth() so pi's
 * `component.width` read (interactive-mode.js) picks up mode changes for
 * new cards; persisted via the ith_kv key "live_card_width_mode" (loaded at
 * registration by dispatch's loadLiveCardWidthMode call, toggled from
 * /ithacus-live width).
 *
 * Structural pi Component + Focusable (render/handleInput/invalidate/dispose
 * + width getter + focused) — no pi-tui type import (PREVENT-ITH-004).
 * All constructor fields are declared explicitly (no parameter properties —
 * the Node strip-only test path rejects them; v0.3.11 lesson). Valid theme
 * colors ONLY: accent/success/error/muted/dim + warning (Sprint 5.14's
 * blocked-phase accent — pi's theme exports a `warning` color, verified in
 * dist/modes/interactive/theme/theme.js), and even then every theme call
 * goes through tryFg so an invalid color can only drop styling, never
 * crash pi (v0.3.12/13 lessons).
 *
 * Sprint 5.14 (docs/DESIGN_WORKER_STATUS.md §2.3): the status row renders
 * per-WorkerStatus icon/color — the STATUS_ROW table below IS the spec's
 * table (◌/🔒/🔑/›/▸/✓/✗); failures append the classified
 * WorkerFailureKind when it's informative (≠ "unknown").
 */

import { getLive, listLive, onLiveChanged, removeLive } from "./ithacus-live.js";
import type { AgentLive } from "./ithacus-live.js";
import type { WorkerStatus } from "../src/events.js";
import { isTerminalStatus } from "../src/worker-status.js";
// Sprint 5.27 §3.2/§3.3: pure width-size + hide/resume toggle logic lives in
// src/live-card-toggles.ts (pi-agnostic, unit-tested by smoke-src/31). This
// card module holds ONLY the live mutable state; all parsing/width math
// delegates to the pure functions. PREFERRED_TERM_WIDTH is the sentinel pi's
// component.width getter uses when the true terminal width is unknown — pi
// clamps to the real terminal at layout/render time (like legacy AUTO_MAX).
import {
  cardSizeToWidth,
  parseCardSize,
  cycleCardSize as cycleCardSizeNext,
  parseCardHidden,
  PREFERRED_TERM_WIDTH,
} from "../src/live-card-toggles.js";
import type { LiveCardSize } from "../src/live-card-toggles.js";

// ---------------------------------------------------------------------------
// helpers (zero-dep — visibleWidth/truncateToWidth/wrapText stay local;
// pi-tui's would add a runtime dep — PREVENT-ITH-004, DESIGN_LIVE_PROGRESS.md §4)
// ---------------------------------------------------------------------------

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold?: (text: string) => string;
}
const NO_THEME: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };

/** Strip ANSI escape codes for display-width calculation. Zero-dep. */
function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Truncate a string to a max VISIBLE width (ANSI-aware). Zero-dep. */
function truncateToWidth(s: string, maxW: number): string {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  if (stripped.length <= maxW) return s;
  return stripped.slice(0, Math.max(0, maxW - 1)) + "…";
}

/** Word-wrap `text` into lines of at most `maxW` visible chars (Sprint
 *  5.13.1 — the `▌ task` section wraps instead of the old 40-char slice).
 *  ANSI-aware via the same strip pattern as visibleWidth; zero-dep. Words
 *  longer than maxW are hard-split so a long URL/token can never blow the
 *  box out. */
function wrapText(text: string, maxW: number): string[] {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const words = stripped.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || maxW <= 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (cur.length > 0 && cur.length + 1 + word.length <= maxW) {
      cur += " " + word;
      continue;
    }
    if (cur.length > 0) lines.push(cur);
    // Start a fresh line with `word`, hard-splitting when it alone exceeds
    // maxW (unbroken URLs/tokens).
    let rest = word;
    while (rest.length > maxW) {
      lines.push(rest.slice(0, maxW));
      rest = rest.slice(maxW);
    }
    cur = rest;
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/** Compact human duration ("22m15s" | "12.4s" | "847ms"). Local copy: this
 *  card must not import back from dispatch (dispatch imports this card). */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

/** One theme call that can never throw — valid-color violations and TUI
 *  errors degrade to plain text (the v0.3.12/13 lessons). */
function tryFg(t: ThemeLike, color: string, text: string): string {
  try {
    return t.fg(color, text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Sprint 5.13.1 — width model (auto ↔ fixed toggle, persisted in ith_kv)
// ---------------------------------------------------------------------------

export type LiveCardWidthMode = "auto" | "fixed";

/** fixed mode: always render at 88 cols (narrower terminals clip to
 *  terminal width — render() takes the min with what pi hands us). */
const FIXED_WIDTH = 88;
/** auto mode: follow the terminal width, clamped into [AUTO_MIN, AUTO_MAX].
 *  AUTO_MAX is also the PREFERRED width pi reads via component.width. */
const AUTO_MAX = 120;
const AUTO_MIN = 60;
/** ith_kv key the mode persists under (dispatch loads it at registration). */
const LIVE_CARD_WIDTH_KV_KEY = "live_card_width_mode";

let widthMode: LiveCardWidthMode = "auto";

/** Sprint 5.27 §3.2 — named card sizes (small|medium|large → 50/76/min(118,
 *  termWidth-4)) SUPERSEDE the legacy auto/fixed width mode when set. When
 *  cardSize is null the card behaves exactly as before (legacy auto/fixed).
 *  Persisted in ith_kv under the key "card_size"; loaded at registration by
 *  dispatch's loadLiveCardSize, toggled from /ithacus-live size. */
let cardSize: LiveCardSize | null = null;

/** The currently configured size, or null when unset (legacy auto/fixed). */
export function getLiveCardCurrentSize(): LiveCardSize | null {
  return cardSize;
}

/** Set the card size for NEW cards (the overlay's width getter recomputes on
 *  each new card). Invalid values are ignored (size stays unchanged). */
export function setLiveCardSize(size: LiveCardSize): void {
  const parsed = parseCardSize(size);
  if (parsed) cardSize = parsed;
}

/** "size next": small → medium → large → small. When unset (legacy) the
 *  cycle starts from small. Returns the NEW size (callers persist it). */
export function cycleLiveCardSize(): LiveCardSize {
  cardSize = cycleCardSizeNext(cardSize);
  return cardSize;
}

/** Load the persisted size pref from ith_kv (called once at extension
 *  registration by registerDispatchTool). Best-effort: unreadable/unknown
 *  values keep cardSize unset (legacy auto/fixed). */
export function loadLiveCardSize(getKv: (key: string) => string | null): void {
  try {
    cardSize = parseCardSize(getKv("card_size"));
  } catch {
    /* kv unavailable (no runtime store) — keep the default */
  }
}

/** Sprint 5.27 §3.3 — "start hidden on resume": true when card_hidden=true
 *  is persisted. The dispatch onHandle applies setHidden(true) right after
 *  it fires so a resumed session starts hidden. Loaded at registration. */
let cardHidden = false;

export function getLiveCardHidden(): boolean {
  return cardHidden;
}

export function loadLiveCardHidden(getKv: (key: string) => string | null): void {
  try {
    cardHidden = parseCardHidden(getKv("card_hidden"));
  } catch {
    /* kv unavailable — default visible */
  }
}

export function getLiveCardWidthMode(): LiveCardWidthMode {
  return widthMode;
}

export function setLiveCardWidthMode(mode: LiveCardWidthMode): void {
  if (mode === "auto" || mode === "fixed") widthMode = mode;
}

/** Flip auto ↔ fixed; returns the NEW mode (callers persist it). */
export function toggleLiveCardWidthMode(): LiveCardWidthMode {
  widthMode = widthMode === "auto" ? "fixed" : "auto";
  return widthMode;
}

/** The width pi reads via `component.width` for overlay layout: AUTO_MAX in
 *  auto mode (render still clamps to the actual terminal width), FIXED_WIDTH
 *  in fixed mode. */
export function getLiveCardPreferredWidth(): number {
  // Sprint 5.27 §3.2: a named size wins over the legacy auto/fixed mode. The
  // large size needs a terminal width — use the PREFERRED sentinel (pi clamps
  // to the real terminal at layout time).
  if (cardSize) return cardSizeToWidth(cardSize, PREFERRED_TERM_WIDTH);
  return widthMode === "auto" ? AUTO_MAX : FIXED_WIDTH;
}

/** Load the persisted width pref from ith_kv (called once at extension
 *  registration by registerDispatchTool). Best-effort: unreadable/unknown
 *  values keep the "auto" default. */
export function loadLiveCardWidthMode(getKv: (key: string) => string | null): void {
  try {
    const v = getKv(LIVE_CARD_WIDTH_KV_KEY);
    if (v === "auto" || v === "fixed") widthMode = v;
  } catch {
    /* kv unavailable (no runtime store) — keep the default */
  }
}

// ---------------------------------------------------------------------------
// IthLiveCard — the persistent overlay (DESIGN_LIVE_PROGRESS.md §3.2 skeleton;
// Sprint 5.13.1 layout: dynamic width, em-dash title, padEnd(7) label column,
// wrapped ▌ task / ▌ workflow / ▌ activity sections, dim borders)
// ---------------------------------------------------------------------------

/** Sprint 5.14 (DESIGN_WORKER_STATUS.md §2.3's icon/color table, verbatim). */
const STATUS_ROW: Readonly<Record<WorkerStatus, { icon: string; label: string; color: string }>> = {
  spawning: { icon: "◌", label: "spawning", color: "muted" },
  trust_required: { icon: "🔒", label: "awaiting trust", color: "warning" },
  tool_permission: { icon: "🔑", label: "awaiting permission", color: "warning" },
  ready_for_prompt: { icon: "›", label: "ready", color: "muted" },
  working: { icon: "▸", label: "working", color: "accent" },
  // Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §6.5): retrying is an
  // ACTIVE phase — ↻ with the attempt counter (attempt/maxRetries) appended.
  retrying: { icon: "↻", label: "retrying", color: "warning" },
  // Sprint 5.28 (LIVE_DISPATCH_CONTROL §7.4): control-lifecycle statuses —
  // paused (⏸, resumable) / stopping (■) / swapped (⇄) / splitting (✂) are
  // transient UI states; stopped (■) and cancelled (✕) are terminal controls.
  paused: { icon: "⏸", label: "paused", color: "warning" },
  stopping: { icon: "■", label: "stopping", color: "warning" },
  swapped: { icon: "⇄", label: "swapped", color: "accent" },
  splitting: { icon: "✂", label: "splitting", color: "accent" },
  stopped: { icon: "■", label: "stopped", color: "warning" },
  cancelled: { icon: "✕", label: "cancelled", color: "muted" },
  done: { icon: "✓", label: "done", color: "success" },
  failed: { icon: "✗", label: "failed", color: "error" },
};

export class IthLiveCard {
  focused = false;

  private t: ThemeLike;
  private dispatchId: string;
  private requestRender: () => void;
  private done: (v: null) => void;
  private unsub: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private handle: { hide(): void; setHidden?(hidden: boolean): void } | null = null;
  private dismissed = false;
  /** Tick timer for the "duration (ticking)" acceptance criterion: between
   *  child events the store is quiet, so the card re-reads startedAt on an
   *  unref'd interval. Cleared on markDone + dispose (never leaks, never
   *  holds the process). */
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  /** Sprint 5.13.1: width is dynamic — pi reads `component.width` for
   *  overlay layout (interactive-mode.js), so a getter lets the auto/fixed
   *  toggle take effect on the NEXT card without a reload. */
  get width(): number {
    return getLiveCardPreferredWidth();
  }

  /**
   * @param theme pi's theme (cast to ThemeLike; NO_THEME fallback)
   * @param dispatchId the execute() dispatch key (store lookup)
   * @param done resolves the ctx.ui.custom promise (removes the overlay)
   * @param requestRender pi TUI repaint callback (fire-and-forget, guarded)
   */
  constructor(theme: unknown, dispatchId: string, done: (v: null) => void, requestRender: () => void) {
    this.t = (theme as ThemeLike) ?? NO_THEME;
    this.dispatchId = dispatchId;
    this.done = done;
    this.requestRender = requestRender;
    // Subscribe to store changes — re-render on every update.
    this.unsub = onLiveChanged(() => this.safeRender());
    // Tick: keeps the duration/TPS rows live between child events.
    try {
      const tick = setInterval(() => this.safeRender(), 500);
      (tick as { unref?: () => void }).unref?.();
      this.tickTimer = tick;
    } catch {
      /* timers unavailable — events still drive the render */
    }
  }

  setHandle(handle: { hide(): void; setHidden?(hidden: boolean): void }): void {
    this.handle = handle;
  }

  private safeRender(): void {
    try {
      this.requestRender();
    } catch {
      /* TUI not ready — next tick */
    }
  }

  invalidate(): void {
    /* render reads the store fresh each frame — no cached state */
  }

  dispose(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Called by execute()'s finally — flip to terminal state, hold for 3s,
   *  then auto-dismiss. Owns the auto-hide timer (5.12's risk note #5:
   *  done(null) resolves the custom() promise, which removes the overlay
   *  even when onHandle never fired). */
  markDone(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    // Will render success/failed based on store status.
    this.safeRender();
    try {
      const t = setTimeout(() => this.dismiss(), 3000);
      (t as { unref?: () => void }).unref?.();
      this.autoHideTimer = t;
    } catch {
      /* timer unavailable — dismiss stays user-driven */
    }
  }

  private dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    // Store cleanup (DESIGN_LIVE_PROGRESS.md §6 — removeLive on dismiss).
    try {
      removeLive(this.dispatchId);
    } catch {
      /* store gone — fine */
    }
    try {
      this.handle?.hide();
    } catch {
      /* already hidden */
    }
    try {
      this.done(null);
    } catch {
      /* already dismissed */
    }
  }

  handleInput(_data: string): void {
    // nonCapturing overlays don't receive input — best-effort dismiss only.
    this.dismiss();
  }

  render(width: number): string[] {
    // DEFENSIVE: render() is called from pi's TUI render timer. An uncaught
    // throw crashes the whole process (v0.3.12 lesson: "Unknown theme color:
    // green"). Wrap EVERYTHING so a bad frame ALWAYS degrades to plain text.
    try {
      const snap = getLive(this.dispatchId);
      if (!snap) return ["ithacus — dispatch"]; // store purged — plain fallback
      const t = this.t;
      const fg = (color: string, text: string): string => tryFg(t, color, text);

      // Sprint 5.13.1 width model: auto follows the terminal width clamped
      // to [AUTO_MIN, AUTO_MAX]; fixed pins to FIXED_WIDTH (both take the
      // min with what pi actually handed us so narrow terminals never overflow).
      // Sprint 5.27 §3.2: a named size pins the render width (small/medium
      // exact; large capped to terminal-4, clamped to what pi handed us so
      // narrow terminals never overflow). Otherwise legacy auto/fixed.
      const w = cardSize
        ? Math.min(cardSizeToWidth(cardSize, width), width)
        : widthMode === "auto"
          ? Math.max(AUTO_MIN, Math.min(AUTO_MAX, width))
          : Math.min(FIXED_WIDTH, width);
      const innerW = w - 2; // minus the two border chars
      const border = (s: string): string => fg("dim", s);
      const pad = (s: string, len: number): string =>
        s + " ".repeat(Math.max(0, len - visibleWidth(s)));
      const row = (content: string): string =>
        border("│") + pad(" " + content, innerW) + border("│");
      const emptyRow = (): string => border("│") + " ".repeat(innerW) + border("│");
      const label = (s: string): string => s.padEnd(7);

      // Duration: ticks on every non-terminal WorkerStatus (spawning,
      // blocked, working — derived from startedAt), frozen at the terminal
      // value endLive() computed once the run is done/failed (5.14).
      const durMs = isTerminalStatus(snap.status) ? snap.durationMs : Date.now() - snap.startedAt;
      const secs = Math.max(0, durMs) / 1000;
      const tpsValue = secs > 0 ? Math.round(snap.tokensOut / secs) : 0;
      const meta = ` · ${fmtDuration(durMs)} · ${tpsValue} tps`;

      // Status row (DESIGN_WORKER_STATUS.md §2.3): one icon/color per
      // WorkerStatus. Failures carry the classified WorkerFailureKind when
      // informative ("unknown" adds nothing) + the truncated error string.
      const st = STATUS_ROW[snap.status] ?? STATUS_ROW.spawning;
      let statusText = `${st.icon} ${st.label}`;
      // Sprint 5.17 (§6.5): on a retrying snapshot append the attempt counter
      // `(attempt n/N)` when both counters are known.
      if (snap.status === "retrying" && snap.attempt && snap.retryMax) {
        statusText += ` (attempt ${snap.attempt}/${snap.retryMax})`;
      }
      if (snap.status === "failed") {
        if (snap.failureKind && snap.failureKind !== "unknown") statusText += ` · ${snap.failureKind}`;
        if (snap.error) statusText += ` (${truncateToWidth(snap.error, 18)})`;
      }
      const statusLine =
        snap.status === "failed"
          ? fg("error", statusText) + fg("muted", ` · ${fmtDuration(durMs)}`)
          : fg(st.color, statusText) + fg("muted", meta);

      // Tokens row carries the files count (5.13.1: the separate calls/files
      // rows folded into ▌ activity — the count is the compact remnant).
      const filesCount = snap.filesAccessed.length;
      const tokensLine = fg(
        "muted",
        `${snap.tokensIn} in · ${snap.tokensOut} out` + (filesCount > 0 ? ` · ${filesCount} files` : ""),
      );
      const toolLine = fg(
        "muted",
        snap.currentTool
          ? `${snap.currentTool}${snap.currentToolArgs ? ` (${truncateToWidth(snap.currentToolArgs, innerW - 18)})` : ""}`
          : "idle",
      );

      const lines: string[] = [];
      lines.push(row(label("status") + " " + statusLine));
      lines.push(row(label("tokens") + " " + tokensLine));
      lines.push(row(label("tool") + " " + toolLine));

      // ▌ task — word-wrapped over the full width, NO truncation (5.13.1).
      if (snap.taskPreview) {
        lines.push(row(fg("accent", "▌ task")));
        for (const ln of wrapText(snap.taskPreview, innerW - 2)) {
          lines.push(row(fg("muted", "  " + ln)));
        }
      }

      // ▌ workflow — the agent-to-agent chain (listLive: every live
      // dispatch, execution order). Up to 6 most-recent entries; the CURRENT
      // dispatch is highlighted in its status color, the rest dimmed.
      const chain = listLive();
      if (chain.length > 0) {
        lines.push(row(fg("accent", "▌ workflow")));
        const shown: AgentLive[] = chain.length <= 6 ? chain : chain.slice(-6);
        for (const entry of shown) {
          const est = STATUS_ROW[entry.status] ?? STATUS_ROW.spawning;
          const eDur = isTerminalStatus(entry.status) ? entry.durationMs : Math.max(0, Date.now() - entry.startedAt);
          const line = truncateToWidth(
            `${entry.agent.padEnd(12)}${est.icon} ${est.label.padEnd(8)}${fmtDuration(eDur)}`,
            innerW - 3,
          );
          // Identity match: snap IS the map object for this.dispatchId.
          lines.push(row(entry === snap ? fg(est.color, "  " + line) : fg("dim", "  " + line)));
        }
      }

      // ▌ activity — the recentTools ring, one row per entry (the old
      // files/calls rows fold in: each row already shows its file via args).
      if (snap.recentTools.length > 0) {
        lines.push(row(fg("accent", "▌ activity")));
        for (const tool of snap.recentTools) {
          const body = tool.tool.padEnd(6) + " " + truncateToWidth(tool.args, innerW - 10);
          lines.push(row(fg("muted", "  " + body)));
        }
      }

      // Top border with em-dash title: `ithacus — <agent>[ · <model>]`.
      const modelSuffix = snap.model ? ` · ${snap.model}` : "";
      const titleText = ` ithacus — ${snap.agent}${modelSuffix} `;
      const borderLen = innerW - visibleWidth(titleText);
      const leftBorder = Math.floor(borderLen / 2);
      const rightBorder = Math.max(0, borderLen - leftBorder);

      // Bottom hint per spec §4.
      const hintText = " auto-dismiss when done ";
      const hintBorderLen = innerW - visibleWidth(hintText);
      const hintLeft = Math.floor(hintBorderLen / 2);
      const hintRight = Math.max(0, hintBorderLen - hintLeft);

      return [
        border("╭" + "─".repeat(Math.max(0, leftBorder))) +
          fg("accent", titleText) +
          border("─".repeat(rightBorder) + "╮"),
        emptyRow(),
        ...lines,
        emptyRow(),
        border("╰" + "─".repeat(hintLeft)) + fg("dim", hintText) + border("─".repeat(hintRight) + "╯"),
      ];
    } catch {
      // Last-resort plain text — never crash the host TUI. (The spec snippet's
      // catch referenced `live` out of scope; the fallback is static text.)
      return ["ithacus — dispatch"];
    }
  }
}
