/**
 * ithacus-worktree.ts — worktree lifecycle hooks.
 *
 * Hooks into agent spawn (create worktree) and complete/fail (cleanup).
 * Imports pi runtime types — this is the adapter layer.
 */

import type { IthRuntime } from './ithacus-runtime.js';
import { addWorktree, cleanupWorktree } from '../src/worktree.js';
import type { WorktreeConfig } from '../src/types.js';

/** Create a worktree for an agent on spawn. */
export function onAgentSpawn(
  runtime: IthRuntime,
  repoRoot: string,
  agentId: string,
  runId: string,
): WorktreeConfig | undefined {
  try {
    const wt = addWorktree(repoRoot, agentId);
    wt.runId = runId;
    runtime.store.saveWorktree(wt);
    runtime.appendEvent('worktree_created', { agentId, path: wt.path });
    return wt;
  } catch (e) {
    runtime.appendEvent('worktree_create_failed', {
      agentId,
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}

/** Clean up a worktree when an agent completes. */
export function onAgentComplete(runtime: IthRuntime, repoRoot: string, agentId: string): void {
  const wt = runtime.store.getWorktree(agentId);
  if (!wt || wt.cleaned) return;
  const cleaned = cleanupWorktree(repoRoot, wt);
  runtime.store.saveWorktree(cleaned);
  runtime.appendEvent('worktree_cleaned', { agentId });
}

/** Clean up a worktree when an agent fails. */
export function onAgentFail(runtime: IthRuntime, repoRoot: string, agentId: string): void {
  onAgentComplete(runtime, repoRoot, agentId); // same cleanup logic
}
