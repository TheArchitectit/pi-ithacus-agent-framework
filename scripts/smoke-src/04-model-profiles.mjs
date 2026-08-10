import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { dupThrew } = ctx;

// ---- model profiles (Sprint 1.4) -----------------------------------------
const store6 = new IthStore(tmpRepo, cfg.loadConfig());
const mpStore = new ModelProfileStore(store6.db);

const seeded = profiles.seedProfiles(mpStore);
check('seedProfiles seeds 5 builtins', seeded === 5);
check('seedProfiles idempotent (0 on second call)', profiles.seedProfiles(mpStore) === 0);

const allProfiles = mpStore.listProfiles();
check('listProfiles returns 5', allProfiles.length === 5);
check('getProfile speed exists', mpStore.getProfile('speed')?.tier === 'speed');
check('getProfile quality model', mpStore.getProfile('quality')?.model === 'claude-opus-4-8');

// CRUD: create custom profile
const custom = profiles.createProfile(mpStore, { id: 'fast-local', name: 'FastLocal', tier: 'speed', model: 'phi4', fallbackModels: ['qwen'], description: 'custom', costMultiplier: 0.2 });
check('createProfile returns profile', custom.id === 'fast-local');
check('createProfile persisted', mpStore.getProfile('fast-local')?.name === 'FastLocal');

// CRUD: update
const updated = profiles.updateProfile(mpStore, 'fast-local', { costMultiplier: 0.3 });
check('updateProfile changes field', updated.costMultiplier === 0.3);

// CRUD: delete (builtins protected)
check('deleteProfile custom works', profiles.deleteProfileById(mpStore, 'fast-local') === true);
check('deleteProfile builtin protected', profiles.deleteProfileById(mpStore, 'speed') === false);
check('deleted profile gone', mpStore.getProfile('fast-local') === undefined);

// Cost estimation
const speedProfile = mpStore.getProfile('speed');
const speedCost = profiles.estimateProfileCost(speedProfile, 500000, 500000);
check('estimateProfileCost speed positive', speedCost > 0);
const qualityProfile = mpStore.getProfile('quality');
const qualityCost = profiles.estimateProfileCost(qualityProfile, 500000, 500000);
check('estimateProfileCost quality > speed', qualityCost > speedCost);
check('estimateProfileCost local cheapest', profiles.estimateProfileCost(mpStore.getProfile('local'), 500000, 500000) < speedCost);

// Profile resolution chain
const resolvedSpeed = profiles.resolveProfile(mpStore, { explicit: 'speed' });
check('resolveProfile explicit', resolvedSpeed.id === 'speed');
const resolvedDefault = profiles.resolveProfile(mpStore, {});
check('resolveProfile default', resolvedDefault.id === 'speed');
const resolvedFallback = profiles.resolveProfile(mpStore, { explicit: 'nonexistent' });
check('resolveProfile fallback on bad id', resolvedFallback.id === 'speed');

// Per-role assignment
profiles.assignRoleProfile(mpStore, { runId: 'run-mp1', role: 'Explore', profileId: 'speed' });
profiles.assignRoleProfile(mpStore, { runId: 'run-mp1', role: 'Reviewer', profileId: 'quality' });
const assigns = mpStore.assignmentsForRun('run-mp1');
check('assignmentsForRun returns 2', assigns.length === 2);
check('assignmentForRole Explore', mpStore.assignmentForRole('run-mp1', 'Explore')?.profileId === 'speed');
check('assignmentForRole Reviewer', mpStore.assignmentForRole('run-mp1', 'Reviewer')?.profileId === 'quality');

// resolveProfile with role+runId uses assignment
const resolvedExplore = profiles.resolveProfile(mpStore, { role: 'Explore', runId: 'run-mp1' });
check('resolveProfile role-based', resolvedExplore.id === 'speed');
const resolvedReviewer = profiles.resolveProfile(mpStore, { role: 'Reviewer', runId: 'run-mp1' });
check('resolveProfile role-based quality', resolvedReviewer.id === 'quality');

// createProfile throws on duplicate id
{
  let dupThrew = false;
  try { profiles.createProfile(mpStore, { id: 'speed', name: 'X', tier: 'speed', model: 'x' }); }
  catch { dupThrew = true; }
  check('createProfile rejects duplicate id', dupThrew);
}
  Object.assign(ctx, { store6, mpStore, seeded, allProfiles, custom, updated, speedProfile, speedCost, qualityProfile, qualityCost, resolvedSpeed, resolvedDefault, resolvedFallback, assigns, resolvedExplore, resolvedReviewer });
}
