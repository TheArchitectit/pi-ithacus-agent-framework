/**
 * types-sprint-2.3.ts — Sprint 2.3 feature types (split from types.ts to keep
 * that file under the 300-line guidance; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 */

/** Severity/priority band for advisor notes + review findings. */
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

/** An inline note the advisor injects into the main agent's stream. */
export interface AdvisorNote {
  id: string;
  /** concern | blocker | suggestion */
  kind: 'concern' | 'blocker' | 'suggestion';
  priority: Priority;
  /** 0-100 confidence in the note. */
  confidence: number;
  text: string;
  /** turn index the note attaches to. */
  turnIndex: number;
  createdAt: number;
}

/** A code-review verdict on a change. */
export interface ReviewVerdict {
  /** max priority across findings (worst = P0). */
  topPriority: Priority;
  /** 0-100 overall confidence in the verdict. */
  confidence: number;
  /** whether the change is approved (no P0/P1 blockers). */
  approved: boolean;
  findings: ReviewFinding[];
  summary: string;
}

/** A single review finding. */
export interface ReviewFinding {
  filePath: string;
  line: number | null;
  priority: Priority;
  confidence: number;
  message: string;
}

/** A proposed atomic commit grouping related changes. */
export interface AtomicCommit {
  id: string;
  message: string;
  /** file paths included in this commit. */
  files: string[];
  /** commit index in the ordered sequence (dependency order). */
  order: number;
  /** ids of commits that must land first (dependencies). */
  dependsOn: string[];
}
