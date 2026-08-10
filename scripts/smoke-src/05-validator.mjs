import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { store6 } = ctx;

// ---- validator (Sprint 1.4 RPV) ----------------------------------------
const goodPrompt = 'Review the auth module at src/auth.ts for SQL injection vulnerabilities and report findings.';
const goodReport = validator.validatePrompt(goodPrompt);
check('validatePrompt returns 4 dimensions', goodReport.dimensions.length === 4);
check('validatePrompt dimension names',
  goodReport.dimensions.map(d => d.name).join(',') === 'clarity,specificity,scope,safety');
check('validatePrompt overallScore in range', goodReport.overallScore >= 0 && goodReport.overallScore <= 100);
check('validatePrompt good prompt passes', goodReport.passed === true);
check('validatePrompt good prompt not safety-blocked', goodReport.safetyBlocked === false);
check('validatePrompt recommendProfile quality for review', goodReport.recommendedProfile === 'quality');
check('validatePrompt summary exists', goodReport.summary.length > 0);

// Safety hard-block
const dangerPrompt = 'Run rm -rf / on the production database and drop table users';
const dangerReport = validator.validatePrompt(dangerPrompt);
check('validatePrompt danger blocked', dangerReport.safetyBlocked === true);
check('validatePrompt danger not passed', dangerReport.passed === false);
const safetyDim = dangerReport.dimensions.find(d => d.name === 'safety');
check('validatePrompt safety score below threshold', safetyDim.score < 30);

// Vague prompt fails overall threshold
const vaguePrompt = 'help';
const vagueReport = validator.validatePrompt(vaguePrompt);
check('validatePrompt vague fails', vagueReport.passed === false);
check('validatePrompt vague overallScore low', vagueReport.overallScore < 40);

// Recommend profile by keyword
check('recommendProfile code', validator.recommendProfile('implement and write a new parser') === 'code');
check('recommendProfile reasoning', validator.recommendProfile('design an architecture strategy') === 'reasoning');
check('recommendProfile speed', validator.recommendProfile('quick scan to find all deps') === 'speed');

// Recommend team size scales with complexity
check('recommendTeamSize short prompt', validator.recommendTeamSize('fix this bug') <= 2);
check('recommendTeamSize long prompt', validator.recommendTeamSize('A. Do X. B. Do Y. C. Do Z. D. Do W. And also next then after build deploy test verify') >= 4);
check('recommendTeamSize clamped 1-6', validator.recommendTeamSize('word '.repeat(200).trim()) <= 6);

// Custom thresholds
const strictReport = validator.validatePrompt('review it', { overallThreshold: 80 });
check('validatePrompt custom threshold can fail', strictReport.passed === false);

// Safety threshold configurable
const mildDanger = validator.validatePrompt('quietly rm -rf something', { safetyThreshold: 10 });
check('validatePrompt custom safety threshold', typeof mildDanger.safetyBlocked === 'boolean');

store6.close();
  Object.assign(ctx, { goodPrompt, goodReport, dangerPrompt, dangerReport, safetyDim, vaguePrompt, vagueReport, strictReport, mildDanger });
}
