/**
 * worktree.ts — per-agent git worktree management.
 *
 * Creates isolated working directories so parallel agents don't clobber each
 * other's files. Auto-cleanup on completion/failure + orphan sweep.
 *
 * pi-agnostic: uses only local git CLI + node:fs + node:path.
 */

import { execFileSync } from 'node:child_process'; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: local git CLI only
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WorktreeConfig } from './types.js';

/** Derive the worktree directory path for an agent. */
export function worktreePath(repoRoot: string, agentId: string): string {
  return join(repoRoot, '.pi', 'ithacus', 'worktrees', agentId);
}

/** Derive the branch name for an agent's worktree. */
export function worktreeBranch(agentId: string): string {
  return `ithacus/${agentId}`;
}

/**
 * Create a git worktree for an agent. Runs `git worktree add` with a new
 * branch based on the current HEAD (or an explicit base branch).
 *
 * @returns WorktreeConfig with cleaned=false
 */
export function addWorktree(
  repoRoot: string,
  agentId: string,
  baseBranch?: string,
): WorktreeConfig {
  const path = worktreePath(repoRoot, agentId);
  const branch = worktreeBranch(agentId);
  const base = baseBranch ?? 'HEAD';
  execFileSync('git', ['worktree', 'add', '-b', branch, path, base], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { agentId, runId: '', path, branch, cleaned: false, createdAt: Date.now() };
}

/** Remove a git worktree directory. */
export function removeWorktree(repoRoot: string, path: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', path], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Fallback: rm the directory if git worktree remove fails.
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/** List all git worktrees for the repo (returns paths). */
export function listWorktrees(repoRoot: string): string[] {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }) as string;
    const paths: string[] = [];
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(line.slice('worktree '.length));
      }
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Clean up a worktree: remove the directory + mark as cleaned in the config.
 * Wrapped in try/finally so failure doesn't block the caller.
 */
export function cleanupWorktree(repoRoot: string, wt: WorktreeConfig): WorktreeConfig {
  try {
    removeWorktree(repoRoot, wt.path);
  } catch {
    /* non-fatal: best-effort cleanup */
  }
  return { ...wt, cleaned: true };
}

/**
 * Sweep orphaned worktrees: directories under .pi/ithacus/worktrees/ that
 * no longer appear in the git worktree list. Returns paths of removed dirs.
 */
export function sweepOrphans(repoRoot: string): string[] {
  const wtDir = join(repoRoot, '.pi', 'ithacus', 'worktrees');
  if (!existsSync(wtDir)) return [];
  const listed = new Set(listWorktrees(repoRoot));
  const removed: string[] = [];
  try {
    for (const entry of readdirSync(wtDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(wtDir, entry.name);
      if (!listed.has(full)) {
        // Safety: only delete dirs that look like real worktrees (have .git file).
        if (existsSync(join(full, '.git'))) {
          rmSync(full, { recursive: true, force: true });
          removed.push(full);
        }
      }
    }
  } catch {
    /* non-fatal */
  }
  return removed;
}
