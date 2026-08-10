import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { caps } = ctx;

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
  Object.assign(ctx, { makeAgent5c, nm1, offer1, offer2, offer3, offer4, counterPayload, nm2, req1, req1b, req1c, nm2b, reqW, reqW2, reqR, nm3, req3, seen5c, nm4, unsub, nm5, o5a, o5b, nm6, hm1, ho1, ho2, ho3, ho4, ho5, ho6, ho7, cands, hm2, ho8, ho9, hm3, ho10 });
}
