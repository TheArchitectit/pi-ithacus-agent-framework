import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { h } = ctx;

// ---- trim preserveHeadTail (Sprint 3.2) --------------------------------
const trimMessages = [
  { content: 'intro text' },
  { content: '## Heading\nbody' }, // complete heading
  { content: 'plain paragraph' },
  { content: '```js\nconst x = 1;\n```' }, // closed fence
];
// No boundary conflict: headings and fences are complete within messages.
check('trim.detectBoundaryConflict clean', trim.detectBoundaryConflict(trimMessages, 1, 3) === false);
check('trim.preserveHeadTail no conflict', trim.preserveHeadTail(trimMessages, 1, 3).preserve === false);

// Unclosed fence: single backtick block with no closing
const unclosedFence = [{ content: '```js\nconst x = 1;' }];
check('trim.detectBoundaryConflict unclosed fence', trim.detectBoundaryConflict(unclosedFence, 0, 1) === true);
check('trim.preserveHeadTail fence conflict', trim.preserveHeadTail(unclosedFence, 0, 1).preserve === true);

// Heading line alone (starts with #, no newline → orphaned)
const orphanedHeading = [{ content: '## Orphaned Heading' }];
check('trim.detectBoundaryConflict orphaned heading', trim.detectBoundaryConflict(orphanedHeading, 0, 1) === true);

// Closed fence (``` start and ``` end within message)
const closedFence = [{ content: '```js\ncode\n```\nmore text' }];
check('trim.detectBoundaryConflict closed fence', trim.detectBoundaryConflict(closedFence, 0, 1) === false);

// ---- plugins (Sprint 3.2) ---------------------------------------------
const plugReg = pluginsMod.createPluginRegistry();
const testPlugin = {
  id: 'context-injector',
  name: 'Context Injector',
  hooks: ['preSpawn', 'postSpawn'],
  injectContext: ({ agentId }) => `[plugin] Context for ${agentId}`,
};
plugReg.register(testPlugin);
check('plugins.list', plugReg.list().length === 1);
check('plugins.forHook preSpawn', plugReg.forHook('preSpawn').length === 1);
check('plugins.forHook postSpawn', plugReg.forHook('postSpawn').length === 1);
check('plugins.forHook empty', plugReg.forHook('onTurnEnd').length === 0);

const injected = plugReg.injectContext('preSpawn', { agentId: 'a1', runId: 'r1' });
check('plugins.injectContext returns text', injected.includes('Context for a1'));

const spawnCtx = plugReg.onAgentSpawn('a2', 'r1');
check('plugins.onAgentSpawn', spawnCtx.includes('Context for a2'));

// empty hook
const emptyPlug = pluginsMod.createPluginRegistry();
check('plugins.injectContext empty', emptyPlug.injectContext('preSpawn', { agentId: 'x', runId: 'y' }) === '');

// unregister
plugReg.unregister('context-injector');
check('plugins.unregister', plugReg.list().length === 0);
check('plugins.unregister removes from hooks', plugReg.forHook('preSpawn').length === 0);

// plugin without injectContext
const noInjectPlugin = { id: 'no-inject', name: 'NoInject', hooks: ['preSpawn'] };
plugReg.register(noInjectPlugin);
check('plugins.no injectContext empty', plugReg.injectContext('preSpawn', { agentId: 'z', runId: 'r' }) === '');

plugReg.clear();
check('plugins.clear', plugReg.list().length === 0);

// ---- lsp (Sprint 4.1) -------------------------------------------------
// Mock transport for network-free testing (mirrors the search.ts mockFetch pattern).
const makeLspTransport = (handlers) => {
  const notifyLog = [];
  return {
    request: async (method, params) => {
      const h = handlers[method];
      if (method === 'initialize' && !h) return { capabilities: {} };
      if (!h) throw new Error(`mock: no handler for ${method}`);
      return h(params);
    },
    notify: (method, params) => { notifyLog.push({ method, params }); },
    isReady: () => true,
    _notifyLog: notifyLog,
  };
};

const doc = { uri: 'file:///src/foo.ts' };
const pos = { line: 5, character: 10 };
const range = { start: { line: 5, character: 8 }, end: { line: 5, character: 14 } };

// initialize + capabilities
const initT = makeLspTransport({
  initialize: () => ({ capabilities: { completionProvider: true, renameProvider: true } }),
});
const initClient = createLspClient(initT);
const caps = await initClient.initialize('file:///repo');
check('lsp.initialize returns capabilities', caps.completionProvider === true);
check('lsp.initialize sends initialized notify', initT._notifyLog.some(n => n.method === 'initialized'));

// openDocument + didOpen notify
const client = createLspClient(makeLspTransport({ initialize: () => ({ capabilities: {} }) }));
await client.initialize('file:///repo');
client.openDocument({ uri: doc.uri, languageId: 'typescript', version: 1, text: 'const x = 1;' });
check('lsp.openDocument tracks doc', client.isOpen(doc.uri) === true);
check('lsp.openDocument not open before', client.isOpen('file:///other.ts') === false);

// changeDocument throws if not open
let changeThrew = false;
try { client.changeDocument('file:///notopen.ts', 2, 'x'); }
catch { changeThrew = true; }
check('lsp.changeDocument throws if not open', changeThrew === true);

// changeDocument on open doc updates version + text
check('lsp.changeDocument updates without throwing when doc open', (() => { try { client.changeDocument(doc.uri, 2, 'const x = 2;'); client.changeDocument(doc.uri, 3, 'z'); return client.isOpen(doc.uri); } catch { return false; } })());

// closeDocument
client.closeDocument(doc.uri);
check('lsp.closeDocument removes from open set', client.isOpen(doc.uri) === false);

// 1. diagnostics
const diagClient = createLspClient(makeLspTransport({ 'textDocument/diagnostic': () => ({ items: [{ range, severity: 'error', message: 'oops' }] }) }));
await diagClient.initialize('r');
const diags = await diagClient.diagnostics(doc);
check('lsp.diagnostics returns items', diags.length === 1);
check('lsp.diagnostics severity', diags[0].severity === 'error');
check('lsp.diagnostics message', diags[0].message === 'oops');

// diagnostics empty
const diagEmptyClient = createLspClient(makeLspTransport({ 'textDocument/diagnostic': () => ({ items: [] }) }));
await diagEmptyClient.initialize('r');
check('lsp.diagnostics empty', (await diagEmptyClient.diagnostics(doc)).length === 0);

// 2. definition (single Location)
const defClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => ({ uri: doc.uri, range }) }));
await defClient.initialize('r');
const defs = await defClient.definition(doc, pos);
check('lsp.definition single wrapped in array', defs.length === 1 && defs[0].uri === doc.uri);

// definition array
const defArrClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => [{ uri: 'file:///a.ts', range }, { uri: 'file:///b.ts', range }] }));
await defArrClient.initialize('r');
const defsArr = await defArrClient.definition(doc, pos);
check('lsp.definition array passed through', defsArr.length === 2);

// definition null
const defNullClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => null }));
await defNullClient.initialize('r');
check('lsp.definition null -> empty', (await defNullClient.definition(doc, pos)).length === 0);

// definition LocationLink normalization (P3 fix)
const linkClient = createLspClient(makeLspTransport({ 'textDocument/definition': () => ({ targetUri: 'file:///target.ts', targetRange: range }) }));
await linkClient.initialize('r');
const links = await linkClient.definition(doc, pos);
check('lsp.definition normalizes LocationLink', links.length === 1 && links[0].uri === 'file:///target.ts' && links[0].range === range);

// 3. references
const refClient = createLspClient(makeLspTransport({ 'textDocument/references': () => [{ uri: doc.uri, range }, { uri: 'file:///other.ts', range }] }));
await refClient.initialize('r');
const refs = await refClient.references(doc, pos, true);
check('lsp.references returns list', refs.length === 2);

// 4. rename — spec-compliant WorkspaceEdit shape
const renClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => ({ changes: { [doc.uri]: [{ range, newText: 'newName' }] } }) }));
await renClient.initialize('r');
const renames = await renClient.rename(doc, pos, 'newName');
check('lsp.rename returns edits from changes map', renames.length === 1 && renames[0].newText === 'newName');

// rename with documentChanges
const renDCClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => ({ documentChanges: [{ textDocument: { uri: doc.uri }, edits: [{ range, newText: 'alias' }] }] }) }));
await renDCClient.initialize('r');
const renDC = await renDCClient.rename(doc, pos, 'alias');
check('lsp.rename flattens documentChanges', renDC.length === 1 && renDC[0].newText === 'alias');

// rename empty WorkspaceEdit
const renEmptyClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => ({}) }));
await renEmptyClient.initialize('r');
check('lsp.rename empty WorkspaceEdit → []', (await renEmptyClient.rename(doc, pos, 'x')).length === 0);

// rename null
const renNullClient = createLspClient(makeLspTransport({ 'textDocument/rename': () => null }));
await renNullClient.initialize('r');
check('lsp.rename null → []', (await renNullClient.rename(doc, pos, 'x')).length === 0);

// 5. codeAction
const caClient = createLspClient(makeLspTransport({ 'textDocument/codeAction': () => [{ title: 'Fix typo', kind: 'quickfix' }] }));
await caClient.initialize('r');
const cas = await caClient.codeAction(doc, range);
check('lsp.codeAction returns list', cas.length === 1 && cas[0].title === 'Fix typo');

// codeAction empty
const caEmpty = createLspClient(makeLspTransport({ 'textDocument/codeAction': () => null }));
await caEmpty.initialize('r');
check('lsp.codeAction null -> empty', (await caEmpty.codeAction(doc, range)).length === 0);

// 6. workspaceSymbols
const wsClient = createLspClient(makeLspTransport({ 'workspace/symbol': () => [{ name: 'Foo', kind: 12, range }] }));
await wsClient.initialize('r');
const syms = await wsClient.workspaceSymbols('Foo');
check('lsp.workspaceSymbols returns list', syms.length === 1 && syms[0].name === 'Foo');

// 7. documentSymbol
const dsClient = createLspClient(makeLspTransport({ 'textDocument/documentSymbol': () => [{ name: 'myFunc', kind: 12, range }] }));
await dsClient.initialize('r');
const docSyms = await dsClient.documentSymbol(doc);
check('lsp.documentSymbol returns list', docSyms.length === 1 && docSyms[0].name === 'myFunc');

// 8. hover
const hovClient = createLspClient(makeLspTransport({ 'textDocument/hover': () => ({ contents: 'string hover' }) }));
await hovClient.initialize('r');
const hov = await hovClient.hover(doc, pos);
check('lsp.hover returns contents', hov !== null && hov.contents === 'string hover');

// hover null
const hovNull = createLspClient(makeLspTransport({ 'textDocument/hover': () => null }));
await hovNull.initialize('r');
check('lsp.hover null -> null', await hovNull.hover(doc, pos) === null);

// 9. signatureHelp
const sigClient = createLspClient(makeLspTransport({ 'textDocument/signatureHelp': () => ({ signatures: [{ label: 'foo(a, b)' }], activeSignature: 0 }) }));
await sigClient.initialize('r');
const sig = await sigClient.signatureHelp(doc, pos);
check('lsp.signatureHelp returns signatures', sig !== null && sig.signatures.length === 1);

// 10. formatting
const fmtClient = createLspClient(makeLspTransport({ 'textDocument/formatting': () => [{ range, newText: 'formatted' }] }));
await fmtClient.initialize('r');
const fmts = await fmtClient.formatting(doc);
check('lsp.formatting returns edits', fmts.length === 1 && fmts[0].newText === 'formatted');

// 11. foldingRange
const foldClient = createLspClient(makeLspTransport({ 'textDocument/foldingRange': () => [{ startLine: 0, endLine: 5, kind: 'region' }] }));
await foldClient.initialize('r');
const folds = await foldClient.foldingRange(doc);
check('lsp.foldingRange returns ranges', folds.length === 1 && folds[0].endLine === 5);

// 12. selectionRange
const selClient = createLspClient(makeLspTransport({ 'textDocument/selectionRange': () => [{ range }] }));
await selClient.initialize('r');
const sels = await selClient.selectionRange(doc, [pos]);
check('lsp.selectionRange returns ranges', sels.length === 1);

// 13. linkedEditingRange
const linkedClient = createLspClient(makeLspTransport({ 'textDocument/linkedEditingRange': () => ({ ranges: [range], wordPattern: '\\w+' }) }));
await linkedClient.initialize('r');
const linked = await linkedClient.linkedEditingRange(doc, pos);
check('lsp.linkedEditingRange returns ranges', linked !== null && linked.ranges.length === 1);

// linkedEditingRange null
const linkedNull = createLspClient(makeLspTransport({ 'textDocument/linkedEditingRange': () => null }));
await linkedNull.initialize('r');
check('lsp.linkedEditingRange null -> null', await linkedNull.linkedEditingRange(doc, pos) === null);

// 14. semanticTokensFull
const semClient = createLspClient(makeLspTransport({ 'textDocument/semanticTokens/full': () => ({ data: [0, 0, 5, 1, 0] }) }));
await semClient.initialize('r');
const sem = await semClient.semanticTokensFull(doc);
check('lsp.semanticTokensFull returns data', sem.data.length === 5 && sem.data[2] === 5);

// semanticTokensFull null fallback
const semNullClient = createLspClient(makeLspTransport({ 'textDocument/semanticTokens/full': () => null }));
await semNullClient.initialize('r');
const semNull = await semNullClient.semanticTokensFull(doc);
check('lsp.semanticTokensFull null -> empty data', semNull.data.length === 0);

// shutdown clears open docs
const shutdownClient = createLspClient(makeLspTransport({ initialize: () => ({}), shutdown: () => null }));
await shutdownClient.initialize('r');
shutdownClient.openDocument({ uri: doc.uri, languageId: 'ts', version: 1, text: 'x' });
check('lsp.shutdown precondition: doc open', shutdownClient.isOpen(doc.uri) === true);
await shutdownClient.shutdown();
check('lsp.shutdown clears open docs', shutdownClient.isOpen(doc.uri) === false);

// transport error propagates
const errClient = createLspClient(makeLspTransport({ initialize: () => ({}), 'textDocument/hover': () => { throw new Error('server down'); } }));
await errClient.initialize('r');
let errThrew = false;
try { await errClient.hover(doc, pos); }
catch (e) { errThrew = e.message === 'server down'; }
check('lsp.transport error propagates', errThrew === true);
  Object.assign(ctx, { trimMessages, unclosedFence, orphanedHeading, closedFence, plugReg, testPlugin, injected, spawnCtx, emptyPlug, noInjectPlugin, makeLspTransport, doc, pos, range, initT, initClient, caps, client, changeThrew, diagClient, diags, diagEmptyClient, defClient, defs, defArrClient, defsArr, defNullClient, linkClient, links, refClient, refs, renClient, renames, renDCClient, renDC, renEmptyClient, renNullClient, caClient, cas, caEmpty, wsClient, syms, dsClient, docSyms, hovClient, hov, hovNull, sigClient, sig, fmtClient, fmts, foldClient, folds, selClient, sels, linkedClient, linked, linkedNull, semClient, sem, semNullClient, semNull, shutdownClient, errClient, errThrew });
}
