import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, checkpointManager, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- checkpoint manager (Sprint 5.16) -----------------------------------
const cm = checkpointManager;
const store = new IthStore(tmpRepo, cfg.loadConfig());

// Idempotent schema re-run (design §4): creating twice is safe.
cm.ensureCheckpointSchema(store);
cm.ensureCheckpointSchema(store);
check('cm.ensureCheckpointSchema idempotent', true);

// mirror marks into the store via checkpoint.ts (design §2.1)
const conv = [
  { id: 'm1', role: 'user', content: 'Investigate.', turn: 0, exploratory: false },
  { id: 'm2', role: 'assistant', content: 'Looking at auth.', turn: 1, exploratory: true },
];
const ck = checkpoint.markCheckpoint(conv, 'runA');
const meta = checkpoint.mirrorCheckpoint(store, ck, conv);
check('cm.mirrorCheckpoint persists uuid id', typeof meta.id === 'string' && meta.id.length > 0);
check('cm.mirrorCheckpoint label derived', meta.label.length > 0);
check('cm.mirrorCheckpoint runId', meta.runId === 'runA');
check('cm.mirrorCheckpoint messageCount', meta.messageCount === conv.length);
check('cm.mirrorCheckpoint not archived', meta.archived === false);

// getCheckpoint round-trip
const got = cm.getCheckpoint(store, meta.id);
check('cm.getCheckpoint round-trip', got !== null && got.id === meta.id && got.label === meta.label);
check('cm.getCheckpoint missing -> null', cm.getCheckpoint(store, 'nope') === null);

// list filters + archive exclusion (design §2.2)
const m2c = cm.createCheckpointMeta(store, { runId: 'runA', label: 'second', messageCount: 10, tokenEstimate: 500 });
const mRunB = cm.createCheckpointMeta(store, { runId: 'runB', label: 'other-run' });
const all = cm.listCheckpoints(store, { includeArchived: true });
check('cm.list includeArchived returns all', all.length === 3);
const runA = cm.listCheckpoints(store, { runId: 'runA' });
check('cm.list runId filter excludes other run', runA.length === 2 && runA.every(c => c.runId === 'runA'));
const defaultList = cm.listCheckpoints(store);
check('cm.list default excludes archived (none yet)', defaultList.length === 3);
check('cm.list newest first', defaultList[0].createdAt >= defaultList[1].createdAt);

// archiveCheckpoint marks archived + excludes from default list
check('cm.archiveCheckpoint ok', cm.archiveCheckpoint(store, m2c.id) === true);
const archived = cm.getCheckpoint(store, m2c.id);
check('cm.archiveCheckpoint sets archived flag', archived !== null && archived.archived === true);
const defaultAfter = cm.listCheckpoints(store);
check('cm.list excludes archived by default', defaultAfter.length === 2 && !defaultAfter.some(c => c.id === m2c.id));
const withArch = cm.listCheckpoints(store, { includeArchived: true });
check('cm.list includeArchived returns archived', withArch.some(c => c.id === m2c.id && c.archived));

// deleteCheckpoint: hard delete but REFUSES archived rows (design §2.2)
check('cm.deleteCheckpoint refuses archived', cm.deleteCheckpoint(store, m2c.id) === false);
check('cm.deleteCheckpoint missing -> false', cm.deleteCheckpoint(store, 'nope') === false);
check('cm.deleteCheckpoint hard delete ok', cm.deleteCheckpoint(store, mRunB.id) === true);
check('cm.deleteCheckpoint removed row', cm.getCheckpoint(store, mRunB.id) === null);

// compareCheckpoints — metadata delta math (design §2.2)
const aId = meta.id;
check('cm.compareCheckpoints present checkpoints', cm.compareCheckpoints(store, aId, aId).aMeta !== null && cm.compareCheckpoints(store, aId, aId).bMeta !== null);
check('cm.compareCheckpoints missing side -> null meta',
  cm.compareCheckpoints(store, 'nope', aId).aMeta === null &&
  cm.compareCheckpoints(store, aId, 'nope').bMeta === null);
// B (second, messageCount 10, tokenEstimate 500) vs A (first, messageCount 2,
// tokenEstimate = tokenCountAfter): delta math is metadata-level.
const diff2 = cm.compareCheckpoints(store, aId, m2c.id);
check('cm.compareCheckpoints deltaMessages math',
  diff2.deltaMessages === (10 - conv.length) && (10 - conv.length) === 8);
check('cm.compareCheckpoints deltaTokens math (500 - tokenCountAfter)',
  diff2.deltaTokens === (500 - ck.tokenCountAfter));
check('cm.compareCheckpoints summaryDiff descriptive',
  typeof diff2.summaryDiff === 'string' && diff2.summaryDiff.includes('delta'));

store.close();

// backward-compat: schema persists across a fresh store open (same DB file)
const store2 = new IthStore(tmpRepo, cfg.loadConfig());
cm.ensureCheckpointSchema(store2);
store2.close();

  Object.assign(ctx, { cm, meta, got, m2c, diff2, defaultAfter });
}
