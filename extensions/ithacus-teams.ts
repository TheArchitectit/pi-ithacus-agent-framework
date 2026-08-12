/**
 * ithacus-teams.ts — the `/ithacus-teams` overlay + command surface
 * (Sprint 5.19 docs/DESIGN_TEAMS_CRONS.md §2.3; Sprint 5.21
 * docs/DESIGN_TEAMS_AND_SIZES.md §7).
 *
 * Lists named teams, views their slot rosters, enables/disables team-bound
 * cron schedules, triggers a dry-run roster preview, and exposes the versioned
 * team-preset catalog (list/show/validate) from Sprint 5.21 Stage 1.
 *
 * The overlay is a read-mostly Component (like /ithacus-checkpoints): list
 * teams/schedules/presets, select a row, view slots, toggle a schedule. Never
 * mutates live conversations. Command handlers intentionally run through the
 * pure src/ modules (team-registry.js, team-presets.js) so validation and
 * precedence are shared with any future dispatch path.
 *
 * PREVENT-ITH-004: local node:sqlite reads/writes only — zero network, no
 * subprocess spawn (named-team fires reuse the existing scheduler / async path
 * elsewhere; this surface only manages the durable definitions). Fields are
 * declared explicitly (no parameter properties).
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { IthRuntime } from "./ithacus-runtime.js";
import {
  listTeams,
  getTeam,
  createTeamDefinition,
  deleteTeamDefinition,
  listTeamSchedules,
  createTeamSchedule,
  setTeamScheduleEnabled,
  type TeamDefinition,
  type TeamAgentSlot,
} from "../src/team-registry.js";
import {
  builtinPresets,
  builtinPresetById,
  presetFromLegacyMode,
  validateTeamPreset,
  expandRoster,
  isLegacyModeName,
} from "../src/team-presets.js";
import type { ModePreset } from "../src/config.js";

interface ThemeLike {
  fg: (color: string, text: string) => string;
  bold?: (text: string) => string;
}
const NO_THEME: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };

/** Dash the model overrides in a slot list for compact rendering. */
function fmtSlots(agents: TeamAgentSlot[]): string {
  return agents
    .map((a) => (a.modelOverride ? `${a.role}@${a.modelOverride}` : a.role))
    .join(", ");
}

/** Compact listing of a versioned preset's roles. */
function fmtPresetRoles(preset: { roles?: Array<{ role: string; count: number }> }): string {
  if (!preset || !Array.isArray(preset.roles)) return "";
  return (preset.roles ?? []).map((r) => `${r.role}×${r.count}`).join(", ");
}

// ---------------------------------------------------------------------------
// /ithacus-teams overlay (Sprint 5.19 §2.3; Sprint 5.21 §7 review UI)
// ---------------------------------------------------------------------------

type OverlayMode =
  | { kind: "teams" }
  | { kind: "team-detail"; team: TeamDefinition }
  | { kind: "presets" }
  | { kind: "preset-detail"; presetId: string };

class IthTeamsOverlay {
  private t: ThemeLike;
  private runtime: IthRuntime;
  private done: (value: null) => void;
  private requestRender: () => void;
  private mode: OverlayMode = { kind: "teams" };
  private cursor = 0;
  private teams: TeamDefinition[] = [];
  private presets: string[] = [];
  private note: string | null = null;

  constructor(
    runtime: IthRuntime,
    done: (value: null) => void,
    requestRender: () => void,
    theme?: ThemeLike,
  ) {
    this.runtime = runtime;
    this.done = done;
    this.requestRender = requestRender;
    this.t = theme ?? NO_THEME;
    this.refresh();
  }

  private refresh(): void {
    this.teams = listTeams(this.runtime.store);
    this.presets = builtinPresets().map((p) => p.id);
    if (this.cursor >= this.teams.length) this.cursor = Math.max(0, this.teams.length - 1);
  }

  invalidate(): void {
    /* re-read on refresh() */
  }

  handleInput(data: string): void {
    if (data === "\u001b" || data === "q") {
      this.done(null);
      return;
    }
    if (data === "r") {
      this.mode = { kind: "teams" };
      this.refresh();
      this.note = null;
      this.requestRender();
      return;
    }

    if (this.mode.kind === "teams") {
      if (data === "j" || data === "down" || data === "\u001b[B") {
        this.cursor = Math.min(this.teams.length - 1, this.cursor + 1);
        this.requestRender();
        return;
      }
      if (data === "k" || data === "up" || data === "\u001b[A") {
        this.cursor = Math.max(0, this.cursor - 1);
        this.requestRender();
        return;
      }
      if (data === "p") {
        this.mode = { kind: "presets" };
        this.cursor = 0;
        this.requestRender();
        return;
      }
      if (data === "v") {
        const sel = this.teams[this.cursor];
        if (sel) {
          this.mode = { kind: "team-detail", team: sel };
          this.requestRender();
        }
      }
      return;
    }

    if (this.mode.kind === "presets") {
      if (data === "j" || data === "down" || data === "\u001b[B") {
        this.cursor = Math.min(this.presets.length - 1, this.cursor + 1);
        this.requestRender();
        return;
      }
      if (data === "k" || data === "up" || data === "\u001b[A") {
        this.cursor = Math.max(0, this.cursor - 1);
        this.requestRender();
        return;
      }
      if (data === "t") {
        this.mode = { kind: "teams" };
        this.cursor = 0;
        this.requestRender();
        return;
      }
      if (data === "v") {
        const sel = this.presets[this.cursor];
        if (sel) {
          this.mode = { kind: "preset-detail", presetId: sel };
          this.requestRender();
        }
      }
      return;
    }

    if (this.mode.kind === "team-detail" || this.mode.kind === "preset-detail") {
      if (data === "c" || data === "\u001b" || data === "q") {
        this.mode = this.mode.kind === "team-detail" ? { kind: "teams" } : { kind: "presets" };
        this.requestRender();
      }
    }
  }

  render(width: number): string[] {
    const w = Math.max(40, Math.min(width, 90));
    const t = this.t;
    const bold = t.bold ?? ((x: string) => x);
    const fg = (c: string, s: string): string => {
      try {
        return t.fg(c, s);
      } catch {
        return s;
      }
    };
    const lines: string[] = [];
    lines.push(bold("ithacus — teams"), "");

    if (this.note) {
      lines.push(fg("accent", `• ${this.note}`), "");
    }

    if (this.mode.kind === "team-detail") {
      const d = this.mode.team;
      const scheds = listTeamSchedules(this.runtime.store, d.teamId);
      lines.push(fg("accent", `▌ ${d.name}`));
      if (d.description) lines.push(d.description);
      lines.push(`slots: ${fmtSlots(d.agents)}`);
      lines.push(`template: ${d.taskTemplate}`);
      if (scheds.length === 0) {
        lines.push(fg("muted", "no cron schedules bound."));
      } else {
        for (const s of scheds) {
          lines.push(
            `  cron ${s.cron} · ${s.enabled ? "enabled" : "disabled"}` +
              (s.nextFireAt ? ` · next ${new Date(s.nextFireAt).toISOString()}` : ""),
          );
        }
      }
      lines.push("");
      lines.push(fg("muted", " [c]/esc back"));
      return lines.map((l) => (l.length > w ? l.slice(0, w) : l));
    }

    if (this.mode.kind === "preset-detail") {
      const p =
        builtinPresetById(this.mode.presetId) ??
        presetFromLegacyMode(this.mode.presetId as ModePreset);
      if (!p) {
        lines.push(fg("muted", "preset not found"));
      } else {
        const vr = validateTeamPreset(p);
        lines.push(fg("accent", `▌ ${p.name}  ·  r${p.revision}  ·  ${p.source}`));
        if (p.description) lines.push(p.description);
        lines.push(
          `size: ${p.size.min}/${p.size.default}/${p.size.max}` +
            (p.maxConcurrent ? ` · concurrency ${p.maxConcurrent}` : ""),
        );
        lines.push(`composition: ${fmtPresetRoles(p)}`);
        lines.push(`policy: ${(p.failurePolicy ?? { kind: "continue" }).kind}`);
        const dry = expandRoster({ preset: p, runId: "preview" });
        lines.push(fg("muted", `dry-run roster: ${dry.slots.length} slots`));
        if (vr.valid) lines.push(fg("success", "\u2713 valid"));
        else lines.push(fg("error", `\u2717 ${vr.errors.join("; ")}`));
      }
      lines.push("");
      lines.push(fg("muted", " [c]/esc back"));
      return lines.map((l) => (l.length > w ? l.slice(0, w) : l));
    }

    const isTeams = this.mode.kind === "teams";
    if (isTeams) {
      if (this.teams.length === 0) {
        lines.push(fg("muted", "no named teams yet (see /ithacus-teams create <name>)."));
      } else {
        for (let i = 0; i < this.teams.length; i++) {
          const d = this.teams[i];
          const marker = i === this.cursor ? fg("accent", `\u203a ${i + 1} `) : `  ${i + 1} `;
          lines.push(`${marker}${d.name}  · ${fmtSlots(d.agents)}`);
        }
      }
      lines.push("");
      lines.push(fg("muted", " [1-9] select · v view · p presets · r refresh · q/esc close"));
    } else {
      for (let i = 0; i < this.presets.length; i++) {
        const id = this.presets[i];
        const p = builtinPresetById(id) ?? presetFromLegacyMode(id as ModePreset);
        const marker = i === this.cursor ? fg("accent", `\u203a ${i + 1} `) : `  ${i + 1} `;
        lines.push(`${marker}${id}${isLegacyModeName(id) ? " (legacy)" : ""} · ${p ? `${p.size.default} slots` : "?"}`);
      }
      lines.push("");
      lines.push(fg("muted", " [1-9] select · v view · t teams · r refresh · q/esc close"));
    }
    return lines.map((l) => (l.length > w ? l.slice(0, w) : l));
  }
}

// ---------------------------------------------------------------------------
// Command surface
// ---------------------------------------------------------------------------

export function registerTeamsCommand(pi: ExtensionAPI, runtime: IthRuntime): void {
  pi.registerCommand("ithacus-teams", {
    description:
      "Named team registry + versioned presets + cron schedules (list, show, create, delete, schedule)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      runtime.bindRepo(ctx.cwd);
      const say = (msg: string, level: "info" | "error" = "info"): void => {
        ctx.ui.notify(msg, level);
      };
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? "";

      // Bare /ithacus-teams → open the overlay.
      if (sub === "" || sub === "ui" || sub === "overlay") {
        await ctx.ui.custom<null>(
          (_tui, theme, _keybindings, done) =>
            new IthTeamsOverlay(
              runtime,
              done,
              () => _tui.requestRender(),
              theme as ThemeLike,
            ),
          { overlay: true },
        );
        return;
      }

      if (sub === "list") {
        const teams = listTeams(runtime.store);
        if (teams.length === 0) {
          say("ithacus — no named teams yet.");
          return;
        }
        say(
          teams
            .map((d) => `- ${d.name} · ${fmtSlots(d.agents)}${d.presetId ? ` · preset ${d.presetId}` : ""}`)
            .join("\n"),
        );
        return;
      }

      if (sub === "show") {
        const name = parts[1];
        if (!name) {
          say("usage: /ithacus-teams show <name>");
          return;
        }
        const team = getTeam(runtime.store, name);
        if (!team) {
          say(`ithacus — no team named "${name}".`);
          return;
        }
        const scheds = listTeamSchedules(runtime.store, team.teamId);
        const schedLines = scheds.length
          ? scheds.map((s) => `  cron ${s.cron} · ${s.enabled ? "enabled" : "disabled"}`)
          : ["  (no schedules)"];
        say(
          [
            `# ${team.name}`,
            team.description ?? "",
            `slots: ${fmtSlots(team.agents)}`,
            `template: ${team.taskTemplate}`,
            "schedules:",
            ...schedLines,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }

      if (sub === "create") {
        const name = parts[1];
        const rest = parts.slice(2).join(" ");
        if (!name) {
          say("usage: /ithacus-teams create <name> [slots...]\n e.g. create daily-review Explore Plan Verification");
          return;
        }
        const roles = rest.split(/[,+\s]+/).filter((r) => r && /^[a-zA-Z][a-zA-Z0-9]*$/.test(r));
        const agents: TeamAgentSlot[] = roles.length
          ? roles.map((r) => ({ role: r }))
          : [{ role: "Explore" }, { role: "Plan" }];
        const team: TeamDefinition = {
          teamId: crypto.randomUUID(),
          name,
          description: `Named team "${name}"`,
          agents,
          taskTemplate: "Run the configured workflow for {{subject}}",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        try {
          createTeamDefinition(runtime.store, team);
          say(`ithacus — created team "${name}" (${agents.length} slots).`);
        } catch (err) {
          say(`ithacus — ${(err as Error).message}`, "error");
        }
        return;
      }

      if (sub === "delete") {
        const name = parts[1];
        if (!name) {
          say("usage: /ithacus-teams delete <name>");
          return;
        }
        const team = getTeam(runtime.store, name);
        if (!team) {
          say(`ithacus — no team named "${name}".`);
          return;
        }
        deleteTeamDefinition(runtime.store, team.teamId);
        say(`ithacus — deleted team "${name}".`);
        return;
      }

      if (sub === "schedule") {
        // /ithacus-teams schedule <team> <cron>
        const teamName = parts[1];
        const cron = parts.slice(2).join(" ");
        if (!teamName || !cron) {
          say("usage: /ithacus-teams schedule <team> <cron 5-field>");
          return;
        }
        const team = getTeam(runtime.store, teamName);
        if (!team) {
          say(`ithacus — no team named "${teamName}".`);
          return;
        }
        try {
          createTeamSchedule(
            runtime.store,
            {
              scheduleId: crypto.randomUUID(),
              teamId: team.teamId,
              cron,
              enabled: true,
            },
            Date.now(),
          );
          say(`ithacus — scheduled team "${team.name}" on cron \`${cron}\`.`);
        } catch (err) {
          say(`ithacus — ${(err as Error).message}`, "error");
        }
        return;
      }

      if (sub === "preset") {
        const action = parts[1] ?? "list";
        if (action === "list") {
          say(
            builtinPresets()
              .map((p) => `- ${p.name} · ${p.size.default} slots · ${p.source}${isLegacyModeName(p.id) ? " (legacy)" : ""}`)
              .join("\n"),
          );
          return;
        }
        if (action === "show") {
          const id = parts[2];
          if (!id) {
            say("usage: /ithacus-teams preset show <id>");
            return;
          }
          const p = builtinPresetById(id) ?? presetFromLegacyMode(id as ModePreset);
          if (!p) {
            say(`ithacus — no preset "${id}".`);
            return;
          }
          say(
            [
              `# ${p.name} (r${p.revision}, ${p.source})`,
              p.description ?? "",
              `size: ${p.size.min}/${p.size.default}/${p.size.max}`,
              `composition: ${fmtPresetRoles(p)}`,
              `policy: ${(p.failurePolicy ?? { kind: "continue" }).kind}`,
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return;
        }
        if (action === "validate") {
          const id = parts[2];
          if (!id) {
            say("usage: /ithacus-teams preset validate <id>");
            return;
          }
          const p = builtinPresetById(id) ?? presetFromLegacyMode(id as ModePreset);
          if (!p) {
            say(`ithacus — no preset "${id}".`);
            return;
          }
          const vr = validateTeamPreset(p);
          say(
            vr.valid
              ? `ithacus — preset "${id}" valid (${vr.warnings.length} warnings).`
              : `ithacus — preset "${id}" INVALID:\n  ${vr.errors.join("\n  ")}`,
            vr.valid ? "info" : "error",
          );
          return;
        }
        say("usage: /ithacus-teams preset (list|show <id>|validate <id>)");
        return;
      }

      say(
        [
          "ithacus-teams — subcommands",
          "  list                       list named teams",
          "  show <name>                view a team + its schedules",
          "  create <name> [roles...]   create a named team",
          "  delete <name>              delete a named team",
          "  schedule <team> <cron>     bind a 5-field cron to a team",
          "  preset (list|show|validate <id>)",
          "  (no args)                  open the teams overlay",
        ].join("\n"),
      );
    },
  });
}
