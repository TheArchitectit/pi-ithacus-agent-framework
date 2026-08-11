/**
 * types-sprint-3.2.ts — Sprint 3.2 feature types (split from types.ts to keep
 * that file under 300-line guidance; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 */

// Sprint 5.15: AgentDefinition carries an optional permission declaration.
// Import from ./types.js (NOT ./permissions.js) — types.ts is the single
// import site for the permission types; this edge is type-only (erased at
// strip, no runtime cycle).
import type { AgentPermissions } from './types.js';

/** An agent action recorded to the activity feed. */
export interface ActivityEvent {
  id: string;
  runId: string;
  agentId: string;
  /** action verb: spawned | tool_call | tool_result | completed | failed | ... */
  action: string;
  /** free-form metadata (JSON-serializable). */
  metadata: Record<string, unknown>;
  ts: number;
}

/** User-defined agent configuration (from .pi/ithacus/agents/*.md or *.yaml). */
export interface AgentDefinition {
  id: string;
  /** display name. */
  name: string;
  /** role label. */
  role: string;
  /** model override (optional, falls through to team resolution). */
  model?: string;
  /** system prompt / instructions body. */
  systemPrompt: string;
  /** precedence layer. */
  layer: 'builtin' | 'user' | 'project';
  /** source file path. */
  sourcePath: string;
  /** allowed tools (empty = all). */
  tools: string[];
  /** trigger keywords to auto-select this agent. */
  triggers: string[];
  /** Sprint 5.15: optional permission-mode declaration parsed from
   *  `permission:`/`allow:`/`deny:` frontmatter (optional; the dispatch path
   *  parses AgentConfig directly — definitions.ts discovery may surface this
   *  for audit). */
  permissions?: AgentPermissions;
}

/** User-defined team configuration. */
export interface TeamDefinition {
  id: string;
  name: string;
  /** agent role assignments. */
  agents: Array<{ role: string; agentId?: string }>;
  /** default workflow id. */
  workflow: string;
  layer: 'builtin' | 'user' | 'project';
  sourcePath: string;
}

/** A single metric data point. */
export interface MetricPoint {
  /** metric name (e.g. 'ithacus_tasks_completed_total'). */
  name: string;
  /** counter | gauge | histogram. */
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  /** label key-value pairs. */
  labels: Record<string, string>;
  ts: number;
  /** for histograms: bucket upper bounds (le). */
  buckets?: number[];
}

/** A plugin hook point in the agent lifecycle. */
export type PluginHook =
  | 'preSpawn'
  | 'postSpawn'
  | 'preToolCall'
  | 'postToolCall'
  | 'preCompact'
  | 'postCompact'
  | 'onTurnEnd';

/** A plugin that hooks into agent lifecycle events. */
export interface Plugin {
  id: string;
  name: string;
  /** hooks the plugin subscribes to. */
  hooks: PluginHook[];
  /** context-injection callback (returns text to prepend to agent context). */
  injectContext?: (ctx: { agentId: string; runId: string; hook: PluginHook }) => string;
}
