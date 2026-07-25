/**
 * ithacus-profiles.ts — profile store accessor + interactive selection
 * prompt construction for the extension layer.
 */

import type { IthRuntime } from './ithacus-runtime.js';
import type { ModelProfileStore } from '../src/store-model-profiles.js';
import type { ModelProfile } from '../src/types.js';
import { seedProfiles, BUILTIN_PROFILES } from '../src/model-profiles.js';

/** Get or create the ModelProfileStore for the current runtime. */
export function getProfileStore(runtime: IthRuntime): ModelProfileStore {
  const key = '__profileStore';
  if (!(runtime as any)[key]) {
    (runtime as any)[key] = new ModelProfileStore(runtime.store.db);
  }
  return (runtime as any)[key] as ModelProfileStore;
}

/** Ensure built-in profiles are seeded. */
export function ensureProfiles(runtime: IthRuntime): ModelProfileStore {
  const ps = getProfileStore(runtime);
  seedProfiles(ps);
  return ps;
}

/** Render an interactive profile-selection prompt string. */
export function buildProfileSelectionPrompt(profiles = BUILTIN_PROFILES): string {
  const lines = profiles.map((p, i) =>
    `  ${i + 1}. ${p.name} (${p.tier}) — ${p.description} [cost: ${p.costMultiplier}x]`,
  );
  return `Select a model profile:\n${lines.join('\n')}\n\nReply with the profile name or number (default: speed).`;
}

/** Parse a user's profile selection (name or 1-based index). */
export function parseProfileSelection(
  input: string,
  profiles = BUILTIN_PROFILES,
): ModelProfile | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return profiles[0]; // default speed
  const byName = profiles.find(p => p.id === trimmed || p.name.toLowerCase() === trimmed);
  if (byName) return byName;
  const idx = parseInt(trimmed, 10);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= profiles.length) return profiles[idx - 1];
  return undefined;
}
