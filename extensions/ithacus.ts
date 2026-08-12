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
import { registerMailboxTool } from "./ithacus-message.js";
import { registerControlTool } from "./ithacus-control-tool.js";
import { registerSetupCommand } from "./ithacus-setup.js";
import { registerMenuCommand } from "./ithacus-menu.js";
import { registerWebCommand } from "./ithacus-web.js";
import { registerVersionWidget } from "./ithacus-widget.js";
import { maybeShowVersionBump, ownVersion } from "./ithacus-version.js";
import { maybeShowOnLoadNotice } from "./ithacus-onboarding.js";
import { seedBundledAgents } from "../src/agent-bundles.js";
import { bundledAgentsDir, projectAgentsDir } from "./ithacus-agents.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const runtime = new IthRuntime(config);
  // Sprint 5.12.5 (DESIGN_AGENT_BUNDLES.md): seed the bundled agent roster
  // into <repo>/.pi/ithacus/agents/ — version-gated, user-edit safe (edited
  // files are reported, never clobbered). Best-effort: a failed seed is
  // logged and never blocks activation.
  try {
    const seed = seedBundledAgents({
      bundledDir: bundledAgentsDir(),
      projectAgentsDir: projectAgentsDir(),
      packageVersion: ownVersion(),
    });
    for (const name of seed.skippedModified) {
      console.log(
        `[ithacus] kept your edited .pi/ithacus/agents/${name} ` +
          `(not overwritten by v${ownVersion()}); delete it to receive the updated bundled version.`,
      );
    }
    for (const err of seed.errors) {
      console.log(`[ithacus] agent bundle seeding warning: ${err}`);
    }
  } catch (err) {
    console.log(`[ithacus] agent bundle seeding skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  registerEventHandlers(pi, runtime, config);
  registerTeamCommands(pi, runtime, config);
  // Sprint 5.10: the `ithacus-dispatch` tool is the LLM-invoked entry point
  // for spawning coordinated sub-agents (real pi subprocess, isolated context,
  // per-agent model). Clears the phantom `pi.callTool` dispatch for good.
  // runtime wires the first-dispatch onboarding notice (one-shot, per-repo).
  registerDispatchTool(pi, runtime);
  // Task #16: inter-agent mailbox (claw-code PR e96c6675 pattern) — shared
  // ith_inbox table, agents address each other by ITHACUS_AGENT_ID env name.
  registerMailboxTool(pi, runtime);
  // Sprint 5.28: live-dispatch control INTERNAL tool over the same core as
  // the /ithacus-ctrl slash command.
  registerControlTool(pi, runtime);
  // `/ithacus-setup`: bind models+providers to roles + scaffold new agents.
  registerSetupCommand(pi);
  // Sprint 5.11: `/ithacus-menu` — persistent status overlay (version, crew,
  // agents, dashboard snapshot paths). First extension-side TUI wiring.
  registerMenuCommand(pi, runtime);
  // Sprint 5.27 §3.4: `/ithacus-web` — loopback-only dashboard server
  // (start|stop|status). Binds 127.0.0.1 only; serves the local UI over
  // /api/* + SSE from the in-process event bus (PREVENT-ITH-004).
  registerWebCommand(pi, runtime, config);
  // Sprint 5.11: the above-editor widget — ALWAYS-visible version line (menu
  // bar), so an end user who ran `pi install npm:ithacus` sees the new
  // version without opening anything. Pattern mirrors pi-mega-compact's
  // MegaRuntime.renderWidget().
  registerVersionWidget(pi, runtime);
  // Version-bump notice (one-shot on update): `[ithacus] updated vX → vY`,
  // from the ~/.pi/agent/ithacus/last-version.txt marker diff — this is the
  // "user knows they updated" signal without a network call.
  maybeShowVersionBump();
  // On-load notice: welcome if no providers are configured (mirrors pi-setup).
  maybeShowOnLoadNotice();
}
