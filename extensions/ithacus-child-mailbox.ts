/**
 * ithacus-child-mailbox.ts — minimal extension loaded ONLY into dispatched
 * child pi subprocesses (spawnAgent's `-e` flag, see ithacus-spawn.ts).
 *
 * Why a dedicated file: a dispatched child is a FRESH pi process started with
 * `--no-extensions -e <this file>` (see spawnAgent). Extension DISCOVERY is
 * disabled in children for two reasons: (1) when ithacus is npm-installed the
 * child would otherwise auto-load the full ithacus.js entry which ALSO
 * registers the PUBLIC `ithacus-mailbox` tool — pi hard-fails on duplicate
 * tool names and every dispatch exits 1 (FAIL-6c4a2d11); (2) other installed
 * extensions' console.log startup banners would pollute the child's
 * `--mode json` JSONL stdout stream that spawnAgent parses. Loading exactly
 * this one file gives children the single PUBLIC tool they need with a
 * deterministic toolset regardless of install layout (repo source or npm dist).
 * The original pre-discovery problem stands too: without ANY -e the child's
 * `--tools` allowlist silently dropped the unregistered `ithacus-mailbox`
 * name, leaving only built-in tools (child transcripts showed no mailbox).
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
