import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { store5, psStore } = ctx;

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
  Object.assign(ctx, { summary, agentCosts, summaryWithRoles, storeBug, psBug1, psBug2, psBug3, negThrew });
}
