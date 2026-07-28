/**
 * ithacus-subagent.ts — pi sub-agent spawn helper.
 *
 * Provides createSpawnSubAgent(ctx), which returns a SpawnSubAgent that
 * actually runs a sub-agent via pi's sub-session mechanism. This replaces the
 * previous this.pi.callTool?.('Agent', ...) calls, which referenced an API
 * that does not exist on pi's ExtensionAPI — so swarm dispatch and team
 * sub-agent spawning were silent no-ops at runtime.
 *
 * Mechanism (per pi's extension API):
 *   - ExtensionCommandContext.newSession({ withSession: async (subctx) => {...} })
 *     opens a fresh sub-session and hands back a ReplacedSessionContext whose
 *     sendUserMessage is awaitable.
 *   - We send the prompt, then await waitForIdle() so the sub-agent runs to
 *     completion before we return.
 *
 * Note: pi has no synchronous API to read a sub-agent's textual output back
 * into the parent. The sub-agent's result lives in the new session transcript
 * (visible in the session tree). We return a short structured acknowledgment
 * so the caller's accounting (SwarmItemResult.output) stays non-empty; the
 * real work product is the spawned session itself.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SpawnSubAgent } from "./ithacus-swarm.js";

/**
 * Build a SpawnSubAgent bound to a command context. Each call opens a new
 * sub-session, feeds it the prompt, and waits for it to finish.
 */
export function createSpawnSubAgent(ctx: ExtensionCommandContext): SpawnSubAgent {
  return async (prompt, opts) => {
    const modelNote = opts.model ? ` (model=${opts.model})` : '';
    const { cancelled } = await ctx.newSession({
      withSession: async (subctx) => {
        await subctx.sendUserMessage(prompt);
        await subctx.waitForIdle();
      },
    });
    if (cancelled) {
      return { output: '', cancelled: true };
    }
    return {
      output: `sub-agent '${opts.role}' completed for '${opts.itemName}'${modelNote}; see spawned session for output.`,
      cancelled: false,
    };
  };
}
