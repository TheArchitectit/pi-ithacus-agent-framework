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
import { type IthacusConfig } from "../src/config.js";
import { createTeam, deleteTeam, teamStatus } from "./ithacus-team.js";
import { resolveAgentModel, type ModePreset, type ResolvedModel } from "../src/team.js";
import { ensureProfiles, buildProfileSelectionPrompt } from "./ithacus-profiles.js";
import { validatePrompt } from "../src/validator.js";
import { runSwarm, type SwarmSpec } from "./ithacus-swarm.js";
import { SwarmStore } from "../src/store-swarm.js";
import { synthesize } from "../src/synthesis.js";
import { executePlan } from "./ithacus-plan.js";
import { discoverIthacusAgents } from "./ithacus-agents.js";
import {
  getLiveCardPreferredWidth,
  getLiveCardWidthMode,
  setLiveCardWidthMode,
  toggleLiveCardWidthMode,
  cycleLiveCardSize,
  setLiveCardSize,
  getLiveCardCurrentSize,
} from "./ithacus-live-card.js";
// Sprint 5.27 §3.2: the named size list ('small'|'medium'|'large') and its
// order come from the pi-agnostic src module (not the adapter), so the
// command's size-arg validation matches the pure width math 1:1.
import { LIVE_CARD_SIZES } from "../src/live-card-toggles.js";
// Sprint 5.28: the live-dispatch control core + registry (shared module state).
import { controlDispatch, dispatchRegistry, type ControlVerb } from "./ithacus-control.js";
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
  // Wrap pi.registerCommand: pi's contract is (name, { handler }) — an options
  // object with a void-returning handler — not a bare async fn. The helper
  // provides contextual typing so args/ctx are never implicit any, wraps
  // each handler in { handler }, and adapts the string-returning handlers to
  // pi's Promise<void> contract via a void wrapper.
  // TODO(runtime): string returns are currently DISCARDED by the wrapper —
  // wire to pi.sendMessage({customType:"ithacus-cmd-output",content,display})
  // + registerMessageRenderer so /ithacus-* output actually displays.
  const registerCmd = (
    name: string,
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<string | void>,
  ): void => {
    pi.registerCommand(name, {
      handler: async (args, ctx) => {
        await handler(args, ctx);
      },
    });
  };
  registerCmd("ithacus-team", async (args, ctx) => {
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
  registerCmd("ithacus-status", async (_args, ctx) => {
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
  registerCmd("ithacus-recall", async (args, ctx) => {
    runtime.bindRepo(ctx.cwd);
    const repoId = runtime.repoId(ctx.cwd);
    const mems = runtime.store.recall(repoId, undefined, 8);
    if (!mems.length) return "ithacus: no memories recorded for this repo.";
    return mems.map((m) => `[${m.kind}] ${m.text}`).join("\n");
  });
  // ---- /ithacus-live width ... (Sprint 5.13.1) ---------------------------
  // Toggle/configure the live-progress card's width mode:
  //   width [toggle]      → flip auto↔fixed (+ persist)
  //   width auto|fixed    → set explicitly (+ persist)
  //   width status        → report current mode + preferred width
  //   (bare /ithacus-live)→ same as "width status"
  // Persist via the repo ith_kv key "live_card_width_mode" when a runtime
  // store exists; without one the module toggle still applies (session-only).
  // NOTE: the spec's optional "clear" subcommand is intentionally NOT
  // shipped — removeLive() needs per-dispatch ids which listLive() does not
  // enumerate (AgentLive carries no id field), and ithacus-live.ts is
  // spec-locked to the listLive addition only. Deviation reported upstream.
  // ---- /ithacus-live size / hide / show (Sprint 5.27 §3.2/§3.3) --------
  //   size status            → current size (or "legacy auto" when unset)
  //   size next              → small → medium → large → small (+ persist)
  //   size small|medium|large→ set explicitly (+ persist)
  //   hide / show            → setHidden on the mounted card; hide also
  //                            persists card_hidden=true so a RESUME starts
  //                            hidden (dispatch applies setHidden on onHandle)
  // Persist via the repo ith_kv keys "card_size" / "card_hidden" when a store
  // exists; without one the module toggles still apply (session-only).
  registerCmd("ithacus-live", async (args) => {
    const parts = ((args as string)?.trim() ?? "").split(/\s+/).filter(Boolean);
    const describe = (): string =>
      `ithacus live card width: ${getLiveCardWidthMode()} (preferred ${getLiveCardPreferredWidth()})`;
    const persist = (mode: "auto" | "fixed"): void => {
      try {
        runtime?.store?.setKv("live_card_width_mode", mode);
      } catch {
        /* persist is best-effort — the module toggle already took effect */
      }
    };
    // Sprint 5.27 §3.2 helpers for the named card sizes.
    const describeSize = (): string => {
      const cur = getLiveCardCurrentSize();
      return cur
        ? `ithacus live card size: ${cur}`
        : "ithacus live card size: unset (legacy auto/fixed width)";
    };
    const persistSize = (size: "small" | "medium" | "large"): void => {
      try {
        runtime?.store?.setKv("card_size", size);
      } catch {
        /* persist is best-effort */
      }
    };
    // Sprint 5.27 §3.3 helpers: reach the currently MOUNTED card's handle (if
    // any) without forcing a new render cycle; remember the hide preference
    // so a resumed session (new overlay, new handle) starts hidden.
    const mounted = () => runtime?.liveCardHandle ?? null;
    const persistHidden = (hidden: boolean): void => {
      try {
        runtime?.store?.setKv("card_hidden", hidden ? "true" : "false");
      } catch {
        /* persist is best-effort */
      }
    };
    if (parts[0] === "width") {
      const sub = parts[1];
      if (sub === "auto" || sub === "fixed") {
        setLiveCardWidthMode(sub);
        persist(sub);
        return describe();
      }
      if (sub === "status") return describe();
      if (sub === undefined || sub === "toggle") {
        const mode = toggleLiveCardWidthMode();
        persist(mode);
        return describe();
      }
      return 'usage: /ithacus-live width [auto|fixed|toggle|status]';
    }
    // Sprint 5.27 §3.2 — named card sizes.
    if (parts[0] === "size") {
      const sub = parts[1];
      if (sub === "status") return describeSize();
      if (sub === "next") {
        const next = cycleLiveCardSize();
        persistSize(next);
        return describeSize();
      }
      if (LIVE_CARD_SIZES.includes(sub as "small")) {
        const size = sub as "small" | "medium" | "large";
        setLiveCardSize(size);
        persistSize(size);
        return describeSize();
      }
      return "usage: /ithacus-live size [small|medium|large|next|status]";
    }
    // Sprint 5.27 §3.3 — hide / show the currently mounted card.
    if (parts[0] === "hide") {
      const h = mounted();
      if (!h) return "ithacus live: no card mounted right now (start a dispatch first)";
      try { h.setHidden(true); } catch { /* best-effort */ }
      persistHidden(true);
      return "ithacus live: card hidden (resumed sessions start hidden until /ithacus-live show)";
    }
    if (parts[0] === "show") {
      const h = mounted();
      if (h) { try { h.setHidden(false); } catch { /* best-effort */ } }
      persistHidden(false);
      return "ithacus live: card shown";
    }
    return describe(); // no arg → status
  });
  registerCmd("ithacus-profiles", async (_args, ctx) => {
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
  registerCmd("ithacus-swarm", async (args, ctx) => {
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
        priority: Math.min(i, 3),  // cap at P3; earlier items run first
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
  registerCmd("ithacus-synth", async (args, ctx) => {
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
  // ---- /ithacus-plan <goal> [roles...] (Sprint 5.6) ----------------------
  //   Synthesize a plan from a goal + agent roster, dispatch via swarm, persist.
  //   usage: /ithacus-plan <goal> [agent1 agent2 ...]
  //     e.g. /ithacus-plan "investigate auth module" explore plan writer
  registerCmd('ithacus-plan', async (args, ctx) => {
    runtime.bindRepo(ctx.cwd);
    const raw = (args as string)?.trim() ?? '';
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'usage: /ithacus-plan <goal> [agent1 agent2 ...]';
    // Sprint 5.12.5 (DESIGN_AGENT_BUNDLES.md §7.1): trailing agent/role tokens
    // resolve against the DISCOVERED roster (bundled + project + .local) —
    // never a hard-coded four-role list — case-insensitively, passing the
    // canonical discovered name through. Legacy team-mode parsing
    // (tiny–mega in /ithacus-team) intentionally stays fixed until Sprint 5.21.
    const knownAgents = new Map(
      discoverIthacusAgents().map((a) => [a.name.toLowerCase(), a.name]),
    );
    const roles: string[] = [];
    const goalParts = [...parts];
    while (goalParts.length > 1) {
      const hit = knownAgents.get(goalParts[goalParts.length - 1].toLowerCase());
      if (hit === undefined) break;
      goalParts.pop();
      roles.unshift(hit);
    }
    const goal = goalParts.join(' ');
    if (!goal) return 'usage: /ithacus-plan <goal> [role1 role2 ...]';
    try {
      const resolved = captureResolved(ctx);
      const model = resolveAgentModel(null, resolved);
      const agents = roles.length > 0
        ? roles.map(r => ({ role: r }))
        : [{ role: 'Explore' }];
      const outcome = await executePlan({
        pi,
        runtime,
        goal,
        agents,
        model,
      });
      return `plan "${goal.slice(0, 50)}": ${outcome.successful}/${outcome.total} ok (storeRunId=${outcome.storeRunId}, swarm=${outcome.swarmName})`;
    } catch (e) {
      return `plan failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
  const ctrlVerbs: ControlVerb[] = ["pause", "resume", "start", "stop", "restart", "retry", "cancel", "swap_model", "swap_agent", "split_task", "add_agent"];
  registerCmd("ithacus-ctrl", async (args) => {
    const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
    const verb = parts[0] ?? "";
    if (verb === "" || verb === "help") {
      return [
        "usage: /ithacus-ctrl <verb> <dispatchId|list> [key=value ...]",
        "verbs: " + ctrlVerbs.join(" | "),
        "swap_model <id> model=<id> [provider=<p>] | swap_agent <id> agent=<name>",
        "split_task <id> task=<sub-task> agent=<name> [keepOriginal=true|false]",
        "e.g. /ithacus-ctrl list | /ithacus-ctrl pause abc-123",
      ].join("\n");
    }
    if (verb === "list") {
      const live = dispatchRegistry.list();
      if (live.length === 0) return "ithacus: 0 active dispatches (nothing to control)";
      return live
        .map((d) => `- ${d.dispatchId}  agent=${d.agent}  phase=${d.phase}  spawn#${d.spawnCount}${d.terminal ? ` →${d.terminal}` : ""}`)
        .join("\n");
    }
    if (!ctrlVerbs.includes(verb as ControlVerb)) return `unknown verb: ${verb} — try /ithacus-ctrl help`;
    const dispatchId = parts[1];
    if (!dispatchId) return `usage: /ithacus-ctrl ${verb} <dispatchId>`;
    const params: Record<string, string> = {};
    for (const tok of parts.slice(2)) {
      const eq = tok.indexOf("=");
      if (eq > 0) params[tok.slice(0, eq)] = tok.slice(eq + 1);
    }
    try {
      const action = await controlDispatch(verb as ControlVerb, dispatchId, {
        model: params.model,
        provider: params.provider,
        agent: params.agent,
        task: params.task,
        keepOriginal: params.keepOriginal !== "false",
      }, { runtime });
      const tail = action.result === "ok" && action.spawnedDispatchId ? ` → spawned ${action.spawnedDispatchId}` : (action.error ?? action.reason ? ` (${action.error ?? action.reason})` : "");
      return `ithacus ${verb} ${dispatchId}: ${action.result}${tail}`;
    } catch (e) {
      return `ithacus-ctrl ${verb} failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
}