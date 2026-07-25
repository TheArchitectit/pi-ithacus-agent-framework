/**
 * config-formats.ts — parsers for external AI-coding config formats.
 *
 * Reads Cursor MDC, Cline .clinerules, Codex AGENTS.md, Copilot applyTo,
 * Aider, Continue, Cody, and a generic fallback — all as local filesystem
 * reads (zero network, PREVENT-ITH-004). Extracted from config.ts to keep
 * that file under the 300-line limit.
 *
 * pi-agnostic: uses only node:fs + node:path.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { ConfigRule, ConfigFormat, SkillDefinition } from './types.js';

// ---- individual format parsers --------------------------------------------

/**
 * Cursor MDC format: front-matter with `applyTo:` (glob) + body.
 * The applyTo field is a glob (e.g. double-star-slash-star-dot-ts for TS).
 * Multiple front-matter blocks are supported.
 */
export function parseCursorMdc(content: string): ConfigRule[] {
  const rules: ConfigRule[] = [];
  // Find each `---\n<front-matter>\n---\n<body>` block. The body runs from
  // after the closing `---` until the next opening `---` or EOF.
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/g;
  const fms: { fm: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = fmRegex.exec(content)) !== null) {
    fms.push({ fm: m[1], start: m.index, end: m.index + m[0].length });
    if (m.index === fmRegex.lastIndex) fmRegex.lastIndex++; // avoid zero-length loop
  }
  for (let i = 0; i < fms.length; i++) {
    const applyToMatch = fms[i].fm.match(/^applyTo:\s*["']?([^"'\n]+)["']?\s*$/m);
    const applyTo = applyToMatch ? applyToMatch[1].trim() : '*';
    const bodyEnd = i + 1 < fms.length ? fms[i + 1].start : content.length;
    const body = content.slice(fms[i].end, bodyEnd).trim();
    if (body) rules.push({ applyTo, body, format: 'cursor-mdc' });
  }
  return rules;
}

/**
 * Cline .clinerules format: plain markdown rules, one per section heading.
 * Each `## heading` delimits a rule applied to files matching heading.
 */
export function parseClineRules(content: string): ConfigRule[] {
  const rules: ConfigRule[] = [];
  const sections = content.split(/^##\s+/m).filter(s => s.trim());
  for (const section of sections) {
    const nl = section.indexOf('\n');
    const heading = nl >= 0 ? section.slice(0, nl).trim() : section.trim();
    const body = nl >= 0 ? section.slice(nl + 1).trim() : '';
    // Heuristic: headings like "TypeScript files (*.ts)" → extract glob.
    const globMatch = heading.match(/\(([^)]+)\)/);
    const applyTo = globMatch ? globMatch[1].replace(/[*]/g, '*') : '*';
    if (body) rules.push({ applyTo, body, format: 'cline-clinerules' });
  }
  return rules;
}

/**
 * Codex AGENTS.md format: sections under `## ` headings, each a rule.
 * The top-level prose before any heading is a global rule (applyTo: '*').
 */
export function parseCodexAgents(content: string): ConfigRule[] {
  const rules: ConfigRule[] = [];
  const firstHeading = content.search(/^##\s/m);
  const global = firstHeading >= 0 ? content.slice(0, firstHeading).trim() : content.trim();
  if (global) rules.push({ applyTo: '*', body: global, format: 'codex-agents' });
  const after = firstHeading >= 0 ? content.slice(firstHeading) : '';
  const sections = after.split(/^##\s/m).filter(s => s.trim());
  for (const section of sections) {
    const nl = section.indexOf('\n');
    const heading = nl >= 0 ? section.slice(0, nl).trim() : section.trim();
    const body = nl >= 0 ? section.slice(nl + 1).trim() : '';
    if (body) rules.push({ applyTo: heading || '*', body, format: 'codex-agents' });
  }
  return rules;
}

/**
 * Copilot applyTo format: markdown with `applyTo: <glob>` lines preceding
 * fenced or plain rule blocks.
 */
export function parseCopilotApplyTo(content: string): ConfigRule[] {
  const rules: ConfigRule[] = [];
  const lines = content.split('\n');
  let currentApplyTo = '*';
  let currentBody: string[] = [];
  const flush = () => {
    if (currentBody.length > 0) {
      rules.push({ applyTo: currentApplyTo, body: currentBody.join('\n').trim(), format: 'copilot-applyTo' });
      currentBody = [];
    }
  };
  for (const line of lines) {
    const m = line.match(/^applyTo:\s*(.+)$/i);
    if (m) { flush(); currentApplyTo = m[1].trim(); continue; }
    currentBody.push(line);
  }
  flush();
  return rules;
}

/** Aider: CONVENTIONS.md style — plain prose, single global rule. */
export function parseAider(content: string): ConfigRule[] {
  const body = content.trim();
  return body ? [{ applyTo: '*', body, format: 'aider' }] : [];
}

/**
 * Continue: config.yaml snippets with `rules:` list. Each `- applyTo: ...`
 * list entry + body lines.
 */
export function parseContinue(content: string): ConfigRule[] {
  const rules: ConfigRule[] = [];
  const lines = content.split('\n');
  let currentApplyTo = '*';
  let currentBody: string[] = [];
  const flush = () => {
    if (currentBody.length > 0) {
      rules.push({ applyTo: currentApplyTo, body: currentBody.join('\n').trim(), format: 'continue' });
      currentBody = [];
    }
  };
  let inRules = false;
  for (const line of lines) {
    if (/^rules:\s*$/.test(line)) { inRules = true; continue; }
    if (inRules) {
      const m = line.match(/^\s*-\s*applyTo:\s*(.+)$/);
      if (m) { flush(); currentApplyTo = m[1].trim(); continue; }
      const b = line.match(/^\s*-\s*(.+)$/);
      if (b && !currentApplyTo.includes(':')) { currentBody.push(b[1]); continue; }
      if (line.trim()) currentBody.push(line.replace(/^\s+/, ''));
    }
  }
  flush();
  return rules;
}

/**
 * Cody: .cody/rules.md — sections under `## path:<glob>` headings.
 */
export function parseCody(content: string): ConfigRule[] {
  const rules: ConfigRule[] = [];
  const sections = content.split(/^##\s+/m).filter(s => s.trim());
  for (const section of sections) {
    const nl = section.indexOf('\n');
    const heading = nl >= 0 ? section.slice(0, nl).trim() : section.trim();
    const body = nl >= 0 ? section.slice(nl + 1).trim() : '';
    const pathMatch = heading.match(/^path:\s*(.+)$/i);
    const applyTo = pathMatch ? pathMatch[1].trim() : heading || '*';
    if (body) rules.push({ applyTo, body, format: 'cody' });
  }
  return rules;
}

/** Generic fallback: whole file is one global rule. */
export function parseGeneric(content: string): ConfigRule[] {
  const body = content.trim();
  return body ? [{ applyTo: '*', body, format: 'generic' }] : [];
}

// ---- dispatch ------------------------------------------------------------

export const FORMAT_PARSERS: Record<ConfigFormat, (content: string) => ConfigRule[]> = {
  'cursor-mdc': parseCursorMdc,
  'cline-clinerules': parseClineRules,
  'codex-agents': parseCodexAgents,
  'copilot-applyTo': parseCopilotApplyTo,
  'aider': parseAider,
  'continue': parseContinue,
  'cody': parseCody,
  'generic': parseGeneric,
};

/** Parse a config file's content given its declared format. */
export function parseConfigFormat(content: string, format: ConfigFormat): ConfigRule[] {
  const parser = FORMAT_PARSERS[format];
  return parser ? parser(content) : parseGeneric(content);
}

/** Load + parse a config file from disk. Returns [] if missing. */
export function loadConfigFile(filePath: string, format: ConfigFormat): ConfigRule[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseConfigFormat(content, format);
  } catch {
    return [];
  }
}

// ---- 3-layer skill discovery ---------------------------------------------

export interface SkillDiscoveryOpts {
  /** extension-layer skills dir (lowest precedence). */
  extensionDir?: string;
  /** user-layer skills dir (~/.pi/skills or similar). */
  userDir?: string;
  /** project-layer skills dir (highest precedence). */
  projectDir?: string;
}

const SKILL_FILENAME = 'SKILL.md';

/** Parse minimal YAML-like front-matter + body from a SKILL.md. */
function parseSkillMd(content: string, path: string, layer: SkillDefinition['layer']): SkillDefinition | null {
  const body = content.trim();
  if (!body) return null;
  let frontMatter = '';
  let mainBody = body;
  let triggers: string[] = [];
  const fmMatch = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fmMatch) {
    frontMatter = fmMatch[1];
    mainBody = body.slice(fmMatch[0].length).trim();
    const triggersMatch = frontMatter.match(/^triggers:\s*(.+)$/m);
    if (triggersMatch) {
      triggers = triggersMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
  }
  const nameMatch = (frontMatter.match(/^name:\s*(.+)$/m) || mainBody.match(/^#\s+(.+)$/m));
  const name = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : basename(path);
  // id = skill name if present, else parent dir basename (SKILL.md files all
  // share the same filename, so the basename alone would collide).
  const id = name || basename(dirname(path)) || path;
  return {
    id,
    name,
    path,
    body: mainBody || body,
    layer,
    triggers,
  };
}

/** Scan a single skills directory for SKILL.md files. */
function scanSkillDir(dir: string, layer: SkillDefinition['layer']): SkillDefinition[] {
  if (!dir || !existsSync(dir)) return [];
  let stats: ReturnType<typeof statSync>;
  try { stats = statSync(dir); } catch { return []; }
  if (!stats.isDirectory()) return [];
  const found: SkillDefinition[] = [];
  // Direct SKILL.md in the dir, and subdirs containing SKILL.md.
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    let s: ReturnType<typeof statSync>;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      const skillFile = join(full, SKILL_FILENAME);
      if (existsSync(skillFile)) {
        const skill = parseSkillMd(readFileSync(skillFile, 'utf-8'), skillFile, layer);
        if (skill) found.push(skill);
      }
    } else if (entry === SKILL_FILENAME) {
      const skill = parseSkillMd(readFileSync(full, 'utf-8'), full, layer);
      if (skill) found.push(skill);
    }
  }
  return found;
}

/**
 * Discover skills across 3 layers (extension < user < project). Higher layers
 * override lower ones by skill id. Returns the merged, precedence-resolved list.
 */
export function discoverSkills(opts: SkillDiscoveryOpts): SkillDefinition[] {
  const extension = scanSkillDir(opts.extensionDir ?? '', 'extension');
  const user = scanSkillDir(opts.userDir ?? '', 'user');
  const project = scanSkillDir(opts.projectDir ?? '', 'project');
  const byId = new Map<string, SkillDefinition>();
  // Lower precedence first, then overwrite with higher.
  for (const skill of [...extension, ...user, ...project]) {
    byId.set(skill.id, skill);
  }
  return [...byId.values()];
}

/** Validate a SKILL.md: must have non-empty body. Returns error string or null. */
export function validateSkillMd(content: string): string | null {
  if (!content.trim()) return 'SKILL.md is empty';
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();
  if (!body) return 'SKILL.md has front-matter but no body';
  if (body.length < 10) return 'SKILL.md body too short';
  return null;
}
