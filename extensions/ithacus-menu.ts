/**
 * ithacus-menu.ts — the `/ithacus-menu` overlay: a small read-only TUI panel
 * showing live extension state (version, crew, context, pressure, agent
 * roster with model@provider bindings, dashboard snapshot paths).
 *
 * Why an overlay and not a string-returning command: ithacus-commands.ts's
 * registerCmd wrapper DISCARDS command string returns (TODO there), so a
 * slash command can currently surface nothing persistent. A pi overlay
 * component (ctx.ui.custom) IS persisted on screen until dismissed — the
 * correct vehicle for a status/menu surface.
 *
 * PREVENT-ITH-004: local fs reads only (package.json for version, dashboard
 * snapshot paths). Zero network.
 *
 * Implements pi's Component interface STRUCTURALLY (render/handleInput/
 * invalidate) — pi's TUI calls those duck-typed, so importing pi-tui's type
 * is not required and keeps ithacus zero-deps at runtime.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ownVersion } from "./ithacus-version.js";
import { discoverIthacusAgents, type AgentConfig } from "./ithacus-agents.js";
import type { IthRuntime } from "./ithacus-runtime.js";
import { providerSnapshot } from "./ithacus-providers.js";

// ---------------------------------------------------------------------------
// data

interface MenuSnapshot {
  version: string;
  pressure: number;
  activeAgents: number;
  currentTurn: number;
  ctxTokens: number | null;
  ctxPercent: number | null;
  ctxWindow: number;
  agents: AgentConfig[];
  providers: ReturnType<typeof providerSnapshot>;
  stateDir: string;
  dashboardPath: string;
  dashboardMtime: string | null;
  eventsPath: string;
  eventsSize: number | null;
}

function collectSnapshot(runtime: IthRuntime): MenuSnapshot {
  const dashboardPath = join(runtime.currentStateDir, "dashboard.json");
  const eventsPath = join(runtime.currentStateDir, "events.log");
  let dashboardMtime: string | null = null;
  let eventsSize: number | null = null;
  try { dashboardMtime = statSync(dashboardPath).mtime.toISOString().slice(0, 19); } catch { /* absent */ }
  try { eventsSize = statSync(eventsPath).size; } catch { /* absent */ }
  return {
    version: ownVersion(),
    pressure: runtime.pressure,
    activeAgents: runtime.activeAgents,
    currentTurn: runtime.currentTurn,
    ctxTokens: runtime.lastCtxTokens,
    ctxPercent: runtime.lastCtxPercent,
    ctxWindow: runtime.lastCtxWindow,
    agents: discoverIthacusAgents(),
    providers: providerSnapshot(),
    stateDir: runtime.currentStateDir,
    dashboardPath,
    dashboardMtime,
    eventsPath,
    eventsSize,
  };
}

// ---------------------------------------------------------------------------
// rendering helpers

function gauge(pressure: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(pressure * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function fmtTokens(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Truncate to at most `width` visible chars (we strip ANSI before measuring
 *  stateDir paths; content lines here carry no ANSI). */
function trunc(s: string, width: number): string {
  return s.length > width ? s.slice(0, Math.max(0, width - 1)) + "…" : s;
}

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold?: (text: string) => string;
}
const NO_THEME: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };

// ---------------------------------------------------------------------------
// component (structural — pi calls render/handleInput/invalidate duck-typed)

class IthMenu {
  private snap: MenuSnapshot;
  private t: ThemeLike;

  constructor(
    private runtime: IthRuntime,
    private done: (value: null) => void,
    private requestRender: () => void,
    theme?: ThemeLike,
  ) {
    this.snap = collectSnapshot(runtime);
    this.t = theme ?? NO_THEME;
  }

  invalidate(): void { /* no cached render state to clear */ }

  handleInput(data: string): void {
    if (data === "q" || data === "\x1b") { // q / Esc — close
      this.done(null);
      return;
    }
    if (data === "r") { // refresh
      this.snap = collectSnapshot(this.runtime);
      this.invalidate();
      this.requestRender();
    }
  }

  render(width: number): string[] {
    const w = Math.max(40, Math.min(width, 88));
    const s = this.snap;
    const t = this.t;
    const bold = t.bold ?? ((x: string) => x);
    const lines: string[] = [];

    lines.push(bold(trunc(`ithacus v${s.version} — status`, w)));
    lines.push("");

    // pressure + crew + context
    lines.push(`pressure ${gauge(s.pressure)} ${(s.pressure * 100).toFixed(0).padStart(3)}%`);
    lines.push(trunc(`crew     ${s.activeAgents} active · turn ${s.currentTurn}`, w));
    const pct = s.ctxPercent != null ? `${Math.round(s.ctxPercent)}%` : "—";
    lines.push(trunc(`context  ${fmtTokens(s.ctxTokens)} / ${fmtTokens(s.ctxWindow)} (${pct})`, w));
    lines.push("");

    // providers
    const p = s.providers;
    const defProv = p.defaultProvider ?? "—";
    const defModel = p.defaultModel ?? "—";
    lines.push(trunc(`providers ${p.providerCount} · models ${p.modelCount} · default ${defProv}/${defModel}`, w));
    lines.push("");

    // agent roster
    lines.push(bold("agents:"));
    for (const a of s.agents) {
      const model = a.model ?? "(default)";
      const prov = a.provider ?? "—";
      const src = a.source === "project" ? "*" : " ";
      lines.push(trunc(` ${src} ${a.name.padEnd(12)} ${t.fg("accent", model)} ${t.fg("muted", `@ ${prov}`)}`, w));
    }
    lines.push(t.fg("muted", " * = project override (.pi/ithacus/agents)"));
    lines.push("");

    // dashboard snapshot state
    lines.push(bold("dashboard:"));
    lines.push(trunc(` dir     ${s.stateDir}`, w));
    lines.push(trunc(` snap    ${s.dashboardMtime ? `written ${s.dashboardMtime}` : "not written yet"}`, w));
    lines.push(trunc(` events  ${s.eventsSize != null ? `${(s.eventsSize / 1024).toFixed(1)} kB` : "none yet"}`, w));
    lines.push("");

    lines.push(t.fg("muted", " [r] refresh · [q]/esc close"));
    return lines.map((l) => trunc(l, w));
  }
}

// ---------------------------------------------------------------------------
// registration

export function registerMenuCommand(pi: ExtensionAPI, runtime: IthRuntime): void {
  pi.registerCommand("ithacus-menu", {
    description: "Open the ithacus status menu (version, crew, agents, dashboard)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      runtime.bindRepo(ctx.cwd);
      runtime.snapshotIfReady(ctx); // make `dashboard: snap` line honest on open
      await ctx.ui.custom<null>(
        (_tui, theme, _keybindings, done) =>
          new IthMenu(runtime, done, () => _tui.requestRender(), theme as ThemeLike),
        { overlay: true },
      );
    },
  });
}
