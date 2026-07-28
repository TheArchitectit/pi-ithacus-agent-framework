/**
 * team-handlers.ts — slash-command entry points for team orchestration.
 *   /ithacus-team on|off|status   toggle + inspect
 *   /ithacus-status               live crew + context snapshot
 *   /ithacus-recall [query]       recall memories for this repo
 *
 * Mirrors PR #3250's `/team on|off|status` and the compressor's inspection
 * commands, expressed as pi registerCommand handlers.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "./ithacus-runtime.js";
import { type IthacusConfig, type ModePreset } from "../src/config.js";
import { createTeam, deleteTeam, teamStatus } from "./ithacus-team.js";
import { resolveAgentModel, type ResolvedModel } from "../src/team.js";
import { ensureProfiles, buildProfileSelectionPrompt } from "./ithacus-profiles.js";
import { validatePrompt } from "../src/validator.js";
import { runSwarm, type SwarmSpec } from "./ithacus-swarm.js";
import { SwarmStore } from "../src/store-swarm.js";
import { synthesize } from "../src/synthesis.js";
import { executePlan } from "./ithacus-plan.js";
import { createSpawnSubAgent } from "./ithacus-subagent.js";

function captureResolved(ctx: ExtensionCommandContext): ResolvedModel {
  const m = (ctx as any)?.model;
  return {
    id: m?.id ?? "",
    provider: m?.provider ?? null,
    subagentModel: (ctx as any)?.settings?.subagentModel ?? null,
    providerModel: (ctx as any)?.settings?.providerModel ?? null,
  };
}

export function registerTeamCommands(
  pi: ExtensionAPI,
  runtime: IthRuntime,
  config: IthacusConfig,
): void {
  let teamsEnabled = true;

  pi.registerCommand("ithacus-team", {
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const sub = args?.trim() ?? "";
      if (sub === "off") {
        teamsEnabled = false;
        ctx.ui.notify("ithacus teams: OFF", "info");
        return;
      }
      if (sub === "on") {
        teamsEnabled = true;
        ctx.ui.notify("ithacus teams: ON", "info");
        return;
      }
      if (sub === "status") {
        ctx.ui.notify(teamsEnabled ? "ithacus teams: ON" : "ithacus teams: OFF", "info");
        return;
      }
      // Default: treat the arg as "mode prompt" → create a team.
      if (!teamsEnabled) {
        ctx.ui.notify("ithacus teams are OFF. Run /ithacus-team on first.", "warning");
        return;
      }
      const [mode, ...rest] = sub.split(/\s+/);
      const preset = (["tiny", "small", "medium", "large", "xlarge", "mega"].includes(mode)
        ? mode
        : "medium") as ModePreset;
      const prompt = rest.join(" ") || "Investigate this repository and report findings.";
      // Sprint 1.4 RPV: validate before creating a team.
      const report = validatePrompt(prompt);
      if (report.safetyBlocked) {
        ctx.ui.notify(`ithacus: prompt BLOCKED by safety validation.\n${report.summary}`, "error");
        return;
      }
      const res = await createTeam({
        spawn: createSpawnSubAgent(ctx),
        runtime,
        config,
        ctx,
        mode: preset,
        prompt,
        resolved: captureResolved(ctx),
      });
      ctx.ui.notify(`ithacus team created: ${res.runId} (${res.agents.length} agents, mode=${preset})`, "info");
    },
  });

  pi.registerCommand("ithacus-status", {
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const snap = {
        pressure: runtime.pressure,
        crew: { activeAgents: runtime.activeAgents, currentTurn: runtime.currentTurn },
        context: {
          tokens: runtime.lastCtxTokens,
          percent: runtime.lastCtxPercent,
          contextWindow: runtime.lastCtxWindow,
        },
        repo: runtime.activeRepoRoot,
      };
      ctx.ui.notify(JSON.stringify(snap, null, 2), "info");
    },
  });

  pi.registerCommand("ithacus-recall", {
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const repoId = runtime.repoId(ctx.cwd);
      const mems = runtime.store.recall(repoId, undefined, 8);
      if (!mems.length) {
        ctx.ui.notify("ithacus: no memories recorded for this repo.", "info");
        return;
      }
      ctx.ui.notify(mems.map((m) => `[${m.kind}] ${m.text}`).join("\n"), "info");
    },
  });

  pi.registerCommand("ithacus-profiles", {
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const ps = ensureProfiles(runtime);
      const profiles = ps.listProfiles();
      ctx.ui.notify(buildProfileSelectionPrompt(profiles), "info");
    },
  });

  // Validation gate: wraps createTeam so /ithacus-team validates first.
  (runtime as any).validateTeamPrompt = (prompt: string) => {
    return validatePrompt(prompt);
  };

  // Expose deleteTeam for programmatic use.
  (runtime as any).deleteTeam = (runId: string) => deleteTeam(runtime, runId);
  (runtime as any).teamStatus = (runId: string) => teamStatus(runtime, runId);

  // ---- /ithacus-swarm (feat 4.24) ----------------------------------------
  //   list                  → JSON of recent swarm runs
  //   show <runId>          → JSON of one SwarmResult
  //   <name> <item> ...      → run a pipeline swarm (each item depends on prev)
  pi.registerCommand("ithacus-swarm", {
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const sStore = new SwarmStore(runtime.store.db);
      const raw = args?.trim() ?? "";
      const parts = raw.split(/\s+/).filter(Boolean);

      if (parts[0] === "list") {
        ctx.ui.notify(JSON.stringify(sStore.listSwarmRuns(20)), "info");
        return;
      }
      if (parts[0] === "show") {
        const runId = parts[1];
        if (!runId) { ctx.ui.notify("usage: /ithacus-swarm show <runId>", "warning"); return; }
        const got = sStore.getSwarmResult(runId);
        ctx.ui.notify(got ? JSON.stringify(got) : `swarm run ${runId} not found`, got ? "info" : "warning");
        return;
      }

      // Default: run a pipeline swarm. token[0]=name, token[1..]=items.
      if (parts.length < 2) {
        ctx.ui.notify("usage: /ithacus-swarm <name> <item1> <item2> ... | list | show <runId>", "warning");
        return;
      }
      const [name, ...items] = parts;
      const spec: SwarmSpec = {
        name,
        items: items.map((label, i) => ({
          name: label,
          role: "Explore",
          priority: Math.min(i, 3),  // cap at P3; earlier items run first
          dependsOn: i > 0 ? [items[i - 1]] : [],
          prompt: `Investigate ${label} and report concise findings.`,
        })),
      };
      try {
        const resolved = captureResolved(ctx);
        const model = resolveAgentModel(null, resolved);
        const outcome = await runSwarm({ spawn: createSpawnSubAgent(ctx), runtime, spec, model });
        ctx.ui.notify(`swarm ${name}: ${outcome.result.successful}/${outcome.result.total} ok (storeRunId=${outcome.storeRunId})`, "info");
      } catch (e) {
        ctx.ui.notify(`swarm ${name} failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  // ---- /ithacus-synth <runId> [method] (feat 4.24) -----------------------
  // Load a SwarmResult, take successful item outputs as contributions, synthesize.
  pi.registerCommand("ithacus-synth", {
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const raw = args?.trim() ?? "";
      const parts = raw.split(/\s+/).filter(Boolean);
      const runId = parts[0];
      if (!runId) { ctx.ui.notify("usage: /ithacus-synth <runId> [majority|weighted|first]", "warning"); return; }
      const method = (parts[1] as 'majority' | 'weighted' | 'first') ?? 'majority';
      const sStore = new SwarmStore(runtime.store.db);
      const got = sStore.getSwarmResult(runId);
      if (!got) { ctx.ui.notify(`swarm run ${runId} not found`, "warning"); return; }
      const contribs = got.results
        .filter((r) => r.success && r.output !== undefined)
        .map((r) => ({ agent: r.itemName, output: r.output }));
      if (contribs.length === 0) {
        ctx.ui.notify(`swarm run ${runId} has no successful results to synthesize`, "warning");
        return;
      }
      const synth = synthesize(contribs, method);
      ctx.ui.notify(JSON.stringify({
        output: synth.output,
        score: synth.score,
        conflicts: synth.conflicts.length,
        attribution: synth.attribution.length,
        method: synth.method,
      }), "info");
    },
  });

  // ---- /ithacus-plan <goal> [roles...] (Sprint 5.6) ----------------------
  //   Synthesize a plan from a goal + agent roster, dispatch via swarm, persist.
  //   usage: /ithacus-plan <goal> [role1 role2 ...]
  //     e.g. /ithacus-plan "investigate auth module" Explore Plan Verification
  pi.registerCommand('ithacus-plan', {
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const raw = args?.trim() ?? '';
      const parts = raw.split(/\s+/).filter(Boolean);
      if (parts.length === 0) { ctx.ui.notify('usage: /ithacus-plan <goal> [role1 role2 ...]', 'warning'); return; }

      // Heuristic: if last tokens match known roles, treat them as roles; rest is goal.
      const KNOWN_ROLES = ['Explore', 'Plan', 'Verification', 'Reviewer'];
      const roles: string[] = [];
      let goalParts = [...parts];
      while (goalParts.length > 1 && KNOWN_ROLES.includes(goalParts[goalParts.length - 1])) {
        roles.unshift(goalParts.pop()!);
      }
      const goal = goalParts.join(' ');
      if (!goal) { ctx.ui.notify('usage: /ithacus-plan <goal> [role1 role2 ...]', 'warning'); return; }

      try {
        const resolved = captureResolved(ctx);
        const model = resolveAgentModel(null, resolved);
        const agents = roles.length > 0
          ? roles.map(r => ({ role: r }))
          : [{ role: 'Explore' }];
        const outcome = await executePlan({
          spawn: createSpawnSubAgent(ctx),
          runtime,
          goal,
          agents,
          model,
        });
        ctx.ui.notify(`plan "${goal.slice(0, 50)}": ${outcome.successful}/${outcome.total} ok (storeRunId=${outcome.storeRunId}, swarm=${outcome.swarmName})`, 'info');
      } catch (e) {
        ctx.ui.notify(`plan failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    },
  });
}
