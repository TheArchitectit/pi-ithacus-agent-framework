/**
 * ithacus-provider-config.ts — loads pi-setup's provider config so
 * spawnAgent can resolve which provider owns a bare model id.
 *
 * pi-setup (the React config dashboard extension) is the React config
 * dashboard that writes:
 *   ~/.pi/agent/models.json   → { providers: { <name>: { baseUrl, api, models: [{id}] } } }
 *   ~/.pi/agent/settings.json → { defaultProvider, defaultModel, ... }
 *   ~/.pi/agent/auth.json     → { <name>: { type: "api_key", key } }
 *
 * This module is the bridge: read those files, hand the parsed result to the
 * pure resolver in src/provider-resolver.ts. Pure scanner logic stays in src/
 * (testable, no fs); only the file-IO lives here (extensions/ layer).
 *
 * PREVENT-ITH-004: local fs read of pi's own config dir — no network. The
 * extension source makes zero network calls; only spawned sub-agents call
 * configured providers. No annotation needed ( annotation pattern matches
 * ithacus-agents.ts and ithacus-runtime.ts, which also read `~/.pi/` freely).
 *
 * Read-through cache: files are re-read at most once per TTL (default 5s)
 * so a tight dispatch loop doesn't stat the config dir on every spawn, yet a
 * `/setup` change is picked up on the next dispatch within a few seconds.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PiSetupConfig, PiSetupSettings } from "../src/provider-resolver.js";

const PI_DIR = path.join(os.homedir(), ".pi", "agent");
const MODELS_FILE = path.join(PI_DIR, "models.json");
const SETTINGS_FILE = path.join(PI_DIR, "settings.json");

interface CacheEntry {
  config: PiSetupConfig;
  loadedAt: number;
}

let cache: CacheEntry | null = null;
const DEFAULT_TTL_MS = 5_000;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Load pi-setup's current provider config. Cached for `ttlMs` (default 5s).
 * Never throws — returns an empty config when files are missing/unreadable so
 * the pure resolver can fast-fail with a "not configured" hint instead.
 */
export function loadPiSetupConfig(ttlMs: number = DEFAULT_TTL_MS): PiSetupConfig {
  const now = Date.now();
  if (cache && now - cache.loadedAt < ttlMs) {
    return cache.config;
  }

  const models = readJson<{ providers?: Record<string, unknown> }>(MODELS_FILE);
  const settings = readJson<PiSetupSettings>(SETTINGS_FILE);

  const config: PiSetupConfig = {
    providers: (models?.providers ?? {}) as PiSetupConfig["providers"],
    settings: settings ?? {},
  };

  cache = { config, loadedAt: now };
  return config;
}

/** Drop the cache (force next loadPiSetupConfig() to re-read from disk). */
export function invalidateProviderConfigCache(): void {
  cache = null;
}
