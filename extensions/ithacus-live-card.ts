/**
 * ithacus-live-card.ts — the persistent live-progress overlay Component
 * (Sprint 5.13, docs/DESIGN_LIVE_PROGRESS.md §3.2 + §4).
 *
 * Shown at dispatch START (before `await spawnAgent`, fire-and-forget),
 * reads the module-level store in ithacus-live.ts, re-renders on each
 * onLiveChanged() callback, and on completion flips to the terminal state
 * (✓ success / ✗ failed) and auto-dismisses after 3s.
 *
 * Structural pi Component + Focusable (render/handleInput/invalidate/dispose
 * + readonly width + focused) — no pi-tui type import (PREVENT-ITH-004).
 * All constructor fields are declared explicitly (no parameter properties —
 * the Node strip-only test path rejects them; v0.3.11 lesson). Valid theme
 * colors ONLY: accent/success/error/muted/dim (v0.3.13 lesson) — and the
 * whole render is wrapped so a bad frame degrades to plain text instead of
 * crashing pi (v0.3.12 lesson).
 */

import { getLive, onLiveChanged, removeLive } from "./ithacus-live.js";

// ---------------------------------------------------------------------------
// helpers (zero-dep — visibleWidth/truncateToWidth stay local; pi-tui's would
// add a runtime dep — PREVENT-ITH-004, DESIGN_LIVE_PROGRESS.md §4)
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
// IthLiveCard — the persistent overlay (DESIGN_LIVE_PROGRESS.md §3.2 skeleton,
// §4 layout: width 52, em-dash title, padEnd(7) label column, dim borders)
// ---------------------------------------------------------------------------

export class IthLiveCard {
  readonly width = 52;
  focused = false;

  private t: ThemeLike;
  private dispatchId: string;
  private requestRender: () => void;
  private done: (v: null) => void;
  private unsub: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private handle: { hide(): void } | null = null;
  private dismissed = false;
  /** Tick timer for the "duration (ticking)" acceptance criterion: between
   *  child events the store is quiet, so the card re-reads startedAt on an
   *  unref'd interval. Cleared on markDone + dispose (never leaks, never
   *  holds the process). */
  private tickTimer: ReturnType<typeof setInterval> | null = null;

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

  setHandle(handle: { hide(): void }): void {
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

  render(_width: number): string[] {
    // DEFENSIVE: render() is called from pi's TUI render timer. An uncaught
    // throw crashes the whole process (v0.3.12 lesson: "Unknown theme color:
    // green"). Wrap EVERYTHING so a bad frame ALWAYS degrades to plain text.
    try {
      const snap = getLive(this.dispatchId);
      if (!snap) return ["ithacus — dispatch"]; // store purged — plain fallback
      const t = this.t;
      const fg = (color: string, text: string): string => tryFg(t, color, text);

      const w = this.width;
      const innerW = w - 2; // minus the two border chars
      const border = (s: string): string => fg("dim", s);
      const pad = (s: string, len: number): string =>
        s + " ".repeat(Math.max(0, len - visibleWidth(s)));
      const row = (content: string): string =>
        border("│") + pad(" " + content, innerW) + border("│");
      const emptyRow = (): string => border("│") + " ".repeat(innerW) + border("│");
      const label = (s: string): string => s.padEnd(7);

      // Duration: ticks while running (derived from startedAt), frozen at
      // the terminal value endLive() computed.
      const durMs = snap.status === "running" ? Date.now() - snap.startedAt : snap.durationMs;
      const secs = Math.max(0, durMs) / 1000;
      const tpsValue = secs > 0 ? Math.round(snap.tokensOut / secs) : 0;
      const meta = ` · ${fmtDuration(durMs)} · ${tpsValue} tps`;

      // status row (spec §4): running accent / success green / failed red
      let statusLine: string;
      if (snap.status === "success") {
        statusLine = fg("success", "✓ success") + fg("muted", meta);
      } else if (snap.status === "failed") {
        const err = snap.error ? ` (${truncateToWidth(snap.error, 18)})` : "";
        statusLine = fg("error", `✗ failed${err}`) + fg("muted", ` · ${fmtDuration(durMs)}`);
      } else {
        statusLine = fg("accent", "⟳ running") + fg("muted", meta);
      }

      const tokensLine = fg("muted", `${snap.tokensIn} in · ${snap.tokensOut} out`);
      const toolLine = fg(
        "muted",
        snap.currentTool
          ? `${snap.currentTool}${snap.currentToolArgs ? ` (${truncateToWidth(snap.currentToolArgs, innerW - 18)})` : ""}`
          : "idle",
      );
      const callsLine = fg("muted", `${snap.toolCallCount} tools · ${snap.filesAccessed.length} files`);
      const filesLine = fg("muted", truncateToWidth(snap.filesAccessed.join(", "), innerW - 10));
      const taskLine = fg("muted", truncateToWidth(snap.taskPreview ?? "", innerW - 10));

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
        row(label("status") + " " + statusLine),
        row(label("tokens") + " " + tokensLine),
        row(label("tool") + " " + toolLine),
        row(label("calls") + " " + callsLine),
        row(label("files") + " " + filesLine),
        row(label("task") + " " + taskLine),
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
