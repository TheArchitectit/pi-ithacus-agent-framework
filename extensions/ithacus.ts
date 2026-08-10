/**
 * ithacus.ts — extension entry point.
 *
 * Thin wiring layer (mirrors pi-mega-compact's mega-compact.ts): load config,
 * build the runtime, register event handlers + commands. All framework logic
 * lives in src/ (pi-agnostic); this file only adapts it into pi's lifecycle.
 *
 * Project name == folder name: the store lives at <repo>/.pi/ithacus/.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.js";
import { IthRuntime } from "./ithacus-runtime.js";
import { registerEventHandlers } from "./ithacus-events/register.js";
import { registerTeamCommands } from "./ithacus-commands.js";
import { registerDispatchTool } from "./ithacus-dispatch.js";
import { registerSetupCommand } from "./ithacus-setup.js";
import { registerMenuCommand } from "./ithacus-menu.js";
import { maybeShowOnLoadNotice } from "./ithacus-onboarding.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const runtime = new IthRuntime(config);
  registerEventHandlers(pi, runtime, config);
  registerTeamCommands(pi, runtime, config);
  // Sprint 5.10: the `ithacus-dispatch` tool is the LLM-invoked entry point
  // for spawning coordinated sub-agents (real pi subprocess, isolated context,
  // per-agent model). Clears the phantom `pi.callTool` dispatch for good.
  // runtime wires the first-dispatch onboarding notice (one-shot, per-repo).
  registerDispatchTool(pi, runtime);
  // `/ithacus-setup`: bind models+providers to roles + scaffold new agents.
  registerSetupCommand(pi);
  // Sprint 5.11: `/ithacus-menu` — persistent status overlay (version, crew,
  // agents, dashboard snapshot paths). First extension-side TUI wiring.
  registerMenuCommand(pi, runtime);
  // On-load notice: welcome if no providers are configured (mirrors pi-setup).
  maybeShowOnLoadNotice();
}
