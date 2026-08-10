import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

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
  Object.assign(ctx, { makeExecutor5b, exb1, rs1, attempts5b, exb2, rs2, exb3, rs3, exb4, rs4, rs5, rs6, reviewCount5b, reviewer5b, exb7, rs7, rs7b, exb8, rs8, exb9, rs9, exb10, rs10, sequence5b, exb11, rs11, exb12, wfb12, exb13, wfb13, exb14, wfb14, exb15, wfb15, exb16, wfb16, yaml5b1, tpl5b1, yaml5b2, tpl5b2, tpl5b3, yamlErr5b, exbEnd, wfEnd5b, exTopo, wfTopo, wfCycle, fixCalls, exFix, wfFix, rejectReviewer, wfReject, permCalls, exPerm, rPerm, retrCalls, exRetr, rRetr, condErr, condErr2, dupSub, rLoop0 });
}
