/**
 * definitions.ts — user-defined agent/team configs from YAML/MD files, with
 * 3-layer discovery (builtin < user < project).
 *
 * pi-agnostic: uses only node:fs + node:path.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AgentDefinition, TeamDefinition } from './types.js';

/** Parse a YAML-like front-matter + body from markdown. */
function parseFrontMatter(content: string): { fm: Record<string, string[]>; body: string } {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!fmMatch) return { fm: {}, body: content.trim() };
  const fmText = fmMatch[1];
  const body = content.slice(fmMatch[0].length).trim();
  const fm: Record<string, string[]> = {};
  let currentKey = '';
  for (const line of fmText.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val) fm[currentKey] = [val.replace(/^["']|["']$/g, '')];
      else fm[currentKey] = [];
    } else if (currentKey && line.startsWith('  - ')) {
      fm[currentKey].push(line.slice(4).trim().replace(/^["']|["']$/g, ''));
    }
  }
  return { fm, body };
}

/** Parse a single agent definition file (.md or .yaml). */
export function parseAgentDefinition(content: string, sourcePath: string, layer: AgentDefinition['layer']): AgentDefinition | null {
  const { fm, body } = parseFrontMatter(content);
  const name = (fm.name?.[0]) || basename(sourcePath).replace(/\.(md|ya?ml)$/, '');
  const role = (fm.role?.[0]) || 'executor';
  if (!body && !fm.systemPrompt?.[0]) return null;
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    role,
    model: fm.model?.[0],
    systemPrompt: fm.systemPrompt?.join('\n') || body,
    layer,
    sourcePath,
    tools: fm.tools ?? [],
    triggers: fm.triggers ?? [],
  };
}

/** Parse a single team definition file. */
export function parseTeamDefinition(content: string, sourcePath: string, layer: TeamDefinition['layer']): TeamDefinition | null {
  const { fm, body } = parseFrontMatter(content);
  const name = (fm.name?.[0]) || basename(sourcePath).replace(/\.(md|ya?ml)$/, '');
  if (!fm.agents || fm.agents.length === 0) return null;
  const agents = fm.agents.map(a => {
    const parts = a.split(':');
    return { role: parts[0]?.trim() ?? 'executor', agentId: parts[1]?.trim() || undefined };
  });
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    agents,
    workflow: fm.workflow?.[0] || 'default',
    layer,
    sourcePath,
  };
}

export interface DefinitionDiscoveryOpts {
  builtinDir?: string;
  userDir?: string;
  projectDir?: string;
}

/** Scan a directory for agent definition files. */
function scanAgentDir(dir: string, layer: AgentDefinition['layer']): AgentDefinition[] {
  if (!dir || !existsSync(dir)) return [];
  let stats: ReturnType<typeof statSync>;
  try { stats = statSync(dir); }
  catch { return []; }
  if (!stats.isDirectory()) return [];
  const found: AgentDefinition[] = [];
  for (const entry of readdirSync(dir)) {
    if (!/\.(md|ya?ml)$/.test(entry)) continue;
    const full = join(dir, entry);
    try {
      const content = readFileSync(full, 'utf-8');
      const def = parseAgentDefinition(content, full, layer);
      if (def) found.push(def);
    } catch { /* skip unreadable */ }
  }
  return found;
}

/** Scan a directory for team definition files (teams/ subdirectory). */
function scanTeamDir(dir: string, layer: TeamDefinition['layer']): TeamDefinition[] {
  if (!dir || !existsSync(dir)) return [];
  const teamsDir = existsSync(join(dir, 'teams')) ? join(dir, 'teams') : dir;
  if (!existsSync(teamsDir)) return [];
  const found: TeamDefinition[] = [];
  for (const entry of readdirSync(teamsDir)) {
    if (!/\.(md|ya?ml)$/.test(entry)) continue;
    const full = join(teamsDir, entry);
    try {
      const content = readFileSync(full, 'utf-8');
      const def = parseTeamDefinition(content, full, layer);
      if (def) found.push(def);
    } catch { /* skip */ }
  }
  return found;
}

/** Discover agent definitions across 3 layers (builtin < user < project). */
export function discoverAgentDefinitions(opts: DefinitionDiscoveryOpts): AgentDefinition[] {
  const builtin = scanAgentDir(opts.builtinDir ?? '', 'builtin');
  const user = scanAgentDir(opts.userDir ?? '', 'user');
  const project = scanAgentDir(opts.projectDir ?? '', 'project');
  const byId = new Map<string, AgentDefinition>();
  for (const def of [...builtin, ...user, ...project]) byId.set(def.id, def);
  return [...byId.values()];
}

/** Discover team definitions across 3 layers (builtin < user < project). */
export function discoverTeamDefinitions(opts: DefinitionDiscoveryOpts): TeamDefinition[] {
  const builtin = scanTeamDir(opts.builtinDir ?? '', 'builtin');
  const user = scanTeamDir(opts.userDir ?? '', 'user');
  const project = scanTeamDir(opts.projectDir ?? '', 'project');
  const byId = new Map<string, TeamDefinition>();
  for (const def of [...builtin, ...user, ...project]) byId.set(def.id, def);
  return [...byId.values()];
}

/** Validate an agent definition: must have name + systemPrompt. */
export function validateAgentDefinition(def: AgentDefinition): string | null {
  if (!def.name) return 'agent definition missing name';
  if (!def.systemPrompt) return 'agent definition missing systemPrompt';
  return null;
}
