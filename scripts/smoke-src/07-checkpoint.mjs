import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- checkpoint (Sprint 2.1) -------------------------------------------
const convMessages = [
  { id: 'm1', role: 'user', content: 'Investigate the auth module.', turn: 0, exploratory: false },
  { id: 'm2', role: 'assistant', content: 'Looking at src/auth.ts. I see a potential SQL injection on line 42. The query concatenates user input directly into the SQL string without parameterization.', turn: 1, exploratory: true },
  { id: 'm3', role: 'tool', content: 'grep -n query src/auth.ts returned 5 matches', turn: 2, exploratory: true },
  { id: 'm4', role: 'assistant', content: 'I will now plan the fix. The injection is in the login handler.', turn: 3, exploratory: true },
  { id: 'm5', role: 'user', content: 'Fix it now.', turn: 4, exploratory: false },
];

const ckpt = checkpoint.markCheckpoint(convMessages, 'run-ckpt1');
check('markCheckpoint has id', ckpt.id.startsWith('ckpt-'));
check('markCheckpoint turnIndex', ckpt.turnIndex === 5);
check('markCheckpoint tokenCountBefore positive', ckpt.tokenCountBefore > 0);
check('markCheckpoint runId', ckpt.runId === 'run-ckpt1');

const { messages: pruned, summary: sum } = checkpoint.pruneAfterCheckpoint(convMessages, ckpt);
check('pruneAfterCheckpoint reduces count', pruned.length < convMessages.length);
check('pruneAfterCheckpoint keeps non-exploratory', pruned.some(m => m.id === 'm1'));
check('pruneAfterCheckpoint keeps user directive', pruned.some(m => m.id === 'm5'));
check('pruneAfterCheckpoint adds summary msg', pruned.some(m => m.id === `${ckpt.id}-summary`));
check('pruneAfterCheckpoint summary has checkpoints pruned count', sum.prunedMessageCount === 3);
check('pruneAfterCheckpoint tokensSaved positive', sum.tokensSaved > 0);
check('pruneAfterCheckpoint summary non-empty', sum.summary.length > 0);

// buildSummary bullets
const sum2 = checkpoint.buildSummary(convMessages.filter(m => m.exploratory));
check('buildSummary produces bullets', sum2.includes('- [assistant]') || sum2.includes('- [tool]'));
check('buildSummary capped at 8 bullets', sum2.split('\n').length <= 9);

// buildSummary empty
check('buildSummary empty', checkpoint.buildSummary([]).includes('No exploratory'));

// estimateTokens
check('estimateTokens ~4 chars/token', checkpoint.estimateTokens('hello world!') === 3);
check('estimateTokens empty', checkpoint.estimateTokens('') === 0);

// rewind
const rewound = checkpoint.rewindToCheckpoint(convMessages, ckpt);
check('rewindToCheckpoint truncates', rewound.length === 5); // all turns < 5
check('rewindToCheckpoint no turns >= checkpoint', rewound.every(m => m.turn < ckpt.turnIndex));

// ---- config formats (Sprint 2.2) ----------------------------------------
const cursorMdc = `---\napplyTo: "**/*.ts"\ndescription: TS rules\n---\nUse 2 spaces for indentation.\nPrefer const over let.`;
const cursorRules = configFormats.parseCursorMdc(cursorMdc);
check('parseCursorMdc returns 1 rule', cursorRules.length === 1);
check('parseCursorMdc applyTo', cursorRules[0]?.applyTo === '**/*.ts');
check('parseCursorMdc format', cursorRules[0]?.format === 'cursor-mdc');
check('parseCursorMdc body', cursorRules[0]?.body.includes('2 spaces'));

const clineRules = configFormats.parseClineRules('## TypeScript files (*.ts)\nUse strict mode.\n\n## Other\nBe concise.');
check('parseClineRules returns 2', clineRules.length === 2);
check('parseClineRules glob extract', clineRules[0]?.applyTo === '*.ts');
check('parseClineRules format', clineRules[0]?.format === 'cline-clinerules');

const codexContent = 'Be careful with exports.\n\n## TypeScript\nUse const.\n\n## Python\nUse type hints.';
const codexRules = configFormats.parseCodexAgents(codexContent);
check('parseCodexAgents global rule', codexRules.some(r => r.applyTo === '*'));
check('parseCodexAgents headings', codexRules.length >= 2);
check('parseCodexAgents format', codexRules[0]?.format === 'codex-agents');

const copilotContent = 'applyTo: **/*.js\nUse strict.\napplyTo: **/*.py\nUse type hints.';
const copilotRules = configFormats.parseCopilotApplyTo(copilotContent);
check('parseCopilotApplyTo returns 2', copilotRules.length === 2);
check('parseCopilotApplyTo glob js', copilotRules[0]?.applyTo === '**/*.js');
check('parseCopilotApplyTo format', copilotRules[0]?.format === 'copilot-applyTo');

const aiderRules = configFormats.parseAider('Always write tests.\nKeep functions small.');
check('parseAider single rule', aiderRules.length === 1);
check('parseAider global', aiderRules[0]?.applyTo === '*');
check('parseAider format', aiderRules[0]?.format === 'aider');

const continueContent = 'rules:\n  - applyTo: **/*.ts\n    use const\n  - applyTo: **/*.py\n    use type hints\n';
const continueRules = configFormats.parseContinue(continueContent);
check('parseContinue returns 2', continueRules.length === 2);
check('parseContinue first glob', continueRules[0]?.applyTo === '**/*.ts');
check('parseContinue format', continueRules[0]?.format === 'continue');

const codyContent = '## path:src/**/*.ts\nUse strict.\n\n## path:tests/**/*.ts\nUse describe/it.';
const codyRules = configFormats.parseCody(codyContent);
check('parseCody returns 2', codyRules.length === 2);
check('parseCody path glob', codyRules[0]?.applyTo === 'src/**/*.ts');
check('parseCody format', codyRules[0]?.format === 'cody');

const genericRules = configFormats.parseGeneric('Just plain rules.');
check('parseGeneric single rule', genericRules.length === 1 && genericRules[0].format === 'generic');

// dispatch via parseConfigFormat
const dispatched = configFormats.parseConfigFormat(cursorMdc, 'cursor-mdc');
check('parseConfigFormat dispatch works', dispatched.length === 1);
const fallback = configFormats.parseConfigFormat('unknown', 'generic');
check('parseConfigFormat generic fallback', fallback.length === 1);

// loadConfigFile on missing file
check('loadConfigFile missing returns []', configFormats.loadConfigFile('/nonexistent/xyz.md', 'cursor-mdc').length === 0);

// FORMAT_PARSERS has all 8
check('FORMAT_PARSERS has 8 formats', Object.keys(configFormats.FORMAT_PARSERS).length === 8);
  Object.assign(ctx, { convMessages, ckpt, sum2, rewound, cursorMdc, cursorRules, clineRules, codexContent, codexRules, copilotContent, copilotRules, aiderRules, continueContent, continueRules, codyContent, codyRules, genericRules, dispatched, fallback });
}
