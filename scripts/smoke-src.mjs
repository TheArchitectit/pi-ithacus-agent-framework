// Smoke test for the pi-agnostic src/ layer of ithacus.
// Uses ONLY Node built-ins. No npm install, no external toolchain.
//
// Node 26 strips TypeScript types natively, but our source imports siblings
// with `.js` extensions (NodeNext style). So we copy src/*.ts into a temp dir
// as .ts files and rewrite relative `.js` import specifiers to `.ts` (a safe,
// surgical string replace on `from "..."` / `import("...")` only). Then we
// import the temp .ts directly, letting Node strip the types.

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const srcDir = join(process.cwd(), "src");
const buildDir = mkdtempSync(join(tmpdir(), "ithacus-src-"));
mkdirSync(buildDir, { recursive: true });

for (const f of readdirSync(srcDir)) {
  if (!f.endsWith(".ts")) continue;
  let code = readFileSync(join(srcDir, f), "utf-8");
  // Rewrite relative "./x.js" / "../x.js" specifiers to ".ts" so Node resolves them.
  code = code.replace(/(from\s+["']\.\.?\/[^"']+)\.js(["'])/g, "$1.ts$2");
  code = code.replace(/(import\(\s*["']\.\.?\/[^"']+)\.js(["']\s*\))/g, "$1.ts$2");
  writeFileSync(join(buildDir, f), code);
}

const cfg = await import(join(buildDir, "config.ts"));
const { IthStore } = await import(join(buildDir, "store.ts"));
const team = await import(join(buildDir, "team.ts"));
const par = await import(join(buildDir, "parallel.ts"));
const trim = await import(join(buildDir, "trim.ts"));
const wf = await import(join(buildDir, "workflow.ts"));
const wt = await import(join(buildDir, "worktree.ts"));
const asc = await import(join(buildDir, "async.ts"));
const { PresenceStore } = await import(join(buildDir, "store-presence.ts"));
const presence = await import(join(buildDir, "presence.ts"));
const reservations = await import(join(buildDir, "reservations.ts"));
const cost = await import(join(buildDir, "cost.ts"));
const { ModelProfileStore } = await import(join(buildDir, "store-model-profiles.ts"));
const profiles = await import(join(buildDir, "model-profiles.ts"));
const validator = await import(join(buildDir, "validator.ts"));

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const tmpRepo = mkdtempSync(join(tmpdir(), "ithacus-repo-"));
// repoStateDir only scopes inside a git repo (mirrors pi-mega-compact). Init one.
import { execSync } from "node:child_process";
execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", { cwd: tmpRepo });
const sd = cfg.repoStateDir(tmpRepo, "/global/fallback");
check("repoStateDir scopes to <repo>/.pi/ithacus", sd.endsWith(join(".pi", "ithacus")));
check("repoStateDir falls back outside git", cfg.repoStateDir("/nonexistent-xyz", "/fb").endsWith("/fb"));

// PR #3250 precedence: explicit -> subagentModel -> providerModel -> default.
// resolved.id is the session's active model but is NOT in the agent chain;
// providerModel represents the session provider's model.
const resolved = { id: "claude-opus-4-8", provider: "custom-openai", subagentModel: null, providerModel: "claude-opus-4-8" };
const plan = team.planRun({ runId: "run1", mode: "large", prompt: "audit the cache", resolved, fallbackModels: ["kimi", "qwen"], now: 1000 });
check("planRun 'large' => 4 agents", plan.agents.length === 4);
check("planRun qualifies custom/ model", plan.agents[0].model === "custom/claude-opus-4-8");

const r2 = team.resolveAgentModel(null, { id: "", provider: null, subagentModel: "claude-haiku-4-5-20251001", providerModel: null });
check("resolveAgentModel falls back to subagentModel", r2 === "claude-haiku-4-5-20251001");

const chain = team.buildModelChain(null, resolved, ["kimi", "kimi", "qwen"]);
check("buildModelChain primary first", chain[0] === "custom/claude-opus-4-8");
check("buildModelChain dedupes", new Set(chain).size === chain.length && chain.includes("custom/kimi"));

const store = new IthStore(tmpRepo, cfg.loadConfig());
store.createRun(plan.run);
for (const a of plan.agents) store.upsertAgent(a);
store.createTask({ id: "t1", runId: "run1", title: "x", ownerClaim: null, status: "open" });
check("claimTask succeeds when unclaimed", store.claimTask("t1", "run1-a0") === true);
check("claimTask fails when claimed by other", store.claimTask("t1", "run1-a1") === false);
store.sendMessage({ id: "m1", agentId: "run1-a0", fromAgent: null, payload: "hi", ts: 1, read: false });
check("unread returns sent message", store.unread("run1-a0").length === 1);
store.markRead("m1");
check("markRead clears unread", store.unread("run1-a0").length === 0);
store.addMemory({ id: "mem1", kind: "decision", text: "use node:sqlite", repoId: tmpRepo, ts: 5 });
check("recall returns memory", store.recall(tmpRepo).length === 1);
store.close();

const calls = [
  { name: "read_file", args: {} },
  { name: "write_file", args: {} },
  { name: "grep_search", args: {} },
  { name: "GitCommit", args: {} },
];
const results = await par.executeBatch(calls, async (c) => ({ name: c.name, ok: true, value: null }));
check("executeBatch returns in original order", results.map((r) => r.name).join(",") === "read_file,write_file,grep_search,GitCommit");
check("parallel-safe classified correctly", par.isParallelSafe("read_file") && !par.isParallelSafe("write_file"));

const goodTrim = trim.decideTrim({
  activeAgents: 0, isIdle: true, currentTokens: 150000, contextWindow: 200000,
  tierPct: 0.7, bootFallback: 140000, sinceLastCompactMs: 999999, trimDebounceMs: 2000,
});
check("decideTrim trims when idle+over-threshold", goodTrim.shouldTrim === true);
const noTrim = trim.decideTrim({
  activeAgents: 2, isIdle: true, currentTokens: 150000, contextWindow: 200000,
  tierPct: 0.7, bootFallback: 140000, sinceLastCompactMs: 999999, trimDebounceMs: 2000,
});
check("decideTrim skips when agents active", noTrim.shouldTrim === false);

check("pressureBand mega at >=1.0", cfg.pressureBand(1.1) === "mega");
check("effectiveThreshold scales with window", cfg.effectiveThresholdTokens({ tierPct: 0.7, window: 200000, fallback: 140000 }) === 140000);

// ---- workflow DAG engine (Sprint 1.1) ------------------------------------
// Graph:  a -> b -> c (line), d independent
const dag = [
  { id: "a", taskTitle: "A", dependsOn: [] },
  { id: "b", taskTitle: "B", dependsOn: ["a"] },
  { id: "c", taskTitle: "C", dependsOn: ["b"] },
  { id: "d", taskTitle: "D", dependsOn: [] },
];
const sorted = wf.topologicalSort(dag);
check("topologicalSort: deps precede dependents", sorted.indexOf("a") < sorted.indexOf("b") && sorted.indexOf("b") < sorted.indexOf("c"));

const waves = wf.generateWaves(dag);
check("generateWaves: wave 0 has independents", waves.waves[0].includes("a") && waves.waves[0].includes("d"));
check("generateWaves: wave 1 has b", waves.waves[1].length === 1 && waves.waves[1][0] === "b");
check("generateWaves: wave 2 has c", waves.waves[2].length === 1 && waves.waves[2][0] === "c");
check("generateWaves: totalWaves matches", waves.totalWaves === 3);

const cyc = wf.detectCycle([
  { id: "x", taskTitle: "X", dependsOn: ["y"] },
  { id: "y", taskTitle: "Y", dependsOn: ["x"] },
]);
check("detectCycle returns path for circular graph", cyc !== null && cyc[0] === cyc[cyc.length - 1]);

let cycleThrew = false;
try { wf.generateWaves([{ id: "x", taskTitle: "X", dependsOn: ["y"] }, { id: "y", taskTitle: "Y", dependsOn: ["x"] }]); }
catch { cycleThrew = true; }
check("generateWaves throws on cycle", cycleThrew);

let dupThrew = false;
try { wf.validateDag([{ id: "a", taskTitle: "A", dependsOn: [] }, { id: "a", taskTitle: "A2", dependsOn: [] }]); }
catch { dupThrew = true; }
check("validateDag rejects duplicate ids", dupThrew);

let missingThrew = false;
try { wf.validateDag([{ id: "a", taskTitle: "A", dependsOn: ["ghost"] }]); }
catch { missingThrew = true; }
check("validateDag rejects unknown deps", missingThrew);

let validNoThrow = true;
try { wf.validateDag(dag); } catch { validNoThrow = false; }
check("validateDag accepts a valid DAG", validNoThrow);

// planRun with a workflow -> tasks with waves assigned
const wfPlan = team.planRun({
  runId: "runWf", mode: "small", prompt: "do the dag", resolved, fallbackModels: [], now: 2000,
  workflow: [
    { id: "w1", taskTitle: "root", dependsOn: [] },
    { id: "w2", taskTitle: "child", dependsOn: ["w1"] },
  ],
});
check("planRun with workflow emits tasks", wfPlan.tasks && wfPlan.tasks.length === 2);
const w1 = wfPlan.tasks.find((t) => t.id === "w1");
const w2 = wfPlan.tasks.find((t) => t.id === "w2");
check("planRun assigns wave 0 to root", w1.wave === 0 && w1.dependsOn.length === 0);
check("planRun assigns wave 1 to child", w2.wave === 1 && w2.dependsOn[0] === "w1");

// store persists dependsOn/wave/phase + resultSchema/resultValidated
const store2 = new IthStore(tmpRepo, cfg.loadConfig());
store2.createRun(wfPlan.run);
for (const a of wfPlan.agents) store2.upsertAgent({ ...a, resultSchema: '{"type":"object"}', resultValidated: true });
for (const t of wfPlan.tasks) store2.createTask(t);
const gotW2 = store2.openTasks("runWf").find((t) => t.id === "w2");
check("store.createTask persists dependsOn", Array.isArray(gotW2.dependsOn) && gotW2.dependsOn[0] === "w1");
check("store.createTask persists wave", gotW2.wave === 1);
const ag = store2.agentsForRun("runWf")[0];
check("store.upsertAgent persists resultSchema", ag.resultSchema === '{"type":"object"}');
check("store.upsertAgent persists resultValidated", ag.resultValidated === true);
check("store.claimTask on workflow task works", store2.claimTask("w1", "runWf-a0") === true);
store2.close();

// backward-compat: createTask with empty dependsOn reads back []
const store3 = new IthStore(tmpRepo, cfg.loadConfig());
store3.createTask({ id: "bc1", runId: "runWf", title: "bc", ownerClaim: null, status: "open", dependsOn: [], wave: null, phase: null });
const bc = store3.openTasks("runWf").find((t) => t.id === "bc1");
check("store backward-compat default dependsOn", Array.isArray(bc.dependsOn) && bc.dependsOn.length === 0);
store3.close();

// ---- worktree (Sprint 1.2) -----------------------------------------------
// Use a separate repo for worktree tests to avoid conflicts.
const wtRepo = mkdtempSync(join(tmpdir(), 'ithacus-wt-'));
execSync('git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init', { cwd: wtRepo });

check('worktreePath returns expected path', wt.worktreePath(wtRepo, 'a1').endsWith(join('.pi', 'ithacus', 'worktrees', 'a1')));
check('worktreeBranch returns ithacus/<agentId>', wt.worktreeBranch('a1') === 'ithacus/a1');

// Add a file to the repo so worktree has content
writeFileSync(join(wtRepo, 'hello.txt'), 'hello');
execSync('git add hello.txt && git commit -q -m add-hello', { cwd: wtRepo });

const wtCfg = wt.addWorktree(wtRepo, 'agent-a1');
check('addWorktree returns WorktreeConfig', wtCfg.agentId === 'agent-a1' && wtCfg.cleaned === false);
check('addWorktree creates directory', existsSync(join(wtCfg.path, 'hello.txt')));
check('addWorktree branch is ithacus/agent-a1', wtCfg.branch === 'ithacus/agent-a1');

const listed = wt.listWorktrees(wtRepo);
check('listWorktrees includes worktree path', listed.some(p => p.includes('agent-a1')));

const cleaned = wt.cleanupWorktree(wtRepo, wtCfg);
check('cleanupWorktree sets cleaned=true', cleaned.cleaned === true);
check('cleanupWorktree removes directory', !existsSync(wtCfg.path));

rmSync(wtRepo, { recursive: true, force: true });

// ---- async (Sprint 1.2) --------------------------------------------------
const asyncStateDir = mkdtempSync(join(tmpdir(), 'ithacus-async-'));

// Spawn a trivial local process that prints and exits
const asyncState = asc.spawnAsyncRun({
  runId: 'async-test-1',
  stateDir: asyncStateDir,
  command: 'node',
  args: ['-e', 'console.log("async-hello")'],
});
check('spawnAsyncRun returns running state', asyncState.status === 'running');
check('spawnAsyncRun has pid', asyncState.pid !== null && asyncState.pid > 0);
check('spawnAsyncRun has logPath', asyncState.logPath.includes('async-test-1'));

// Wait for the process to finish
await new Promise(r => setTimeout(r, 500));

const checkResult = asc.checkAsyncRun(asyncState.pid);
check('checkAsyncRun detects process finished', checkResult.running === false);

// Check log file was written
const logExists = existsSync(asyncState.logPath);
check('async log file created', logExists);
if (logExists) {
  const logContent = readFileSync(asyncState.logPath, 'utf-8');
  check('async log contains output', logContent.includes('async-hello'));
}

// ReadExitInfo — reads exit code sidecar written by child exit handler
const exitInfo = asc.readExitInfo(asyncState.logPath);
check('readExitInfo returns exit code', exitInfo.exitCode === 0);
check('readExitInfo returns null signal for normal exit', exitInfo.signal === null);

// Store round-trip for async runs
const store4 = new IthStore(tmpRepo, cfg.loadConfig());
store4.saveAsyncRun(asyncState);
const retrieved = store4.getAsyncRun('async-test-1');
check('store.getAsyncRun retrieves saved state', retrieved !== undefined && retrieved.runId === 'async-test-1');
store4.setAsyncRunStatus('async-test-1', 'completed', { exitCode: 0, completedAt: Date.now() });
const completed = store4.getAsyncRun('async-test-1');
check('store.setAsyncRunStatus updates status', completed.status === 'completed' && completed.exitCode === 0);

// Worktree store round-trip
store4.saveWorktree({ agentId: 'wt-agent-1', runId: 'run1', path: '/tmp/wt', branch: 'ithacus/wt-agent-1', cleaned: false, createdAt: 1000 });
const wtr = store4.getWorktree('wt-agent-1');
check('store.getWorktree retrieves saved config', wtr !== undefined && wtr.path === '/tmp/wt');
store4.markWorktreeCleaned('wt-agent-1');
const wtc = store4.getWorktree('wt-agent-1');
check('store.markWorktreeCleaned sets cleaned', wtc.cleaned === true);
store4.close();

// ---- presence (Sprint 1.3) -----------------------------------------------
const store5 = new IthStore(tmpRepo, cfg.loadConfig());
const psStore = new PresenceStore(store5.db);

const p1 = presence.joinPresence(psStore, 'p-agent-1', 'run-p1', 30000, 1000);
check('joinPresence creates active presence', p1.status === 'active' && p1.lastHeartbeat === 1000);
check('getPresence retrieves presence', psStore.getPresence('p-agent-1')?.status === 'active');

presence.heartbeat(psStore, 'p-agent-1', 5000);
check('heartbeat updates lastHeartbeat', psStore.getPresence('p-agent-1')?.lastHeartbeat === 5000);

const stuckCount = presence.detectStuck(psStore, 50000);
check('detectStuck marks stuck after threshold', stuckCount === 1);
check('getPresence shows stuck status', psStore.getPresence('p-agent-1')?.status === 'stuck');

const recovered = presence.heartbeat(psStore, 'p-agent-1', 51000);
check('heartbeat recovers stuck agent', recovered.recovered === true);
check('agent status back to active', psStore.getPresence('p-agent-1')?.status === 'active');

presence.leavePresence(psStore, 'p-agent-1');
check('leavePresence marks complete', psStore.getPresence('p-agent-1')?.status === 'complete');

const presences = presence.listPresences(psStore, 'run-p1');
check('listPresences returns all', presences.length === 1);
const filtered = presence.listPresences(psStore, 'run-p1', 'complete');
check('listPresences filters by status', filtered.length === 1);

// ---- reservations (Sprint 1.3) -------------------------------------------
const granted = reservations.reserveFile(psStore, { agentId: 'r-agent-1', runId: 'run-r1', filePath: '/src/foo.ts', scope: 'write' });
check('reserveFile grants first write', granted === true);

const conflict = reservations.reserveFile(psStore, { agentId: 'r-agent-2', runId: 'run-r1', filePath: '/src/foo.ts', scope: 'write' });
check('reserveFile blocks conflicting write', conflict === false);

const checkRes = reservations.checkConflict(psStore, '/src/foo.ts', 'r-agent-2');
check('checkConflict returns reservation', checkRes !== undefined && checkRes.agentId === 'r-agent-1');

const noConflict = reservations.checkConflict(psStore, '/src/foo.ts', 'r-agent-1');
check('checkConflict allows own reservation', noConflict === undefined);

reservations.releaseReservation(psStore, 'r-agent-1', '/src/foo.ts');
check('releaseReservation frees file', reservations.checkConflict(psStore, '/src/foo.ts', 'r-agent-2') === undefined);

reservations.reserveFile(psStore, { agentId: 'r-agent-1', runId: 'run-r1', filePath: '/src/a.ts', scope: 'write' });
reservations.reserveFile(psStore, { agentId: 'r-agent-1', runId: 'run-r1', filePath: '/src/b.ts', scope: 'write' });
reservations.releaseAll(psStore, 'r-agent-1');
check('releaseAll frees all files', psStore.reservationsForRun('run-r1').length === 0);

// ---- cost (Sprint 1.3) --------------------------------------------------
cost.recordCost(psStore, { agentId: 'c-agent-1', runId: 'run-c1', inputTokens: 1000, outputTokens: 500, model: 'claude' });
cost.recordCost(psStore, { agentId: 'c-agent-1', runId: 'run-c1', inputTokens: 2000, outputTokens: 1000, model: 'claude' });
cost.recordCost(psStore, { agentId: 'c-agent-2', runId: 'run-c1', inputTokens: 500, outputTokens: 200, model: 'kimi' });

const summary = cost.getCostSummary(psStore, 'run-c1');
check('costSummary totalInput', summary.totalInput === 3500);
check('costSummary totalOutput', summary.totalOutput === 1700);
check('costSummary totalTokens', summary.totalTokens === 5200);
check('costSummary entryCount', summary.entryCount === 3);
check('costSummary byAgent has 2 entries', Object.keys(summary.byAgent).length === 2);
check('costSummary byAgent c-agent-1', summary.byAgent['c-agent-1'].input === 3000);

const agentCosts = cost.getAgentCosts(psStore, 'run-c1');
check('getAgentCosts returns per-agent', agentCosts.length === 2);

// Cost with role enrichment
const summaryWithRoles = cost.getCostSummary(psStore, 'run-c1', [
  { id: 'c-agent-1', runId: 'run-c1', role: 'Explore', model: 'claude', provider: null, status: 'working', lastSeen: 0, resultSchema: null, resultValidated: false },
  { id: 'c-agent-2', runId: 'run-c1', role: 'Plan', model: 'kimi', provider: null, status: 'working', lastSeen: 0, resultSchema: null, resultValidated: false },
]);
check('costSummary byRole has Explore', summaryWithRoles.byRole['Explore']?.input === 3000);
check('costSummary byRole has Plan', summaryWithRoles.byRole['Plan']?.input === 500);

store5.close();

// ---- bug fixes (Sprint 1.3 audit) -----------------------------------------
const storeBug = new IthStore(tmpRepo, cfg.loadConfig());

// BUG-1 fix: heartbeat after leavePresence does NOT resurrect
const psBug1 = new PresenceStore(storeBug.db);
presence.joinPresence(psBug1, 'bug1-agent', 'run-bug1', 30000, 1000);
presence.leavePresence(psBug1, 'bug1-agent');
presence.heartbeat(psBug1, 'bug1-agent', 5000);
check('BUG-1: heartbeat after leave does NOT resurrect', psBug1.getPresence('bug1-agent')?.status === 'complete');

// BUG-2 fix: releaseAll clears agent reservations
const psBug2 = new PresenceStore(storeBug.db);
reservations.reserveFile(psBug2, { agentId: 'bug2-agent', runId: 'run-bug2', filePath: '/src/stale.ts', scope: 'write' });
reservations.releaseAll(psBug2, 'bug2-agent');
check('BUG-2: reservation released after releaseAll', psBug2.isReserved('/src/stale.ts') === undefined);

// BUG-3 fix: no scope downgrade
const psBug3 = new PresenceStore(storeBug.db);
reservations.reserveFile(psBug3, { agentId: 'bug3-agent', runId: 'run-bug3', filePath: '/src/scope.ts', scope: 'write' });
reservations.reserveFile(psBug3, { agentId: 'bug3-agent', runId: 'run-bug3', filePath: '/src/scope.ts', scope: 'read' });
check('BUG-3: write reservation not downgraded to read', psBug3.isReserved('/src/scope.ts')?.scope === 'write');

// BUG-4 fix: negative tokens rejected
let negThrew = false;
try { cost.recordCost(psBug3, { agentId: 'x', runId: 'r', inputTokens: -1, outputTokens: 0, model: 'm' }); }
catch { negThrew = true; }
check('BUG-4: negative tokens rejected', negThrew);

storeBug.close();

// ---- model profiles (Sprint 1.4) -----------------------------------------
const store6 = new IthStore(tmpRepo, cfg.loadConfig());
const mpStore = new ModelProfileStore(store6.db);

const seeded = profiles.seedProfiles(mpStore);
check('seedProfiles seeds 5 builtins', seeded === 5);
check('seedProfiles idempotent (0 on second call)', profiles.seedProfiles(mpStore) === 0);

const allProfiles = mpStore.listProfiles();
check('listProfiles returns 5', allProfiles.length === 5);
check('getProfile speed exists', mpStore.getProfile('speed')?.tier === 'speed');
check('getProfile quality model', mpStore.getProfile('quality')?.model === 'claude-opus-4-8');

// CRUD: create custom profile
const custom = profiles.createProfile(mpStore, { id: 'fast-local', name: 'FastLocal', tier: 'speed', model: 'phi4', fallbackModels: ['qwen'], description: 'custom', costMultiplier: 0.2 });
check('createProfile returns profile', custom.id === 'fast-local');
check('createProfile persisted', mpStore.getProfile('fast-local')?.name === 'FastLocal');

// CRUD: update
const updated = profiles.updateProfile(mpStore, 'fast-local', { costMultiplier: 0.3 });
check('updateProfile changes field', updated.costMultiplier === 0.3);

// CRUD: delete (builtins protected)
check('deleteProfile custom works', profiles.deleteProfileById(mpStore, 'fast-local') === true);
check('deleteProfile builtin protected', profiles.deleteProfileById(mpStore, 'speed') === false);
check('deleted profile gone', mpStore.getProfile('fast-local') === undefined);

// Cost estimation
const speedProfile = mpStore.getProfile('speed');
const speedCost = profiles.estimateProfileCost(speedProfile, 500000, 500000);
check('estimateProfileCost speed positive', speedCost > 0);
const qualityProfile = mpStore.getProfile('quality');
const qualityCost = profiles.estimateProfileCost(qualityProfile, 500000, 500000);
check('estimateProfileCost quality > speed', qualityCost > speedCost);
check('estimateProfileCost local cheapest', profiles.estimateProfileCost(mpStore.getProfile('local'), 500000, 500000) < speedCost);

// Profile resolution chain
const resolvedSpeed = profiles.resolveProfile(mpStore, { explicit: 'speed' });
check('resolveProfile explicit', resolvedSpeed.id === 'speed');
const resolvedDefault = profiles.resolveProfile(mpStore, {});
check('resolveProfile default', resolvedDefault.id === 'speed');
const resolvedFallback = profiles.resolveProfile(mpStore, { explicit: 'nonexistent' });
check('resolveProfile fallback on bad id', resolvedFallback.id === 'speed');

// Per-role assignment
profiles.assignRoleProfile(mpStore, { runId: 'run-mp1', role: 'Explore', profileId: 'speed' });
profiles.assignRoleProfile(mpStore, { runId: 'run-mp1', role: 'Reviewer', profileId: 'quality' });
const assigns = mpStore.assignmentsForRun('run-mp1');
check('assignmentsForRun returns 2', assigns.length === 2);
check('assignmentForRole Explore', mpStore.assignmentForRole('run-mp1', 'Explore')?.profileId === 'speed');
check('assignmentForRole Reviewer', mpStore.assignmentForRole('run-mp1', 'Reviewer')?.profileId === 'quality');

// resolveProfile with role+runId uses assignment
const resolvedExplore = profiles.resolveProfile(mpStore, { role: 'Explore', runId: 'run-mp1' });
check('resolveProfile role-based', resolvedExplore.id === 'speed');
const resolvedReviewer = profiles.resolveProfile(mpStore, { role: 'Reviewer', runId: 'run-mp1' });
check('resolveProfile role-based quality', resolvedReviewer.id === 'quality');

// createProfile throws on duplicate id
{
  let dupThrew = false;
  try { profiles.createProfile(mpStore, { id: 'speed', name: 'X', tier: 'speed', model: 'x' }); }
  catch { dupThrew = true; }
  check('createProfile rejects duplicate id', dupThrew);
}

// ---- validator (Sprint 1.4 RPV) ----------------------------------------
const goodPrompt = 'Review the auth module at src/auth.ts for SQL injection vulnerabilities and report findings.';
const goodReport = validator.validatePrompt(goodPrompt);
check('validatePrompt returns 4 dimensions', goodReport.dimensions.length === 4);
check('validatePrompt dimension names',
  goodReport.dimensions.map(d => d.name).join(',') === 'clarity,specificity,scope,safety');
check('validatePrompt overallScore in range', goodReport.overallScore >= 0 && goodReport.overallScore <= 100);
check('validatePrompt good prompt passes', goodReport.passed === true);
check('validatePrompt good prompt not safety-blocked', goodReport.safetyBlocked === false);
check('validatePrompt recommendProfile quality for review', goodReport.recommendedProfile === 'quality');
check('validatePrompt summary exists', goodReport.summary.length > 0);

// Safety hard-block
const dangerPrompt = 'Run rm -rf / on the production database and drop table users';
const dangerReport = validator.validatePrompt(dangerPrompt);
check('validatePrompt danger blocked', dangerReport.safetyBlocked === true);
check('validatePrompt danger not passed', dangerReport.passed === false);
const safetyDim = dangerReport.dimensions.find(d => d.name === 'safety');
check('validatePrompt safety score below threshold', safetyDim.score < 30);

// Vague prompt fails overall threshold
const vaguePrompt = 'help';
const vagueReport = validator.validatePrompt(vaguePrompt);
check('validatePrompt vague fails', vagueReport.passed === false);
check('validatePrompt vague overallScore low', vagueReport.overallScore < 40);

// Recommend profile by keyword
check('recommendProfile code', validator.recommendProfile('implement and write a new parser') === 'code');
check('recommendProfile reasoning', validator.recommendProfile('design an architecture strategy') === 'reasoning');
check('recommendProfile speed', validator.recommendProfile('quick scan to find all deps') === 'speed');

// Recommend team size scales with complexity
check('recommendTeamSize short prompt', validator.recommendTeamSize('fix this bug') <= 2);
check('recommendTeamSize long prompt', validator.recommendTeamSize('A. Do X. B. Do Y. C. Do Z. D. Do W. And also next then after build deploy test verify') >= 4);
check('recommendTeamSize clamped 1-6', validator.recommendTeamSize('word '.repeat(200).trim()) <= 6);

// Custom thresholds
const strictReport = validator.validatePrompt('review it', { overallThreshold: 80 });
check('validatePrompt custom threshold can fail', strictReport.passed === false);

// Safety threshold configurable
const mildDanger = validator.validatePrompt('quietly rm -rf something', { safetyThreshold: 10 });
check('validatePrompt custom safety threshold', typeof mildDanger.safetyBlocked === 'boolean');

store6.close();

rmSync(asyncStateDir, { recursive: true, force: true });

rmSync(buildDir, { recursive: true, force: true });
rmSync(tmpRepo, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
