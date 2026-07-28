/**
 * advisor.ts — advisor-mode logic: note generation, budget control, and
 * inline injection scheduling. The 'second model watching turns' itself is
 * extension-layer wiring; this module holds the pure, testable policy:
 * budget enforcement, note dedup, and priority ordering.
 *
 * pi-agnostic.
 */

import type { AdvisorNote, Priority } from './types.js';

export const DEFAULT_ADVISOR_BUDGET = 10;

let noteCounter = 0;

/** Mutable per-session advisor state (budget + emitted notes). */
export class AdvisorSession {
  readonly budget: number;
  private notes: AdvisorNote[] = [];
  private seenTexts = new Set<string>();

  constructor(budget = DEFAULT_ADVISOR_BUDGET) {
    this.budget = budget;
  }

  /** Number of notes still allowed this session. */
  remaining(): number {
    return Math.max(0, this.budget - this.notes.length);
  }

  /** All notes emitted so far (priority-sorted, worst first). */
  list(): AdvisorNote[] {
    return [...this.notes].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  }

  /**
   * Produce a note from advisor output. Respects budget + dedups by text.
   * Returns the note (added) or null (budget exhausted or duplicate).
   */
  emit(opts: {
    kind: AdvisorNote['kind'];
    priority: Priority;
    confidence: number;
    text: string;
    turnIndex: number;
  }): AdvisorNote | null {
    if (this.remaining() <= 0) return null;
    const dedupKey = opts.text.trim().toLowerCase();
    if (this.seenTexts.has(dedupKey)) return null;
    const note: AdvisorNote = {
      id: `note-${++noteCounter}`,
      kind: opts.kind,
      priority: opts.priority,
      confidence: clampConfidence(opts.confidence),
      text: opts.text,
      turnIndex: opts.turnIndex,
      createdAt: Date.now(),
    };
    this.notes.push(note);
    this.seenTexts.add(dedupKey);
    return note;
  }

  /**
   * Decide which notes to inject inline at a given turn. Blockers always
   * inject first; suggestions only if budget remains.
   */
  injectionsForTurn(turnIndex: number): AdvisorNote[] {
    return this.notes
      .filter(n => n.turnIndex === turnIndex)
      .sort((a, b) => {
        // blockers/concerns before suggestions
        const kindRank: Record<AdvisorNote['kind'], number> = { blocker: 0, concern: 1, suggestion: 2 };
        if (kindRank[a.kind] !== kindRank[b.kind]) return kindRank[a.kind] - kindRank[b.kind];
        return priorityRank(a.priority) - priorityRank(b.priority);
      });
  }

  /** Reset for a new session (keeps budget). */
  clear(): void {
    this.notes = [];
    this.seenTexts.clear();
  }
}

export function createAdvisorSession(budget = DEFAULT_ADVISOR_BUDGET): AdvisorSession {
  return new AdvisorSession(budget);
}

/** Priority rank: P0=0 (worst) ... P3=3 (lowest). Lower = higher severity. */
export function priorityRank(p: Priority): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[p];
}

/** Whether a priority is a blocker (P0 or P1). */
export function isBlockerPriority(p: Priority): boolean {
  return priorityRank(p) <= 1;
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
