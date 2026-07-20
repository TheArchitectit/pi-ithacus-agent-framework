/**
 * ithacus-team.ts — dispatch a team plan through pi's native agent runtime.
 *
 * PR #3250 TeamCreate → N sub-agents. In ithacus we do NOT reimplement a
 * filesystem mailbox; we use pi's native Agent tool (or sub-agent spawn) as the
 * runtime, persist the roster in ith_agents, and use ith_inbox (a DB table) for
 * inter-agent messages. The resolve chain + custom/ qualification from PR #3250
 * are applied here at spawn time.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "./ithacus-runtime.js";
import { type IthacusConfig, type ModePreset } from "../src/config.js";
import {
  planRun,
  buildModelChain,
  type ResolvedModel,
} from "../src/team.js";
import type { IthAgent } from "../src/types.js";

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
  pi: ExtensionAPI;
  runtime: IthRuntime;
  config: IthacusConfig;
  ctx: ExtensionContext;
  mode: ModePreset;
  prompt: string;
  resolved: ResolvedModel;
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

  // Persist run + roster.
  opts.runtime.store.createRun(plan.run);
  for (const a of plan.agents) opts.runtime.store.upsertAgent(a);
  opts.runtime.appendEvent("team_create", {
    runId,
    mode: opts.mode,
    agents: plan.agents.length,
  });

  // Dispatch each sub-agent via pi's native Agent tool, with the resolved
  // (provider-qualified, fallback-ordered) model chain applied.
  const chain = buildModelChain(null, opts.resolved, opts.config.fallbackModels);
  for (const a of plan.agents) {
    const subPrompt = `[ithacus ${a.role}] ${opts.prompt}\nYour role: ${a.role}. Model chain: ${chain.join(", ")}.`;
    try {
      // PR #3250: inject provider env before building the sub-agent runtime so
      // custom-openai (set up via /setup) reaches the child. We rely on pi's
      // Agent tool honoring ctx provider config; the chain is passed as guidance.
      await opts.pi.callTool?.("Agent", {
        description: `ithacus-${a.role}`,
        prompt: subPrompt,
        subagent_type: "general-purpose",
        model: a.model,
      });
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
