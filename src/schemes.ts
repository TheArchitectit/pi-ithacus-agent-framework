/**
 * schemes.ts — GitHub scheme URI resolution.
 *
 * Parses pr://, issue://, conflict:// URIs into a SchemeResolution descriptor.
 * Produces the command + args; the extension layer executes (zero network here).
 *
 * pi-agnostic.
 */

import type { SchemeResolution } from './types.js';

/** Parse a scheme URI into a resolution descriptor. Throws on malformed input. */
export function resolveScheme(input: string): SchemeResolution {
  const trimmed = input.trim();
  const prMatch = trimmed.match(/^pr:\/\/(.+)$/i);
  if (prMatch) {
    const ref = prMatch[1].trim();
    return {
      input: trimmed,
      scheme: 'pr',
      ref,
      kind: 'pull_request',
      command: 'gh',
      args: ['pr', 'view', ref],
      description: `View pull request #${ref}`,
    };
  }
  const issueMatch = trimmed.match(/^issue:\/\/(.+)$/i);
  if (issueMatch) {
    const ref = issueMatch[1].trim();
    return {
      input: trimmed,
      scheme: 'issue',
      ref,
      kind: 'issue',
      command: 'gh',
      args: ['issue', 'view', ref],
      description: `View issue #${ref}`,
    };
  }
  const conflictMatch = trimmed.match(/^conflict:\/\/(.+)$/i);
  if (conflictMatch) {
    const ref = conflictMatch[1].trim();
    return {
      input: trimmed,
      scheme: 'conflict',
      ref,
      kind: 'merge_conflict',
      command: 'git',
      args: ['diff', ref],
      description: `Show conflict diff: ${ref}`,
    };
  }
  throw new Error(`Unknown scheme: ${trimmed}`);
}

/** Whether a string is a recognized scheme URI. */
export function isSchemeUri(input: string): boolean {
  return /^(pr|issue|conflict):\/\//i.test(input.trim());
}

/** Format a SchemeResolution as a readable string. */
export function formatResolution(res: SchemeResolution): string {
  return `${res.description}\n  command: ${res.command} ${res.args.join(' ')}`;
}

/** List supported schemes. */
export const SUPPORTED_SCHEMES = ['pr', 'issue', 'conflict'] as const;

/** Build a scheme URI from components. */
export function buildSchemeUri(scheme: 'pr' | 'issue' | 'conflict', ref: string): string {
  return `${scheme}://${ref}`;
}
