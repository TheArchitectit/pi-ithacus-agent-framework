/**
 * ithacus-child-mailbox.ts — minimal extension loaded ONLY into dispatched
 * child pi subprocesses (spawnAgent's `-e` flag, see ithacus-spawn.ts).
 *
 * Why a dedicated file: a dispatched child is a FRESH pi process in the repo
 * cwd. It does not auto-load the full ithacus entry (extensions/ithacus.ts):
 * there is no project-local `.pi/extensions/` and ithacus isn't a globally
 * installed pi package — so `ithacus-mailbox` was never registered in the
 * child, and pi's `--tools` allowlist silently dropped the unknown name,
 * leaving only built-in tools (the Sprint 5.something bug: child transcripts
 * showed no mailbox). Passing `-e <this file>` makes the child load exactly
 * the one PUBLIC tool it needs.
 *
 * We deliberately do NOT load the full ithacus entry here: it would also pull
 * in commands, the TUI/widget, onboarding, and the loopback dashboard, and
 * its console.log seeding lines would pollute the child's `--mode json`
 * stdout stream that spawnAgent parses as JSONL. This file registers only
 * `ithacus-mailbox` (reusing the proven registerMailboxTool + IthRuntime).
 *
 * The child identifies itself via the ITHACUS_AGENT_ID env that spawnAgent
 * sets (see ithacus-spawn.ts env block) — so registerToolWithVisibility
 * resolves the child context to PUBLIC and registers the PUBLIC-tier mailbox
 * tool. The shared store is bound per-repo from the child's cwd (the repo
 * root) inside registerMailboxTool's execute via runtime.bindRepo(ctx.cwd) —
 * the SAME <repo>/.pi/ithacus store the parent reads, so messages land in
 * the parent's ith_inbox and the parent's read/broadcast sees them.
 *
 * PREVENT-ITH-004: all mailbox ops are local sqlite via IthStore — zero
 * network; this file performs no I/O at load time.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.js";
import { IthRuntime } from "./ithacus-runtime.js";
import { registerMailboxTool } from "./ithacus-message.js";

export default function (pi: ExtensionAPI): void {
  const runtime = new IthRuntime(loadConfig());
  registerMailboxTool(pi, runtime);
  pi.on("session_shutdown", () => runtime.dispose());
}
