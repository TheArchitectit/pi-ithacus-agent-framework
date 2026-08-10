import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { fakeClock5a, q, idA } = ctx;
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
  Object.assign(ctx, { idE, overdue, stats, log, cp, q2, qP, readyP, ts, t1, t2, t3, running, t4, byAgent, dbPath5, db5, sqlStore, st1, st2, stF, stFb, stFe, stU });
}
