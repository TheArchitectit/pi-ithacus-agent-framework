/**
 * ithacus-async.ts — async run spawn/monitor hooks.
 *
 * Spawns detached background runs and monitors their completion.
 */

import type { IthRuntime } from './ithacus-runtime.js';
import { spawnAsyncRun, checkAsyncRun } from '../src/async.js';
import type { AsyncRunState } from '../src/types.js';

/** Spawn an async background run and persist its state. */
export function spawnAsync(opts: {
  runtime: IthRuntime;
  runId: string;
  command: string;
  args?: string[];
  cwd?: string;
}): AsyncRunState {
  const state = spawnAsyncRun({
    runId: opts.runId,
    stateDir: opts.runtime.currentStateDir,
    command: opts.command,
    args: opts.args,
    cwd: opts.cwd,
  });
  opts.runtime.store.saveAsyncRun(state);
  opts.runtime.appendEvent('async_spawn', { runId: opts.runId, pid: state.pid });
  return state;
}

/** Check the status of an async run (updates store if completed). */
export function checkAsync(
  runtime: IthRuntime,
  runId: string,
): AsyncRunState | undefined {
  const stored = runtime.store.getAsyncRun(runId);
  if (!stored) return undefined;
  if (stored.status !== 'running' || !stored.pid) return stored;

  const check = checkAsyncRun(stored.pid);
  if (!check.running) {
    runtime.store.setAsyncRunStatus(runId, 'completed', {
      exitCode: 0,
      completedAt: Date.now(),
    });
    runtime.appendEvent('async_completed', { runId });
    return runtime.store.getAsyncRun(runId);
  }
  return stored;
}
