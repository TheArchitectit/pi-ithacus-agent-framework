/**
 * mega-bridge-loader.ts — lazy, non-fatal loader for the pi-mega-compact
 * bridge (src/mega-bridge-contract.ts mirrors mega's `MegaBridge`).
 *
 * Two responsibilities:
 *  (a) `loadMegaBridge` — dynamic-imports pi-mega-compact's published bridge
 *      subpath (`dist/src/bridge.js`) and constructs a `MegaBridgeContract`.
 *      NEVER throws: any failure (flag OFF, package absent, import/construct
 *      error) yields `null` and ixthacus stays fully standalone.
 *  (b) `resolveMegaChildExtensionPath` — resolves the absolute path to
 *      mega-compact's child extension (mega-compact-child.ts/.js), mirroring
 *      ithacus-spawn.ts's `resolveChildMailboxPath` flavor-preference logic.
 *
 * The dynamic import is a LOCAL npm package reference (no network), so it does
 * NOT trip PREVENT-ITH-004 / PREVENT-PI-004. Tier-L local exception — same
 * class as the `git rev-parse` + local `pi` subprocess spawns elsewhere.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import { resolveRepoRoot, type IthacusConfig } from "./config.js";
import type { MegaBridgeContract } from "./mega-bridge-contract.js";

/** Global fallback when cwd is not inside a git repo. */
const MEGA_STATE_DIR_FALLBACK = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-mega-compact",
);

// ---------------------------------------------------------------------------
// (a) Bridge loader — lazy, non-fatal
// ---------------------------------------------------------------------------

/**
 * Compute the mega-compact stateDir for the current repo: `<repo>/.pi/mega-compact`.
 * ithacus's `repoStateDir` hardcodes "ithacus"; mega owns its own sibling
 * folder, so we resolve the repo root here and join `.pi/mega-compact`.
 * Falls back to the global extension-default dir outside git.
 */
function megaStateDir(cwd: string | undefined): string {
  if (cwd) {
    const root = resolveRepoRoot(cwd);
    if (root) return join(root, ".pi", "mega-compact");
  }
  return MEGA_STATE_DIR_FALLBACK;
}

/** Construct options for mega's `createMegaBridge` — only `stateDir` is required. */
type CreateMegaBridgeModule = {
  createMegaBridge(opts: { stateDir: string }): MegaBridgeContract;
};

/**
 * Load the mega-compact bridge, or `null` if it is unavailable.
 *
 * Layer (a) flag gate: `ITHACUS_MEGA_BRIDGE=false` → null (standalone).
 * Layers (b)+(c): the dynamic import + construction are wrapped so ANY failure
 * (missing package, unresolvable specifier, constructor throw) returns null and
 * NEVER propagates. ithacus must remain byte-identical to pre-bridge when mega
 * is absent.
 */
export async function loadMegaBridge(
  config: IthacusConfig,
  cwd: string | undefined = process.cwd(),
): Promise<MegaBridgeContract | null> {
  // Layer (a): flag gate.
  if (!config.megaBridge) return null;
  try {
    // Dynamic import (NOT static): tsc cannot resolve the uninstalled package
    // at type-check time, and we must not add a runtime dependency. The module
    // is cast to the local contract shape. The ambient declaration in
    // mega-bridge-ambient.d.ts gives the specifier a minimal type so tsc
    // compiles whether or not the package is installed; the cast to
    // CreateMegaBridgeModule is the real type boundary (conformance test
    // verifies the live module matches MegaBridgeContract).
    const mod = (await import(
      "pi-mega-compact/dist/src/bridge.js",
    )) as unknown as CreateMegaBridgeModule;
    const stateDir = megaStateDir(cwd);
    return mod.createMegaBridge({ stateDir });
  } catch {
    // (b)+(c): import failure / absent package / construction throw → standalone.
    return null;
  }
}

// ---------------------------------------------------------------------------
// (b) Child-extension path resolver — mirror resolveChildMailboxPath
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to pi-mega-compact's child extension
 * (`extensions/mega-compact-child.{ts,js}`).
 *
 * Mirrors `resolveChildMailboxPath` in ithacus-spawn.ts: prefer the variant
 * matching this module's own flavor (running stripped `.ts` from source vs.
 * compiled `.js` from dist), then fall back to the other. Returns null when
 * neither exists so the caller can degrade instead of crashing pi.
 *
 * `extensionDir`/`preferTs` are injectable for unit tests.
 */
export function resolveMegaChildExtensionPath(
  extensionDir: string,
  preferTs: boolean,
): string | null {
  const stems = preferTs
    ? ["mega-compact-child.ts", "mega-compact-child.js"]
    : ["mega-compact-child.js", "mega-compact-child.ts"];
  for (const stem of stems) {
    const candidate = join(extensionDir, stem);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the mega-compact child extension to an absolute path that exists on
 * disk, or null. Locates the installed package via `import.meta.resolve`
 * (wrapped in try/catch for older Node lacking it), then searches the
 * subdirectories where the child extension actually ships:
 *   1. `dist/extensions/` — the compiled `.js` (npm-installed; what pi loads).
 *   2. `extensions/` — the source `.ts` (shipped in npm + dev repo).
 *   3. package root — legacy fallback (no subdirectory).
 * The previous version checked ONLY the package root, where the child extension
 * is absent in the npm layout (it ships under dist/extensions/), so resolution
 * returned null and ithacus silently skipped the second `-e` (the 4th-layer
 * path-resolution guard degraded) — children never loaded mega-compact's child
 * extension. Found in C2-cont (2026-08-13): the dispatched writer/verification
 * children had no ITHACUS_MEGA_SESSION_ID events and no child conversation in
 * turns.db. Mirrors the dist/src layout gotcha (the bridge itself loads from
 * dist/src/bridge.js, not the package root).
 */
export function resolveMegaChildExtensionPathDefault(): string | null {
  let pkgDir: string | undefined;
  try {
    // Local package resolution only — no network.
    const pkgJson = import.meta.resolve("pi-mega-compact/package.json");
    pkgDir = fileURLToPath(new URL(".", pkgJson));
  } catch {
    return null;
  }
  if (!pkgDir) return null;
  // Search the subdirectories where the child extension actually ships, in
  // preference order: compiled dist .js (npm) → source .ts (npm/dev) → root.
  for (const sub of ["dist/extensions", "extensions", "."]) {
    const found = resolveMegaChildExtensionPath(join(pkgDir, sub), false);
    if (found) return found;
  }
  return null;
}
