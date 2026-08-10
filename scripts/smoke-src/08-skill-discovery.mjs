import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { asyncStateDir } = ctx;

// ---- skill discovery (Sprint 2.2) --------------------------------------
const skillDir = mkdtempSync(join(tmpdir(), 'ithacus-skills-'));
// extension layer
mkdirSync(join(skillDir, 'ext', 'lint'), { recursive: true });
writeFileSync(join(skillDir, 'ext', 'lint', 'SKILL.md'), '---\nname: lint\ntriggers: lint, eslint\n---\n# Lint Skill\nRun eslint on changed files.');
// project layer (overrides ext's lint)
mkdirSync(join(skillDir, 'project', 'lint'), { recursive: true });
writeFileSync(join(skillDir, 'project', 'lint', 'SKILL.md'), '---\nname: lint\ntriggers: lint, eslint\n---\n# Project Lint Override\nUse project eslint config.');
// user layer
mkdirSync(join(skillDir, 'user', 'test'), { recursive: true });
writeFileSync(join(skillDir, 'user', 'test', 'SKILL.md'), '---\nname: test\n---\n# Test Skill\nRun tests after changes.');

const skills = configFormats.discoverSkills({
  extensionDir: join(skillDir, 'ext'),
  userDir: join(skillDir, 'user'),
  projectDir: join(skillDir, 'project'),
});
check('discoverSkills finds merged skills', skills.length === 2); // lint + test (lint deduped)
const lintSkill = skills.find(s => s.name === 'lint');
check('discoverSkills project overrides ext', lintSkill?.layer === 'project');
check('discoverSkills project body override', lintSkill?.body.includes('project eslint config'));
const testSkill = skills.find(s => s.name === 'test');
check('discoverSkills user layer test', testSkill?.layer === 'user');
check('discoverSkills triggers parsed', lintSkill?.triggers.includes('eslint'));

// validateSkillMd
check('validateSkillMd valid', configFormats.validateSkillMd('# Title\nbody text here longer') === null);
check('validateSkillMd empty', configFormats.validateSkillMd('').includes('empty'));
check('validateSkillMd no body', configFormats.validateSkillMd('---\nname: x\n---').includes('no body'));

rmSync(skillDir, { recursive: true, force: true });

// ---- stream rules (Sprint 2.2) -----------------------------------------
const reg = streamRules.createStreamRuleRegistry();
const r1 = reg.add({ pattern: 'TODO', flags: 'i', inject: 'Remember to resolve TODOs before commit.' });
check('registry.add returns rule', r1.id.startsWith('rule-'));
check('registry.add persists', reg.get(r1.id)?.pattern === 'TODO');
check('registry.list', reg.list().length === 1);

const injections = reg.scan('Here is a TODO item in the stream');
check('registry.scan finds match', injections.length === 1);
check('registry.scan injects text', injections[0]?.inject.includes('resolve TODOs'));
check('registry.scan increments fire count', reg.scan('another TODO').length === 1);

// maxFires limit
const srLimit = reg.add({ pattern: 'FIXME', inject: 'fix me note', maxFires: 2 });
reg.scan('a FIXME here');
reg.scan('another FIXME');
const thirdScan = reg.scan('third FIXME');
check('registry.maxFires blocks after limit', thirdScan.filter(i => i.ruleId === srLimit.id).length === 0);

// compaction survival
const srPersist = reg.add({ pattern: 'persist', inject: 'persisted', persistAfterCompaction: true });
const srEphemeral = reg.add({ pattern: 'ephemeral', inject: 'gone soon', persistAfterCompaction: false });
const survived = reg.surviveCompaction();
check('registry.surviveCompaction drops ephemeral', !reg.get(srEphemeral.id));
check('registry.surviveCompaction keeps persistent', reg.get(srPersist.id) !== undefined);
check('registry.surviveCompaction returns count', survived >= 1);

// capture expansion
const reg2 = streamRules.createStreamRuleRegistry();
const rcap = reg2.add({ pattern: 'function\\s+(\\w+)', flags: 'g', inject: 'Found function: $1' });
const capInj = reg2.scan('function myFunc() {}');
check('registry.scan captures', capInj[0]?.inject === 'Found function: myFunc');
const regAmp = streamRules.createStreamRuleRegistry();
regAmp.add({ pattern: 'function\\s+(\\w+)', flags: '', inject: 'Matched: $& Name: $1' });
check('registry.scan expands $& full match', regAmp.scan('function myFunc() {}')[0]?.inject === 'Matched: function myFunc Name: myFunc');

// functional helpers
check('compileRule valid', streamRules.compileRule({ pattern: 'abc', flags: 'i' }) !== null);
check('compileRule invalid', streamRules.compileRule({ pattern: '(', flags: '' }) === null);
check('ruleMatches positive', streamRules.ruleMatches({ pattern: 'TODO', flags: 'i' }, 'a TODO item') === true);
check('ruleMatches negative', streamRules.ruleMatches({ pattern: 'FIXME', flags: 'i' }, 'no match here') === false);
check('survivesCompaction true', streamRules.survivesCompaction({ persistAfterCompaction: true }) === true);
check('survivesCompaction false', streamRules.survivesCompaction({ persistAfterCompaction: false }) === false);

reg.clear();
check('registry.clear empties', reg.list().length === 0);

rmSync(asyncStateDir, { recursive: true, force: true });
  Object.assign(ctx, { skillDir, skills, lintSkill, testSkill, reg, r1, injections, srLimit, thirdScan, srPersist, srEphemeral, survived, reg2, rcap, capInj, regAmp });
}
