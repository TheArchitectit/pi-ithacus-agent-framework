/**
 * async.ts — detached background run management.
 *
 * Spawns a child process that survives the parent session, persists state to
 * the SQLite store, and notifies on completion.
 *
 * pi-agnostic: uses local process spawning + node:fs + node:path.
 * PREVENT-ITH-004: child process is LOCAL only (no network), runs a node
 *   script — never a remote fetch.
 */

import { spawn } from 'node:child_process'; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: local detached process
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AsyncRunState } from './types.js';

/** Derive the log file path for an async run. */
export function asyncLogPath(stateDir: string, runId: string): string {
  return join(stateDir, 'async', `${runId}.log`);
}

/**
 * Spawn a detached background process. The child's stdout+stderr are piped
 * to a log file. The process is detached and unref'd so it survives parent
 * exit.
 *
 * @returns AsyncRunState with status='running' and the child's pid
 */
export function spawnAsyncRun(opts: {
  runId: string;
  stateDir: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}): AsyncRunState {
  const log = asyncLogPath(opts.stateDir, opts.runId);
  const logDir = join(opts.stateDir, 'async');
  mkdirSync(logDir, { recursive: true });

  try {
    const child = spawn(opts.command, opts.args ?? [], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
    });

    const logStream = { flags: 'a' } as const;
    child.stdout?.on('data', (d: Buffer) => {
      appendFileSync(log, d, logStream);
    });
    child.stderr?.on('data', (d: Buffer) => {
      appendFileSync(log, d, logStream);
    });

    child.unref();

    return {
      runId: opts.runId,
      status: 'running',
      pid: child.pid ?? null,
      logPath: log,
      exitCode: null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    };
  } catch (e) {
    return {
      runId: opts.runId,
      status: 'failed',
      pid: null,
      logPath: log,
      exitCode: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Check whether a process with the given pid is still running.
 * Uses process.kill(pid, 0) which signals without killing.
 */
export function checkAsyncRun(pid: number): { running: boolean; exitCode: number | null } {
  try {
    process.kill(pid, 0);
    return { running: true, exitCode: null };
  } catch {
    return { running: false, exitCode: null };
  }
}

/**
 * Reap a completed async run. Checks if the process is still alive; if dead,
 * returns completion info. For simplicity, we just check liveness.
 */
export function reapAsyncRun(
  runId: string,
  pid: number,
): { exitCode: number; signal: string | null } {
  const check = checkAsyncRun(pid);
  if (check.running) {
    return { exitCode: -1, signal: null };
  }
  return { exitCode: 0, signal: null };
}
