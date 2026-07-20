/**
 * register.ts — entry point that wires all pi lifecycle event handlers.
 *
 * Mirrors mega-compact's mega-events/register.ts: a single registerEventHandlers
 * the extension entry calls. Handlers live in focused submodules.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type IthRuntime } from "../ithacus-runtime.js";
import { type IthacusConfig } from "../../src/config.js";
import { registerSessionHandlers } from "./session-handlers.js";
import { registerAgentHandlers } from "./agent-handlers.js";
import { registerContextHandler } from "./context-handler.js";

export function registerEventHandlers(
  pi: ExtensionAPI,
  runtime: IthRuntime,
  config: IthacusConfig,
): void {
  registerSessionHandlers(pi, runtime, config);
  registerAgentHandlers(pi, runtime, config);
  registerContextHandler(pi, runtime, config);
}
