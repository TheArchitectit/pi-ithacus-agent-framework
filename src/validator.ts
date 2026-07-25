/**
 * validator.ts — Reverse Prompt Validation (RPV).
 *
 * Rules-based prompt scoring across 4 dimensions (clarity, specificity,
 * scope, safety), producing a ValidationReport with a profile + team-size
 * recommendation. Zero network — pure heuristic analysis.
 *
 * pi-agnostic.
 */

import type { ScoredDimension, ValidationReport, ProfileTier } from './types.js';

export const SAFETY_THRESHOLD = 30;
export const OVERALL_THRESHOLD = 40;

/** Destructive/dangerous terms that lower the safety score. */
const DANGER_TERMS = [
  'rm -rf', 'drop table', 'drop database', 'truncate', 'delete from',
  'force push', '--force', 'sudo ', 'chmod 777', 'mkfs', 'dd if=',
  'shutdown', 'reboot', 'kill -9', 'eval(', 'exec(', 'format c:',
];

/** Imperative action verbs that signal a clear directive. */
const CLARITY_VERBS = [
  'implement', 'create', 'add', 'fix', 'refactor', 'review', 'audit',
  'analyze', 'explore', 'find', 'update', 'remove', 'test', 'build',
  'design', 'plan', 'check', 'verify', 'write', 'generate', 'optimize',
];

function scoreClarity(prompt: string): ScoredDimension {
  const words = prompt.split(/\s+/).filter(Boolean);
  const lower = prompt.toLowerCase();
  let score = 20;
  const hasVerb = CLARITY_VERBS.some(v => lower.includes(v));
  if (hasVerb) score += 25;
  // Questions reduce clarity slightly (indicates uncertainty).
  const qCount = (prompt.match(/\?/g) ?? []).length;
  score -= Math.min(qCount * 5, 15);
  // Reasonable length.
  if (words.length >= 5) score += 20;
  if (words.length >= 15) score += 15;
  score = clamp(score);
  const feedback = score >= 60 ? 'Clear directive with actionable verb.'
    : score >= 40 ? 'Somewhat clear but could be more direct.'
    : 'Vague — add an imperative verb and concrete goal.';
  return { name: 'clarity', score, feedback };
}

function scoreSpecificity(prompt: string): ScoredDimension {
  // Look for concrete references: file paths, code terms, quoted strings.
  const paths = (prompt.match(/(\/\w+)+\.\w+/g) ?? []).length;
  const quotes = (prompt.match(/["'`][^"'`]+["'`]/g) ?? []).length;
  const codeTerms = (prompt.match(/\b[A-Z][a-zA-Z]+\.\w+\b/g) ?? []).length;
  const nums = (prompt.match(/\b\d+\b/g) ?? []).length;
  // NOTE(Sprint 1.4): base 20 (not 25) — a prompt with zero concrete references
  // should not start above the midline; keeps the vague-floor below the overall
  // threshold so under-specified prompts reliably fail (RPV acceptance).
  let score = 20;
  score += Math.min(paths * 10, 20);
  score += Math.min(quotes * 8, 16);
  score += Math.min(codeTerms * 8, 16);
  score += Math.min(nums * 5, 15);
  score = clamp(score);
  const feedback = score >= 60 ? 'Specific — references files, code, or numbers.'
    : score >= 40 ? 'Moderately specific. Add file paths or code references.'
    : 'Too vague — cite specific files, symbols, or numbers.';
  return { name: 'specificity', score, feedback };
}

function scoreScope(prompt: string): ScoredDimension {
  const words = prompt.split(/\s+/).filter(Boolean);
  let score = 30;
  // Too short = under-specified task.
  if (words.length < 3) score = 15;
  else if (words.length < 8) score += 10;
  else if (words.length <= 50) score += 30;       // sweet spot
  else if (words.length <= 100) score += 15;
  else score -= 10;                                 // too broad
  // Multiple sentences with connectors suggest multi-step scope.
  const sentences = prompt.split(/[.!?]+/).filter(s => s.trim()).length;
  if (sentences >= 2 && sentences <= 5) score += 15;
  score = clamp(score);
  const feedback = score >= 60 ? 'Well-scoped task size.'
    : score >= 40 ? 'Acceptable scope. Refine if possible.'
    : words.length < 8 ? 'Task too short — add detail.'
    : 'Task too broad — split into smaller steps.';
  return { name: 'scope', score, feedback };
}

function scoreSafety(prompt: string): ScoredDimension {
  const lower = prompt.toLowerCase();
  const hits = DANGER_TERMS.filter(t => lower.includes(t));
  // NOTE(Sprint 1.4): per-hit penalty 40 (not 35). With 35, two danger terms
  // land exactly at 30 == SAFETY_THRESHOLD, which fails the hard-block
  // (score < threshold) acceptance assertion. 40 keeps a single mild hit
  // passing while two explicit destructive ops hard-block as intended.
  let score = 100 - Math.min(hits.length * 40, 100);
  score = clamp(score);
  const blocked = score < SAFETY_THRESHOLD;
  const feedback = blocked
    ? `SAFETY HARD-BLOCK: detected dangerous term(s): ${hits.join(', ')}`
    : hits.length > 0
      ? `Caution: risky term(s) detected: ${hits.join(', ')}`
      : 'No dangerous operations detected.';
  return { name: 'safety', score, feedback };
}

/** Recommend a profile tier based on prompt content. */
export function recommendProfile(prompt: string): ProfileTier {
  const lower = prompt.toLowerCase();
  if (/\b(review|audit|security|vulnerabilit)\b/.test(lower)) return 'quality';
  if (/\b(plan|design|architect|analyz|strateg)\b/.test(lower)) return 'reasoning';
  if (/\b(implement|refactor|code|fix|writ|generat|build)\b/.test(lower)) return 'code';
  if (/\b(scan|quick|explore|find|list|summari)\b/.test(lower)) return 'speed';
  return 'speed';
}

/** Recommend team size (1-6) based on prompt complexity. */
export function recommendTeamSize(prompt: string): number {
  const words = prompt.split(/\s+/).filter(Boolean).length;
  const sentences = prompt.split(/[.!?]+/).filter(s => s.trim()).length;
  const hasMultiple = /\b(and|then|also|next|after)\b/i.test(prompt);
  let size = 2;
  if (words > 20 || sentences >= 3) size = 3;
  if (words > 40 || (sentences >= 4 && hasMultiple)) size = 4;
  if (words > 70 && hasMultiple) size = 5;
  if (words > 100 && sentences >= 5) size = 6;
  return Math.min(Math.max(size, 1), 6);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Validate a prompt across 4 dimensions. Produces a full report with
 * profile + team-size recommendations. Safety < 30 hard-blocks execution.
 */
export function validatePrompt(
  prompt: string,
  opts?: { overallThreshold?: number; safetyThreshold?: number },
): ValidationReport {
  const overallThreshold = opts?.overallThreshold ?? OVERALL_THRESHOLD;
  const safetyThreshold = opts?.safetyThreshold ?? SAFETY_THRESHOLD;
  const dimensions: ScoredDimension[] = [
    scoreClarity(prompt),
    scoreSpecificity(prompt),
    scoreScope(prompt),
    scoreSafety(prompt),
  ];
  const overallScore = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const safety = dimensions.find(d => d.name === 'safety')!;
  const safetyBlocked = safety.score < safetyThreshold;
  const passed = overallScore >= overallThreshold && !safetyBlocked;
  const recommendedProfile = recommendProfile(prompt);
  const recommendedTeamSize = recommendTeamSize(prompt);
  const summary = safetyBlocked
    ? `BLOCKED: safety score ${safety.score} < ${safetyThreshold}. ${safety.feedback}`
    : passed
      ? `Valid (overall ${overallScore}). Recommend ${recommendedProfile} profile, ${recommendedTeamSize} agents.`
      : `Needs improvement (overall ${overallScore} < ${overallThreshold}). Review dimension feedback.`;
  return {
    prompt,
    dimensions,
    overallScore,
    passed,
    safetyBlocked,
    recommendedProfile,
    recommendedTeamSize,
    summary,
  };
}
