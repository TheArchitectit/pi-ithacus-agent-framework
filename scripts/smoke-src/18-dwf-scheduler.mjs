import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { h, msg } = ctx;

// ---- dwf + scheduler (Sprint 4.5) -----------------------------------
// === DWF ===
const makeDispatcher = (agentResults) => {
  let i = 0;
  const now = { t: 1000 };
  return {
    spawnAgent: async (role, goal) => {
      const r = agentResults[i] ?? agentResults[agentResults.length - 1];
      i++;
      return { agentId: `a-${i}`, role, output: `result for ${goal}`, tokensUsed: r.tokensUsed ?? 100, ok: r.ok ?? true, error: r.error };
    },
    now: () => now.t,
    _tick: (ms) => { now.t += ms; },
  };
};

// simple successful workflow
const disp1 = makeDispatcher([{ tokensUsed: 50 }, { tokensUsed: 60 }]);
const wf1 = defineWorkflow('simple', 'trusted', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  const a1 = await ctx.agent('explorer', 'find files');
  const a2 = await ctx.agent('executor', 'edit them');
  return `${a1.output}+${a2.output}`;
});
const res1 = await runDwf({ workflow: wf1, dispatcher: disp1 });
check('dwf.runDwf ok', res1.status === 'ok' && res1.tokensUsed === 110 && res1.agentsSpawned === 2);
check('dwf.runDwf result', res1.result === 'result for find files+result for edit them');
check('dwf.runDwf duration tracked', res1.durationMs >= 0);

// fanOut
const disp2 = makeDispatcher([{ tokensUsed: 30 }, { tokensUsed: 40 }, { tokensUsed: 50 }]);
const wf2 = defineWorkflow('fanout', 'trusted', { maxAgents: 10, maxFanOut: 3, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  const fo = await ctx.fanOut('explorer', ['g1', 'g2', 'g3']);
  return fo.results.length;
});
const res2 = await runDwf({ workflow: wf2, dispatcher: disp2 });
check('dwf.fanOut ok', res2.status === 'ok' && res2.result === 3 && res2.tokensUsed === 120);

// fanOut exceeds maxFanOut
const disp3 = makeDispatcher([{ tokensUsed: 10 }, { tokensUsed: 10 }, { tokensUsed: 10 }, { tokensUsed: 10 }]);
const wf3 = defineWorkflow('fanout-limit', 'trusted', { maxAgents: 10, maxFanOut: 2, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.fanOut('explorer', ['g1', 'g2', 'g3']);
  return 'done';
});
const res3 = await runDwf({ workflow: wf3, dispatcher: disp3 });
check('dwf.fanOut maxFanOut exceeded → failed', res3.status === 'failed' && res3.error?.includes('maxFanOut'));

// maxAgents exceeded
const disp4 = makeDispatcher([{ tokensUsed: 10 }]);
const wf4 = defineWorkflow('agent-limit', 'trusted', { maxAgents: 1, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.agent('a', 'g1');
  await ctx.agent('a', 'g2');  // exceeds maxAgents=1
  return 'done';
});
const res4 = await runDwf({ workflow: wf4, dispatcher: disp4 });
check('dwf.maxAgents exceeded → failed', res4.status === 'failed' && res4.error?.includes('maxAgents'));

// budget exceeded
const disp5 = makeDispatcher([{ tokensUsed: 600 }, { tokensUsed: 600 }]);
const wf5 = defineWorkflow('budget-limit', 'trusted', { maxAgents: 10, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.agent('a', 'g1');
  await ctx.agent('a', 'g2');
  return 'done';
});
const res5 = await runDwf({ workflow: wf5, dispatcher: disp5 });
check('dwf.budget exceeded', res5.status === 'budget-exceeded');

// deadline exceeded (dispatcher clock past deadline)
const disp6 = makeDispatcher([{ tokensUsed: 10 }]);
disp6.now = () => 20000;  // past deadline 10000
const wf6 = defineWorkflow('deadline', 'trusted', { maxAgents: 10, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  await ctx.agent('a', 'g1');
  return 'done';
});
const res6 = await runDwf({ workflow: wf6, dispatcher: disp6 });
check('dwf.deadline exceeded', res6.status === 'deadline-exceeded');

// untrusted refused
const disp7 = makeDispatcher([]);
const wf7 = defineWorkflow('untrusted', 'untrusted', { maxAgents: 10, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async () => 'done');
const res7 = await runDwf({ workflow: wf7, dispatcher: disp7 });
check('dwf.untrusted refused', res7.status === 'failed' && res7.error?.includes('untrusted'));

// under-review allowed
const disp8 = makeDispatcher([{ tokensUsed: 50 }]);
const wf8 = defineWorkflow('review', 'under-review', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  const r = await ctx.agent('a', 'g');
  return r.output;
});
const res8 = await runDwf({ workflow: wf8, dispatcher: disp8 });
check('dwf.under-review allowed', res8.status === 'ok');

// log callback
const logs = [];
const disp9 = makeDispatcher([{ tokensUsed: 10 }]);
const wf9 = defineWorkflow('logging', 'trusted', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  ctx.log('hello');
  ctx.log('oops', 'error');
  return 'done';
});
await runDwf({ workflow: wf9, dispatcher: disp9, log: (msg, level) => logs.push(`${level}:${msg}`) });
check('dwf.log callback', logs.length === 2 && logs[0] === 'info:hello' && logs[1] === 'error:oops');

// custom runId
const disp10 = makeDispatcher([{ tokensUsed: 10 }]);
const wf10 = defineWorkflow('customid', 'trusted', { maxAgents: 5, maxFanOut: 5, tokenBudget: 1000, deadlineMs: 10000 }, async (ctx) => {
  ctx.log(`run=${ctx.runId}`);
  return ctx.runId;
});
const res10 = await runDwf({ workflow: wf10, dispatcher: disp10, runId: 'my-run' });
check('dwf.custom runId', res10.runId === 'my-run' && res10.result === 'my-run');

// === SCHEDULER ===
// fake clock
const makeClock = () => {
  let t = 1000;
  const timers = [];
  return {
    now: () => t,
    _advance: (ms) => { t += ms; },
    setTimeout: (cb, ms) => { const id = { cb, ms, fireAt: t + ms }; timers.push(id); return id; },
    clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    _fireDue: () => { const due = timers.filter(x => x.fireAt <= t); for (const x of due) { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); x.cb(); } return due.length; },
    _nextTimeout: () => timers.length > 0 ? Math.min(...timers.map(x => x.fireAt - t)) : null,
  };
};

// one-shot
let fires = [];
const clk1 = makeClock();
const sched1 = createScheduler(clk1, async (entry) => { fires.push({ id: entry.id, fire: entry.fires }); });
const oneShotId = sched1.register({ kind: 'one-shot', name: 'once', atMs: 2500 });
check('sched.one-shot pending', sched1.get(oneShotId).status === 'pending');
check('sched.one-shot nextFire', sched1.get(oneShotId).nextFire === 2500);
clk1._advance(1000);
clk1._fireDue();
await new Promise(r => setTimeout(r, 0));
check('sched.one-shot not fired early', fires.length === 0);
clk1._advance(500);  // now at 2500
clk1._fireDue();
await new Promise(r => setTimeout(r, 0));
check('sched.one-shot fired', fires.length === 1 && fires[0].fire === 1);
check('sched.one-shot completed', sched1.get(oneShotId).status === 'completed');

// interval with maxRuns
fires = [];
const clk2 = makeClock();
const sched2 = createScheduler(clk2, async (entry) => { fires.push(entry.fires); });
const intervalId = sched2.register({ kind: 'interval', name: 'every3', intervalMs: 300, maxRuns: 3 });
// fire 3 times
for (let i = 0; i < 3; i++) { clk2._advance(300); clk2._fireDue(); await new Promise(r => setTimeout(r, 0)); }
check('sched.interval maxRuns stops', fires.length === 3 && fires[2] === 3);
check('sched.interval completed', sched2.get(intervalId).status === 'completed');

// interval unlimited (cancel manually)
fires = [];
const clk3 = makeClock();
const sched3 = createScheduler(clk3, async (entry) => { fires.push(entry.fires); });
const unlimId = sched3.register({ kind: 'interval', name: 'unlim', intervalMs: 100 });
clk3._advance(100); clk3._fireDue(); await new Promise(r => setTimeout(r, 0));
clk3._advance(100); clk3._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.interval fires repeatedly', fires.length === 2);
sched3.cancel(unlimId);
check('sched.cancel sets status', sched3.get(unlimId).status === 'cancelled');
clk3._advance(100); clk3._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.cancel stops fires', fires.length === 2);

// cancelAll
fires = [];
const clk4 = makeClock();
const sched4 = createScheduler(clk4, async () => { fires.push(1); });
sched4.register({ kind: 'interval', name: 'a', intervalMs: 50 });
sched4.register({ kind: 'interval', name: 'b', intervalMs: 50 });
check('sched.cancelAll before fire', sched4.list().length === 2);
sched4.cancelAll();
clk4._advance(100); clk4._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.cancelAll stops all', fires.length === 0);
check('sched.cancelAll all cancelled', sched4.list().every(e => e.status === 'cancelled'));

// deadline auto-cancel
fires = [];
const clk5 = makeClock();
const sched5 = createScheduler(clk5, async () => { fires.push(1); });
const dlId = sched5.register({ kind: 'interval', name: 'dl', intervalMs: 100, deadlineMs: 1500 });
// fire under deadline
clk5._advance(100); clk5._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.deadline fires before', fires.length === 1);
// advance past deadline
clk5._advance(1100);  // now at 2200, past 1500
clk5._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.deadline exceeded', sched5.get(dlId).status === 'deadline-exceeded');
check('sched.deadline no more fires', fires.length === 1);

// task error → failed status
const clk6 = makeClock();
const sched6 = createScheduler(clk6, async () => { throw new Error('boom'); });
const errId = sched6.register({ kind: 'one-shot', name: 'err', atMs: 500 });
clk6._advance(500); clk6._fireDue(); await new Promise(r => setTimeout(r, 0));
check('sched.task error → failed', sched6.get(errId).status === 'failed');
check('sched.task error recorded', sched6.get(errId).lastError === 'boom');

// list includes all
const clk7 = makeClock();
const sched7 = createScheduler(clk7, async () => {});
sched7.register({ kind: 'one-shot', name: 'a', atMs: 100000 });
sched7.register({ kind: 'interval', name: 'b', intervalMs: 1000 });
check('sched.list returns all', sched7.list().length === 2);

// duplicate id rejected
const clk8 = makeClock();
const sched8 = createScheduler(clk8, async () => {});
sched8.register({ id: 'dup', kind: 'one-shot', name: 'first', atMs: 100000 });
let schedDupThrew = false;
try { sched8.register({ id: 'dup', kind: 'one-shot', name: 'second', atMs: 100000 }); } catch { schedDupThrew = true; }
check('sched.duplicate id rejected', schedDupThrew);

// === CRON PARSER ===
// every minute
const baseDate = new Date('2024-06-15T10:30:00Z');
const everyMin = nextCronFire('* * * * *', baseDate.getTime());
check('cron.every minute', new Date(everyMin).getUTCMinutes() === 31 && new Date(everyMin).getUTCHours() === 10);

// every 5 minutes
const every5 = nextCronFire('*/5 * * * *', new Date('2024-06-15T10:32:00Z').getTime());
check('cron.every 5 min', new Date(every5).getUTCMinutes() === 35);

// hour 15
const atHour = nextCronFire('0 15 * * *', new Date('2024-06-15T10:30:00Z').getTime());
check('cron.at hour 15', new Date(atHour).getUTCHours() === 15 && new Date(atHour).getUTCMinutes() === 0);

// comma list
const comma = nextCronFire('0,30 * * * *', new Date('2024-06-15T10:15:00Z').getTime());
check('cron.comma list', new Date(comma).getUTCMinutes() === 30);

// nextFire dispatch
check('nextFire interval', nextFire({ kind: 'interval', name: 'x', intervalMs: 5000 }, 1000) === 6000);
check('nextFire one-shot', nextFire({ kind: 'one-shot', name: 'x', atMs: 9999 }, 1000) === 9999);

// invalid cron (4 fields)
let cronErr = false;
try { nextCronFire('* * * *', 1000); } catch { cronErr = true; }
check('cron.invalid field count rejected', cronErr);

// ---- queue + task-store (Sprint 5.1) -------------------------------
// === WorkQueue state machine ===
const fakeClock5a = (() => { let t = 1000; return { now: () => t, _tick: (ms) => { t += ms; } }; })();
const q = createWorkQueue(fakeClock5a);

// add items
const idA = q.addItem({ name: 'A', priority: 0 });
const idB = q.addItem({ name: 'B', priority: 1, dependsOn: [idA] });
const idC = q.addItem({ name: 'C', priority: 2, dependsOn: [idB] });
check('queue.addItem returns id', idA === 1 && idB === 2 && idC === 3);
check('queue.item A pending→next (no deps)', q.getItem(idA).status === 'next');
check('queue.item B blocked (dep on A)', q.getItem(idB).status === 'blocked');
check('queue.item C blocked (transitive)', q.getItem(idC).status === 'blocked');

// checkDependencies
const depsB = q.checkDependencies(idB);
check('queue.checkDependencies B not met', depsB.met === false && depsB.pending.includes(idA));

// getReadyItems returns A (status next, priority 0)
const ready1 = q.getReadyItems(5);
check('queue.getReadyItems returns A', ready1.length === 1 && ready1[0].name === 'A');
check('queue.getReadyItems moves to now', q.getItem(idA).status === 'now');

// complete A → B should advance blocked→next
q.complete(idA, 'result A');
check('queue.complete A done', q.getItem(idA).status === 'done' && q.getItem(idA).result === 'result A');
check('queue.complete A advances B', q.getItem(idB).status === 'next');
check('queue.complete A leaves C blocked (B not done)', q.getItem(idC).status === 'blocked');

// claim next gets B
const claimed = q.claimNext();
check('queue.claimNext returns B', claimed.name === 'B');
q.complete(idB, 'result B');
check('queue.complete B advances C', q.getItem(idC).status === 'next');

// fail an item
const idD = q.addItem({ name: 'D', priority: 3 });
q.fail(idD, 'boom');
check('queue.fail sets failed+error', q.getItem(idD).status === 'failed' && q.getItem(idD).error === 'boom');

// overdue detection
fakeClock5a._tick(50000);
  Object.assign(ctx, { makeDispatcher, disp1, wf1, res1, disp2, wf2, res2, disp3, wf3, res3, disp4, wf4, res4, disp5, wf5, res5, disp6, wf6, res6, disp7, wf7, res7, disp8, wf8, res8, logs, disp9, wf9, disp10, wf10, res10, makeClock, fires, clk1, sched1, oneShotId, clk2, sched2, intervalId, clk3, sched3, unlimId, clk4, sched4, clk5, sched5, dlId, clk6, sched6, errId, clk7, sched7, clk8, sched8, schedDupThrew, baseDate, everyMin, every5, atHour, comma, cronErr, fakeClock5a, q, idA, idB, idC, depsB, ready1, claimed, idD });
}
