/**
 * team-presets.ts — Sprint 5.21 (docs/DESIGN_TEAMS_AND_SIZES.md): pure
 * normalization, size expansion, precedence resolution, drift comparison,
 * and validation for versioned team presets.
 *
 * pi-agnostic: no pi imports, zero network (PREVENT-ITH-004). All functions
 * are deterministic and side-effect free (safe for dry-run rendering).
 *
 * Implements the Stage 0 + Stage 1 surface of the design's rollout: the
 * versioned schema, legacy virtual presets (tiny..mega stay byte-for-byte at
 * today's 1–6 rosters), exact per-role expansion, deterministic total-only
 * allocation, slot-override matching, model/provider/profile precedence, and
 * `validateTeamPreset()`. No dispatch-path changes in this module — that is a
 * later reviewed stage.
 */

import type {
  TeamPresetV1,
  TeamSizePolicy,
  TeamRoleSpec,
  TeamSlotOverride,
  TeamFailurePolicy,
  SlotResolution,
  TeamSnapshotV1,
  PresetValidation,
  DiscoveredAgentType,
} from "./types-sprint-5.21.js";
import { MODE_PRESETS, type ModePreset } from "./config.js";

/** Framework hard limit on expanded slots (design §3). */
export const HARD_SLOT_LIMIT = 24;

/** Default project concurrency cap (design §9: rollout default 1 = serial). */
export const DEFAULT_TEAM_CONCURRENCY = 1;
/** Allowed project concurrency range. */
export const TEAM_CONCURRENCY_MIN = 1;
export const TEAM_CONCURRENCY_MAX = 24;

const ROLE_ORDER = ["Explore", "Plan", "Verification", "Reviewer"] as const;

/**
 * Build the builtin versioned preset catalog. Initial built-ins are explicit
 * (design §4); the legacy tiny..mega modes remain virtual compatibility
 * presets with EXACTLY today's compositions and totals (never rewritten to
 * claw-code's 4–24 totals).
 */
export function builtinPresets(): TeamPresetV1[] {
  const mk = (
    id: string,
    name: string,
    description: string | undefined,
    size: TeamSizePolicy,
    roles: TeamRoleSpec[],
    opts: Partial<Pick<TeamPresetV1, "slots" | "maxConcurrent" | "failurePolicy" | "revision">> = {},
  ): TeamPresetV1 => ({
    schemaVersion: 1,
    id,
    name,
    description,
    size,
    roles,
    source: "builtin",
    revision: opts.revision ?? 1,
    ...(opts.slots ? { slots: opts.slots } : {}),
    ...(opts.maxConcurrent !== undefined ? { maxConcurrent: opts.maxConcurrent } : {}),
    ...(opts.failurePolicy ? { failurePolicy: opts.failurePolicy } : {}),
  });

  const exp = (count: number): TeamRoleSpec[] => [
    { role: "Explore", agentType: "explore", count },
    { role: "Plan", agentType: "plan", count },
    { role: "Verification", agentType: "verification", count },
    { role: "Reviewer", agentType: "reviewer", count },
  ];

  return [
    mk("solo-explore", "solo-explore", "Small reconnaissance; a single explorer slot.", { min: 1, default: 1, max: 1 }, [
      { role: "Explore", agentType: "explore", count: 1 },
    ], { failurePolicy: { kind: "continue" } }),
    mk("plan-check", "plan-check", "Current medium-compatible flow: explore + plan + verification.", { min: 1, default: 3, max: 3 }, [
      { role: "Explore", agentType: "explore", count: 1 },
      { role: "Plan", agentType: "plan", count: 1 },
      { role: "Verification", agentType: "verification", count: 1 },
    ], { failurePolicy: { kind: "continue" } }),
    mk("balanced-4", "balanced-4", "Claw-inspired builders plus independent review.", { min: 1, default: 4, max: 4 }, [
      { role: "Explore", agentType: "explore", count: 1 },
      { role: "Plan", agentType: "plan", count: 1 },
      { role: "Verification", agentType: "verification", count: 1 },
      { role: "Reviewer", agentType: "reviewer", count: 1 },
    ], { failurePolicy: { kind: "continue" } }),
    mk("parallel-review-8", "parallel-review-8", "Explicit equivalent of claw-code 2x.", { min: 2, default: 8, max: 8 }, exp(2), {
      failurePolicy: { kind: "continue" },
      maxConcurrent: 4,
    }),
    // ---- legacy virtual compatibility presets (design §4) ----
    mk("tiny", "tiny", "Legacy virtual preset — one explorer.", { min: 1, default: 1, max: 1 }, [
      { role: "Explore", agentType: "explore", count: 1 },
    ]),
    mk("small", "small", "Legacy virtual preset — explore + plan.", { min: 1, default: 2, max: 2 }, [
      { role: "Explore", agentType: "explore", count: 1 },
      { role: "Plan", agentType: "plan", count: 1 },
    ]),
    mk("medium", "medium", "Legacy virtual preset — explore + plan + verification.", { min: 1, default: 3, max: 3 }, [
      { role: "Explore", agentType: "explore", count: 1 },
      { role: "Plan", agentType: "plan", count: 1 },
      { role: "Verification", agentType: "verification", count: 1 },
    ]),
    mk("large", "large", "Legacy virtual preset — four-role crew.", { min: 1, default: 4, max: 4 }, [
      { role: "Explore", agentType: "explore", count: 1 },
      { role: "Plan", agentType: "plan", count: 1 },
      { role: "Verification", agentType: "verification", count: 1 },
      { role: "Reviewer", agentType: "reviewer", count: 1 },
    ]),
    mk("xlarge", "xlarge", "Legacy virtual preset — five-slot wrap.", { min: 1, default: 5, max: 5 }, [
      { role: "Explore", agentType: "explore", count: 2 },
      { role: "Plan", agentType: "plan", count: 1 },
      { role: "Verification", agentType: "verification", count: 1 },
      { role: "Reviewer", agentType: "reviewer", count: 1 },
    ]),
    mk("mega", "mega", "Legacy virtual preset — six-slot wrap.", { min: 1, default: 6, max: 6 }, [
      { role: "Explore", agentType: "explore", count: 2 },
      { role: "Plan", agentType: "plan", count: 2 },
      { role: "Verification", agentType: "verification", count: 1 },
      { role: "Reviewer", agentType: "reviewer", count: 1 },
    ]),
  ];
}

const builtinCache: TeamPresetV1[] | null = null;
export function builtinPresetById(id: string): TeamPresetV1 | undefined {
  return builtinPresets().find((p) => p.id === id);
}

/** Round-robin role assignment for a count (the legacy wrap behavior). */
function rolesForCount(count: number): string[] {
  const roles = [...ROLE_ORDER];
  return Array.from({ length: count }, (_, i) => roles[i % roles.length]);
}

/**
 * Legacy mode → exact versioned preset (design §4: tiny..mega keep today's
 * rosters). Used as the golden baseline for the virtual presets and for
 * users who keep using the legacy aliases.
 */
export function presetFromLegacyMode(mode: ModePreset): TeamPresetV1 {
  const legacy = MODE_PRESETS[mode];
  const roleCounts = new Map<string, number>();
  for (const role of legacy.roles) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const roles: TeamRoleSpec[] = [...roleCounts.entries()].map(([role, count]) => ({
    role,
    agentType: role.toLowerCase(),
    count,
  }));
  // Ensure a stable, explicit self-contained definition regardless of the
  // MODE_PRESETS role order.
  roles.sort((a, b) => ROLE_ORDER.indexOf(a.role as (typeof ROLE_ORDER)[number]) - ROLE_ORDER.indexOf(b.role as (typeof ROLE_ORDER)[number]));
  const n = legacy.agents;
  return {
    schemaVersion: 1,
    id: mode,
    name: mode,
    description: `Legacy virtual preset — ${n} agent(s).`,
    size: { min: n, default: n, max: n },
    roles,
    source: "builtin",
    revision: 1,
  };
}

/** True when `name` is a legacy tiny..mega virtual preset. */
export function isLegacyModeName(name: string): boolean {
  return name in MODE_PRESETS;
}

/** Stable expanded slot id (design §6): `<runId>:<role-slug>:<ordinal>`. */
export function expandedSlotId(runId: string, role: string, ordinal: number): string {
  const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${runId}:${slug}:${ordinal}`;
}

/** Default size of a preset = sum(roles[].count) (V1 invariant, §3). */
export function presetDefaultSize(preset: TeamPresetV1): number {
  return preset.roles.reduce((acc, r) => acc + r.count, 0);
}

/** Total expanded count of a given role set. */
export function roleCountFor(preRoles: TeamRoleSpec[]): number {
  return preRoles.reduce((acc, r) => acc + r.count, 0);
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Pure size expansion + precedence resolution (design §6). Given a preset, an
 * optional one-run size override and/or per-role count overrides, and the
 * runId, produce the ordered resolved roster (SlotResolution[]). Deterministic.
 *
 * Rules:
 *   - no override → saved counts + size.default;
 *   - per-role counts: each supplied count replaces that role's saved count;
 *   - total-only override: distribute the delta by saved role order with
 *     largest-remainder weights derived from default counts; required roles
 *     retain at least one slot;
 *   - both forms: per-role counts authoritative, their sum must equal the
 *     requested total (validated by the caller via validateExpansion).
 */
export function expandRoster(opts: {
  preset: TeamPresetV1;
  runId: string;
  sizeOverride?: number;
  roleCounts?: Record<string, number>;
  slotOverrides?: TeamSlotOverride[] | null;
  defaultProvider?: string;
  defaultModel?: string;
  teamProfileModel?: string;
  discovered?: DiscoveredAgentType[];
}): { slots: SlotResolution[]; warnings: string[] } {
  const { preset, runId } = opts;
  const warnings: string[] = [];

  // First materialize per-role counts (rule 1/2/4).
  let roleCounts: Record<string, number> = {};
  const defaultCounts: Record<string, number> = {};
  for (const r of preset.roles) defaultCounts[r.role] = r.count;

  if (opts.roleCounts && Object.keys(opts.roleCounts).length > 0) {
    // Rule 2: per-role counts replace; unspecified keep saved counts.
    roleCounts = { ...defaultCounts };
    for (const [role, count] of Object.entries(opts.roleCounts)) {
      if (role in defaultCounts) roleCounts[role] = count;
      // unknown role names are rejected by validate; here we ignore them.
    }
  } else if (opts.sizeOverride !== undefined && opts.sizeOverride !== preset.size.default) {
    // Rule 3: total-only override → deterministic largest-remainder allocation.
    roleCounts = distributeTotal(preset, opts.sizeOverride);
    if (opts.sizeOverride > preset.size.max || opts.sizeOverride < preset.size.min) {
      warnings.push(`size ${opts.sizeOverride} outside preset bounds; clamped counts to bounds`);
    }
  } else {
    roleCounts = { ...defaultCounts };
  }

  const order = [...preset.roles];
  const total = Object.values(roleCounts).reduce((a, b) => a + b, 0);

  const slotOverrides = opts.slotOverrides ?? preset.slots ?? [];
  const matchOverride = (role: string, ordinal: number): TeamSlotOverride | undefined =>
    slotOverrides.find((s) => s.role === role && s.ordinal === ordinal);

  const slots: SlotResolution[] = [];
  for (const role of order) {
    const count = roleCounts[role.role] ?? 0;
    const agentType = role.agentType;
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const over = matchOverride(role.role, ordinal);
      // Precedence (design §6 model/profile/provider precedence):
      //   1. explicit one-run slot override
      //   2. saved TeamSlotOverride
      //   3. one-run role override
      //   4. saved TeamRoleSpec assignment
      //   5. team-level model profile
      //   6. discovered agent definition frontmatter
      //   7. session subagentModel
      //   8. DEFAULT_AGENT_MODEL / fallback chain
      const slotAgent = over?.agentType ?? agentType;
      const discovered = opts.discovered?.find((a) => a.id === slotAgent);
      // Resolve model: slot override (1/2) > role override (3/4) > team profile
      // (5) > agent frontmatter (6) > session default (7) > constant default (8).
      let model: string | undefined;
      let provider: string | undefined;
      let profileId: string | undefined;
      let provenance = "";

      if (over?.model) {
        model = over.model;
        provider = over.provider;
        profileId = over.profileId;
        provenance = "preset-slot-override";
      } else {
        const roleSpec = preset.roles.find((r) => r.role === role.role);
        const roleCountOverride = opts.roleCounts && role.role in opts.roleCounts ? role.role : null;
        const roleModel = roleSpec?.model;
        const roleProvider = roleSpec?.provider;
        const roleProfile = roleSpec?.profileId;
        if (roleModel || roleProvider || roleProfile) {
          model = roleModel;
          provider = roleProvider;
          provider = provider ?? (roleModel && opts.defaultProvider ? opts.defaultProvider : provider);
          profileId = roleProfile;
          provenance = "preset-role" + (roleCountOverride ? "-override" : "");
        } else if (opts.teamProfileModel) {
          model = opts.teamProfileModel;
          // team-level profile contributes a model, provider resolves later
          provider = opts.defaultProvider;
          provenance = "team-profile";
        } else if (discovered?.model) {
          model = discovered.model;
          provider = over?.provider ?? roleSpec?.provider ?? discovered.provider ?? opts.defaultProvider;
          provenance = "agent-definition";
        } else {
          model = opts.defaultModel ?? undefined;
          provider = over?.provider ?? roleSpec?.provider ?? opts.defaultProvider ?? discovered?.provider ?? undefined;
          provenance = "session-default";
        }
        if (!model) {
          model = roleSpec?.model;
          if (model && !provider) {
            provider = opts.defaultProvider;
            provenance = "preset-role";
          }
        }
      }

      slots.push({
        slotId: over?.slotId ?? expandedSlotId(runId, role.role, ordinal),
        role: role.role,
        ordinal,
        agentType: slotAgent,
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
        ...(profileId ? { profileId } : {}),
        provenance: provenance || role.role,
      });
    }
    void total;
  }
  return { slots, warnings };
}

/**
 * Deterministic largest-remainder allocation of a total across roles, using
 * saved order and default-count weights (design §6 rule 3). Required roles
 * retain at least one slot.
 */
export function distributeTotal(preset: TeamPresetV1, size: number): Record<string, number> {
  const defaultCounts = preset.roles.map((r) => ({ role: r.role, weight: r.count, required: !!r.required }));
  const totalWeight = defaultCounts.reduce((a, b) => a + b.weight, 0) || 1;
  // Rule 3 invariant: required roles keep ≥ 1 each.
  const requiredCount = defaultCounts.filter((r) => r.required).length;
  const distributeable = Math.max(0, size - requiredCount);
  const quotas = defaultCounts.map((r) => {
    const base = r.required ? 1 : 0;
    const extra = (r.weight / totalWeight) * distributeable;
    return { role: r.role, value: base + extra };
  });
  // Largest remainder: floor all, then assign remaining units to largest
  // fractional remainders in saved order (ties → earlier role wins).
  const floors = quotas.map((q) => Math.floor(q.value));
  let assigned = floors.reduce((a, b) => a + b, 0);
  const remainders = quotas.map((q, i) => ({ i, rem: q.value - Math.floor(q.value) }));
  remainders.sort((a, b) => b.rem - a.rem || a.i - b.i);
  let idx = 0;
  while (assigned < size && idx < remainders.length) {
    floors[remainders[idx].i]++;
    assigned++;
    idx++;
  }
  const out: Record<string, number> = {};
  defaultCounts.forEach((r, i) => { out[r.role] = floors[i]; });
  // Normalize negative/zero floors for required roles (safety).
  for (const r of defaultCounts) {
    if (r.required && out[r.role] < 1) out[r.role] = 1;
  }
  return out;
}

/** The design's model/provider/profile precedence list (§6), for UI rendering. */
export const ASSIGNMENT_PRECEDENCE = [
  "one-run-slot-override",
  "saved-slot-override",
  "one-run-role-override",
  "saved-role-spec",
  "team-profile",
  "agent-definition",
  "session-subagent",
  "default-model",
] as const;

/**
 * validateTeamPreset (design §11) — pure, deterministic, side-effect free.
 * Returns structured errors and warnings. Hard errors fail validation.
 *
 * `discovered` (optional) supplies the runtime-known agent types for the
 * missing-type / model-provider checks. `limits` supplies project caps.
 */
export function validateTeamPreset(
  preset: TeamPresetV1,
  discovered?: DiscoveredAgentType[],
  limits?: { projectCap?: number; allowDefinitionDrift?: boolean },
): PresetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (preset.schemaVersion !== 1) {
    errors.push(`unsupported schemaVersion ${preset.schemaVersion}`);
    return { errors, warnings, valid: false };
  }
  if (!preset.id || KEBAB_RE.test(preset.id) === false) {
    errors.push(`invalid preset id "${preset.id}" (must be kebab-case)`);
  }
  if (!preset.name || KEBAB_RE.test(preset.name) === false) {
    errors.push(`invalid preset name "${preset.name}" (must be kebab-case)`);
  }
  if (!Array.isArray(preset.roles) || preset.roles.length === 0) {
    errors.push("preset must declare at least one role");
  }

  const { min, default: def, max } = preset.size;
  if (!Number.isInteger(min) || !Number.isInteger(def) || !Number.isInteger(max)) {
    errors.push("size min/default/max must be integers");
  }
  if (min > def || def > max) {
    errors.push(`size bounds invalid: min ${min}, default ${def}, max ${max} (require min <= default <= max)`);
  }
  if (max > HARD_SLOT_LIMIT) {
    errors.push(`size max ${max} exceeds hard slot limit ${HARD_SLOT_LIMIT}`);
  }
  if (limits?.projectCap !== undefined && def > limits.projectCap) {
    errors.push(`preset default ${def} exceeds project cap ${limits.projectCap}`);
  }

  // Role validation.
  const roleIds = new Set<string>();
  const seenSlots = new Set<string>();
  let defaultSum = 0;
  for (const role of preset.roles ?? []) {
    if (typeof role.role !== "string" || !role.role) {
      errors.push("role missing name");
      continue;
    }
    if (roleIds.has(role.role)) {
      errors.push(`duplicate role "${role.role}"`);
    }
    roleIds.add(role.role);
    if (typeof role.count !== "number" || !Number.isInteger(role.count) || role.count < 0) {
      errors.push(`role "${role.role}" count must be a non-negative integer`);
    } else {
      defaultSum += role.count;
    }
    if (!role.agentType) errors.push(`role "${role.role}" missing agentType`);
    if (discovered && role.agentType && !discovered.some((a) => a.id === role.agentType)) {
      errors.push(`role "${role.role}" references missing agent type "${role.agentType}"`);
    }
    if (role.dependsOnRoles) {
      for (const dep of role.dependsOnRoles) {
        if (dep === role.role) errors.push(`role "${role.role}" depends on itself`);
        if (!roleIds.has(dep) && !preset.roles.some((r) => r.role === dep)) {
          errors.push(`role "${role.role}" depends on missing role "${dep}"`);
        }
      }
    }
  }
  if (defaultSum !== 0 && defaultSum !== def) {
    errors.push(`sum of role counts (${defaultSum}) != size.default (${def})`);
  }
  if (defaultSum === 0 && def > 0) {
    errors.push("preset expands to zero slots");
  }

  // Slot override validation.
  for (const slot of preset.slots ?? []) {
    if (!slot.role || !roleIds.has(slot.role)) {
      errors.push(`slot "${slot.slotId}" references unknown role "${slot.role}"`);
    }
    if (!Number.isInteger(slot.ordinal) || slot.ordinal < 0) {
      errors.push(`slot "${slot.slotId}" ordinal must be a non-negative integer`);
    }
    const key = `${slot.role}:${slot.ordinal}`;
    if (seenSlots.has(key)) {
      errors.push(`duplicate slot target for role "${slot.role}" ordinal ${slot.ordinal}`);
    }
    seenSlots.add(key);
    if (slot.agentType && discovered && !discovered.some((a) => a.id === slot.agentType)) {
      errors.push(`slot "${slot.slotId}" references missing agent type "${slot.agentType}"`);
    }
  }

  // Failure policy validation.
  const fp = preset.failurePolicy ?? { kind: "continue" };
  if (fp.kind === "minimum_success") {
    if (!Number.isInteger(fp.count) || fp.count < 1 || fp.count > def) {
      errors.push(`minimum_success count must be in 1..default (${def})`);
    }
  }
  if (fp.kind === "required_roles" && !preset.roles.some((r) => r.required)) {
    errors.push("required_roles policy but no role is marked required");
  }

  // Dependency cycle detection (role waves, §4).
  const depMap = new Map<string, string[]>();
  for (const r of preset.roles ?? []) depMap.set(r.role, r.dependsOnRoles ?? []);
  for (const start of depMap.keys()) {
    const visiting = new Set<string>([start]);
    const stack: string[] = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const dep of depMap.get(cur) ?? []) {
        if (visiting.has(dep)) {
          errors.push(`role dependency cycle involving "${start}" (-> "${dep}")`);
          stack.length = 0;
          break;
        }
        visiting.add(dep);
        stack.push(dep);
      }
    }
  }

  // Warnings (design §11).
  if (preset.roles) warnings.push("preset composition is explicit and flat (V1)");
  if (discovered) {
    const usedTypes = new Set(preset.roles.map((r) => r.agentType));
    for (const a of discovered) {
      if (!usedTypes.has(a.id)) warnings.push(`unused discovered agent type "${a.id}"`);
    }
  }
  if (preset.maxConcurrent !== undefined && preset.maxConcurrent > preset.roles.length) {
    warnings.push(`concurrency ${preset.maxConcurrent} above role count ${preset.roles.length}`);
  }

  return { errors, warnings, valid: errors.length === 0 };
}

/** Effective concurrency cap (design §9): min(runnable, preset.maxConcurrent,
 *  project cap, 24). */
export function effectiveConcurrency(opts: {
  runnableSlots: number;
  presetMaxConcurrent?: number;
  projectConcurrency?: number;
}): number {
  const cap = Math.min(
    opts.runnableSlots,
    opts.presetMaxConcurrent ?? HARD_SLOT_LIMIT,
    opts.projectConcurrency ?? HARD_SLOT_LIMIT,
    HARD_SLOT_LIMIT,
  );
  return Math.max(TEAM_CONCURRENCY_MIN, cap);
}

/** Validate the requested expanded size against preset bounds + caps. */
export function validateExpansion(opts: {
  preset: TeamPresetV1;
  sizeOverride?: number;
  roleCounts?: Record<string, number>;
  projectCap?: number;
}): PresetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { preset } = opts;

  let total: number;
  if (opts.roleCounts && Object.keys(opts.roleCounts).length > 0) {
    let sum = 0;
    for (const r of preset.roles) {
      sum += opts.roleCounts[r.role] ?? r.count;
    }
    total = sum;
    if (opts.sizeOverride !== undefined && total !== opts.sizeOverride) {
      errors.push(`per-role counts sum (${total}) != requested total (${opts.sizeOverride})`);
    }
  } else {
    total = opts.sizeOverride ?? preset.size.default;
  }

  if (total < preset.size.min) errors.push(`total ${total} below preset min ${preset.size.min}`);
  if (total > preset.size.max) errors.push(`total ${total} above preset max ${preset.size.max}`);
  if (total > HARD_SLOT_LIMIT) errors.push(`total ${total} above hard limit ${HARD_SLOT_LIMIT}`);
  if (opts.projectCap !== undefined && total > opts.projectCap) {
    errors.push(`total ${total} above project cap ${opts.projectCap}`);
  }
  return { errors, warnings, valid: errors.length === 0 };
}

/** Build a run snapshot (design §8 teamSnapshotJson) from an expansion. */
export function buildSnapshot(opts: {
  preset: TeamPresetV1;
  slots: SlotResolution[];
  requestedSize: number;
  effectiveConcurrency: number;
  createdAt: number;
}): TeamSnapshotV1 {
  return {
    presetId: opts.preset.id,
    presetName: opts.preset.name,
    presetRevision: opts.preset.revision,
    schemaVersion: 1,
    source: opts.preset.source,
    size: { ...opts.preset.size },
    requestedSize: opts.requestedSize,
    effectiveConcurrency: opts.effectiveConcurrency,
    failurePolicy: deepCopyPolicy(opts.preset.failurePolicy ?? { kind: "continue" }),
    slots: opts.slots.map((s) => ({ ...s })),
    createdAt: opts.createdAt,
  };
}

function deepCopyPolicy(p: TeamFailurePolicy): TeamFailurePolicy {
  if (p.kind === "minimum_success") return { kind: "minimum_success", count: p.count };
  if (p.kind === "fail_fast") return { kind: "fail_fast", cancelRunning: p.cancelRunning };
  return { kind: p.kind };
}

/** Slugify a display name into the kebab-case name used as a preset identity. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
