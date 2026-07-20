// Smoke test for the pi-agnostic src/ layer of ithacus.
// Uses ONLY Node built-ins. No npm install, no external toolchain.
//
// Node 26 strips TypeScript types natively, but our source imports siblings
// with `.js` extensions (NodeNext style). So we copy src/*.ts into a temp dir
// as .ts files and rewrite relative `.js` import specifiers to `.ts` (a safe,
// surgical string replace on `from "..."` / `import("...")` only). Then we
// import the temp .ts directly, letting Node strip the types.

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const srcDir = join(process.cwd(), "src");
const buildDir = mkdtempSync(join(tmpdir(), "ithacus-src-"));
mkdirSync(buildDir, { recursive: true });

for (const f of readdirSync(srcDir)) {
  if (!f.endsWith(".ts")) continue;
  let code = readFileSync(join(srcDir, f), "utf-8");
  // Rewrite relative "./x.js" / "../x.js" specifiers to ".ts" so Node resolves them.
  code = code.replace(/(from\s+["']\.\.?\/[^"']+)\.js(["'])/g, "$1.ts$2");
  code = code.replace(/(import\(\s*["']\.\.?\/[^"']+)\.js(["']\s*\))/g, "$1.ts$2");
  writeFileSync(join(buildDir, f), code);
}

const cfg = await import(join(buildDir, "config.ts"));
const { IthStore } = await import(join(buildDir, "store.ts"));
const team = await import(join(buildDir, "team.ts"));
const par = await import(join(buildDir, "parallel.ts"));
const trim = await import(join(buildDir, "trim.ts"));

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const tmpRepo = mkdtempSync(join(tmpdir(), "ithacus-repo-"));
// repoStateDir only scopes inside a git repo (mirrors pi-mega-compact). Init one.
import { execSync } from "node:child_process";
execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", { cwd: tmpRepo });
const sd = cfg.repoStateDir(tmpRepo, "/global/fallback");
check("repoStateDir scopes to <repo>/.pi/ithacus", sd.endsWith(join(".pi", "ithacus")));
check("repoStateDir falls back outside git", cfg.repoStateDir("/nonexistent-xyz", "/fb").endsWith("/fb"));

// PR #3250 precedence: explicit -> subagentModel -> providerModel -> default.
// resolved.id is the session's active model but is NOT in the agent chain;
// providerModel represents the session provider's model.
const resolved = { id: "claude-opus-4-8", provider: "custom-openai", subagentModel: null, providerModel: "claude-opus-4-8" };
const plan = team.planRun({ runId: "run1", mode: "large", prompt: "audit the cache", resolved, fallbackModels: ["kimi", "qwen"], now: 1000 });
check("planRun 'large' => 4 agents", plan.agents.length === 4);
check("planRun qualifies custom/ model", plan.agents[0].model === "custom/claude-opus-4-8");

const r2 = team.resolveAgentModel(null, { id: "", provider: null, subagentModel: "claude-haiku-4-5-20251001", providerModel: null });
check("resolveAgentModel falls back to subagentModel", r2 === "claude-haiku-4-5-20251001");

const chain = team.buildModelChain(null, resolved, ["kimi", "kimi", "qwen"]);
check("buildModelChain primary first", chain[0] === "custom/claude-opus-4-8");
check("buildModelChain dedupes", new Set(chain).size === chain.length && chain.includes("custom/kimi"));

const store = new IthStore(tmpRepo, cfg.loadConfig());
store.createRun(plan.run);
for (const a of plan.agents) store.upsertAgent(a);
store.createTask({ id: "t1", runId: "run1", title: "x", ownerClaim: null, status: "open" });
check("claimTask succeeds when unclaimed", store.claimTask("t1", "run1-a0") === true);
check("claimTask fails when claimed by other", store.claimTask("t1", "run1-a1") === false);
store.sendMessage({ id: "m1", agentId: "run1-a0", fromAgent: null, payload: "hi", ts: 1, read: false });
check("unread returns sent message", store.unread("run1-a0").length === 1);
store.markRead("m1");
check("markRead clears unread", store.unread("run1-a0").length === 0);
store.addMemory({ id: "mem1", kind: "decision", text: "use node:sqlite", repoId: tmpRepo, ts: 5 });
check("recall returns memory", store.recall(tmpRepo).length === 1);
store.close();

const calls = [
  { name: "read_file", args: {} },
  { name: "write_file", args: {} },
  { name: "grep_search", args: {} },
  { name: "GitCommit", args: {} },
];
const results = await par.executeBatch(calls, async (c) => ({ name: c.name, ok: true, value: null }));
check("executeBatch returns in original order", results.map((r) => r.name).join(",") === "read_file,write_file,grep_search,GitCommit");
check("parallel-safe classified correctly", par.isParallelSafe("read_file") && !par.isParallelSafe("write_file"));

const goodTrim = trim.decideTrim({
  activeAgents: 0, isIdle: true, currentTokens: 150000, contextWindow: 200000,
  tierPct: 0.7, bootFallback: 140000, sinceLastCompactMs: 999999, trimDebounceMs: 2000,
});
check("decideTrim trims when idle+over-threshold", goodTrim.shouldTrim === true);
const noTrim = trim.decideTrim({
  activeAgents: 2, isIdle: true, currentTokens: 150000, contextWindow: 200000,
  tierPct: 0.7, bootFallback: 140000, sinceLastCompactMs: 999999, trimDebounceMs: 2000,
});
check("decideTrim skips when agents active", noTrim.shouldTrim === false);

check("pressureBand mega at >=1.0", cfg.pressureBand(1.1) === "mega");
check("effectiveThreshold scales with window", cfg.effectiveThresholdTokens({ tierPct: 0.7, window: 200000, fallback: 140000 }) === 140000);

rmSync(buildDir, { recursive: true, force: true });
rmSync(tmpRepo, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
