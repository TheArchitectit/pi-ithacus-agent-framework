import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

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
  Object.assign(ctx, { store5, psStore, p1, stuckCount, recovered, presences, filtered, granted, conflict, checkRes, noConflict });
}
