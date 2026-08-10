import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
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
  Object.assign(ctx, { sd, resolved, plan, r2, chain, store, calls, results, goodTrim, noTrim, dag, sorted, waves, cyc, cycleThrew, dupThrew, missingThrew, validNoThrow, wfPlan, w1, w2, store2, gotW2, ag, store3, bc, wtRepo, wtCfg, listed, cleaned });
}
