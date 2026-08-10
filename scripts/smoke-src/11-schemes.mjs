import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

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
  Object.assign(ctx, { prRes, issueRes, conflictRes, schemeThrew, prResWhitespace, storeE, eStore });
}
