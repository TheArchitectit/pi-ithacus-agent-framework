import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- metrics (Sprint 3.2) ----------------------------------------------
const metricsReg = metrics.createMetricsRegistry();
metricsReg.inc('tasks_completed');
metricsReg.inc('tasks_completed');
metricsReg.inc('tasks_completed', 5);
check('metrics.inc counter', metricsReg.getCounter('tasks_completed') === 7);
metricsReg.inc('errors', 1, { type: 'timeout' });
metricsReg.inc('errors', 1, { type: 'timeout' });
metricsReg.inc('errors', 1, { type: 'crash' });
check('metrics.inc with labels', metricsReg.getCounter('errors', { type: 'timeout' }) === 2);
check('metrics.inc labels separate', metricsReg.getCounter('errors', { type: 'crash' }) === 1);

metricsReg.set('active_agents', 3);
metricsReg.set('active_agents', 5);
check('metrics.set gauge', metricsReg.getGauge('active_agents') === 5);

metricsReg.observe('task_duration_ms', 150);
metricsReg.observe('task_duration_ms', 300);
metricsReg.observe('task_duration_ms', 50);
check('metrics.observe histogram', metricsReg.getHistogram('task_duration_ms').length === 3);

// task helpers
metricsReg.recordDuration('task-1', 250);
metricsReg.recordTokens('task-1', 1000);
check('metrics.recordDuration', metricsReg.getHistogram('ithacus_task_duration_ms', { taskId: 'task-1' }).includes(250));
check('metrics.recordTokens', metricsReg.getCounter('ithacus_task_tokens_total', { taskId: 'task-1' }) === 1000);

metricsReg.trackTask('task-2', 500, 2000);
check('metrics.trackTask duration', metricsReg.getHistogram('ithacus_task_duration_ms', { taskId: 'task-2' }).includes(500));
check('metrics.trackTask tokens', metricsReg.getCounter('ithacus_task_tokens_total', { taskId: 'task-2' }) === 2000);

// Prometheus export
const prom = metricsReg.toPrometheus();
check('metrics.toPrometheus has TYPE', prom.includes('# TYPE tasks_completed counter'));
check('metrics.toPrometheus has value', prom.includes('tasks_completed 7'));
check('metrics.toPrometheus has gauge', prom.includes('# TYPE active_agents gauge'));
check('metrics.toPrometheus has histogram', prom.includes('# TYPE ithacus_task_duration_ms histogram'));
check('metrics.toPrometheus has bucket', prom.includes('ithacus_task_duration_ms_bucket{le="0.005"'));
check('metrics.toPrometheus has +Inf', prom.includes('le="+Inf"'));
check('metrics.toPrometheus labels', prom.includes('type="timeout"'));

// OTLP export
const otlp = metricsReg.toOTLP();
check('metrics.toOTLP is JSON', (() => { try { JSON.parse(otlp); return true; } catch { return false; } })());
check('metrics.toOTLP has service name', otlp.includes('ithacus'));
check('metrics.toOTLP has counter', otlp.includes('tasks_completed'));
check('metrics.toOTLP has gauge', otlp.includes('active_agents'));

metricsReg.clear();
check('metrics.clear empties', metricsReg.allPoints().length === 0);
  Object.assign(ctx, { metricsReg, prom, otlp });
}
