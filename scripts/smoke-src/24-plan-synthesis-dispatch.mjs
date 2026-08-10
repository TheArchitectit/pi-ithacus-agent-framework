import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { t1, t2, t3, t4, req1 } = ctx;

// ---- plan synthesis + dispatch (Sprint 5.6) -------------------------------
{
  // PlanSynthesizer: linear pipeline from agents
  const synth = createPlanSynthesizer(() => 42000)
  const req1 = { goal: 'investigate auth module', agents: [{ role: 'Explore' }, { role: 'Plan' }, { role: 'Verification' }] }
  const t1 = synth.synthesize(req1)
  check('plan.synth name', t1.name.startsWith('plan-'))
  check('plan.synth description', t1.description === 'investigate auth module')
  check('plan.synth 3 steps', t1.steps.length === 3)
  check('plan.synth step ids', t1.steps[0].id === 'step-1' && t1.steps[2].id === 'step-3')
  check('plan.synth step types all task', t1.steps.every(s => s.type === 'task'))
  check('plan.synth step roles', t1.steps[0].role === 'Explore' && t1.steps[1].role === 'Plan' && t1.steps[2].role === 'Verification')
  check('plan.synth linear deps', t1.steps[0].dependsOn === undefined && t1.steps[1].dependsOn?.[0] === 'step-1' && t1.steps[2].dependsOn?.[0] === 'step-2')
  check('plan.synth goal in step 0', t1.steps[0].goal === 'investigate auth module')
  check('plan.synth metadata', t1.metadata?.agentCount === 3 && t1.metadata?.goalLength === 23)
  check('plan.synth variables.goal', t1.variables?.goal === 'investigate auth module')

  // PlanSynthesizer: single agent fallback
  const t2 = synth.synthesize({ goal: 'quick fix', agents: [] })
  check('plan.synth empty agents fallback', t2.steps.length === 1 && t2.steps[0].role === 'Explore')

  // PlanSynthesizer: single agent explicit
  const t3 = synth.synthesize({ goal: 'review code', agents: [{ role: 'Reviewer' }] })
  check('plan.synth single agent', t3.steps.length === 1 && t3.steps[0].role === 'Reviewer')
  check('plan.synth single no deps', t3.steps[0].dependsOn === undefined)

  // PlanSynthesizer: default role when agent has no role
  const t4 = synth.synthesize({ goal: 'test', agents: [{}] })
  check('plan.synth default role', t4.steps[0].role === 'Explore')

  // PlanSynthesizer: validateTemplate passes
  const { validateTemplate: vt } = await import(join(buildDir, 'workflow-yaml.ts'))
  check('plan.synth template valid', vt(t1) === null)
  check('plan.synth single valid', vt(t3) === null)

  // PlanRunner: full pipeline with mock executor
  let execOrder = []
  const mockExec = {
    dispatch: async (item) => {
      execOrder.push(item.name)
      const payload = item.payload
      const prompt = payload?.prompt ?? item.name
      return { itemId: item.id, itemName: item.name, success: true, output: `done: ${prompt}`, durationMs: 5, role: item.assignedRole }
    },
    now: () => 50000,
  }
  const planTmp = mkdtempSync(join(tmpdir(), 'ith-plan-'))
  const planStore = new IthStore(planTmp, cfg.loadConfig())
  const pStore = new SwarmStore(planStore.db)
  const runner = createPlanRunner(synth, mockExec, pStore)
  const outcome1 = await runner.execute(req1)
  check('plan.run storeRunId starts swarm-', outcome1.storeRunId.startsWith('swarm-'))
  check('plan.run swarmName starts plan-', outcome1.swarmName.startsWith('plan-'))
  check('plan.run total 3', outcome1.total === 3)
  check('plan.run successful 3', outcome1.successful === 3)
  check('plan.run failed 0', outcome1.failed === 0)
  check('plan.run blocked 0', outcome1.blocked === 0)
  check('plan.run synthesis agentCount 3', outcome1.synthesis.agentCount === 3)
  check('plan.run result has results', outcome1.result.results.length === 3)
  check('plan.run exec order step-1,2,3', execOrder.join(',') === 'step-1,step-2,step-3')
  check('plan.run persisted in store', pStore.getSwarmResult(outcome1.storeRunId) !== undefined)
  check('plan.run latest matches', pStore.latestSwarmRun(outcome1.swarmName)?.swarmName === outcome1.swarmName)

  // PlanRunner: failed step → partial
  execOrder = []
  const failExec = {
    dispatch: async (item) => {
      execOrder.push(item.name)
      if (item.name === 'step-2') return { itemId: item.id, itemName: item.name, success: false, error: 'step-2 failed', durationMs: 2 }
      return { itemId: item.id, itemName: item.name, success: true, output: 'ok', durationMs: 3 }
    },
    now: () => 51000,
  }
  const runner2 = createPlanRunner(synth, failExec, pStore)
  const failReq = { goal: 'test fail', agents: [{ role: 'Explore' }, { role: 'Plan' }, { role: 'Verification' }] }
  const outcome2 = await runner2.execute(failReq)
  check('plan.fail step-2 failed', outcome2.failed === 1)
  check('plan.fail step-1 done', outcome2.successful >= 1)
  check('plan.fail step-3 blocked', outcome2.blocked === 1)
  check('plan.fail exec order', execOrder.includes('step-1') && execOrder.includes('step-2') && !execOrder.includes('step-3'))

  // PlanRunner: 5-step pipeline
  execOrder = []
  const bigReq = {
    goal: 'comprehensive review',
    agents: [{ role: 'Explore' }, { role: 'Explore' }, { role: 'Plan' }, { role: 'Verification' }, { role: 'Reviewer' }],
  }
  const outcome3 = await runner.execute(bigReq)
  check('plan.big 5 steps total', outcome3.total === 5)
  check('plan.big all successful', outcome3.successful === 5)
  check('plan.big exec order 5', execOrder.length === 5)
  check('plan.big linear order', execOrder[0] === 'step-1' && execOrder[4] === 'step-5')

  // PlanRunner: single agent
  execOrder = []
  const singleReq = { goal: 'quick fix', agents: [{ role: 'Explore' }] }
  const outcome4 = await runner.execute(singleReq)
  check('plan.single 1 step', outcome4.total === 1 && outcome4.successful === 1)
  check('plan.single exec order 1', execOrder.length === 1)

  // PlanRunner: empty agents -> default Explore
  execOrder = []
  const emptyReq = { goal: 'default task', agents: [] }
  const outcome5 = await runner.execute(emptyReq)
  check('plan.empty default 1 step', outcome5.total === 1)

  // PlanRunner: result round-trips through store
  const stored = pStore.getSwarmResult(outcome1.storeRunId)
  check('plan.stored name matches', stored?.swarmName === outcome1.swarmName)
  check('plan.stored results 3', stored?.results.length === 3)
  check('plan.stored result output', stored?.results[0]?.output === 'done: investigate auth module')
  check('plan.stored result role', stored?.results[0]?.role === 'Explore')

  // createPlanRunner factory
  const runner3 = createPlanRunner(synth, mockExec, pStore)
  check('plan.factory works', runner3 !== undefined)

  planStore.close()
  rmSync(planTmp, { recursive: true, force: true })
}

// ============================================================================
// provider-resolver — resolve which provider owns a model id (pure, no fs)
// Chain: prefix > explicit param > agent frontmatter > pi-setup scan > unresolved.
// ============================================================================
{
  const resolve = resolver.resolveProviderForModel;
  let r;

  // 1. provider-prefixed → split, no lookup needed
  r = resolve({ model: "plexus/claude-mythos-5" });
  check("resolver.prefix provider", r.provider === "plexus");
  check("resolver.prefix model split", r.model === "claude-mythos-5");
  check("resolver.prefix source", r.source === "model-prefix");

  // 2. explicit param overrides scan (bare id + explicit provider)
  r = resolve({ model: "claude-haiku-4-5", explicitProvider: "test" });
  check("resolver.explicit provider", r.provider === "test");
  check("resolver.explicit source", r.source === "explicit-param");

  // 3. agent frontmatter provider
  r = resolve({ model: "claude-haiku-4-5", agentProvider: "anthropic" });
  check("resolver.agent provider", r.provider === "anthropic");
  check("resolver.agent source", r.source === "agent-frontmatter");

  // 4. pi-setup config — unique owner
  const cfg = {
    providers: {
      plexus: { models: [{ id: "claude-mythos-5" }] },
      openai: { models: [{ id: "gpt-4o" }] },
    },
    settings: { defaultProvider: "plexus" },
  };
  r = resolve({ model: "claude-mythos-5", piConfig: cfg });
  check("resolver.unique provider", r.provider === "plexus");
  check("resolver.unique source", r.source === "pi-setup-unique");

  // 5. ambiguous → prefers settings.defaultProvider
  const ambCfg = {
    providers: {
      plexus: { models: [{ id: "shared-model" }] },
      openai: { models: [{ id: "shared-model" }] },
    },
    settings: { defaultProvider: "openai" },
  };
  r = resolve({ model: "shared-model", piConfig: ambCfg });
  check("resolver.ambiguous picks default", r.provider === "openai");
  check("resolver.ambiguous source default", r.source === "pi-setup-default");

  // 6. ambiguous without default → unresolved
  const ambNoDefault = {
    providers: {
      plexus: { models: [{ id: "shared-model" }] },
      openai: { models: [{ id: "shared-model" }] },
    },
    settings: {},
  };
  r = resolve({ model: "shared-model", piConfig: ambNoDefault });
  check("resolver.ambiguous no default unresolved", r.source === "unresolved");
  check("resolver.ambiguous no default has error", typeof r.error === "string" && r.error.includes("ambiguous"));

  // 7. zero owners + NO defaultProvider → unresolved with /setup hint. Use a
  // config where defaultProvider is absent so the fallback path is not taken.
  const cfgNoDefault = {
    providers: {
      plexus: { models: [{ id: "claude-mythos-5" }] },
      openai: { models: [{ id: "gpt-4o" }] },
    },
    settings: {},
  };
  r = resolve({ model: "no-such-model", piConfig: cfgNoDefault });
  check("resolver.zero unresolved", r.source === "unresolved");
  check("resolver.zero has error", typeof r.error === "string");
  check("resolver.zero hints setup", (r.hint ?? "").includes("/setup"));
  check("resolver.zero mentions no default", (r.error ?? "").includes("no default provider"));

  // 8. no config at all → unresolved + hint
  r = resolve({ model: "claude-haiku-4-5" });
  check("resolver.noconfig unresolved", r.source === "unresolved");
  check("resolver.noconfig hints setup", (r.hint ?? "").includes("/setup"));

  // 9. empty model → unresolved
  r = resolve({ model: "" });
  check("resolver.empty unresolved", r.source === "unresolved");

  // 10. settings-default-fallback: bare id not in any provider, but
  // settings.defaultProvider is set → "just works" path (the /setup default).
  // Provider = defaultProvider; model stays the bare id (no defaultModel set).
  r = resolve({ model: "claude-haiku-4-5", piConfig: cfg });
  check("resolver.fallback provider default", r.provider === "plexus");
  check("resolver.fallback model unchanged", r.model === "claude-haiku-4-5");
  check("resolver.fallback source", r.source === "settings-default-fallback");

  // 11. settings-default-fallback with defaultModel override: when settings
  // also sets defaultModel, the agent's bare id is REPLACED by the session
  // default model — so a bundled `claude-haiku-4-5` becomes the user's chosen
  // default model under their default provider.
  const cfgWithDefaultModel = {
    providers: { plexus: { models: [{ id: "claude-mythos-5" }] } },
    settings: { defaultProvider: "plexus", defaultModel: "claude-mythos-5" },
  };
  r = resolve({ model: "claude-haiku-4-5", piConfig: cfgWithDefaultModel });
  check("resolver.fallback defaultModel provider", r.provider === "plexus");
  check("resolver.fallback defaultModel replaced", r.model === "claude-mythos-5");
  check("resolver.fallback defaultModel source", r.source === "settings-default-fallback");
}

rmSync(buildDir, { recursive: true, force: true });
rmSync(tmpRepo, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
}
