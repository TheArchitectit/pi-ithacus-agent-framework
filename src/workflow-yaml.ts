/**
 * workflow-yaml.ts — YAML workflow template loader + validator (feat 4.15).
 *
 * pi-agnostic: NO external YAML dependency (src/ stays zero-network + zero-
 * native-deps, PREVENT-ITH-004). Implements a minimal indentation-based YAML
 * subset sufficient for workflow templates (key: value, nested maps via indent,
 * lists via `- `, string/number/bool literals). For complex templates, callers
 * can pass a pre-parsed object to fromObject().
 */

import type { WorkflowTemplate, WorkflowStep, StepType } from './types-sprint-5.2.js';

/** Parse a minimal YAML subset into a nested object. */
export function parseMiniYaml(text: string): unknown {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  return parseBlock(lines, 0, lines.length, 0);
}

function parseBlock(lines: string[], start: number, end: number, indent: number): unknown {
  const result: Record<string, unknown> = {};
  let isList = false;
  const list: unknown[] = [];
  let i = start;
  while (i < end) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) { i++; continue; }
    const ind = leadingSpaces(raw);
    if (ind < indent) break;
    if (ind > indent) { i++; continue; }
    const content = raw.slice(indent);
    if (content.startsWith('- ')) {
      isList = true;
      const item = content.slice(2).trim();
      if (item.includes(':')) {
        const obj = parseInlineMap(item);
        const deeper = collectDeeper(lines, i + 1, end, indent + 2);
        if (deeper.lines.length) {
          const sub = parseBlock(deeper.lines, 0, deeper.lines.length, deeper.indent);
          list.push(Object.assign(obj, sub as object));
          i = deeper.next;
        } else {
          list.push(obj);
          i++;
        }
      } else {
        list.push(parseScalar(item));
        i++;
      }
    } else if (content.startsWith('-')) {
      isList = true;
      list.push(parseScalar(content.slice(1).trim()));
      i++;
    } else {
      const colon = content.indexOf(':');
      if (colon < 0) { i++; continue; }
      const key = content.slice(0, colon).trim();
      const val = content.slice(colon + 1).trim();
      if (val === '') {
        const deeper = collectDeeper(lines, i + 1, end, indent + 2);
        if (deeper.lines.length) { result[key] = parseBlock(deeper.lines, 0, deeper.lines.length, deeper.indent); i = deeper.next; }
        else { result[key] = null; i++; }
      } else {
        result[key] = parseScalar(val);
        i++;
      }
    }
  }
  return isList ? list : result;
}

function collectDeeper(lines: string[], start: number, end: number, minIndent: number): { lines: string[]; indent: number; next: number } {
  const out: string[] = [];
  let indent = -1;
  let i = start;
  while (i < end) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) { out.push(raw); i++; continue; }
    const ind = leadingSpaces(raw);
    if (ind < minIndent) break;
    if (indent < 0) indent = ind;
    out.push(raw);
    i++;
  }
  return { lines: out, indent: indent < 0 ? minIndent : indent, next: i };
}

function parseInlineMap(s: string): Record<string, unknown> {
  // A list-item inline start is a single `key: value` (value may be empty,
  // with the remaining keys on deeper indented lines). Parse the first colon
  // only; the value is the rest of the string as one scalar.
  const out: Record<string, unknown> = {};
  const c = s.indexOf(':');
  if (c < 0) return out;
  const key = s.slice(0, c).trim();
  const val = s.slice(c + 1).trim();
  out[key] = val === '' ? null : parseScalar(val);
  return out;
}

function parseScalar(s: string): unknown {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (/^['"].*['"]$/.test(t)) return t.slice(1, -1);
  return t;
}

function leadingSpaces(s: string): number {
  const m = s.match(/^( *)/);
  return m ? m[1].length : 0;
}

/** Validate + coerce a parsed object into a WorkflowTemplate. */
export function fromObject(obj: unknown): WorkflowTemplate {
  if (typeof obj !== 'object' || obj === null) throw new Error('template must be a map');
  const o = obj as Record<string, unknown>;
  if (typeof o.name !== 'string') throw new Error('template missing name');
  if (!Array.isArray(o.steps)) throw new Error('template missing steps list');
  const steps = (o.steps as unknown[]).map(parseStep);
  return {
    name: o.name,
    description: typeof o.description === 'string' ? o.description : undefined,
    steps,
    variables: o.variables && typeof o.variables === 'object' ? o.variables as Record<string, unknown> : undefined,
    metadata: o.metadata && typeof o.metadata === 'object' ? o.metadata as Record<string, unknown> : undefined,
  };
}

function parseStep(raw: unknown): WorkflowStep {
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string') throw new Error('step missing id');
  if (typeof o.name !== 'string') throw new Error(`step ${o.id} missing name`);
  const type = (o.type ?? 'task') as StepType;
  const step: WorkflowStep = { id: o.id, name: o.name, type };
  if (typeof o.role === 'string') step.role = o.role;
  if (typeof o.goal === 'string') step.goal = o.goal;
  if (typeof o.retryCount === 'number') step.retryCount = o.retryCount;
  if (typeof o.timeoutMs === 'number') step.timeoutMs = o.timeoutMs;
  if (typeof o.onError === 'string') step.onError = o.onError;
  if (typeof o.condition === 'string') step.condition = o.condition;
  if (typeof o.loopCount === 'number') step.loopCount = o.loopCount;
  if (Array.isArray(o.substeps)) step.substeps = (o.substeps as unknown[]).map(parseStep);
  if (Array.isArray(o.dependsOn)) step.dependsOn = o.dependsOn as string[];
  if (o.metadata && typeof o.metadata === 'object') step.metadata = o.metadata as Record<string, unknown>;
  return step;
}

/** Load a workflow template from a YAML string. */
export function fromYaml(yaml: string): WorkflowTemplate {
  return fromObject(parseMiniYaml(yaml));
}

/** Validate a template (returns null if valid, error message otherwise). */
export function validateTemplate(t: WorkflowTemplate): string | null {
  if (!t.name) return 'template missing name';
  if (!Array.isArray(t.steps) || t.steps.length === 0) return 'template needs at least one step';
  const ids = new Set<string>();
  const allSteps: WorkflowStep[] = [];
  const collect = (steps: WorkflowStep[]): string | null => {
    for (const s of steps) {
      if (ids.has(s.id)) return `duplicate step id: ${s.id}`;
      ids.add(s.id);
      allSteps.push(s);
      if (s.substeps) { const e = collect(s.substeps); if (e) return e; }
    }
    return null;
  };
  const dupErr = collect(t.steps);
  if (dupErr) return dupErr;
  for (const s of t.steps) {
    if (s.onError && !allSteps.find(x => x.id === s.onError)) return `onError target ${s.onError} not found for step ${s.id}`;
    if (s.dependsOn) for (const d of s.dependsOn) if (!allSteps.find(x => x.id === d)) return `dependsOn ${d} not found for step ${s.id}`;
  }
  return null;
}
