/**
 * team-registry.ts — Sprint 5.19 (docs/DESIGN_TEAMS_CRONS.md §2.1/§2.2):
 * a named team registry + team-bound scheduled crons.
 *
 * pi-agnostic: pure CRUD over the store's `ith_teams` + `ith_team_schedules`
 * tables. Zero network (PREVENT-ITH-004 — no annotation needed). The actual
 * execution on a schedule fire reuses the existing src/team.ts plan + the
 * async-run path — no new execution engine (design §2.2).
 *
 * Storage and shape follow the claw-code TeamRegistry + CronRegistry pattern
 * adapted to ithacus's sqlite store: a TeamDefinition names a recurring team
 * composition (agents + a {{placeholder}} task template); a TeamSchedule
 * binds a validated 5-field cron to a team. Schedules are durable, survive
 * restarts, and show in /ithacus-teams.
 */

import type { IthStore } from "./store.js";
import { nextCronFire } from "./scheduler.js";

/** A named, recurring team composition (design §2.1). */
export interface TeamDefinition {
  /** uuid team id (PRIMARY KEY, immutable). */
  teamId: string;
  /** unique, kebab-case name. */
  name: string;
  description?: string;
  /** slot roster: role + optional model/permission overrides. */
  agents: TeamAgentSlot[];
  /** run title template with {{placeholders}}, expanded on fire. */
  taskTemplate: string;
  /** preset id to compose this team from (Sprint 5.21 linkage, optional). */
  presetId?: string;
  createdAt: number;
  updatedAt: number;
}

/** One role slot in a named team definition. */
export interface TeamAgentSlot {
  role: string;
  modelOverride?: string;
  permissionMode?: string;
}

/** A team-bound cron schedule (design §2.2). */
export interface TeamSchedule {
  scheduleId: string;
  teamId: string;
  cron: string;
  enabled: boolean;
  lastFiredAt?: number;
  /** derived next fire (epoch ms), not stored-computed twice. */
  nextFireAt: number;
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Create (or overwrite-by-name) a named team. Throws on duplicate name or
 *  invalid cron in the schedule. */
export function createTeamDefinition(store: IthStore, def: TeamDefinition): TeamDefinition {
  if (!def.teamId) throw new Error("team requires a teamId");
  if (!KEBAB_RE.test(def.name)) {
    throw new Error(`invalid team name "${def.name}" (must be kebab-case)`);
  }
  const existing = getTeamByName(store, def.name);
  if (existing) throw new Error(`team name "${def.name}" already exists`);
  store.saveTeamDefinition(def);
  return def;
}

/** List all non-deleted named teams. */
export function listTeams(store: IthStore): TeamDefinition[] {
  return store.listTeamDefinitions();
}

/** Get a team by id or (kebab-case) name. */
export function getTeam(store: IthStore, teamIdOrName: string): TeamDefinition | null {
  if (KEBAB_RE.test(teamIdOrName)) {
    const byName = getTeamByName(store, teamIdOrName);
    if (byName) return byName;
  }
  return store.getTeamDefinition(teamIdOrName);
}

function getTeamByName(store: IthStore, name: string): TeamDefinition | null {
  return store.getTeamDefinitionByName(name);
}

/** Update a named team (name immutability: update patch.name is a no-op).
 *  Returns the updated definition, or null if the team doesn't exist. */
export function updateTeam(
  store: IthStore,
  teamId: string,
  patch: Partial<Omit<TeamDefinition, "teamId" | "createdAt">>,
): TeamDefinition | null {
  const existing = store.getTeamDefinition(teamId);
  if (!existing) return null;
  const updated: TeamDefinition = {
    ...existing,
    ...patch,
    teamId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  store.saveTeamDefinition(updated);
  return updated;
}

/** Soft-delete a named team (status "deleted", keeps history — §2.1). */
export function deleteTeamDefinition(store: IthStore, teamId: string): boolean {
  return store.softDeleteTeam(teamId);
}

/** Expand the {{placeholders}} in a task template against a context map. */
export function expandTaskTemplate(
  template: string,
  ctx: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) =>
    ctx[key] !== undefined ? String(ctx[key]) : `{{${key}}}`,
  );
}

// ---- Team-bound schedules (design §2.2) ---------------------------------

/** Create a team-bound cron schedule. Validates the cron via existing
 *  nextCronFire so a bad expression is rejected at creation time. */
export function createTeamSchedule(
  store: IthStore,
  sched: Omit<TeamSchedule, "nextFireAt">,
  now: number,
): TeamSchedule {
  const team = store.getTeamDefinition(sched.teamId);
  if (!team) throw new Error(`team "${sched.teamId}" not found`);
  // Validate the cron (throws on invalid — reuse nextCronFire).
  nextCronFire(sched.cron, now);
  const schedule: TeamSchedule = {
    ...sched,
    nextFireAt: nextCronFire(sched.cron, now),
  };
  store.saveTeamSchedule(schedule);
  return schedule;
}

/** List team-bound schedules (optionally only for one team). */
export function listTeamSchedules(store: IthStore, teamId?: string): TeamSchedule[] {
  return store.listTeamSchedules(teamId);
}

/** Enable/disable a team schedule; recomputes nextFireAt on enable. */
export function setTeamScheduleEnabled(
  store: IthStore,
  scheduleId: string,
  enabled: boolean,
  now: number,
): TeamSchedule | null {
  const sched = store.getTeamSchedule(scheduleId);
  if (!sched) return null;
  const updated: TeamSchedule = {
    ...sched,
    enabled,
    nextFireAt: enabled ? nextCronFire(sched.cron, now) : sched.nextFireAt,
  };
  store.saveTeamSchedule(updated);
  return updated;
}

/** Advance a schedule's lastFiredAt + nextFireAt after a fire (durable). */
export function recordTeamScheduleFire(
  store: IthStore,
  scheduleId: string,
  now: number,
): TeamSchedule | null {
  const sched = store.getTeamSchedule(scheduleId);
  if (!sched || !sched.enabled) return null;
  const updated: TeamSchedule = {
    ...sched,
    lastFiredAt: now,
    nextFireAt: nextCronFire(sched.cron, now),
  };
  store.saveTeamSchedule(updated);
  return updated;
}

/** The team-bound schedules whose next fire is at/before `now` (due). */
export function teamSchedulesDue(store: IthStore, now: number): TeamSchedule[] {
  return store
    .listTeamSchedules()
    .filter((s) => s.enabled && s.nextFireAt > 0 && s.nextFireAt <= now);
}
