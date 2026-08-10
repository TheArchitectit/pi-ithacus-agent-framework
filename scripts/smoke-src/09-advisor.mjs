import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- advisor (Sprint 2.3) ----------------------------------------------
const sess = advisor.createAdvisorSession(3);
check('advisor default budget const', advisor.DEFAULT_ADVISOR_BUDGET === 10);
check('advisor initial remaining', sess.remaining() === 3);

const n1 = sess.emit({ kind: 'blocker', priority: 'P0', confidence: 80, text: 'SQL injection risk', turnIndex: 1 });
check('advisor.emit returns note', n1?.id.startsWith('note-'));
check('advisor.emit clamps confidence', n1?.confidence === 80);
check('advisor.remaining decremented', sess.remaining() === 2);

const n1dup = sess.emit({ kind: 'blocker', priority: 'P0', confidence: 80, text: 'sql injection risk', turnIndex: 2 });
check('advisor dedups by text (case-insensitive)', n1dup === null);
check('advisor.remaining unchanged after dedup', sess.remaining() === 2);

const n2 = sess.emit({ kind: 'suggestion', priority: 'P3', confidence: 150, text: 'refactor this', turnIndex: 1 });
check('advisor clamps confidence over 100', n2?.confidence === 100);

sess.emit({ kind: 'concern', priority: 'P1', confidence: 60, text: 'edge case', turnIndex: 1 });
sess.emit({ kind: 'suggestion', priority: 'P2', confidence: 40, text: 'add tests', turnIndex: 2 });
check('advisor budget exhausted returns null', sess.emit({ kind: 'suggestion', priority: 'P3', confidence: 50, text: 'overflow', turnIndex: 3 }) === null);

const turn1 = sess.injectionsForTurn(1);
check('advisor.injectionsForTurn returns 3 notes', turn1.length === 3);
check('advisor injections blockers first', turn1[0].kind === 'blocker');
check('advisor injections concern before suggestion', turn1.indexOf(turn1.find(n => n.kind === 'concern')) < turn1.indexOf(turn1.find(n => n.kind === 'suggestion')));

const listedNotes = sess.list();
check('advisor.list P0 first', listedNotes[0].priority === 'P0');

check('advisor.priorityRank P0=0', advisor.priorityRank('P0') === 0);
check('advisor.priorityRank P3=3', advisor.priorityRank('P3') === 3);
check('advisor.isBlockerPriority P0', advisor.isBlockerPriority('P0') === true);
check('advisor.isBlockerPriority P2', advisor.isBlockerPriority('P2') === false);

// ---- review (Sprint 2.3) -----------------------------------------------
const safeFile = 'function add(a, b) {\n  return a + b;\n}\n';
check('review.scoreFile clean', review.scoreFile('/src/safe.ts', safeFile).length === 0);

const riskyFile = 'const apiKey = "sk-123";\neval(userInput);\nconsole.log(apiKey);\n// TODO: fix later\n';
const findings = review.scoreFile('/src/risky.ts', riskyFile);
check('review.scoreFile finds issues', findings.length >= 3);
check('review.scoreFile secret P0', findings.some(f => f.priority === 'P0'));
check('review.scoreFile eval P1', findings.some(f => f.priority === 'P1'));
check('review.scoreFile sets filePath', findings.every(f => f.filePath === '/src/risky.ts'));
check('review.scoreFile sets line numbers', findings.every(f => f.line !== null));

const verdict = review.buildVerdict(findings);
check('review.buildVerdict topPriority worst', verdict.topPriority === 'P0');
check('review.buildVerdict not approved (blockers)', verdict.approved === false);
check('review.buildVerdict confidence in range', verdict.confidence >= 0 && verdict.confidence <= 100);
check('review.buildVerdict summary mentions blocked', verdict.summary.includes('Blocked'));

const cleanVerdict = review.buildVerdict([]);
check('review.buildVerdict empty approved', cleanVerdict.approved === true);
check('review.buildVerdict empty summary', cleanVerdict.summary.includes('Approved'));

const nonBlockerFindings = [
  { filePath: '/x.ts', line: 1, priority: 'P2', confidence: 60, message: 'TODO' },
  { filePath: '/x.ts', line: 2, priority: 'P3', confidence: 50, message: 'log' },
];
const nbVerdict = review.buildVerdict(nonBlockerFindings);
check('review.buildVerdict non-blocker approved', nbVerdict.approved === true);
check('review.buildVerdict topPriority P2', nbVerdict.topPriority === 'P2');

check('review.findingConfidence clamps', review.findingConfidence({ confidence: 150 }) === 100);
  Object.assign(ctx, { sess, n1, n1dup, n2, turn1, listedNotes, safeFile, riskyFile, findings, verdict, cleanVerdict, nonBlockerFindings, nbVerdict });
}
