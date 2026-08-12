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
import { normalizePermissionMode, type PermissionMode } from "./permissions.js";
import type {
  BackoffPolicy,
  ModelFallbackHop,
  RetryPolicy,
  WorkerFailureKind,
} from "./types.js";

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
  /** Single-authority consolidation (2026-08-12): durable compaction in the
   *  parent session is owned by pi-mega-compact, so ithacus does NOT self-trim
   *  by default. Default OFF; set ITHACUS_SELF_COMPACT=true to restore the
   *  legacy P7 self-trim (sessions running WITHOUT pi-mega-compact loaded). */
  selfCompact: boolean;
  debug: boolean;
  /** Cross-repo memory recall enabled. */
  memoryRecall: boolean;
  /** Fallback model list appended (deduped) after the caller's resolved model. */
  fallbackModels: string[];
  /** Sprint 5.17: richer GLOBAL model-fallback chain (optional). When present
   *  it REPLACES the flat `fallbackModels` semantics for the global hops.
   *  Env ITHACUS_FALLBACK_MODELS still works — treated as flat global hops. */
  modelFallbackChain?: ModelFallbackHop[];
  /** Sprint 5.17: distinct-model cap (per-agent overrides). default 2, clamp [1,3]. */
  maxFallbackHops: number;
  /** Sprint 5.17: global default retry policy (per-agent frontmatter overrides). */
  retryPolicy?: RetryPolicy;
  /** Sprint 5.17: global default backoff (per-agent overrides). */
  backoffPolicy?: BackoffPolicy;
  /** Sprint 5.17: pressure tier % reused by the auto-compact viability guard. */
  /** Sprint 5.15 (DESIGN_PERMISSION_MODES.md §2.3): fail-safe default mode for
   *  agents with no `permission:` declaration and no legacy `tools:`
   *  (env ITHACUS_PERMISSION_MODE_DEFAULT; unknown values normalize to
   *  read_only — fail-safe). */
  permissionModeDefault: PermissionMode;
  /** Sprint 5.15: when true, a missing permission declaration resolves to
   *  read_only even when legacy `tools:` frontmatter exists (env
   *  ITHACUS_PERMISSION_STRICT; default false = legacy pass-through). */
  permissionStrict: boolean;
  /** Sprint 5.24 (DESIGN_TWO_TIER_POLICY.md): two-tier connectivity policy.
   *  Tier L (Local) always on; Tier R (Remote) opt-in and default OFF. */
  remote: RemoteCapabilities;
  /** Sprint 5.27 (SPRINT_5_27_UI_OVERLAYS_AND_WEB_TOGGLES.md §3.5): local UI
   *  feature flags, all DEFAULT ON (opt-out surface). Env ITHACUS_UI >
   *  project config ".ithacus/config.json" "ui" key > defaults (all on). */
  ui: UiFlags;
  /** Sprint 5.18 (DESIGN_MEMORY_CONSOLIDATION.md): memory-consolidation tuning. */
  consolidation: ConsolidationConfig;
}

/** Memory-consolidation tuning (Sprint 5.18). All fields have safe defaults;
 *  surfaced on ith_memories via consolidate(). */
export interface ConsolidationConfig {
  /** Token-overlap in [0,1]; near-duplicates at/above merge. default 0.75. */
  collapseThreshold: number;
  /** Token-overlap in [0,1]; similar entries at/above group into a recall cluster. default 0.5. */
  clusterThreshold: number;
  /** Collapse time window in ms. default 24h. */
  windowMs: number;
  /** Auto-consolidate when a repo's active memory count exceeds this. default 500 (0 = off). */
  autoThreshold: number;
}

/** Known Tier-R capability ids (Sprint 5.24). Unknown keys are rejected. */
export const REMOTE_CAP_IDS = ["a2a", "external_memory", "mesh"] as const;
export type RemoteCapId = (typeof REMOTE_CAP_IDS)[number];

/** Two-tier connectivity policy (DESIGN_TWO_TIER_POLICY.md §3.2). Tier L
 *  (Local) ships on by default and is non-negotiable; Tier R (Remote) is
 *  opt-in and defaults OFF, gated per-capability. */
export interface RemoteCapabilities {
  /** Master switch. False -> every Tier-R module is inert regardless of
   *  individual toggles. Default false. */
  remoteEnabled: boolean;
  /** Per-capability toggles. Only meaningful when remoteEnabled. */
  capabilities: Record<string, boolean>;
}

export const REMOTE_CAP_DEFAULTS: RemoteCapabilities = {
  remoteEnabled: false,
  capabilities: { a2a: false, external_memory: false, mesh: false },
};

/** Sprint 5.27 §3.5 (SPRINT_5_27_UI_OVERLAYS_AND_WEB_TOGGLES.md): default-ON
 *  local UI flag ids. Unlike Tier R remote capabilities (default OFF), every
 *  local UI flag defaults ON; users opt OUT via env ITHACUS_UI or the project
 *  config ".ithacus/config.json" "ui" key (the web Setup panel writes the
 *  same key). Unknown keys are rejected. */
export const UI_FLAG_IDS = ["liveCard", "webUi", "widget", "menuOverlay", "notifications"] as const;
export type UiFlagId = (typeof UI_FLAG_IDS)[number];

/** The 5.27 local UI flags. All fields default ON. */
export interface UiFlags {
  /** Live-progress overlay card (5.13/5.14). */
  liveCard: boolean;
  /** Loopback web interface + /ithacus-web command (§3.4). */
  webUi: boolean;
  /** Widget / menu presence. */
  widget: boolean;
  /** Menu overlay. */
  menuOverlay: boolean;
  /** Notifications. */
  notifications: boolean;
}

export const UI_FLAG_DEFAULTS: UiFlags = {
  liveCard: true,
  webUi: true,
  widget: true,
  menuOverlay: true,
  notifications: true,
};

/** Parse a `ui` block (the ".ithacus/config.json" "ui" key) into UiFlags.
 *  Missing keys keep their defaults; unknown keys are rejected; non-boolean
 *  values throw. Pure — no env, no I/O. */
export function parseUiFlags(raw: unknown): UiFlags {
  if (raw == null) return { ...UI_FLAG_DEFAULTS };
  if (!isRecord(raw)) {
    throw new Error('"ui" must be an object of UiFlags');
  }
  const flags: UiFlags = { ...UI_FLAG_DEFAULTS };
  for (const key of Object.keys(raw)) {
    if (!(UI_FLAG_IDS as readonly string[]).includes(key)) {
      throw new Error(`unknown ui flag: "${key}" (known: ${UI_FLAG_IDS.join(", ")})`);
    }
    const val = raw[key];
    if (typeof val !== "boolean") {
      throw new Error(`ui flag "${key}" must be a boolean`);
    }
    flags[key as UiFlagId] = val;
  }
  return flags;
}

/** Resolve the effective UiFlags from project config + env. Precedence:
 *  env (ITHACUS_UI = comma-separated "flag:true|false" pairs) > project
 *  config (".ithacus/config.json" "ui" key) > defaults (all on). Unknown or
 *  malformed env entries are rejected (throw), never silently accepted. Env
 *  is re-read on every call (never cached) so a toggle flip is respected on
 *  the next load. */
function resolveUiFlags(projectUi: unknown): UiFlags {
  const resolved = parseUiFlags(projectUi);
  const envUi = process.env.ITHACUS_UI;
  if (envUi != null && envUi !== "") {
    const entries = envUi.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      const idx = entry.indexOf(":");
      if (idx <= 0) {
        throw new Error(`[ithacus] malformed ITHACUS_UI entry: "${entry}" (expected "flag:true|false")`);
      }
      const key = entry.slice(0, idx).trim();
      const val = entry.slice(idx + 1).trim();
      if (!(UI_FLAG_IDS as readonly string[]).includes(key)) {
        throw new Error(`[ithacus] unknown ui flag in ITHACUS_UI: "${key}"`);
      }
      if (val !== "true" && val !== "false") {
        throw new Error(`[ithacus] ui flag "${key}" must be true|false, got "${val}"`);
      }
      resolved[key as UiFlagId] = val === "true";
    }
  }
  return resolved;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse a `remote` block (the `.ithacus/config.json` "remote" key) into
 *  RemoteCapabilities. Rejects unknown capability keys. Pure — no env, no I/O.
 *  Throws on malformed input (missing bools, unknown keys, non-object). */
export function parseRemoteCapabilities(raw: unknown): RemoteCapabilities {
  if (raw == null) {
    return { remoteEnabled: false, capabilities: { ...REMOTE_CAP_DEFAULTS.capabilities } };
  }
  if (!isRecord(raw)) {
    throw new Error('"remote" must be an object { remoteEnabled, capabilities }');
  }
  let remoteEnabled = false;
  if (raw.remoteEnabled != null) {
    if (typeof raw.remoteEnabled !== "boolean") {
      throw new Error('"remote.remoteEnabled" must be a boolean');
    }
    remoteEnabled = raw.remoteEnabled;
  }
  const capabilities: Record<string, boolean> = { ...REMOTE_CAP_DEFAULTS.capabilities };
  if (raw.capabilities != null) {
    if (!isRecord(raw.capabilities)) {
      throw new Error('"remote.capabilities" must be an object');
    }
    for (const key of Object.keys(raw.capabilities)) {
      if (!(REMOTE_CAP_IDS as readonly string[]).includes(key)) {
        throw new Error(`unknown remote capability: "${key}" (known: ${REMOTE_CAP_IDS.join(", ")})`);
      }
      const val = raw.capabilities[key];
      if (typeof val !== "boolean") {
        throw new Error(`remote capability "${key}" must be a boolean`);
      }
      capabilities[key] = val;
    }
  }
  return { remoteEnabled, capabilities };
}

/** Resolve the effective RemoteCapabilities from project config + env.
 *  Precedence: env (ITHACUS_REMOTE / ITHACUS_REMOTE_CAPS) > project config
 *  (> .ithacus/config.json "remote" key) > defaults (all off). The master
 *  switch dominates: if remoteEnabled is false every capability is inert.
 *  Env is re-read on every call (never cached) so a toggle flip is respected
 *  on the next load. */
function resolveRemoteCapabilities(projectRemote: unknown): RemoteCapabilities {
  const resolved = parseRemoteCapabilities(projectRemote);
  const envRemote = process.env.ITHACUS_REMOTE;
  if (envRemote != null && envRemote !== "") {
    resolved.remoteEnabled = envBool("ITHACUS_REMOTE", false);
  }
  const envCaps = process.env.ITHACUS_REMOTE_CAPS;
  if (envCaps != null && envCaps !== "") {
    const caps = envCaps.split(",").map((s) => s.trim()).filter(Boolean);
    const capabilities: Record<string, boolean> = { ...REMOTE_CAP_DEFAULTS.capabilities };
    for (const c of caps) {
      if (!(REMOTE_CAP_IDS as readonly string[]).includes(c)) {
        throw new Error(`[ithacus] unknown remote capability in ITHACUS_REMOTE_CAPS: "${c}"`);
      }
      capabilities[c] = true;
    }
    resolved.capabilities = capabilities;
  }
  return resolved;
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

export function loadConfig(projectRemote?: unknown, projectUi?: unknown): IthacusConfig {
  const rawFb = process.env.ITHACUS_FALLBACK_MODELS;
  const fallbackModels = rawFb
    ? rawFb.split(",").map((s) => s.trim()).filter(Boolean)
    : ["claude-haiku-4-5-20251001", "kimi", "qwen"];

  // Sprint 5.17 (PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §3.2): additive,
  // backward-compatible config. ITHACUS_FALLBACK_MODELS keeps working (now
  // as flat global hops); the new env vars are all optional with defaults that
  // preserve today's behavior.
  const modelFallbackChain: ModelFallbackHop[] | undefined = rawFb
    ? fallbackModels.map((m) => {
        const idx = m.indexOf("/");
        return idx > 0
          ? { model: m.slice(idx + 1), provider: m.slice(0, idx) }
          : { model: m };
      })
    : undefined;

  const rawRetryOn = process.env.ITHACUS_RETRY_ON;
  const retryOn: WorkerFailureKind[] = rawRetryOn
    ? (rawRetryOn.split(",").map((s) => s.trim()).filter(Boolean) as WorkerFailureKind[])
    : ["context_window", "rate_limit", "network"];
  const retryPolicy: RetryPolicy = {
    enabled: envBool("ITHACUS_RETRY_ENABLED", true),
    maxRetries: envNum("ITHACUS_RETRY_MAX", 1),
    on: retryOn,
    backoff: {
      baseMs: envNum("ITHACUS_BACKOFF_BASE_MS", 500),
      factor: envNum("ITHACUS_BACKOFF_FACTOR", 2),
      maxMs: envNum("ITHACUS_BACKOFF_MAX_MS", 30000),
      jitter: envBool("ITHACUS_BACKOFF_JITTER", true),
    },
  };
  const backoffPolicy: BackoffPolicy = retryPolicy.backoff!;

  return {
    auto: envBool("ITHACUS_AUTO", true),
    anchorRecent: envNum("ITHACUS_ANCHOR_RECENT", 3),
    preserveRecent: envNum("ITHACUS_PRESERVE_RECENT", 4),
    tierPct: envNum("ITHACUS_TIER_PCT", 0.7),
    selfCompact: envBool("ITHACUS_SELF_COMPACT", false),
    trimDebounceMs: envNum("ITHACUS_TRIM_DEBOUNCE_MS", 2000),
    debug: envBool("ITHACUS_DEBUG", false),
    memoryRecall: envBool("ITHACUS_MEMORY_RECALL", true),
    fallbackModels,
    modelFallbackChain,
    maxFallbackHops: clampNum(envNum("ITHACUS_MAX_FALLBACK_HOPS", 2), 1, 3),
    retryPolicy,
    backoffPolicy,
    permissionModeDefault: normalizePermissionMode(process.env.ITHACUS_PERMISSION_MODE_DEFAULT),
    permissionStrict: envBool("ITHACUS_PERMISSION_STRICT", false),
    remote: resolveRemoteCapabilities(projectRemote),
    ui: resolveUiFlags(projectUi),
    consolidation: {
      collapseThreshold: envNum("ITHACUS_CONSOLIDATE_COLLAPSE", 0.75),
      clusterThreshold: envNum("ITHACUS_CONSOLIDATE_CLUSTER", 0.5),
      windowMs: envNum("ITHACUS_CONSOLIDATE_WINDOW_MS", 24 * 60 * 60 * 1000),
      autoThreshold: envNum("ITHACUS_CONSOLIDATE_AUTO", 500),
    },
  };
}

function clampNum(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
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
