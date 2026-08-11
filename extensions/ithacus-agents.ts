/**
 * ithacus-agents.ts — markdown agent discovery for ithacus.
 *
 * Loads ithacus's role roster from `extensions/agents/*.md` (bundled) with
 * optional project overrides from `<repo>/.pi/ithacus/agents/*.md`. Mirrors the
 * `AgentConfig` shape + frontmatter convention used by pi's example subagent
 * extension (`examples/extensions/subagent/agents.ts`) so ithacus's agents are
 * interoperable with the same markdown schema, but ithacus loads its OWN
 * bundled roster itself (it does not rely on pi's `discoverAgents()` reading
 * `~/.pi/agent/agents/`, because ithacus ships its agents inside the package).
 *
 * Frontmatter schema (simple `key: value`, one per line — no nested YAML):
 *   ---
 *   name: explore
 *   description: Fast read-only codebase recon ...
 *   tools: read, grep, find, ls, bash
 *   model: claude-haiku-4-5
 *   provider: plexus            # optional; pins the provider for this agent
 *   ---
 *   <body = system prompt>
 *
 * The roster is NOT fixed (Sprint 5.12.5). The legacy core roles
 * (src/types.ts AgentRole) match bundled defs by name — Explore → explore.md,
 * Plan → plan.md, Verification → verification.md, Reviewer → reviewer.md —
 * and any additional bundled def (e.g. writer.md), project <name>.md, or
 * <name>.local.md is discovered the same way. setup/dispatch consume this
 * list dynamically; team composition slots stay legacy until Sprint 5.21.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest, sha256 } from "../src/agent-bundles.js";

export type AgentSource = "bundled" | "project";

export interface AgentConfig {
  name: string;
  description: string;
  /** Tool allowlist (frontmatter `tools:` comma-separated). */
  tools?: string[];
  /** Per-agent default model (frontmatter `model:`). */
  model?: string;
  /** Per-agent provider pin (frontmatter `provider:`). Optional; when set, the child pi subprocess is spawned with `--provider <name>`. */
  provider?: string;
  /** Markdown body = the agent's system prompt. */
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

/**
 * Bundled agents directory. Resolves robustly across layouts:
 *   - source / smoke:   <dir>/ithacus-agents.{ts,js} → <dir>/agents/ (sibling)
 *   - compiled/published: dist/extensions/ithacus-agents.js → ../../extensions/agents/
 *     (package-root; the tarball ships agents at extensions/agents/, NOT in dist/)
 * Tries each candidate; returns the first that exists. Falls back to the
 * source-layout candidate if none exist (discoverIthacusAgents returns [] for
 * a missing dir, so the error path stays recognizable).
 *
 * Exported (Sprint 5.12.5): the activation hook injects this into
 * seedBundledAgents() and tests inject overrides.
 */
export function bundledAgentsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "agents"),                              // source/smoke: sibling
    path.resolve(here, "..", "..", "extensions", "agents"),     // compiled: package root
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Project override dir: <repo>/.pi/ithacus/agents/.
 * Exported (Sprint 5.12.5): the activation hook injects this into
 * seedBundledAgents() and tests inject overrides.
 */
export function projectAgentsDir(): string {
  return path.resolve(process.cwd(), ".pi", "ithacus", "agents");
}

/** Minimal YAML frontmatter parser (key: value, one per line). */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: fm, body: content.trim() };
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fm[key] = value;
  }
  return { frontmatter: fm, body: match[2].trim() };
}

function loadAgentsFromDir(dir: string, source: AgentSource, suffix?: ".local"): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    // Sprint 5.12.5: `.local.md` is the always-user tier — loaded only via the
    // suffix filter; the default load excludes it (and dotfiles like the
    // bundle-manifest are filtered by the .md check anyway).
    const isLocal = entry.name.endsWith(".local.md");
    if (suffix === ".local" ? !isLocal : isLocal || entry.name.startsWith(".")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(content);
    const name = frontmatter.name;
    if (!name) continue;
    const toolsRaw = frontmatter.tools;
    agents.push({
      name,
      description: frontmatter.description ?? "",
      tools: toolsRaw ? toolsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      model: frontmatter.model || undefined,
      provider: frontmatter.provider || undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

export interface DiscoverOptions {
  /** Override the package bundled dir (tests). Defaults to bundledAgentsDir(). */
  bundledDir?: string;
  /** Override the project agents dir (tests). Defaults to projectAgentsDir(). */
  projectDir?: string;
}

/**
 * Discover ithacus agents with manifest-aware per-name resolution
 * (Sprint 5.12.5, docs/DESIGN_AGENT_BUNDLES.md §7):
 *
 *   user-owned repo <name>.md  >  <name>.local.md  >  untouched seeded copy  >  package bundled
 *
 * "Untouched seeded" is proven by sha256(file) === .bundle-manifest.json hash;
 * "user-owned" = no manifest entry, hash mismatch, or an untrusted/missing
 * manifest (ownership is never guessed). Reading the manifest is read-only —
 * discovery never writes to the project agents dir.
 */
export function discoverIthacusAgents(opts?: DiscoverOptions): AgentConfig[] {
  const bundleDir = opts?.bundledDir ?? bundledAgentsDir();
  const projectDir = opts?.projectDir ?? projectAgentsDir();
  const bundled = loadAgentsFromDir(bundleDir, "bundled");
  const repoDefs = loadAgentsFromDir(projectDir, "project");
  const localDefs = loadAgentsFromDir(projectDir, "project", ".local");
  if (repoDefs.length === 0 && localDefs.length === 0) return bundled;

  const manifest = readManifest(projectDir);

  const byName = new Map<string, AgentConfig>();
  for (const a of bundled) byName.set(a.name, a);

  // Repo <name>.md always outranks the packaged fallback; classify it as
  // user-owned (beats <name>.local.md) or untouched-seeded (loses to it).
  const userOwned = new Set<string>();
  for (const a of repoDefs) {
    byName.set(a.name, a);
    let content: Buffer | null = null;
    try {
      content = fs.readFileSync(a.filePath);
    } catch {
      content = null; // unreadable → conservatively user-owned
    }
    const recorded = manifest?.agents[path.basename(a.filePath)];
    const untouched =
      typeof recorded === "string" &&
      recorded.length > 0 &&
      content !== null &&
      sha256(content) === recorded;
    if (!untouched) userOwned.add(a.name);
  }

  // <name>.local.md beats the bundled fallback and an untouched seeded copy,
  // but never a user-owned repo <name>.md.
  for (const a of localDefs) {
    if (userOwned.has(a.name)) continue;
    byName.set(a.name, a);
  }
  return [...byName.values()];
}

/** Case-insensitive agent lookup by name or ithacus AgentRole. */
export function findAgent(
  agents: AgentConfig[],
  name: string,
): AgentConfig | undefined {
  const lower = name.toLowerCase();
  return agents.find((a) => a.name.toLowerCase() === lower);
}
