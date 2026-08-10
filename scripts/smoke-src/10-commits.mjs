import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- commits (Sprint 2.3) ----------------------------------------------
check('commits.classifyFile source', commits.classifyFile('/src/auth.ts') === 'source');
check('commits.classifyFile test', commits.classifyFile('/src/auth.test.ts') === 'test');
check('commits.classifyFile docs', commits.classifyFile('/docs/guide.md') === 'docs');
check('commits.classifyFile config', commits.classifyFile('tsconfig.json') === 'config');
check('commits.classifyFile other', commits.classifyFile('/assets/logo.png') === 'other');

check('commits.fileScore source high', commits.fileScore('/src/a.ts') === 5);
check('commits.fileScore docs low', commits.fileScore('/README.md') === 2);

const changes = [
  { path: 'src/auth.ts', status: 'modified', linesChanged: 20 },
  { path: 'src/auth.test.ts', status: 'modified', linesChanged: 10 },
  { path: 'docs/guide.md', status: 'modified', linesChanged: 5 },
  { path: 'src/utils.ts', status: 'added', linesChanged: 30 },
  { path: 'package.json', status: 'modified', linesChanged: 2 },
];
const atomic = commits.splitAtomicCommits(changes);
const findCommit = (file) => atomic.find(c => c.files.includes(file));
check('commits.splitAtomicCommits groups by dir+cat', atomic.length >= 3);
check('commits.splitAtomicCommits all files covered', atomic.reduce((s, c) => s + c.files.length, 0) === changes.length);
check('commits.splitAtomicCommits assigns ids', atomic.every(c => c.id.startsWith('commit-')));
check('commits.splitAtomicCommits builds messages', atomic.every(c => c.message.length > 0));
check('commits source before tests', findCommit('src/auth.ts').order < findCommit('src/auth.test.ts').order);
check('commits source before docs', findCommit('src/utils.ts').order < findCommit('docs/guide.md').order);
check('commits tests depend on source', findCommit('src/auth.test.ts').dependsOn.length > 0);
check('commits docs depend on source', findCommit('docs/guide.md').dependsOn.length > 0);
check('commits source has no deps', findCommit('src/auth.ts').dependsOn.length === 0);
check('commits order sequential', atomic.every(c => c.order >= 1));

const msg = commits.buildCommitMessage([{ path: 'src/auth.ts', status: 'modified', linesChanged: 10 }], 'source');
check('commits.buildCommitMessage source feat', msg.startsWith('feat(src):'));
const testMsg = commits.buildCommitMessage([{ path: 'src/auth.test.ts', status: 'added', linesChanged: 5 }], 'test');
check('commits.buildCommitMessage test type', testMsg.startsWith('test(src):'));

check('commits.analyzeWorkingTree convenience', commits.analyzeWorkingTree(changes).length === atomic.length);
check('commits.splitAtomicCommits empty', commits.splitAtomicCommits([]).length === 0);

// ---- hindsight (Sprint 3.1) ---------------------------------------------
const storeH = new IthStore(tmpRepo, cfg.loadConfig());
const hStore = new HindsightStore(storeH.db);

const e1 = hindsight.retain(hStore, { repoId: 'repo-x', agentId: 'a1', runId: 'r1', kind: 'decision', text: 'Use SQLite for all persistence', relevance: 0.9 });
check('hindsight.retain returns entry', e1.id.startsWith('hindsight-'));
check('hindsight.retain clamps relevance', e1.relevance === 0.9);

const e2 = hindsight.retain(hStore, { repoId: 'repo-x', agentId: 'a2', runId: 'r1', kind: 'fact', text: 'Auth module has SQL injection risk', relevance: 0.7 });
const e3 = hindsight.retain(hStore, { repoId: 'repo-x', agentId: 'a1', runId: 'r1', kind: 'preference', text: 'Prefer const over let', relevance: 0.3 });

const recalled = hindsight.recall(hStore, 'repo-x');
check('hindsight.recall returns entries', recalled.length === 3);
check('hindsight.recall sorted by relevance desc', recalled[0].relevance >= recalled[1].relevance && recalled[1].relevance >= recalled[2].relevance);
check('hindsight.recall top is 0.9', recalled[0].relevance === 0.9);

const recalledKind = hindsight.recall(hStore, 'repo-x', { kind: 'decision' });
check('hindsight.recall filters by kind', recalledKind.length === 1 && recalledKind[0].text.includes('SQLite'));

const recalledMinRel = hindsight.recall(hStore, 'repo-x', { minRelevance: 0.5 });
check('hindsight.recall minRelevance filter', recalledMinRel.length === 2);

const recalledLimit = hindsight.recall(hStore, 'repo-x', { limit: 1 });
check('hindsight.recall limit', recalledLimit.length === 1);

// relevance scoring
check('hindsight.scoreRelevance full match', hindsight.scoreRelevance('use sqlite for persistence', 'sqlite persistence') === 1);
check('hindsight.scoreRelevance no match', hindsight.scoreRelevance('auth module', 'sqlite persistence') === 0);
check('hindsight.scoreRelevance empty query', hindsight.scoreRelevance('some text', '') === 0.5);

// reflect
const sessionMsgs = Array.from({ length: 12 }, (_, i) => ({
  agentId: `a${i % 3}`, role: i % 2 === 0 ? 'assistant' : 'user',
  content: `message ${i} about ${['sqlite', 'auth', 'config'][i % 3]} module`, ts: i,
}));
const reflected = hindsight.reflect(hStore, sessionMsgs, { repoId: 'repo-x', query: 'sqlite persistence', maxEntries: 5 });
check('hindsight.reflect returns summary', reflected.summary.includes('Session Reflection'));
check('hindsight.reflect compresses to maxEntries', reflected.summary.includes('5 retained'));
check('hindsight.reflect reduces 12 to 5', reflected.summary.startsWith('# Session Reflection (12 messages → 5 retained)'));
check('hindsight.reflect reflectedCount is count of already-reflected (0 here)', reflected.reflectedCount === 0);
// reflect is read-only: it does not mutate the store, so recall is unchanged
check('hindsight.reflect does not mutate store', hindsight.recall(hStore, 'repo-x').length === 3);

// reflect empty
const emptyReflect = hindsight.reflect(hStore, [], { repoId: 'repo-x' });
check('hindsight.reflect empty messages', emptyReflect.summary.includes('No session messages'));

// markReflected
// markReflected changes what reflect() reports as reflectedCount (1 now)
const beforeMark = hindsight.reflect(hStore, [], { repoId: 'repo-x' });
check('hindsight.reflect empty messages (pre-mark)', beforeMark.summary.includes('No session messages'));
check('hindsight.reflect reflectedCount still 0 for empty (no mutation)', beforeMark.reflectedCount === 0);
hStore.markReflected(e1.id);
check('hindsight.markReflected works', hStore.reflectedEntries('repo-x').some(e => e.id === e1.id));
const afterMarkReflect = hindsight.reflect(hStore, sessionMsgs, { repoId: 'repo-x', query: 'sqlite', maxEntries: 5 });
check('hindsight.reflect reports 1 reflected after markReflected', afterMarkReflect.reflectedCount === 1);

// clearHindsight
hStore.clearHindsight('repo-x');
const afterClear = hindsight.recall(hStore, 'repo-x');
check('hindsight.clearHindsight resets relevance', afterClear.every(e => e.relevance === 0));

storeH.close();

// ---- search (Sprint 3.1) -----------------------------------------------
// Mock fetch fn for network-free testing.
const mockFetch = (responses) => {
  let call = 0;
  return async (url, opts) => {
    const r = responses[call++] || { ok: false, status: 500, text: async () => 'fail', json: async () => ({}) };
    if (r.throw) throw new Error(r.throw);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => r.text || '',
      json: async () => r.json || {},
    };
  };
};

// Perplexity provider
const perplexityResults = await search.perplexityProvider.search('test query', {
  fetchFn: mockFetch([{ json: { choices: [{ message: { content: 'See https://example.com/a and https://example.com/b' } }] } }]),
  apiKey: 'pk-test',
});
check('perplexityProvider returns results', perplexityResults.length === 2);
check('perplexityProvider sets provider', perplexityResults[0].provider === 'perplexity');
check('perplexityProvider extracts urls', perplexityResults[0].url.includes('example.com'));

// Perplexity missing key throws
let perplexityThrew = false;
try { await search.perplexityProvider.search('q', { fetchFn: mockFetch([]), apiKey: undefined }); }
catch { perplexityThrew = true; }
check('perplexityProvider throws without key', perplexityThrew);

// Exa provider
const exaResults = await search.exaProvider.search('test', {
  fetchFn: mockFetch([{ json: { results: [{ title: 'R1', url: 'https://exa.io/1', text: 'snippet', score: 0.8 }] } }]),
  apiKey: 'ex-test',
});
check('exaProvider returns results', exaResults.length === 1);
check('exaProvider maps title', exaResults[0].title === 'R1');
check('exaProvider sets score', exaResults[0].score === 0.8);

// Jina provider (no key required)
const jinaResults = await search.jinaProvider.search('test', {
  fetchFn: mockFetch([{ json: { data: [{ title: 'J1', url: 'https://jina.io/1', content: 'text' }] } }]),
});
check('jinaProvider returns results', jinaResults.length === 1);
check('jinaProvider sets provider', jinaResults[0].provider === 'jina');

// Fallback chain: first provider fails, second succeeds
const chainResult = await search.searchWithFallback('query', {
  fetchFn: mockFetch([
    { throw: 'perplexity down' },
    { json: { results: [{ title: 'Exa fallback', url: 'https://exa.io/fb', score: 0.5 }] } },
  ]),
  apiKeys: { perplexity: 'pk', exa: 'ex' },
});
check('searchWithFallback returns results', chainResult.results.length === 1);
check('searchWithFallback used exa', chainResult.provider === 'exa');
check('searchWithFallback records perplexity error', chainResult.errors[0].provider === 'perplexity');

// Fallback chain: all fail
const allFail = await search.searchWithFallback('q', {
  fetchFn: mockFetch([{ throw: 'e1' }, { throw: 'e2' }, { throw: 'e3' }]),
  apiKeys: { perplexity: 'pk', exa: 'ex' },
});
check('searchWithFallback all fail returns empty', allFail.results.length === 0);
check('searchWithFallback all fail no provider', allFail.provider === '');
check('searchWithFallback all fail 3 errors', allFail.errors.length === 3);

// Fallback chain: custom providers order
const chainJinaFirst = await search.searchWithFallback('q', {
  fetchFn: mockFetch([{ json: { data: [{ title: 'J', url: 'https://j.io/1', content: 'x' }] } }]),
  providers: [search.jinaProvider],
});
check('searchWithFallback custom providers', chainJinaFirst.provider === 'jina');

check('search.DEFAULT_PROVIDERS has 3', search.DEFAULT_PROVIDERS.length === 3);
  Object.assign(ctx, { changes, atomic, findCommit, msg, testMsg, storeH, hStore, e1, e2, e3, recalled, recalledKind, recalledMinRel, recalledLimit, sessionMsgs, reflected, emptyReflect, beforeMark, afterMarkReflect, afterClear, mockFetch, perplexityResults, perplexityThrew, exaResults, jinaResults, chainResult, allFail, chainJinaFirst });
}
