import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {

// ---- hashline (Sprint 2.1) ----------------------------------------------
const sampleContent = 'function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a - b;\n}\n';

// hash computation
const h = hashline.computeHash('hello');
check('computeHash returns 64-char hex', /^[0-9a-f]{64}$/.test(h));
check('computeHash deterministic', hashline.computeHash('hello') === h);
check('computeHash differs on input', hashline.computeHash('world') !== h);

// build + serialize + parse roundtrip
const edit = hashline.buildHashline('/src/math.ts', 'return a + b;', 'return Number(a) + Number(b);');
check('buildHashline sets filePath', edit.filePath === '/src/math.ts');
check('buildHashline sets anchorHash', edit.anchorHash === hashline.computeHash('return a + b;'));

const wire = hashline.serializeHashline(edit);
check('serializeHashline has header', wire.startsWith('@@/src/math.ts|'));
check('serializeHashline has OLD marker', wire.includes('<<<OLD'));
check('serializeHashline has NEW marker', wire.includes('>>>NEW'));
check('serializeHashline terminator', wire.endsWith('==='));

const parsed = hashline.parseHashline(wire);
check('parseHashline filePath', parsed.filePath === edit.filePath);
check('parseHashline anchorHash', parsed.anchorHash === edit.anchorHash);
check('parseHashline oldText', parsed.oldText === edit.oldText);
check('parseHashline newText', parsed.newText === edit.newText);

// with anchorLine
const editWithLine = hashline.buildHashline('/src/x.ts', 'old', 'new', 42);
check('buildHashline anchorLine', editWithLine.anchorLine === 42);
const wireLine = hashline.serializeHashline(editWithLine);
check('serializeHashline header has line', /@42$/.test(wireLine.split('\n')[0]));
check('parseHashline anchorLine roundtrip', hashline.parseHashline(wireLine).anchorLine === 42);

// apply hashline — exact match
const result = hashline.applyHashline(sampleContent, edit);
check('applyHashline exact status', result.status === 'exact');
check('applyHashline applied change', result.content.includes('Number(a) + Number(b)'));
check('applyHashline preserves rest', result.content.includes('return a - b;'));

// stale anchor recovery: oldText slightly drifted (whitespace)
const driftedContent = sampleContent.replace('  return a + b;', '   return a + b;');
const staleEdit = hashline.buildHashline('/src/math.ts', '  return a + b;', '  return Number(a) + Number(b);');
// The anchorHash won't match driftedContent's version, but findNearestMatch recovers.
const staleResult = hashline.applyHashline(driftedContent, staleEdit);
check('applyHashline recovered status', staleResult.status === 'recovered' || staleResult.status === 'exact');

// findNearestMatch: exact present → drift 0
const nm = hashline.findNearestMatch(sampleContent, 'return a - b;');
check('findNearestMatch exact', nm.match === 'return a - b;' && nm.drift === 0);

// findNearestMatch: within tolerance (1 char diff on one line)
const fuzzy = hashline.findNearestMatch(sampleContent, 'return a - c;', 1);
check('findNearestMatch fuzzy within 1', fuzzy.match !== null && fuzzy.drift <= 1);

// findNearestMatch: beyond tolerance
const far = hashline.findNearestMatch(sampleContent, 'totally absent content here', 3);
check('findNearestMatch far returns null', far.match === null);

// failed apply when oldText absent and no anchorLine
const failEdit = hashline.buildHashline('/src/none.ts', 'does not exist anywhere', 'new');
const failResult = hashline.applyHashline(sampleContent, failEdit);
check('applyHashline failed status', failResult.status === 'failed');
check('applyHashline failed content unchanged', failResult.content === sampleContent);

// pure insertion via anchorLine fallback
const insEdit = hashline.buildHashline('/src/new.ts', '', '// inserted header', 1);
const insResult = hashline.applyHashline('line1\nline2', insEdit);
check('applyHashline insertion fallback', insResult.status === 'fallback' && insResult.content.startsWith('// inserted header'));

// native conversion roundtrip
const native = hashline.toNativeEdit(edit);
check('toNativeEdit filePath', native.filePath === edit.filePath);
check('toNativeEdit oldString', native.oldString === edit.oldText);
check('toNativeEdit newString', native.newString === edit.newText);
const backToHl = hashline.fromNativeEdit(native);
check('fromNativeEdit anchorHash', backToHl.anchorHash === edit.anchorHash);
check('fromNativeEdit oldText', backToHl.oldText === edit.oldText);

// token reduction measurement (acceptance: 40%+ on a large edit)
const bigOld = 'x'.repeat(2000);
const bigNew = 'y'.repeat(2000);
const bigNative = { filePath: '/src/big.ts', oldString: bigOld, newString: bigNew };
const reduc = hashline.tokenReduction(bigNative);
check('tokenReduction >= 0.4', reduc >= 0.4);
check('tokenReduction < 1', reduc < 1);

// malformed parse throws
let parseThrew = false;
try { hashline.parseHashline('not a hashline'); }
catch { parseThrew = true; }
check('parseHashline malformed throws', parseThrew);
  Object.assign(ctx, { sampleContent, h, edit, wire, parsed, editWithLine, wireLine, result, driftedContent, staleEdit, staleResult, nm, fuzzy, far, failEdit, failResult, insEdit, insResult, native, backToHl, bigOld, bigNew, bigNative, reduc, parseThrew });
}
