import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { summary, h, chainResult, initT, caps } = ctx;

// ---- dap + ast + goal-loops (Sprint 4.4) -----------------------------
await (async () => {
  // ---- DAP ----
  const makeDapTransport = (handlers) => {
    const subs = new Map();
    return {
      request: async (command, args) => {
        const h = handlers[command];
        if (!h) throw new Error(`mock: no handler for ${command}`);
        return h(args);
      },
      on: (event, handler) => {
        if (!subs.has(event)) subs.set(event, []);
        subs.get(event).push(handler);
        return () => subs.set(event, subs.get(event).filter(h => h !== handler));
      },
      isReady: () => true,
      _emit: (event, body) => (subs.get(event) ?? []).forEach(h => h(body)),
    };
  };

  // lifecycle
  const initT = makeDapTransport({
    initialize: () => ({ supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true }),
    launch: () => ({}),
  });
  const dc = createDapClient(initT);
  const caps = await dc.initialize('node');
  check('dap.initialize returns capabilities', caps.supportsConfigurationDoneRequest === true);
  await dc.launch('app.js', ['--flag'], { cwd: '/repo' });
  check('dap.launch called without error', true);

  // setBreakpoints
  const bpT = makeDapTransport({
    setBreakpoints: (args) => ({ breakpoints: args.breakpoints.map((bp, i) => ({ id: i, verified: true, source: args.source.path, line: bp.line })) }),
  });
  const bpClient = createDapClient(bpT);
  const bps = await bpClient.setBreakpoints('/src/foo.ts', [{ line: 10 }, { line: 20, condition: 'x > 5' }]);
  check('dap.setBreakpoints returns verified', bps.length === 2 && bps[0].verified === true);
  check('dap.setBreakpoints line', bps[1].line === 20);

  // threads + stackTrace
  const stkT = makeDapTransport({
    threads: () => ({ threads: [{ id: 1, name: 'main' }, { id: 2, name: 'worker' }] }),
    stackTrace: () => ({ stackFrames: [{ id: 1, name: 'foo', source: '/src/foo.ts', line: 10, column: 3 }] }),
    scopes: () => ({ scopes: [{ name: 'Local', variablesReference: 100, expensive: false }] }),
    variables: () => ({ variables: [{ name: 'x', value: '42', type: 'number', variablesReference: 0 }] }),
  });
  const stkClient = createDapClient(stkT);
  const threads = await stkClient.threads();
  check('dap.threads returns list', threads.length === 2 && threads[0].name === 'main');
  const frames = await stkClient.stackTrace(1);
  check('dap.stackTrace returns frames', frames.length === 1 && frames[0].name === 'foo');
  const scopes = await stkClient.scopes(1);
  check('dap.scopes returns scopes', scopes.length === 1 && scopes[0].name === 'Local');
  const vars = await stkClient.variables(100);
  check('dap.variables returns vars', vars.length === 1 && vars[0].value === '42');

  // evaluate
  const evalT = makeDapTransport({ evaluate: (args) => ({ name: args.expression, value: 'result', type: 'string', variablesReference: 0 }) });
  const evalClient = createDapClient(evalT);
  const ev = await evalClient.evaluate('2 + 2', undefined, 'repl');
  check('dap.evaluate returns variable', ev.value === 'result' && ev.name === '2 + 2');

  // stepping ops (just verify they don't throw)
  const stepT = makeDapTransport({ continue: () => ({}), next: () => ({}), stepIn: () => ({}), stepOut: () => ({}), stepBack: () => ({}), pause: () => ({}), restartFrame: () => ({}), configurationDone: () => ({}), disconnect: () => ({}), terminate: () => ({}), restart: () => ({}), goto: () => ({}), setExceptionBreakpoints: () => ({}), setFunctionBreakpoints: (a) => ({ breakpoints: a.breakpoints.map((_, i) => ({ id: i, verified: true, source: 'fn', line: 0 })) }) });
  const stepClient = createDapClient(stepT);
  await stepClient.configurationDone();
  await stepClient.continue(1);
  await stepClient.pause(1);
  await stepClient.next(1);
  await stepClient.stepIn(1);
  await stepClient.stepOut(1);
  await stepClient.stepBack(1);
  await stepClient.restartFrame(1);
  await stepClient.setExceptionBreakpoints(['all']);
  await stepClient.disconnect(true);
  check('dap.stepping ops no throw', true);

  // attach + terminate + restart + goto
  const attachT = makeDapTransport({ attach: () => ({}), terminate: () => ({}), restart: () => ({}), goto: () => ({}), setFunctionBreakpoints: () => ({ breakpoints: [] }) });
  const attachClient = createDapClient(attachT);
  await attachClient.attach('process.exe', { pid: 1234 });
  await attachClient.terminate();
  await attachClient.restart();
  await attachClient.goto(1, 5);
  const fnBps = await attachClient.setFunctionBreakpoints([{ name: 'main' }]);
  check('dap.setFunctionBreakpoints returns list', fnBps.length === 0);
  check('dap.attach called', true);

  // source + loadedSources + modules + completions
  const srcT = makeDapTransport({
    source: () => ({ content: 'line1\nline2\nline3' }),
    loadedSources: () => ({ sources: [{ name: 'foo', path: '/foo.ts' }] }),
    modules: () => ({ modules: [{ id: 1, name: 'app' }] }),
    completions: () => ({ targets: [{ label: 'console', type: 'function' }] }),
    setVariable: () => ({ name: 'x', value: '99', type: 'number', variablesReference: 0 }),
  });
  const srcClient = createDapClient(srcT);
  const lines = await srcClient.source('/src/foo.ts', 1, 3);
  check('dap.source returns lines', lines.length === 3 && lines[0] === 'line1');
  const loaded = await srcClient.loadedSources();
  check('dap.loadedSources returns list', loaded.length === 1 && loaded[0].path === '/foo.ts');
  const mods = await srcClient.modules();
  check('dap.modules returns list', mods.length === 1 && mods[0].name === 'app');
  const comps = await srcClient.completions('cons', 4);
  check('dap.completions returns list', comps.length === 1 && comps[0].label === 'console');
  const setVar = await srcClient.setVariable('x', '99', 100);
  check('dap.setVariable returns var', setVar.value === '99');

  // events: stopped + terminated + output
  const evT = makeDapTransport({ initialize: () => ({}) });
  const evClient = createDapClient(evT);
  let stoppedEvent = null;
  evClient.onStopped((e) => { stoppedEvent = e; });
  evT._emit('stopped', { reason: 'breakpoint', threadId: 1 });
  check('dap.onStopped receives event', stoppedEvent?.reason === 'breakpoint' && stoppedEvent.threadId === 1);

  let terminatedCalled = false;
  evClient.onTerminated(() => { terminatedCalled = true; });
  evT._emit('terminated', {});
  check('dap.onTerminated fires', terminatedCalled === true);

  let outputReceived = null;
  evClient.onOutput((body) => { outputReceived = body; });
  evT._emit('output', { category: 'stdout', output: 'hello' });
  check('dap.onOutput receives body', outputReceived?.output === 'hello');

  check('dap.isReady default true', evClient.isReady() === true);

  // ---- AST ----
  // simple literal match
  const src = 'const x = 1;\nconst y = 2;\nconst z = 3;';
  const matches = findMatches(src, 'const x = 1;', 'typescript');
  check('ast.findMatches literal', matches.length === 1 && matches[0].text === 'const x = 1;');

  // $$$CAPTURE pattern
  const captureSrc = 'function foo() { return 1; }\nfunction bar() { return 2; }';
  const captureMatches = findMatches(captureSrc, 'function $$$NAME() { return $$$BODY; }', 'typescript');
  check('ast.findMatches with captures', captureMatches.length === 2);
  check('ast.findMatches capture NAME', captureMatches[0].captures.NAME === 'foo');
  check('ast.findMatches capture BODY', captureMatches[0].captures.BODY === '1');
  check('ast.findMatches second match', captureMatches[1].captures.NAME === 'bar');

  // applyRewrite
  const rewriteResult = applyRewrite(captureSrc, {
    pattern: 'function $$$NAME() { return $$$BODY; }',
    replacement: 'const $NAME = () => $BODY;',
    language: 'typescript',
  });
  check('ast.applyRewrite replacements', rewriteResult.replacements === 2);
  check('ast.applyRewrite source', rewriteResult.source.includes('const foo = () => 1;'));
  check('ast.applyRewrite second', rewriteResult.source.includes('const bar = () => 2;'));

  // expandTemplate
  const expandedFixed = expandTemplate('X = $VALUE', { VALUE: '42' });
  check('ast.expandTemplate', expandedFixed === 'X = 42');

  // validateRewrite
  check('ast.validateRewrite valid', validateRewrite({ pattern: 'x', replacement: 'y', language: 'ts' }) === null);
  check('ast.validateRewrite missing pattern', validateRewrite({ pattern: '', replacement: 'y', language: 'ts' })?.includes('pattern'));
  check('ast.validateRewrite missing language', validateRewrite({ pattern: 'x', replacement: 'y', language: '' })?.includes('language'));

  // chainRewrites
  const chainResult = chainRewrites('aaa bbb aaa', [
    { pattern: 'aaa', replacement: 'XXX', language: 'ts' },
    { pattern: 'XXX', replacement: 'YYY', language: 'ts' },
  ]);
  check('ast.chainRewrites applies in order', chainResult.source === 'YYY bbb YYY');
  check('ast.chainRewrites total replacements', chainResult.replacements === 4);

  // no matches
  const noMatch = applyRewrite('hello world', { pattern: 'xxx', replacement: 'yyy', language: 'ts' });
  check('ast.applyRewrite no matches', noMatch.replacements === 0 && noMatch.source === 'hello world');

  // RegexAstMatcher instance
  const matcher = new RegexAstMatcher();
  const m = matcher.findMatches('abc abc', 'abc', 'ts');
  check('ast.RegexAstMatcher instance', m.length === 2);

  // ---- goal-loops ----
  // mock actor + judge: complete after 3 iterations
  const makeActor = (actions) => ({
    propose: async (ctx) => actions[ctx.turn - 1] ?? `action-${ctx.turn}`,
  });
  const makeJudge = (scores, verdicts) => ({
    judge: async (ctx) => ({ verdict: verdicts[ctx.turn - 1] ?? 'continue', reasoning: `score ${ctx.turn}`, score: scores[ctx.turn - 1] ?? 0.5 }),
  });

  const loop = await runGoalLoop({
    goal: 'refactor the auth module',
    maxIterations: 10,
    actor: makeActor(['read file', 'edit file', 'run tests']),
    judge: makeJudge([0.3, 0.6, 0.9], ['continue', 'continue', 'complete']),
  });
  check('goal.runGoalLoop completes', loop.status === 'complete');
  check('goal.runGoalLoop iterations', loop.iterations.length === 3);
  check('goal.runGoalLoop final score', loop.iterations[2].score === 0.9);
  check('goal.runGoalLoop final verdict', loop.iterations[2].verdict === 'complete');
  check('goal.runGoalLoop action turn 1', loop.iterations[0].action === 'read file');

  // threshold-based completion
  const thresholdLoop = await runGoalLoop({
    goal: 'fix bug',
    maxIterations: 5,
    actor: makeActor(['a', 'b']),
    judge: makeJudge([0.85, 0.95], ['continue', 'continue']),
    completeThreshold: 0.8,
  });
  check('goal.threshold complete', thresholdLoop.status === 'complete' && thresholdLoop.iterations.length === 1);

  // max iterations reached (no completion)
  const maxLoop = await runGoalLoop({
    goal: 'impossible',
    maxIterations: 2,
    actor: makeActor(['a', 'b']),
    judge: makeJudge([0.1, 0.2], ['continue', 'continue']),
  });
  check('goal.max iterations → failed', maxLoop.status === 'failed' && maxLoop.iterations.length === 2);

  // explicit failed verdict
  const failLoop = await runGoalLoop({
    goal: 'fails fast',
    maxIterations: 5,
    actor: makeActor(['a']),
    judge: makeJudge([0], ['failed']),
  });
  check('goal.failed verdict', failLoop.status === 'failed' && failLoop.iterations.length === 1);

  // execute callback
  const execLoop = await runGoalLoop({
    goal: 'with execute',
    maxIterations: 5,
    actor: makeActor(['do thing']),
    judge: makeJudge([1.0], ['complete']),
    execute: async (action) => `executed: ${action}`,
  });
  check('goal.execute wraps action', execLoop.iterations[0].action === 'executed: do thing');

  // onIteration callback
  const seen = [];
  const onIterLoop = await runGoalLoop({
    goal: 'with onIter',
    maxIterations: 5,
    actor: makeActor(['a', 'b']),
    judge: makeJudge([0.5, 0.9], ['continue', 'complete']),
    onIteration: (it) => seen.push(it.turn),
  });
  check('goal.onIteration called', seen.length === 2 && seen[0] === 1 && seen[1] === 2);

  // steps (manual planning)
  const manual = createGoalLoop('manual goal', 10);
  const s1 = addStep(manual, 'step one');
  const s2 = addStep(manual, 'step two');
  check('goal.addStep', manual.steps.length === 2);
  check('goal.addStep id', s1.id === 'step-1' && s2.id === 'step-2');

  check('goal.updateStep', updateStep(manual, 'step-1', 'done', 'result-1') === true);
  check('goal.updateStep status', manual.steps[0].status === 'done' && manual.steps[0].result === 'result-1');
  check('goal.updateStep unknown returns false', updateStep(manual, 'nope', 'done') === false);

  stopGoalLoop(manual);
  check('goal.stopGoalLoop', manual.status === 'stopped');

  // summarize
  const summary = summarizeLoop(loop);
  check('goal.summarizeLoop has goal', summary.includes('refactor the auth module'));
  check('goal.summarizeLoop has status', summary.includes('complete'));
  check('goal.summarizeLoop has iterations', summary.includes('Turn 1'));
})();
}
