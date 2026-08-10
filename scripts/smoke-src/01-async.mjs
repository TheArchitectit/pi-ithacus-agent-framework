import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

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
  Object.assign(ctx, { asyncStateDir, asyncState, checkResult, logExists, exitInfo, store4, retrieved, completed, wtr, wtc });
}
