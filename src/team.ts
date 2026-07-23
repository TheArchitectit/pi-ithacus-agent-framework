/**
 * team.ts — team orchestration model for ithacus.
 *
 * Translates PR #3250's TeamCreate into pi-native sub-agent plans:
 *   - mode presets (tiny..mega) → N role assignments
 *   - resolve_agent_model chain: explicit → subagentModel → provider model → default
 *   - qualify_for_provider(): prefix bare names with `custom/` for custom-openai
 *   - caller model is PRIMARY; fallbackModels appended + deduped (precedence fix)
 *
 * pi-agnostic: takes a resolved `ResolvedModel` and produces a plan; the actual
 * pi `Agent` dispatch happens in extensions/ithacus-team.ts.
 */

import { MODE_PRESETS, type ModePreset } from "./config.js";
import type { AgentRole, IthAgent, IthRun, IthTask, WorkflowNode } from "./types.js";
import { generateWaves, validateDag } from "./workflow.js";

export interface ResolvedModel {
  id: string;
  provider: string | null;
  /** The session's configured sub-agent model (from /setup or equivalent). */
  subagentModel?: string | null;
  /** The active provider's default model. */
  providerModel?: string | null;
}

export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5-20251001";

/**
 * PR #3250 resolve_agent_model chain. Caller's explicit model wins; fall back
 * through subagentModel → provider model → constant default.
 */
export function resolveAgentModel(
  explicit: string | null | undefined,
  resolved: ResolvedModel,
): string {
  return (
    explicit ||
    resolved.subagentModel ||
    resolved.providerModel ||
    DEFAULT_AGENT_MODEL
  );
}

/**
 * PR #3250 qualify_for_provider(): bare model names get a `custom/` prefix when
 * the active provider is custom-openai, so sub-agents route through the same
 * endpoint as the parent session.
 */
export function qualifyForProvider(model: string, provider: string | null): string {
  if (provider === "custom-openai" && !model.includes("/")) {
    return `custom/${model}`;
  }
  return model;
}

/**
 * Build the full fallback-ordered model list for a spawn: caller model FIRST,
 * then the configured fallbackModels, all deduped (PR #3250 precedence fix —
 * providerFallbacks.primary is recovery, never a silent replacement).
 */
export function buildModelChain(
  explicit: string | null | undefined,
  resolved: ResolvedModel,
  fallbackModels: string[],
): string[] {
  const primary = resolveAgentModel(explicit, resolved);
  const qualified = qualifyForProvider(primary, resolved.provider);
  const chain = [qualified, ...fallbackModels.map((m) => qualifyForProvider(m, resolved.provider))];
  return [...new Set(chain)];
}

export interface TeamPlan {
  run: IthRun;
  agents: IthAgent[];
  /** tasks derived from a workflow DAG, when one was supplied. */
  tasks?: IthTask[];
}

/**
 * Create a team plan from a mode preset. Distributes roles across the preset's
 * agent count (roles wrap if there are more agents than roles). Each agent gets
 * the resolved (and provider-qualified) model.
 */
/**
 * Build IthTask rows from a workflow DAG: validates the graph, computes
 * execution waves, and assigns each task its `wave` and inherited `phase`.
 */
function tasksFromWorkflow(runId: string, workflow: WorkflowNode[]): IthTask[] {
  validateDag(workflow);
  const { waves } = generateWaves(workflow);
  const waveOf = new Map<string, number>();
  waves.forEach((wave, idx) => {
    for (const id of wave) waveOf.set(id, idx);
  });
  return workflow.map((node) => ({
    id: node.id,
    runId,
    title: node.taskTitle,
    ownerClaim: null,
    status: "open" as const,
    dependsOn: node.dependsOn,
    wave: waveOf.get(node.id) ?? null,
    phase: node.role ?? null,
  }));
}

export function planRun(opts: {
  runId: string;
  mode: ModePreset;
  prompt: string;
  resolved: ResolvedModel;
  fallbackModels: string[];
  now: number;
  /** optional workflow DAG — when supplied, plan.tasks is populated with
   *  dependency/wave-annotated IthTask rows. */
  workflow?: WorkflowNode[];
}): TeamPlan {
  const preset = MODE_PRESETS[opts.mode];
  const model = resolveAgentModel(null, opts.resolved);
  const qualified = qualifyForProvider(model, opts.resolved.provider);
  const agents: IthAgent[] = [];
  for (let i = 0; i < preset.agents; i++) {
    const role = preset.roles[i % preset.roles.length] as AgentRole;
    agents.push({
      id: `${opts.runId}-a${i}`,
      runId: opts.runId,
      role,
      model: qualified,
      provider: opts.resolved.provider,
      status: "spawning",
      lastSeen: opts.now,
    });
  }
  return {
    run: {
      runId: opts.runId,
      modePreset: opts.mode,
      createdAt: opts.now,
      summary: opts.prompt.slice(0, 200),
      status: "active",
    },
    agents,
    ...(opts.workflow ? { tasks: tasksFromWorkflow(opts.runId, opts.workflow) } : {}),
  };
}
