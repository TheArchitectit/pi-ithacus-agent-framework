/**
 * ithacus-setup.ts — the `/ithacus-setup` slash command wizard.
 *
 * Interactive binding of models + providers to every DISCOVERED ithacus
 * sub-agent — Sprint 5.12.5 (DESIGN_AGENT_BUNDLES.md §7.1): the bindable
 * roster comes from a fresh discoverIthacusAgents() snapshot (bundled +
 * project + .local), never a hard-coded list — plus scaffolding of new
 * sub-agent markdown. Writes project overrides to
 * <repo>/.pi/ithacus/agents/<name>.md (the same dir discoverIthacusAgents()
 * reads as "project" overrides that win over the bundled roster). A bundled
 * def removed from the package keeps its surviving project def visible and
 * bindable; setup never prunes files or config.
 *
 * Reads provider/model config from models.json via loadPiSetupConfig().
 * Provider/model management is owned BY ithacus (ithacus-providers.ts):
 * pi-setup's /setup is shared with other extensions, so /ithacus-setup embeds
 * a "Manage providers…" submenu that needs no pi-setup install.
 *
 * PREVENT-ITH-004: local fs writes to .pi/ithacus + reads of pi-setup's local
 * config. No network. Mirrors ithacus-agents.ts + setup.ts (which read/write
 * the same local config dirs without annotations).
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadPiSetupConfig } from "./ithacus-provider-config.js";
import { providersMenu, providerSnapshot } from "./ithacus-providers.js";
import {
  discoverIthacusAgents,
  type AgentConfig,
} from "./ithacus-agents.js";

interface ModelOption {
  provider: string;
  id: string;
  label: string; // "claude-mythos-5 (plexus)"
}

function collectModels(): ModelOption[] {
  const cfg = loadPiSetupConfig();
  const out: ModelOption[] = [];
  for (const [provider, pv] of Object.entries(cfg.providers ?? {})) {
    for (const m of pv?.models ?? []) {
      if (!m?.id) continue;
      out.push({ provider, id: m.id, label: `${m.id} (${provider})` });
    }
  }
  return out;
}

/** Deterministic normalized-name sort for the picker roster. */
function sortAgents(list: AgentConfig[]): AgentConfig[] {
  return [...list].sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.name === b.name ? 0 : a.name < b.name ? -1 : 1;
  });
}

/** Build the frontmatter+body for a project override agent .md file. */
function buildAgentMarkdown(name: string, agent: AgentConfig | undefined, model: string, provider: string): string {
  const tools = agent?.tools ?? ["read", "grep", "find", "ls", "bash"];
  const description = agent?.description || `${name} agent in an ithacus team`;
  const body = agent?.systemPrompt || `You are the ${name} agent in an ithacus team.`;
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `tools: ${tools.join(",")}`,
    `model: ${model}`,
    `provider: ${provider}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Persist a binding: (re)write the agent's project frontmatter with the
 * chosen model+provider. `agent` is the SAME discoverIthacusAgents() snapshot
 * entry the picker listed — identity, description, tools, and body carry
 * through unchanged; ONLY model/provider mutate. Frontmatter in the project
 * def remains the sole binding-persistence mechanism; nothing here deletes
 * or prunes project files/config (Sprint 5.12.5).
 */
function writeAgentOverride(agent: AgentConfig, model: string, provider: string): string {
  const dir = path.resolve(process.cwd(), ".pi", "ithacus", "agents");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${agent.name}.md`);
  fs.writeFileSync(file, buildAgentMarkdown(agent.name, agent, model, provider), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return file;
}

function buildNewAgentMarkdown(
  name: string,
  description: string,
  tools: string[],
  model: string,
  provider: string,
  systemPrompt: string,
): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `tools: ${tools.join(",")}`,
    `model: ${model}`,
    `provider: ${provider}`,
    "---",
    "",
    systemPrompt,
    "",
  ].join("\n");
}

/**
 * Bind flow for ONE discovered agent — an arbitrary discovered name (bundled,
 * project, or .local origin), not a fixed four-value union (Sprint 5.12.5).
 */
async function bindRoleFlow(
  ui: ExtensionCommandContext["ui"],
  agent: AgentConfig,
  models: ModelOption[],
): Promise<void> {
  const current = `${agent.model ?? "(default)"}${agent.provider ? ` (${agent.provider})` : ""} [${agent.source}]`;
  const choices = [...models.map((m) => m.label), "< Back"];
  const pick = await ui.select(`Model for ${agent.name} [current: ${current}]:`, choices);
  if (!pick || pick === "< Back") return;
  const match = models.find((m) => m.label === pick);
  if (!match) return;
  const file = writeAgentOverride(agent, match.id, match.provider);
  ui.notify(`${agent.name} → ${match.id} (${match.provider}) saved to ${path.relative(process.cwd(), file)}`, "info");
}

async function scaffoldNewAgent(
  ui: ExtensionCommandContext["ui"],
  models: ModelOption[],
): Promise<void> {
  const name = ((await ui.input("Agent name (e.g. researcher):", "")) ?? "").trim();
  if (!name) return;
  const description = ((await ui.input("One-line description:", `Custom ${name} agent`)) ?? "").trim();
  const toolsRaw = ((await ui.input("Tools (comma-separated):", "read, grep, find, ls, bash")) ?? "").trim();
  const tools = toolsRaw.split(",").map((t) => t.trim()).filter(Boolean);
  const pick = await ui.select("Model:", [...models.map((m) => m.label), "< Back"]);
  // (label uses < Back> with angle bracket for select safety; resolved below)
  if (!pick) return;
  const match = models.find((m) => m.label === pick);
  if (!match) return;
  const systemPrompt = ((await ui.input("System prompt (one line):", `You are the ${name} agent.`)) ?? "").trim();
  const dir = path.resolve(process.cwd(), ".pi", "ithacus", "agents");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  fs.writeFileSync(
    file,
    buildNewAgentMarkdown(name, description, tools, match.id, match.provider, systemPrompt),
    { encoding: "utf-8", mode: 0o600 },
  );
  ui.notify(`Scaffolded ${name} → ${path.relative(process.cwd(), file)}`, "info");
}

export function registerSetupCommand(pi: ExtensionAPI): void {
  pi.registerCommand("ithacus-setup", {
    description:
      "Configure model+provider bindings for every discovered ithacus sub-agent, and scaffold new agents",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const ui = ctx.ui;

      // Step 0: no providers yet → drop straight into ithacus's own
      // providers submenu (NOT pi-setup's /setup — that is shared with other
      // extensions and must not be a dependency).
      let models = collectModels();
      if (models.length === 0) {
        ui.notify("No providers configured yet — add one now.", "info");
        await providersMenu(ui, pi);
        models = collectModels();
        if (models.length === 0) return;
      }

      const providerCount = new Set(models.map((m) => m.provider)).size;
      ui.notify(
        `ithacus setup: ${models.length} model(s) across ${providerCount} provider(s). Bind an agent to change its default model.`,
        "info",
      );

      // Step 1: per-agent model binding loop.
      // Sprint 5.12.5 (DESIGN_AGENT_BUNDLES.md §7.1): FRESH discovery on
      // entry and after every roster-changing operation (a bind writes
      // project frontmatter; scaffolding adds a project def). Empty roster
      // surfaces visibly instead of rendering an empty picker.
      let agents: AgentConfig[] = [];
      const refreshRoster = (): void => {
        agents = sortAgents(discoverIthacusAgents());
        if (agents.length === 0) {
          ui.notify(
            "No ithacus agents discovered (bundled or project) — nothing to bind. Scaffold one below or restore extensions/agents/*.md.",
            "warning",
          );
        }
      };
      refreshRoster();

      let step: "agents" | "scaffold" | "" = "agents";
      while (step) {
        if (step === "agents") {
          const snap = providerSnapshot();
          // Label→agent map: a selection resolves against THIS SAME snapshot
          // — display labels are never string-parsed back into agent names.
          const bindByLabel = new Map<string, AgentConfig>();
          for (const a of agents) bindByLabel.set(`Bind: ${a.name}`, a);
          const pick = await ui.select(
            `ithacus sub-agents (${agents.length} discovered · ${snap.providerCount} provider(s), ${snap.modelCount} model(s)):`,
            [...bindByLabel.keys(), "Manage providers…", "--- Continue ---"],
          );
          if (!pick || pick === "--- Continue ---") {
            step = "scaffold";
            continue;
          }
          if (pick === "Manage providers…") {
            await providersMenu(ui, pi);
            models = collectModels();
            continue;
          }
          const chosen = bindByLabel.get(pick);
          if (chosen) {
            await bindRoleFlow(ui, chosen, models);
            refreshRoster(); // the bind wrote project frontmatter → re-discover
          }
          continue;
        }

        if (step === "scaffold") {
          const scaffold = await ui.select("Scaffold a new sub-agent?", [
            "Yes",
            "No (finish)",
          ]);
          if (scaffold === "Yes") {
            await scaffoldNewAgent(ui, models);
            refreshRoster(); // the new def is bindable immediately
            continue;
          }
          step = "";
          break;
        }
      }

      ui.notify("ithacus setup complete.", "info");
    },
  });

  // Standalone direct-access command for provider/model management.
  pi.registerCommand("ithacus-providers", {
    description:
      "Manage ithacus providers + models (add / edit / remove) — no pi-setup required",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      await providersMenu(ctx.ui, pi);
    },
  });
}
