/**
 * ithacus-setup.ts — the `/ithacus-setup` slash command wizard.
 *
 * Interactive binding of models + providers to ithacus sub-agent roles, plus
 * scaffolding of new sub-agent markdown. Writes project overrides to
 * <repo>/.pi/ithacus/agents/<role>.md (the same dir discoverIthacusAgents()
 * reads as "project" overrides that win over the bundled roster).
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

const ROLES = ["explore", "plan", "verification", "reviewer"] as const;
type Role = (typeof ROLES)[number];

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

/** Build the frontmatter+body for a project override agent .md file. */
function buildAgentMarkdown(bundled: AgentConfig | undefined, model: string, provider: string): string {
  const tools = bundled?.tools ?? ["read", "grep", "find", "ls", "bash"];
  const description = bundled?.description ?? `${bundled?.name ?? "agent"} role in an ithacus team`;
  const body =
    bundled?.systemPrompt ??
    `You are the ${bundled?.name ?? "agent"} role in an ithacus team.`;
  return [
    "---",
    `name: ${bundled?.name ?? "agent"}`,
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

function writeAgentOverride(role: string, model: string, provider: string): string {
  const bundled = discoverIthacusAgents().find((a) => a.name === role);
  const dir = path.resolve(process.cwd(), ".pi", "ithacus", "agents");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${role}.md`);
  fs.writeFileSync(file, buildAgentMarkdown(bundled, model, provider), {
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

async function bindRoleFlow(
  ui: ExtensionCommandContext["ui"],
  role: Role,
  models: ModelOption[],
): Promise<void> {
  const bundled = discoverIthacusAgents().find((a) => a.name === role);
  const current = bundled
    ? `${bundled.model ?? "(default)"}${bundled.provider ? ` (${bundled.provider})` : ""}`
    : "(none)";
  const choices = [...models.map((m) => m.label), "< Back"];
  const pick = await ui.select(`Model for ${role} [current: ${current}]:`, choices);
  if (!pick || pick === "< Back") return;
  const match = models.find((m) => m.label === pick);
  if (!match) return;
  const file = writeAgentOverride(role, match.id, match.provider);
  ui.notify(`${role} → ${match.id} (${match.provider}) saved to ${path.relative(process.cwd(), file)}`, "info");
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
      "Configure ithacus sub-agent models + providers per role, and scaffold new agents",
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
        `ithacus setup: ${models.length} model(s) across ${providerCount} provider(s). Bind a role to change its default model.`,
        "info",
      );

      // Step 1: per-role model binding loop.
      let step: "roles" | "scaffold" | "" = "roles";
      while (step) {
        if (step === "roles") {
          const snap = providerSnapshot();
          const roleChoices = [
            ...ROLES.map((r) => `Bind: ${r}`),
            "Manage providers…",
            "--- Continue ---",
          ];
          const pick = await ui.select(
            `ithacus sub-agent roles (${snap.providerCount} provider(s), ${snap.modelCount} model(s)):`,
            roleChoices,
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
          const role = pick.replace(/^Bind: /, "") as Role;
          if (ROLES.includes(role)) {
            await bindRoleFlow(ui, role, models);
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
