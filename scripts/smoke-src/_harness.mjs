// Smoke test for the pi-agnostic src/ layer of ithacus.
// Uses ONLY Node built-ins. No npm install, no external toolchain.
//
// Node 26 strips TypeScript types natively, but our source imports siblings
// with `.js` extensions (NodeNext style). So we copy src/*.ts into a temp dir
// as .ts files and rewrite relative `.js` import specifiers to `.ts` (a safe,
// surgical string replace on `from "..."` / `import("...")` only). Then we
// import the temp .ts directly, letting Node strip the types.

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const srcDir = join(process.cwd(), "src");
export const buildDir = mkdtempSync(join(tmpdir(), "ithacus-src-"));
mkdirSync(buildDir, { recursive: true });

for (const f of readdirSync(srcDir)) {
  if (!f.endsWith(".ts")) continue;
  let code = readFileSync(join(srcDir, f), "utf-8");
  // Rewrite relative "./x.js" / "../x.js" specifiers to ".ts" so Node resolves them.
  code = code.replace(/(from\s+["']\.\.?\/[^"']+)\.js(["'])/g, "$1.ts$2");
  code = code.replace(/(import\(\s*["']\.\.?\/[^"']+)\.js(["']\s*\))/g, "$1.ts$2");
  writeFileSync(join(buildDir, f), code);
}

export const cfg = await import(join(buildDir, "config.ts"));
export const { IthStore } = await import(join(buildDir, "store.ts"));
export const team = await import(join(buildDir, "team.ts"));
export const par = await import(join(buildDir, "parallel.ts"));
export const trim = await import(join(buildDir, "trim.ts"));
export const wf = await import(join(buildDir, "workflow.ts"));
export const wt = await import(join(buildDir, "worktree.ts"));
export const asc = await import(join(buildDir, "async.ts"));
export const { PresenceStore } = await import(join(buildDir, "store-presence.ts"));
export const presence = await import(join(buildDir, "presence.ts"));
export const reservations = await import(join(buildDir, "reservations.ts"));
export const cost = await import(join(buildDir, "cost.ts"));
export const { ModelProfileStore } = await import(join(buildDir, "store-model-profiles.ts"));
export const profiles = await import(join(buildDir, "model-profiles.ts"));
export const validator = await import(join(buildDir, "validator.ts"));
export const hashline = await import(join(buildDir, "hashline.ts"));
export const checkpoint = await import(join(buildDir, "checkpoint.ts"));
export const configFormats = await import(join(buildDir, "config-formats.ts"));
export const streamRules = await import(join(buildDir, "stream-rules.ts"));
export const advisor = await import(join(buildDir, "advisor.ts"));
export const review = await import(join(buildDir, "review.ts"));
export const commits = await import(join(buildDir, "commits.ts"));
export const { HindsightStore } = await import(join(buildDir, "store-hindsight.ts"));
export const hindsight = await import(join(buildDir, "hindsight.ts"));
export const search = await import(join(buildDir, "search.ts"));
export const schemes = await import(join(buildDir, "schemes.ts"));
export const { EventsStore } = await import(join(buildDir, "store-events.ts"));
export const definitions = await import(join(buildDir, "definitions.ts"));
export const metrics = await import(join(buildDir, "metrics.ts"));
export const pluginsMod = await import(join(buildDir, "plugins.ts"));
export const { LspClient, createLspClient } = await import(join(buildDir, 'lsp.ts'));
export const { BrowserClient, createBrowserClient, css, xpath, text } = await import(join(buildDir, 'browser.ts'));
export const { EvalClient, createEvalClient } = await import(join(buildDir, 'eval.ts'));
export const { TuiClient, createTuiClient } = await import(join(buildDir, 'tui.ts'));
export const { CollabClient, createCollabClient } = await import(join(buildDir, 'collab.ts'));
export const { DapClient, createDapClient } = await import(join(buildDir, 'dap.ts'))
export const { applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate } = await import(join(buildDir, 'ast.ts'))
export const { createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop } = await import(join(buildDir, 'goal-loops.ts'))
export const { runDwf, defineWorkflow } = await import(join(buildDir, 'dwf.ts'))
export const { Scheduler, createScheduler, nextCronFire, nextFire } = await import(join(buildDir, 'scheduler.ts'))
export const { WorkQueue, createWorkQueue } = await import(join(buildDir, 'queue.ts'))
export const { InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore } = await import(join(buildDir, 'task-store.ts'))
export const { runStep, runWorkflow, evalCondition } = await import(join(buildDir, 'workflow-steps.ts'))
export const { parseMiniYaml, fromYaml, fromObject, validateTemplate } = await import(join(buildDir, 'workflow-yaml.ts'))
export const { NegotiationManager, createNegotiationManager } = await import(join(buildDir, 'negotiation.ts'))
export const { AgentHandoffManager, createHandoffManager } = await import(join(buildDir, 'handoff.ts'))
export const { SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir } = await import(join(buildDir, 'swarm.ts'))
export const { synthesize, majorityVote, weightedMerge, firstWins, detectConflicts } = await import(join(buildDir, 'synthesis.ts'))
export const { SwarmStore, createSwarmStore } = await import(join(buildDir, 'store-swarm.ts'))
export const { PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner } = await import(join(buildDir, 'plan.ts'))
export const resolver = await import(join(buildDir, 'provider-resolver.ts'))
export const mailbox = await import(join(buildDir, 'mailbox.ts'))
export const toolVisibility = await import(join(buildDir, 'tool-visibility.ts'))
export const eventsMod = await import(join(buildDir, 'events.ts'))
export const eventBus = await import(join(buildDir, 'event-bus.ts'))
export const workerStatus = await import(join(buildDir, 'worker-status.ts'))
// Sprint 5.15: permission-mode resolvers (pure, zero-import src/ files).
export const permissions = await import(join(buildDir, 'permissions.ts'))
export const extensionTrust = await import(join(buildDir, 'extension-trust.ts'))
export const redact = await import(join(buildDir, 'redact.ts'))
export const liveCardToggles = await import(join(buildDir, 'live-card-toggles.ts'))

export let failures = 0;
export function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

export const tmpRepo = mkdtempSync(join(tmpdir(), "ithacus-repo-"));
// repoStateDir only scopes inside a git repo (mirrors pi-mega-compact). Init one.
import { execSync } from "node:child_process";
execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", { cwd: tmpRepo });
export { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync };
