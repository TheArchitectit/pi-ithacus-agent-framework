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
const hashline = await import(join(buildDir, "hashline.ts"));
const checkpoint = await import(join(buildDir, "checkpoint.ts"));
const configFormats = await import(join(buildDir, "config-formats.ts"));
const streamRules = await import(join(buildDir, "stream-rules.ts"));
const advisor = await import(join(buildDir, "advisor.ts"));
const review = await import(join(buildDir, "review.ts"));
const commits = await import(join(buildDir, "commits.ts"));

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

// ---- hashline (Sprint 2.1) ----------------------------------------------
const sampleContent = 'function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a - b;\n}\n';

// hash computation
const h = hashline.computeHash('hello');
check('computeHash returns 64-char hex', /^[0-9a-f]{64}$/.test(h));
check('computeHash deterministic', hashline.computeHash('hello') === h);
check('computeHash differs on input', hashline.computeHash('world') !== h);

// build + serialize + parse roundtrip
const edit = hashline.buildHashline('/src/math.ts', 'return a + b;', 'return Number(a) + Number(b);');
check('buildHashline sets filePath', edit.filePath === '/src/math.ts');
check('buildHashline sets anchorHash', edit.anchorHash === hashline.computeHash('return a + b;'));

const wire = hashline.serializeHashline(edit);
check('serializeHashline has header', wire.startsWith('@@/src/math.ts|'));
check('serializeHashline has OLD marker', wire.includes('<<<OLD'));
check('serializeHashline has NEW marker', wire.includes('>>>NEW'));
check('serializeHashline terminator', wire.endsWith('==='));

const parsed = hashline.parseHashline(wire);
check('parseHashline filePath', parsed.filePath === edit.filePath);
check('parseHashline anchorHash', parsed.anchorHash === edit.anchorHash);
check('parseHashline oldText', parsed.oldText === edit.oldText);
check('parseHashline newText', parsed.newText === edit.newText);

// with anchorLine
const editWithLine = hashline.buildHashline('/src/x.ts', 'old', 'new', 42);
check('buildHashline anchorLine', editWithLine.anchorLine === 42);
const wireLine = hashline.serializeHashline(editWithLine);
check('serializeHashline header has line', /@42$/.test(wireLine.split('\n')[0]));
check('parseHashline anchorLine roundtrip', hashline.parseHashline(wireLine).anchorLine === 42);

// apply hashline — exact match
const result = hashline.applyHashline(sampleContent, edit);
check('applyHashline exact status', result.status === 'exact');
check('applyHashline applied change', result.content.includes('Number(a) + Number(b)'));
check('applyHashline preserves rest', result.content.includes('return a - b;'));

// stale anchor recovery: oldText slightly drifted (whitespace)
const driftedContent = sampleContent.replace('  return a + b;', '   return a + b;');
const staleEdit = hashline.buildHashline('/src/math.ts', '  return a + b;', '  return Number(a) + Number(b);');
// The anchorHash won't match driftedContent's version, but findNearestMatch recovers.
const staleResult = hashline.applyHashline(driftedContent, staleEdit);
check('applyHashline recovered status', staleResult.status === 'recovered' || staleResult.status === 'exact');

// findNearestMatch: exact present → drift 0
const nm = hashline.findNearestMatch(sampleContent, 'return a - b;');
check('findNearestMatch exact', nm.match === 'return a - b;' && nm.drift === 0);

// findNearestMatch: within tolerance (1 char diff on one line)
const fuzzy = hashline.findNearestMatch(sampleContent, 'return a - c;', 1);
check('findNearestMatch fuzzy within 1', fuzzy.match !== null && fuzzy.drift <= 1);

// findNearestMatch: beyond tolerance
const far = hashline.findNearestMatch(sampleContent, 'totally absent content here', 3);
check('findNearestMatch far returns null', far.match === null);

// failed apply when oldText absent and no anchorLine
const failEdit = hashline.buildHashline('/src/none.ts', 'does not exist anywhere', 'new');
const failResult = hashline.applyHashline(sampleContent, failEdit);
check('applyHashline failed status', failResult.status === 'failed');
check('applyHashline failed content unchanged', failResult.content === sampleContent);

// pure insertion via anchorLine fallback
const insEdit = hashline.buildHashline('/src/new.ts', '', '// inserted header', 1);
const insResult = hashline.applyHashline('line1\nline2', insEdit);
check('applyHashline insertion fallback', insResult.status === 'fallback' && insResult.content.startsWith('// inserted header'));

// native conversion roundtrip
const native = hashline.toNativeEdit(edit);
check('toNativeEdit filePath', native.filePath === edit.filePath);
check('toNativeEdit oldString', native.oldString === edit.oldText);
check('toNativeEdit newString', native.newString === edit.newText);
const backToHl = hashline.fromNativeEdit(native);
check('fromNativeEdit anchorHash', backToHl.anchorHash === edit.anchorHash);
check('fromNativeEdit oldText', backToHl.oldText === edit.oldText);

// token reduction measurement (acceptance: 40%+ on a large edit)
const bigOld = 'x'.repeat(2000);
const bigNew = 'y'.repeat(2000);
const bigNative = { filePath: '/src/big.ts', oldString: bigOld, newString: bigNew };
const reduc = hashline.tokenReduction(bigNative);
check('tokenReduction >= 0.4', reduc >= 0.4);
check('tokenReduction < 1', reduc < 1);

// malformed parse throws
let parseThrew = false;
try { hashline.parseHashline('not a hashline'); }
catch { parseThrew = true; }
check('parseHashline malformed throws', parseThrew);

// ---- checkpoint (Sprint 2.1) -------------------------------------------
const convMessages = [
  { id: 'm1', role: 'user', content: 'Investigate the auth module.', turn: 0, exploratory: false },
  { id: 'm2', role: 'assistant', content: 'Looking at src/auth.ts. I see a potential SQL injection on line 42. The query concatenates user input directly into the SQL string without parameterization.', turn: 1, exploratory: true },
  { id: 'm3', role: 'tool', content: 'grep -n query src/auth.ts returned 5 matches', turn: 2, exploratory: true },
  { id: 'm4', role: 'assistant', content: 'I will now plan the fix. The injection is in the login handler.', turn: 3, exploratory: true },
  { id: 'm5', role: 'user', content: 'Fix it now.', turn: 4, exploratory: false },
];

const ckpt = checkpoint.markCheckpoint(convMessages, 'run-ckpt1');
check('markCheckpoint has id', ckpt.id.startsWith('ckpt-'));
check('markCheckpoint turnIndex', ckpt.turnIndex === 5);
check('markCheckpoint tokenCountBefore positive', ckpt.tokenCountBefore > 0);
check('markCheckpoint runId', ckpt.runId === 'run-ckpt1');

const { messages: pruned, summary: sum } = checkpoint.pruneAfterCheckpoint(convMessages, ckpt);
check('pruneAfterCheckpoint reduces count', pruned.length < convMessages.length);
check('pruneAfterCheckpoint keeps non-exploratory', pruned.some(m => m.id === 'm1'));
check('pruneAfterCheckpoint keeps user directive', pruned.some(m => m.id === 'm5'));
check('pruneAfterCheckpoint adds summary msg', pruned.some(m => m.id === `${ckpt.id}-summary`));
check('pruneAfterCheckpoint summary has checkpoints pruned count', sum.prunedMessageCount === 3);
check('pruneAfterCheckpoint tokensSaved positive', sum.tokensSaved > 0);
check('pruneAfterCheckpoint summary non-empty', sum.summary.length > 0);

// buildSummary bullets
const sum2 = checkpoint.buildSummary(convMessages.filter(m => m.exploratory));
check('buildSummary produces bullets', sum2.includes('- [assistant]') || sum2.includes('- [tool]'));
check('buildSummary capped at 8 bullets', sum2.split('\n').length <= 9);

// buildSummary empty
check('buildSummary empty', checkpoint.buildSummary([]).includes('No exploratory'));

// estimateTokens
check('estimateTokens ~4 chars/token', checkpoint.estimateTokens('hello world!') === 3);
check('estimateTokens empty', checkpoint.estimateTokens('') === 0);

// rewind
const rewound = checkpoint.rewindToCheckpoint(convMessages, ckpt);
check('rewindToCheckpoint truncates', rewound.length === 5); // all turns < 5
check('rewindToCheckpoint no turns >= checkpoint', rewound.every(m => m.turn < ckpt.turnIndex));

// ---- config formats (Sprint 2.2) ----------------------------------------
const cursorMdc = `---\napplyTo: "**/*.ts"\ndescription: TS rules\n---\nUse 2 spaces for indentation.\nPrefer const over let.`;
const cursorRules = configFormats.parseCursorMdc(cursorMdc);
check('parseCursorMdc returns 1 rule', cursorRules.length === 1);
check('parseCursorMdc applyTo', cursorRules[0]?.applyTo === '**/*.ts');
check('parseCursorMdc format', cursorRules[0]?.format === 'cursor-mdc');
check('parseCursorMdc body', cursorRules[0]?.body.includes('2 spaces'));

const clineRules = configFormats.parseClineRules('## TypeScript files (*.ts)\nUse strict mode.\n\n## Other\nBe concise.');
check('parseClineRules returns 2', clineRules.length === 2);
check('parseClineRules glob extract', clineRules[0]?.applyTo === '*.ts');
check('parseClineRules format', clineRules[0]?.format === 'cline-clinerules');

const codexContent = 'Be careful with exports.\n\n## TypeScript\nUse const.\n\n## Python\nUse type hints.';
const codexRules = configFormats.parseCodexAgents(codexContent);
check('parseCodexAgents global rule', codexRules.some(r => r.applyTo === '*'));
check('parseCodexAgents headings', codexRules.length >= 2);
check('parseCodexAgents format', codexRules[0]?.format === 'codex-agents');

const copilotContent = 'applyTo: **/*.js\nUse strict.\napplyTo: **/*.py\nUse type hints.';
const copilotRules = configFormats.parseCopilotApplyTo(copilotContent);
check('parseCopilotApplyTo returns 2', copilotRules.length === 2);
check('parseCopilotApplyTo glob js', copilotRules[0]?.applyTo === '**/*.js');
check('parseCopilotApplyTo format', copilotRules[0]?.format === 'copilot-applyTo');

const aiderRules = configFormats.parseAider('Always write tests.\nKeep functions small.');
check('parseAider single rule', aiderRules.length === 1);
check('parseAider global', aiderRules[0]?.applyTo === '*');
check('parseAider format', aiderRules[0]?.format === 'aider');

const continueContent = 'rules:\n  - applyTo: **/*.ts\n    use const\n  - applyTo: **/*.py\n    use type hints\n';
const continueRules = configFormats.parseContinue(continueContent);
check('parseContinue returns 2', continueRules.length === 2);
check('parseContinue first glob', continueRules[0]?.applyTo === '**/*.ts');
check('parseContinue format', continueRules[0]?.format === 'continue');

const codyContent = '## path:src/**/*.ts\nUse strict.\n\n## path:tests/**/*.ts\nUse describe/it.';
const codyRules = configFormats.parseCody(codyContent);
check('parseCody returns 2', codyRules.length === 2);
check('parseCody path glob', codyRules[0]?.applyTo === 'src/**/*.ts');
check('parseCody format', codyRules[0]?.format === 'cody');

const genericRules = configFormats.parseGeneric('Just plain rules.');
check('parseGeneric single rule', genericRules.length === 1 && genericRules[0].format === 'generic');

// dispatch via parseConfigFormat
const dispatched = configFormats.parseConfigFormat(cursorMdc, 'cursor-mdc');
check('parseConfigFormat dispatch works', dispatched.length === 1);
const fallback = configFormats.parseConfigFormat('unknown', 'generic');
check('parseConfigFormat generic fallback', fallback.length === 1);

// loadConfigFile on missing file
check('loadConfigFile missing returns []', configFormats.loadConfigFile('/nonexistent/xyz.md', 'cursor-mdc').length === 0);

// FORMAT_PARSERS has all 8
check('FORMAT_PARSERS has 8 formats', Object.keys(configFormats.FORMAT_PARSERS).length === 8);

// ---- skill discovery (Sprint 2.2) --------------------------------------
const skillDir = mkdtempSync(join(tmpdir(), 'ithacus-skills-'));
// extension layer
mkdirSync(join(skillDir, 'ext', 'lint'), { recursive: true });
writeFileSync(join(skillDir, 'ext', 'lint', 'SKILL.md'), '---\nname: lint\ntriggers: lint, eslint\n---\n# Lint Skill\nRun eslint on changed files.');
// project layer (overrides ext's lint)
mkdirSync(join(skillDir, 'project', 'lint'), { recursive: true });
writeFileSync(join(skillDir, 'project', 'lint', 'SKILL.md'), '---\nname: lint\ntriggers: lint, eslint\n---\n# Project Lint Override\nUse project eslint config.');
// user layer
mkdirSync(join(skillDir, 'user', 'test'), { recursive: true });
writeFileSync(join(skillDir, 'user', 'test', 'SKILL.md'), '---\nname: test\n---\n# Test Skill\nRun tests after changes.');

const skills = configFormats.discoverSkills({
  extensionDir: join(skillDir, 'ext'),
  userDir: join(skillDir, 'user'),
  projectDir: join(skillDir, 'project'),
});
check('discoverSkills finds merged skills', skills.length === 2); // lint + test (lint deduped)
const lintSkill = skills.find(s => s.name === 'lint');
check('discoverSkills project overrides ext', lintSkill?.layer === 'project');
check('discoverSkills project body override', lintSkill?.body.includes('project eslint config'));
const testSkill = skills.find(s => s.name === 'test');
check('discoverSkills user layer test', testSkill?.layer === 'user');
check('discoverSkills triggers parsed', lintSkill?.triggers.includes('eslint'));

// validateSkillMd
check('validateSkillMd valid', configFormats.validateSkillMd('# Title\nbody text here longer') === null);
check('validateSkillMd empty', configFormats.validateSkillMd('').includes('empty'));
check('validateSkillMd no body', configFormats.validateSkillMd('---\nname: x\n---').includes('no body'));

rmSync(skillDir, { recursive: true, force: true });

// ---- stream rules (Sprint 2.2) -----------------------------------------
const reg = streamRules.createStreamRuleRegistry();
const r1 = reg.add({ pattern: 'TODO', flags: 'i', inject: 'Remember to resolve TODOs before commit.' });
check('registry.add returns rule', r1.id.startsWith('rule-'));
check('registry.add persists', reg.get(r1.id)?.pattern === 'TODO');
check('registry.list', reg.list().length === 1);

const injections = reg.scan('Here is a TODO item in the stream');
check('registry.scan finds match', injections.length === 1);
check('registry.scan injects text', injections[0]?.inject.includes('resolve TODOs'));
check('registry.scan increments fire count', reg.scan('another TODO').length === 1);

// maxFires limit
const srLimit = reg.add({ pattern: 'FIXME', inject: 'fix me note', maxFires: 2 });
reg.scan('a FIXME here');
reg.scan('another FIXME');
const thirdScan = reg.scan('third FIXME');
check('registry.maxFires blocks after limit', thirdScan.filter(i => i.ruleId === srLimit.id).length === 0);

// compaction survival
const srPersist = reg.add({ pattern: 'persist', inject: 'persisted', persistAfterCompaction: true });
const srEphemeral = reg.add({ pattern: 'ephemeral', inject: 'gone soon', persistAfterCompaction: false });
const survived = reg.surviveCompaction();
check('registry.surviveCompaction drops ephemeral', !reg.get(srEphemeral.id));
check('registry.surviveCompaction keeps persistent', reg.get(srPersist.id) !== undefined);
check('registry.surviveCompaction returns count', survived >= 1);

// capture expansion
const reg2 = streamRules.createStreamRuleRegistry();
const rcap = reg2.add({ pattern: 'function\\s+(\\w+)', flags: 'g', inject: 'Found function: $1' });
const capInj = reg2.scan('function myFunc() {}');
check('registry.scan captures', capInj[0]?.inject === 'Found function: myFunc');
const regAmp = streamRules.createStreamRuleRegistry();
regAmp.add({ pattern: 'function\\s+(\\w+)', flags: '', inject: 'Matched: $& Name: $1' });
check('registry.scan expands $& full match', regAmp.scan('function myFunc() {}')[0]?.inject === 'Matched: function myFunc Name: myFunc');

// functional helpers
check('compileRule valid', streamRules.compileRule({ pattern: 'abc', flags: 'i' }) !== null);
check('compileRule invalid', streamRules.compileRule({ pattern: '(', flags: '' }) === null);
check('ruleMatches positive', streamRules.ruleMatches({ pattern: 'TODO', flags: 'i' }, 'a TODO item') === true);
check('ruleMatches negative', streamRules.ruleMatches({ pattern: 'FIXME', flags: 'i' }, 'no match here') === false);
check('survivesCompaction true', streamRules.survivesCompaction({ persistAfterCompaction: true }) === true);
check('survivesCompaction false', streamRules.survivesCompaction({ persistAfterCompaction: false }) === false);

reg.clear();
check('registry.clear empties', reg.list().length === 0);

rmSync(asyncStateDir, { recursive: true, force: true });

// ---- advisor (Sprint 2.3) ----------------------------------------------
const sess = advisor.createAdvisorSession(3);
check('advisor default budget const', advisor.DEFAULT_ADVISOR_BUDGET === 10);
check('advisor initial remaining', sess.remaining() === 3);

const n1 = sess.emit({ kind: 'blocker', priority: 'P0', confidence: 80, text: 'SQL injection risk', turnIndex: 1 });
check('advisor.emit returns note', n1?.id.startsWith('note-'));
check('advisor.emit clamps confidence', n1?.confidence === 80);
check('advisor.remaining decremented', sess.remaining() === 2);

const n1dup = sess.emit({ kind: 'blocker', priority: 'P0', confidence: 80, text: 'sql injection risk', turnIndex: 2 });
check('advisor dedups by text (case-insensitive)', n1dup === null);
check('advisor.remaining unchanged after dedup', sess.remaining() === 2);

const n2 = sess.emit({ kind: 'suggestion', priority: 'P3', confidence: 150, text: 'refactor this', turnIndex: 1 });
check('advisor clamps confidence over 100', n2?.confidence === 100);

sess.emit({ kind: 'concern', priority: 'P1', confidence: 60, text: 'edge case', turnIndex: 1 });
sess.emit({ kind: 'suggestion', priority: 'P2', confidence: 40, text: 'add tests', turnIndex: 2 });
check('advisor budget exhausted returns null', sess.emit({ kind: 'suggestion', priority: 'P3', confidence: 50, text: 'overflow', turnIndex: 3 }) === null);

const turn1 = sess.injectionsForTurn(1);
check('advisor.injectionsForTurn returns 3 notes', turn1.length === 3);
check('advisor injections blockers first', turn1[0].kind === 'blocker');
check('advisor injections concern before suggestion', turn1.indexOf(turn1.find(n => n.kind === 'concern')) < turn1.indexOf(turn1.find(n => n.kind === 'suggestion')));

const listedNotes = sess.list();
check('advisor.list P0 first', listedNotes[0].priority === 'P0');

check('advisor.priorityRank P0=0', advisor.priorityRank('P0') === 0);
check('advisor.priorityRank P3=3', advisor.priorityRank('P3') === 3);
check('advisor.isBlockerPriority P0', advisor.isBlockerPriority('P0') === true);
check('advisor.isBlockerPriority P2', advisor.isBlockerPriority('P2') === false);

// ---- review (Sprint 2.3) -----------------------------------------------
const safeFile = 'function add(a, b) {\n  return a + b;\n}\n';
check('review.scoreFile clean', review.scoreFile('/src/safe.ts', safeFile).length === 0);

const riskyFile = 'const apiKey = "sk-123";\neval(userInput);\nconsole.log(apiKey);\n// TODO: fix later\n';
const findings = review.scoreFile('/src/risky.ts', riskyFile);
check('review.scoreFile finds issues', findings.length >= 3);
check('review.scoreFile secret P0', findings.some(f => f.priority === 'P0'));
check('review.scoreFile eval P1', findings.some(f => f.priority === 'P1'));
check('review.scoreFile sets filePath', findings.every(f => f.filePath === '/src/risky.ts'));
check('review.scoreFile sets line numbers', findings.every(f => f.line !== null));

const verdict = review.buildVerdict(findings);
check('review.buildVerdict topPriority worst', verdict.topPriority === 'P0');
check('review.buildVerdict not approved (blockers)', verdict.approved === false);
check('review.buildVerdict confidence in range', verdict.confidence >= 0 && verdict.confidence <= 100);
check('review.buildVerdict summary mentions blocked', verdict.summary.includes('Blocked'));

const cleanVerdict = review.buildVerdict([]);
check('review.buildVerdict empty approved', cleanVerdict.approved === true);
check('review.buildVerdict empty summary', cleanVerdict.summary.includes('Approved'));

const nonBlockerFindings = [
  { filePath: '/x.ts', line: 1, priority: 'P2', confidence: 60, message: 'TODO' },
  { filePath: '/x.ts', line: 2, priority: 'P3', confidence: 50, message: 'log' },
];
const nbVerdict = review.buildVerdict(nonBlockerFindings);
check('review.buildVerdict non-blocker approved', nbVerdict.approved === true);
check('review.buildVerdict topPriority P2', nbVerdict.topPriority === 'P2');

check('review.findingConfidence clamps', review.findingConfidence({ confidence: 150 }) === 100);

// ---- commits (Sprint 2.3) ----------------------------------------------
check('commits.classifyFile source', commits.classifyFile('/src/auth.ts') === 'source');
check('commits.classifyFile test', commits.classifyFile('/src/auth.test.ts') === 'test');
check('commits.classifyFile docs', commits.classifyFile('/docs/guide.md') === 'docs');
check('commits.classifyFile config', commits.classifyFile('tsconfig.json') === 'config');
check('commits.classifyFile other', commits.classifyFile('/assets/logo.png') === 'other');

check('commits.fileScore source high', commits.fileScore('/src/a.ts') === 5);
check('commits.fileScore docs low', commits.fileScore('/README.md') === 2);

const changes = [
  { path: 'src/auth.ts', status: 'modified', linesChanged: 20 },
  { path: 'src/auth.test.ts', status: 'modified', linesChanged: 10 },
  { path: 'docs/guide.md', status: 'modified', linesChanged: 5 },
  { path: 'src/utils.ts', status: 'added', linesChanged: 30 },
  { path: 'package.json', status: 'modified', linesChanged: 2 },
];
const atomic = commits.splitAtomicCommits(changes);
const findCommit = (file) => atomic.find(c => c.files.includes(file));
check('commits.splitAtomicCommits groups by dir+cat', atomic.length >= 3);
check('commits.splitAtomicCommits all files covered', atomic.reduce((s, c) => s + c.files.length, 0) === changes.length);
check('commits.splitAtomicCommits assigns ids', atomic.every(c => c.id.startsWith('commit-')));
check('commits.splitAtomicCommits builds messages', atomic.every(c => c.message.length > 0));
check('commits source before tests', findCommit('src/auth.ts').order < findCommit('src/auth.test.ts').order);
check('commits source before docs', findCommit('src/utils.ts').order < findCommit('docs/guide.md').order);
check('commits tests depend on source', findCommit('src/auth.test.ts').dependsOn.length > 0);
check('commits docs depend on source', findCommit('docs/guide.md').dependsOn.length > 0);
check('commits source has no deps', findCommit('src/auth.ts').dependsOn.length === 0);
check('commits order sequential', atomic.every(c => c.order >= 1));

const msg = commits.buildCommitMessage([{ path: 'src/auth.ts', status: 'modified', linesChanged: 10 }], 'source');
check('commits.buildCommitMessage source feat', msg.startsWith('feat(src):'));
const testMsg = commits.buildCommitMessage([{ path: 'src/auth.test.ts', status: 'added', linesChanged: 5 }], 'test');
check('commits.buildCommitMessage test type', testMsg.startsWith('test(src):'));

check('commits.analyzeWorkingTree convenience', commits.analyzeWorkingTree(changes).length === atomic.length);
check('commits.splitAtomicCommits empty', commits.splitAtomicCommits([]).length === 0);

rmSync(buildDir, { recursive: true, force: true });
rmSync(tmpRepo, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
