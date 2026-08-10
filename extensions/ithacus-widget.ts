/**
 * ithacus-widget.ts — the persistent above-editor status widget ("menu bar").
 *
 * Why: an end user who runs `pi install npm:ithacus` and restarts pi must be
 * ABLE TO SEE they are on the new version without opening any menu. The
 * overlay (/ithacus-menu) only shows on demand; this widget is always on
 * screen. Pattern mirrored from pi-mega-compact's MegaRuntime.renderWidget()
 * (ctx.ui.setWidget(key, factory, { placement: "aboveEditor" })).
 *
 * The factory's render() re-reads live counters off the ithacus runtime every
 * frame — register ONCE at session_start and it stays fresh (no per-event
 * re-registration).
 *
 * PREVENT-ITH-004: zero network; version comes from the local package.json
 * (ithacus-version.js ownVersion()).
 *
 * Implements pi's Component contract structurally (render/invalidate) — no
 * pi-tui import, keeping ithacus zero-deps at runtime. Rendering is plain
 * text (no theme colors): safe across every ThemeColor implementation.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { IthRuntime } from "./ithacus-runtime.js";
import { ownVersion } from "./ithacus-version.js";

/** Register key — changing it after a publish orphans the old widget. */
export const WIDGET_KEY = "ithacus";

/** Small inline pressure bar (same glyph set as IthMenu's gauge). */
function gauge(pressure: number, width = 12): string {
  const p = Math.max(0, Math.min(1, pressure));
  const filled = Math.round(p * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Width-safe truncation (no ANSI escapes in the source string). */
function trunc(s: string, width: number): string {
  return s.length > width ? s.slice(0, Math.max(0, width - 1)) + "…" : s;
}

/** Build the one widget line at the given render width. */
export function buildWidgetLine(runtime: IthRuntime, width: number): string {
  const w = Math.max(10, width > 0 ? width : 120);
  const p = runtime.pressure;
  const crew = `crew ${runtime.activeAgents} · turn ${runtime.currentTurn}`;
  const running = runtime.runningSummary();
  const runningSeg = running ? `  |  ${running}` : "";
  const ctxTok = `ctx ${fmtTokens(runtime.lastCtxTokens)}/${fmtTokens(runtime.lastCtxWindow)}`;
  return trunc(
    `ithacus v${ownVersion()}  |  ${gauge(p)} ${(p * 100).toFixed(0)}%  |  ${crew}${runningSeg}  |  ${ctxTok}`,
    w,
  );
}

/**
 * Register the above-editor widget. Registering once is enough: the factory's
 * render() re-reads runtime state every repaint. Best-effort — a TUI that
 * lacks setWidget support merely shows no bar; the extension keeps working.
 */
export function registerVersionWidget(pi: ExtensionAPI, runtime: IthRuntime): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    try {
      ctx.ui.setWidget(
        WIDGET_KEY,
        (_tui, _theme) => ({
          render: (width: number) => [buildWidgetLine(runtime, width)],
          invalidate: () => {},
        }),
        { placement: "aboveEditor" },
      );
    } catch {
      /* widget registration is best-effort — never block extension load */
    }
  });
}
