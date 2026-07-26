// Smoke test for the pi-agnostic src/ layer of ithacus.
// Uses ONLY Node built-ins. No npm install, no external toolchain.
//
// Node 26 strips TypeScript types natively, but our source imports siblings
// with `.js` extensions (NodeNext style). So we copy src/*.ts into a temp dir
// as .ts files and rewrite relative `.js` import specifiers to `.ts` (a safe,
// surgical string replace on `from "..."` / `import("...")` only). Then we
// import the temp .ts directly, letting Node strip the types.

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
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
const { HindsightStore } = await import(join(buildDir, "store-hindsight.ts"));
const hindsight = await import(join(buildDir, "hindsight.ts"));
const search = await import(join(buildDir, "search.ts"));
const schemes = await import(join(buildDir, "schemes.ts"));
const { EventsStore } = await import(join(buildDir, "store-events.ts"));
const definitions = await import(join(buildDir, "definitions.ts"));
const metrics = await import(join(buildDir, "metrics.ts"));
const pluginsMod = await import(join(buildDir, "plugins.ts"));
const { LspClient, createLspClient } = await import(join(buildDir, 'lsp.ts'));
const { BrowserClient, createBrowserClient, css, xpath, text } = await import(join(buildDir, 'browser.ts'));
const { EvalClient, createEvalClient } = await import(join(buildDir, 'eval.ts'));
const { TuiClient, createTuiClient } = await import(join(buildDir, 'tui.ts'));
const { CollabClient, createCollabClient } = await import(join(buildDir, 'collab.ts'));
const { DapClient, createDapClient } = await import(join(buildDir, 'dap.ts'))
const { applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate } = await import(join(buildDir, 'ast.ts'))
const { createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop } = await import(join(buildDir, 'goal-loops.ts'))
const { runDwf, defineWorkflow } = await import(join(buildDir, 'dwf.ts'))
const { Scheduler, createScheduler, nextCronFire, nextFire } = await import(join(buildDir, 'scheduler.ts'))
const { WorkQueue, createWorkQueue } = await import(join(buildDir, 'queue.ts'))
const { InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore } = await import(join(buildDir, 'task-store.ts'))
const { runStep, runWorkflow, evalCondition } = await import(join(buildDir, 'workflow-steps.ts'))
const { parseMiniYaml, fromYaml, fromObject, validateTemplate } = await import(join(buildDir, 'workflow-yaml.ts'))
const { NegotiationManager, createNegotiationManager } = await import(join(buildDir, 'negotiation.ts'))
const { AgentHandoffManager, createHandoffManager } = await import(join(buildDir, 'handoff.ts'))
const { SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir } = await import(join(buildDir, 'swarm.ts'))
const { synthesize, majorityVote, weightedMerge, firstWins, detectConflicts } = await import(join(buildDir, 'synthesis.ts'))
const { SwarmStore, createSwarmStore } = await import(join(buildDir, 'store-swarm.ts'))

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

// ---- hindsight (Sprint 3.1) ---------------------------------------------
const storeH = new IthStore(tmpRepo, cfg.loadConfig());
const hStore = new HindsightStore(storeH.db);

const e1 = hindsight.retain(hStore, { repoId: 'repo-x', agentId: 'a1', runId: 'r1', kind: 'decision', text: 'Use SQLite for all persistence', relevance: 0.9 });
check('hindsight.retain returns entry', e1.id.startsWith('hindsight-'));
check('hindsight.retain clamps relevance', e1.relevance === 0.9);

const e2 = hindsight.retain(hStore, { repoId: 'repo-x', agentId: 'a2', runId: 'r1', kind: 'fact', text: 'Auth module has SQL injection risk', relevance: 0.7 });
const e3 = hindsight.retain(hStore, { repoId: 'repo-x', agentId: 'a1', runId: 'r1', kind: 'preference', text: 'Prefer const over let', relevance: 0.3 });

const recalled = hindsight.recall(hStore, 'repo-x');
check('hindsight.recall returns entries', recalled.length === 3);
check('hindsight.recall sorted by relevance desc', recalled[0].relevance >= recalled[1].relevance && recalled[1].relevance >= recalled[2].relevance);
check('hindsight.recall top is 0.9', recalled[0].relevance === 0.9);

const recalledKind = hindsight.recall(hStore, 'repo-x', { kind: 'decision' });
check('hindsight.recall filters by kind', recalledKind.length === 1 && recalledKind[0].text.includes('SQLite'));

const recalledMinRel = hindsight.recall(hStore, 'repo-x', { minRelevance: 0.5 });
check('hindsight.recall minRelevance filter', recalledMinRel.length === 2);

const recalledLimit = hindsight.recall(hStore, 'repo-x', { limit: 1 });
check('hindsight.recall limit', recalledLimit.length === 1);

// relevance scoring
check('hindsight.scoreRelevance full match', hindsight.scoreRelevance('use sqlite for persistence', 'sqlite persistence') === 1);
check('hindsight.scoreRelevance no match', hindsight.scoreRelevance('auth module', 'sqlite persistence') === 0);
check('hindsight.scoreRelevance empty query', hindsight.scoreRelevance('some text', '') === 0.5);

// reflect
const sessionMsgs = Array.from({ length: 12 }, (_, i) => ({
  agentId: `a${i % 3}`, role: i % 2 === 0 ? 'assistant' : 'user',
  content: `message ${i} about ${['sqlite', 'auth', 'config'][i % 3]} module`, ts: i,
}));
const reflected = hindsight.reflect(hStore, sessionMsgs, { repoId: 'repo-x', query: 'sqlite persistence', maxEntries: 5 });
check('hindsight.reflect returns summary', reflected.summary.includes('Session Reflection'));
check('hindsight.reflect compresses to maxEntries', reflected.summary.includes('5 retained'));
check('hindsight.reflect reduces 12 to 5', reflected.summary.startsWith('# Session Reflection (12 messages → 5 retained)'));
check('hindsight.reflect reflectedCount is count of already-reflected (0 here)', reflected.reflectedCount === 0);
// reflect is read-only: it does not mutate the store, so recall is unchanged
check('hindsight.reflect does not mutate store', hindsight.recall(hStore, 'repo-x').length === 3);

// reflect empty
const emptyReflect = hindsight.reflect(hStore, [], { repoId: 'repo-x' });
check('hindsight.reflect empty messages', emptyReflect.summary.includes('No session messages'));

// markReflected
// markReflected changes what reflect() reports as reflectedCount (1 now)
const beforeMark = hindsight.reflect(hStore, [], { repoId: 'repo-x' });
check('hindsight.reflect empty messages (pre-mark)', beforeMark.summary.includes('No session messages'));
check('hindsight.reflect reflectedCount still 0 for empty (no mutation)', beforeMark.reflectedCount === 0);
hStore.markReflected(e1.id);
check('hindsight.markReflected works', hStore.reflectedEntries('repo-x').some(e => e.id === e1.id));
const afterMarkReflect = hindsight.reflect(hStore, sessionMsgs, { repoId: 'repo-x', query: 'sqlite', maxEntries: 5 });
check('hindsight.reflect reports 1 reflected after markReflected', afterMarkReflect.reflectedCount === 1);

// clearHindsight
hStore.clearHindsight('repo-x');
const afterClear = hindsight.recall(hStore, 'repo-x');
check('hindsight.clearHindsight resets relevance', afterClear.every(e => e.relevance === 0));

storeH.close();

// ---- search (Sprint 3.1) -----------------------------------------------
// Mock fetch fn for network-free testing.
const mockFetch = (responses) => {
  let call = 0;
  return async (url, opts) => {
    const r = responses[call++] || { ok: false, status: 500, text: async () => 'fail', json: async () => ({}) };
    if (r.throw) throw new Error(r.throw);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => r.text || '',
      json: async () => r.json || {},
    };
  };
};

// Perplexity provider
const perplexityResults = await search.perplexityProvider.search('test query', {
  fetchFn: mockFetch([{ json: { choices: [{ message: { content: 'See https://example.com/a and https://example.com/b' } }] } }]),
  apiKey: 'pk-test',
});
check('perplexityProvider returns results', perplexityResults.length === 2);
check('perplexityProvider sets provider', perplexityResults[0].provider === 'perplexity');
check('perplexityProvider extracts urls', perplexityResults[0].url.includes('example.com'));

// Perplexity missing key throws
let perplexityThrew = false;
try { await search.perplexityProvider.search('q', { fetchFn: mockFetch([]), apiKey: undefined }); }
catch { perplexityThrew = true; }
check('perplexityProvider throws without key', perplexityThrew);

// Exa provider
const exaResults = await search.exaProvider.search('test', {
  fetchFn: mockFetch([{ json: { results: [{ title: 'R1', url: 'https://exa.io/1', text: 'snippet', score: 0.8 }] } }]),
  apiKey: 'ex-test',
});
check('exaProvider returns results', exaResults.length === 1);
check('exaProvider maps title', exaResults[0].title === 'R1');
check('exaProvider sets score', exaResults[0].score === 0.8);

// Jina provider (no key required)
const jinaResults = await search.jinaProvider.search('test', {
  fetchFn: mockFetch([{ json: { data: [{ title: 'J1', url: 'https://jina.io/1', content: 'text' }] } }]),
});
check('jinaProvider returns results', jinaResults.length === 1);
check('jinaProvider sets provider', jinaResults[0].provider === 'jina');

// Fallback chain: first provider fails, second succeeds
const chainResult = await search.searchWithFallback('query', {
  fetchFn: mockFetch([
    { throw: 'perplexity down' },
    { json: { results: [{ title: 'Exa fallback', url: 'https://exa.io/fb', score: 0.5 }] } },
  ]),
  apiKeys: { perplexity: 'pk', exa: 'ex' },
});
check('searchWithFallback returns results', chainResult.results.length === 1);
check('searchWithFallback used exa', chainResult.provider === 'exa');
check('searchWithFallback records perplexity error', chainResult.errors[0].provider === 'perplexity');

// Fallback chain: all fail
const allFail = await search.searchWithFallback('q', {
  fetchFn: mockFetch([{ throw: 'e1' }, { throw: 'e2' }, { throw: 'e3' }]),
  apiKeys: { perplexity: 'pk', exa: 'ex' },
});
check('searchWithFallback all fail returns empty', allFail.results.length === 0);
check('searchWithFallback all fail no provider', allFail.provider === '');
check('searchWithFallback all fail 3 errors', allFail.errors.length === 3);

// Fallback chain: custom providers order
const chainJinaFirst = await search.searchWithFallback('q', {
  fetchFn: mockFetch([{ json: { data: [{ title: 'J', url: 'https://j.io/1', content: 'x' }] } }]),
  providers: [search.jinaProvider],
});
check('searchWithFallback custom providers', chainJinaFirst.provider === 'jina');

check('search.DEFAULT_PROVIDERS has 3', search.DEFAULT_PROVIDERS.length === 3);

// ---- schemes (Sprint 3.1) ----------------------------------------------
const prRes = schemes.resolveScheme('pr://123');
check('resolveScheme pr', prRes.scheme === 'pr' && prRes.ref === '123');
check('resolveScheme pr command', prRes.command === 'gh');
check('resolveScheme pr args', JSON.stringify(prRes.args) === JSON.stringify(['pr', 'view', '123']));
check('resolveScheme pr kind', prRes.kind === 'pull_request');
check('resolveScheme pr description', prRes.description.includes('#123'));

const issueRes = schemes.resolveScheme('issue://456');
check('resolveScheme issue', issueRes.scheme === 'issue' && issueRes.ref === '456');
check('resolveScheme issue args', JSON.stringify(issueRes.args) === JSON.stringify(['issue', 'view', '456']));

const conflictRes = schemes.resolveScheme('conflict://main...feature');
check('resolveScheme conflict', conflictRes.scheme === 'conflict');
check('resolveScheme conflict ref', conflictRes.ref === 'main...feature');
check('resolveScheme conflict command', conflictRes.command === 'git');
check('resolveScheme conflict args', JSON.stringify(conflictRes.args) === JSON.stringify(['diff', 'main...feature']));

check('isSchemeUri pr', schemes.isSchemeUri('pr://1') === true);
check('isSchemeUri issue', schemes.isSchemeUri('issue://2') === true);
check('isSchemeUri conflict', schemes.isSchemeUri('conflict://a...b') === true);
check('isSchemeUri not scheme', schemes.isSchemeUri('https://example.com') === false);

check('formatResolution includes description', schemes.formatResolution(prRes).includes('View pull request'));
check('formatResolution includes command', schemes.formatResolution(prRes).includes('gh pr view'));

check('buildSchemeUri pr', schemes.buildSchemeUri('pr', '123') === 'pr://123');
check('buildSchemeUri conflict', schemes.buildSchemeUri('conflict', 'main...feature') === 'conflict://main...feature');

check('SUPPORTED_SCHEMES has 3', schemes.SUPPORTED_SCHEMES.length === 3);

let schemeThrew = false;
try { schemes.resolveScheme('unknown://abc'); }
catch { schemeThrew = true; }
check('resolveScheme unknown throws', schemeThrew);

const prResWhitespace = schemes.resolveScheme('  pr://789  ');
check('resolveScheme trims whitespace', prResWhitespace.ref === '789');

// ---- store-events (Sprint 3.2) -----------------------------------------
const storeE = new IthStore(tmpRepo, cfg.loadConfig());
const eStore = new EventsStore(storeE.db);

eStore.append({ id: 'e1', runId: 'r1', agentId: 'a1', action: 'spawned', metadata: { role: 'explorer' }, ts: 1000 });
eStore.append({ id: 'e2', runId: 'r1', agentId: 'a1', action: 'tool_call', metadata: { tool: 'rg' }, ts: 2000 });
eStore.append({ id: 'e3', runId: 'r1', agentId: 'a2', action: 'spawned', metadata: { role: 'planner' }, ts: 3000 });
eStore.append({ id: 'e4', runId: 'r2', agentId: 'a3', action: 'spawned', metadata: {}, ts: 4000 });

check('EventsStore.append persists', eStore.query({ runId: 'r1' }).length === 3);
check('EventsStore.query by agent', eStore.query({ agentId: 'a1' }).length === 2);
check('EventsStore.query by action', eStore.query({ action: 'spawned' }).length === 3);
check('EventsStore.query ordered by ts', eStore.query({ runId: 'r1' })[0].id === 'e1');
check('EventsStore.query limit', eStore.query({ runId: 'r1', limit: 2 }).length === 2);
check('EventsStore.count', eStore.count({ runId: 'r1' }) === 3);
check('EventsStore.count by action', eStore.count({ action: 'spawned' }) === 3);
check('EventsStore.metadata parsed', eStore.query({ runId: 'r1' })[0].metadata.role === 'explorer');
check('EventsStore empty metadata', eStore.query({ runId: 'r2' })[0].metadata !== undefined);

eStore.clearRun('r1');
check('EventsStore.clearRun', eStore.query({ runId: 'r1' }).length === 0);

storeE.close();

// ---- definitions (Sprint 3.2) -----------------------------------------
const agentMd = `---\nname: Code Reviewer\nrole: reviewer\nmodel: claude-sonnet\ntools:\n  - rg\n  - read\ntriggers:\n  - review\n  - audit\n---\nYou are a code reviewer. Check for bugs and security issues.`;
const agentDef = definitions.parseAgentDefinition(agentMd, '/agents/reviewer.md', 'project');
check('parseAgentDefinition name', agentDef?.name === 'Code Reviewer');
check('parseAgentDefinition role', agentDef?.role === 'reviewer');
check('parseAgentDefinition model', agentDef?.model === 'claude-sonnet');
check('parseAgentDefinition id slug', agentDef?.id === 'code-reviewer');
check('parseAgentDefinition tools', JSON.stringify(agentDef?.tools) === JSON.stringify(['rg', 'read']));
check('parseAgentDefinition triggers', agentDef?.triggers.includes('review'));
check('parseAgentDefinition body', agentDef?.systemPrompt.includes('code reviewer'));
check('parseAgentDefinition layer', agentDef?.layer === 'project');

const agentNoFm = definitions.parseAgentDefinition('Just a plain agent with instructions.', '/agents/plain.md', 'user');
check('parseAgentDefinition no frontmatter uses body', agentNoFm?.systemPrompt.includes('plain agent'));

const emptyAgent = definitions.parseAgentDefinition('', '/agents/empty.md', 'builtin');
check('parseAgentDefinition empty returns null', emptyAgent === null);

const teamMd = `---\nname: Review Team\nworkflow: review\nagents:\n  - explorer:explorer\n  - reviewer:code-reviewer\n---\nTeam config.`;
const teamDef = definitions.parseTeamDefinition(teamMd, '/teams/review.md', 'project');
check('parseTeamDefinition name', teamDef?.name === 'Review Team');
check('parseTeamDefinition workflow', teamDef?.workflow === 'review');
check('parseTeamDefinition agents count', teamDef?.agents.length === 2);
check('parseTeamDefinition agent role', teamDef?.agents[0].role === 'explorer');
check('parseTeamDefinition agentId', teamDef?.agents[1].agentId === 'code-reviewer');

const emptyTeam = definitions.parseTeamDefinition('---\nname: x\n---\nbody', '/teams/x.md', 'builtin');
check('parseTeamDefinition no agents returns null', emptyTeam === null);

// 3-layer discovery
const defDir = mkdtempSync(join(tmpdir(), 'ithacus-defs-'));
mkdirSync(join(defDir, 'project'), { recursive: true });
writeFileSync(join(defDir, 'project', 'custom.md'), agentMd);
mkdirSync(join(defDir, 'ext'), { recursive: true });
writeFileSync(join(defDir, 'ext', 'base.md'), '---\nname: Base\nrole: executor\n---\nBase agent.');

const discovered = definitions.discoverAgentDefinitions({
  builtinDir: join(defDir, 'ext'),
  projectDir: join(defDir, 'project'),
});
check('discoverAgentDefinitions 2 agents', discovered.length === 2);
check('discoverAgentDefinitions finds custom', discovered.some(d => d.name === 'Code Reviewer'));

const teamDiscovered = definitions.discoverTeamDefinitions({
  builtinDir: join(defDir, 'ext'),
  projectDir: join(defDir, 'project'),
});
check('discoverTeamDefinitions handles no teams dir', teamDiscovered.length === 0);

check('validateAgentDefinition valid', definitions.validateAgentDefinition(agentDef) === null);
check('validateAgentDefinition missing name', definitions.validateAgentDefinition({ ...agentDef, name: '' })?.includes('name'));

rmSync(defDir, { recursive: true, force: true });

// ---- metrics (Sprint 3.2) ----------------------------------------------
const metricsReg = metrics.createMetricsRegistry();
metricsReg.inc('tasks_completed');
metricsReg.inc('tasks_completed');
metricsReg.inc('tasks_completed', 5);
check('metrics.inc counter', metricsReg.getCounter('tasks_completed') === 7);
metricsReg.inc('errors', 1, { type: 'timeout' });
metricsReg.inc('errors', 1, { type: 'timeout' });
metricsReg.inc('errors', 1, { type: 'crash' });
check('metrics.inc with labels', metricsReg.getCounter('errors', { type: 'timeout' }) === 2);
check('metrics.inc labels separate', metricsReg.getCounter('errors', { type: 'crash' }) === 1);

metricsReg.set('active_agents', 3);
metricsReg.set('active_agents', 5);
check('metrics.set gauge', metricsReg.getGauge('active_agents') === 5);

metricsReg.observe('task_duration_ms', 150);
metricsReg.observe('task_duration_ms', 300);
metricsReg.observe('task_duration_ms', 50);
check('metrics.observe histogram', metricsReg.getHistogram('task_duration_ms').length === 3);

// task helpers
metricsReg.recordDuration('task-1', 250);
metricsReg.recordTokens('task-1', 1000);
check('metrics.recordDuration', metricsReg.getHistogram('ithacus_task_duration_ms', { taskId: 'task-1' }).includes(250));
check('metrics.recordTokens', metricsReg.getCounter('ithacus_task_tokens_total', { taskId: 'task-1' }) === 1000);

metricsReg.trackTask('task-2', 500, 2000);
check('metrics.trackTask duration', metricsReg.getHistogram('ithacus_task_duration_ms', { taskId: 'task-2' }).includes(500));
check('metrics.trackTask tokens', metricsReg.getCounter('ithacus_task_tokens_total', { taskId: 'task-2' }) === 2000);

// Prometheus export
const prom = metricsReg.toPrometheus();
check('metrics.toPrometheus has TYPE', prom.includes('# TYPE tasks_completed counter'));
check('metrics.toPrometheus has value', prom.includes('tasks_completed 7'));
check('metrics.toPrometheus has gauge', prom.includes('# TYPE active_agents gauge'));
check('metrics.toPrometheus has histogram', prom.includes('# TYPE ithacus_task_duration_ms histogram'));
check('metrics.toPrometheus has bucket', prom.includes('ithacus_task_duration_ms_bucket{le="0.005"'));
check('metrics.toPrometheus has +Inf', prom.includes('le="+Inf"'));
check('metrics.toPrometheus labels', prom.includes('type="timeout"'));

// OTLP export
const otlp = metricsReg.toOTLP();
check('metrics.toOTLP is JSON', (() => { try { JSON.parse(otlp); return true; } catch { return false; } })());
check('metrics.toOTLP has service name', otlp.includes('ithacus'));
check('metrics.toOTLP has counter', otlp.includes('tasks_completed'));
check('metrics.toOTLP has gauge', otlp.includes('active_agents'));

metricsReg.clear();
check('metrics.clear empties', metricsReg.allPoints().length === 0);

// ---- trim preserveHeadTail (Sprint 3.2) --------------------------------
const trimMessages = [
  { content: 'intro text' },
  { content: '## Heading\nbody' }, // complete heading
  { content: 'plain paragraph' },
  { content: '```js\nconst x = 1;\n```' }, // closed fence
];
// No boundary conflict: headings and fences are complete within messages.
check('trim.detectBoundaryConflict clean', trim.detectBoundaryConflict(trimMessages, 1, 3) === false);
check('trim.preserveHeadTail no conflict', trim.preserveHeadTail(trimMessages, 1, 3).preserve === false);

// Unclosed fence: single backtick block with no closing
const unclosedFence = [{ content: '```js\nconst x = 1;' }];
check('trim.detectBoundaryConflict unclosed fence', trim.detectBoundaryConflict(unclosedFence, 0, 1) === true);
check('trim.preserveHeadTail fence conflict', trim.preserveHeadTail(unclosedFence, 0, 1).preserve === true);

// Heading line alone (starts with #, no newline → orphaned)
const orphanedHeading = [{ content: '## Orphaned Heading' }];
check('trim.detectBoundaryConflict orphaned heading', trim.detectBoundaryConflict(orphanedHeading, 0, 1) === true);

// Closed fence (``` start and ``` end within message)
const closedFence = [{ content: '```js\ncode\n```\nmore text' }];
check('trim.detectBoundaryConflict closed fence', trim.detectBoundaryConflict(closedFence, 0, 1) === false);

// ---- plugins (Sprint 3.2) ---------------------------------------------
const plugReg = pluginsMod.createPluginRegistry();
const testPlugin = {
  id: 'context-injector',
  name: 'Context Injector',
  hooks: ['preSpawn', 'postSpawn'],
  injectContext: ({ agentId }) => `[plugin] Context for ${agentId}`,
};
plugReg.register(testPlugin);
check('plugins.list', plugReg.list().length === 1);
check('plugins.forHook preSpawn', plugReg.forHook('preSpawn').length === 1);
check('plugins.forHook postSpawn', plugReg.forHook('postSpawn').length === 1);
check('plugins.forHook empty', plugReg.forHook('onTurnEnd').length === 0);

const injected = plugReg.injectContext('preSpawn', { agentId: 'a1', runId: 'r1' });
check('plugins.injectContext returns text', injected.includes('Context for a1'));

const spawnCtx = plugReg.onAgentSpawn('a2', 'r1');
check('plugins.onAgentSpawn', spawnCtx.includes('Context for a2'));

// empty hook
const emptyPlug = pluginsMod.createPluginRegistry();
check('plugins.injectContext empty', emptyPlug.injectContext('preSpawn', { agentId: 'x', runId: 'y' }) === '');

// unregister
plugReg.unregister('context-injector');
check('plugins.unregister', plugReg.list().length === 0);
check('plugins.unregister removes from hooks', plugReg.forHook('preSpawn').length === 0);

// plugin without injectContext
const noInjectPlugin = { id: 'no-inject', name: 'NoInject', hooks: ['preSpawn'] };
plugReg.register(noInjectPlugin);
check('plugins.no injectContext empty', plugReg.injectContext('preSpawn', { agentId: 'z', runId: 'r' }) === '');

plugReg.clear();
check('plugins.clear', plugReg.list().length === 0);

// ---- lsp (Sprint 4.1) -------------------------------------------------
// Mock transport for network-free testing (mirrors the search.ts mockFetch pattern).
const makeLspTransport = (handlers) => {
  const notifyLog = [];
  return {
    request: async (method, params) => {
      const h = handlers[method];
      if (method === 'initialize' && !h) return { capabilities: {} };
      if (!h) throw new Error(`mock: no handler for ${method}`);
      return h(params);
    },
    notify: (method, params) => { notifyLog.push({ method, params }); },
    isReady: () => true,
    _notifyLog: notifyLog,
  };
};

const doc = { uri: 'file:///src/foo.ts' };
const pos = { line: 5, character: 10 };
const range = { start: { line: 5, character: 8 }, end: { line: 5, character: 14 } };

// initialize + capabilities
const initT = makeLspTransport({
  initialize: () => ({ capabilities: { completionProvider: true, renameProvider: true } }),
});
const initClient = createLspClient(initT);
const caps = await initClient.initialize('file:///repo');
check('lsp.initialize returns capabilities', caps.completionProvider === true);
check('lsp.initialize sends initialized notify', initT._notifyLog.some(n => n.method === 'initialized'));

// openDocument + didOpen notify
const client = createLspClient(makeLspTransport({ initialize: () => ({ capabilities: {} }) }));
await client.initialize('file:///repo');
client.openDocument({ uri: doc.uri, languageId: 'typescript', version: 1, text: 'const x = 1;' });
check('lsp.openDocument tracks doc', client.isOpen(doc.uri) === true);
check('lsp.openDocument not open before', client.isOpen('file:///other.ts') === false);

// changeDocument throws if not open
let changeThrew = false;
try { client.changeDocument('file:///notopen.ts', 2, 'x'); }
catch { changeThrew = true; }
check('lsp.changeDocument throws if not open', changeThrew === true);

// changeDocument on open doc updates version + text
check('lsp.changeDocument updates without throwing when doc open', (() => { try { client.changeDocument(doc.uri, 2, 'const x = 2;'); client.changeDocument(doc.uri, 3, 'z'); return client.isOpen(doc.uri); } catch { return false; } })());

// closeDocument
client.closeDocument(doc.uri);
check('lsp.closeDocument removes from open set', client.isOpen(doc.uri) === false);

// 1. diagnostics
const diagClient = createLspClient(makeLspTransport({ 'textDocument/diagnostic': () => ({ items: [{ range, severity: 'error', message: 'oops' }] }) }));
await diagClient.initialize('r');
const diags = await diagClient.diagnostics(doc);
check('lsp.diagnostics returns items', diags.length === 1);
check('lsp.diagnostics severity', diags[0].severity === 'error');
check('lsp.diagnostics message', diags[0].message === 'oops');

// diagnostics empty
const diagEmptyClient = createLspClient(makeLspTransport({ 'textDocument/diagnostic': () => ({ items: [] }) }));
await diagEmptyClient.initialize('r');
check('lsp.diagnostics empty', (await diagEmptyClient.diagnostics(doc)).length === 0);

// 2. definition (single Location)
const defClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => ({ uri: doc.uri, range }) }));
await defClient.initialize('r');
const defs = await defClient.definition(doc, pos);
check('lsp.definition single wrapped in array', defs.length === 1 && defs[0].uri === doc.uri);

// definition array
const defArrClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => [{ uri: 'file:///a.ts', range }, { uri: 'file:///b.ts', range }] }));
await defArrClient.initialize('r');
const defsArr = await defArrClient.definition(doc, pos);
check('lsp.definition array passed through', defsArr.length === 2);

// definition null
const defNullClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => null }));
await defNullClient.initialize('r');
check('lsp.definition null -> empty', (await defNullClient.definition(doc, pos)).length === 0);

// definition LocationLink normalization (P3 fix)
const linkClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => ({ targetUri: 'file:///target.ts', targetRange: range }) }));
await linkClient.initialize('r');
const links = await linkClient.definition(doc, pos);
check('lsp.definition normalizes LocationLink', links.length === 1 && links[0].uri === 'file:///target.ts' && links[0].range === range);

// 3. references
const refClient = createLspClient(makeLspTransport({ 'textDocument/references': () => [{ uri: doc.uri, range }, { uri: 'file:///other.ts', range }] }));
await refClient.initialize('r');
const refs = await refClient.references(doc, pos, true);
check('lsp.references returns list', refs.length === 2);

// 4. rename — spec-compliant WorkspaceEdit shape
const renClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => ({ changes: { [doc.uri]: [{ range, newText: 'newName' }] } }) }));
await renClient.initialize('r');
const renames = await renClient.rename(doc, pos, 'newName');
check('lsp.rename returns edits from changes map', renames.length === 1 && renames[0].newText === 'newName');

// rename with documentChanges
const renDCClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => ({ documentChanges: [{ textDocument: { uri: doc.uri }, edits: [{ range, newText: 'alias' }] }] }) }));
await renDCClient.initialize('r');
const renDC = await renDCClient.rename(doc, pos, 'alias');
check('lsp.rename flattens documentChanges', renDC.length === 1 && renDC[0].newText === 'alias');

// rename empty WorkspaceEdit
const renEmptyClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => ({}) }));
await renEmptyClient.initialize('r');
check('lsp.rename empty WorkspaceEdit → []', (await renEmptyClient.rename(doc, pos, 'x')).length === 0);

// rename null
const renNullClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => null }));
await renNullClient.initialize('r');
check('lsp.rename null → []', (await renNullClient.rename(doc, pos, 'x')).length === 0);

// 5. codeAction
const caClient = createLspClient(makeLspTransport({ 'textDocument/codeAction': () => [{ title: 'Fix typo', kind: 'quickfix' }] }));
await caClient.initialize('r');
const cas = await caClient.codeAction(doc, range);
check('lsp.codeAction returns list', cas.length === 1 && cas[0].title === 'Fix typo');

// codeAction empty
const caEmpty = createLspClient(makeLspTransport({ 'textDocument/codeAction': () => null }));
await caEmpty.initialize('r');
check('lsp.codeAction null -> empty', (await caEmpty.codeAction(doc, range)).length === 0);

// 6. workspaceSymbols
const wsClient = createLspClient(makeLspTransport({ 'workspace/symbol': () => [{ name: 'Foo', kind: 12, range }] }));
await wsClient.initialize('r');
const syms = await wsClient.workspaceSymbols('Foo');
check('lsp.workspaceSymbols returns list', syms.length === 1 && syms[0].name === 'Foo');

// 7. documentSymbol
const dsClient = createLspClient(makeLspTransport({ 'textDocument/documentSymbol': () => [{ name: 'myFunc', kind: 12, range }] }));
await dsClient.initialize('r');
const docSyms = await dsClient.documentSymbol(doc);
check('lsp.documentSymbol returns list', docSyms.length === 1 && docSyms[0].name === 'myFunc');

// 8. hover
const hovClient = createLspClient(makeLspTransport({ 'textDocument/hover': () => ({ contents: 'string hover' }) }));
await hovClient.initialize('r');
const hov = await hovClient.hover(doc, pos);
check('lsp.hover returns contents', hov !== null && hov.contents === 'string hover');

// hover null
const hovNull = createLspClient(makeLspTransport({ 'textDocument/hover': () => null }));
await hovNull.initialize('r');
check('lsp.hover null -> null', await hovNull.hover(doc, pos) === null);

// 9. signatureHelp
const sigClient = createLspClient(makeLspTransport({ 'textDocument/signatureHelp': () => ({ signatures: [{ label: 'foo(a, b)' }], activeSignature: 0 }) }));
await sigClient.initialize('r');
const sig = await sigClient.signatureHelp(doc, pos);
check('lsp.signatureHelp returns signatures', sig !== null && sig.signatures.length === 1);

// 10. formatting
const fmtClient = createLspClient(makeLspTransport({ 'textDocument/formatting': () => [{ range, newText: 'formatted' }] }));
await fmtClient.initialize('r');
const fmts = await fmtClient.formatting(doc);
check('lsp.formatting returns edits', fmts.length === 1 && fmts[0].newText === 'formatted');

// 11. foldingRange
const foldClient = createLspClient(makeLspTransport({ 'textDocument/foldingRange': () => [{ startLine: 0, endLine: 5, kind: 'region' }] }));
await foldClient.initialize('r');
const folds = await foldClient.foldingRange(doc);
check('lsp.foldingRange returns ranges', folds.length === 1 && folds[0].endLine === 5);

// 12. selectionRange
const selClient = createLspClient(makeLspTransport({ 'textDocument/selectionRange': () => [{ range }] }));
await selClient.initialize('r');
const sels = await selClient.selectionRange(doc, [pos]);
check('lsp.selectionRange returns ranges', sels.length === 1);

// 13. linkedEditingRange
const linkedClient = createLspClient(makeLspTransport({ 'textDocument/linkedEditingRange': () => ({ ranges: [range], wordPattern: '\\w+' }) }));
await linkedClient.initialize('r');
const linked = await linkedClient.linkedEditingRange(doc, pos);
check('lsp.linkedEditingRange returns ranges', linked !== null && linked.ranges.length === 1);

// linkedEditingRange null
const linkedNull = createLspClient(makeLspTransport({ 'textDocument/linkedEditingRange': () => null }));
await linkedNull.initialize('r');
check('lsp.linkedEditingRange null -> null', await linkedNull.linkedEditingRange(doc, pos) === null);

// 14. semanticTokensFull
const semClient = createLspClient(makeLspTransport({ 'textDocument/semanticTokens/full': () => ({ data: [0, 0, 5, 1, 0] }) }));
await semClient.initialize('r');
const sem = await semClient.semanticTokensFull(doc);
check('lsp.semanticTokensFull returns data', sem.data.length === 5 && sem.data[2] === 5);

// semanticTokensFull null fallback
const semNullClient = createLspClient(makeLspTransport({ 'textDocument/semanticTokens/full': () => null }));
await semNullClient.initialize('r');
const semNull = await semNullClient.semanticTokensFull(doc);
check('lsp.semanticTokensFull null -> empty data', semNull.data.length === 0);

// shutdown clears open docs
const shutdownClient = createLspClient(makeLspTransport({ initialize: () => ({}), shutdown: () => null }));
await shutdownClient.initialize('r');
shutdownClient.openDocument({ uri: doc.uri, languageId: 'ts', version: 1, text: 'x' });
check('lsp.shutdown precondition: doc open', shutdownClient.isOpen(doc.uri) === true);
await shutdownClient.shutdown();
check('lsp.shutdown clears open docs', shutdownClient.isOpen(doc.uri) === false);

// transport error propagates
const errClient = createLspClient(makeLspTransport({ initialize: () => ({}), 'textDocument/hover': () => { throw new Error('server down'); } }));
await errClient.initialize('r');
let errThrew = false;
try { await errClient.hover(doc, pos); }
catch (e) { errThrew = e.message === 'server down'; }
check('lsp.transport error propagates', errThrew === true);

// ---- browser (Sprint 4.2) ---------------------------------------------
// Wrapped in an awaited async IIFE to isolate identifiers (avoid collisions
// with existing top-level smoke vars like `bc`).
await (async () => {
// Mock driver for network-free testing.
const makeBrowserDriver = (handlers) => {
  const tabs = new Map();
  let stealthEvents = [];
  let stealthOn = false;
  let tabCounter = 0;
  return {
    newTab: async (url, opts) => {
      const id = `tab-${++tabCounter}`;
      const tab = { id, url, title: `Tab ${tabCounter}`, active: true, createdAt: Date.now() };
      tabs.set(id, tab);
      return tab;
    },
    closeTab: async (id) => { tabs.delete(id); },
    listTabs: async () => [...tabs.values()],
    goto: async (id, url) => { const t = tabs.get(id); if (t) { t.url = url; } return t; },
    evaluate: async (id, script) => handlers.evaluate ? handlers.evaluate(id, script) : { ok: true, value: 'eval-result', ts: Date.now() },
    screenshot: async (id, opts) => ({ data: 'base64data', encoding: opts?.encoding ?? 'binary', width: 800, height: 600, ts: Date.now() }),
    click: async (id, sel) => true,
    type: async (id, sel, txt, opts) => true,
    snapshot: async (id, sel) => handlers.snapshot ? handlers.snapshot(sel) : { tagName: 'div', text: 'hi', html: '<div>hi</div>', attributes: { class: 'x' }, isVisible: true },
    enableStealth: async (id) => { stealthOn = true; stealthEvents = []; },
    disableStealth: async (id) => { stealthOn = false; const ev = stealthEvents; stealthEvents = []; return ev; },
    isReady: () => true,
    _injectStealthEvent: (ev) => { if (stealthOn) stealthEvents.push(ev); },
    _tabs: tabs,
  };
};

let cellCounter = 0;
const makeEvalRuntime = (handlers) => {
  const cells = new Map();
  const state = new Map();
  return {
    startCell: async (runtime, code) => {
      const id = `cell-${++cellCounter}`;
      const cell = { id, runtime, code, persistent: true, createdAt: Date.now() };
      cells.set(id, cell);
      return cell;
    },
    runCell: async (cellId, code) => {
      const cell = cells.get(cellId);
      if (!cell) throw new Error('not found');
      return handlers.runCell ? handlers.runCell(cellId, code, state) : { cellId, stdout: 'ok', stderr: '', exitCode: 0, returnValue: null, durationMs: 1, ts: Date.now() };
    },
    stopCell: async (cellId) => { cells.delete(cellId); state.delete(cellId); },
    listCells: async () => [...cells.values()],
    callTool: async (cellId, tool, args) => handlers.callTool ? handlers.callTool(cellId, tool, args) : { tool, args },
    _cells: cells, _state: state,
  };
};

// browser client basics
const bc = createBrowserClient(makeBrowserDriver({}));
const tab = await bc.open('https://example.com');
check('browser.open returns tab', tab.id.startsWith('tab-') && tab.url === 'https://example.com');
check('browser.isReady', bc.isReady() === true);

const tab2 = await bc.open('https://other.com');
const tabs = await bc.tabs();
check('browser.tabs lists', tabs.length === 2);

const navigated = await bc.goto(tab.id, 'https://example.com/page2');
check('browser.goto updates url', navigated.url === 'https://example.com/page2');

const evalRes = await bc.evaluate(tab.id, 'document.title');
check('browser.evaluate returns EvalResult', evalRes.ok === true && evalRes.value === 'eval-result');

const shot = await bc.screenshot(tab.id, { encoding: 'base64' });
check('browser.screenshot returns data', shot.encoding === 'base64' && shot.data === 'base64data');
check('browser.screenshot dimensions', shot.width === 800 && shot.height === 600);

const clicked = await bc.click(tab.id, css('#btn'));
check('browser.click returns bool', clicked === true);

const typed = await bc.type(tab.id, css('#input'), 'hello', { delay: 10 });
check('browser.type returns bool', typed === true);

const snap = await bc.snapshot(tab.id, css('.container'));
check('browser.snapshot returns element', snap?.tagName === 'div' && snap.text === 'hi');

// null snapshot (element not found)
const nullDriver = makeBrowserDriver({ snapshot: () => null });
const nullSnap = await createBrowserClient(nullDriver).snapshot('x', css('.none'));
check('browser.snapshot null when not found', nullSnap === null);

// selector helpers
check('browser.css helper', JSON.stringify(css('#a')) === JSON.stringify({ strategy: 'css', value: '#a' }));
check('browser.xpath helper', xpath('//div').strategy === 'xpath');
check('browser.text helper', text('hello').strategy === 'text');

// stealth mode
const stealthDriver = makeBrowserDriver({});
const stealthClient = createBrowserClient(stealthDriver);
await stealthClient.enableStealth(tab.id);
stealthDriver._injectStealthEvent({ method: 'GET', url: 'https://x.com/a', status: 200, resourceType: 'document', ts: Date.now() });
stealthDriver._injectStealthEvent({ method: 'POST', url: 'https://x.com/b', status: 404, resourceType: 'xhr', ts: Date.now() });
const events = await stealthClient.disableStealth(tab.id);
check('browser.disableStealth returns events', events.length === 2);
check('browser.stealth event method', events[0].method === 'GET');

// stealth unsupported throws
const noStealthDriver = { newTab: async () => ({ id: 't', url: '', title: '', active: false, createdAt: 0 }), closeTab: async () => {}, listTabs: async () => [], goto: async () => ({ id: 't', url: '', title: '', active: false, createdAt: 0 }), evaluate: async () => ({ ok: true, value: null, ts: 0 }), screenshot: async () => ({ data: '', encoding: 'binary', width: 0, height: 0, ts: 0 }), click: async () => false, type: async () => false, snapshot: async () => null };
const noStealthClient = createBrowserClient(noStealthDriver);
let stealthThrew = false;
try { await noStealthClient.enableStealth('t'); } catch { stealthThrew = true; }
check('browser.enableStealth throws when unsupported', stealthThrew === true);

// close tab
await bc.close(tab.id);
check('browser.close removes tab', (await bc.tabs()).length === 1);

// ---- eval (Sprint 4.2) ------------------------------------------------
const ec = createEvalClient(makeEvalRuntime({}));
const cell = await ec.start('python', 'x = 1');
check('eval.start returns cell', cell.id.startsWith('cell-') && cell.runtime === 'python');
check('eval.has tracked', ec.has(cell.id) === true);
check('eval.has untracked', ec.has('cell-nonexistent') === false);

const result = await ec.run(cell.id, 'x + 1');
check('eval.run returns result', result.cellId === cell.id && result.exitCode === 0);

// run throws on unknown cell
let evalThrew = false;
try { await ec.run('cell-unknown'); } catch { evalThrew = true; }
check('eval.run throws unknown cell', evalThrew === true);

// callTool
const toolResult = await ec.callTool(cell.id, 'rg', { pattern: 'foo' });
check('eval.callTool returns tool result', toolResult.tool === 'rg' && toolResult.args.pattern === 'foo');

// callTool throws on unknown cell
let toolThrew = false;
try { await ec.callTool('cell-x', 'rg', {}); } catch { toolThrew = true; }
check('eval.callTool throws unknown cell', toolThrew === true);

// list
const cell2 = await ec.start('bun', 'console.log("hi")');
check('eval.list tracks multiple', ec.list().length === 2);
check('eval.list bun runtime', ec.list().some(c => c.runtime === 'bun'));

// persistent state across runs
const stateful = createEvalClient(makeEvalRuntime({
  runCell: (cellId, code, state) => {
    const cur = (state.get('counter') ?? 0);
    state.set('counter', cur + 1);
    return { cellId, stdout: `run ${cur + 1}`, stderr: '', exitCode: 0, returnValue: cur + 1, durationMs: 1, ts: Date.now() };
  },
}));
const sc = await stateful.start('python', 'counter');
const r1 = await stateful.run(sc.id);
const r2 = await stateful.run(sc.id);
check('eval persistent state increments', r1.returnValue === 1 && r2.returnValue === 2);

// stop + stopAll
await ec.stop(cell.id);
check('eval.stop removes cell', ec.has(cell.id) === false);
await ec.stopAll();
check('eval.stopAll clears', ec.list().length === 0);
})(); // end Sprint 4.2 IIFE

// ---- tui + collab (Sprint 4.3) ----------------------------------------
await (async () => {
  // Mock TUI renderer
  const makeRenderer = () => {
    const renders = [];
    const diffs = [];
    return {
      render: async (frame) => { renders.push(frame); },
      applyDiff: async (diff) => { diffs.push(diff); },
      readInput: async (prompt) => 'yes',
      clear: async () => {},
      isAttached: () => true,
      _renders: renders, _diffs: diffs,
    };
  };

  const tc = createTuiClient(makeRenderer());
  check('tui.isAttached default true', tc.isAttached() === true);

  tc.addCard({ id: 'c1', title: 'Card 1', body: 'hello', kind: 'tool_call', collapsed: false });
  tc.addCard({ id: 'c2', title: 'Card 2', body: 'world', kind: 'tool_result', collapsed: false });

  const frame = await tc.render();
  check('tui.render returns frame', frame.cards.length === 2);
  check('tui.render renders to renderer', tc.renderer._renders.length === 1);

  // updateCard returns false for unknown
  check('tui.updateCard unknown returns false', tc.updateCard({ id: 'nope', title: 'x', body: 'y', kind: 'info', collapsed: false }) === false);

  // diff: add + update + remove
  tc.updateCard({ id: 'c1', title: 'Card 1', body: 'CHANGED', kind: 'tool_call', collapsed: false });
  tc.removeCard('c2');
  tc.addCard({ id: 'c3', title: 'Card 3', body: 'new', kind: 'ask', collapsed: false });
  const diff = await tc.renderDiff();
  check('tui.renderDiff added', diff.added.length === 1 && diff.added[0].id === 'c3');
  check('tui.renderDiff updated', diff.updated.length === 1 && diff.updated[0].id === 'c1');
  check('tui.renderDiff removed', diff.removed.length === 1 && diff.removed[0] === 'c2');
  check('tui.renderDiff applied to renderer', tc.renderer._diffs.length === 1);

  // kind-only change triggers update (P2 fix)
  const tcKind = createTuiClient(makeRenderer());
  tcKind.addCard({ id: 'k1', title: 'K', body: 'same', kind: 'tool_call', collapsed: false });
  await tcKind.render();
  tcKind.updateCard({ id: 'k1', title: 'K', body: 'same', kind: 'tool_result', collapsed: false });
  const diffKind = await tcKind.renderDiff();
  check('tui.renderDiff detects kind-only change', diffKind.updated.length === 1 && diffKind.updated[0].id === 'k1');

  // edit preview
  await tc.renderEditPreview({ filePath: '/src/x.ts', before: 'a', after: 'b', diffHunks: ['-a', '+b'] });
  check('tui.renderEditPreview adds card', tc.renderer._diffs.length === 2);

  // ask picker
  const chosen = await tc.askPicker('Proceed?', [
    { id: 'yes', label: 'Yes', selected: false },
    { id: 'no', label: 'No', selected: false },
  ]);
  check('tui.askPicker picks yes', chosen === 'yes');

  // ask picker fallback to first
  const tc2 = createTuiClient({ render: async () => {}, applyDiff: async () => {}, readInput: async () => 'unknown', clear: async () => {} });
  const fallback = await tc2.askPicker('?', [{ id: 'a', label: 'A', selected: false }]);
  check('tui.askPicker fallback first', fallback === 'a');

  // QR code
  let qrPayload = null;
  await tc.renderQr('https://join.example/abc', (text) => {
    qrPayload = text;
    return { text, ascii: '█▀▀█', size: 3 };
  });
  check('tui.renderQr generates', qrPayload === 'https://join.example/abc');

  // status/input line in diff
  tc.setStatus('rendering...');
  const diffStatus = await tc.renderDiff();
  check('tui.statusLine in diff when changed', diffStatus.statusLine === 'rendering...');
  // unchanged status not included
  const diffNoStatus = await tc.renderDiff();
  check('tui.statusLine omitted when unchanged', diffNoStatus.statusLine === undefined);

  // clear
  await tc.clear();
  check('tui.clear resets', tc !== undefined);

  // ---- collab ----
  const makeRelay = () => {
    const sessions = new Map();
    const participants = new Map();
    const subscribers = new Map();
    let tokenCounter = 0;
    return {
      createSession: async (host) => {
        const id = `session-${++tokenCounter}`;
        const token = `token-${tokenCounter}`;
        const session = { id, token, participants: [host], active: true, createdAt: Date.now() };
        sessions.set(id, session);
        participants.set(id, [host]);
        return session;
      },
      joinSession: async (token, participant) => {
        for (const s of sessions.values()) {
          if (s.token === token) { participants.get(s.id).push(participant); return { ...s, participants: participants.get(s.id) }; }
        }
        throw new Error('unknown token');
      },
      leaveSession: async (sessionId, participantId) => {
        const arr = participants.get(sessionId) ?? [];
        participants.set(sessionId, arr.filter(p => p.id !== participantId));
      },
      broadcast: async (msg) => {
        (subscribers.get(msg.sessionId) ?? []).forEach(h => h(msg));
      },
      subscribe: async (sessionId, handler) => {
        if (!subscribers.has(sessionId)) subscribers.set(sessionId, []);
        subscribers.get(sessionId).push(handler);
        return () => { subscribers.set(sessionId, subscribers.get(sessionId).filter(h => h !== handler)); };
      },
      listParticipants: async (sessionId) => participants.get(sessionId) ?? [],
    };
  };

  let myIdCounter = 0;
  const relay = makeRelay();
  const cc = createCollabClient(relay, `me-${++myIdCounter}`);
  const token = await cc.host('Alice');
  check('collab.host returns non-empty token', token.length > 0);
  check('collab.host returns token', token.startsWith('token-'));

  const ps = await cc.participants('session-1');
  check('collab.participants returns host', ps.length === 1 && ps[0].name === 'Alice');

  // read-only link generation
  const roLink = await cc.generateReadOnlyLink('session-1');
  check('collab.generateReadOnlyLink token:ro', roLink.endsWith(':ro'));

  // throws on unknown session
  let roThrew = false;
  try { await cc.generateReadOnlyLink('unknown'); } catch { roThrew = true; }
  check('collab.generateReadOnlyLink throws unknown', roThrew === true);

  // broadcast + subscribe
  const cc2 = createCollabClient(relay, `me-${++myIdCounter}`);
  const received = [];
  const unsub = await cc.onMessage('session-1', (msg) => received.push(msg));
  await cc.sendChat('session-1', 'hello team');
  await cc.sendEdit('session-1', { file: '/x.ts', change: 'edit' });
  await cc.sendPresence('session-1', { line: 5 });
  check('collab.subscribe receives broadcasts', received.length === 3);
  check('collab.sendChat kind', received[0].kind === 'chat' && received[0].payload === 'hello team');
  check('collab.sendEdit kind', received[1].kind === 'edit');
  check('collab.sendPresence kind', received[2].kind === 'cursor');

  // unsubscribe
  await unsub();
  await cc.sendChat('session-1','no more');
  check('collab.unsubscribe stops delivery', received.length === 3);

  // join session
  const cc3 = createCollabClient(relay, `me-${++myIdCounter}`);
  const joined = await cc3.join(token, 'Bob', false);
  check('collab.join returns session', joined.id === 'session-1');
  check('collab.join read-only role', joined.participants.some(p => p.id === `me-${myIdCounter}` && p.role === 'read-only'));
  const psAfter = await cc3.participants('session-1');
  check('collab.join adds participant', psAfter.length === 2);

  // leave + leaveAll
  await cc3.leave('session-1');
  const psAfterLeave = await cc.participants('session-1');
  check('collab.leave removes participant', psAfterLeave.length === 1);
  await cc.leaveAll();
  check('collab.leaveAll clears', cc !== undefined);

  // msg-id uniqueness in tight loops (P3 fix)
  const uniqRelay = makeRelay();
  const uniqCc = createCollabClient(uniqRelay, 'uniq-me');
  await uniqCc.host('U');
  const receivedIds = [];
  const uniqUnsub = await uniqCc.onMessage('session-1', (msg) => receivedIds.push(msg.id));
  await uniqCc.sendChat('session-1', 'a');
  await uniqCc.sendEdit('session-1', {});
  await uniqCc.sendPresence('session-1', {});
  await uniqUnsub();
  check('collab msg-ids unique when broadcast observed', receivedIds.length === 3 && new Set(receivedIds).size === 3);
})(); // end Sprint 4.3 IIFE

// ---- dap + ast + goal-loops (Sprint 4.4) -----------------------------
await (async () => {
  // ---- DAP ----
  const makeDapTransport = (handlers) => {
    const subs = new Map();
    return {
      request: async (command, args) => {
        const h = handlers[command];
        if (!h) throw new Error(`mock: no handler for ${command}`);
        return h(args);
      },
      on: (event, handler) => {
        if (!subs.has(event)) subs.set(event, []);
        subs.get(event).push(handler);
        return () => subs.set(event, subs.get(event).filter(h => h !== handler));
      },
      isReady: () => true,
      _emit: (event, body) => (subs.get(event) ?? []).forEach(h => h(body)),
    };
  };

  // lifecycle
  const initT = makeDapTransport({
    initialize: () => ({ supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true }),
    launch: () => ({}),
  });
  const dc = createDapClient(initT);
  const caps = await dc.initialize('node');
  check('dap.initialize returns capabilities', caps.supportsConfigurationDoneRequest === true);
  await dc.launch('app.js', ['--flag'], { cwd: '/repo' });
  check('dap.launch called without error', true);

  // setBreakpoints
  const bpT = makeDapTransport({
    setBreakpoints: (args) => ({ breakpoints: args.breakpoints.map((bp, i) => ({ id: i, verified: true, source: args.source.path, line: bp.line })) }),
  });
  const bpClient = createDapClient(bpT);
  const bps = await bpClient.setBreakpoints('/src/foo.ts', [{ line: 10 }, { line: 20, condition: 'x > 5' }]);
  check('dap.setBreakpoints returns verified', bps.length === 2 && bps[0].verified === true);
  check('dap.setBreakpoints line', bps[1].line === 20);

  // threads + stackTrace
  const stkT = makeDapTransport({
    threads: () => ({ threads: [{ id: 1, name: 'main' }, { id: 2, name: 'worker' }] }),
    stackTrace: () => ({ stackFrames: [{ id: 1, name: 'foo', source: '/src/foo.ts', line: 10, column: 3 }] }),
    scopes: () => ({ scopes: [{ name: 'Local', variablesReference: 100, expensive: false }] }),
    variables: () => ({ variables: [{ name: 'x', value: '42', type: 'number', variablesReference: 0 }] }),
  });
  const stkClient = createDapClient(stkT);
  const threads = await stkClient.threads();
  check('dap.threads returns list', threads.length === 2 && threads[0].name === 'main');
  const frames = await stkClient.stackTrace(1);
  check('dap.stackTrace returns frames', frames.length === 1 && frames[0].name === 'foo');
  const scopes = await stkClient.scopes(1);
  check('dap.scopes returns scopes', scopes.length === 1 && scopes[0].name === 'Local');
  const vars = await stkClient.variables(100);
  check('dap.variables returns vars', vars.length === 1 && vars[0].value === '42');

  // evaluate
  const evalT = makeDapTransport({ evaluate: (args) => ({ name: args.expression, value: 'result', type: 'string', variablesReference: 0 }) });
  const evalClient = createDapClient(evalT);
  const ev = await evalClient.evaluate('2 + 2', undefined, 'repl');
  check('dap.evaluate returns variable', ev.value === 'result' && ev.name === '2 + 2');

  // stepping ops (just verify they don't throw)
  const stepT = makeDapTransport({ continue: () => ({}), next: () => ({}), stepIn: () => ({}), stepOut: () => ({}), stepBack: () => ({}), pause: () => ({}), restartFrame: () => ({}), configurationDone: () => ({}), disconnect: () => ({}), terminate: () => ({}), restart: () => ({}), goto: () => ({}), setExceptionBreakpoints: () => ({}), setFunctionBreakpoints: (a) => ({ breakpoints: a.breakpoints.map((_, i) => ({ id: i, verified: true, source: 'fn', line: 0 })) }) });
  const stepClient = createDapClient(stepT);
  await stepClient.configurationDone();
  await stepClient.continue(1);
  await stepClient.pause(1);
  await stepClient.next(1);
  await stepClient.stepIn(1);
  await stepClient.stepOut(1);
  await stepClient.stepBack(1);
  await stepClient.restartFrame(1);
  await stepClient.setExceptionBreakpoints(['all']);
  await stepClient.disconnect(true);
  check('dap.stepping ops no throw', true);

  // attach + terminate + restart + goto
  const attachT = makeDapTransport({ attach: () => ({}), terminate: () => ({}), restart: () => ({}), goto: () => ({}), setFunctionBreakpoints: () => ({ breakpoints: [] }) });
  const attachClient = createDapClient(attachT);
  await attachClient.attach('process.exe', { pid: 1234 });
  await attachClient.terminate();
  await attachClient.restart();
  await attachClient.goto(1, 5);
  const fnBps = await attachClient.setFunctionBreakpoints([{ name: 'main' }]);
  check('dap.setFunctionBreakpoints returns list', fnBps.length === 0);
  check('dap.attach called', true);

  // source + loadedSources + modules + completions
  const srcT = makeDapTransport({
    source: () => ({ content: 'line1\nline2\nline3' }),
    loadedSources: () => ({ sources: [{ name: 'foo', path: '/foo.ts' }] }),
    modules: () => ({ modules: [{ id: 1, name: 'app' }] }),
    completions: () => ({ targets: [{ label: 'console', type: 'function' }] }),
    setVariable: () => ({ name: 'x', value: '99', type: 'number', variablesReference: 0 }),
  });
  const srcClient = createDapClient(srcT);
  const lines = await srcClient.source('/src/foo.ts', 1, 3);
  check('dap.source returns lines', lines.length === 3 && lines[0] === 'line1');
  const loaded = await srcClient.loadedSources();
  check('dap.loadedSources returns list', loaded.length === 1 && loaded[0].path === '/foo.ts');
  const mods = await srcClient.modules();
  check('dap.modules returns list', mods.length === 1 && mods[0].name === 'app');
  const comps = await srcClient.completions('cons', 4);
  check('dap.completions returns list', comps.length === 1 && comps[0].label === 'console');
  const setVar = await srcClient.setVariable('x', '99', 100);
  check('dap.setVariable returns var', setVar.value === '99');

  // events: stopped + terminated + output
  const evT = makeDapTransport({ initialize: () => ({}) });
  const evClient = createDapClient(evT);
  let stoppedEvent = null;
  evClient.onStopped((e) => { stoppedEvent = e; });
  evT._emit('stopped', { reason: 'breakpoint', threadId: 1 });
  check('dap.onStopped receives event', stoppedEvent?.reason === 'breakpoint' && stoppedEvent.threadId === 1);

  let terminatedCalled = false;
  evClient.onTerminated(() => { terminatedCalled = true; });
  evT._emit('terminated', {});
  check('dap.onTerminated fires', terminatedCalled === true);

  let outputReceived = null;
  evClient.onOutput((body) => { outputReceived = body; });
  evT._emit('output', { category: 'stdout', output: 'hello' });
  check('dap.onOutput receives body', outputReceived?.output === 'hello');

  check('dap.isReady default true', evClient.isReady() === true);

  // ---- AST ----
  // simple literal match
  const src = 'const x = 1;\nconst y = 2;\nconst z = 3;';
  const matches = findMatches(src, 'const x = 1;', 'typescript');
  check('ast.findMatches literal', matches.length === 1 && matches[0].text === 'const x = 1;');

  // $$$CAPTURE pattern
  const captureSrc = 'function foo() { return 1; }\nfunction bar() { return 2; }';
  const captureMatches = findMatches(captureSrc, 'function $$$NAME() { return $$$BODY; }', 'typescript');
  check('ast.findMatches with captures', captureMatches.length === 2);
  check('ast.findMatches capture NAME', captureMatches[0].captures.NAME === 'foo');
  check('ast.findMatches capture BODY', captureMatches[0].captures.BODY === '1');
  check('ast.findMatches second match', captureMatches[1].captures.NAME === 'bar');

  // applyRewrite
  const rewriteResult = applyRewrite(captureSrc, {
    pattern: 'function $$$NAME() { return $$$BODY; }',
    replacement: 'const $NAME = () => $BODY;',
    language: 'typescript',
  });
  check('ast.applyRewrite replacements', rewriteResult.replacements === 2);
  check('ast.applyRewrite source', rewriteResult.source.includes('const foo = () => 1;'));
  check('ast.applyRewrite second', rewriteResult.source.includes('const bar = () => 2;'));

  // expandTemplate
  const expandedFixed = expandTemplate('X = $VALUE', { VALUE: '42' });
  check('ast.expandTemplate', expandedFixed === 'X = 42');

  // validateRewrite
  check('ast.validateRewrite valid', validateRewrite({ pattern: 'x', replacement: 'y', language: 'ts' }) === null);
  check('ast.validateRewrite missing pattern', validateRewrite({ pattern: '', replacement: 'y', language: 'ts' })?.includes('pattern'));
  check('ast.validateRewrite missing language', validateRewrite({ pattern: 'x', replacement: 'y', language: '' })?.includes('language'));

  // chainRewrites
  const chainResult = chainRewrites('aaa bbb aaa', [
    { pattern: 'aaa', replacement: 'XXX', language: 'ts' },
    { pattern: 'XXX', replacement: 'YYY', language: 'ts' },
  ]);
  check('ast.chainRewrites applies in order', chainResult.source === 'YYY bbb YYY');
  check('ast.chainRewrites total replacements', chainResult.replacements === 4);

  // no matches
  const noMatch = applyRewrite('hello world', { pattern: 'xxx', replacement: 'yyy', language: 'ts' });
  check('ast.applyRewrite no matches', noMatch.replacements === 0 && noMatch.source === 'hello world');

  // RegexAstMatcher instance
  const matcher = new RegexAstMatcher();
  const m = matcher.findMatches('abc abc', 'abc', 'ts');
  check('ast.RegexAstMatcher instance', m.length === 2);

  // ---- goal-loops ----
  // mock actor + judge: complete after 3 iterations
  const makeActor = (actions) => ({
    propose: async (ctx) => actions[ctx.turn - 1] ?? `action-${ctx.turn}`,
  });
  const makeJudge = (scores, verdicts) => ({
    judge: async (ctx) => ({ verdict: verdicts[ctx.turn - 1] ?? 'continue', reasoning: `score ${ctx.turn}`, score: scores[ctx.turn - 1] ?? 0.5 }),
  });

  const loop = await runGoalLoop({
    goal: 'refactor the auth module',
    maxIterations: 10,
    actor: makeActor(['read file', 'edit file', 'run tests']),
    judge: makeJudge([0.3, 0.6, 0.9], ['continue', 'continue', 'complete']),
  });
  check('goal.runGoalLoop completes', loop.status === 'complete');
  check('goal.runGoalLoop iterations', loop.iterations.length === 3);
  check('goal.runGoalLoop final score', loop.iterations[2].score === 0.9);
  check('goal.runGoalLoop final verdict', loop.iterations[2].verdict === 'complete');
  check('goal.runGoalLoop action turn 1', loop.iterations[0].action === 'read file');

  // threshold-based completion
  const thresholdLoop = await runGoalLoop({
    goal: 'fix bug',
    maxIterations: 5,
    actor: makeActor(['a', 'b']),
    judge: makeJudge([0.85, 0.95], ['continue', 'continue']),
    completeThreshold: 0.8,
  });
  check('goal.threshold complete', thresholdLoop.status === 'complete' && thresholdLoop.iterations.length === 1);

  // max iterations reached (no completion)
  const maxLoop = await runGoalLoop({
    goal: 'impossible',
    maxIterations: 2,
    actor: makeActor(['a', 'b']),
    judge: makeJudge([0.1, 0.2], ['continue', 'continue']),
  });
  check('goal.max iterations → failed', maxLoop.status === 'failed' && maxLoop.iterations.length === 2);

  // explicit failed verdict
  const failLoop = await runGoalLoop({
    goal: 'fails fast',
    maxIterations: 5,
    actor: makeActor(['a']),
    judge: makeJudge([0], ['failed']),
  });
  check('goal.failed verdict', failLoop.status === 'failed' && failLoop.iterations.length === 1);

  // execute callback
  const execLoop = await runGoalLoop({
    goal: 'with execute',
    maxIterations: 5,
    actor: makeActor(['do thing']),
    judge: makeJudge([1.0], ['complete']),
    execute: async (action) => `executed: ${action}`,
  });
  check('goal.execute wraps action', execLoop.iterations[0].action === 'executed: do thing');

  // onIteration callback
  const seen = [];
  const onIterLoop = await runGoalLoop({
    goal: 'with onIter',
    maxIterations: 5,
    actor: makeActor(['a', 'b']),
    judge: makeJudge([0.5, 0.9], ['continue', 'complete']),
    onIteration: (it) => seen.push(it.turn),
  });
  check('goal.onIteration called', seen.length === 2 && seen[0] === 1 && seen[1] === 2);

  // steps (manual planning)
  const manual = createGoalLoop('manual goal', 10);
  const s1 = addStep(manual, 'step one');
  const s2 = addStep(manual, 'step two');
  check('goal.addStep', manual.steps.length === 2);
  check('goal.addStep id', s1.id === 'step-1' && s2.id === 'step-2');

  check('goal.updateStep', updateStep(manual, 'step-1', 'done', 'result-1') === true);
  check('goal.updateStep status', manual.steps[0].status === 'done' && manual.steps[0].result === 'result-1');
  check('goal.updateStep unknown returns false', updateStep(manual, 'nope', 'done') === false);

  stopGoalLoop(manual);
  check('goal.stopGoalLoop', manual.status === 'stopped');

  // summarize
  const summary = summarizeLoop(loop);
  check('goal.summarizeLoop has goal', summary.includes('refactor the auth module'));
  check('goal.summarizeLoop has status', summary.includes('complete'));
  check('goal.summarizeLoop has iterations', summary.includes('Turn 1'));
})();

// ---- dwf + scheduler (Sprint 4.5) -----------------------------------
// === DWF ===
const makeDispatcher = (agentResults) => {
  let i = 0;
  const now = { t: 1000 };
  return {
    spawnAgent: async (role, goal) => {
      const r = agentResults[i] ?? agentResults[agentResults.length - 1];
      i++;
      return { agentId: `a-${i}`, role, output: `result for ${goal}`, tokensUsed: r.tokensUsed ?? 100, ok: r.ok ?? true, error: r.error };
    },
    now: () => now.t,
    _tick: (ms) => { now.t += ms; },
  };
};

// simple successful workflow
const disp1 = makeDispatcher([{ tokensUsed: 50 }, { tokensUsed: 60 }]);
const wf1 = defineWorkflow('simple', 'trusted', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  const a1 = await ctx.agent('explorer', 'find files');
  const a2 = await ctx.agent('executor', 'edit them');
  return `${a1.output}+${a2.output}`;
});
const res1 = await runDwf({ workflow: wf1, dispatcher: disp1 });
check('dwf.runDwf ok', res1.status === 'ok' && res1.tokensUsed === 110 && res1.agentsSpawned === 2);
check('dwf.runDwf result', res1.result === 'result for find files+result for edit them');
check('dwf.runDwf duration tracked', res1.durationMs >= 0);

// fanOut
const disp2 = makeDispatcher([{ tokensUsed: 30 }, { tokensUsed: 40 }, { tokensUsed: 50 }]);
const wf2 = defineWorkflow('fanout', 'trusted', { maxAgents: 10, maxFanOut: 3, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  const fo = await ctx.fanOut('explorer', ['g1', 'g2', 'g3']);
  return fo.results.length;
});
const res2 = await runDwf({ workflow: wf2, dispatcher: disp2 });
check('dwf.fanOut ok', res2.status === 'ok' && res2.result === 3 && res2.tokensUsed === 120);

// fanOut exceeds maxFanOut
const disp3 = makeDispatcher([{ tokensUsed: 10 }, { tokensUsed: 10 }, { tokensUsed: 10 }, { tokensUsed: 10 }]);
const wf3 = defineWorkflow('fanout-limit', 'trusted', { maxAgents: 10, maxFanOut: 2, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.fanOut('explorer', ['g1', 'g2', 'g3']);
  return 'done';
});
const res3 = await runDwf({ workflow: wf3, dispatcher: disp3 });
check('dwf.fanOut maxFanOut exceeded → failed', res3.status === 'failed' && res3.error?.includes('maxFanOut'));

// maxAgents exceeded
const disp4 = makeDispatcher([{ tokensUsed: 10 }]);
const wf4 = defineWorkflow('agent-limit', 'trusted', { maxAgents: 1, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.agent('a', 'g1');
  await ctx.agent('a', 'g2');  // exceeds maxAgents=1
  return 'done';
});
const res4 = await runDwf({ workflow: wf4, dispatcher: disp4 });
check('dwf.maxAgents exceeded → failed', res4.status === 'failed' && res4.error?.includes('maxAgents'));

// budget exceeded
const disp5 = makeDispatcher([{ tokensUsed: 600 }, { tokensUsed: 600 }]);
const wf5 = defineWorkflow('budget-limit', 'trusted', { maxAgents: 10, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.agent('a', 'g1');
  await ctx.agent('a', 'g2');
  return 'done';
});
const res5 = await runDwf({ workflow: wf5, dispatcher: disp5 });
check('dwf.budget exceeded', res5.status === 'budget-exceeded');

// deadline exceeded (dispatcher clock past deadline)
const disp6 = makeDispatcher([{ tokensUsed: 10 }]);
disp6.now = () => 20000;  // past deadline 10000
const wf6 = defineWorkflow('deadline', 'trusted', { maxAgents: 10, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.agent('a', 'g1');
  return 'done';
});
const res6 = await runDwf({ workflow: wf6, dispatcher: disp6 });
check('dwf.deadline exceeded', res6.status === 'deadline-exceeded');

// untrusted refused
const disp7 = makeDispatcher([]);
const wf7 = defineWorkflow('untrusted', 'untrusted', { maxAgents: 10, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async () => 'done');
const res7 = await runDwf({ workflow: wf7, dispatcher: disp7 });
check('dwf.untrusted refused', res7.status === 'failed' && res7.error?.includes('untrusted'));

// under-review allowed
const disp8 = makeDispatcher([{ tokensUsed: 50 }]);
const wf8 = defineWorkflow('review', 'under-review', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  const r = await ctx.agent('a', 'g');
  return r.output;
});
const res8 = await runDwf({ workflow: wf8, dispatcher: disp8 });
check('dwf.under-review allowed', res8.status === 'ok');

// log callback
const logs = [];
const disp9 = makeDispatcher([{ tokensUsed: 10 }]);
const wf9 = defineWorkflow('logging', 'trusted', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  ctx.log('hello');
  ctx.log('oops', 'error');
  return 'done';
});
await runDwf({ workflow: wf9, dispatcher: disp9, log: (msg, level) => logs.push(`${level}:${msg}`) });
check('dwf.log callback', logs.length === 2 && logs[0] === 'info:hello' && logs[1] === 'error:oops');

// custom runId
const disp10 = makeDispatcher([{ tokensUsed: 10 }]);
const wf10 = defineWorkflow('customid', 'trusted', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  ctx.log(`run=${ctx.runId}`);
  return ctx.runId;
});
const res10 = await runDwf({ workflow: wf10, dispatcher: disp10, runId: 'my-run' });
check('dwf.custom runId', res10.runId === 'my-run' && res10.result === 'my-run');

// === SCHEDULER ===
// fake clock
const makeClock = () => {
  let t = 1000;
  const timers = [];
  return {
    now: () => t,
    _advance: (ms) => { t += ms; },
    setTimeout: (cb, ms) => { const id = { cb, ms, fireAt: t + ms }; timers.push(id); return id; },
    clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    _fireDue: () => { const due = timers.filter(x => x.fireAt <= t); for (const x of due) { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); x.cb(); } return due.length; },
    _nextTimeout: () => timers.length > 0 ? Math.min(...timers.map(x => x.fireAt - t)) : null,
  };
};

// one-shot
let fires = [];
const clk1 = makeClock();
const sched1 = createScheduler(clk1, async (entry) => { fires.push({ id: entry.id, fire: entry.fires }); });
const oneShotId = sched1.register({ kind: 'one-shot', name: 'once', atMs: 2500 });
check('sched.one-shot pending', sched1.get(oneShotId).status === 'pending');
check('sched.one-shot nextFire', sched1.get(oneShotId).nextFire === 2500);
clk1._advance(1000);
clk1._fireDue();
await new Promise(r => setTimeout(r, 0));
check('sched.one-shot not fired early', fires.length === 0);
clk1._advance(500);  // now at 2500
clk1._fireDue();
await new Promise(r => setTimeout(r, 0));
check('sched.one-shot fired', fires.length === 1 && fires[0].fire === 1);
check('sched.one-shot completed', sched1.get(oneShotId).status === 'completed');

// interval with maxRuns
fires = [];
const clk2 = makeClock();
const sched2 = createScheduler(clk2, async (entry) => { fires.push(entry.fires); });
const intervalId = sched2.register({ kind: 'interval', name: 'every3', intervalMs: 300, maxRuns: 3 });
// fire 3 times
for (let i = 0; i < 3; i++) { clk2._advance(300); clk2._fireDue(); await new Promise(r => setTimeout(r, 0)); }
check('sched.interval maxRuns stops', fires.length === 3 && fires[2] === 3);
check('sched.interval completed', sched2.get(intervalId).status === 'completed');

// interval unlimited (cancel manually)
fires = [];
const clk3 = makeClock();
const sched3 = createScheduler(clk3, async (entry) => { fires.push(entry.fires); });
const unlimId = sched3.register({ kind: 'interval', name: 'unlim', intervalMs: 100 });
clk3._advance(100); clk3._fireDue(); await new Promise(r => setTimeout(r, 0));
clk3._advance(100); clk3._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.interval fires repeatedly', fires.length === 2);
sched3.cancel(unlimId);
check('sched.cancel sets status', sched3.get(unlimId).status === 'cancelled');
clk3._advance(100); clk3._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.cancel stops fires', fires.length === 2);

// cancelAll
fires = [];
const clk4 = makeClock();
const sched4 = createScheduler(clk4, async () => { fires.push(1); });
sched4.register({ kind: 'interval', name: 'a', intervalMs: 50 });
sched4.register({ kind: 'interval', name: 'b', intervalMs: 50 });
check('sched.cancelAll before fire', sched4.list().length === 2);
sched4.cancelAll();
clk4._advance(100); clk4._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.cancelAll stops all', fires.length === 0);
check('sched.cancelAll all cancelled', sched4.list().every(e => e.status === 'cancelled'));

// deadline auto-cancel
fires = [];
const clk5 = makeClock();
const sched5 = createScheduler(clk5, async () => { fires.push(1); });
const dlId = sched5.register({ kind: 'interval', name: 'dl', intervalMs: 100, deadlineMs: 1500 });
// fire under deadline
clk5._advance(100); clk5._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.deadline fires before', fires.length === 1);
// advance past deadline
clk5._advance(1100);  // now at 2200, past 1500
clk5._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.deadline exceeded', sched5.get(dlId).status === 'deadline-exceeded');
check('sched.deadline no more fires', fires.length === 1);

// task error → failed status
const clk6 = makeClock();
const sched6 = createScheduler(clk6, async () => { throw new Error('boom'); });
const errId = sched6.register({ kind: 'one-shot', name: 'err', atMs: 500 });
clk6._advance(500); clk6._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.task error → failed', sched6.get(errId).status === 'failed');
check('sched.task error recorded', sched6.get(errId).lastError === 'boom');

// list includes all
const clk7 = makeClock();
const sched7 = createScheduler(clk7, async () => {});
sched7.register({ kind: 'one-shot', name: 'a', atMs: 100000 });
sched7.register({ kind: 'interval', name: 'b', intervalMs: 1000 });
check('sched.list returns all', sched7.list().length === 2);

// duplicate id rejected
const clk8 = makeClock();
const sched8 = createScheduler(clk8, async () => {});
sched8.register({ id: 'dup', kind: 'one-shot', name: 'first', atMs: 100000 });
let schedDupThrew = false;
try { sched8.register({ id: 'dup', kind: 'one-shot', name: 'second', atMs: 100000 }); } catch { schedDupThrew = true; }
check('sched.duplicate id rejected', schedDupThrew);

// === CRON PARSER ===
// every minute
const baseDate = new Date('2024-06-15T10:30:00Z');
const everyMin = nextCronFire('* * * * *', baseDate.getTime());
check('cron.every minute', new Date(everyMin).getUTCMinutes() === 31 && new Date(everyMin).getUTCHours() === 10);

// every 5 minutes
const every5 = nextCronFire('*/5 * * * *', new Date('2024-06-15T10:32:00Z').getTime());
check('cron.every 5 min', new Date(every5).getUTCMinutes() === 35);

// hour 15
const atHour = nextCronFire('0 15 * * *', new Date('2024-06-15T10:30:00Z').getTime());
check('cron.at hour 15', new Date(atHour).getUTCHours() === 15 && new Date(atHour).getUTCMinutes() === 0);

// comma list
const comma = nextCronFire('0,30 * * * *', new Date('2024-06-15T10:15:00Z').getTime());
check('cron.comma list', new Date(comma).getUTCMinutes() === 30);

// nextFire dispatch
check('nextFire interval', nextFire({ kind: 'interval', name: 'x', intervalMs: 5000 }, 1000) === 6000);
check('nextFire one-shot', nextFire({ kind: 'one-shot', name: 'x', atMs: 9999 }, 1000) === 9999);

// invalid cron (4 fields)
let cronErr = false;
try { nextCronFire('* * * *', 1000); } catch { cronErr = true; }
check('cron.invalid field count rejected', cronErr);

// ---- queue + task-store (Sprint 5.1) -------------------------------
// === WorkQueue state machine ===
const fakeClock5a = (() => { let t = 1000; return { now: () => t, _tick: (ms) => { t += ms; } }; })();
const q = createWorkQueue(fakeClock5a);

// add items
const idA = q.addItem({ name: 'A', priority: 0 });
const idB = q.addItem({ name: 'B', priority: 1, dependsOn: [idA] });
const idC = q.addItem({ name: 'C', priority: 2, dependsOn: [idB] });
check('queue.addItem returns id', idA === 1 && idB === 2 && idC === 3);
check('queue.item A pending→next (no deps)', q.getItem(idA).status === 'next');
check('queue.item B blocked (dep on A)', q.getItem(idB).status === 'blocked');
check('queue.item C blocked (transitive)', q.getItem(idC).status === 'blocked');

// checkDependencies
const depsB = q.checkDependencies(idB);
check('queue.checkDependencies B not met', depsB.met === false && depsB.pending.includes(idA));

// getReadyItems returns A (status next, priority 0)
const ready1 = q.getReadyItems(5);
check('queue.getReadyItems returns A', ready1.length === 1 && ready1[0].name === 'A');
check('queue.getReadyItems moves to now', q.getItem(idA).status === 'now');

// complete A → B should advance blocked→next
q.complete(idA, 'result A');
check('queue.complete A done', q.getItem(idA).status === 'done' && q.getItem(idA).result === 'result A');
check('queue.complete A advances B', q.getItem(idB).status === 'next');
check('queue.complete A leaves C blocked (B not done)', q.getItem(idC).status === 'blocked');

// claim next gets B
const claimed = q.claimNext();
check('queue.claimNext returns B', claimed.name === 'B');
q.complete(idB, 'result B');
check('queue.complete B advances C', q.getItem(idC).status === 'next');

// fail an item
const idD = q.addItem({ name: 'D', priority: 3 });
q.fail(idD, 'boom');
check('queue.fail sets failed+error', q.getItem(idD).status === 'failed' && q.getItem(idD).error === 'boom');

// overdue detection
fakeClock5a._tick(50000);
const idE = q.addItem({ name: 'E', priority: 1, deadlineMs: 5000 });
fakeClock5a._tick(10000);  // now past deadline
const overdue = q.overdueItems();
check('queue.overdueItems detects', overdue.length >= 1 && overdue.some(i => i.name === 'E'));

// stats
const stats = q.stats();
check('queue.stats total', stats.total === 5);
check('queue.stats byStatus done', stats.byStatus['done'] === 2);

// audit log
const log = q.getLog();
check('queue.getLog has entries', log.length > 0);
check('queue.getLog add entry', log.some(e => e.action === 'add'));

// checkpoint save+restore
const cp = q.saveCheckpoint();
check('queue.saveCheckpoint doneCount', cp.doneCount === 2);
const q2 = createWorkQueue();
q2.restoreCheckpoint(cp);
check('queue.restoreCheckpoint items', q2.getItems().length === 5 && q2.getItem(idA).status === 'done');

// priority ordering
const qP = createWorkQueue();
qP.addItem({ name: 'low', priority: 3 });
qP.addItem({ name: 'high', priority: 0 });
qP.addItem({ name: 'mid', priority: 1 });
const readyP = qP.getReadyItems(3);
check('queue.priority ordering (high first)', readyP[0].name === 'high' && readyP[1].name === 'mid' && readyP[2].name === 'low');

// === TaskStore (in-memory) ===
const ts = createTaskStore();
const t1 = ts.create('build feature', { spec: 'do X' });
check('taskStore.create returns record', t1.id === 'task-1' && t1.status === 'created');
check('taskStore.get', ts.get(t1.id).name === 'build feature');

// update
ts.update(t1.id, { status: 'running', agentId: 'agent-7' });
check('taskStore.update status+agent', ts.get(t1.id).status === 'running' && ts.get(t1.id).agentId === 'agent-7');

// complete
ts.update(t1.id, { status: 'completed', output: { result: 'ok' }, completedAt: Date.now() });
check('taskStore.update complete', ts.get(t1.id).status === 'completed' && ts.get(t1.id).output?.result === 'ok');

// cancel
const t2 = ts.create('abort me');
ts.cancel(t2.id, 'user aborted');
check('taskStore.cancel', ts.get(t2.id).status === 'cancelled' && ts.get(t2.id).error === 'user aborted');

// list with filter
const t3 = ts.create('running task'); ts.update(t3.id, { status: 'running' });
const running = ts.list({ status: 'running' });
check('taskStore.list filter status', running.length === 1 && running[0].name === 'running task');

const t4 = ts.create('agent task'); ts.update(t4.id, { status: 'running', agentId: 'a-1' });
const byAgent = ts.list({ agentId: 'a-1' });
check('taskStore.list filter agent', byAgent.length === 1 && byAgent[0].agentId === 'a-1');

// count
check('taskStore.count', ts.count() === 4);

// get unknown
check('taskStore.get unknown', ts.get('nope') === undefined);
check('taskStore.update unknown false', ts.update('nope', { status: 'failed' }) === false);

// === TaskStore (SQLite) ===
const { DatabaseSync } = await import('node:sqlite');
const dbPath5 = join(buildDir, 'test-task-store.db');
try { unlinkSync(dbPath5); } catch { /* may not exist */ }
const db5 = new DatabaseSync(dbPath5);
const sqlStore = createSqliteTaskStore(db5);
const st1 = sqlStore.create('sql task', { data: 42 });
check('sqliteTaskStore.create', st1.id.startsWith('task-') && st1.status === 'created');
check('sqliteTaskStore.get', sqlStore.get(st1.id).name === 'sql task');
sqlStore.update(st1.id, { status: 'completed', output: { ok: true }, completedAt: 9999 });
check('sqliteTaskStore.update', sqlStore.get(st1.id).status === 'completed' && sqlStore.get(st1.id).output?.ok === true);
const st2 = sqlStore.create('another');
check('sqliteTaskStore.count', sqlStore.count() === 2);
check('sqliteTaskStore.list', sqlStore.list().length === 2);
sqlStore.cancel(st2.id, 'nope');
check('sqliteTaskStore.cancel', sqlStore.get(st2.id).status === 'cancelled');
// Bug A: falsy input persisted
const stF = sqlStore.create('falsy', 0);
check('sqliteTaskStore falsy input=0 persisted', sqlStore.get(stF.id).input === 0);
const stFb = sqlStore.create('falsyb', false);
check('sqliteTaskStore falsy input=false persisted', sqlStore.get(stFb.id).input === false);
const stFe = sqlStore.create('falsye', '');
check('sqliteTaskStore falsy input="" persisted', sqlStore.get(stFe.id).input === '');
// Bug B: update() persists input column
const stU = sqlStore.create('updatable', { initial: 1 });
sqlStore.update(stU.id, { input: { changed: true } });
check('sqliteTaskStore update persists input', sqlStore.get(stU.id).input?.changed === true);
// Bug A: update() falsy output persisted
sqlStore.update(stU.id, { output: 0 });
check('sqliteTaskStore update falsy output=0 persisted', sqlStore.get(stU.id).output === 0);
db5.close();
try { unlinkSync(dbPath5); } catch { /* cleanup */ }

// ---- workflow-steps + workflow-yaml (Sprint 5.2) --------------------
const makeExecutor5b = (behaviors) => {
  const now = { t: 1000 };
  return {
    execute: async (step, vars) => {
      const b = behaviors[step.id];
      if (!b) throw new Error('no behavior for ' + step.id);
      if (typeof b === 'function') return b(step, vars);
      if (b.throw) throw new Error(b.throw);
      return b.output ?? 'ok';
    },
    now: () => now.t,
    _tick: (ms) => { now.t += ms; },
  };
};

// === evalCondition ===
check('cond.boolean true', evalCondition('flag', { flag: true }) === true);
check('cond.boolean false', evalCondition('flag', { flag: false }) === false);
check('cond.=== string', evalCondition("mode === 'run'", { mode: 'run' }) === true);
check('cond.=== mismatch', evalCondition("mode === 'skip'", { mode: 'run' }) === false);
check('cond.!== string', evalCondition("mode !== 'skip'", { mode: 'run' }) === true);
check('cond.> number', evalCondition('count > 5', { count: 10 }) === true);
check('cond.> false', evalCondition('count > 5', { count: 3 }) === false);
check('cond.!var', evalCondition('!flag', { flag: false }) === true);
check('cond.empty = true', evalCondition('', {}) === true);

// === runStep: task ===
const exb1 = makeExecutor5b({ s1: { output: 'done' } });
const rs1 = await runStep({ id: 's1', name: 'S1', type: 'task', goal: 'do X' }, {}, exb1);
check('runStep.task completed', rs1.status === 'completed' && rs1.output === 'done' && rs1.attempts === 1);

// === runStep: retry ===
let attempts5b = 0;
const exb2 = makeExecutor5b({ s2: () => { attempts5b++; if (attempts5b < 3) throw new Error('transient'); return 'ok'; } });
const rs2 = await runStep({ id: 's2', name: 'S2', type: 'task', retryCount: 2 }, {}, exb2);
check('runStep.retry succeeds', rs2.status === 'completed' && rs2.output === 'ok' && rs2.attempts === 3);

// === runStep: failed after retries ===
const exb3 = makeExecutor5b({ s3: { throw: 'permanent' } });
const rs3 = await runStep({ id: 's3', name: 'S3', type: 'task', retryCount: 1 }, {}, exb3);
check('runStep.failed after retries', rs3.status === 'failed' && rs3.error === 'permanent' && rs3.attempts === 2);

// === runStep: timeout ===
const exb4 = makeExecutor5b({ s4: () => new Promise(r => setTimeout(() => r('late'), 100000)) });
const rs4 = await runStep({ id: 's4', name: 'S4', type: 'task', timeoutMs: 50, retryCount: 0 }, {}, exb4);
check('runStep.timeout', rs4.status === 'timeout' && rs4.error === 'timeout');

// === runStep: condition ===
const rs5 = await runStep({ id: 's5', name: 'C', type: 'condition', condition: 'flag' }, { flag: true }, makeExecutor5b({}));
check('runStep.condition true proceeds', rs5.status === 'completed' && rs5.output === true);
const rs6 = await runStep({ id: 's6', name: 'C', type: 'condition', condition: 'flag' }, { flag: false }, makeExecutor5b({}));
check('runStep.condition false skips', rs6.status === 'skipped');

// === runStep: human_review ===
let reviewCount5b = 0;
const reviewer5b = async (step, vars) => { reviewCount5b++; return { approve: true, comment: 'looks good' }; };
const exb7 = makeExecutor5b({});
const rs7 = await runStep({ id: 's7', name: 'HR', type: 'human_review' }, {}, exb7, reviewer5b);
check('runStep.human_review approved', rs7.status === 'completed' && rs7.output === 'looks good' && reviewCount5b === 1);
// no reviewer
const rs7b = await runStep({ id: 's7b', name: 'HR2', type: 'human_review' }, {}, makeExecutor5b({}));
check('runStep.human_review no reviewer fails', rs7b.status === 'failed' && rs7b.error?.includes('no reviewer'));

// === runStep: parallel ===
const exb8 = makeExecutor5b({ a: { output: 'A' }, b: { output: 'B' }, c: { output: 'C' } });
const rs8 = await runStep({ id: 'p', name: 'P', type: 'parallel', substeps: [
  { id: 'a', name: 'A', type: 'task' }, { id: 'b', name: 'B', type: 'task' }, { id: 'c', name: 'C', type: 'task' },
] }, {}, exb8);
check('runStep.parallel completed', rs8.status === 'completed' && rs8.subresults?.length === 3 && rs8.output?.[0] === 'A');

// === runStep: parallel partial (one fails) ===
const exb9 = makeExecutor5b({ a: { output: 'A' }, f: { throw: 'boom' } });
const rs9 = await runStep({ id: 'p2', name: 'P2', type: 'parallel', substeps: [
  { id: 'a', name: 'A', type: 'task' }, { id: 'f', name: 'F', type: 'task' },
] }, {}, exb9);
check('runStep.parallel partial', rs9.status === 'partial' && rs9.subresults?.length === 2);

// === runStep: loop ===
const exb10 = makeExecutor5b({ s: (step, vars) => `out-${vars.loopIndex}` });
const rs10 = await runStep({ id: 'l', name: 'L', type: 'loop', loopCount: 3, substeps: [
  { id: 's', name: 'S', type: 'task' },
] }, {}, exb10);
check('runStep.loop count', rs10.status === 'completed' && rs10.subresults?.length === 3 && rs10.output?.[2] === 'out-2');

// === runStep: subworkflow (sequential) ===
const sequence5b = [];
const exb11 = makeExecutor5b({ a: () => { sequence5b.push('a'); return 1; }, b: () => { sequence5b.push('b'); return 2; } });
const rs11 = await runStep({ id: 'sw', name: 'SW', type: 'subworkflow', substeps: [
  { id: 'a', name: 'A', type: 'task' }, { id: 'b', name: 'B', type: 'task' },
] }, {}, exb11);
check('runStep.subworkflow sequential', rs11.status === 'completed' && rs11.subresults?.length === 2 && sequence5b.join('') === 'ab');

// === runWorkflow: success ===
const exb12 = makeExecutor5b({ a: { output: 'A' }, b: { output: 'B' } });
const wfb12 = await runWorkflow({ template: { name: 'wf12', steps: [
  { id: 'a', name: 'A', type: 'task' }, { id: 'b', name: 'B', type: 'task' },
] }, executor: exb12 });
check('runWorkflow.completed', wfb12.status === 'completed' && wfb12.results.length === 2 && wfb12.finalOutput === 'B');
check('runWorkflow.errors empty', wfb12.errors.length === 0);

// === runWorkflow: failure stops (default) ===
const exb13 = makeExecutor5b({ a: { throw: 'fail-fast' } });
const wfb13 = await runWorkflow({ template: { name: 'wf13', steps: [
  { id: 'a', name: 'A', type: 'task' }, { id: 'b', name: 'B', type: 'task' },
] }, executor: exb13 });
check('runWorkflow.failed stops', wfb13.status === 'failed' && wfb13.errors.length === 1 && wfb13.results.length === 1);

// === runWorkflow: on_error routing ===
const exb14 = makeExecutor5b({ a: { throw: 'X' }, fix: { output: 'fixed' } });
const wfb14 = await runWorkflow({ template: { name: 'wf14', steps: [
  { id: 'a', name: 'A', type: 'task', onError: 'fix' },
  { id: 'fix', name: 'Fix', type: 'task' },
] }, executor: exb14 });
check('runWorkflow.onError routes', wfb14.status === 'failed' && wfb14.results.length === 2 && wfb14.results[1].stepId === 'fix');

// === runWorkflow: continue on error ===
const exb15 = makeExecutor5b({ a: { throw: 'X' }, b: { output: 'B' } });
const wfb15 = await runWorkflow({ template: { name: 'wf15', steps: [
  { id: 'a', name: 'A', type: 'task' }, { id: 'b', name: 'B', type: 'task' },
] }, executor: exb15, stopOnError: false });
check('runWorkflow.continue on error partial', wfb15.status === 'partial' && wfb15.results.length === 2 && wfb15.finalOutput === 'B');

// === runWorkflow: variables ===
const exb16 = makeExecutor5b({ a: (step, vars) => `hello ${vars.name}` });
const wfb16 = await runWorkflow({ template: { name: 'wf16', variables: { name: 'world' }, steps: [
  { id: 'a', name: 'A', type: 'task' },
] }, executor: exb16, variables: { name: 'ithacus' } });
check('runWorkflow.variables merge', wfb16.status === 'completed' && wfb16.finalOutput === 'hello ithacus');

// === YAML loader ===
const yaml5b1 = `
name: ci-pipeline
description: CI workflow
variables:
  env: prod
steps:
  - id: build
    name: Build
    type: task
    role: executor
    goal: compile
    retryCount: 2
    timeoutMs: 30000
  - id: test
    name: Test
    type: task
    dependsOn:
      - build
`;
const tpl5b1 = fromYaml(yaml5b1);
check('yaml.parse name', tpl5b1.name === 'ci-pipeline');
check('yaml.parse description', tpl5b1.description === 'CI workflow');
check('yaml.parse variables', tpl5b1.variables?.env === 'prod');
check('yaml.parse steps count', tpl5b1.steps.length === 2);
check('yaml.parse step id', tpl5b1.steps[0].id === 'build');
check('yaml.parse step retry', tpl5b1.steps[0].retryCount === 2);
check('yaml.parse step timeout', tpl5b1.steps[0].timeoutMs === 30000);
check('yaml.parse step role', tpl5b1.steps[0].role === 'executor');
check('yaml.parse dependsOn', tpl5b1.steps[1].dependsOn?.[0] === 'build');

// complex yaml with substeps
const yaml5b2 = `
name: parallel-test
steps:
  - id: run-all
    name: Run All
    type: parallel
    substeps:
      - id: a
        name: A
        type: task
      - id: b
        name: B
        type: task
`;
const tpl5b2 = fromYaml(yaml5b2);
check('yaml.parse parallel substeps', tpl5b2.steps[0].type === 'parallel' && tpl5b2.steps[0].substeps?.length === 2 && tpl5b2.steps[0].substeps[0].id === 'a');

// validateTemplate
check('validateTemplate valid', validateTemplate(tpl5b1) === null);
check('validateTemplate dup id', validateTemplate({ name: 'x', steps: [{ id: 'a', name: 'A', type: 'task' }, { id: 'a', name: 'B', type: 'task' }] })?.includes('duplicate'));
check('validateTemplate onError missing', validateTemplate({ name: 'x', steps: [{ id: 'a', name: 'A', type: 'task', onError: 'nope' }] })?.includes('onError target'));
check('validateTemplate empty steps', validateTemplate({ name: 'x', steps: [] })?.includes('at least one'));

// fromObject
const tpl5b3 = fromObject({ name: 'obj', steps: [{ id: 's', name: 'S', type: 'task', retryCount: 5 }] });
check('fromObject step', tpl5b3.steps[0].id === 's' && tpl5b3.steps[0].retryCount === 5);

// fromObject throws on bad input
let yamlErr5b = false;
try { fromObject({ steps: [] }); } catch { yamlErr5b = true; }
check('fromObject throws on missing name', yamlErr5b);

// full YAML -> runWorkflow integration
const exbEnd = makeExecutor5b({ build: { output: 'built' }, test: { output: 'tested' } });
const wfEnd5b = await runWorkflow({ template: fromYaml(yaml5b1), executor: exbEnd, variables: { env: 'staging' } });
check('yaml.runWorkflow integration', wfEnd5b.status === 'completed' && wfEnd5b.finalOutput === 'tested' && wfEnd5b.variables?.env === 'staging');
check('yaml.runWorkflow results', wfEnd5b.results.length === 2);

// === P1 Fix 1: dependsOn topo sort ===
const exTopo = makeExecutor5b({ b: { output: 'B-after-A' }, a: { output: 'A' } });
// declare b (dependsOn a) BEFORE a — topo sort must run a first
const wfTopo = await runWorkflow({ template: { name: 'topo', steps: [
  { id: 'b', name: 'B', type: 'task', dependsOn: ['a'] },
  { id: 'a', name: 'A', type: 'task' },
] }, executor: exTopo });
check('runWorkflow.topoSort reorders', wfTopo.status === 'completed' && wfTopo.results.length === 2);
check('runWorkflow.topoSort a first', wfTopo.results[0].stepId === 'a' && wfTopo.results[1].stepId === 'b');

// === P1 Fix 1: cycle detection ===
const wfCycle = await runWorkflow({ template: { name: 'cycle', steps: [
  { id: 'a', name: 'A', type: 'task', dependsOn: ['b'] },
  { id: 'b', name: 'B', type: 'task', dependsOn: ['a'] },
] }, executor: makeExecutor5b({}) });
check('runWorkflow.cycle detection', wfCycle.status === 'failed' && wfCycle.errors.length >= 1 && wfCycle.errors[0]?.includes('cycle'));

// === P1 Fix 2: onError no double-exec ===
let fixCalls = 0;
const exFix = makeExecutor5b({ a: { throw: 'X' }, fix: () => { fixCalls++; return 'fixed'; }, b: { output: 'B' } });
const wfFix = await runWorkflow({ template: { name: 'fix', steps: [
  { id: 'a', name: 'A', type: 'task', onError: 'fix' },
  { id: 'fix', name: 'Fix', type: 'task' },
  { id: 'b', name: 'B', type: 'task' },
] }, executor: exFix, stopOnError: false });
check('runWorkflow.onError no double-exec', fixCalls === 1);
check('runWorkflow.onError continue partial', wfFix.status === 'partial' && wfFix.results.some(r => r.stepId === 'b'));

// === P2 Fix 4: human_review rejection = failure ===
const rejectReviewer = async () => ({ approve: false, comment: 'no good' });
const wfReject = await runWorkflow({ template: { name: 'reject', steps: [
  { id: 'hr', name: 'HR', type: 'human_review' },
  { id: 'next', name: 'Next', type: 'task' },
] }, executor: makeExecutor5b({ next: { output: 'N' } }), reviewer: rejectReviewer });
check('runWorkflow.humanReview rejection fails', wfReject.status === 'failed' && wfReject.errors.length >= 1);
check('runWorkflow.humanReview rejection stops', !wfReject.results.some(r => r.stepId === 'next'));

// === P2 Fix 5: isRetryable — permanent: no retry ===
let permCalls = 0;
const exPerm = makeExecutor5b({ s: () => { permCalls++; throw new Error('permanent'); } });
exPerm.isRetryable = () => false;  // permanent — don't retry
const rPerm = await runStep({ id: 's', name: 'S', type: 'task', retryCount: 3 }, {}, exPerm);
check('runStep.isRetryable no retry', rPerm.attempts === 1 && rPerm.status === 'failed');

// === P2 Fix 5: isRetryable — transient: retry until success ===
let retrCalls = 0;
const exRetr = makeExecutor5b({ s: () => { retrCalls++; if (retrCalls < 2) throw new Error('transient'); return 'ok'; } });
exRetr.isRetryable = () => true;
const rRetr = await runStep({ id: 's', name: 'S', type: 'task', retryCount: 3 }, {}, exRetr);
check('runStep.isRetryable retries transient', rRetr.attempts === 2 && rRetr.status === 'completed');

// === P3 Fix 6: evalCondition throws on unrecognized operator ===
let condErr = false;
try { evalCondition('a >= 5', { a: 10 }); } catch { condErr = true; }
check('evalCondition throws on unrecognized', condErr);
let condErr2 = false;
try { evalCondition('a && b', { a: true, b: true }); } catch { condErr2 = true; }
check('evalCondition throws on && operator', condErr2);

// === P3 Fix 7: validateTemplate recurses substeps for dup ids ===
const dupSub = validateTemplate({ name: 'x', steps: [
  { id: 'p', name: 'P', type: 'parallel', substeps: [
    { id: 'a', name: 'A', type: 'task' },
    { id: 'a', name: 'B', type: 'task' },  // duplicate id in substeps
  ] },
] });
check('validateTemplate recurses substeps', dupSub?.includes('duplicate'));

// === P3 Fix 8: loop count 0 = skipped ===
const rLoop0 = await runStep({ id: 'l0', name: 'L0', type: 'loop', loopCount: 0, substeps: [
  { id: 's', name: 'S', type: 'task' },
] }, {}, makeExecutor5b({}));
check('runStep.loop count 0 skipped', rLoop0.status === 'skipped');

// ---- negotiation + handoff (Sprint 5.3) ---------------------------
const makeAgent5c = (id, role, caps, load = 0, available = true) => ({ agentId: id, role, capabilities: caps, available, load });

// === Negotiation: task offer accepted ===
const nm1 = createNegotiationManager();
nm1.registerAgent(makeAgent5c('a1', 'explorer', ['ts', 'testing'], 0.3));
const offer1 = await nm1.offerTask({ taskId: 't1', fromAgent: 'lead', toAgent: 'a1', role: 'explorer', goal: 'find files' });
check('neg.offer accept kind', offer1.kind === 'task_accept');
check('neg.offer accept load increased', nm1.getAgent('a1').load === 0.5);

// === Negotiation: task offer rejected (agent not found) ===
const offer2 = await nm1.offerTask({ taskId: 't2', fromAgent: 'lead', toAgent: 'nope', role: 'x', goal: 'g' });
check('neg.offer reject not found', offer2.kind === 'task_reject');

// === Negotiation: task offer rejected (unavailable) ===
nm1.registerAgent(makeAgent5c('a2', 'executor', ['ts'], 0, false));
const offer3 = await nm1.offerTask({ taskId: 't3', fromAgent: 'lead', toAgent: 'a2', role: 'executor', goal: 'g' });
check('neg.offer reject unavailable', offer3.kind === 'task_reject');

// === Negotiation: task counter (high load) ===
nm1.registerAgent(makeAgent5c('a3', 'reviewer', ['review'], 0.95));
const offer4 = await nm1.offerTask({ taskId: 't4', fromAgent: 'lead', toAgent: 'a3', role: 'reviewer', goal: 'review', budget: { deadlineMs: 5000 } });
check('neg.offer counter high load', offer4.kind === 'task_counter');
const counterPayload = offer4.payload;
check('neg.counter budget extended', counterPayload.counterBudget?.deadlineMs === 10000);

// === Negotiation: resource grant (read) ===
const nm2 = createNegotiationManager();
nm2.registerAgent(makeAgent5c('a1', 'r', []));
nm2.registerAgent(makeAgent5c('a2', 'r', []));
const req1 = await nm2.requestResource({ resourceId: '/src/foo.ts', fromAgent: 'a1', toAgent: 'a2', access: 'read' });
check('neg.resource grant read', req1.kind === 'resource_grant');
check('neg.resource read no single holder', nm2.getResourceHolder('/src/foo.ts') === undefined);
check('neg.resource read tracked', nm2.getResourceReaders('/src/foo.ts').includes('a1'));
// concurrent read by a2
const req1b = await nm2.requestResource({ resourceId: '/src/foo.ts', fromAgent: 'a2', toAgent: 'a1', access: 'read' });
check('neg.resource concurrent read granted', req1b.kind === 'resource_grant');
check('neg.resource both readers', nm2.getResourceReaders('/src/foo.ts').length === 2);
// a1 release (read)
check('neg.resource release read', nm2.releaseResource('/src/foo.ts', 'a1') === true);
check('neg.resource release read one remains', nm2.getResourceReaders('/src/foo.ts').length === 1);
// a1 write now should be DENIED (a2 still reads)
const req1c = await nm2.requestResource({ resourceId: '/src/foo.ts', fromAgent: 'a1', toAgent: 'a2', access: 'write' });
check('neg.resource write denied while readers', req1c.kind === 'resource_deny');
// a2 release read
check('neg.resource release read a2', nm2.releaseResource('/src/foo.ts', 'a2') === true);
check('neg.resource no readers after release', nm2.getResourceReaders('/src/foo.ts').length === 0);

// === Negotiation: resource deny (write conflict) ===
const nm2b = createNegotiationManager();
nm2b.registerAgent(makeAgent5c('a1', 'r', []));
nm2b.registerAgent(makeAgent5c('a2', 'r', []));
const reqW = await nm2b.requestResource({ resourceId: '/src/w.ts', fromAgent: 'a1', toAgent: 'a2', access: 'write' });
check('neg.resource write granted', reqW.kind === 'resource_grant');
check('neg.resource writer holder', nm2b.getResourceHolder('/src/w.ts') === 'a1');
const reqW2 = await nm2b.requestResource({ resourceId: '/src/w.ts', fromAgent: 'a2', toAgent: 'a1', access: 'write' });
check('neg.resource deny write conflict', reqW2.kind === 'resource_deny');
const reqR = await nm2b.requestResource({ resourceId: '/src/w.ts', fromAgent: 'a2', toAgent: 'a1', access: 'read' });
check('neg.resource read denied while writer', reqR.kind === 'resource_deny');

// === Negotiation: resource grant (write, no holder) ===
const nm3 = createNegotiationManager();
nm3.registerAgent(makeAgent5c('a1', 'r', []));
nm3.registerAgent(makeAgent5c('a2', 'r', []));
const req3 = await nm3.requestResource({ resourceId: '/src/bar.ts', fromAgent: 'a1', toAgent: 'a2', access: 'write' });
check('neg.resource grant write no holder', req3.kind === 'resource_grant');

// === Negotiation: release resource ===
check('neg.resource release', nm3.releaseResource('/src/bar.ts', 'a1') === true);
check('neg.resource release cleared', nm3.getResourceHolder('/src/bar.ts') === undefined);
check('neg.resource release wrong holder false', nm3.releaseResource('/src/bar.ts', 'a2') === false);

// === Negotiation: subscribe ===
const seen5c = [];
const nm4 = createNegotiationManager();
nm4.registerAgent(makeAgent5c('a1', 'r', []));
nm4.registerAgent(makeAgent5c('a2', 'r', []));
const unsub = nm4.subscribe((m) => seen5c.push(m));
await nm4.offerTask({ taskId: 't', fromAgent: 'a2', toAgent: 'a1', role: 'r', goal: 'g' });
check('neg.subscribe receives', seen5c.length === 1 && seen5c[0].kind === 'task_accept');
unsub();
await nm4.offerTask({ taskId: 't2', fromAgent: 'a2', toAgent: 'a1', role: 'r', goal: 'g' });
check('neg.unsubscribe stops', seen5c.length === 1);

// === Negotiation: custom acceptance policy ===
const nm5 = createNegotiationManager(async (offer, agent) => ({ accept: agent.role === 'executor' }));
nm5.registerAgent(makeAgent5c('a1', 'explorer', []));
nm5.registerAgent(makeAgent5c('a2', 'executor', []));
const o5a = await nm5.offerTask({ taskId: 't', fromAgent: 'lead', toAgent: 'a1', role: 'explorer', goal: 'g' });
check('neg.custom policy reject', o5a.kind === 'task_reject');
const o5b = await nm5.offerTask({ taskId: 't', fromAgent: 'lead', toAgent: 'a2', role: 'executor', goal: 'g' });
check('neg.custom policy accept', o5b.kind === 'task_accept');

// === Negotiation: messages audit log ===
check('neg.messages log', nm1.getMessages().length >= 4);

// === Negotiation: unregister clears resources ===
const nm6 = createNegotiationManager();
nm6.registerAgent(makeAgent5c('a1', 'r', []));
nm6.registerAgent(makeAgent5c('a2', 'r', []));
await nm6.requestResource({ resourceId: '/x', fromAgent: 'a1', toAgent: 'a2', access: 'write' });
check('neg.unregister prep', nm6.getResourceHolder('/x') === 'a1');
nm6.unregisterAgent('a1');
check('neg.unregister clears resource', nm6.getResourceHolder('/x') === undefined);

// === Handoff: capability-based routing ===
const hm1 = createHandoffManager();
hm1.registerAgent(makeAgent5c('a1', 'explorer', ['ts', 'testing'], 0.3));
hm1.registerAgent(makeAgent5c('a2', 'executor', ['ts', 'build'], 0.5));
hm1.registerAgent(makeAgent5c('a3', 'reviewer', ['ts', 'review'], 0.1));
const ho1 = await hm1.handoff({ taskId: 't1', fromAgent: 'lead', reason: 'delegation', priority: 'normal', requiredCapabilities: ['ts', 'review'] });
check('handoff.capability routing accepted', ho1.accepted === true);
check('handoff.capability routing target', ho1.toAgent === 'a3');  // lowest load among ts+review

// === Handoff: no capable agent ===
const ho2 = await hm1.handoff({ taskId: 't2', fromAgent: 'lead', reason: 'delegation', priority: 'normal', requiredCapabilities: ['rust'] });
check('handoff.no capable agent', ho2.accepted === false && ho2.reason?.includes('no capable'));

// === Handoff: specific target ===
const ho3 = await hm1.handoff({ taskId: 't3', fromAgent: 'lead', toAgent: 'a2', reason: 'delegation', priority: 'high' });
check('handoff.specific target accepted', ho3.accepted === true && ho3.toAgent === 'a2');
check('handoff.specific target load increased', hm1.getAgent('a2').load === 0.7);

// === Handoff: specific target not found ===
const ho4 = await hm1.handoff({ taskId: 't4', fromAgent: 'lead', toAgent: 'nope', reason: 'delegation', priority: 'normal' });
check('handoff.specific target not found', ho4.accepted === false && ho4.reason?.includes('not found'));

// === Handoff: unavailable agent ===
hm1.registerAgent(makeAgent5c('a4', 'tester', ['ts'], 0, false));
const ho5 = await hm1.handoff({ taskId: 't5', fromAgent: 'lead', toAgent: 'a4', reason: 'delegation', priority: 'normal' });
check('handoff.unavailable rejected', ho5.accepted === false);

// === Handoff: high load rejected (normal priority) ===
hm1.registerAgent(makeAgent5c('a5', 'tester', ['ts'], 0.8));
const ho6 = await hm1.handoff({ taskId: 't6', fromAgent: 'lead', toAgent: 'a5', reason: 'delegation', priority: 'normal' });
check('handoff.high load normal rejected', ho6.accepted === false);

// === Handoff: high load accepted (critical priority) ===
const ho7 = await hm1.handoff({ taskId: 't7', fromAgent: 'lead', toAgent: 'a5', reason: 'escalation', priority: 'critical' });
check('handoff.high load critical accepted', ho7.accepted === true);

// === Handoff: candidates sorted by load ===
const cands = hm1.findCandidates(['ts']);
check('handoff.candidates sorted by load', cands.length >= 2 && cands[0].load <= cands[1].load);

// === Handoff: all candidates reject ===
const hm2 = createHandoffManager();
hm2.registerAgent(makeAgent5c('a1', 'r', ['ts'], 0.99));
hm2.registerAgent(makeAgent5c('a2', 'r', ['ts'], 0.99));
const ho8 = await hm2.handoff({ taskId: 't8', fromAgent: 'lead', reason: 'delegation', priority: 'normal', requiredCapabilities: ['ts'] });
check('handoff.all reject', ho8.accepted === false && ho8.reason?.includes('all capable'));

// === Handoff: no required capabilities = any available ===
const ho9 = await hm1.handoff({ taskId: 't9', fromAgent: 'lead', reason: 'user_request', priority: 'low' });
check('handoff.no required caps any available', ho9.accepted === true);

// === Handoff: history ===
check('handoff.history', hm1.getHistory().length >= 5);

// === Handoff: reason label ===
check('handoff.reasonLabel', AgentHandoffManager.reasonLabel('overload') === 'Overloaded');
check('handoff.reasonLabel escalation', AgentHandoffManager.reasonLabel('escalation') === 'Escalation');

// === Handoff: custom policy ===
const hm3 = createHandoffManager(async (ctx, agent) => agent.role === 'reviewer');
hm3.registerAgent(makeAgent5c('a1', 'explorer', ['ts']));
hm3.registerAgent(makeAgent5c('a2', 'reviewer', ['ts']));
const ho10 = await hm3.handoff({ taskId: 't10', fromAgent: 'lead', reason: 'delegation', priority: 'normal', requiredCapabilities: ['ts'] });
check('handoff.custom policy routes reviewer', ho10.accepted === true && ho10.toAgent === 'a2');

// ---- swarm + synthesis + hive (Sprint 5.4) ------------------------
{

// === Hive filesystem ===
const hiveRoot = join(buildDir, 'test-hive');
try { rmSync(hiveRoot); } catch {}
const dirs = initHive(hiveRoot);
check('hive.root exists', dirs.root === hiveRoot);
check('hive.hiveMind exists', existsSync(dirs.hiveMind));
check('hive.locks exists', existsSync(dirs.locks));
check('hive.communication exists', existsSync(dirs.communication));
check('hive.inbox exists', existsSync(dirs.inbox));
check('hive.handoffs exists', existsSync(dirs.handoffs));
check('hive.alerts exists', existsSync(dirs.alerts));
check('hive.workspaces exists', existsSync(dirs.workspaces));
check('hive.artifacts exists', existsSync(dirs.artifacts));
check('hive.audit exists', existsSync(dirs.audit));
check('hive.memoryArchive exists', existsSync(dirs.memoryArchive));
check('hive.system exists', existsSync(dirs.system));

// === Hive lock ===
const releaseLock = acquireHiveLock(dirs, 'build', 'agent-1');
check('hive.lock acquired', releaseLock !== null);
const releaseLock2 = acquireHiveLock(dirs, 'build', 'agent-2');
check('hive.lock held by other', releaseLock2 === null);
releaseLock();
const releaseLock3 = acquireHiveLock(dirs, 'build', 'agent-3');
check('hive.lock re-acquired after release', releaseLock3 !== null);
releaseLock3();

// === Hive artifact + audit ===
const artPath = writeArtifact(dirs, 'result.json', JSON.stringify({ ok: true }));
check('hive.artifact written', existsSync(artPath));
const auditPath = appendAudit(dirs, 'swarm', { item: 1, success: true });
appendAudit(dirs, 'swarm', { item: 2, success: false });
const auditFiles = listHiveDir(dirs.audit);
check('hive.audit log exists', auditFiles.includes('swarm.log'));

// === Hive teardown ===
teardownHive(hiveRoot);
check('hive.teardown removed', !existsSync(hiveRoot));

// === Swarm dispatch: basic ===
const mkSwarmExec5d = (behaviors) => {
  const now = { t: 1000 };
  return {
    dispatch: async (item) => {
      const b = behaviors[item.name];
      if (!b) return { itemId: item.id, itemName: item.name, success: false, error: 'no behavior', durationMs: 0 };
      if (b.throw) return { itemId: item.id, itemName: item.name, success: false, error: b.throw, durationMs: 10 };
      return { itemId: item.id, itemName: item.name, success: true, output: b.output ?? 'ok', durationMs: 5, role: item.assignedRole };
    },
    now: () => now.t,
    _tick: (ms) => { now.t += ms; },
  };
};

const ex1 = mkSwarmExec5d({ A: { output: 'a-out' }, B: { output: 'b-out' } });
const orch1 = createSwarmOrchestrator(ex1);
const q1 = orch1.getQueue();
q1.addItem({ name: 'A', priority: 0 });
q1.addItem({ name: 'B', priority: 1 });
const r1 = await orch1.dispatch({ swarmName: 's1' });
check('swarm.basic total', r1.total === 2);
check('swarm.basic successful', r1.successful === 2);
check('swarm.basic failed', r1.failed === 0);
check('swarm.basic results', r1.results.length === 2 && r1.results[0].itemName === 'A' && r1.results[1].itemName === 'B');
check('swarm.basic priority order', r1.results[0].output === 'a-out');

// === Swarm dispatch: with dependencies ===
const ex2 = mkSwarmExec5d({ A: { output: 'a' }, B: { output: 'b' } });
const orch2 = createSwarmOrchestrator(ex2);
const q2 = orch2.getQueue();
const idA2 = q2.addItem({ name: 'A', priority: 0 });
q2.addItem({ name: 'B', priority: 1, dependsOn: [idA2] });
const r2 = await orch2.dispatch({ swarmName: 's2' });
check('swarm.deps total', r2.total === 2 && r2.successful === 2);
check('swarm.deps order', r2.results[0].itemName === 'A' && r2.results[1].itemName === 'B');

// === Swarm dispatch: failure handling ===
const ex3 = mkSwarmExec5d({ F: { throw: 'boom' }, G: { output: 'g' } });
const orch3 = createSwarmOrchestrator(ex3);
const q3 = orch3.getQueue();
q3.addItem({ name: 'F', priority: 0 });
q3.addItem({ name: 'G', priority: 1 });
const r3 = await orch3.dispatch({ swarmName: 's3' });
check('swarm.failure failed', r3.failed === 1);
check('swarm.failure successful', r3.successful === 1);
check('swarm.failure error', r3.results[0].error === 'boom');

// === Swarm dispatch: blocked items (deps unmet via failed chain) ===
const ex4b = mkSwarmExec5d({ A: { output: 'a' }, B: { throw: 'B failed' } });
const orch4b = createSwarmOrchestrator(ex4b);
const q4b = orch4b.getQueue();
const idA4b = q4b.addItem({ name: 'A', priority: 0 });
const idB4b = q4b.addItem({ name: 'B', priority: 1, dependsOn: [idA4b] });
q4b.addItem({ name: 'C', priority: 2, dependsOn: [idB4b] });
const r4 = await orch4b.dispatch({ swarmName: 's4' });
check('swarm.blocked A done', r4.successful === 1);
check('swarm.blocked B failed', r4.failed === 1);
check('swarm.blocked C remains blocked', r4.blocked === 1);

// === Swarm dispatch: checkpoint every N ===
const ex5b = mkSwarmExec5d({ 'I0': { output: 0 }, 'I1': { output: 1 }, 'I2': { output: 2 }, 'I3': { output: 3 }, 'I4': { output: 4 } });
const orch5 = createSwarmOrchestrator(ex5b);
const q5 = orch5.getQueue();
for (let i = 0; i < 5; i++) q5.addItem({ name: 'I' + i, priority: i });
const r5 = await orch5.dispatch({ swarmName: 's5', checkpointInterval: 2 });
check('swarm.checkpoint count', r5.checkpoints.length === 2);
check('swarm.checkpoint doneCount', r5.checkpoints[0].doneCount === 2 && r5.checkpoints[1].doneCount === 4);

// === Swarm dispatch: maxItems ===
const ex6 = mkSwarmExec5d({ A: { output: 'a' }, B: { output: 'b' }, C: { output: 'c' } });
const orch6 = createSwarmOrchestrator(ex6);
const q6 = orch6.getQueue();
q6.addItem({ name: 'A', priority: 0 });
q6.addItem({ name: 'B', priority: 1 });
q6.addItem({ name: 'C', priority: 2 });
const r6 = await orch6.dispatch({ swarmName: 's6', maxItems: 2 });
check('swarm.maxItems processed', r6.results.length === 2);
check('swarm.maxItems total still 3', r6.total === 3);

// === Swarm dispatch: empty queue ===
const ex7 = mkSwarmExec5d({});
const orch7 = createSwarmOrchestrator(ex7);
const r7 = await orch7.dispatch({ swarmName: 's7' });
check('swarm.empty total 0', r7.total === 0 && r7.successful === 0 && r7.failed === 0);

// === Swarm dispatch: hive audit logging ===
const ex8 = mkSwarmExec5d({ A: { output: 'a' } });
const orch8 = createSwarmOrchestrator(ex8);
const q8 = orch8.getQueue();
q8.addItem({ name: 'A', priority: 0 });
const hiveRoot8 = join(buildDir, 'test-hive-swarm');
try { rmSync(hiveRoot8); } catch {}
const dirs8 = initHive(hiveRoot8);
const r8 = await orch8.dispatch({ swarmName: 's8', dirs: dirs8 });
check('swarm.hive audit logged', listHiveDir(dirs8.audit).includes('swarm.log'));
teardownHive(hiveRoot8);

// === Synthesis: majority vote (unanimous) ===
const s1 = synthesize([
  { agent: 'a1', output: 'yes' },
  { agent: 'a2', output: 'yes' },
  { agent: 'a3', output: 'yes' },
], 'majority');
check('synth.majority unanimous output', s1.output === 'yes');
check('synth.majority unanimous score 1', s1.score === 1);
check('synth.majority unanimous no conflicts', s1.conflicts.length === 0);
check('synth.majority unanimous attribution', s1.attribution.length === 3);

// === Synthesis: majority vote (split) ===
const s2 = synthesize([
  { agent: 'a1', output: 'yes' },
  { agent: 'a2', output: 'yes' },
  { agent: 'a3', output: 'no' },
], 'majority');
check('synth.majority split output', s2.output === 'yes');
check('synth.majority split score < 1', s2.score < 1);
check('synth.majority split has conflicts', s2.conflicts.length === 1);
check('synth.majority split attribution 2 yes', s2.attribution.length === 2);

// === Synthesis: weighted ===
const s3 = synthesize([
  { agent: 'a1', output: 'X', weight: 0.9 },
  { agent: 'a2', output: 'Y', weight: 0.1 },
], 'weighted');
check('synth.weighted picks high weight', s3.output === 'X');
check('synth.weighted attribution 1 (X agent)', s3.attribution.length === 1 && s3.attribution[0].agent === 'a1');

// === Synthesis: first-wins ===
const s4 = synthesize([
  { agent: 'a1', output: 'first' },
  { agent: 'a2', output: 'second' },
], 'first');
check('synth.first output', s4.output === 'first');
check('synth.first attribution 1', s4.attribution.length === 1 && s4.attribution[0].agent === 'a1');

// === Synthesis: single contribution ===
const s5 = synthesize([{ agent: 'a1', output: 'only' }]);
check('synth.single output', s5.output === 'only');
check('synth.single score 1', s5.score === 1);
check('synth.single no conflicts', s5.conflicts.length === 0);

// === Synthesis: empty ===
const s6 = synthesize([]);
check('synth.empty output undefined', s6.output === undefined);
check('synth.empty score 0', s6.score === 0);

// === Synthesis: detectConflicts ===
check('synth.detect no conflict', detectConflicts([{ agent: 'a', output: 1 }, { agent: 'b', output: 1 }]).length === 0);
check('synth.detect conflict', detectConflicts([{ agent: 'a', output: 1 }, { agent: 'b', output: 2 }]).length === 1);

// === Synthesis: default method = majority ===
const s7 = synthesize([{ agent: 'a1', output: 'x' }, { agent: 'a2', output: 'x' }]);
check('synth.default majority', s7.method === 'majority' && s7.output === 'x');

// === Synthesis: object outputs ===
const s8 = synthesize([
  { agent: 'a1', output: { result: true } },
  { agent: 'a2', output: { result: true } },
], 'majority');
check('synth.object output', s8.output?.result === true);
check('synth.object score 1', s8.score === 1);

// === P1 fix: blockedWaitMs no hang ===
const exLk = mkSwarmExec5d({ A: { output: 'a' }, B: { throw: 'B failed' } });
const orchLk = createSwarmOrchestrator(exLk);
const qLk = orchLk.getQueue();
const idALk = qLk.addItem({ name: 'A', priority: 0 });
const idBLk = qLk.addItem({ name: 'B', priority: 1, dependsOn: [idALk] });  // will fail
qLk.addItem({ name: 'C', priority: 2, dependsOn: [idBLk] });  // stays blocked (B failed)
// Use a short blockedWaitMs + small maxBlockedPolls so the test returns fast
const rLk = await orchLk.dispatch({ swarmName: 'lk', blockedWaitMs: 5, maxBlockedPolls: 3 });
check('swarm.blockedWaitMs no hang returns', rLk !== undefined && rLk.swarmName === 'lk');
check('swarm.blockedWaitMs C remains blocked', rLk.blocked === 1);
check('swarm.blockedWaitMs A done', rLk.successful === 1);
check('swarm.blockedWaitMs B failed', rLk.failed === 1);

// === P2 fix: maxItems no stranded 'now' ===
const exStrand = mkSwarmExec5d({ A: { output: 'a' }, B: { output: 'b' }, C: { output: 'c' } });
const orchStrand = createSwarmOrchestrator(exStrand);
const qStrand = orchStrand.getQueue();
qStrand.addItem({ name: 'A', priority: 0 });
qStrand.addItem({ name: 'B', priority: 1 });
qStrand.addItem({ name: 'C', priority: 2 });
const rStrand = await orchStrand.dispatch({ swarmName: 'strand', maxItems: 2 });
check('swarm.maxItems no strand: results 2', rStrand.results.length === 2);
// no item should be stuck in 'now' status
const nowItems = qStrand.getItems('now');
check('swarm.maxItems no stranded now', nowItems.length === 0);
// the third item should still be 'next' (unclaimed)
const nextItems = qStrand.getItems('next');
check('swarm.maxItems remainder is next', nextItems.length === 1 && nextItems[0].name === 'C');

// === P3 fix: executor.dispatch throws → captured as failure ===
const exThrow = { dispatch: async (item) => { throw new Error('executor crashed'); }, now: () => Date.now() };
const orchThrow = createSwarmOrchestrator(exThrow);
const qThrow = orchThrow.getQueue();
qThrow.addItem({ name: 'X', priority: 0 });
const rThrow = await orchThrow.dispatch({ swarmName: 'throw' });
check('swarm.executor throw captured', rThrow.failed === 1 && rThrow.results[0].error?.includes('executor crashed'));

// === P3 fix: detectConflicts resolution message by method ===
const wConf = synthesize([{ agent: 'a1', output: 'X' }, { agent: 'a2', output: 'Y' }], 'weighted');
check('synth.weighted conflict resolution mentions method', wConf.conflicts[0]?.resolution?.includes('weighted'));

} // end Sprint 5.4 block

// ---- swarm store persistence (Sprint 5.5) --------------------------------
{
  const swarmTmp = mkdtempSync(join(tmpdir(), 'ith-swarm-'))
  execSync('git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init', { cwd: swarmTmp })
  const st5e = new IthStore(swarmTmp, cfg.loadConfig())
  const sStore = new SwarmStore(st5e.db)
  const r1 = {
    swarmName: 'swarm-A', total: 3, successful: 2, failed: 1, blocked: 0,
    results: [
      { itemId: 1, itemName: 'A', success: true, output: 'a-out', durationMs: 5, role: 'Explore' },
      { itemId: 2, itemName: 'B', success: true, output: 'b-out', durationMs: 7 },
      { itemId: 3, itemName: 'C', success: false, error: 'boom', durationMs: 0 },
    ],
    totalDurationMs: 100,
    checkpoints: [{ id: 1, items: [], createdAt: 0, doneCount: 2 }],
  }
  const id1 = sStore.saveSwarmResult(r1, 1000)
  check('swarmstore.save returns id', typeof id1 === 'string' && id1.startsWith('swarm-'))
  const got1 = sStore.getSwarmResult(id1)
  check('swarmstore.get name', got1 && got1.swarmName === 'swarm-A')
  check('swarmstore.get total', got1 && got1.total === 3)
  check('swarmstore.get successful', got1 && got1.successful === 2)
  check('swarmstore.get failed', got1 && got1.failed === 1)
  check('swarmstore.get blocked', got1 && got1.blocked === 0)
  check('swarmstore.get duration', got1 && got1.totalDurationMs === 100)
  check('swarmstore.get results count', got1 && got1.results.length === 3)
  check('swarmstore.get result A output', got1 && got1.results[0].output === 'a-out')
  check('swarmstore.get result A role', got1 && got1.results[0].role === 'Explore')
  check('swarmstore.get result C error', got1 && got1.results[2].error === 'boom')
  check('swarmstore.get result C not success', got1 && got1.results[2].success === false)
  check('swarmstore.get checkpoints', got1 && got1.checkpoints.length === 1 && got1.checkpoints[0].doneCount === 2)
  const list1 = sStore.listSwarmRuns(10)
  check('swarmstore.list 1 run', list1.length === 1 && list1[0].runId === id1)
  check('swarmstore.list row fields', list1[0].swarmName === 'swarm-A' && list1[0].successful === 2)
  const latest1 = sStore.latestSwarmRun('swarm-A')
  check('swarmstore.latest matches', latest1 && latest1.runId === id1 && latest1.swarmName === 'swarm-A')
  // second swarm, same name, later
  const r2 = {
    swarmName: 'swarm-A', total: 1, successful: 1, failed: 0, blocked: 0,
    results: [{ itemId: 1, itemName: 'X', success: true, output: { ok: true }, durationMs: 3 }],
    totalDurationMs: 9, checkpoints: [],
  }
  const id2 = sStore.saveSwarmResult(r2, 2000)
  check('swarmstore.latest updates to newer', sStore.latestSwarmRun('swarm-A').runId === id2)
  check('swarmstore.list now 2', sStore.listSwarmRuns(10).length === 2)
  // object output round-trips
  const got2 = sStore.getSwarmResult(id2)
  check('swarmstore.object output ok', got2 && got2.results[0].output && got2.results[0].output.ok === true)
  // empty checkpoints round-trip
  check('swarmstore.empty checkpoints', got2 && got2.checkpoints.length === 0)
  // multiple checkpoints round-trip
  const r3 = {
    swarmName: 'swarm-B', total: 0, successful: 0, failed: 0, blocked: 0,
    results: [], totalDurationMs: 0,
    checkpoints: [
      { id: 1, items: [], createdAt: 10, doneCount: 1 },
      { id: 2, items: [], createdAt: 20, doneCount: 2 },
      { id: 3, items: [], createdAt: 30, doneCount: 3 },
    ],
  }
  const id3 = sStore.saveSwarmResult(r3, 3000)
  const got3 = sStore.getSwarmResult(id3)
  check('swarmstore.3 checkpoints', got3 && got3.checkpoints.length === 3)
  check('swarmstore.checkpoint order', got3 && got3.checkpoints[0].doneCount === 1 && got3.checkpoints[2].doneCount === 3)
  check('swarmstore.empty results', got3 && got3.results.length === 0)
  // delete
  sStore.deleteSwarmRun(id1)
  check('swarmstore.delete gone', sStore.getSwarmResult(id1) === undefined)
  check('swarmstore.delete list shrinks', sStore.listSwarmRuns(10).length === 2)
  check('swarmstore.delete preserves others', sStore.getSwarmResult(id2) !== undefined)
  // missing lookups
  check('swarmstore.missing undefined', sStore.getSwarmResult('nope') === undefined)
  check('swarmstore.latest missing undefined', sStore.latestSwarmRun('none') === undefined)
  // createSwarmStore factory
  const sStore2 = createSwarmStore(st5e.db)
  check('swarmstore.factory works', sStore2.listSwarmRuns(10).length === 2)
  // same-ms tiebreak: latestSwarmRun must return the NEWER runId (counter-based)
  const sameMs1 = sStore.saveSwarmResult({ swarmName: 'same-ms', total: 1, successful: 1, failed: 0, blocked: 0, results: [{ itemId: 1, itemName: 'A', success: true, output: 'first', durationMs: 1 }], totalDurationMs: 1, checkpoints: [] }, 5000)
  const sameMs2 = sStore.saveSwarmResult({ swarmName: 'same-ms', total: 1, successful: 1, failed: 0, blocked: 0, results: [{ itemId: 1, itemName: 'A', success: true, output: 'second', durationMs: 1 }], totalDurationMs: 1, checkpoints: [] }, 5000)
  check('swarmstore.same-ms latest is newer', sStore.latestSwarmRun('same-ms').runId === sameMs2)
  // listSwarmRuns ordering for same-ms should also be stable (newer first)
  const sameList = sStore.listSwarmRuns(50).filter(r => r.swarmName === 'same-ms')
  check('swarmstore.same-ms list newer first', sameList[0].runId === sameMs2)
  st5e.close()
  rmSync(swarmTmp, { recursive: true, force: true })
}

rmSync(buildDir, { recursive: true, force: true });
rmSync(tmpRepo, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
