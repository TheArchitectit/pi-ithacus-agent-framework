/**
 * ithacus-version.ts — own version reader + update detection.
 *
 * Extracted from ithacus-menu.ts so every surface (menu overlay, TUI widget,
 * on-load update notice) reads ONE version source. Mirrors pi-mega-compact's
 * mega-runtime/helpers.ts ownVersion().
 *
 * PREVENT-ITH-004: zero network. All reads are local fs (this package's own
 * package.json + a marker file under ~/.pi/agent/ithacus/).
 *
 * "Know you updated" without a network call: on load we compare the package's
 * version against the version recorded the last time the extension loaded
 * (marker file). Different → print "[ithacus] updated: vX.Y.Z → vA.B.C" once
 * and rewrite the marker. End users who ran `pi install npm:ithacus` see the
 * bump immediately on next pi start, and the version is permanently visible
 * in the above-editor widget (ithacus-widget.ts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Cached npm version, read once from this extension's own package.json. */
let cachedVersion: string | null = null;

/** Read this extension's own version from its package.json (uncached). */
function readOwnVersion(): string {
  // Source layout: <repo>/extensions/ithacus-version.ts → <repo>/package.json.
  // Compiled/npm layout: <pkg>/dist/extensions/ithacus-version.js → <pkg>/package.json.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const cand of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
    try {
      const pkg = JSON.parse(readFileSync(cand, "utf-8"));
      if (pkg.version) return String(pkg.version);
    } catch { /* try next candidate */ }
  }
  return "?";
}

/** This extension's own version (cached after first read). */
export function ownVersion(): string {
  if (cachedVersion === null) cachedVersion = readOwnVersion();
  return cachedVersion;
}

/** Global marker dir (NOT per-repo) — version bumps are extension-global. */
function markerDir(): string {
  return join(homedir(), ".pi", "agent", "ithacus");
}

function markerFile(): string {
  return join(markerDir(), "last-version.txt");
}

/**
 * Print a one-line update notice iff the extension version changed since the
 * last load (marker file). Safe to call on every load — prints only on real
 * bumps. console.log (not TUI) like maybeShowOnLoadNotice, pre-TUI so it
 * never corrupts an interactive session.
 *
 * @returns the marker text if an update was detected (for tests), else null.
 */
export function maybeShowVersionBump(): string | null {
  const current = ownVersion();
  if (current === "?") return null; // unresolved package.json — stay silent
  try {
    const file = markerFile();
    const previous = existsSync(file) ? readFileSync(file, "utf-8").trim() : null;
    if (previous === current) return null; // no change
    mkdirSync(markerDir(), { recursive: true });
    writeFileSync(file, current + "\n");
    if (!previous) return null; // first ever load — no "updated" claim
    const notice = `\n[ithacus] updated: v${previous} → v${current} (visible in the widget bar / /ithacus-menu)\n`;
    console.log(notice);
    return notice;
  } catch {
    return null; // marker dir unwritable — never block extension load
  }
}
