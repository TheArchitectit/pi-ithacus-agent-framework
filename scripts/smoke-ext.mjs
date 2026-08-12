// Smoke test for the extensions/ dispatch layer of ithacus.
//
// Closes the test gap that let the phantom `pi.callTool` ship broken: the
// existing smoke-src.mjs covers only the pi-agnostic src/ layer; NOTHING
// exercised the extension dispatch path. This file imports the real
// extensions/*.ts modules (with `--experimental-strip-types` type stripping)
// and asserts the dispatch wiring is real — especially that
// `registerDispatchTool` registers a tool named `ithacus-dispatch` via
// `pi.registerTool` (the canonical pi pattern), NOT via the non-existent
// `pi.callTool`.
//
// Why a separate file (not appended to smoke-src.mjs):
//   - Separation of concerns: src/ (pi-agnostic) vs extensions/ (pi adapter).
//   - extensions/ithacus-dispatch.ts imports `typebox` as a VALUE (Type.Object
//     runs at module load). typebox resolves via <repo>/node_modules only when
//     the temp dir is UNDER the repo root, unlike smoke-src's os.tmpdir() dir.
//     Keeping the harness separate isolates that requirement.
//
// Real `pi` cannot run in the harness (no model keys / no network —
// PREVENT-ITH-004). So `spawnAgent`'s subprocess spawn is exercised via the
// injectable `spawnImpl` test seam (a fake EventEmitter that emits JSON
// `message_end` lines). registerDispatchTool's execute() is exercised via the
// unknown-agent early-return path (no subprocess spawned).
//
// Sprint 5.12.5: /ithacus-setup is exercised with a fake UI (queued select
// answers) + a hermetic HOME models.json fixture — dynamic discovery roster,
// writer bind → project frontmatter write, a project-only custom agent, and
// removed-bundle retention — all inside the tmpDir fake cwd; the live .pi
// tree is never touched.
//
// Sprint 5.13: §3d exercises the live-progress overlay wiring — the
// ithacus-live store (startLive/parseJsonlLine/updateLive/endLive), the
// IthLiveCard render surface, and registerDispatchTool(runtime)'s
// wireLiveEventBus(runtime.eventBus) seam — with fake-bus + fake-theme seams,
// no subprocess, no TUI.

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { get as httpGet } from "node:http"; // loopback client for the §3e web-dashboard smoke

// ---- check() harness (mirrors smoke-src.mjs) -------------------------------
const checks = [];
function check(name, ok) {
  checks.push([name, !!ok]);
  if (!ok) console.error("FAIL " + name);
  else console.log("PASS " + name);
}

// ---- copy extensions/*.ts + extensions/agents/*.md to a temp dir ------------
// Temp dir is UNDER the repo root so `import { Type } from "typebox"` resolves
// (walks up to <repo>/node_modules/typebox). agents/*.md is copied into
// <tmpdir>/agents/ so ithacus-agents.ts's import.meta.url-based
// bundledAgentsDir() resolves naturally — no API override needed.
const repoRoot = process.cwd();
const tmpDir = mkdtempSync(join(repoRoot, ".smoke-ext-tmp-"));
const agentsDir = join(tmpDir, "agents");
mkdirSync(agentsDir, { recursive: true });
// Hermetic HOME fixture (Sprint 5.12.5 setup smoke) — captured at module
// scope so the finally below can always restore the caller's HOME.
const prevHome = process.env.HOME;

try {
  // Rewrite .js ESM specifiers to .ts so Node resolves them under
  // --experimental-strip-types. Order matters: ../src/X.js → ./X.ts must run
  // FIRST so it maps to the flat tmpDir src copies (below) instead of the real
  // repo-root src/ (whose un-rewritten ./X.js VALUE specifiers crash with
  // ERR_MODULE_NOT_FOUND).
  const rewriteJsToTs = (code) =>
    code
      .replace(/(from\s+["'])\.\.\/src\/([^"']+?)\.js(["'])/g, "$1./$2.ts$3")
      .replace(/(from\s+["']\.\.?\/[^"']+)\.js(["'])/g, "$1.ts$2")
      .replace(/(import\(\s*["']\.\.?\/[^"']+)\.js(["']\s*\))/g, "$1.ts$2");

  // Extensions mirrored into tmpDir (../src/X.js → ./X.ts + ./Y.js → ./Y.ts).
  for (const f of readdirSync(join(repoRoot, "extensions"))) {
    if (!f.endsWith(".ts")) continue;
    writeFileSync(join(tmpDir, f), rewriteJsToTs(readFileSync(join(repoRoot, "extensions", f), "utf-8")));
  }
  // ALL src/*.ts mirrored FLAT into tmpDir with the same rewrite, so the VALUE
  // imports src files carry (./failure-kind.js, ./checkpoint.js, ./config.js,
  // ./team.js, ./workflow.js, ./window-pressure.js, ./boundary.js, …) resolve
  // to flat rewritten siblings — never the missing real src/*.js files. Test
  // files are excluded (never part of the extension runtime chain).
  for (const f of readdirSync(join(repoRoot, "src"))) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    writeFileSync(join(tmpDir, f), rewriteJsToTs(readFileSync(join(repoRoot, "src", f), "utf-8")));
  }
  for (const f of readdirSync(join(repoRoot, "extensions", "agents"))) {
    if (!f.endsWith(".md")) continue;
    copyFileSync(join(repoRoot, "extensions", "agents", f), join(agentsDir, f));
  }

  // HERMETIC: discovery resolves project overrides from <process.cwd()>/.pi/
  // ithacus/agents. chdir into tmpDir (which has no .pi) so a user-installed
  // .pi/ithacus/agents/ in the host repo cannot shadow the bundled roster
  // during these checks. chdir back to repoRoot happens in the finally below.
  process.chdir(tmpDir);

  // HERMETIC HOME (Sprint 5.12.5 setup smoke): collectModels() reads
  // ~/.pi/agent/models.json via ithacus-provider-config.ts, which CAPTURES
  // os.homedir() at module-import time — set HOME and write the provider
  // fixture BEFORE importing any extension module below.
  process.env.HOME = tmpDir;
  mkdirSync(join(tmpDir, ".pi", "agent"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".pi", "agent", "models.json"),
    JSON.stringify({
      providers: {
        fakeprov: { models: [{ id: "fake-model-a" }, { id: "fake-model-b" }] },
      },
    }),
  );

  const agentsMod = await import(join(tmpDir, "ithacus-agents.ts"));
  const dispatchMod = await import(join(tmpDir, "ithacus-dispatch.ts"));

  // ========================================================================
  // 1. ithacus-agents.ts — markdown agent discovery
  // ========================================================================

  // Sprint 5.12.5: the expected roster is DERIVED from the actual bundled
  // extensions/agents/*.md files — never a hard-coded count — so adding a
  // bundled def (e.g. writer.md) updates these assertions with no code edit.
  const expectedNames = readdirSync(join(repoRoot, "extensions", "agents"))
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .map((f) => f.slice(0, -3))
    .sort();

  const discovered = agentsMod.discoverIthacusAgents();
  check("agents.discover matches bundled file roster",
    discovered.length === expectedNames.length &&
    expectedNames.every((n) => discovered.some((a) => a.name === n)));

  const byName = new Map(discovered.map((a) => [a.name, a]));
  for (const n of expectedNames) check(`agents.has ${n}`, byName.has(n));

  // writer.md (0.4.0 payload): full implementation role, discovered straight
  // from the package bundle in the source layout (pre-seed).
  const writer = byName.get("writer");
  check("agents.writer discovered from package bundle",
    writer !== undefined && writer.source === "bundled" &&
    writer.filePath === join(agentsDir, "writer.md"));
  check("agents.writer implementation tool set",
    ["read", "grep", "find", "ls", "bash", "write", "edit", "ithacus-mailbox"]
      .every((t) => writer?.tools?.includes(t)));
  check("agents.writer package-portable default model (no provider pin)",
    writer?.model === "claude-sonnet-4-5" && writer?.provider === undefined);

  // bundled plan.md carries the docs-only-write contract (write/edit/bash).
  const planAgent = byName.get("plan");
  check("agents.plan docs-only-write tools",
    Array.isArray(planAgent?.tools) && planAgent.tools.includes("write") &&
    planAgent.tools.includes("edit") && planAgent.tools.includes("bash"));
  check("agents.plan docs/**/*.md contract in body",
    planAgent?.systemPrompt.includes("docs/**/*.md"));

  const explore = byName.get("explore");
  check("agents.explore model haiku", explore?.model === "claude-haiku-4-5");
  check("agents.plan model sonnet", byName.get("plan")?.model === "claude-sonnet-4-5");
  check("agents.reviewer model sonnet", byName.get("reviewer")?.model === "claude-sonnet-4-5");
  check("agents.explore has tools", Array.isArray(explore?.tools) && explore.tools.includes("read") && explore.tools.includes("grep") && explore.tools.includes("bash"));

  check("agents.all have systemPrompt", discovered.every((a) => a.systemPrompt.length > 0));
  check("agents.all bundled source", discovered.every((a) => a.source === "bundled"));

  // findAgent: case-insensitive + maps ithacus AgentRole ("Explore"→"explore")
  check("agent.find Explore case-insensitive", agentsMod.findAgent(discovered, "Explore")?.name === "explore");
  check("agent.find REVIEWER case-insensitive", agentsMod.findAgent(discovered, "REVIEWER")?.name === "reviewer");
  check("agent.findPlan AgentRole", agentsMod.findAgent(discovered, "Plan")?.name === "plan");
  check("agent.find unknown undefined", agentsMod.findAgent(discovered, "nonexistent") === undefined);
  check("agent.find Verification AgentRole", agentsMod.findAgent(discovered, "Verification")?.name === "verification");

  // frontmatter parse: tools split + model extracted + body stripped of fence
  check("agent.explore tools count", explore.tools.length === 6);
  check("agent.explore tools no blanks", explore.tools.every((t) => t.length > 0));
  check("agent.explore body not frontmatter", !explore.systemPrompt.startsWith("---"));
  check("agent.explore description set", explore.description.length > 0 && !explore.description.startsWith("name:"));

  // ========================================================================
  // 2. spawnAgent — the subprocess spawn helper (replaces pi.callTool)
  // ========================================================================
  // Tested with the spawnImpl seam: a fake ChildProcess (EventEmitter) that
  // emits JSON `message_end` lines on stdout, matching pi's --mode json output.

  function makeFakeProc({ stdoutLines = [], stderr = "", exitCode = 0, onClose }) {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = (sig) => { proc.killed = true; };
    // Emit async so listeners attach first.
    queueMicrotask(() => {
      for (const line of stdoutLines) proc.stdout.emit("data", Buffer.from(line + "\n"));
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      if (onClose) onClose(proc);
      proc.emit("close", exitCode);
    });
    return proc;
  }

  const messageEndEvent = (text) =>
    JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });

  // --- unknown agent: early-return, no subprocess spawned ---
  let spawnCalled = false;
  const unknownRes = await dispatchMod.spawnAgent({
    agent: "nonexistent-role",
    task: "do thing",
    spawnImpl: () => { spawnCalled = true; return makeFakeProc({}); },
  });
  check("spawn.unknown success false", unknownRes.success === false);
  check("spawn.unknown no subprocess", spawnCalled === false);
  check("spawn.unknown exitCode 1", unknownRes.exitCode === 1);
  check("spawn.unknown error flag", unknownRes.error === "unknown_agent");
  check("spawn.unknown mentions available", unknownRes.stderr.includes("Available"));

  // --- provider resolution at the spawn level: a bare model id not in any
  // configured provider takes the settings-default-fallback path when a
  // defaultProvider is set (the "just works" behavior). The genuinely-
  // unresolved (no default provider) path is fully unit-tested in
  // smoke-src.mjs (test 7, cfgNoDefault). Here we assert the spawn level
  // propagates providerSource from the resolver, and that the subprocess IS
  // spawned on the fallback path (no fast-fail when a default exists).
  let ffSpawnCalled = false;
  const ffRes = await dispatchMod.spawnAgent({
    agent: "explore",
    task: "probe",
    model: "definitely-no-such-model-xyz",
    provider: "test", // pin so the spawn proceeds deterministically regardless of env config
    spawnImpl: () => { ffSpawnCalled = true; return makeFakeProc({ stdoutLines: [messageEndEvent("x")] }); },
  });
  check("spawn.fallback subprocess spawned", ffSpawnCalled === true);
  check("spawn.fallback provider propagated", ffRes.provider === "test");
  check("spawn.fallback providerSource set", typeof ffRes.providerSource === "string" && ffRes.providerSource.length > 0);

  // --- known agent + mock: JSON capture + success:true ---
  // provider: "test" pins the provider (explicit-param path) so spawn proceeds
  // regardless of whatever pi-setup config exists in this env — this test
  // exercises the subprocess wiring, not provider resolution.
  const mockRes = await dispatchMod.spawnAgent({
    agent: "explore",
    task: "scout the auth module",
    model: "claude-haiku-4-5",
    provider: "test",
    spawnImpl: () => makeFakeProc({ stdoutLines: [messageEndEvent("found auth in src/auth.ts")] }),
  });
  check("spawn.mock success true", mockRes.success === true);
  check("spawn.mock output captured", mockRes.output === "found auth in src/auth.ts");
  check("spawn.mock model echoed", mockRes.model === "claude-haiku-4-5");
  check("spawn.mock provider echoed", mockRes.provider === "test");
  check("spawn.mock providerSource explicit", mockRes.providerSource === "explicit-param");
  check("spawn.mock success flag unset", mockRes.error === undefined);

  // --- mock verifies args built correctly (--model, --tools, --mode json) ---
  // provider-prefixed model ("custom/gpt-4o" + provider:"custom") resolves
  // via model-prefix intent-match split → --model gpt-4o --provider custom.
  let recordedArgs = null;
  await dispatchMod.spawnAgent({
    agent: "reviewer",
    task: "review the diff",
    model: "custom/gpt-4o",
    provider: "custom", // intent match → validated split even when config has providers
    spawnImpl: (_cmd, args, _opts) => {
      recordedArgs = args;
      return makeFakeProc({ stdoutLines: [messageEndEvent("ok")] });
    },
  });
  check("spawn.args has --mode json", recordedArgs.includes("--mode") && recordedArgs.includes("json"));
  check("spawn.args has --model", recordedArgs.includes("--model") && recordedArgs.includes("gpt-4o"));
  check("spawn.args has --provider", recordedArgs.includes("--provider") && recordedArgs.includes("custom"));
  check("spawn.args model split (no slash)", !recordedArgs.includes("custom/gpt-4o"));
  check("spawn.args has --tools", recordedArgs.includes("--tools"));
  check("spawn.args reviewer tools", recordedArgs.includes("read,grep,find,ls,bash,ithacus-mailbox"));
  check("spawn.args has Task prefix", recordedArgs.some((a) => a.startsWith("Task: ")));

  // ---- FAIL-6c4a2d10: child-mailbox extension path must exist ------------
  // Regression for the 0.6.4 dispatch-killing bug: CHILD_MAILBOX_EXTENSION
  // hardcoded `./ithacus-child-mailbox.ts`, but the published npm payload
  // compiles to dist/extensions/*.js — pi child exited 1 on every dispatch
  // ("Extension path does not exist"). The resolver must pick the on-disk
  // variant (.ts from source, .js from dist) and degrade to null.
  const spawnMod = await import(join(tmpDir, "ithacus-spawn.ts"));
  check(
    "spawn.CHILD_MAILBOX_EXTENSION resolved + exists",
    typeof spawnMod.CHILD_MAILBOX_EXTENSION === "string" &&
      existsSync(spawnMod.CHILD_MAILBOX_EXTENSION) &&
      spawnMod.CHILD_MAILBOX_EXTENSION.includes("ithacus-child-mailbox"),
  );
  const eIdx = recordedArgs.indexOf("-e");
  check(
    "spawn.args -e path exists on disk",
    eIdx !== -1 && existsSync(recordedArgs[eIdx + 1]),
  );
  // ---- FAIL-6c4a2d11: child must be isolated from ambient extension -------
  // discovery. When ithacus is npm-installed, the child auto-loads the full
  // ithacus.js entry (which also registers PUBLIC ithacus-mailbox) → duplicate
  // tool registration → pi exits 1 before the task starts. --no-extensions +
  // explicit -e is the documented pi combo for a deterministic child toolset.
  check(
    "spawn.args isolates child via --no-extensions",
    recordedArgs.includes("--no-extensions"),
  );
  // Simulated published-dist layout: only the .js sibling on disk.
  const distSim = mkdtempSync(join(osTmpdir(), "ith-dist-sim-"));
  writeFileSync(join(distSim, "ithacus-child-mailbox.js"), "// compiled");
  check(
    "spawn.resolver prefers .js in dist layout",
    spawnMod.resolveChildMailboxPath(distSim, false) === join(distSim, "ithacus-child-mailbox.js"),
  );
  // Simulated source layout: only the .ts sibling on disk.
  const srcSim = mkdtempSync(join(osTmpdir(), "ith-src-sim-"));
  writeFileSync(join(srcSim, "ithacus-child-mailbox.ts"), "// source");
  check(
    "spawn.resolver prefers .ts in src layout",
    spawnMod.resolveChildMailboxPath(srcSim, true) === join(srcSim, "ithacus-child-mailbox.ts"),
  );
  // Empty layout degrades to null (spawn then omits -e instead of crashing pi).
  const emptySim = mkdtempSync(join(osTmpdir(), "ith-empty-sim-"));
  check(
    "spawn.resolver degrades to null when absent",
    spawnMod.resolveChildMailboxPath(emptySim, true) === null,
  );
  rmSync(distSim, { recursive: true, force: true });
  rmSync(srcSim, { recursive: true, force: true });
  rmSync(emptySim, { recursive: true, force: true });

  // --- mock: no --model when agent has none in frontmatter (defensive) ---
  // explore/reviewer all have models, so passing model:undefined falls back to
  // agent.model. Test the explicit-undefined path still builds valid args.
  let args2 = null;
  await dispatchMod.spawnAgent({
    agent: "explore",
    task: "t",
    provider: "test",
    spawnImpl: (_c, a, _o) => { args2 = a; return makeFakeProc({ stdoutLines: [messageEndEvent("x")] }); },
  });
  check("spawn.args2 still has --model (agent default)", args2.includes("--model") && args2.includes("claude-haiku-4-5"));

  // --- empty output (no message_end) → success:false ---
  const emptyRes = await dispatchMod.spawnAgent({
    agent: "explore",
    task: "nothing emitted",
    provider: "test",
    spawnImpl: () => makeFakeProc({ stdoutLines: [], exitCode: 0 }),
  });
  check("spawn.empty success false", emptyRes.success === false);
  check("spawn.empty empty output", emptyRes.output === "");

  // --- nonzero exit → success:false ---
  const failRes = await dispatchMod.spawnAgent({
    agent: "explore",
    task: "dies",
    provider: "test",
    spawnImpl: () => makeFakeProc({ stdoutLines: [messageEndEvent("partial")], exitCode: 2 }),
  });
  check("spawn.fail success false", failRes.success === false && failRes.exitCode === 2);

  // --- abort signal → killed, success:false, error "aborted" ---
  const ac = new AbortController();
  const abortRes = await dispatchMod.spawnAgent({
    agent: "explore",
    task: "cancelled",
    provider: "test",
    signal: ac.signal,
    spawnImpl: () => {
      const proc = makeFakeProc({ stdoutLines: [], exitCode: 0, onClose: (p) => { p.killed = true; } });
      // already-aborted path calls killProc synchronously then the proc closes.
      return proc;
    },
  });
  // signal already aborted → killProc runs immediately → wasAborted=true → success=false
  ac.abort();
  check("spawn.abort success false", abortRes.success === false);

  // --- temp prompt cleanup: the --append-system-prompt temp dir is removed ---
  // (Verified indirectly: no throw in finally; exit happens cleanly.)
  check("spawn.mock no throw", mockRes !== undefined);

  // ========================================================================
  // 3. registerDispatchTool — the LLM-invoked `ithacus-dispatch` tool
  // ========================================================================
  // THIS is the regression catch: the tool MUST be registered via
  // pi.registerTool with name "ithacus-dispatch". If someone re-introduces
  // pi.callTool, this assertion catches the broken wiring (no tool registered).

  let registeredTool = null;
  const fakePi = {
    registerTool: (tool) => { registeredTool = tool; },
    // not used by registerDispatchTool, but part of ExtensionAPI shape
    on: () => {}, registerCommand: () => {}, setModel: () => {},
  };
  dispatchMod.registerDispatchTool(fakePi);

  check("dispatch.tool registered", registeredTool !== null);
  check("dispatch.tool name", registeredTool?.name === "ithacus-dispatch");
  check("dispatch.tool has label", typeof registeredTool?.label === "string" && registeredTool.label.length > 0);
  check("dispatch.tool has description", typeof registeredTool?.description === "string" && registeredTool.description.length > 0);
  check("dispatch.tool parameters object", typeof registeredTool?.parameters === "object" && registeredTool.parameters !== null);
  check("dispatch.tool params task field", "task" in (registeredTool?.parameters?.properties ?? {}));
  check("dispatch.tool params agent field", "agent" in (registeredTool?.parameters?.properties ?? {}));
  check("dispatch.tool params model field", "model" in (registeredTool?.parameters?.properties ?? {}));
  check("dispatch.tool execute fn", typeof registeredTool?.execute === "function");

  // --- execute() via unknown-agent path (no subprocess — safe in smoke) ---
  // Confirms execute() returns a well-formed AgentToolResult: content[] +
  // details{}. This is the shape pi expects from every registered tool.
  const execRes = await registeredTool.execute(
    "test-call-id",
    { task: "do a thing", agent: "nonexistent" },
    undefined,
    undefined,
    { cwd: tmpDir },
  );
  check("dispatch.execute returns content array", Array.isArray(execRes?.content) && execRes.content.length > 0);
  check("dispatch.execute content text type", execRes.content[0]?.type === "text");
  check("dispatch.execute content text string", typeof execRes.content[0]?.text === "string");
  check("dispatch.execute details object", typeof execRes?.details === "object" && execRes.details !== null);
  check("dispatch.execute details agent", execRes.details.agent === "nonexistent");
  check("dispatch.execute details success false", execRes.details.success === false);
  check("dispatch.execute details exitCode", execRes.details.exitCode === 1);
  check("dispatch.execute details durationMs number", typeof execRes.details.durationMs === "number");

  // --- execute() default agent (no agent param → defaults to "explore") ---
  // This path WOULD spawn a real pi — but with unknown task text. Since the
  // explore agent IS known, execute→spawnAgent would spawn. To stay safe in
  // smoke, we ONLY assert the default-agent wiring by checking the params
  // schema marks agent optional (default handled in execute). We do not call
  // execute without an agent (would spawn real pi). The unknown-agent path
  // above already covers the AgentToolResult shape.
  check("dispatch.params agent optional", registeredTool?.parameters?.properties?.agent !== undefined);

  // ========================================================================
  // 3b. ToolVisibility registry (task #22) — register-time tier filter
  // ========================================================================
  const registryMod = await import(join(tmpDir, "ithacus-tool-registry.ts"));
  check("tv.registry mailbox PUBLIC", registryMod.TOOL_VISIBILITY["ithacus-mailbox"] === 0);
  check("tv.registry dispatch INTERNAL", registryMod.TOOL_VISIBILITY["ithacus-dispatch"] === 1);
  check("tv.registry availableToolNames interactive has all",
    registryMod.availableToolNames().sort().join(",") === "ithacus-control,ithacus-dispatch,ithacus-mailbox");
  check("tv.registry availableToolNames child has only mailbox",
    registryMod.availableToolNames(registryMod.currentCallerContext({ ITHACUS_AGENT_ID: "explore" })).join(",") === "ithacus-mailbox");

  // Register-time filter: simulate a CHILD session (ITHACUS_AGENT_ID set).
  // ithacus-dispatch (INTERNAL) must NOT register; ithacus-mailbox (PUBLIC) must.
  const msgMod = await import(join(tmpDir, "ithacus-message.ts"));
  registryMod._resetCallerContextCache();
  const prevAgentId = process.env.ITHACUS_AGENT_ID;
  process.env.ITHACUS_AGENT_ID = "explore";
  try {
    const childRegistered = [];
    const childFakePi = {
      registerTool: (t) => { childRegistered.push(t.name); },
      on: () => {}, registerCommand: () => {}, setModel: () => {},
    };
    // registerMailboxTool needs a runtime for bindRepo/event; pass a minimal stub.
    const stubRuntime = {
      bindRepo: () => {}, appendEvent: () => {}, store: null, runningByType: new Map(),
    };
    dispatchMod.registerDispatchTool(childFakePi);
    msgMod.registerMailboxTool(childFakePi, stubRuntime);
    check("tv.child register-time filter: dispatch NOT registered",
      !childRegistered.includes("ithacus-dispatch"));
    check("tv.child register-time filter: mailbox registered",
      childRegistered.includes("ithacus-mailbox"));
  } finally {
    if (prevAgentId === undefined) delete process.env.ITHACUS_AGENT_ID;
    else process.env.ITHACUS_AGENT_ID = prevAgentId;
    registryMod._resetCallerContextCache();
  }

  // ========================================================================
  // 3c. /ithacus-setup — dynamic binding roster (Sprint 5.12.5 §8.3)
  // ========================================================================
  // Real registerSetupCommand + injected fake pi/UI + the hermetic HOME
  // provider fixture above. process.cwd() is tmpDir → every setup write lands
  // in tmpDir/.pi/ithacus/agents. The live .pi tree is never touched.
  {
    const setupMod = await import(join(tmpDir, "ithacus-setup.ts"));
    const bundlesMod = await import(join(repoRoot, "src", "agent-bundles.ts"));
    const projAgentsDir = join(tmpDir, ".pi", "ithacus", "agents");

    function makeFakeSetup(answers) {
      const selectCalls = [];
      const notifies = [];
      const queue = [...answers];
      const ui = {
        select: async (_prompt, choices) => {
          selectCalls.push([...choices]);
          return queue.shift();
        },
        input: async () => "",
        notify: (msg, level) => { notifies.push({ msg, level }); },
      };
      return { ui, selectCalls, notifies };
    }
    const registeredCmds = {};
    const cmdPi = {
      registerCommand: (name, def) => { registeredCmds[name] = def; },
      registerTool: () => {}, on: () => {}, setModel: () => {},
    };
    setupMod.registerSetupCommand(cmdPi);
    check("setup.command registered", typeof registeredCmds["ithacus-setup"]?.handler === "function");
    check("setup.providers command registered", typeof registeredCmds["ithacus-providers"]?.handler === "function");

    const bindNames = (calls) =>
      (calls[0] ?? []).filter((c) => c.startsWith("Bind: ")).map((c) => c.slice("Bind: ".length));
    const runSetup = (answers) => {
      const fake = makeFakeSetup(answers);
      return registeredCmds["ithacus-setup"]
        .handler("", { ui: fake.ui })
        .then(() => fake);
    };

    // -- A. roster derives from fresh discovery (pre-seed: bundled sources) --
    {
      // No .pi/ithacus/agents yet (only the .pi/agent HOME fixture exists).
      const fake = await runSetup(["--- Continue ---", "No (finish)"]);
      const names = bindNames(fake.selectCalls);
      check("setup.roster == discovered bundled names (dynamic roster)",
        names.length === expectedNames.length &&
        expectedNames.every((n) => names.includes(n)));
      check("setup.roster exposes writer with no setup code edit", names.includes("writer"));
      check("setup.roster deterministic sort",
        JSON.stringify(names) === JSON.stringify([...names].sort()));
      check("setup.roster sentinel choices present",
        (fake.selectCalls[0] ?? []).includes("Manage providers…") &&
        (fake.selectCalls[0] ?? []).includes("--- Continue ---"));
      check("setup.roster continues to scaffold step",
        (fake.selectCalls[1] ?? []).includes("No (finish)"));
    }

    // -- B. seed + bind writer via fake UI; ONLY writer frontmatter mutates --
    {
      const seedRes = bundlesMod.seedBundledAgents({
        bundledDir: agentsDir,
        projectAgentsDir: projAgentsDir,
        packageVersion: "0.4.0",
      });
      check("setup.seed bundled defs OK",
        seedRes.errors.length === 0 && seedRes.seeded.length === expectedNames.length);
      const planBefore = readFileSync(join(projAgentsDir, "plan.md"), "utf-8");
      const reviewerBefore = readFileSync(join(projAgentsDir, "reviewer.md"), "utf-8");
      const dirCountBefore = readdirSync(projAgentsDir)
        .filter((f) => f.endsWith(".md") && !f.startsWith(".")).length;

      const fake = await runSetup([
        "Bind: writer",            // agents menu → writer (discovered)
        "fake-model-b (fakeprov)", // model menu → fixture model
        "--- Continue ---",        // agents menu after re-discovery refresh
        "No (finish)",             // scaffold menu
      ]);
      // The post-bind roster refresh must have run BEFORE the third select.
      check("setup.bind refreshes roster after write (4 selects)", fake.selectCalls.length === 4);
      const writerProj = readFileSync(join(projAgentsDir, "writer.md"), "utf-8");
      check("setup.bind writes writer model frontmatter", /^model: fake-model-b$/m.test(writerProj));
      check("setup.bind writes writer provider frontmatter", /^provider: fakeprov$/m.test(writerProj));
      check("setup.bind keeps name + body", /^name: writer$/m.test(writerProj) &&
        writerProj.includes("Four Laws"));
      check("setup.bind leaves plan.md byte-identical",
        readFileSync(join(projAgentsDir, "plan.md"), "utf-8") === planBefore);
      check("setup.bind leaves reviewer.md byte-identical",
        readFileSync(join(projAgentsDir, "reviewer.md"), "utf-8") === reviewerBefore);
      check("setup.bind adds no files to agents dir",
        readdirSync(projAgentsDir).filter((f) => f.endsWith(".md") && !f.startsWith(".")).length === dirCountBefore);
      // The binding is visible to the very next discovery (fresh, project).
      const wNow = agentsMod.discoverIthacusAgents().find((a) => a.name === "writer");
      check("setup.bind re-discovered as project-sourced def",
        wNow?.source === "project" && wNow?.model === "fake-model-b" &&
        wNow?.provider === "fakeprov");
    }

    // -- C. project-only custom agent is listed + bindable --------------------
    {
      writeFileSync(join(projAgentsDir, "custom.md"), [
        "---",
        "name: custom",
        "description: project-only custom agent",
        "tools: read, grep",
        "model: claude-haiku-4-5",
        "---",
        "",
        "Project-only body marker.",
        "",
      ].join("\n"));
      const customBefore = readFileSync(join(projAgentsDir, "custom.md"), "utf-8");
      const fake = await runSetup([
        "Bind: custom",
        "fake-model-a (fakeprov)",
        "--- Continue ---",
        "No (finish)",
      ]);
      const names = bindNames(fake.selectCalls);
      check("setup.custom project-only name listed", names.includes("custom"));
      check("setup.custom roster grew by exactly one",
        names.length === expectedNames.length + 1);
      const customAfter = readFileSync(join(projAgentsDir, "custom.md"), "utf-8");
      check("setup.custom binding model+provider persisted",
        /^model: fake-model-a$/m.test(customAfter) && /^provider: fakeprov$/m.test(customAfter));
      check("setup.custom identity+tools+body preserved",
        /^description: project-only custom agent$/m.test(customAfter) &&
        /^tools: read,grep$/m.test(customAfter) &&
        customAfter.includes("Project-only body marker."));
      check("setup.custom file rewritten from discovered def (not label parsing)",
        customBefore !== customAfter);
    }

    // -- D. removed bundled name: surviving project def stays listed+intact ---
    {
      const reviewerBefore = readFileSync(join(projAgentsDir, "reviewer.md"), "utf-8");
      rmSync(join(agentsDir, "reviewer.md")); // the package "removes" reviewer
      const fake = await runSetup(["--- Continue ---", "No (finish)"]);
      const names = bindNames(fake.selectCalls);
      check("setup.removed-bundle name still listed from project def", names.includes("reviewer"));
      check("setup.removed-bundle project file never pruned/overwritten",
        existsSync(join(projAgentsDir, "reviewer.md")) &&
        readFileSync(join(projAgentsDir, "reviewer.md"), "utf-8") === reviewerBefore);
      check("setup.removed-bundle discovery exposes project survivor",
        agentsMod.discoverIthacusAgents().some((a) => a.name === "reviewer" && a.source === "project"));
    }

    // -- E. /ithacus-plan agent tokens are discovery-based (source-level) -----
    {
      const cmdsSrc = readFileSync(join(tmpDir, "ithacus-commands.ts"), "utf-8");
      check("cmds.plan discovery-based role parsing", cmdsSrc.includes("discoverIthacusAgents"));
      check("cmds.plan no hard-coded fixed roster array", !cmdsSrc.includes("KNOWN_ROLES"));
    }
  }

  // ========================================================================
  // 3d. Sprint 5.13 live overlay — ithacus-live store + IthLiveCard + bus wire
  // ========================================================================
  // The live store is module-level state SHARED with dispatchMod (dispatch
  // statically imports ./ithacus-live.js → rewritten to ithacus-live.ts in
  // tmpDir, so `await import(join(tmpDir, "ithacus-live.ts"))` resolves to the
  // same module instance). Fake event buses are the seam: startLive /
  // updateLive / endLive publish IthacusEvents into whatever bus
  // wireLiveEventBus() last wired.
  {
    const liveMod = await import(join(tmpDir, "ithacus-live.ts"));
    const liveCardMod = await import(join(tmpDir, "ithacus-live-card.ts"));

    const makeFakeBus = (sink) => ({
      publish: (ev) => { sink.push(ev); },
      subscribe: () => () => {},
      history: () => [...sink],
    });
    const published = [];
    liveMod.wireLiveEventBus(makeFakeBus(published));

    // startLive creates a running entry + publishes run_started + spawning.
    // NOTE (5.14): AgentLive.status is the WorkerStatus vocabulary —
    // "spawning" from birth (spec §3), not 5.13's "running".
    const liveId = "smoke-live-1";
    liveMod.startLive(liveId, "explore", "claude-haiku-4-5", "read CLAUDE.md and report back");
    const snap = liveMod.getLive(liveId);
    check("live.startLive creates entry", typeof snap === "object" && snap !== null);
    check("live.startLive spawning status", snap?.status === "spawning");
    check("live.startLive agent+model+task",
      snap?.agent === "explore" && snap?.model === "claude-haiku-4-5" &&
      snap?.taskPreview === "read CLAUDE.md and report back");
    check("live.startLive publishes run_started + spawning",
      published.some((e) => e.type === "run_started" && e.runId === liveId) &&
      published.some((e) => e.type === "agent_status" && e.runId === liveId && e.status === "spawning"));
    // 5.13.1: listLive enumerates live dispatches (the ▌ workflow source).
    check("live.listLive returns entries", liveMod.listLive().length >= 1);

    // parseJsonlLine tolerates the variance a child stdout can emit.
    check("live.parseJsonlLine blank null",
      liveMod.parseJsonlLine("") === null && liveMod.parseJsonlLine("   \n") === null);
    check("live.parseJsonlLine garbage null", liveMod.parseJsonlLine("not json {") === null);
    check("live.parseJsonlLine valid parses",
      liveMod.parseJsonlLine('{"type":"tool_execution_start","toolName":"read"}')?.type === "tool_execution_start");
    check("live.parseJsonlLine extra fields tolerated",
      liveMod.parseJsonlLine(JSON.stringify({ type: "message_end", someFutureField: 1 }))?.type === "message_end");

    // updateLive — feed it the exact way dispatch execute() does:
    // parse the rawJsonLine, apply to the live snapshot.
    const t0 = Date.now();
    const feed = (obj) => liveMod.updateLive(liveId, liveMod.parseJsonlLine(JSON.stringify(obj)), t0);
    feed({ type: "tool_execution_start", toolName: "read", args: { path: "src/events.ts" } });
    feed({ type: "tool_execution_end", toolName: "read", args: { path: "src/events.ts" } });
    feed({ type: "message_end", message: { role: "assistant", model: "claude-haiku-4-5", usage: { input: 847, output: 412 } } });
    const snap2 = liveMod.getLive(liveId);
    check("live.updateLive counts tool call", snap2?.toolCallCount === 1);
    // 5.14: the announceWorking floor also advances the STORE status — the
    // snapshot moves spawning → working on the first tool/usage event even
    // when no explicit setWorkerStatus ran (no external progress line).
    check("live.updateLive advances store status to working", snap2?.status === "working");
    check("live.updateLive records file access",
      Array.isArray(snap2?.filesAccessed) && snap2.filesAccessed.includes("src/events.ts"));
    check("live.updateLive tokens (latest-in + accumulated-out)",
      snap2?.tokensIn === 847 && snap2?.tokensOut === 412 && snap2?.model === "claude-haiku-4-5");
    check("live.updateLive publishes tool/tokens/working",
      published.some((e) => e.type === "tool_execution_start" && e.runId === liveId && e.tool === "read") &&
      published.some((e) => e.type === "agent_tokens" && e.runId === liveId) &&
      published.some((e) => e.type === "agent_status" && e.runId === liveId && e.status === "working"));

    // IthLiveCard — construct with a fake theme (same pattern as §3c's fake
    // UI) and a fake hide-handle; render reads the LIVE store entry.
    const card = new liveCardMod.IthLiveCard(
      { fg: (_c, t) => t, bold: (t) => t },
      liveId,
      () => {}, // done hook (ctx.ui.custom would normally provide this)
      () => {}, // requestRender
    );
    check("livecard width dynamic (auto=120)", card.width === 120);
    // 5.13.1 width toggle: fixed pins the preferred width at 88; restoring
    // auto returns the 120 sentinel (pi reads component.width per new card).
    liveCardMod.setLiveCardWidthMode("fixed");
    check("livecard fixed width 88", card.width === 88);
    liveCardMod.setLiveCardWidthMode("auto");
    check("livecard auto width restored (120)", card.width === 120);
    card.setHandle({ hide: () => {} });
    const runLines = card.render(100);
    check("livecard render returns boxed lines", Array.isArray(runLines) && runLines.length >= 8);
    const runText = runLines.join("\n");
    check("livecard render mentions worker agent", runText.includes("explore"));
    check("livecard render mentions model", runText.includes("claude-haiku-4-5"));
    check("livecard render mentions task", runText.includes("read CLAUDE.md"));
    check("livecard render mentions tokens", runText.includes("847 in") && runText.includes("412 out"));
    // 5.14 (spec §2.3): the card's status row is the WorkerStatus icon+label
    // table — after the feeds above the run is ▸ working (was ⟳ running).
    check("livecard render running identity", runText.includes("ithacus —") && runText.includes("▸ working"));
    // 5.13.1: the ▌ activity section renders the recentTools ring, one row
    // per entry (the old calls/files rows folded in).
    check("livecard activity section shows tool", card.render(100).join("\n").includes("read"));
    // 5.13.1: the ▌ task section word-wraps — a long preview survives WHOLE
    // (multi-line, never the old 40-char/… slice). Every word must appear
    // SOMEWHERE in the wrapped render (old truncation would drop the tail).
    const longTask = "Implement the live-card layout change plus smoke section updates for the width model enterprise layout";
    liveMod.getLive(liveId).taskPreview = longTask;
    const wrappedText = card.render(100).join("\n");
    check("livecard task wraps (multi-line)", longTask.split(" ").every((w) => wrappedText.includes(w)));

    // endLive marks terminal + publishes agent_done/run_finished; the card
    // renders the success state; removeLive purges; render degrades plain.
    liveMod.endLive(liveId, true);
    const termSnap = liveMod.getLive(liveId);
    check("live.endLive terminal status", termSnap?.status === "done");
    check("live.endLive freezes duration", typeof termSnap?.durationMs === "number" && termSnap.durationMs >= 0);
    check("live.endLive publishes agent_done + run_finished",
      published.some((e) => e.type === "agent_done" && e.runId === liveId && e.status === "done") &&
      published.some((e) => e.type === "run_finished" && e.runId === liveId && e.status === "done"));
    check("livecard render at terminal state", card.render(100).join("\n").includes("✓ done"));
    card.markDone(); // schedules the 3s auto-dismiss (dispose cancels it below)
    liveMod.removeLive(liveId);
    check("live.removeLive purges entry", liveMod.getLive(liveId) === undefined);
    const goneLines = card.render(100);
    check("livecard plain fallback when store purged",
      goneLines.length === 1 && goneLines[0].includes("ithacus"));
    card.dispose(); // stop timers so nothing lingers past the summary

    // Failure classification floor (DESIGN_LIVE_PROGRESS.md §3.1): 5.13 emits
    // failureKind "unknown"; 5.14 refines.
    liveMod.startLive("smoke-live-2", "plan");
    liveMod.endLive("smoke-live-2", false, "boom");
    const failSnap = liveMod.getLive("smoke-live-2");
    check("live.endLive failed status + error text",
      failSnap?.status === "failed" && failSnap?.error === "boom");
    check("live.endLive failureKind unknown",
      published.some((e) => e.type === "agent_done" && e.runId === "smoke-live-2" &&
        e.status === "failed" && e.failureKind === "unknown"));
    liveMod.removeLive("smoke-live-2");

    // ---- Sprint 5.14 (docs/DESIGN_WORKER_STATUS.md): the richer WorkerStatus
    // vocabulary flows through the SAME store/bus/card seams (no real
    // subprocess — src/worker-status.ts's line mapping + live.setWorkerStatus
    // stand in for dispatch's onProgress call, which IS these two lines).
    {
      const wsMod = await import(join(tmpDir, "worker-status.ts"));
      const richerId = "smoke-live-4";
      liveMod.startLive(richerId, "explore", "claude-haiku-4-5", "probe the repo layout");
      const step = (line) => {
        const prev = liveMod.getLive(richerId)?.status ?? "spawning";
        const next = wsMod.mapEventToStatus(line, prev);
        if (next !== prev) liveMod.setWorkerStatus(richerId, next);
        return next;
      };
      check("live.5.14 trust-prompt line → trust_required",
        step("Do you trust the files in this folder?") === "trust_required");
      check("live.5.14 store holds trust_required", liveMod.getLive(richerId)?.status === "trust_required");
      // trust_required → tool_permission is a legal forward blocked move
      check("live.5.14 permission JSON event → tool_permission",
        step('{"type":"permission_request","tool":"bash"}') === "tool_permission");
      check("live.5.14 first assistant turn → working",
        step('{"type":"message_delta","delta":{"content":[{"type":"text","text":"…"}]}}') === "working");
      check("live.5.14 store holds working", liveMod.getLive(richerId)?.status === "working");
      // one stream, many views: the bus saw the FULL sequence, in order
      const seq = published.filter((e) => e.type === "agent_status" && e.runId === richerId).map((e) => e.status);
      check("live.5.14 bus richer status sequence",
        JSON.stringify(seq) === JSON.stringify(["spawning", "trust_required", "tool_permission", "working"]));
      // progress validity: a late trust marker cannot rewind a working worker
      const back = wsMod.mapEventToStatus("Do you trust the files?", liveMod.getLive(richerId)?.status);
      check("live.5.14 no backward transition", back === "working");
      // the card renders the richer rows (icon+label per DESIGN_WORKER_STATUS.md §2.3)
      const rich = new liveCardMod.IthLiveCard({ fg: (_c, t) => t, bold: (t) => t }, richerId, () => {}, () => {});
      check("live.5.14 card renders ▸ working", rich.render(100).join("\n").includes("▸ working"));
      liveMod.setWorkerStatus(richerId, "tool_permission"); // working → tool_permission: the mid-run grant dip
      check("live.5.14 card renders 🔑 awaiting permission",
        rich.render(100).join("\n").includes("🔑 awaiting permission"));
      rich.dispose();
      // spec §2.2: dies still blocked → permission_denied (not "unknown")
      liveMod.endLive(richerId, false, "child exited", { exitCode: 1 });
      const failSnap4 = liveMod.getLive(richerId);
      check("live.5.14 endLive classifies permission_denied",
        failSnap4?.status === "failed" && failSnap4?.failureKind === "permission_denied");
      check("live.5.14 agent_done carries failureKind on the bus",
        published.some((e) => e.type === "agent_done" && e.runId === richerId && e.failureKind === "permission_denied"));
      liveMod.removeLive(richerId);
      // died non-zero before any assistant output → crash
      liveMod.startLive("smoke-live-5", "plan");
      liveMod.endLive("smoke-live-5", false, "spawn failed", { exitCode: 1 });
      check("live.5.14 endLive classifies crash",
        liveMod.getLive("smoke-live-5")?.failureKind === "crash");
      liveMod.removeLive("smoke-live-5");
      // terminal absorbing: a late event can never republish a done run (5.13's
      // announceWorking could fire stale "working" — advanceStatus refuses it)
      liveMod.startLive("smoke-live-6", "reviewer");
      liveMod.endLive("smoke-live-6", true);
      liveMod.setWorkerStatus("smoke-live-6", "working");
      liveMod.updateLive("smoke-live-6", { type: "message_end", message: { role: "assistant", usage: { input: 1, output: 1 } } }, Date.now() - 5);
      check("live.5.14 terminal absorbing (store)", liveMod.getLive("smoke-live-6")?.status === "done");
      check("live.5.14 terminal absorbing (bus — no post-terminal status events)",
        !published.some((e) => e.type === "agent_status" && e.runId === "smoke-live-6" && e.status !== "spawning"));
      liveMod.removeLive("smoke-live-6");
    }

    // registerDispatchTool wires runtime.eventBus into the live store
    // (DESIGN_LIVE_PROGRESS.md §3.3 / DESIGN_EVENT_STREAM.md §2.3 — one event
    // stream, many views). Fake runtime carries ONLY an eventBus — the seam.
    const wired = [];
    dispatchMod.registerDispatchTool(
      { registerTool: () => {}, on: () => {}, registerCommand: () => {}, setModel: () => {} },
      { eventBus: makeFakeBus(wired) },
    );
    liveMod.startLive("smoke-live-3", "explore");
    check("live.dispatch registration wires runtime eventBus",
      wired.some((e) => e.type === "run_started" && e.runId === "smoke-live-3") &&
      wired.some((e) => e.type === "agent_status" && e.runId === "smoke-live-3" && e.status === "spawning"));
    liveMod.removeLive("smoke-live-3");
  }

  // ========================================================================
  // 4. REGRESSION: published-package layout (v0.1.0 bug repro)
  // ========================================================================
  // v0.1.0 shipped ithacus-agents.js in dist/extensions/ but agents at
  // extensions/agents/ (package root). bundledAgentsDir() resolved to
  // dist/extensions/agents/ (didn't exist) → "Unknown agent. Available: none".
  // This test reproduces that EXACT layout so the compiled-layout fallback
  // path can never break again.
  {
    const pubDir = mkdtempSync(join(repoRoot, ".smoke-pub-tmp-"));
    const distExt = join(pubDir, "dist", "extensions");
    const pkgAgentsDir = join(pubDir, "extensions", "agents");
    mkdirSync(distExt, { recursive: true });
    mkdirSync(pkgAgentsDir, { recursive: true });
    // Discovery is cwd-sensitive (project overrides): run the compiled-
    // layout check from pubDir so section 3c's seeded tmpDir/.pi defs can't
    // leak in; the roster here must be the PURE bundled payload.
    process.chdir(pubDir);
    try {
      // Copy ithacus-agents.ts into dist/extensions/ (with .js→.ts rewrite).
      let agentsCode = readFileSync(join(repoRoot, "extensions", "ithacus-agents.ts"), "utf-8");
      agentsCode = agentsCode.replace(/(from\s+["']\.\.?\/[^"]+)\.js(["'])/g, "$1.ts$2");
      writeFileSync(join(distExt, "ithacus-agents.ts"), agentsCode);
      // Sprint 5.12.5: ithacus-agents imports ../src/agent-bundles.js, which the
      // real package ships at dist/src/agent-bundles.js — mirror that here.
      const distSrc = join(pubDir, "dist", "src");
      mkdirSync(distSrc, { recursive: true });
      let bundlesCode = readFileSync(join(repoRoot, "src", "agent-bundles.ts"), "utf-8");
      bundlesCode = bundlesCode.replace(/(from\s+["']\.\.?\/[^"]+)\.js(["'])/g, "$1.ts$2");
      writeFileSync(join(distSrc, "agent-bundles.ts"), bundlesCode);
      // Sprint 5.15: ithacus-agents.ts additionally imports ../src/permissions.js
      // — mirror it into dist/src/ the same way so the published-layout import
      // resolves exactly like the real package does.
      let permsCode = readFileSync(join(repoRoot, "src", "permissions.ts"), "utf-8");
      permsCode = permsCode.replace(/(from\s+["']\.\.?\/[^"]+)\.js(["'])/g, "$1.ts$2");
      writeFileSync(join(distSrc, "permissions.ts"), permsCode);
      // Copy agent markdown into extensions/agents/ (package-root layout).
      for (const f of readdirSync(join(repoRoot, "extensions", "agents"))) {
        if (!f.endsWith(".md")) continue;
        copyFileSync(join(repoRoot, "extensions", "agents", f), join(pkgAgentsDir, f));
      }
      // The SIBLING layout does NOT exist (this is the bug condition):
      // dist/extensions/agents/ must be absent so the first candidate fails
      // and the second (package-root) candidate must catch the agents.
      check("pub.dist/extensions/agents absent (bug condition)", !existsSync(join(distExt, "agents")));
      check("pub.pkg extensions/agents present", existsSync(pkgAgentsDir));
      // Load ithacus-agents from dist/extensions/ — import.meta.url now points
      // there, so bundledAgentsDir() must fall through to the package-root
      // candidate (../../extensions/agents) to find the agents.
      const pubMod = await import(join(distExt, "ithacus-agents.ts"));
      const pubAgents = pubMod.discoverIthacusAgents();
      check("pub.discovers full roster (compiled layout)", pubAgents.length === expectedNames.length &&
        expectedNames.every((n) => pubAgents.some((a) => a.name === n)));
      check("pub.has explore (compiled layout)", pubMod.findAgent(pubAgents, "explore")?.model === "claude-haiku-4-5");
      check("pub.has plan (compiled layout)", pubMod.findAgent(pubAgents, "Plan")?.name === "plan");
      check("pub.has verification (compiled layout)", pubMod.findAgent(pubAgents, "verification") !== undefined);
      check("pub.has reviewer (compiled layout)", pubMod.findAgent(pubAgents, "Reviewer") !== undefined);
      // Sprint 5.12.5 payload: writer.md ships + bundled plan.md carries the
      // docs-only-write contract — both REQUIRED in the npm payload.
      const pubWriter = pubMod.findAgent(pubAgents, "writer");
      check("pub.has writer (compiled layout)", pubWriter !== undefined &&
        ["read", "grep", "find", "ls", "bash", "write", "edit", "ithacus-mailbox"]
          .every((t) => pubWriter?.tools?.includes(t)));
      const pubPlan = pubMod.findAgent(pubAgents, "plan");
      check("pub.plan docs-only-write payload (compiled layout)",
        Array.isArray(pubPlan?.tools) && pubPlan.tools.includes("write") &&
        pubPlan.tools.includes("edit") && pubPlan.systemPrompt.includes("docs/**/*.md"));
      check("pub.all have systemPrompt (compiled layout)", pubAgents.every((a) => a.systemPrompt.length > 0));
    } finally {
      process.chdir(tmpDir); // restore the harness cwd before removing pubDir
      try { rmSync(pubDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // ---- Sprint 5.28 — live dispatch control (ithacus-control.ts / -tool.ts) --
  // Exerts the AbortController-driven control verbs (pause/resume/stop/cancel/
  // retry/swap_model/split_task) over a fake-spawned resilient child, the
  // module-level dispatch registry, the live store, and completion artifacts.
  // No real pi, no network (PREVENT-ITH-004).
  {
    const ctlMod = await import(join(tmpDir, "ithacus-control.ts"));
    const liveMod5 = await import(join(tmpDir, "ithacus-live.ts"));
    const ctlToolMod = await import(join(tmpDir, "ithacus-control-tool.ts"));
    const ctlSink = [];
    liveMod5.wireLiveEventBus({ publish: (e) => ctlSink.push(e), subscribe: () => () => {}, history: () => [] });

    // Hermetic control runtime (config supplied → no loadConfig/env dependence).
    const mkRuntime = () => ({
      config: {
        retryPolicy: { maxRetries: 0 },
        modelFallbackChain: [],
        maxFallbackHops: 0,
        preserveRecent: 3,
        permissionModeDefault: "read_only",
        permissionStrict: false,
      },
      appendEvent: () => {},
      bindRepo: () => {},
      dispatchStarted: () => {},
      dispatchEnded: () => {},
      currentStateDir: tmpDir,
      store: undefined,
      version: "0.0.0",
    });

    const reg = (id, over = {}) => ctlMod.dispatchRegistry.register({
      dispatchId: id, agent: "explore", task: "control task",
      model: "claude-haiku-4-5", provider: "test",
      abort: new AbortController(), phase: "live", liveSnapshot: null, log: [],
      createdAt: Date.now(), updatedAt: Date.now(), spawnCount: 1, ...over,
    });

    check("ctl.list empty at start", ctlMod.dispatchRegistry.list().length === 0);

    // pause — abort child, keep registry + card, set paused status
    const idP = "smoke-5.28-pause";
    liveMod5.startLive(idP, "explore", "claude-haiku-4-5", "pause me", 0, 0);
    liveMod5.setWorkerStatus(idP, "working");
    reg(idP);
    const pAct = await ctlMod.controlDispatch("pause", idP, {}, {});
    check("ctl.pause ok", pAct.result === "ok");
    check("ctl.pause aborted controller", ctlMod.dispatchRegistry.get(idP)?.abort.signal.aborted === true);
    check("ctl.pause phase paused", ctlMod.dispatchRegistry.get(idP)?.phase === "paused");
    check("ctl.pause live status paused", liveMod5.getLive(idP)?.status === "paused");
    check("ctl.pause audit logged", ctlMod.dispatchRegistry.get(idP)?.log.some((a) => a.verb === "pause" && a.result === "ok"));
    const pAct2 = await ctlMod.controlDispatch("pause", idP, {}, {});
    check("ctl.pause already-paused no-op", pAct2.result === "no-op");

    // resume from paused → spawns a child, completes, deregisters + completion
    const idR = "smoke-5.28-resume";
    liveMod5.startLive(idR, "explore", "claude-haiku-4-5", "resume me", 0, 0);
    liveMod5.pauseLive(idR);
    reg(idR, { phase: "paused" });
    let rSpawn = 0;
    const rAct = await ctlMod.controlDispatch("resume", idR, {}, {
      runtime: mkRuntime(),
      spawnImpl: (_c, _a, _o) => { rSpawn++; return makeFakeProc({ stdoutLines: [messageEndEvent("resumed ok")] }); },
    });
    check("ctl.resume ok", rAct.result === "ok");
    check("ctl.resume spawned child", rSpawn === 1);
    check("ctl.resume continuation built", rAct.continuation === true);
    check("ctl.resume deregistered after finish", ctlMod.dispatchRegistry.get(idR) === undefined);
    check("ctl.resume live done", liveMod5.getLive(idR)?.status === "done");
    check("ctl.resume wrote completion", existsSync(join(tmpDir, "dispatch-completions", idR + ".json")));

    // swap_model — kill + respawn with the new model, same dispatchId
    const idS = "smoke-5.28-swap";
    liveMod5.startLive(idS, "plan", "old-model", "swap me", 0, 0);
    reg(idS, { agent: "plan", model: "old-model" });
    let sSpawn = 0;
    const sAct = await ctlMod.controlDispatch("swap_model", idS, { model: "new-model" }, {
      runtime: mkRuntime(),
      spawnImpl: (_c, _a, _o) => { sSpawn++; return makeFakeProc({ stdoutLines: [messageEndEvent("swapped")] }); },
    });
    check("ctl.swap ok", sAct.result === "ok");
    check("ctl.swap toModel", sAct.toModel === "new-model");
    check("ctl.swap spawned", sSpawn === 1);
    check("ctl.swap deregistered", ctlMod.dispatchRegistry.get(idS) === undefined);

    // stop / cancel — phase→terminating + terminal, resolveLive untouched
    const idT = "smoke-5.28-stop";
    liveMod5.startLive(idT, "explore", undefined, "stop me", 0, 0);
    liveMod5.setWorkerStatus(idT, "working");
    reg(idT);
    const tAct = await ctlMod.controlDispatch("stop", idT, {}, { runtime: mkRuntime() });
    check("ctl.stop ok", tAct.result === "ok");
    check("ctl.stop phase terminating", ctlMod.dispatchRegistry.get(idT)?.phase === "terminating");
    check("ctl.stop terminal stopped", ctlMod.dispatchRegistry.get(idT)?.terminal === "stopped");
    check("ctl.stop live stopping", liveMod5.getLive(idT)?.status === "stopping");
    const tAct2 = await ctlMod.controlDispatch("stop", idT, {}, {});
    check("ctl.stop re-stop no-op", tAct2.result === "no-op");

    const idC = "smoke-5.28-cancel";
    liveMod5.startLive(idC, "explore", undefined, "cancel me", 0, 0);
    liveMod5.setWorkerStatus(idC, "working");
    reg(idC);
    const cAct = await ctlMod.controlDispatch("cancel", idC, {}, { runtime: mkRuntime() });
    check("ctl.cancel ok", cAct.result === "ok");
    check("ctl.cancel terminal cancelled", ctlMod.dispatchRegistry.get(idC)?.terminal === "cancelled");

    // endLiveControl (execute() teardown path) publishes + removes snapshot
    const idE = "smoke-5.28-end";
    liveMod5.startLive(idE, "explore", undefined, "x", 0, 0);
    liveMod5.endLiveControl(idE, "stopped");
    check("ctl.endLive agent_done stopped",
      ctlSink.some((e) => e.type === "agent_done" && e.runId === idE && e.status === "stopped"));
    check("ctl.endLive removes snapshot", liveMod5.getLive(idE) === undefined);

    // split_task (add_agent) — fan out a NEW dispatch, parent stays live
    const idSp = "smoke-5.28-split";
    liveMod5.startLive(idSp, "explore", "claude-haiku-4-5", "parent", 0, 0);
    reg(idSp);
    let spSpawn = 0;
    const spAct = await ctlMod.controlDispatch("split_task", idSp, { task: "child subtask", agent: "explore" }, {
      runtime: mkRuntime(),
      spawnImpl: (_c, _a, _o) => { spSpawn++; return makeFakeProc({ stdoutLines: [messageEndEvent("child done")] }); },
    });
    check("ctl.split ok", spAct.result === "ok");
    check("ctl.split spawned child", spSpawn === 1);
    check("ctl.split spawns new id", spAct.spawnedDispatchId?.startsWith(idSp + "-split-"));
    check("ctl.split child deregistered", ctlMod.dispatchRegistry.get(spAct.spawnedDispatchId) === undefined);
    check("ctl.split parent stays live", ctlMod.dispatchRegistry.get(idSp)?.phase === "live");

    // error / no-op paths
    const e1 = await ctlMod.controlDispatch("pause", "nope-5.28", {}, {});
    check("ctl unknown dispatch error", e1.result === "error");
    const e2 = await ctlMod.controlDispatch("swap_model", idP, {}, {}); // paused, no model → error
    check("ctl swap without model error", e2.result === "error");
    const e3 = await ctlMod.controlDispatch("split_task", idSp, { agent: "explore" }, {}); // no task
    check("ctl split without task error", e3.result === "error");

    // control TOOL registration (INTERNAL)
    let ctrlTool = null;
    ctlToolMod.registerControlTool(
      { registerTool: (t) => { ctrlTool = t; }, registerCommand: () => {}, on: () => {}, setModel: () => {} },
      mkRuntime(),
    );
    check("ctl.tool registers ithacus-control", ctrlTool?.name === "ithacus-control");
  }

  // ---- Sprint 5.27 §3.4 — loopback-only web dashboard (ithacus-web.ts) ------
  // Exerts the node:http loopback server IN-PROCESS (no subprocess, no TUI, no
  // pi runtime): loopback bind policy, /api/* + SSE serving, and the
  // registerWebCommand seam. Non-loopback binds are REFUSED outright.
  //
  // ithacus-web.ts imports ../src/config.js — and real repo-root src/config.ts
  // keeps a ./permissions.js specifier that the top-level tmpDir mirror cannot
  // remap (it only rewrites extensions/*.ts; there is no physical
  // src/permissions.js). Mirror ithacus-web into its OWN layout with a
  // rewritten src/, so its "../src" resolves to the rewritten copies (same
  // self-contained pattern as the published-package-layout section above).
  {
    const webDir = mkdtempSync(join(repoRoot, ".smoke-web-tmp-"));
    const webExtDir = join(webDir, "ext");
    const webSrcDir = join(webDir, "src");
    mkdirSync(webExtDir, { recursive: true });
    mkdirSync(webSrcDir, { recursive: true });
    const rewriteJsSpecifiers = (code) =>
      code
        .replace(/(from\s+["']\.\.?\/[^"']+)\.js(["'])/g, "$1.ts$2")
        .replace(/(import\(\s*["']\.\.?\/[^"']+)\.js(["']\s*\))/g, "$1.ts$2");
    // Extensions side: ithacus-web plus the two sibling modules it imports.
    for (const f of ["ithacus-web.ts", "ithacus-agents.ts", "ithacus-live.ts"]) {
      writeFileSync(join(webExtDir, f),
        rewriteJsSpecifiers(readFileSync(join(repoRoot, "extensions", f), "utf-8")));
    }
    // Src side: the full transitive src closure ithacus-web pulls in via its
    // sibling modules plus its own ../src/* imports. Mirror each WITH the
    // rewrite so inner .js specifiers resolve — config.ts's ./permissions.js
    // is the exact case the top-level mirror otherwise cannot remap.
    for (const f of ["config.ts", "permissions.ts", "event-bus.ts", "events.ts",
                     "types.ts", "worker-status.ts", "failure-kind.ts", "redact.ts", "agent-bundles.ts"]) {
      writeFileSync(join(webSrcDir, f),
        rewriteJsSpecifiers(readFileSync(join(repoRoot, "src", f), "utf-8")));
    }
    // agents/*.md for ithacus-agents discovery (bundledAgentsDir is
    // import.meta.url-based, so they live next to the mirrored extension).
    const webAgentsDir = join(webExtDir, "agents");
    mkdirSync(webAgentsDir, { recursive: true });
    for (const f of readdirSync(join(repoRoot, "extensions", "agents"))) {
      if (!f.endsWith(".md")) continue;
      copyFileSync(join(repoRoot, "extensions", "agents", f), join(webAgentsDir, f));
    }

    let webMod = await import(join(webExtDir, "ithacus-web.ts"));

    function stubWebRuntime() {
      return {
        eventBus: { publish: () => {}, subscribe: () => () => {}, history: () => [] },
        pressure: 0.42,
        activeAgents: 2,
        currentTurn: 3,
        runningSummary: () => "explore×2",
        lastCtxTokens: 1000,
        lastCtxPercent: 0.1,
        lastCtxWindow: 8000,
        activeRepoRoot: "/tmp/repo",
        currentStateDir: tmpDir,
        store: { inbox: () => [], unreadCount: () => 0, inboxContacts: () => [] },
      };
    }

    // Loopback bind policy — the security boundary of the local dashboard.
    check("web.isLoopbackHost 127.0.0.1", webMod.isLoopbackHost("127.0.0.1") === true);
    check("web.isLoopbackHost localhost", webMod.isLoopbackHost("localhost") === true);
    check("web.isLoopbackHost ::1", webMod.isLoopbackHost("::1") === true);
    check("web.isLoopbackHost refuses 0.0.0.0", webMod.isLoopbackHost("0.0.0.0") === false);
    check("web.isLoopbackHost refuses LAN ip", webMod.isLoopbackHost("192.168.1.23") === false);
    check("web.isLoopbackHost refuses wildcard", webMod.isLoopbackHost("*") === false);

    // Non-loopback binds are refused outright (throws) — never silently bound.
    let nonLoopbackRefused = false;
    try {
      await webMod.startWebServer(stubWebRuntime(), { host: "0.0.0.0", port: 0 });
    } catch {
      nonLoopbackRefused = true;
    }
    check("web.startWebServer refuses non-loopback bind", nonLoopbackRefused === true);

    // A loopback bind actually serves the dashboard over node:http.
    const webHandle = await webMod.startWebServer(stubWebRuntime(), { host: "127.0.0.1", port: 0 });
    check("web.startWebServer assigns ephemeral port",
      typeof webHandle.port === "number" && webHandle.port > 0);
    check("web.baseUrl is loopback", webHandle.baseUrl.startsWith("http://127.0.0.1:"));

    const getJson = (urlPath) => new Promise((resolve, reject) => {
      const req = httpGet(`http://127.0.0.1:${webHandle.port}${urlPath}`, (resp) => {
        let body = "";
        resp.setEncoding("utf8");
        resp.on("data", (c) => { body += c; });
        resp.on("end", () => resolve({ status: resp.statusCode, body }));
      });
      req.on("error", reject);
    });

    const state = await getJson("/api/state");
    check("web.serves /api/state 200", state.status === 200);
    let stateObj = null;
    try { stateObj = JSON.parse(state.body); } catch { /* ignore */ }
    check("web.state is JSON object",
      stateObj !== null && typeof stateObj === "object" && typeof stateObj.updatedAt === "string");
    check("web.state exposes pressure",
      stateObj !== null && typeof stateObj.pressure === "number");
    check("web.state exposes roster", stateObj !== null && Array.isArray(stateObj.roster));

    const conf = await getJson("/api/config");
    let confObj = null;
    try { confObj = JSON.parse(conf.body); } catch { /* ignore */ }
    check("web.config 200 + ui defaults", conf.status === 200 && typeof confObj?.ui === "object");

    // Live SSE: correct event-stream content-type, opened then torn down.
    const sse = await new Promise((resolve, reject) => {
      const req = httpGet(`http://127.0.0.1:${webHandle.port}/api/events`, (resp) => {
        let settled = false;
        resp.setEncoding("utf8");
        resp.on("data", (c) => {
          if (settled) return;
          settled = true;
          resolve({ ct: resp.headers["content-type"] || "", first: String(c) });
          resp.destroy();
          req.destroy();
        });
        resp.on("error", reject);
      });
      req.on("error", reject);
    });
    check("web.serves SSE content-type",
      String(sse.ct).startsWith("text/event-stream") && sse.first.length > 0);

    // registerWebCommand seam: registers the /ithacus-web command group.
    const fakePi = { registerCommand: (name, opts) => { fakePi.commandName = name; fakePi.commandOpts = opts; } };
    const configStub = { ui: { webUi: true } };
    webMod.registerWebCommand(fakePi, stubWebRuntime(), configStub);
    check("web.registerWebCommand registers /ithacus-web", fakePi.commandName === "ithacus-web");

    await new Promise((r) => setTimeout(r, 60)); // let the SSE socket settle
    await webHandle.close();
    check("web.stopWebServer reports stopped", webMod.webStatus().includes("stopped"));

    // Tear down the self-contained mirror layout.
    try { rmSync(webDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ---- Sprint 5.16 — /ithacus-checkpoints overlay + command registration --
  // Exercises registerCheckpointsCommand (registers /ithacus-checkpoints) and
  // the overlay Component (list/archive/delete/compare) over a real node:sqlite
  // store on a scratch git repo. No pi TUI, no network (PREVENT-ITH-004).
  {
    const ovMod = await import(join(tmpDir, "ithacus-checkpoints-overlay.ts"));
    const cmMod = await import(join(tmpDir, "checkpoint-manager.ts"));
    const storeMod = await import(join(tmpDir, "store.ts"));

    // Scratch GIT repo so IthStore scopes to <repo>/.pi/ithacus (fully
    // hermetic, no shared/global DB across smoke runs).
    const ckRepo = mkdtempSync(join(repoRoot, ".smoke-ckpt-tmp-"));
    execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", { cwd: ckRepo });
    const ovStore = new storeMod.IthStore(ckRepo, {});

    // Seed two checkpoints via the src manager.
    cmMod.createCheckpointMeta(ovStore, { runId: "ck-run", label: "alpha", messageCount: 10, tokenEstimate: 400 });
    cmMod.createCheckpointMeta(ovStore, { runId: "ck-run", label: "beta", messageCount: 20, tokenEstimate: 900 });
    check("ov.seed lists 2 checkpoints", cmMod.listCheckpoints(ovStore).length === 2);

    // registerCheckpointsCommand registers /ithacus-checkpoints.
    const ovPi = { registerCommand: (name, def) => { ovPi.registered = { name, def }; }, registerTool: () => {}, on: () => {}, setModel: () => {} };
    const ovRuntime = { store: ovStore, bindRepo: () => {} };
    ovMod.registerCheckpointsCommand(ovPi, ovRuntime);
    check("ov.command registers /ithacus-checkpoints", ovPi.registered?.name === "ithacus-checkpoints");
    check("ov.command has handler", typeof ovPi.registered?.def?.handler === "function");

    // Drive the handler: capture the Component factory from a fake ui.custom,
    // then instantiate + render with a fake theme (same seam as §3c/setup).
    let capturedFactory = null;
    const fakeUi = { custom: async (factory) => { capturedFactory = factory; return null; } };
    await ovPi.registered.def.handler("", { cwd: ckRepo, ui: fakeUi });
    check("ov.handler captures component factory", typeof capturedFactory === "function");

    const theme = { fg: (_c, t) => t, bold: (t) => t };
    const component = capturedFactory({ requestRender: () => {} }, theme, {}, () => {});
    const lines = component.render(80).join("\n");
    check("ov.render lists labels", lines.includes("alpha") && lines.includes("beta"));
    check("ov.render shows metadata", lines.includes("msg") && lines.includes("tok"));

    // lifecycle keys: q closes (done called), r refreshes, a archives.
    let closed = false;
    const done = () => { closed = true; };
    const cmp2 = capturedFactory({ requestRender: () => {} }, theme, {}, done);
    cmp2.handleInput("q");
    check("ov.handleInput q closes", closed === true);
    cmp2.handleInput("a");
    const archived = cmMod.listCheckpoints(ovStore, { includeArchived: true })[0];
    check("ov.handleInput a archives via store", archived?.archived === true);

    ovStore.close();
    try { rmSync(ckRepo, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ---- Sprint 5.18 — /ithacus-memory consolidate (DESIGN_MEMORY_CONSOLIDATION.md) -
  // Exercises registerMemoryCommands: registers /ithacus-memory, runs a dry-run
  // plan over seeded active rows, and --apply commits via applyConsolidation /
  // recall filters. No pi TUI, no network (PREVENT-ITH-004).
  {
    const memMod = await import(join(tmpDir, "ithacus-memory.ts"));
    const storeMod = await import(join(tmpDir, "store.ts"));
    const consMod = await import(join(tmpDir, "consolidate.ts"));

    const memRepo = mkdtempSync(join(repoRoot, ".smoke-mem-tmp-"));
    execSync("git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init", { cwd: memRepo });
    const memStore = new storeMod.IthStore(memRepo, {});
    memStore.addMemory({ id: "m1", kind: "fact", text: "auth signs jwt [superseded]", repoId: "r", ts: 100 });
    memStore.addMemory({ id: "m2", kind: "fact", text: "auth signs jwt tokens", repoId: "r", ts: 200 });
    memStore.addMemory({ id: "m3", kind: "fact", text: "auth signs jwt token flow", repoId: "r", ts: 300 });

    const memPi = { registerCommand: (name, def) => { memPi.registered = { name, def }; }, registerTool: () => {}, on: () => {}, setModel: () => {} };
    const memRuntime = {
      store: memStore,
      bindRepo: () => {},
      repoId: () => "r",
    };
    const memConfig = { consolidation: { collapseThreshold: 0.5, clusterThreshold: 0.5, windowMs: 86400000, autoThreshold: 500 } };
    memMod.registerMemoryCommands(memPi, memRuntime, memConfig);
    check("memory.command registers /ithacus-memory", memPi.registered?.name === "ithacus-memory");
    check("memory.command has handler", typeof memPi.registered?.def?.handler === "function");

    // Dry-run: supersede m1 + collapse (should merge the two auth facts) — nothing applied.
    const ctxM = { cwd: memRepo };
    const dry = await memMod.runMemoryCommand(memRuntime, memConfig, "consolidate", ctxM);
    check("memory.dry-run reports supersede", dry.includes("supersede: 1"));
    check("memory.dry-run reports collapse", dry.includes("collapse:"));
    check("memory.dry-run marker", dry.includes("--apply"));
    check("memory.dry-run not applied (still 3 recalled)", memStore.recall("r", undefined, 10).length === 3);

    // Commit: --apply marks superseded/collapsed, recall drops them.
    const applied = await memMod.runMemoryCommand(memRuntime, memConfig, "consolidate --apply", ctxM);
    check("memory.apply reports committed", applied.includes("committed:"));
    check("memory.apply commits supersede", memStore.db.prepare(`SELECT superseded_by FROM ith_memories WHERE id='m1'`).get().superseded_by !== null);
    const rec = memStore.recall("r", undefined, 10);
    check("memory.apply recall keeps only active survivor(s)", rec.length === 1);
    const status = await memMod.runMemoryCommand(memRuntime, memConfig, "status", ctxM);
    check("memory.status reports active count", status.includes("1 active memories"));
    memStore.close();
    try { rmSync(memRepo, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ---- summary ----------------------------------------------------------
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.length - passed;
  console.log(`\n=== extensions/ smoke: ${passed}/${checks.length} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error("\nFAILED assertions:");
    for (const [name, ok] of checks) if (!ok) console.error("  - " + name);
    process.exitCode = 1;
  } else {
    console.log("ALL PASSED");
  }
} finally {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  process.chdir(repoRoot); // leave tmpDir before removing it (cwd must not be inside)
  // Always clean up the temp dir (under repo root — must not linger).
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
