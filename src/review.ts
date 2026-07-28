/**
 * review.ts — code-review scoring: P0-P3 priority + confidence per finding,
 * aggregated into a ReviewVerdict. Pure heuristics, zero network.
 *
 * pi-agnostic.
 */

import type { ReviewFinding, ReviewVerdict, Priority } from './types.js';
import { priorityRank, isBlockerPriority } from './advisor.js';

/** Heuristic severity weights for common code-review issue patterns. */
const ISSUE_PATTERNS: Array<{ re: RegExp; priority: Priority; confidence: number; message: string }> = [
  { re: /\b(sql\s*injection|insecure|vulnerabilit)\b/i, priority: 'P0', confidence: 85, message: 'Potential security vulnerability.' },
  { re: /\b(password|secret|api[_-]?key|token)\s*[:=]/i, priority: 'P0', confidence: 80, message: 'Hardcoded secret/credential.' },
  { re: /\beval\s*\(|exec\s*\(/i, priority: 'P1', confidence: 75, message: 'Use of eval/exec is dangerous.' },
  { re: /\b(TODO|FIXME|XXX)\b/, priority: 'P2', confidence: 70, message: 'Unresolved TODO/FIXME marker.' },
  { re: /\bany\b/, priority: 'P2', confidence: 60, message: 'Use of `any` bypasses type safety.' },
  { re: /\bconsole\.(log|debug)\b/, priority: 'P3', confidence: 55, message: 'Debug log left in code.' },
  { re: /\b(hardcod|magic\s+number)\b/i, priority: 'P3', confidence: 50, message: 'Hardcoded value; consider a named constant.' },
];

/**
 * Score a single file's content for issues. Returns findings with file/line.
 */
export function scoreFile(filePath: string, content: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pat of ISSUE_PATTERNS) {
      if (pat.re.test(lines[i])) {
        findings.push({
          filePath,
          line: i + 1,
          priority: pat.priority,
          confidence: pat.confidence,
          message: pat.message,
        });
      }
    }
  }
  return findings;
}

/**
 * Aggregate findings into a ReviewVerdict. topPriority = worst finding;
 * confidence = weighted by finding count; approved iff no P0/P1 blockers.
 */
export function buildVerdict(findings: ReviewFinding[]): ReviewVerdict {
  if (findings.length === 0) {
    return {
      topPriority: 'P3',
      confidence: 90,
      approved: true,
      findings: [],
      summary: 'No issues found. Approved.',
    };
  }
  // Find the highest-severity finding (lowest rank number = worst). Compare
  // against worst.priority, not worst itself: without an initial accumulator,
  // reduce treats the first element as the accumulator, so a naive
  // priorityRank(worst) would receive a ReviewFinding object instead of its
  // priority string and always return undefined — masking a P0 behind a P3.
  const top = findings.reduce((worst, f) =>
    priorityRank(f.priority) < priorityRank(worst.priority) ? f : worst,
  );
  // Confidence: average of finding confidences, scaled down with more findings.
  const avgConf = Math.round(findings.reduce((s, f) => s + f.confidence, 0) / findings.length);
  const confidence = Math.max(0, avgConf - Math.min(findings.length * 3, 30));
  const hasBlockers = findings.some(f => isBlockerPriority(f.priority));
  const approved = !hasBlockers;
  const summary = approved
    ? `Approved with ${findings.length} non-blocking finding(s). Top: ${top.priority}.`
    : `Blocked: ${findings.filter(f => isBlockerPriority(f.priority)).length} blocker(s) (top ${top.priority}).`;
  return { topPriority: top.priority, confidence, approved, findings, summary };
}

/** Confidence score for a finding (0-100). */
export function findingConfidence(f: Pick<ReviewFinding, 'confidence'>): number {
  return Math.max(0, Math.min(100, Math.round(f.confidence)));
}
