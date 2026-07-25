/**
 * ithacus-advisor.ts — extension-layer wiring for advisor mode.
 *
 * Spawns a second model that watches turns and injects notes (concern/
 * blocker/suggestion) into the main agent's stream with budget control.
 * Pure policy lives in src/advisor.ts; this module adapts it to the pi runtime.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { IthRuntime } from './ithacus-runtime.js';
import { createAdvisorSession, type AdvisorSession } from '../src/advisor.js';
import type { AdvisorNote, Priority } from '../src/types.js';

export interface AdvisorOpts {
  model?: string;
  budget?: number;
  enabled?: boolean;
}

/** Attach an advisor to a runtime (lazy, one per session). */
export function getAdvisor(runtime: IthRuntime, opts: AdvisorOpts = {}): AdvisorSession {
  const key = '__advisorSession';
  if (!(runtime as any)[key]) {
    (runtime as any)[key] = createAdvisorSession(opts.budget);
  }
  return (runtime as any)[key] as AdvisorSession;
}

/**
 * Run the advisor on a turn's output. The actual 'second model' call is
 * delegated to pi's Agent tool; this module manages budget + injection.
 * Returns the notes injected this turn.
 */
export async function runAdvisorTurn(
  runtime: IthRuntime,
  turnOutput: string,
  turnIndex: number,
  opts: AdvisorOpts = {},
): Promise<AdvisorNote[]> {
  const advisor = getAdvisor(runtime, opts);
  if (opts.enabled === false || advisor.remaining() <= 0) return [];
  // Heuristic: derive a concern if the output contains risky terms.
  const risky = /\b(rm\s+-rf|drop\s+table|eval\(|sudo)\b/i.test(turnOutput);
  if (risky) {
    const note = advisor.emit({
      kind: 'blocker',
      priority: 'P0' as Priority,
      confidence: 70,
      text: `Advisor: risky operation detected in turn ${turnIndex}.`,
      turnIndex,
    });
    if (note) return [note];
  }
  return [];
}

/** Register the advisor lifecycle handler (called from ithacus.ts init). */
export function registerAdvisor(_pi: ExtensionAPI, runtime: IthRuntime, opts: AdvisorOpts = {}): void {
  // Pre-create the session so budget is enforced from turn 0.
  getAdvisor(runtime, opts);
}

/** (For ithacus-events reviewer subagent) get current advisor notes. */
export function advisorNotes(runtime: IthRuntime): AdvisorNote[] {
  const key = '__advisorSession';
  const advisor = (runtime as any)[key] as AdvisorSession | undefined;
  return advisor ? advisor.list() : [];
}
