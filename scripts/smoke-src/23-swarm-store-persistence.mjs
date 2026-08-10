import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { r2, r1 } = ctx;

// ---- swarm store persistence (Sprint 5.5) --------------------------------
{
  const swarmTmp = mkdtempSync(join(tmpdir(), 'ith-swarm-'))
  execSync('git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init', { cwd: swarmTmp })
  const st5e = new IthStore(swarmTmp, cfg.loadConfig())
  const sStore = new SwarmStore(st5e.db)
  const r1 = {
    swarmName: 'swarm-A', total: 3, successful: 2, failed: 1, blocked: 0,
    results: [
      { itemId: 1, itemName: 'A', success: true, output: 'a-out', durationMs: 5, role: 'Explore' },
      { itemId: 2, itemName: 'B', success: true, output: 'b-out', durationMs: 7 },
      { itemId: 3, itemName: 'C', success: false, error: 'boom', durationMs: 0 },
    ],
    totalDurationMs: 100,
    checkpoints: [{ id: 1, items: [], createdAt: 0, doneCount: 2 }],
  }
  const id1 = sStore.saveSwarmResult(r1, 1000)
  check('swarmstore.save returns id', typeof id1 === 'string' && id1.startsWith('swarm-'))
  const got1 = sStore.getSwarmResult(id1)
  check('swarmstore.get name', got1 && got1.swarmName === 'swarm-A')
  check('swarmstore.get total', got1 && got1.total === 3)
  check('swarmstore.get successful', got1 && got1.successful === 2)
  check('swarmstore.get failed', got1 && got1.failed === 1)
  check('swarmstore.get blocked', got1 && got1.blocked === 0)
  check('swarmstore.get duration', got1 && got1.totalDurationMs === 100)
  check('swarmstore.get results count', got1 && got1.results.length === 3)
  check('swarmstore.get result A output', got1 && got1.results[0].output === 'a-out')
  check('swarmstore.get result A role', got1 && got1.results[0].role === 'Explore')
  check('swarmstore.get result C error', got1 && got1.results[2].error === 'boom')
  check('swarmstore.get result C not success', got1 && got1.results[2].success === false)
  check('swarmstore.get checkpoints', got1 && got1.checkpoints.length === 1 && got1.checkpoints[0].doneCount === 2)
  const list1 = sStore.listSwarmRuns(10)
  check('swarmstore.list 1 run', list1.length === 1 && list1[0].runId === id1)
  check('swarmstore.list row fields', list1[0].swarmName === 'swarm-A' && list1[0].successful === 2)
  const latest1 = sStore.latestSwarmRun('swarm-A')
  check('swarmstore.latest matches', latest1 && latest1.runId === id1 && latest1.swarmName === 'swarm-A')
  // second swarm, same name, later
  const r2 = {
    swarmName: 'swarm-A', total: 1, successful: 1, failed: 0, blocked: 0,
    results: [{ itemId: 1, itemName: 'X', success: true, output: { ok: true }, durationMs: 3 }],
    totalDurationMs: 9, checkpoints: [],
  }
  const id2 = sStore.saveSwarmResult(r2, 2000)
  check('swarmstore.latest updates to newer', sStore.latestSwarmRun('swarm-A').runId === id2)
  check('swarmstore.list now 2', sStore.listSwarmRuns(10).length === 2)
  // object output round-trips
  const got2 = sStore.getSwarmResult(id2)
  check('swarmstore.object output ok', got2 && got2.results[0].output && got2.results[0].output.ok === true)
  // empty checkpoints round-trip
  check('swarmstore.empty checkpoints', got2 && got2.checkpoints.length === 0)
  // multiple checkpoints round-trip
  const r3 = {
    swarmName: 'swarm-B', total: 0, successful: 0, failed: 0, blocked: 0,
    results: [], totalDurationMs: 0,
    checkpoints: [
      { id: 1, items: [], createdAt: 10, doneCount: 1 },
      { id: 2, items: [], createdAt: 20, doneCount: 2 },
      { id: 3, items: [], createdAt: 30, doneCount: 3 },
    ],
  }
  const id3 = sStore.saveSwarmResult(r3, 3000)
  const got3 = sStore.getSwarmResult(id3)
  check('swarmstore.3 checkpoints', got3 && got3.checkpoints.length === 3)
  check('swarmstore.checkpoint order', got3 && got3.checkpoints[0].doneCount === 1 && got3.checkpoints[2].doneCount === 3)
  check('swarmstore.empty results', got3 && got3.results.length === 0)
  // delete
  sStore.deleteSwarmRun(id1)
  check('swarmstore.delete gone', sStore.getSwarmResult(id1) === undefined)
  check('swarmstore.delete list shrinks', sStore.listSwarmRuns(10).length === 2)
  check('swarmstore.delete preserves others', sStore.getSwarmResult(id2) !== undefined)
  // missing lookups
  check('swarmstore.missing undefined', sStore.getSwarmResult('nope') === undefined)
  check('swarmstore.latest missing undefined', sStore.latestSwarmRun('none') === undefined)
  // createSwarmStore factory
  const sStore2 = createSwarmStore(st5e.db)
  check('swarmstore.factory works', sStore2.listSwarmRuns(10).length === 2)
  // same-ms tiebreak: latestSwarmRun must return the NEWER runId (counter-based)
  const sameMs1 = sStore.saveSwarmResult({ swarmName: 'same-ms', total: 1, successful: 1, failed: 0, blocked: 0, results: [{ itemId: 1, itemName: 'A', success: true, output: 'first', durationMs: 1 }], totalDurationMs: 1, checkpoints: [] }, 5000)
  const sameMs2 = sStore.saveSwarmResult({ swarmName: 'same-ms', total: 1, successful: 1, failed: 0, blocked: 0, results: [{ itemId: 1, itemName: 'A', success: true, output: 'second', durationMs: 1 }], totalDurationMs: 1, checkpoints: [] }, 5000)
  check('swarmstore.same-ms latest is newer', sStore.latestSwarmRun('same-ms').runId === sameMs2)
  // listSwarmRuns ordering for same-ms should also be stable (newer first)
  const sameList = sStore.listSwarmRuns(50).filter(r => r.swarmName === 'same-ms')
  check('swarmstore.same-ms list newer first', sameList[0].runId === sameMs2)
  st5e.close()
  rmSync(swarmTmp, { recursive: true, force: true })
}
}
