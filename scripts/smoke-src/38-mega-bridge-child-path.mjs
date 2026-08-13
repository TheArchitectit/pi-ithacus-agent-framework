// 38-mega-bridge-child-path.mjs — C2-cont fix: the mega-compact child
// extension path resolver. Verifies resolveMegaChildExtensionPathDefault()
// returns an absolute path that EXISTS on disk (the bug: it returned null
// because it checked the package root, but the child ext ships under
// dist/extensions/). Also covers the injectable resolveMegaChildExtensionPath.
//
// Regression test for the C2-cont finding (2026-08-13): ithacus's dispatched
// writer/verification children had no ITHACUS_MEGA_SESSION_ID events and no
// child conversation in turns.db because the second `-e` was silently skipped
// (path-resolution guard degraded to null).

import { check, buildDir } from "./_harness.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function run() {
  const { resolveMegaChildExtensionPath, resolveMegaChildExtensionPathDefault } =
    await import(join(buildDir, "mega-bridge-loader.ts"));

  // ── resolveMegaChildExtensionPath (injectable) ──────────────────────────
  // npm layout: the .js under dist/extensions/ — must resolve to the .js.
  const npmDir = join(process.cwd(), "node_modules", "pi-mega-compact");
  const npmChild = resolveMegaChildExtensionPath(join(npmDir, "dist/extensions"), false);
  check("resolveMegaChildExtensionPath finds the npm dist .js", npmChild !== null);
  check("resolved npm child path exists on disk", npmChild !== null && existsSync(npmChild));
  check("resolved npm child path ends with mega-compact-child.js", npmChild !== null && npmChild.endsWith("mega-compact-child.js"));

  // preferTs=true on the source dir resolves the .ts (npm ships extensions/.ts).
  const tsChild = resolveMegaChildExtensionPath(join(npmDir, "extensions"), true);
  check("resolveMegaChildExtensionPath preferTs finds the .ts", tsChild !== null);
  check("resolved .ts child path ends with mega-compact-child.ts", tsChild !== null && tsChild.endsWith("mega-compact-child.ts"));

  // ── resolveMegaChildExtensionPathDefault (the C2-cont fix) ──────────────
  // The bug: this returned null (checked only the package root, where the
  // child ext is absent in npm layout). The fix searches dist/extensions →
  // extensions → root. Must return a path that EXISTS.
  //
  // The default resolver uses import.meta.resolve("pi-mega-compact/package.json")
  // which resolves relative to the importing module. The smoke harness loads
  // rewritten source from a TEMP dir (/tmp/ithacus-src-XXX) with no node_modules
  // above it, so import.meta.resolve throws there → the source-level default
  // returns null (a harness artifact, not a fix bug). Exercise the COMPILED dist
  // version (dist/src/mega-bridge-loader.js) which runs from the repo root and
  // resolves correctly — that's the artifact pi actually loads at runtime.
  let resolved = null;
  try {
    const dist = await import(join(process.cwd(), "dist/src/mega-bridge-loader.js"));
    resolved = dist.resolveMegaChildExtensionPathDefault();
  } catch {
    // dist not built yet in this run — fall back to source (will be null in the
    // temp harness, but build is a gate prerequisite so this shouldn't happen).
    resolved = resolveMegaChildExtensionPathDefault();
  }
  check("resolveMegaChildExtensionPathDefault returns non-null (the C2-cont bug: was null)", resolved !== null);
  check("resolved default child path exists on disk", resolved !== null && existsSync(resolved));
  check("resolved default child path is absolute", resolved !== null && resolved.startsWith("/"));
  check("resolved default child path ends with mega-compact-child.js (npm dist preferred over .ts)", resolved !== null && resolved.endsWith("mega-compact-child.js"));
  // The whole point: it must point into dist/extensions, NOT the package root.
  check("resolved default child path is under dist/extensions/ (the npm layout)", resolved !== null && resolved.includes("dist/extensions"));
}
