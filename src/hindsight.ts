/**
 * hindsight.ts — retain key facts from a session, recall by relevance, and
 * reflect (compress a session's messages into a mental model).
 *
 * pi-agnostic (uses HindsightStore for persistence).
 */

import type { HindsightEntry } from './types.js';
import type { HindsightStore } from './store-hindsight.js';

let entryCounter = 0;

/** A session message to reflect on. */
export interface SessionMessage {
  agentId: string;
  role: string;
  content: string;
  ts: number;
}

/**
 * Retain a key fact from a session into the hindsight store.
 * @returns the stored HindsightEntry.
 */
export function retain(
  store: HindsightStore,
  opts: { repoId: string; agentId: string; runId: string; kind: string; text: string; relevance?: number },
): HindsightEntry {
  const entry: HindsightEntry = {
    id: `hindsight-${Date.now()}-${++entryCounter}`,
    repoId: opts.repoId,
    agentId: opts.agentId,
    runId: opts.runId,
    kind: opts.kind,
    text: opts.text,
    relevance: clampRelevance(opts.relevance ?? 0.5),
    reflected: false,
    ts: Date.now(),
  };
  store.retain(entry);
  return entry;
}

/**
 * Recall hindsight entries for a repo, sorted by relevance. Optionally filter
 * by kind and minimum relevance.
 */
export function recall(
  store: HindsightStore,
  repoId: string,
  opts?: { kind?: string; limit?: number; minRelevance?: number },
): HindsightEntry[] {
  return store.recall(repoId, opts);
}

/**
 * Score the relevance of a text to a query (simple keyword overlap, 0-1).
 */
export function scoreRelevance(text: string, query: string): number {
  if (!query.trim()) return 0.5;
  const queryTerms = new Set(query.toLowerCase().split(/\W+/).filter(t => t.length > 2));
  if (queryTerms.size === 0) return 0.5;
  const textLower = text.toLowerCase();
  let hits = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) hits++;
  }
  return Math.round((hits / queryTerms.size) * 100) / 100;
}

/**
 * Reflect: compress a session's messages into a concise mental model.
 * Picks the top-K most relevant messages by relevance score and returns a
 * 1-page summary string. This is a pure read-only summary: it does NOT persist
 * or mutate any hindsight entries (use `retain` + `store.markReflected` for
 * that). `reflectedCount` is the number of entries ALREADY marked reflected
 * for this repo (i.e. the surviving mental model from prior retains).
 * @returns the summary + count of already-reflected entries for the repo.
 */
export function reflect(
  store: HindsightStore,
  messages: SessionMessage[],
  opts: { repoId: string; query?: string; maxEntries?: number },
): { summary: string; reflectedCount: number } {
  const maxEntries = opts.maxEntries ?? 10;
  const query = opts.query ?? '';
  if (messages.length === 0) {
    return { summary: 'No session messages to reflect on.', reflectedCount: 0 };
  }
  // Score each message by relevance to the query (or by content length as a tiebreaker).
  const scored = messages.map(m => ({
    m,
    score: query ? scoreRelevance(m.content, query) : Math.min(m.content.length / 500, 1),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxEntries);
  // Build the summary: one bullet per top message.
  const bullets = top.map(({ m, score }) => {
    const snippet = m.content.split('\n')[0].slice(0, 150);
    return `- [${m.role}@${m.agentId}] (rel=${(score * 100).toFixed(0)}%) ${snippet}${m.content.length > 150 ? '…' : ''}`;
  });
  const summary = `# Session Reflection (${messages.length} messages → ${top.length} retained)\n\n${bullets.join('\n')}`;
  // Note: reflect is read-only. reflectedCount reports the entries already
  // marked reflected for this repo from prior `retain`+`markReflected` calls —
  // i.e. the surviving mental model. No mutation is performed here.
  const reflected = store.reflectedEntries(opts.repoId);
  return { summary, reflectedCount: reflected.length };
}

function clampRelevance(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}
