/**
 * model-profiles.ts — interactive model profiles for ithacus.
 *
 * 5 pre-seeded profiles (Speed, Quality, Reasoning, Code, Local),
 * cost estimation, and profile resolution chain (explicit > role > default).
 *
 * pi-agnostic.
 */

import type { ModelProfile, ProfileTier, TeamModelAssignment, AgentRole } from './types.js';
import type { ModelProfileStore } from './store-model-profiles.js';

/** Baseline token cost rate (USD per 1M tokens, averaged input/output). */
export const BASE_COST_PER_MTOK = 3.0;

/** The 5 pre-seeded built-in profiles. */
export const BUILTIN_PROFILES: ModelProfile[] = [
  {
    id: 'speed', name: 'Speed', tier: 'speed',
    model: 'claude-haiku-4-5-20251001', fallbackModels: ['kimi', 'qwen'],
    description: 'Fast, cheap, parallel exploration. Best for quick scans and broad discovery.',
    costMultiplier: 0.5, isBuiltIn: true, createdAt: 0,
  },
  {
    id: 'quality', name: 'Quality', tier: 'quality',
    model: 'claude-opus-4-8', fallbackModels: ['claude-sonnet-4-5'],
    description: 'Highest quality reasoning. Best for complex reviews and security analysis.',
    costMultiplier: 3.0, isBuiltIn: true, createdAt: 0,
  },
  {
    id: 'reasoning', name: 'Reasoning', tier: 'reasoning',
    model: 'claude-sonnet-4-5', fallbackModels: ['kimi'],
    description: 'Balanced reasoning for planning and architectural analysis.',
    costMultiplier: 1.5, isBuiltIn: true, createdAt: 0,
  },
  {
    id: 'code', name: 'Code', tier: 'code',
    model: 'claude-sonnet-4-5', fallbackModels: ['qwen', 'kimi'],
    description: 'Code generation and refactoring specialist with strong fallbacks.',
    costMultiplier: 1.5, isBuiltIn: true, createdAt: 0,
  },
  {
    id: 'local', name: 'Local', tier: 'local',
    model: 'qwen', fallbackModels: ['kimi'],
    description: 'Local/offline models. Zero network, privacy-first, cheapest tier.',
    costMultiplier: 0.1, isBuiltIn: true, createdAt: 0,
  },
];

/** Default profile when nothing is explicitly chosen. */
export const DEFAULT_PROFILE_ID = 'speed' as const;

/** Seed built-in profiles into the store (idempotent). Returns count seeded. */
export function seedProfiles(store: ModelProfileStore): number {
  return store.seedBuiltins(BUILTIN_PROFILES);
}

/** Create a custom profile. Returns the created profile. */
export function createProfile(
  store: ModelProfileStore,
  opts: { id: string; name: string; tier: ProfileTier; model: string; fallbackModels?: string[]; description?: string; costMultiplier?: number },
): ModelProfile {
  if (store.getProfile(opts.id)) throw new Error(`Profile '${opts.id}' already exists`);
  const p: ModelProfile = {
    id: opts.id, name: opts.name, tier: opts.tier, model: opts.model,
    fallbackModels: opts.fallbackModels ?? [],
    description: opts.description ?? `${opts.name} custom profile.`,
    costMultiplier: opts.costMultiplier ?? 1.0, isBuiltIn: false, createdAt: Date.now(),
  };
  store.upsertProfile(p);
  return p;
}

/** Update an existing profile's mutable fields. */
export function updateProfile(
  store: ModelProfileStore,
  id: string,
  patch: Partial<Pick<ModelProfile, 'name' | 'model' | 'fallbackModels' | 'description' | 'costMultiplier'>>,
): ModelProfile {
  const existing = store.getProfile(id);
  if (!existing) throw new Error(`Profile '${id}' not found`);
  const updated: ModelProfile = { ...existing, ...patch };
  store.upsertProfile(updated);
  return updated;
}

/** Delete a custom profile (built-ins cannot be deleted). */
export function deleteProfileById(store: ModelProfileStore, id: string): boolean {
  return store.deleteProfile(id);
}

/** Estimate the cost (USD) of a profile for given token usage. */
export function estimateProfileCost(
  profile: ModelProfile,
  inputTokens: number,
  outputTokens: number,
): number {
  const totalMtok = (inputTokens + outputTokens) / 1_000_000;
  return Math.round(totalMtok * BASE_COST_PER_MTOK * profile.costMultiplier * 1000) / 1000;
}

/**
 * Resolve a profile via the precedence chain:
 *   explicit assignment > role-based assignment > default.
 * @returns the resolved ModelProfile (always defined; falls back to builtin default)
 */
export function resolveProfile(
  store: ModelProfileStore,
  opts: { explicit?: string | null; role?: AgentRole; runId?: string },
  defaultProfileId = DEFAULT_PROFILE_ID,
): ModelProfile {
  if (opts.explicit) {
    const p = store.getProfile(opts.explicit);
    if (p) return p;
  }
  if (opts.runId && opts.role) {
    const assignment = store.assignmentForRole(opts.runId, opts.role);
    if (assignment) {
      const p = store.getProfile(assignment.profileId);
      if (p) return p;
    }
  }
  const fallback = store.getProfile(defaultProfileId);
  if (fallback) return fallback;
  // Absolute last resort: return the speed builtin directly.
  return BUILTIN_PROFILES[0];
}

/** Assign a profile to a role for a run. */
export function assignRoleProfile(
  store: ModelProfileStore,
  opts: { runId: string; role: AgentRole; profileId: string },
): TeamModelAssignment {
  const profile = store.getProfile(opts.profileId);
  if (!profile) throw new Error(`Profile '${opts.profileId}' not found`);
  const assignment: TeamModelAssignment = {
    runId: opts.runId, role: opts.role, profileId: opts.profileId,
    model: profile.model, createdAt: Date.now(),
  };
  store.assignRole(assignment);
  return assignment;
}
