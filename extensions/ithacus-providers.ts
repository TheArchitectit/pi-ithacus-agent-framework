/**
 * ithacus-providers.ts — provider + model management (write side).
 *
 * Adapted from pi-setup's setup.ts so ithacus can manage providers/models
 * WITHOUT pi-setup being installed. Writes the SAME files pi-setup writes
 * (and that ithacus-provider-config.ts reads):
 *   ~/.pi/agent/models.json   → { providers: { <name>: { baseUrl, api, models } } }
 *   ~/.pi/agent/auth.json     → { <name>: { type:"api_key", key } }  (chmod 600)
 *   ~/.pi/agent/settings.json → { defaultProvider, defaultModel, defaultThinkingLevel }
 *
 * After each write, calls pi.registerProvider() so newly added providers are
 * available in the CURRENT session (not just after a restart), and
 * invalidates the loadPiSetupConfig read cache.
 *
 * Covers the five operations the user asked for:
 *   A. add new provider        → addProviderFlow()
 *   B. edit provider           → editProviderFlow()  (base URL / api type / key)
 *   C. add model               → addModelFlow()
 *   D. edit model              → modelEditFlow()      (rename / context / reasoning)
 *   E. remove                  → removeProvider() / removeModel()
 *
 * PREVENT-ITH-004: local fs writes to ~/.pi + read/write of pi config. No
 * network. Mirrors pi-setup's setup.ts (which does the same without an
 * annotation) and ithacus-agents.ts. registerProvider is an in-process call,
 * not a network call.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { loadPiSetupConfig, invalidateProviderConfigCache } from "./ithacus-provider-config.js";

const PI_DIR = join(process.env.HOME ?? "~", ".pi", "agent");
const MODELS_FILE = join(PI_DIR, "models.json");
const AUTH_FILE = join(PI_DIR, "auth.json");
const SETTINGS_FILE = join(PI_DIR, "settings.json");

// --- types ---------------------------------------------------------------

type ModelInput = "text" | "image";

interface ProviderModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: ModelInput[];
  compat?: { supportsDeveloperRole?: boolean };
}

interface ProviderEntry {
  baseUrl: string;
  api: string;
  apiKey?: string;
  compat?: { supportsDeveloperRole?: boolean };
  models: ProviderModel[];
}

type Providers = Record<string, ProviderEntry>;

// --- low-level json (mirrors pi-setup) ------------------------------------

function loadJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveJson(file: string, data: Record<string, unknown>): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  if (file === AUTH_FILE) chmodSync(file, 0o600);
}

function loadProviders(): Providers {
  const data = loadJson(MODELS_FILE);
  return (data.providers ?? {}) as Providers;
}

function saveModels(providers: Providers): void {
  saveJson(MODELS_FILE, { providers });
}

/**
 * Save an API key. $$ -escapes $ so pi's resolveConfigValue does not try to
 * interpolate $VAR references in raw keys (mirrors pi-setup; arrow fn is
 * required because String.replace treats $$ in a string replacement as a
 * literal $, making .replace(/\$/g, "$$") a no-op).
 */
function saveAuth(providerName: string, key: string): void {
  const auth = loadJson(AUTH_FILE);
  const escapedKey = key.replace(/\$/g, () => "$$");
  auth[providerName] = { type: "api_key", key: escapedKey };
  saveJson(AUTH_FILE, auth);
}

/** Re-escape any unescaped $ in auth.json after an edit (mirrors pi-setup). */
function ensureAuthKeysEscaped(): void {
  const authData = loadJson(AUTH_FILE);
  let dirty = false;
  for (const [, entry] of Object.entries(authData)) {
    const cred = entry as { type?: string; key?: string };
    if (cred?.type !== "api_key" || !cred.key) continue;
    const unescaped = cred.key.replace(/\$\$/g, "$");
    const reEscaped = unescaped.replace(/\$/g, () => "$$");
    if (reEscaped !== cred.key) {
      cred.key = reEscaped;
      dirty = true;
    }
  }
  if (dirty) saveJson(AUTH_FILE, authData);
}

/** Find the provider name that owns a given provider object (by ref). */
function nameOfProvider(providers: Providers, provider: ProviderEntry): string | undefined {
  for (const [n, pv] of Object.entries(providers)) {
    if (pv === provider) return n;
  }
  return undefined;
}

// --- apply to current session (mirrors pi-setup applyProviders) -----------

/**
 * Register all saved providers with pi so they are available in the current
 * session (not just after a restart). Reads the resolved API key from
 * auth.json. Provider-level compat defaults supportsDeveloperRole:false for
 * custom OpenAI-compatible endpoints (many reject the "developer" role).
 */
export function applyProviders(pi: ExtensionAPI, providers: Providers): void {
  const authData = loadJson(AUTH_FILE);
  for (const [name, pv] of Object.entries(providers)) {
    if (!pv.baseUrl || pv.models.length === 0) continue;
    const providerCompat = { supportsDeveloperRole: false, ...(pv.compat ?? {}) };
    const authEntry = authData[name] as { type?: string; key?: string } | undefined;
    const resolvedKey =
      authEntry?.type === "api_key" && authEntry.key ? authEntry.key : pv.apiKey ?? name;
    pi.registerProvider(name, {
      baseUrl: pv.baseUrl,
      apiKey: resolvedKey,
      api: pv.api as never,
      models: pv.models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        reasoning: m.reasoning,
        input: m.input,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        compat: { ...providerCompat, ...m.compat },
      })),
    });
  }
}

/** Commit after any provider/model change: persist + apply + invalidate cache. */
function commit(pi: ExtensionAPI, providers: Providers): void {
  saveModels(providers);
  applyProviders(pi, providers);
  invalidateProviderConfigCache();
}

// --- A. add provider ------------------------------------------------------

export async function addProviderFlow(
  ui: ExtensionContext["ui"],
  pi: ExtensionAPI,
  providers: Providers,
): Promise<"back" | void> {
  const name = ((await ui.input("Provider name:", "my-provider")) ?? "").trim();
  if (!name) return "back";
  if (providers[name]) {
    ui.notify(`Provider "${name}" already exists — edit it instead.`, "warning");
    return;
  }
  const baseUrl = ((await ui.input("Base URL:", "http://localhost:8001/v1")) ?? "").trim(); // guardrails-allow PREVENT-PI-004 PREVENT-ITH-004: placeholder default for user-typed local provider URL; extension performs no network call of its own
  if (!baseUrl) return "back";
  const apiPick = await ui.select("API type:", [
    "openai-completions",
    "anthropic-messages",
    "gemini",
  ]);
  if (!apiPick) return "back";
  const keyInput = ((await ui.input("API key (leave blank to skip):", "")) ?? "").trim();

  const provider: ProviderEntry = {
    baseUrl,
    api: apiPick,
    apiKey: name,
    models: [],
    compat: { supportsDeveloperRole: false },
  };

  await modelsLoop(ui, pi, provider, providers);

  providers[name] = provider;
  saveAuth(name, keyInput);
  commit(pi, providers);
  ui.notify(`Provider "${name}" saved with ${provider.models.length} model(s).`, "info");
}

// --- B. edit provider + E. remove provider --------------------------------

export async function editProviderFlow(
  ui: ExtensionContext["ui"],
  pi: ExtensionAPI,
  name: string,
  providers: Providers,
): Promise<"back" | void> {
  for (;;) {
    const pv = providers[name];
    if (!pv) {
      ui.notify(`Provider "${name}" not found.`, "warning");
      return "back";
    }
    const modelCount = pv.models.length;
    const action = await ui.select(`Edit "${name}" (${modelCount} model(s)):`, [
      "Base URL",
      "API type",
      "API key",
      "Manage models",
      "Remove provider",
      "< Back",
    ]);
    if (!action || action === "< Back") return "back";

    if (action === "Base URL") {
      const url = ((await ui.input("Base URL:", pv.baseUrl)) ?? "").trim();
      if (url) {
        pv.baseUrl = url;
        commit(pi, providers);
        ui.notify("Base URL updated.", "info");
      }
    } else if (action === "API type") {
      const api = await ui.select("API type:", [
        "openai-completions",
        "anthropic-messages",
        "gemini",
      ]);
      if (api) {
        pv.api = api;
        commit(pi, providers);
        ui.notify(`API type updated: ${api}`, "info");
      }
    } else if (action === "API key") {
      const key = ((await ui.input("API key:", "")) ?? "").trim();
      if (key) {
        pv.apiKey = name;
        saveAuth(name, key);
        commit(pi, providers);
        ui.notify("API key updated.", "info");
      }
    } else if (action === "Manage models") {
      await modelsLoop(ui, pi, pv, providers);
      ui.notify(`Models updated for "${name}".`, "info");
    } else if (action === "Remove provider") {
      const confirm = await ui.select(`Remove "${name}"? This deletes its models + auth key.`, [
        "Cancel",
        "Remove",
      ]);
      if (confirm === "Remove") {
        delete providers[name];
        // also drop the auth entry
        const auth = loadJson(AUTH_FILE);
        delete auth[name];
        saveJson(AUTH_FILE, auth);
        commit(pi, providers);
        ui.notify(`Provider "${name}" removed.`, "info");
      }
      return;
    }
  }
}

// --- models loop (C. add model + D. edit model + E. remove model) --------

export async function modelsLoop(
  ui: ExtensionContext["ui"],
  pi: ExtensionAPI,
  provider: ProviderEntry,
  providers: Providers,
): Promise<"back" | void> {
  for (;;) {
    const choices = [...provider.models.map((m) => m.id), "+ Add model", "< Back"];
    const pick = await ui.select("Models:", choices);
    if (!pick || pick === "< Back") return "back";
    if (pick === "+ Add model") {
      const r = await addModelFlow(ui, pi, provider, providers);
      if (r === "back") continue;
    } else {
      const model = provider.models.find((m) => m.id === pick);
      if (!model) continue;
      const r = await modelEditFlow(ui, pi, pick, model, provider, providers);
      if (r === "back") continue;
    }
  }
}

// --- C. add model ---------------------------------------------------------

export async function addModelFlow(
  ui: ExtensionContext["ui"],
  pi: ExtensionAPI,
  provider: ProviderEntry,
  providers: Providers,
): Promise<"back" | void> {
  const id = ((await ui.input("Model ID:", "")) ?? "").trim();
  if (!id) return "back";
  if (provider.models.some((m) => m.id === id)) {
    ui.notify(`Model "${id}" already exists.`, "warning");
    return;
  }
  const displayName = ((await ui.input("Display name:", id)) ?? "").trim();
  const ctxRaw = ((await ui.input("Context window:", "2000000")) ?? "").trim();
  const maxRaw = ((await ui.input("Max output tokens:", "1000000000")) ?? "").trim();
  const reasoningPick = await ui.select("Supports reasoning?", ["Yes", "No"]);
  if (!reasoningPick) return "back";

  provider.models.push({
    id,
    name: displayName || id,
    contextWindow: parseInt(ctxRaw || "2000000", 10) || 2000000,
    maxTokens: parseInt(maxRaw || "1000000000", 10) || 1000000000,
    reasoning: reasoningPick === "Yes",
    input: ["text"],
  });
  commit(pi, providers);
  ui.notify(`Added model: ${id}`, "info");

  const setDefault = await ui.select("Set as default model?", ["Yes", "No"]);
  if (setDefault === "Yes") setDefaultModel(providers, provider, id);
}

// --- D. edit model + E. remove model --------------------------------------

export async function modelEditFlow(
  ui: ExtensionContext["ui"],
  pi: ExtensionAPI,
  pick: string,
  model: ProviderModel,
  provider: ProviderEntry,
  providers: Providers,
): Promise<"back" | "continue"> {
  const editChoices = ["Edit", "Remove", "Set as default", "< Back"];
  const action = await ui.select(`${pick}:`, editChoices);
  if (!action || action === "< Back") return "back";

  if (action === "Edit") {
    const displayName = ((await ui.input("Display name:", model.name)) ?? "").trim();
    const ctxRaw = ((await ui.input("Context window:", String(model.contextWindow))) ?? "").trim();
    const maxRaw = ((await ui.input("Max output tokens:", String(model.maxTokens))) ?? "").trim();
    const reasoningPick = await ui.select("Supports reasoning?", ["Yes", "No"]);
    model.name = displayName || pick;
    model.contextWindow = parseInt(ctxRaw, 10) || model.contextWindow;
    model.maxTokens = parseInt(maxRaw, 10) || model.maxTokens;
    model.reasoning = reasoningPick === "Yes";
    commit(pi, providers);
    ui.notify(`Updated: ${pick}`, "info");
  } else if (action === "Remove") {
    provider.models = provider.models.filter((m) => m.id !== pick);
    commit(pi, providers);
    ui.notify(`Removed: ${pick}`, "info");
  } else if (action === "Set as default") {
    setDefaultModel(providers, provider, model.id);
  }
  return "continue";
}

function setDefaultModel(
  providers: Providers,
  provider: ProviderEntry,
  modelId: string,
): void {
  const name = nameOfProvider(providers, provider);
  if (!name) return;
  const settings = loadJson(SETTINGS_FILE);
  settings.defaultProvider = name;
  settings.defaultModel = modelId;
  saveJson(SETTINGS_FILE, settings);
  invalidateProviderConfigCache();
}

// --- entry used by the wizard: run providers submenu -----------------------

/**
 * Run the providers submenu (add / edit / remove). Returns when the user
 * picks "< Back to roles". Reads + mutates the on-disk models.json, applying
 * each change to the live session via pi.registerProvider().
 */
export async function providersMenu(
  ui: ExtensionContext["ui"],
  pi: ExtensionAPI,
): Promise<void> {
  ensureAuthKeysEscaped();
  for (;;) {
    const providers = loadProviders();
    const names = Object.keys(providers);
    const choices = [
      "+ Add new provider",
      ...names.map((n) => `Edit: ${n}`),
      "< Back to roles",
    ];
    const pick = await ui.select("Providers:", choices);
    if (!pick || pick === "< Back to roles") return;
    if (pick === "+ Add new provider") {
      await addProviderFlow(ui, pi, providers);
    } else {
      const name = pick.replace(/^Edit: /, "");
      await editProviderFlow(ui, pi, name, providers);
    }
  }
}

/** Expose the config snapshot for the wizard's status line. */
export function providerSnapshot(): {
  providerCount: number;
  modelCount: number;
  defaultProvider?: string;
  defaultModel?: string;
} {
  const cfg = loadPiSetupConfig();
  const providerCount = Object.keys(cfg.providers ?? {}).length;
  let modelCount = 0;
  for (const pv of Object.values(cfg.providers ?? {})) {
    modelCount += pv?.models?.length ?? 0;
  }
  return {
    providerCount,
    modelCount,
    defaultProvider: cfg.settings?.defaultProvider,
    defaultModel: cfg.settings?.defaultModel,
  };
}
