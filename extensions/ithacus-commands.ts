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
import type { ModePreset, ResolvedModel } from "../../src/team.js";

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

  // Expose deleteTeam for programmatic use.
  (runtime as any).deleteTeam = (runId: string) => deleteTeam(runtime, runId);
  (runtime as any).teamStatus = (runId: string) => teamStatus(runtime, runId);
}
