/**
 * ithacus-checkpoints-overlay.ts — the `/ithacus-checkpoints` overlay
 * (Sprint 5.16, docs/DESIGN_CHECKPOINT_MANAGER.md §2.3).
 *
 * A read-only list/manage panel over the sqlite checkpoint manager
 * (src/checkpoint-manager.ts). Each row shows label, run, age, messages,
 * tokens and an archived flag. Keys: `a` archive, `d` delete (with confirm),
 * `c` compare-mode (pick two), `esc`/`q` close, `r` refresh. Read-only
 * otherwise — never mutates live conversations.
 *
 * PREVENT-ITH-004: local node:sqlite reads/writes only — zero network, no
 * subprocess spawn. Implements pi's Component interface STRUCTURALLY
 * (render/handleInput/invalidate) like ithacus-menu.ts, so no pi-tui type
 * import is needed. Fields declared explicitly (no parameter properties).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { IthRuntime } from "./ithacus-runtime.js";
import {
  listCheckpoints,
  getCheckpoint,
  deleteCheckpoint,
  archiveCheckpoint,
  compareCheckpoints,
} from "../src/checkpoint-manager.js";
import type { CheckpointMeta, CheckpointDiff } from "../src/checkpoint-manager.js";

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold?: (text: string) => string;
}
const NO_THEME: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };

/** Compact human age ("3d", "2h", "5m", "just now"). */
function fmtAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

type Mode =
  | { kind: "list" }
  | { kind: "confirm-delete"; id: string }
  | { kind: "compare-pick"; first: CheckpointMeta }
  | { kind: "compare-result"; first: CheckpointMeta; second: CheckpointMeta; diff: CheckpointDiff };

class IthCheckpointsOverlay {
  private t: ThemeLike;
  private runtime: IthRuntime;
  private done: (value: null) => void;
  private requestRender: () => void;
  private mode: Mode = { kind: "list" };
  private list!: CheckpointMeta[];
  private cursor = 0;
  private note: string | null = null;

  constructor(
    runtime: IthRuntime,
    done: (value: null) => void,
    requestRender: () => void,
    theme?: ThemeLike,
  ) {
    this.runtime = runtime;
    this.done = done;
    this.requestRender = requestRender;
    this.t = theme ?? NO_THEME;
    this.refresh();
  }

  private refresh(): void {
    this.list = listCheckpoints(this.runtime.store, { includeArchived: true });
    if (this.cursor >= this.list.length) this.cursor = Math.max(0, this.list.length - 1);
  }

  invalidate(): void { /* list re-read on refresh() */ }

  handleInput(data: string): void {
    if (data === "\x1b" || data === "q") {
      this.done(null);
      return;
    }
    if (data === "r") {
      this.refresh();
      this.mode = { kind: "list" };
      this.note = null;
      this.requestRender();
      return;
    }

    const list = this.list;

    if (this.mode.kind === "confirm-delete") {
      if (data === "y" || data === "Y") {
        const ok = deleteCheckpoint(this.runtime.store, this.mode.id);
        this.note = ok ? "deleted" : "not deleted (absent or archived)";
        this.mode = { kind: "list" };
        this.refresh();
      } else {
        this.mode = { kind: "list" };
        this.note = null;
      }
      this.requestRender();
      return;
    }

    if (this.mode.kind === "compare-pick") {
      if (data === "c" || data === "\x1b" || data === "q") {
        this.mode = { kind: "list" };
        this.note = null;
        this.requestRender();
        return;
      }
      const idx = Number(data) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < list.length) {
        const second = list[idx];
        const diff = compareCheckpoints(this.runtime.store, this.mode.first.id, second.id);
        this.mode = { kind: "compare-result", first: this.mode.first, second, diff };
      }
      this.requestRender();
      return;
    }

    if (this.mode.kind === "compare-result") {
      if (data === "c" || data === "\x1b" || data === "q" || data === "r") {
        this.mode = { kind: "list" };
        this.requestRender();
      }
      return;
    }

    // list mode
    if (data === "j" || data === "down" || data === "\x1b[B") {
      this.cursor = Math.min(list.length - 1, this.cursor + 1);
      this.requestRender();
      return;
    }
    if (data === "k" || data === "up" || data === "\x1b[A") {
      this.cursor = Math.max(0, this.cursor - 1);
      this.requestRender();
      return;
    }
    const idx = Number(data) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < list.length) {
      this.cursor = idx;
    }
    const sel = list[this.cursor];
    if (!sel) return;
    if (data === "a") {
      const ok = archiveCheckpoint(this.runtime.store, sel.id);
      this.note = ok ? `archived: ${sel.label}` : "not found";
      this.refresh();
      this.requestRender();
      return;
    }
    if (data === "d") {
      this.mode = { kind: "confirm-delete", id: sel.id };
      this.requestRender();
      return;
    }
    if (data === "c") {
      if (list.length < 2) {
        this.note = "need at least 2 checkpoints to compare";
        this.requestRender();
        return;
      }
      this.mode = { kind: "compare-pick", first: sel };
      this.requestRender();
      return;
    }
  }

  render(width: number): string[] {
    const w = Math.max(40, Math.min(width, 88));
    const t = this.t;
    const bold = t.bold ?? ((x: string) => x);
    const fg = (c: string, s: string): string => {
      try { return t.fg(c, s); } catch { return s; }
    };
    const lines: string[] = [];
    const list = this.list;

    lines.push(bold("ithacus — checkpoints"), "");

    if (this.note) {
      lines.push(fg("accent", `• ${this.note}`), "");
    }

    if (this.mode.kind === "compare-result") {
      const d = this.mode.diff;
      lines.push(fg("accent", "▌ compare"));
      for (const row of d.summaryDiff.split("\n")) {
        lines.push(" " + row);
      }
      lines.push("");
      lines.push(fg("muted", " [c]/esc back to list"));
      return lines.map((l) => (l.length > w ? l.slice(0, w) : l));
    }

    if (this.mode.kind === "confirm-delete") {
      const sel = getCheckpoint(this.runtime.store, this.mode.id);
      lines.push(fg("error", `Delete checkpoint "${sel?.label ?? this.mode.id}"? (y/N)`));
      lines.push(fg("muted", " [y] confirm · any other key cancel"));
      return lines.map((l) => (l.length > w ? l.slice(0, w) : l));
    }

    if (this.mode.kind === "compare-pick") {
      lines.push(fg("accent", `pick a second checkpoint (first: ${this.mode.first.label})`));
      lines.push("");
    }

    if (list.length === 0) {
      lines.push(fg("muted", "no checkpoints recorded yet."));
    } else {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const num = ` ${i + 1} `;
        const marker = i === this.cursor ? fg("accent", "›" + num) : ` ${num.slice(1)}`;
        const arch = c.archived ? fg("dim", "[archived] ") : "";
        const body = `${c.label} · ${c.runId} · ${fmtAge(c.createdAt)} · ` +
          `${c.messageCount ?? '?'} msg · ${c.tokenEstimate ?? '?'} tok`;
        const full = marker + " " + arch + body;
        lines.push(full.length > w ? full.slice(0, w) : full);
      }
    }

    lines.push("");
    lines.push(fg("muted",
      this.mode.kind === "compare-pick"
        ? " [1-9] pick second · q/esc cancel"
        : " [1-9] select · j/k move · a archive · d delete · c compare · r refresh · q/esc close"));
    return lines.map((l) => (l.length > w ? l.slice(0, w) : l));
  }
}

/** Register the /ithacus-checkpoints slash command (Sprint 5.16 §2.3). */
export function registerCheckpointsCommand(
  pi: ExtensionAPI,
  runtime: IthRuntime,
): void {
  pi.registerCommand("ithacus-checkpoints", {
    description: "List / manage session checkpoints (list, archive, delete, compare)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      runtime.bindRepo(ctx.cwd);
      await ctx.ui.custom<null>(
        (_tui, theme, _keybindings, done) =>
          new IthCheckpointsOverlay(
            runtime,
            done,
            () => _tui.requestRender(),
            theme as ThemeLike,
          ),
        { overlay: true },
      );
    },
  });
}
