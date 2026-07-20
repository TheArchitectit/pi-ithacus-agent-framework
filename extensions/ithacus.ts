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

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const runtime = new IthRuntime(config);
  registerEventHandlers(pi, runtime, config);
  registerTeamCommands(pi, runtime, config);
}
