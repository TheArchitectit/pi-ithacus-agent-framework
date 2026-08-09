/**
 * ithacus-onboarding.ts — first-use + on-load notices.
 *
 * Three trigger points (all chosen by the user):
 *   1. ON LOAD — if no providers are configured in pi-setup's models.json,
 *      print a welcome pointing to /setup and /ithacus-setup. Mirrors
 *      pi-setup's own first-run hint (console.log on load, before the TUI is
 *      active, so it never corrupts an interactive session).
 *   2. FIRST DISPATCH — a one-shot, per-repo notice shown the first time the
 *      user dispatches an ithacus sub-agent in a repo. Persisted in the ith_kv
 *      store table (markOnboardingSeen). Tells the user sub-agents use default
 *      models and how to bind per-role models + providers.
 *   3. FAST-FAIL — enriched hint when dispatch can't resolve a provider for a
 *      model (lives in provider-resolver.ts's UNRESOLVED_HINT; this module
 *      just ships the shared banner text).
 *
 * PREVENT-ITH-004: no network. loadPiSetupConfig() reads local pi config
 * files; runtime.store is local sqlite. Mirrors pi-setup + ithacus-agents.
 */

import { loadPiSetupConfig } from "./ithacus-provider-config.js";
import type { IthRuntime } from "./ithacus-runtime.js";

/** Shared, concise one-line first-use banner. */
export const FIRST_USE_BANNER =
  "[ithacus] Sub-agents are using their default models. " +
  "Run /ithacus-setup to bind models + providers per role, or /setup to configure providers.";

/** Welcome shown on load when NO providers are configured at all. */
export const ONLOAD_NO_PROVIDERS =
  "\n[ithacus] No providers configured. " +
  "Run /setup (pi-setup) to add one, then /ithacus-setup to bind models to sub-agent roles.\n";

/**
 * On-load notice: print a welcome if pi-setup has zero providers configured.
 * Safe to call from the extension entry on every load — only prints when
 * unconfigured. Mirrors pi-setup's first-run hint exactly (console.log).
 */
export function maybeShowOnLoadNotice(): void {
  const cfg = loadPiSetupConfig();
  const providerCount = Object.keys(cfg.providers ?? {}).length;
  if (providerCount === 0) {
    console.log(ONLOAD_NO_PROVIDERS);
  }
}

/**
 * First-dispatch notice: one-shot, per-repo. Marks the onboarding flag in the
 * store; prints the banner this one time. Silent on every dispatch afterward.
 *
 * @returns true if the notice was shown (first dispatch in this repo).
 */
export function maybeShowFirstDispatchNotice(runtime: IthRuntime): boolean {
  let firstUse = false;
  try {
    firstUse = runtime.store.markOnboardingSeen();
  } catch {
    /* store unavailable — never block the dispatch */
  }
  if (firstUse) {
    console.log("\n" + FIRST_USE_BANNER + "\n");
  }
  return firstUse;
}
