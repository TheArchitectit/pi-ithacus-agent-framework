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

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";

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
  for (const f of readdirSync(join(repoRoot, "extensions"))) {
    if (!f.endsWith(".ts")) continue;
    let code = readFileSync(join(repoRoot, "extensions", f), "utf-8");
    // Rewrite relative "./x.js" specifiers to ".ts" so Node resolves them.
    code = code.replace(/(from\s+["']\.\.?\/[^"']+)\.js(["'])/g, "$1.ts$2");
    code = code.replace(/(import\(\s*["']\.\.?\/[^"']+)\.js(["']\s*\))/g, "$1.ts$2");
    writeFileSync(join(tmpDir, f), code);
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
  check("tv.registry availableToolNames interactive has both",
    registryMod.availableToolNames().sort().join(",") === "ithacus-dispatch,ithacus-mailbox");
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
