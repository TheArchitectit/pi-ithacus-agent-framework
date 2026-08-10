import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- definitions (Sprint 3.2) -----------------------------------------
const agentMd = `---\nname: Code Reviewer\nrole: reviewer\nmodel: claude-sonnet\ntools:\n  - rg\n  - read\ntriggers:\n  - review\n  - audit\n---\nYou are a code reviewer. Check for bugs and security issues.`;
const agentDef = definitions.parseAgentDefinition(agentMd, '/agents/reviewer.md', 'project');
check('parseAgentDefinition name', agentDef?.name === 'Code Reviewer');
check('parseAgentDefinition role', agentDef?.role === 'reviewer');
check('parseAgentDefinition model', agentDef?.model === 'claude-sonnet');
check('parseAgentDefinition id slug', agentDef?.id === 'code-reviewer');
check('parseAgentDefinition tools', JSON.stringify(agentDef?.tools) === JSON.stringify(['rg', 'read']));
check('parseAgentDefinition triggers', agentDef?.triggers.includes('review'));
check('parseAgentDefinition body', agentDef?.systemPrompt.includes('code reviewer'));
check('parseAgentDefinition layer', agentDef?.layer === 'project');

const agentNoFm = definitions.parseAgentDefinition('Just a plain agent with instructions.', '/agents/plain.md', 'user');
check('parseAgentDefinition no frontmatter uses body', agentNoFm?.systemPrompt.includes('plain agent'));

const emptyAgent = definitions.parseAgentDefinition('', '/agents/empty.md', 'builtin');
check('parseAgentDefinition empty returns null', emptyAgent === null);

const teamMd = `---\nname: Review Team\nworkflow: review\nagents:\n  - explorer:explorer\n  - reviewer:code-reviewer\n---\nTeam config.`;
const teamDef = definitions.parseTeamDefinition(teamMd, '/teams/review.md', 'project');
check('parseTeamDefinition name', teamDef?.name === 'Review Team');
check('parseTeamDefinition workflow', teamDef?.workflow === 'review');
check('parseTeamDefinition agents count', teamDef?.agents.length === 2);
check('parseTeamDefinition agent role', teamDef?.agents[0].role === 'explorer');
check('parseTeamDefinition agentId', teamDef?.agents[1].agentId === 'code-reviewer');

const emptyTeam = definitions.parseTeamDefinition('---\nname: x\n---\nbody', '/teams/x.md', 'builtin');
check('parseTeamDefinition no agents returns null', emptyTeam === null);

// 3-layer discovery
const defDir = mkdtempSync(join(tmpdir(), 'ithacus-defs-'));
mkdirSync(join(defDir, 'project'), { recursive: true });
writeFileSync(join(defDir, 'project', 'custom.md'), agentMd);
mkdirSync(join(defDir, 'ext'), { recursive: true });
writeFileSync(join(defDir, 'ext', 'base.md'), '---\nname: Base\nrole: executor\n---\nBase agent.');

const discovered = definitions.discoverAgentDefinitions({
  builtinDir: join(defDir, 'ext'),
  projectDir: join(defDir, 'project'),
});
check('discoverAgentDefinitions 2 agents', discovered.length === 2);
check('discoverAgentDefinitions finds custom', discovered.some(d => d.name === 'Code Reviewer'));

const teamDiscovered = definitions.discoverTeamDefinitions({
  builtinDir: join(defDir, 'ext'),
  projectDir: join(defDir, 'project'),
});
check('discoverTeamDefinitions handles no teams dir', teamDiscovered.length === 0);

check('validateAgentDefinition valid', definitions.validateAgentDefinition(agentDef) === null);
check('validateAgentDefinition missing name', definitions.validateAgentDefinition({ ...agentDef, name: '' })?.includes('name'));

rmSync(defDir, { recursive: true, force: true });
  Object.assign(ctx, { agentMd, agentDef, agentNoFm, emptyAgent, teamMd, teamDef, emptyTeam, defDir, discovered, teamDiscovered });
}
