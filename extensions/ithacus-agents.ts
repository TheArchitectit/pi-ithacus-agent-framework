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
 *   ---
 *   <body = system prompt>
 *
 * ithacus's four roles (src/types.ts AgentRole) map 1:1 to the bundled agents:
 *   Explore → explore.md · Plan → plan.md · Verification → verification.md
 *   Reviewer → reviewer.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentSource = "bundled" | "project";

export interface AgentConfig {
  name: string;
  description: string;
  /** Tool allowlist (frontmatter `tools:` comma-separated). */
  tools?: string[];
  /** Per-agent default model (frontmatter `model:`). */
  model?: string;
  /** Markdown body = the agent's system prompt. */
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

/** Bundled agents dir: extensions/agents/ (sibling of this file). */
function bundledAgentsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "agents");
}

/** Project override dir: <repo>/.pi/ithacus/agents/. */
function projectAgentsDir(): string {
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

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
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
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

/**
 * Discover ithacus agents: bundled roster (extensions/agents/*.md) overridden
 * by project drops (<repo>/.pi/ithacus/agents/*.md) on a per-name basis.
 * Project wins; bundled agents not shadowed are still available.
 */
export function discoverIthacusAgents(): AgentConfig[] {
  const bundled = loadAgentsFromDir(bundledAgentsDir(), "bundled");
  const project = loadAgentsFromDir(projectAgentsDir(), "project");
  if (project.length === 0) return bundled;
  const byName = new Map<string, AgentConfig>();
  for (const a of bundled) byName.set(a.name, a);
  for (const a of project) byName.set(a.name, a); // project overrides
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
