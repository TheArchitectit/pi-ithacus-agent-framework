/**
 * types-sprint-2.ts — Sprint 2.2 feature types (split from types.ts to keep
 * that file under the 300-line guidance; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 */

// ---- Stream Rules + Config formats + Skills (Sprint 2.2) ----

/** A regex-based stream rule that fires on pattern match mid-generation. */
export interface StreamRule {
  id: string;
  /** Regex source (string form) to match against the live stream text. */
  pattern: string;
  /** Flags for the regex (e.g. 'i', 'g', 'm'). */
  flags: string;
  /** Text to inject when the pattern matches. Use $& or $1 etc. for captures. */
  inject: string;
  /** Whether the rule survives context compaction (default true). */
  persistAfterCompaction: boolean;
  /** Max times the rule can fire per session (0 = unlimited). */
  maxFires: number;
  createdAt: number;
}

/** A parsed config-format rule block (agnostic to the source format). */
export interface ConfigRule {
  /** glob pattern for which files the rule applies to (or '*'). */
  applyTo: string;
  /** the rule body text. */
  body: string;
  /** source format the rule was parsed from. */
  format: ConfigFormat;
}

/** The supported external config formats. */
export type ConfigFormat =
  | 'cursor-mdc'
  | 'cline-clinerules'
  | 'codex-agents'
  | 'copilot-applyTo'
  | 'aider'
  | 'continue'
  | 'cody'
  | 'generic';

/** A discovered skill with its origin layer for precedence resolution. */
export interface SkillDefinition {
  id: string;
  /** display name. */
  name: string;
  /** absolute path to the SKILL.md file. */
  path: string;
  /** the skill body (front-matter stripped). */
  body: string;
  /** precedence layer: project > user > extension. */
  layer: 'extension' | 'user' | 'project';
  /** optional trigger keywords from the SKILL.md front-matter. */
  triggers: string[];
}