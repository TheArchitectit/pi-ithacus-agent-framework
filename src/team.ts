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
export type { ModePreset };
import type {
  AgentRole,
  IthAgent,
  IthRun,
  IthTask,
  PermissionMode,
  WorkflowNode,
  BackoffPolicy,
  ModelFallbackChain,
  ModelFallbackHop,
  RetryPolicy,
} from "./types.js";
import { generateWaves, validateDag } from "./workflow.js";

// ---------------------------------------------------------------------------
// Dispatch-resilience defaults + resolvers (Sprint 5.17,
// PLAN_SPRINT_5_17_AUTO_COMPACT_RETRY.md §3.4) — pure, pi-agnostic.
// ---------------------------------------------------------------------------

/** Global default retry policy (per-agent frontmatter overrides). */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 1,
  on: ["context_window", "rate_limit", "network"],
};

/** Global default backoff schedule (per-agent overrides). */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 500,
  factor: 2,
  maxMs: 30000,
  jitter: true,
};

const MAX_HOPS_CAP = 3;
const MAX_RETRIES_CAP = 3;

function clampInt(n: number | undefined, fallback: number, cap: number): number {
  if (n === undefined || n === null || !Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(cap, Math.trunc(n)));
}

/** Per-agent frontmatter retry override (clamped). Missing ⇒ base/default. */
export function resolveRetryPolicy(
  fm?: RetryPolicy | null,
  base: RetryPolicy = DEFAULT_RETRY_POLICY,
): RetryPolicy {
  if (!fm) return { ...base, backoff: base.backoff ? { ...base.backoff } : undefined };
  return {
    enabled: typeof fm.enabled === "boolean" ? fm.enabled : base.enabled,
    maxRetries: clampInt(fm.maxRetries, base.maxRetries, MAX_RETRIES_CAP),
    on: Array.isArray(fm.on) && fm.on.length > 0 ? [...fm.on] : [...base.on],
    backoff: fm.backoff ? { ...fm.backoff } : base.backoff ? { ...base.backoff } : undefined,
  };
}

/** Per-agent frontmatter backoff override (clamped). Missing ⇒ base/default. */
export function resolveBackoffPolicy(
  fm?: BackoffPolicy | null,
  base: BackoffPolicy = DEFAULT_BACKOFF,
): BackoffPolicy {
  if (!fm) return { ...base };
  return {
    baseMs: Number.isFinite(fm.baseMs) && fm.baseMs > 0 ? fm.baseMs : base.baseMs,
    factor: Number.isFinite(fm.factor) && fm.factor > 0 ? fm.factor : base.factor,
    maxMs: Number.isFinite(fm.maxMs) && fm.maxMs >= 0 ? fm.maxMs : base.maxMs,
    jitter: typeof fm.jitter === "boolean" ? fm.jitter : base.jitter,
  };
}

/**
 * Build the ordered fallback chain (#54 entry point):
 *   [ resolved primary ] ++ per-agent fallback_models ++ config fallback
 * deduped by model+provider, then clamped to [1, maxHops ∪ 3]. Reuses
 * buildModelChain's ordering; adds provider-prefix awareness and the cap.
 *
 * The primary is the caller's already-resolved model. Pass `resolved` (the
 * PR #3250 provider context) when you want resolveAgentModel to run inside;
 * otherwise pass `primaryModel`/`primaryProvider` directly (dispatch context,
 * where `params.model` is already explicit).
 */
export function resolveModelFallbackChain(opts: {
  explicit?: string | null;
  resolved?: ResolvedModel;
  primaryModel?: string;
  primaryProvider?: string;
  perAgentFallback?: string[];
  configFallback?: ModelFallbackHop[];
  maxHops?: number;
}): ModelFallbackChain {
  const primary =
    opts.primaryModel ??
    (opts.resolved ? resolveAgentModel(opts.explicit, opts.resolved) : opts.explicit ?? DEFAULT_AGENT_MODEL);
  const primaryProvider = opts.primaryProvider ?? opts.resolved?.provider ?? undefined;

  const hops: ModelFallbackHop[] = [
    { model: primary, ...(primaryProvider ? { provider: primaryProvider } : {}) },
    ...(opts.perAgentFallback ?? []).map((m) => {
      const [provider, model] = splitPrefix(m);
      return provider ? { model, provider } : { model: m };
    }),
    ...(opts.configFallback ?? []).map((h) => ({ ...h })),
  ];

  // Dedupe by model+provider (first occurrence wins).
  const seen = new Set<string>();
  const deduped: ModelFallbackHop[] = [];
  for (const h of hops) {
    const key = `${h.provider ?? h.model.split("/")[0]}::${h.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(h);
  }

  const maxHops = clampInt(opts.maxHops, 2, MAX_HOPS_CAP);
  return { hops: deduped.slice(0, maxHops), maxHops };
}

function splitPrefix(model: string): [string | undefined, string] {
  const idx = model.indexOf("/");
  if (idx > 0) return [model.slice(0, idx), model.slice(idx + 1)];
  return [undefined, model];
}


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
  /** Sprint 5.15: optional per-role permission-mode stamp for the IthAgent
   *  rows (pure plan metadata). Resolution stays at the spawn boundary
   *  (dispatch) — this only carries the intended mode per role. */
  permissionModeByRole?: Partial<Record<AgentRole, PermissionMode>>;
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
      resultSchema: null,
      resultValidated: false,
      permissionMode: opts.permissionModeByRole?.[role],
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
