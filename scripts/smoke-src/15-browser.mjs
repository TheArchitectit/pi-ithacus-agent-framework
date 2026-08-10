import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { r2, bc, result, r1 } = ctx;

// ---- browser (Sprint 4.2) ---------------------------------------------
// Wrapped in an awaited async IIFE to isolate identifiers (avoid collisions
// with existing top-level smoke vars like `bc`).
await (async () => {
// Mock driver for network-free testing.
const makeBrowserDriver = (handlers) => {
  const tabs = new Map();
  let stealthEvents = [];
  let stealthOn = false;
  let tabCounter = 0;
  return {
    newTab: async (url, opts) => {
      const id = `tab-${++tabCounter}`;
      const tab = { id, url, title: `Tab ${tabCounter}`, active: true, createdAt: Date.now() };
      tabs.set(id, tab);
      return tab;
    },
    closeTab: async (id) => { tabs.delete(id); },
    listTabs: async () => [...tabs.values()],
    goto: async (id, url) => { const t = tabs.get(id); if (t) { t.url = url; } return t; },
    evaluate: async (id, script) => handlers.evaluate ? handlers.evaluate(id, script) : { ok: true, value: 'eval-result', ts: Date.now() },
    screenshot: async (id, opts) => ({ data: 'base64data', encoding: opts?.encoding ?? 'binary', width: 800, height: 600, ts: Date.now() }),
    click: async (id, sel) => true,
    type: async (id, sel, txt, opts) => true,
    snapshot: async (id, sel) => handlers.snapshot ? handlers.snapshot(sel) : { tagName: 'div', text: 'hi', html: '<div>hi</div>', attributes: { class: 'x' }, isVisible: true },
    enableStealth: async (id) => { stealthOn = true; stealthEvents = []; },
    disableStealth: async (id) => { stealthOn = false; const ev = stealthEvents; stealthEvents = []; return ev; },
    isReady: () => true,
    _injectStealthEvent: (ev) => { if (stealthOn) stealthEvents.push(ev); },
    _tabs: tabs,
  };
};

let cellCounter = 0;
const makeEvalRuntime = (handlers) => {
  const cells = new Map();
  const state = new Map();
  return {
    startCell: async (runtime, code) => {
      const id = `cell-${++cellCounter}`;
      const cell = { id, runtime, code, persistent: true, createdAt: Date.now() };
      cells.set(id, cell);
      return cell;
    },
    runCell: async (cellId, code) => {
      const cell = cells.get(cellId);
      if (!cell) throw new Error('not found');
      return handlers.runCell ? handlers.runCell(cellId, code, state) : { cellId, stdout: 'ok', stderr: '', exitCode: 0, returnValue: null, durationMs: 1, ts: Date.now() };
    },
    stopCell: async (cellId) => { cells.delete(cellId); state.delete(cellId); },
    listCells: async () => [...cells.values()],
    callTool: async (cellId, tool, args) => handlers.callTool ? handlers.callTool(cellId, tool, args) : { tool, args },
    _cells: cells, _state: state,
  };
};

// browser client basics
const bc = createBrowserClient(makeBrowserDriver({}));
const tab = await bc.open('https://example.com');
check('browser.open returns tab', tab.id.startsWith('tab-') && tab.url === 'https://example.com');
check('browser.isReady', bc.isReady() === true);

const tab2 = await bc.open('https://other.com');
const tabs = await bc.tabs();
check('browser.tabs lists', tabs.length === 2);

const navigated = await bc.goto(tab.id, 'https://example.com/page2');
check('browser.goto updates url', navigated.url === 'https://example.com/page2');

const evalRes = await bc.evaluate(tab.id, 'document.title');
check('browser.evaluate returns EvalResult', evalRes.ok === true && evalRes.value === 'eval-result');

const shot = await bc.screenshot(tab.id, { encoding: 'base64' });
check('browser.screenshot returns data', shot.encoding === 'base64' && shot.data === 'base64data');
check('browser.screenshot dimensions', shot.width === 800 && shot.height === 600);

const clicked = await bc.click(tab.id, css('#btn'));
check('browser.click returns bool', clicked === true);

const typed = await bc.type(tab.id, css('#input'), 'hello', { delay: 10 });
check('browser.type returns bool', typed === true);

const snap = await bc.snapshot(tab.id, css('.container'));
check('browser.snapshot returns element', snap?.tagName === 'div' && snap.text === 'hi');

// null snapshot (element not found)
const nullDriver = makeBrowserDriver({ snapshot: () => null });
const nullSnap = await createBrowserClient(nullDriver).snapshot('x', css('.none'));
check('browser.snapshot null when not found', nullSnap === null);

// selector helpers
check('browser.css helper', JSON.stringify(css('#a')) === JSON.stringify({ strategy: 'css', value: '#a' }));
check('browser.xpath helper', xpath('//div').strategy === 'xpath');
check('browser.text helper', text('hello').strategy === 'text');

// stealth mode
const stealthDriver = makeBrowserDriver({});
const stealthClient = createBrowserClient(stealthDriver);
await stealthClient.enableStealth(tab.id);
stealthDriver._injectStealthEvent({ method: 'GET', url: 'https://x.com/a', status: 200, resourceType: 'document', ts: Date.now() });
stealthDriver._injectStealthEvent({ method: 'POST', url: 'https://x.com/b', status: 404, resourceType: 'xhr', ts: Date.now() });
const events = await stealthClient.disableStealth(tab.id);
check('browser.disableStealth returns events', events.length === 2);
check('browser.stealth event method', events[0].method === 'GET');

// stealth unsupported throws
const noStealthDriver = { newTab: async () => ({ id: 't', url: '', title: '', active: false, createdAt: 0 }), closeTab: async () => {}, listTabs: async () => [], goto: async () => ({ id: 't', url: '', title: '', active: false, createdAt: 0 }), evaluate: async () => ({ ok: true, value: null, ts: 0 }), screenshot: async () => ({ data: '', encoding: 'binary', width: 0, height: 0, ts: 0 }), click: async () => false, type: async () => false, snapshot: async () => null };
const noStealthClient = createBrowserClient(noStealthDriver);
let stealthThrew = false;
try { await noStealthClient.enableStealth('t'); } catch { stealthThrew = true; }
check('browser.enableStealth throws when unsupported', stealthThrew === true);

// close tab
await bc.close(tab.id);
check('browser.close removes tab', (await bc.tabs()).length === 1);

// ---- eval (Sprint 4.2) ------------------------------------------------
const ec = createEvalClient(makeEvalRuntime({}));
const cell = await ec.start('python', 'x = 1');
check('eval.start returns cell', cell.id.startsWith('cell-') && cell.runtime === 'python');
check('eval.has tracked', ec.has(cell.id) === true);
check('eval.has untracked', ec.has('cell-nonexistent') === false);

const result = await ec.run(cell.id, 'x + 1');
check('eval.run returns result', result.cellId === cell.id && result.exitCode === 0);

// run throws on unknown cell
let evalThrew = false;
try { await ec.run('cell-unknown'); } catch { evalThrew = true; }
check('eval.run throws unknown cell', evalThrew === true);

// callTool
const toolResult = await ec.callTool(cell.id, 'rg', { pattern: 'foo' });
check('eval.callTool returns tool result', toolResult.tool === 'rg' && toolResult.args.pattern === 'foo');

// callTool throws on unknown cell
let toolThrew = false;
try { await ec.callTool('cell-x', 'rg', {}); } catch { toolThrew = true; }
check('eval.callTool throws unknown cell', toolThrew === true);

// list
const cell2 = await ec.start('bun', 'console.log("hi")');
check('eval.list tracks multiple', ec.list().length === 2);
check('eval.list bun runtime', ec.list().some(c => c.runtime === 'bun'));

// persistent state across runs
const stateful = createEvalClient(makeEvalRuntime({
  runCell: (cellId, code, state) => {
    const cur = (state.get('counter') ?? 0);
    state.set('counter', cur + 1);
    return { cellId, stdout: `run ${cur + 1}`, stderr: '', exitCode: 0, returnValue: cur + 1, durationMs: 1, ts: Date.now() };
  },
}));
const sc = await stateful.start('python', 'counter');
const r1 = await stateful.run(sc.id);
const r2 = await stateful.run(sc.id);
check('eval persistent state increments', r1.returnValue === 1 && r2.returnValue === 2);

// stop + stopAll
await ec.stop(cell.id);
check('eval.stop removes cell', ec.has(cell.id) === false);
await ec.stopAll();
check('eval.stopAll clears', ec.list().length === 0);
})(); // end Sprint 4.2 IIFE
}
