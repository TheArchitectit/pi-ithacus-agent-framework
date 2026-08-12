/**
 * types-sprint-5.21.ts — Sprint 5.21 (docs/DESIGN_TEAMS_AND_SIZES.md) typed
 * team composition, sizing, and versioned-preset types.
 *
 * Split out of src/types.ts (which is at its line budget) so the versioned
 * team-preset schema has its own home. pi-agnostic; new modules import
 * directly from './types-sprint-5.21.js'.
 *
 * Scope: this Sprint implements the named-preset foundation — types, pure
 * validation/expansion, additive schema, and legacy virtual presets (`Stage 0`
 * + `Stage 1` inspect/dry-run of the design's rollout). No dispatch-path
 * changes are made here; those are a later reviewed stage.
 */

/** Elastic bounds on the total expanded slot count for a team preset. */
export interface TeamSizePolicy {
  /** min total expanded slots (mandatory `min <= default`). */
  min: number;
  /** the normal expanded size. `min <= default <= max`. */
  default: number;
  /** max total expanded slots (`default <= max`, and `max <= 24` hard limit). */
  max: number;
}

/** One role in a versioned team composition. A role references one agent type. */
export interface TeamRoleSpec {
  role: string;
  agentType: string;
  /** how many concrete slots this role expands to at default size. */
  count: number;
  /** when true, this role gates success under the `required_roles` policy. */
  required?: boolean;
  /** per-role model override (precedence level 4). */
  model?: string;
  /** per-role provider override. */
  provider?: string;
  /** per-role model-profile id override. */
  profileId?: string;
  /** roles that must reach a terminal success state before these run. */
  dependsOnRoles?: string[];
}

/** A single concrete-slot override: matched by (role, ordinal). */
export interface TeamSlotOverride {
  /** human-stable slot id within the preset, e.g. "review-primary". */
  slotId: string;
  role: string;
  /** zero-based occurrence within role. */
  ordinal: number;
  agentType?: string;
  model?: string;
  provider?: string;
  profileId?: string;
}

/** Terminal-success / failure policy for a team run (§10 of the design). */
export type TeamFailurePolicy =
  | { kind: "continue" }
  | { kind: "fail_fast"; cancelRunning?: boolean }
  | { kind: "required_roles" }
  | { kind: "minimum_success"; count: number };

/** A versioned named team composition (schemaVersion 1). */
export interface TeamPresetV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  size: TeamSizePolicy;
  roles: TeamRoleSpec[];
  slots?: TeamSlotOverride[];
  /** max parallel children at any instant (hard-capped at 24). */
  maxConcurrent?: number;
  failurePolicy?: TeamFailurePolicy;
  source: "builtin" | "user" | "stored" | "project";
  revision: number;
}

export type TeamPresetSource = TeamPresetV1["source"];

/** A resolved model/provider/profile assignment for one expanded slot. */
export interface SlotResolution {
  slotId: string;
  role: string;
  ordinal: number;
  agentType: string;
  model?: string;
  provider?: string;
  profileId?: string;
  /** provenance of the winning assignment (for auditability / UI). */
  provenance: string;
}

/** The fully expanded, validated roster snapshot persisted per run. */
export interface TeamSnapshotV1 {
  presetId: string;
  presetName: string;
  presetRevision: number;
  schemaVersion: 1;
  source: TeamPresetSource;
  size: TeamSizePolicy;
  requestedSize: number;
  effectiveConcurrency: number;
  failurePolicy: TeamFailurePolicy;
  slots: SlotResolution[];
  createdAt: number;
}

/** A single terminal per-slot outcome record (truthful, no stub completion). */
export interface SlotOutcome {
  slotId: string;
  status: "completed" | "failed" | "skipped" | "cancelled";
  attempt: number;
  resultSummary?: string;
  error?: string;
}

/** Overall team-run terminal status (§10). */
export type TeamRunStatus =
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

/** Structured errors and warnings from validateTeamPreset (§11). */
export interface PresetValidation {
  errors: string[];
  warnings: string[];
  valid: boolean;
}

/** Runtime-discovered agent descriptor (extension adapter feeds these to src/). */
export interface DiscoveredAgentType {
  id: string;
  displayName: string;
  source: TeamPresetSource;
  model?: string;
  provider?: string;
  tools: string[];
  permission?: string;
  /** local content hash for drift visibility (not an identity). */
  fingerprint: string;
}

/** Persisted legacy-vs-versioned team row shape (5.19 ith_teams → preset). */
export interface StoredTeamPreset {
  presetId: string;
  name: string;
  source: TeamPresetSource;
  schemaVersion: number;
  revision: number;
  definitionJson: string;
  status: "active" | "deleted";
  createdAt: number;
  updatedAt: number;
}
