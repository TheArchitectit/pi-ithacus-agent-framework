/**
 * types-sprint-3.1.ts — Sprint 3.1 feature types (split from types.ts to keep
 * that file under the 300-line guidance; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 */

/** Relevance score for a recalled hindsight entry (0-1). */
export type RelevanceScore = number;

/** A hindsight memory entry: key facts retained from a session with metadata. */
export interface HindsightEntry {
  id: string;
  repoId: string;
  /** The agent that produced this fact. */
  agentId: string;
  /** The run the fact came from. */
  runId: string;
  /** The memory kind (decision/fact/preference) — reused from IthMemory. */
  kind: string;
  text: string;
  /** 0-1 relevance score assigned at recall time (0 if unscored). */
  relevance: RelevanceScore;
  /** Whether this entry survived reflection compaction. */
  reflected: boolean;
  ts: number;
}

/** A single web search result from a provider. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Which provider produced this result. */
  provider: string;
  /** Relevance score from provider (0-1, or -1 if unavailable). */
  score: number;
}

/** A parsed GitHub scheme URI. */
export interface SchemeResolution {
  /** Original input string. */
  input: string;
  /** Scheme name: pr | issue | conflict. */
  scheme: 'pr' | 'issue' | 'conflict';
  /** The reference (PR number, issue number, or base...head). */
  ref: string;
  /** Human-readable kind. */
  kind: string;
  /** The command to execute (the extension layer runs it). */
  command: string;
  /** Command arguments. */
  args: string[];
  /** Human-readable description. */
  description: string;
}
