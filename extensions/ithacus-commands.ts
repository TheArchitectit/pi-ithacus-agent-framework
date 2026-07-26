/**
 * team-handlers.ts — slash-command entry points for team orchestration.
 *   /ithacus-team on|off|status   toggle + inspect
 *   /ithacus-status               live crew + context snapshot
 *   /ithacus-recall [query]       recall memories for this repo
 *
 * Mirrors PR #3250's `/team on|off|status` and the compressor's inspection
 * commands, expressed as pi registerCommand handlers.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "./ithacus-runtime.js";
import { type IthacusConfig } from "../src/config.js";
import { createTeam, deleteTeam, teamStatus } from "./ithacus-team.js";
import { resolveAgentModel, type ModePreset, type ResolvedModel } from "../src/team.js";
import { ensureProfiles, buildProfileSelectionPrompt } from "./ithacus-profiles.js";
import { validatePrompt } from "../src/validator.js";
import { runSwarm, type SwarmSpec } from "./ithacus-swarm.js";
import { SwarmStore } from "../src/store-swarm.js";
import { synthesize } from "../src/synthesis.js";

function captureResolved(ctx: any): ResolvedModel {
  const m = ctx?.model;
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

  pi.registerCommand("ithacus-team", async (args, ctx) => {
    const sub = (args as string)?.trim() ?? "";
    if (sub === "off") {
      teamsEnabled = false;
      return "ithacus teams: OFF";
    }
    if (sub === "on") {
      teamsEnabled = true;
      return "ithacus teams: ON";
    }
    if (sub === "status") {
      return teamsEnabled ? "ithacus teams: ON" : "ithacus teams: OFF";
    }
    // Default: treat the arg as "mode prompt" → create a team.
    if (!teamsEnabled) return "ithacus teams are OFF. Run /ithacus-team on first.";
    const [mode, ...rest] = sub.split(/\s+/);
    const preset = (["tiny", "small", "medium", "large", "xlarge", "mega"].includes(mode)
      ? mode
      : "medium") as ModePreset;
    const prompt = rest.join(" ") || "Investigate this repository and report findings.";
    // Sprint 1.4 RPV: validate before creating a team.
    const report = validatePrompt(prompt);
    if (report.safetyBlocked) {
      return `ithacus: prompt BLOCKED by safety validation.\n${report.summary}`;
    }
    const res = await createTeam({
      pi,
      runtime,
      config,
      ctx,
      mode: preset,
      prompt,
      resolved: captureResolved(ctx),
    });
    return `ithacus team created: ${res.runId} (${res.agents.length} agents, mode=${preset})`;
  });

  pi.registerCommand("ithacus-status", async (_args, ctx) => {
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
    return JSON.stringify(snap, null, 2);
  });

  pi.registerCommand("ithacus-recall", async (args, ctx) => {
    runtime.bindRepo(ctx.cwd);
    const repoId = runtime.repoId(ctx.cwd);
    const mems = runtime.store.recall(repoId, undefined, 8);
    if (!mems.length) return "ithacus: no memories recorded for this repo.";
    return mems.map((m) => `[${m.kind}] ${m.text}`).join("\n");
  });

  pi.registerCommand("ithacus-profiles", async (_args, ctx) => {
    runtime.bindRepo(ctx.cwd);
    const ps = ensureProfiles(runtime);
    const profiles = ps.listProfiles();
    return buildProfileSelectionPrompt(profiles);
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
  pi.registerCommand("ithacus-swarm", async (args, ctx) => {
    runtime.bindRepo(ctx.cwd);
    const sStore = new SwarmStore(runtime.store.db);
    const raw = (args as string)?.trim() ?? "";
    const parts = raw.split(/\s+/).filter(Boolean);

    if (parts[0] === "list") {
      return JSON.stringify(sStore.listSwarmRuns(20));
    }
    if (parts[0] === "show") {
      const runId = parts[1];
      if (!runId) return "usage: /ithacus-swarm show <runId>";
      const got = sStore.getSwarmResult(runId);
      return got ? JSON.stringify(got) : `swarm run ${runId} not found`;
    }

    // Default: run a pipeline swarm. token[0]=name, token[1..]=items.
    if (parts.length < 2) {
      return "usage: /ithacus-swarm <name> <item1> <item2> ... | list | show <runId>";
    }
    const [name, ...items] = parts;
    const spec: SwarmSpec = {
      name,
      items: items.map((label, i) => ({
        name: label,
        role: "Explore",
        priority: i,  // earlier items run first
        dependsOn: i > 0 ? [items[i - 1]] : [],
        prompt: `Investigate ${label} and report concise findings.`,
      })),
    };
    try {
      const resolved = captureResolved(ctx);
      const model = resolveAgentModel(null, resolved);
      const outcome = await runSwarm({ pi, runtime, spec, model });
      return `swarm ${name}: ${outcome.result.successful}/${outcome.result.total} ok (storeRunId=${outcome.storeRunId})`;
    } catch (e) {
      return `swarm ${name} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  // ---- /ithacus-synth <runId> [method] (feat 4.24) -----------------------
  // Load a SwarmResult, take successful item outputs as contributions, synthesize.
  pi.registerCommand("ithacus-synth", async (args, ctx) => {
    runtime.bindRepo(ctx.cwd);
    const raw = (args as string)?.trim() ?? "";
    const parts = raw.split(/\s+/).filter(Boolean);
    const runId = parts[0];
    if (!runId) return "usage: /ithacus-synth <runId> [majority|weighted|first]";
    const method = (parts[1] as 'majority' | 'weighted' | 'first') ?? 'majority';
    const sStore = new SwarmStore(runtime.store.db);
    const got = sStore.getSwarmResult(runId);
    if (!got) return `swarm run ${runId} not found`;
    const contribs = got.results
      .filter((r) => r.success && r.output !== undefined)
      .map((r) => ({ agent: r.itemName, output: r.output }));
    if (contribs.length === 0) return `swarm run ${runId} has no successful results to synthesize`;
    const synth = synthesize(contribs, method);
    return JSON.stringify({
      output: synth.output,
      score: synth.score,
      conflicts: synth.conflicts.length,
      attribution: synth.attribution.length,
      method: synth.method,
    });
  });
}
