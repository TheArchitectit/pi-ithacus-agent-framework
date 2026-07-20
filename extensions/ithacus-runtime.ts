/**
 * ithacus-runtime.ts — shared live state of the ithacus extension.
 *
 * Lifts the per-session mutable state into a class so the event/command/team
 * modules share it without re-declaring it (mirrors mega-compact MegaRuntime).
 * Owns: the IthStore (rebound per-repo via bindRepo), the active crew counters,
 * and the localhost dashboard snapshot writer.
 *
 * This module imports pi runtime types (ExtensionContext) — it is the adapter
 * layer, NOT pi-agnostic. Keep framework logic in src/.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { IthStore, repoIdFromCwd } from "../src/store.js";
import { repoStateDir, STATE_DIR_DEFAULT, type IthacusConfig } from "../src/config.js";
import { resolveRepoRoot } from "../src/config.js";
import { currentPressure } from "../src/trim.js";

export class IthRuntime {
  config: IthacusConfig;
  store: IthStore;
  activeRepoRoot: string | null = null;
  currentStateDir: string;

  // Per-session mutable state (reset on session_start / session_tree).
  sessionId = "global";
  activeAgents = 0;
  currentTurn = 0;
  lastCtxTokens: number | null = null;
  lastCtxPercent: number | null = null;
  lastCtxWindow = 0;
  lastCompactAt: number | null = null;
  debounceUntil = 0;
  resumeNudgeUntil = 0;

  constructor(config: IthacusConfig) {
    this.config = config;
    this.store = new IthStore(undefined, config);
    this.currentStateDir = STATE_DIR_DEFAULT;
  }

  /** Point the store at the current repo's `.pi/ithacus` dir. Rebuild only on switch. */
  bindRepo(cwd: string | undefined): void {
    const dir = repoStateDir(cwd, STATE_DIR_DEFAULT);
    const key = cwd ? resolveRepoRoot(cwd) ?? dir : dir;
    if (key === this.activeRepoRoot) return;
    this.activeRepoRoot = key;
    this.currentStateDir = dir;
    this.store = new IthStore(cwd, this.config);
  }

  /** Append a structured line to the repo's events.log (always-on diagnostics). */
  appendEvent(event: string, fields: Record<string, unknown>): void {
    try {
      mkdirSync(this.currentStateDir, { recursive: true });
      appendFileSync(
        join(this.currentStateDir, "events.log"),
        JSON.stringify({ ts: Date.now(), event, ...fields }) + "\n",
      );
    } catch {
      /* non-fatal */
    }
  }

  /** Live 0..1 pressure for the dashboard. */
  get pressure(): number {
    return currentPressure({
      activeAgents: this.activeAgents,
      isIdle: true,
      currentTokens: this.lastCtxTokens,
      contextWindow: this.lastCtxWindow,
      tierPct: this.config.tierPct,
      bootFallback: Math.round(this.config.tierPct * 200_000),
      sinceLastCompactMs: this.lastCompactAt ? Date.now() - this.lastCompactAt : 1e9,
      trimDebounceMs: this.config.trimDebounceMs,
    });
  }

  repoId(cwd: string | undefined): string {
    return repoIdFromCwd(cwd);
  }

  /**
   * Write a dashboard snapshot to dashboard.json (best-effort + non-fatal).
   * Kept cheap so it can be called from every event handler without thrashing.
   */
  snapshotIfReady(ctx?: ExtensionContext): void {
    try {
      const { writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const snap = {
        version: 1,
        updatedAt: new Date().toISOString(),
        pressure: this.pressure,
        crew: { activeAgents: this.activeAgents, currentTurn: this.currentTurn },
        context: {
          tokens: this.lastCtxTokens,
          percent: this.lastCtxPercent,
          contextWindow: this.lastCtxWindow,
        },
        repo: this.activeRepoRoot,
      };
      writeFileSync(join(this.currentStateDir, "dashboard.json"), JSON.stringify(snap, null, 2));
    } catch {
      /* non-fatal */
    }
  }

  dispose(): void {
    try {
      this.store.close();
    } catch {
      /* non-fatal */
    }
  }
}
