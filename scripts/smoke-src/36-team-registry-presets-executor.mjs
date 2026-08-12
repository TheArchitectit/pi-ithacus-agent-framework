import {
  failures, check, buildDir, tmpRepo, cfg, IthStore, teamRegistry, teamPresets, teamExec, types521,
  mkdtempSync, rmSync, tmpdir, join, execSync,
} from "./_harness.mjs";

export async function run(ctx) {
  const { IthStore: IS } = { IthStore: IthStore };
  const dir = mkdtempSync(join(tmpdir(), "ith-teams-"));
  // git-init so repoStateDir scopes the store to this temp repo (isolated),
  // rather than the persistent global default shared by all in-process stores.
  execSync("git init -q && git config user.email t@t.co && git config user.name t", { cwd: dir, stdio: "ignore" });
  const store = new IS(dir, cfg.loadConfig());

  // ---- Sprint 5.19: named team registry (team-registry) --------------------
  const { createTeamDefinition, listTeams, getTeam, updateTeam, deleteTeamDefinition, expandTaskTemplate } = teamRegistry;
  {
    // create + list + get by name
    const def = createTeamDefinition(store, {
      teamId: "team-1",
      name: "daily-review",
      description: "Daily review crew",
      agents: [{ role: "Explore" }, { role: "Plan", modelOverride: "gpt-4o" }],
      taskTemplate: "Review {{subject}}",
      createdAt: 1,
      updatedAt: 1,
    });
    check("registry.create returns def", def.name === "daily-review");
    check("registry.list 1", listTeams(store).length === 1);
    check("registry.get by name", getTeam(store, "daily-review")?.teamId === "team-1");
    check("registry.get by id", getTeam(store, "team-1")?.name === "daily-review");

    // duplicate name rejected
    let dupErr = null;
    try {
      createTeamDefinition(store, {
        teamId: "team-x",
        name: "daily-review",
        agents: [],
        taskTemplate: "",
        createdAt: 2,
        updatedAt: 2,
      });
    } catch (e) { dupErr = e.message; }
    check("registry.dup-name throws", typeof dupErr === "string" && dupErr.includes("already exists"));

    // invalid name rejected
    let badErr = null;
    try {
      createTeamDefinition(store, {
        teamId: "team-y",
        name: "Not Valid",
        agents: [],
        taskTemplate: "",
        createdAt: 3,
        updatedAt: 3,
      });
    } catch (e) { badErr = e.message; }
    check("registry.bad-name throws", typeof badErr === "string");

    // update preserves teamId + createdAt
    const upd = updateTeam(store, "team-1", { description: "Updated" });
    check("registry.update", upd?.description === "Updated" && upd?.teamId === "team-1");
    check("registry.update createdAt immutable", upd?.createdAt === 1);

    // template expansion keeps missing placeholders
    check("registry.expand-task", expandTaskTemplate("Hi {{subject}} and {{x}}", { subject: "auth" }) === "Hi auth and {{x}}");

    // delete (soft)
    check("registry.delete", deleteTeamDefinition(store, "team-1") === true);
    check("registry.deleted gone", getTeam(store, "team-1") === null);
    check("registry.list 0 after delete", listTeams(store).length === 0);
  }

  // ---- Sprint 5.19: team-bound schedules (uses nextCronFire validation) ---
  {
    const { createTeamDefinition: ctd, createTeamSchedule, listTeamSchedules, setTeamScheduleEnabled, teamSchedulesDue, recordTeamScheduleFire } = teamRegistry;
    ctd(store, {
      teamId: "team-s",
      name: "scheduled",
      agents: [{ role: "Explore" }],
      taskTemplate: "t",
      createdAt: 5,
      updatedAt: 5,
    });
    // valid cron accepted (daily at 9am); nextFire advances.
    const sched = createTeamSchedule(store, {
      scheduleId: "sched-1",
      teamId: "team-s",
      cron: "0 9 * * *",
      enabled: true,
    }, 0);
    check("sched.created nextFire > 0", sched.nextFireAt > 0);
    check("sched.list 1", listTeamSchedules(store, "team-s").length === 1);

    // invalid cron rejected at creation
    let cronErr = null;
    try {
      createTeamSchedule(store, { scheduleId: "sched-bad", teamId: "team-s", cron: "not a cron", enabled: true }, 0);
    } catch (e) { cronErr = e.message; }
    check("sched.invalid-cron throws", typeof cronErr === "string");

    // disable/enable
    const dis = setTeamScheduleEnabled(store, "sched-1", false, 1000);
    check("sched.disable", dis?.enabled === false);
    // disabled schedule not due
    check("sched.disabled not due", teamSchedulesDue(store, 99999999999).length === 0);
    const en = setTeamScheduleEnabled(store, "sched-1", true, 1000);
    check("sched.re-enable computes next", en?.nextFireAt > 0);

    // due + fire advances lastFired
    const dueAt = en.nextFireAt;
    check("sched.due at fire time", teamSchedulesDue(store, dueAt).some((s) => s.scheduleId === "sched-1"));
    const fired = recordTeamScheduleFire(store, "sched-1", dueAt);
    check("sched.fire sets lastFired", fired?.lastFiredAt === dueAt);
    check("sched.fire advances next", (fired?.nextFireAt ?? 0) > dueAt);
  }

  // ---- Sprint 5.21: versioned presets (team-presets, pure) ----------------
  const {
    builtinPresets, builtinPresetById, presetFromLegacyMode, isLegacyModeName,
    validateTeamPreset, validateExpansion, expandRoster, distributeTotal, effectiveConcurrency, buildSnapshot, HARD_SLOT_LIMIT, roleCountFor,
  } = teamPresets;
  const MODE_PRESETS = cfg.MODE_PRESETS ?? {};
  {
    // legacy virtual presets must match MODE_PRESETS rosters exactly (totals)
    for (const modeName of ["tiny", "small", "medium", "large", "xlarge", "mega"]) {
      const legacy = MODE_PRESETS[modeName];
      const p = presetFromLegacyMode(modeName);
      const total = roleCountFor(p.roles);
      check(`preset.legacy ${modeName} total`, total === legacy.agents);
      check(`preset.legacy ${modeName} bounded`, total >= p.size.min && total <= p.size.max);
    }
    check("preset.isLegacy", isLegacyModeName("tiny") && !isLegacyModeName("balanced-4"));
    check("preset.builtin count >= 10", builtinPresets().length >= 10);
    check("preset.builtinById", builtinPresetById("balanced-4")?.size.default === 4);

    // every builtin validates clean
    for (const p of builtinPresets()) {
      const vr = validateTeamPreset(p);
      check(`preset.valid ${p.id}`, vr.valid);
    }

    // hard slot limit enforced
    const over = {
      schemaVersion: 1, id: "big", name: "big", size: { min: 1, default: 30, max: 30 },
      roles: [{ role: "Explore", agentType: "explore", count: 30 }], source: "user", revision: 1,
    };
    check("preset.reject over-hard-limit", validateTeamPreset(over).errors.some((e) => e.includes("hard slot limit")));

    // expansion: default size uses saved counts
    const p4 = builtinPresetById("balanced-4");
    const def = expandRoster({ preset: p4, runId: "r1" });
    check("roster.default size", def.slots.length === 4);
    check("roster.ids stable", def.slots[0].slotId === "r1:explore:0");
    check("roster.roles order", def.slots.map((s) => s.role).join(",") === "Explore,Plan,Verification,Reviewer");

    // total-only override allocates deterministically to requested total
    const big = expandRoster({ preset: p4, runId: "r2", sizeOverride: 6 });
    check("roster.override total", big.slots.length === 6);

    // validateExpansion rejects above max
    check("preset.validateExpansion too-big", validateExpansion({ preset: p4, sizeOverride: 99 }).errors.length > 0);
    check("preset.validateExpansion ok", validateExpansion({ preset: p4, sizeOverride: 4 }).valid);

    // deterministic largest-remainder distribution
    const dist = distributeTotal(p4, 4);
    check("roster.distribute sums", Object.values(dist).reduce((a, b) => a + b, 0) === 4);

    // effectiveConcurrency bounded by runnable + cap
    check("roster.effective legit", effectiveConcurrency({ runnableSlots: 4, presetMaxConcurrent: 2 }) === 2);
    check("roster.effective hard limit", effectiveConcurrency({ runnableSlots: 50, projectConcurrency: 100 }) === 24);
    check("roster.effective min", effectiveConcurrency({ runnableSlots: 0 }) === 1);

    // snapshot shape
    const snap = buildSnapshot({ preset: p4, slots: def.slots, requestedSize: 4, effectiveConcurrency: 2, createdAt: 9 });
    check("snapshot.shape", snap.schemaVersion === 1 && snap.slots.length === 4 && snap.effectiveConcurrency === 2);
  }

  // ---- Sprint 5.21: bounded parallel executor (team-executor) -------------
  const { TeamExecutor, execSlotsFromSnapshot } = teamExec;
  {
    const makeSnap = (overrides) => ({
      presetId: "balanced-4", presetName: "balanced-4", presetRevision: 1, schemaVersion: 1,
      source: "builtin", size: { min: 1, default: 4, max: 4 }, requestedSize: 4, effectiveConcurrency: 2,
      failurePolicy: { kind: "continue" },
      slots: [
        { slotId: "s-explore", role: "Explore", ordinal: 0, agentType: "explore", provenance: "x" },
        { slotId: "s-plan", role: "Plan", ordinal: 0, agentType: "plan", provenance: "x" },
        { slotId: "s-verify", role: "Verification", ordinal: 0, agentType: "verification", provenance: "x" },
        { slotId: "s-review", role: "Reviewer", ordinal: 0, agentType: "reviewer", provenance: "x" },
      ],
      createdAt: 0,
      ...overrides,
    });

    // 1) bounded concurrency: runnable() never exceeds cap; all startable.
    {
      const ex = new TeamExecutor({ snapshot: makeSnap(), requiredRoles: [], dependsOnByRole: {} });
      const first = ex.runnable({ aborted: false });
      check("exec.bounded first wave cap 2", first.length === 2);
      check("exec.start enforce cap", ex.start(first[0].slotId,{ aborted: false }) === true);
      check("exec.start second runnable", ex.start(first[1].slotId,{ aborted: false }) === true);
      // third slot cannot start while 2 running (cap 2)
      check("exec.start third blocked", ex.start("s-verify",{ aborted: false }) === false);
      // finish one → another becomes runnable
      const o = ex.complete(first[0].slotId, true);
      check("exec.complete truthful", o.status === "completed");
      const second = ex.runnable({ aborted: false });
      check("exec.freed slot starts", second.length === 1);
    }

    // 2) dependency waves: Plan waits for Explore completion.
    {
      const dep = makeSnap();
      const ex = new TeamExecutor({ snapshot: dep, requiredRoles: [], dependsOnByRole: { Plan: ["Explore"] } });
      // Explore is runnable; Plan is blocked until Explore completes; Verify /
      // Review have no deps so they remain runnable (only Plan is gated).
      const wave1 = ex.runnable({ aborted: false });
      check("exec.wave plan blocked", !wave1.some((s) => s.role === "Plan"));
      check("exec.wave explore runnable", wave1.some((s) => s.role === "Explore"));
      ex.start("s-explore",{ aborted: false });
      ex.complete("s-explore", true);
      const wave2 = ex.runnable({ aborted: false });
      check("exec.wave plan now runnable", wave2.some((s) => s.role === "Plan"));
    }

    // 3) fail_fast: a REQUIRED failure cancels queued + run status failed
    {
      const ex = new TeamExecutor({
        snapshot: makeSnap({ failurePolicy: { kind: "fail_fast", cancelRunning: true } }),
        requiredRoles: ["Plan"], dependsOnByRole: {},
      });
      // Fail the required Plan slot (start it, then fail).
      check("exec.ff plan startable", ex.start("s-plan",{ aborted: false }) === true);
      ex.complete("s-plan", false, { error: "boom" });
      // fail_fast → queued become cancelled
      check("exec.ff cancelQueued", ex.statusOf("s-verify") === "cancelled");
      check("exec.ff runStatus failed", ex.runStatus === "failed");
    }

    // 3b) non-required failure does NOT trip fail_fast
    {
      const ex = new TeamExecutor({
        snapshot: makeSnap({ failurePolicy: { kind: "fail_fast", cancelRunning: true } }),
        requiredRoles: ["Plan"], dependsOnByRole: {},
      });
      ex.start("s-explore",{ aborted: false });
      ex.complete("s-explore", false); // non-required Explore fails
      check("exec.ff optional ignored", ex.statusOf("s-verify") !== "cancelled");
      check("exec.ff not done yet", ex.done === false);
    }

    // 4) continue policy: optional failure → partial
    {
      const ex = new TeamExecutor({ snapshot: makeSnap(), requiredRoles: [], dependsOnByRole: {} });
      const wave = ex.runnable({ aborted: false });
      ex.start(wave[0].slotId,{ aborted: false });
      ex.complete(wave[0].slotId, false, { error: "e" });
      check("exec.continue not done while running", ex.done === false);
      // finish the rest as completed
      for (const exs of ex.slots.filter((x) => x.slotId !== wave[0].slotId)) {
        if (ex.start(exs.slotId,{ aborted: false })) ex.complete(exs.slotId, true);
      }
      check("exec.continue final partial", ex.runStatus === "partial");
    }

    // 5) retry re-queues a failed slot and completes → completed
    {
      const ex = new TeamExecutor({ snapshot: makeSnap(), requiredRoles: [], dependsOnByRole: {} });
      const slot = ex.runnable({ aborted: false })[0];
      ex.start(slot.slotId,{ aborted: false });
      ex.complete(slot.slotId, false);
      check("exec.retry pre", ex.statusOf(slot.slotId) === "failed");
      check("exec.retry works", ex.retry(slot.slotId) === true);
      check("exec.retry attempt++", ex.slots.find((x) => x.slotId === slot.slotId)?.attempt === 2);
      ex.start(slot.slotId,{ aborted: false });
      ex.complete(slot.slotId, true);
      check("exec.retry outcome", ex.statusOf(slot.slotId) === "completed");
    }

    // 6) cancellation of all → cancelled
    {
      const ex = new TeamExecutor({ snapshot: makeSnap(), requiredRoles: [], dependsOnByRole: {} });
      ex.cancelAll();
      check("exec.cancelAll status cancelled", ex.runStatus === "cancelled");
      check("exec.cancelAll done", ex.done === true);
    }

    // 7) outcomes rendered in stable roster order (independent of completion)
    {
      const ex = new TeamExecutor({ snapshot: makeSnap(), requiredRoles: [], dependsOnByRole: {} });
      // complete s-review BEFORE s-explore to prove order follows roster, not
      // completion order.
      ex.start("s-review",{ aborted: false });
      ex.complete("s-review", true);
      ex.start("s-explore",{ aborted: false });
      ex.complete("s-explore", true);
      const order = ex.outcomesInOrder().map((o) => o.slotId);
      check("exec.outcomes stable order", order.join(",") === "s-explore,s-review");
    }
  }

  store.close();
  rmSync(dir, { recursive: true, force: true });
}
