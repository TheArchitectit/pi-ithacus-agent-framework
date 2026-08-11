/**
 * agent-bundles.ts — pi-agnostic npm-shipped agent bundle seeding.
 *
 * Sprint 5.12.5 (docs/DESIGN_AGENT_BUNDLES.md): the package ships bundled
 * role defs under extensions/agents/<name>.md; on activation they are copied
 * into the target repo's .pi/ithacus/agents/ — version-gated, hash-checked,
 * user-edit safe:
 *
 *   - First activation copies MISSING files only. A pre-existing <name>.md
 *     with no trustworthy manifest hash is conservatively user-owned and is
 *     preserved.
 *   - An upgrade overwrites ONLY files whose current sha256 equals the seeded
 *     hash recorded in .bundle-manifest.json (the user never touched it).
 *   - A modified file is never removed or overwritten; its manifest entry
 *     keeps the PRIOR seeded hash (never replaced with the user's content).
 *   - A downgrade (stamp > packageVersion) preserves the stamp and all files;
 *     only missing-agent adoption may run.
 *   - An unreadable/malformed manifest is untrusted: existing files are
 *     preserved, only missing files are seeded, the error is reported, and
 *     ownership is never inferred without a recorded hash.
 *
 * State files in .pi/ithacus/agents/:
 *   .bundle-version        — the package version that last seeded (one line)
 *   .bundle-manifest.json  — { seededBy, agents: { "<name>.md": "<sha256>" } }
 *
 * All writes are temp-file + rename in the same directory, so an interrupted
 * activation cannot leave partial JSON or half-written defs.
 *
 * Node built-ins only (node:fs / node:path / node:crypto), zero pi imports —
 * fully unit-testable with node --test.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// SYNC: keep token-for-token identical to AGENT_TOOL_ALLOWLIST in
// scripts/regression_check.py (spec §9.1 sync contract — adding a bundled
// agent tool means editing BOTH lists).
export const AGENT_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
  "ithacus-mailbox",
  "ithacus-dispatch",
  "subagent_supervisor",
  "intercom",
]);

export const BUNDLE_VERSION_FILE = ".bundle-version";
export const BUNDLE_MANIFEST_FILE = ".bundle-manifest.json";

export interface AgentBundleManifest {
  seededBy: string;
  agents: Record<string, string>;
}

export interface SeedResult {
  seeded: string[];
  upgraded: string[];
  skippedModified: string[];
  errors: string[];
}

export interface SeedOptions {
  bundledDir: string;
  projectAgentsDir: string;
  packageVersion: string;
}

/** sha256 hex digest over the exact content bytes. */
export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function semverNums(v: string): [number, number, number] {
  const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * -1/0/1 comparing the leading major.minor.patch of two versions.
 * Pre-release/build suffixes are ignored (they do not move the seed gate).
 */
export function semverCompare(a: string, b: string): number {
  const an = semverNums(a);
  const bn = semverNums(b);
  for (let i = 0; i < 3; i++) {
    if (an[i] !== bn[i]) return an[i] < bn[i] ? -1 : 1;
  }
  return 0;
}

/** Minimal `key: value` frontmatter parser (one pair per line, no nesting). */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const frontmatter: Record<string, string> = {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter, body: content.trim() };
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

const REQUIRED_AGENT_KEYS: readonly string[] = ["name", "description", "tools", "model"];

/**
 * Validate one bundled agent def. Returns human-readable error strings;
 * empty list means valid. Mirrors the Python check in
 * scripts/regression_check.py validate_agent_bundles (same rejections).
 */
export function validateAgentFile(content: string, filename: string): string[] {
  const errors: string[] = [];
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    errors.push(`${filename}: missing or unterminated frontmatter (expected leading --- ... ---)`);
    return errors;
  }
  const frontmatter: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx < 0) {
      errors.push(`${filename}: malformed frontmatter line ${i + 2} (expected 'key: value')`);
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }
  for (const key of REQUIRED_AGENT_KEYS) {
    if (!(key in frontmatter)) {
      errors.push(`${filename}: missing required frontmatter key '${key}'`);
    } else if (!frontmatter[key]) {
      errors.push(`${filename}: frontmatter key '${key}' has an empty value`);
    }
  }
  if (errors.length > 0) return errors;
  const stem = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  if (frontmatter.name !== stem) {
    errors.push(`${filename}: name '${frontmatter.name}' does not match filename stem '${stem}'`);
  }
  const tools = frontmatter.tools.split(",").map((t) => t.trim()).filter(Boolean);
  if (tools.length === 0) {
    errors.push(`${filename}: tools list is empty`);
  }
  const unknown = tools.filter((t) => !AGENT_TOOL_ALLOWLIST.has(t));
  if (unknown.length > 0) {
    errors.push(
      `${filename}: unknown tool(s): ${unknown.join(", ")} ` +
        `(allowlist: ${[...AGENT_TOOL_ALLOWLIST].join(", ")})`,
    );
  }
  return errors;
}

function isErrno(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ManifestRead =
  | { manifest: AgentBundleManifest | null; error: null }
  | { manifest: null; error: string };

function readManifestDetailed(dir: string): ManifestRead {
  const p = join(dir, BUNDLE_MANIFEST_FILE);
  let raw: string;
  try {
    raw = readFileSync(p, "utf-8");
  } catch (e) {
    // A missing manifest is the normal first-activation state, not an error.
    if (isErrno(e, "ENOENT")) return { manifest: null, error: null };
    return { manifest: null, error: manifestUntrustedError(`unreadable (${errText(e)})`) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { manifest: null, error: manifestUntrustedError(`malformed JSON (${errText(e)})`) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { manifest: null, error: manifestUntrustedError("unexpected shape (not an object)") };
  }
  const rec = parsed as { seededBy?: unknown; agents?: unknown };
  const agentsRaw = rec.agents;
  if (agentsRaw === null || typeof agentsRaw !== "object" || Array.isArray(agentsRaw)) {
    return { manifest: null, error: manifestUntrustedError("unexpected shape (missing agents map)") };
  }
  const agents: Record<string, string> = {};
  for (const [k, v] of Object.entries(agentsRaw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) agents[k] = v;
  }
  const seededBy = typeof rec.seededBy === "string" ? rec.seededBy : "";
  return { manifest: { seededBy, agents }, error: null };
}

function manifestUntrustedError(reason: string): string {
  return (
    `${BUNDLE_MANIFEST_FILE}: ${reason}; treating as untrusted — ` +
    `existing files preserved, only missing files will be seeded`
  );
}

/**
 * Read the bundle seed manifest from dir. Returns null when absent or not
 * trustworthy (untrusted = never infer ownership without a recorded hash).
 */
export function readManifest(dir: string): AgentBundleManifest | null {
  return readManifestDetailed(dir).manifest;
}

/** Temp-file + rename within the same directory (never a partial target). */
function atomicWriteFile(targetPath: string, content: string | Buffer): void {
  const tmp = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, targetPath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* temp may never have been created — best effort cleanup */
    }
    throw e;
  }
}

/**
 * Seed bundled agent defs into the project's .pi/ithacus/agents/ dir.
 * Implements the §5.2 algorithm: version-gated, hash-verified, user-edit
 * safe. Best-effort per-file — expected fs failures land in `errors`.
 */
export function seedBundledAgents(options: SeedOptions): SeedResult {
  const result: SeedResult = { seeded: [], upgraded: [], skippedModified: [], errors: [] };
  const { bundledDir, projectAgentsDir, packageVersion } = options;
  const versionPath = join(projectAgentsDir, BUNDLE_VERSION_FILE);

  // Version stamp. Missing = first activation (not an error).
  let stamp: string | null = null;
  try {
    stamp = readFileSync(versionPath, "utf-8").trim() || null;
  } catch (e) {
    if (!isErrno(e, "ENOENT")) {
      result.errors.push(`${BUNDLE_VERSION_FILE}: unreadable (${errText(e)})`);
    }
  }

  const { manifest, error: manifestError } = readManifestDetailed(projectAgentsDir);
  if (manifestError !== null) result.errors.push(manifestError);
  const priorAgents = manifest !== null ? manifest.agents : {};

  const upgrade = stamp !== null && semverCompare(packageVersion, stamp) > 0;

  try {
    mkdirSync(projectAgentsDir, { recursive: true });
  } catch (e) {
    result.errors.push(`cannot prepare agents dir ${projectAgentsDir}: ${errText(e)}`);
    return result; // nothing else can succeed
  }

  let files: string[];
  try {
    files = readdirSync(bundledDir, { withFileTypes: true })
      .filter(
        (d) =>
          d.isFile() &&
          d.name.endsWith(".md") &&
          !d.name.endsWith(".local.md") &&
          !d.name.startsWith("."),
      )
      .map((d) => d.name)
      .sort();
  } catch (e) {
    result.errors.push(`cannot list bundled dir ${bundledDir}: ${errText(e)}`);
    return result; // nothing to seed from
  }

  const nextAgents: Record<string, string> = { ...priorAgents };
  let changed = false; // a file was seeded or upgraded this run

  for (const file of files) {
    let bundledContent: Buffer;
    try {
      bundledContent = readFileSync(join(bundledDir, file));
    } catch (e) {
      result.errors.push(`${file}: cannot read bundled def (${errText(e)})`);
      continue;
    }
    const bundledHash = sha256(bundledContent);
    const targetPath = join(projectAgentsDir, file);

    let target: Buffer | null;
    try {
      target = readFileSync(targetPath);
    } catch (e) {
      if (isErrno(e, "ENOENT")) {
        target = null;
      } else {
        result.errors.push(`${file}: cannot read existing target (${errText(e)}); preserved`);
        continue;
      }
    }

    if (target === null) {
      // First activation or new-agent adoption: seed the missing def.
      try {
        atomicWriteFile(targetPath, bundledContent);
        nextAgents[file] = bundledHash;
        result.seeded.push(file);
        changed = true;
      } catch (e) {
        result.errors.push(`${file}: seed write failed (${errText(e)})`);
      }
      continue;
    }

    const priorHash = priorAgents[file];
    const untouched =
      typeof priorHash === "string" && priorHash.length > 0 && sha256(target) === priorHash;
    if (upgrade && manifest !== null && typeof priorHash === "string" && untouched) {
      // Untouched seeded copy under a forward upgrade: safe to replace.
      try {
        atomicWriteFile(targetPath, bundledContent);
        nextAgents[file] = bundledHash;
        result.upgraded.push(file);
        changed = true;
      } catch (e) {
        result.errors.push(`${file}: upgrade write failed (${errText(e)}); preserved`);
      }
      continue;
    }

    // Preserve. Pre-existing/user-edited file, downgrade, or untrusted
    // manifest — never removed, never overwritten, and never re-hashed into
    // the manifest (the PRIOR seeded hash, if any, stays in nextAgents).
    if (upgrade && !untouched) result.skippedModified.push(file);
  }

  // The version stamp moves forward only (first activation or upgrade); a
  // downgrade never moves it backward.
  if (stamp === null || upgrade) {
    try {
      atomicWriteFile(versionPath, packageVersion + "\n");
    } catch (e) {
      result.errors.push(`${BUNDLE_VERSION_FILE}: write failed (${errText(e)})`);
    }
  }

  if (changed || stamp === null || upgrade) {
    const manifestOut: AgentBundleManifest = {
      seededBy: stamp === null || upgrade ? packageVersion : (stamp ?? packageVersion),
      agents: nextAgents,
    };
    try {
      atomicWriteFile(
        join(projectAgentsDir, BUNDLE_MANIFEST_FILE),
        JSON.stringify(manifestOut, null, 2) + "\n",
      );
    } catch (e) {
      result.errors.push(`${BUNDLE_MANIFEST_FILE}: write failed (${errText(e)})`);
    }
  }

  return result;
}
