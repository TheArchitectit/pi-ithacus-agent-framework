import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { r2, r1, q2 } = ctx;

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
}
