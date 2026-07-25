/**
 * ast.ts — structural AST rewrites (pattern matching + replacement).
 *
 * pi-agnostic: src/ does NOT bundle tree-sitter or ast-grep. This module
 * provides a working pattern-matching engine (regex-based structural
 * approximation) sufficient for src/ unit tests. The extension layer can
 * inject a real ast-grep/tree-sitter backend for language-accurate matching.
 *
 * Zero network/process/IPC (PREVENT-ITH-004 — no annotation needed).
 */

import type { AstMatch, AstRewrite, AstRewriteResult } from './types-sprint-4.4.js';

/** Injectable AST matcher backend (mock in tests, real ast-grep in extensions). */
export interface AstMatcher {
  /** Find all matches of a pattern in source. Returns matches with captures. */
  findMatches(source: string, pattern: string, language: string): AstMatch[];
}

/** A regex-based structural matcher (the src/ fallback backend). */
export class RegexAstMatcher implements AstMatcher {
  findMatches(source: string, pattern: string, _language: string): AstMatch[] {
    // Translate ast-grep-like pattern (with $$$NAME captures) to regex.
    // Strategy: replace $$$NAME with a sentinel, escape regex specials in the
    // literal text, then swap the sentinel back for a non-greedy capture group.
    const captures: string[] = [];
    const sentinel = '\u0000CAP\u0000';
    let work = pattern.replace(/\$\$\$([A-Z_]+)/g, (_, name) => {
      captures.push(name);
      return sentinel;
    });
    // Escape regex specials in the remaining literal text.
    work = work.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Re-insert capture groups (sentinel uses null bytes, never escaped).
    const regexStr = work.split(sentinel).join('([\\s\\S]*?)');

    const matches: AstMatch[] = [];
    try {
      const re = new RegExp(regexStr, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }  // avoid infinite loop on empty
        const match = m;  // capture to avoid TS18047 de-narrow
        const captureMap: Record<string, string> = {};
        captures.forEach((name, i) => { captureMap[name] = match[i + 1] ?? ''; });
        matches.push({ text: match[0], start: match.index, end: match.index + match[0].length, captures: captureMap });
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    } catch { /* invalid pattern regex — return no matches */ }
    return matches;
  }
}

/** Apply a rewrite to source. */
export function applyRewrite(source: string, rewrite: AstRewrite, matcher: AstMatcher = new RegexAstMatcher()): AstRewriteResult {
  const matches = matcher.findMatches(source, rewrite.pattern, rewrite.language);
  let result = source;
  let replacements = 0;
  // Apply from end to beginning to preserve offsets.
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const replacement = expandTemplate(rewrite.replacement, m.captures);
    result = result.slice(0, m.start) + replacement + result.slice(m.end);
    replacements++;
  }
  return { source: result, replacements, matches };
}

/** Expand a replacement template ($NAME → capture value). */
export function expandTemplate(template: string, captures: Record<string, string>): string {
  return template.replace(/\$([A-Z_]+)/g, (_, name) => captures[name] ?? '');
}

/** Find all matches of a pattern (no replacement). */
export function findMatches(source: string, pattern: string, language: string, matcher: AstMatcher = new RegexAstMatcher()): AstMatch[] {
  return matcher.findMatches(source, pattern, language);
}

/** Validate a rewrite (returns null if valid, error message otherwise). */
export function validateRewrite(rewrite: AstRewrite): string | null {
  if (!rewrite.pattern) return 'rewrite missing pattern';
  if (!rewrite.replacement) return 'rewrite missing replacement';
  if (!rewrite.language) return 'rewrite missing language';
  if (rewrite.pattern.includes('$$') && !/\$\$\$[A-Z_]+/.test(rewrite.pattern)) {
    return 'invalid capture syntax (use $$$NAME)';
  }
  return null;
}

/** Chain multiple rewrites (applied in order). */
export function chainRewrites(source: string, rewrites: AstRewrite[], matcher: AstMatcher = new RegexAstMatcher()): AstRewriteResult {
  let current = source;
  let totalReplacements = 0;
  const allMatches: AstMatch[] = [];
  for (const rewrite of rewrites) {
    const r = applyRewrite(current, rewrite, matcher);
    current = r.source;
    totalReplacements += r.replacements;
    allMatches.push(...r.matches);
  }
  return { source: current, replacements: totalReplacements, matches: allMatches };
}
