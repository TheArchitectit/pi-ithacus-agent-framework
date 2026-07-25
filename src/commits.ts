/**
 * commits.ts — analyze a working-tree diff and split unrelated changes into
 * atomic commits with dependency ordering. Source files rank above tests/docs.
 *
 * pi-agnostic.
 */

import type { AtomicCommit } from './types.js';

export type FileCategory = 'source' | 'test' | 'docs' | 'config' | 'other';

/** Classify a file path by category (affects commit ordering). */
export function classifyFile(filePath: string): FileCategory {
  const p = filePath.toLowerCase();
  if (p.endsWith('.test.ts') || p.endsWith('.spec.ts') || p.endsWith('.test.js') || p.includes('/test/') || p.includes('/tests/')) return 'test';
  if (p.endsWith('.md') || p.endsWith('.txt')) return 'docs';
  if (p.endsWith('.json') || p.endsWith('.yml') || p.endsWith('.yaml') || p.endsWith('.toml') || p.endsWith('.config.js') || p.endsWith('.config.ts') || p === 'package.json' || p === 'tsconfig.json') return 'config';
  if (p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.tsx') || p.endsWith('.jsx') || p.endsWith('.py') || p.endsWith('.go') || p.endsWith('.rs')) return 'source';
  return 'other';
}

/** Score a file for commit-ordering priority. Source > config > tests > docs > other. */
export function fileScore(filePath: string): number {
  const rank: Record<FileCategory, number> = { source: 5, config: 4, test: 3, docs: 2, other: 1 };
  return rank[classifyFile(filePath)];
}

/** A changed file in the working tree. */
export interface ChangedFile {
  path: string;
  /** '+added' | '~modified' | '-deleted' */
  status: 'added' | 'modified' | 'deleted';
  /** number of lines changed (for grouping heuristics). */
  linesChanged: number;
}

/**
 * Group changed files into atomic commits by directory + category proximity.
 * Files in the same directory + same category go together; cross-cutting
 * changes split into separate commits.
 */
export function splitAtomicCommits(files: ChangedFile[]): AtomicCommit[] {
  if (files.length === 0) return [];
  const groups = new Map<string, ChangedFile[]>();
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '<root>';
    const cat = classifyFile(f.path);
    const key = `${dir}|${cat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  // Convert groups to AtomicCommit, then order by file score + dependencies.
  const commits: AtomicCommit[] = [];
  let idx = 0;
  for (const [, group] of groups) {
    const cat = classifyFile(group[0].path);
    commits.push({
      id: `commit-${++idx}`,
      message: buildCommitMessage(group, cat),
      files: group.map(f => f.path).sort(),
      order: idx,
      dependsOn: [],
    });
  }
  // Resolve dependency ordering: source before tests (tests depend on source).
  return orderCommits(commits);
}

/** Build a conventional commit message for a group. */
export function buildCommitMessage(group: ChangedFile[], cat: FileCategory): string {
  const scope = group[0]?.path.includes('/') ? group[0].path.slice(0, group[0].path.lastIndexOf('/')) : 'root';
  const verb = group.some(f => f.status === 'added') ? 'add' : group.some(f => f.status === 'deleted') ? 'remove' : 'update';
  const typeLabel = cat === 'test' ? 'test' : cat === 'docs' ? 'docs' : cat === 'config' ? 'chore' : 'feat';
  const fileCount = group.length;
  return `${typeLabel}(${scope}): ${verb} ${fileCount} ${cat} file(s)`;
}

/**
 * Order commits by dependency: source/config first, then tests (depend on
 * source), then docs. Same-category commits keep insertion order.
 */
export function orderCommits(commits: AtomicCommit[]): AtomicCommit[] {
  // Compute each commit's max file score.
  const scored = commits.map(c => ({ c, score: Math.max(...c.files.map(fileScore)) }));
  // Sort: higher score first (source before tests before docs).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.c.order - b.c.order; // stable
  });
  // Assign order + dependency edges: each commit depends on the prior source-config commit.
  const ordered: AtomicCommit[] = [];
  let lastSourceIdx = -1;
  scored.forEach((entry, i) => {
    const isImplementation = entry.score >= 4; // source or config
    const dependsOn = lastSourceIdx >= 0 && !isImplementation ? [ordered[lastSourceIdx].id] : [];
    const commit: AtomicCommit = { ...entry.c, order: i + 1, dependsOn };
    ordered.push(commit);
    if (isImplementation) lastSourceIdx = i;
  });
  return ordered;
}

/**
 * Analyze a list of changed files and return the ordered atomic commits.
 * Convenience entry point combining split + order.
 */
export function analyzeWorkingTree(files: ChangedFile[]): AtomicCommit[] {
  return splitAtomicCommits(files);
}
