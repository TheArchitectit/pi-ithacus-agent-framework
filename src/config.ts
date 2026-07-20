/**
 * config.ts — pi-agnostic configuration, per-repo state-dir scoping, and
 * pressure helpers for ithacus.
 *
 * Mirrors pi-mega-compact's mega-config.ts: a frozen-at-load config resolved
 * from env + defaults, plus a pure `repoStateDir()` that binds the store to
 * `<repo>/.pi/ithacus/` (the folder that IS the project name).
 *
 * No pi runtime types are imported here so this module is unit-testable in
 * isolation with `node --test`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process"; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: read-only `git rev-parse` to scope per-repo

/** Project name == folder name. The resident folder is `.pi/ithacus`. */
export const PROJECT_NAME = "ithacus";
export const FOLDER_NAME = ".pi/ithacus";

/** Global fallback when cwd is not inside a git repo. */
export const STATE_DIR_DEFAULT = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  PROJECT_NAME,
);

/** Mode presets from PR #3250 TeamCreate (1x..6x agent counts). */
export const MODE_PRESETS = {
  tiny: { agents: 1, roles: ["Explore"] },
  small: { agents: 2, roles: ["Explore", "Plan"] },
  medium: { agents: 3, roles: ["Explore", "Plan", "Verification"] },
  large: { agents: 4, roles: ["Explore", "Plan", "Verification", "Reviewer"] },
  xlarge: { agents: 5, roles: ["Explore", "Plan", "Verification", "Reviewer", "Explore"] },
  mega: { agents: 6, roles: ["Explore", "Plan", "Verification", "Reviewer", "Explore", "Plan"] },
} as const;
export type ModePreset = keyof typeof MODE_PRESETS;

export interface IthacusConfig {
  auto: boolean;
  anchorRecent: number;
  preserveRecent: number;
  /** Token threshold as a fraction of the model context window. */
  tierPct: number;
  /** Deadline (ms) guarding against thrashing the durable trim. */
  trimDebounceMs: number;
  debug: boolean;
  /** Cross-repo memory recall enabled. */
  memoryRecall: boolean;
  /** Fallback model list appended (deduped) after the caller's resolved model. */
  fallbackModels: string[];
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return v === "true" || v === "1";
}
function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): IthacusConfig {
  const rawFb = process.env.ITHACUS_FALLBACK_MODELS;
  const fallbackModels = rawFb
    ? rawFb.split(",").map((s) => s.trim()).filter(Boolean)
    : ["claude-haiku-4-5-20251001", "kimi", "qwen"];
  return {
    auto: envBool("ITHACUS_AUTO", true),
    anchorRecent: envNum("ITHACUS_ANCHOR_RECENT", 3),
    preserveRecent: envNum("ITHACUS_PRESERVE_RECENT", 4),
    tierPct: envNum("ITHACUS_TIER_PCT", 0.7),
    trimDebounceMs: envNum("ITHACUS_TRIM_DEBOUNCE_MS", 2000),
    debug: envBool("ITHACUS_DEBUG", false),
    memoryRecall: envBool("ITHACUS_MEMORY_RECALL", true),
    fallbackModels,
  };
}

/** Resolve the current repo's git root. undefined outside git. */
export function resolveRepoRoot(cwd: string): string | undefined {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-repo state dir: <repo>/.pi/ithacus (tracked, travels with the repo).
 * Falls back to the global default outside git.
 */
export function repoStateDir(cwd: string | undefined, fallback: string): string {
  if (!cwd) return fallback;
  const root = resolveRepoRoot(cwd);
  if (!root) return fallback;
  return join(root, ".pi", "ithacus");
}

/** Live "how full" pressure: tokens / (tierPct * window). Finite in [0,1+]. */
export function pressureRatio(currentTokens: number, effectiveThreshold: number): number {
  if (effectiveThreshold <= 0) return 0;
  return currentTokens / effectiveThreshold;
}

export type PressureBand = "low" | "medium" | "high" | "ultra" | "mega";

export function pressureBand(p: number): PressureBand {
  if (p < 0.4) return "low";
  if (p < 0.6) return "medium";
  if (p < 0.8) return "high";
  if (p < 1.0) return "ultra";
  return "mega";
}

/**
 * Effective compaction fire point in tokens: tierPct * window when known, else
 * a sane boot fallback. Single source of truth for the trim gates.
 */
export function effectiveThresholdTokens(opts: {
  tierPct: number;
  window: number;
  fallback: number;
}): number {
  if (opts.window > 0) return Math.round(opts.tierPct * opts.window);
  return opts.fallback;
}

/** Memory-review cadence scales with pressure so memories keep pace with churn. */
export function memoryReviewCadence(band: PressureBand, base: number): number {
  const scale: Record<PressureBand, number> = {
    low: 1,
    medium: 1,
    high: 2,
    ultra: 3,
    mega: 4,
  };
  return Math.max(1, Math.round(base / scale[band]));
}
