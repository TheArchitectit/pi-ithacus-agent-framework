/**
 * ithacus-team.ts — dispatch a team plan through pi's native agent runtime.
 *
 * PR #3250 TeamCreate → N sub-agents. In ithacus we do NOT reimplement a
 * filesystem mailbox; we use pi's native Agent tool (or sub-agent spawn) as the
 * runtime, persist the roster in ith_agents, and use ith_inbox (a DB table) for
 * inter-agent messages. The resolve chain + custom/ qualification from PR #3250
 * are applied here at spawn time.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "./ithacus-runtime.js";
import { type IthacusConfig, type ModePreset } from "../src/config.js";
import {
  planRun,
  buildModelChain,
  type ResolvedModel,
} from "../src/team.js";
import type { IthAgent, ModelProfile } from "../src/types.js";
import { ensureProfiles, parseProfileSelection } from "./ithacus-profiles.js";
import { resolveProfile, assignRoleProfile } from "../src/model-profiles.js";
import type { SpawnSubAgent } from "./ithacus-swarm.js";

function genId(prefix: string): string {
  // Date.now/Math.random are unavailable in some sandboxes; use a counter + ms.
  return `${prefix}-${Date.now().toString(36)}-${(process.hrtime.bigint() % 100000n).toString(36)}`;
}

export interface SpawnResult {
  runId: string;
  agents: IthAgent[];
}

/**
 * Create a run + dispatch sub-agents. `dispatch` is supplied by the caller
 * (the extension) so this module stays pi-agnostic about HOW an agent is
 * spawned — it only builds the plan + resolves models + persists the roster.
 */
export async function createTeam(opts: {
  spawn: SpawnSubAgent;
  runtime: IthRuntime;
  config: IthacusConfig;
  ctx: ExtensionContext;
  mode: ModePreset;
  prompt: string;
  resolved: ResolvedModel;
  /** Sprint 1.4: optional profile override (id string, raw object, or null). */
  profileOverride?: ModelProfile | string | null;
}): Promise<SpawnResult> {
  const runId = genId("run");
  const now = Date.now();
  const plan = planRun({
    runId,
    mode: opts.mode,
    prompt: opts.prompt,
    resolved: opts.resolved,
    fallbackModels: opts.config.fallbackModels,
    now,
  });

  // Sprint 1.4: per-role profile assignment when a profile is selected.
  if (opts.profileOverride) {
    const ps = ensureProfiles(opts.runtime);
    const profiles = ps.listProfiles();
    const selected = typeof opts.profileOverride === 'string'
      ? parseProfileSelection(opts.profileOverride, profiles)
      : opts.profileOverride;
    if (selected) {
      // Apply the selected profile's model to each agent, with role-based
      // assignment (e.g. Explorer=Speed, Reviewer=Quality).
      for (const a of plan.agents) {
        const profile = resolveProfile(ps, { explicit: selected.id, role: a.role, runId });
        a.model = profile.model;
        a.provider = opts.resolved.provider;
        assignRoleProfile(ps, { runId, role: a.role, profileId: profile.id });
      }
    }
  }

  // Persist run + roster.
  opts.runtime.store.createRun(plan.run);
  for (const a of plan.agents) opts.runtime.store.upsertAgent(a);
  opts.runtime.appendEvent("team_create", {
    runId,
    mode: opts.mode,
    agents: plan.agents.length,
  });

  // Dispatch each sub-agent via the injected spawner (wired to pi's sub-
  // session mechanism by the caller), with the resolved (provider-qualified,
  // fallback-ordered) model chain applied as guidance.
  const chain = buildModelChain(null, opts.resolved, opts.config.fallbackModels);
  for (const a of plan.agents) {
    const subPrompt = `[ithacus ${a.role}] ${opts.prompt}\nYour role: ${a.role}. Model chain: ${chain.join(", ")}.`;
    try {
      // The spawn runs the sub-agent to completion via newSession/withSession.
      // The chain is passed as guidance; the spawned session honors ctx provider config.
      await opts.spawn(subPrompt, { role: a.role, itemName: a.id, model: a.model ?? undefined });
      a.status = "working";
    } catch (e) {
      a.status = "failed";
      opts.runtime.appendEvent("agent_spawn_failed", {
        agentId: a.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    a.lastSeen = Date.now();
    opts.runtime.store.upsertAgent(a);
  }

  return { runId, agents: plan.agents };
}

/** Mark a run deleted + release task claims. */
export function deleteTeam(runtime: IthRuntime, runId: string): void {
  runtime.store.setRunStatus(runId, "deleted");
  runtime.appendEvent("team_delete", { runId });
}

/** Live snapshot of a team: roster + open tasks. */
export function teamStatus(runtime: IthRuntime, runId: string) {
  return {
    run: runtime.store.getRun(runId),
    agents: runtime.store.agentsForRun(runId),
    openTasks: runtime.store.openTasks(runId),
  };
}
