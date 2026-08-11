/**
 * agent-bundles.test.ts — node:test unit tests for Sprint 5.12.5
 * (docs/DESIGN_AGENT_BUNDLES.md §8.2). Temp dirs only; zero network.
 *
 * ithacus-agents.ts is imported for the resolver cases — it has no pi imports
 * (plain discovery module), keeping this suite pi-agnostic.
 *
 * NOTE: imports use explicit .ts specifiers because this file runs under
 * `node --experimental-strip-types --test` (no .js→.ts remap), and it is
 * excluded from the tsc build program (tsconfig exclude) so it never ships.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AgentConfig, DiscoverOptions } from "../extensions/ithacus-agents.ts";

interface AgentsModule {
  discoverIthacusAgents: (opts?: DiscoverOptions) => AgentConfig[];
  findAgent: (agents: AgentConfig[], name: string) => AgentConfig | undefined;
}

/**
 * Load extensions/ithacus-agents.ts for resolver tests. That module imports
 * ../src/agent-bundles.js — Node type-stripping does NO .js→.ts specifier
 * remap, so (exactly like scripts/smoke-ext.mjs) we copy the module into a
 * temp dir with the specifier rewritten to the real module's absolute file
 * URL. Same resolved file as this test's own import → one module instance.
 */
async function loadAgentsModule(t: TestContext): Promise<AgentsModule> {
  const work = mkdtempSync(join(tmpdir(), "ithacus-agents-mod-"));
  t.after(() => {
    rmSync(work, { recursive: true, force: true });
  });
  const extSrc = fileURLToPath(new URL("../extensions/ithacus-agents.ts", import.meta.url));
  const bundlesSrc = fileURLToPath(new URL("./agent-bundles.ts", import.meta.url));
  // Sprint 5.15: ithacus-agents.ts additionally imports ../src/permissions.js
  // (parsePermissionFrontmatter) — same remap as agent-bundles above so the
  // copied module resolves the real pure resolver under strip-types.
  const permsSrc = fileURLToPath(new URL("./permissions.ts", import.meta.url));
  const code = readFileSync(extSrc, "utf-8")
    .replaceAll(
      '"../src/agent-bundles.js"',
      JSON.stringify(pathToFileURL(bundlesSrc).href),
    )
    .replaceAll(
      '"../src/permissions.js"',
      JSON.stringify(pathToFileURL(permsSrc).href),
    );
  const dest = join(work, "ithacus-agents.ts");
  writeFileSync(dest, code);
  return (await import(dest)) as AgentsModule;
}
import {
  BUNDLE_MANIFEST_FILE,
  BUNDLE_VERSION_FILE,
  parseFrontmatter,
  readManifest,
  seedBundledAgents,
  semverCompare,
  sha256,
  validateAgentFile,
  type SeedResult,
} from "./agent-bundles.ts";

const AGENT_NAMES = ["explore", "plan", "verification", "reviewer"] as const;

function mkWorkspace(t: TestContext): { root: string; bundle: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), "ithacus-agent-bundles-test-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const bundle = join(root, "bundle");
  const project = join(root, "project");
  mkdirSync(bundle, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, bundle, project };
}

function defContent(name: string, variant: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${variant} description for ${name}`,
    "tools: read, grep, find, ls",
    "model: claude-sonnet-4-5",
    "---",
    "",
    `${variant} system prompt body for ${name}.`,
    "",
  ].join("\n");
}

function writeBundle(dir: string, variant: string, names: readonly string[] = AGENT_NAMES): void {
  for (const name of names) writeFileSync(join(dir, `${name}.md`), defContent(name, variant));
}

function seed(bundle: string, project: string, packageVersion: string): SeedResult {
  return seedBundledAgents({ bundledDir: bundle, projectAgentsDir: project, packageVersion });
}

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

const EXPECTED_FILES = AGENT_NAMES.map((n) => `${n}.md`);

/** Temp-file + rename leaves no strays (atomic-writes invariant). */
function assertNoTmpFiles(dir: string): void {
  assert.deepEqual(
    readdirSync(dir).filter((n) => n.includes(".tmp-")),
    [],
  );
}

function readStamp(project: string): string {
  return readFileSync(join(project, BUNDLE_VERSION_FILE), "utf-8").trim();
}

function readManifestAgents(project: string): Record<string, string> {
  const m = readManifest(project);
  assert.ok(m !== null, "manifest should parse");
  return m.agents;
}

// ---------------------------------------------------------------

test("first seed: missing-only copies, stamp + manifest written", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");

  const res = seed(bundle, project, "0.4.0");
  assert.deepEqual(sorted(res.seeded), [...EXPECTED_FILES].sort());
  assert.deepEqual(res.upgraded, []);
  assert.deepEqual(res.skippedModified, []);
  assert.deepEqual(res.errors, []);

  for (const name of AGENT_NAMES) {
    assert.equal(
      readFileSync(join(project, `${name}.md`), "utf-8"),
      defContent(name, "v1"),
      `${name}.md bytes must equal the bundled def`,
    );
  }
  assert.equal(readStamp(project), "0.4.0");

  const agents = readManifestAgents(project);
  assert.deepEqual(sorted(Object.keys(agents)), [...EXPECTED_FILES].sort());
  for (const name of AGENT_NAMES) {
    assert.equal(agents[`${name}.md`], sha256(defContent(name, "v1")));
  }
  assert.equal(readManifest(project)?.seededBy, "0.4.0");
  assertNoTmpFiles(project);
});

test("idempotent re-seed: same version changes nothing", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");
  seed(bundle, project, "0.4.0");

  const stampBefore = readFileSync(join(project, BUNDLE_VERSION_FILE), "utf-8");
  const manifestBefore = readFileSync(join(project, BUNDLE_MANIFEST_FILE), "utf-8");

  const res = seed(bundle, project, "0.4.0");
  assert.deepEqual(res.seeded, []);
  assert.deepEqual(res.upgraded, []);
  assert.deepEqual(res.skippedModified, []);
  assert.deepEqual(res.errors, []);
  assert.equal(readFileSync(join(project, BUNDLE_VERSION_FILE), "utf-8"), stampBefore);
  assert.equal(readFileSync(join(project, BUNDLE_MANIFEST_FILE), "utf-8"), manifestBefore);
  assertNoTmpFiles(project);
});

test("upgrade overwrites untouched seeded copies", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");
  seed(bundle, project, "0.4.0");

  writeBundle(bundle, "v2");
  const res = seed(bundle, project, "0.4.1");
  assert.deepEqual(sorted(res.upgraded), [...EXPECTED_FILES].sort());
  assert.deepEqual(res.seeded, []);
  assert.deepEqual(res.skippedModified, []);
  assert.deepEqual(res.errors, []);

  for (const name of AGENT_NAMES) {
    assert.equal(readFileSync(join(project, `${name}.md`), "utf-8"), defContent(name, "v2"));
  }
  assert.equal(readStamp(project), "0.4.1");
  const agents = readManifestAgents(project);
  for (const name of AGENT_NAMES) {
    assert.equal(agents[`${name}.md`], sha256(defContent(name, "v2")));
  }
  assertNoTmpFiles(project);
});

test("upgrade preserves user-edited file; manifest keeps the prior seeded hash", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");
  seed(bundle, project, "0.4.0");

  const userEdit = defContent("explore", "v1") + "\nUSER EDIT: my own scouting notes.\n";
  writeFileSync(join(project, "explore.md"), userEdit);

  writeBundle(bundle, "v2");
  const res = seed(bundle, project, "0.4.1");
  assert.deepEqual(res.skippedModified, ["explore.md"]);
  assert.deepEqual(sorted(res.upgraded), ["plan.md", "reviewer.md", "verification.md"]);
  assert.deepEqual(res.seeded, []);
  assert.deepEqual(res.errors, []);

  // Edited file bytes untouched.
  assert.equal(readFileSync(join(project, "explore.md"), "utf-8"), userEdit);
  // Others upgraded.
  for (const name of ["plan", "verification", "reviewer"]) {
    assert.equal(readFileSync(join(project, `${name}.md`), "utf-8"), defContent(name, "v2"));
  }
  assert.equal(readStamp(project), "0.4.1");

  const agents = readManifestAgents(project);
  // explore.md retains the v1 SEEDED hash — never replaced with the user's.
  assert.equal(agents["explore.md"], sha256(defContent("explore", "v1")));
  assert.equal(agents["plan.md"], sha256(defContent("plan", "v2")));
  assertNoTmpFiles(project);
});

test("new bundled def is adopted mid-release (stamp already set)", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");
  seed(bundle, project, "0.4.0");

  writeFileSync(join(bundle, "writer.md"), defContent("writer", "v1"));
  const res = seed(bundle, project, "0.4.0");
  assert.deepEqual(res.seeded, ["writer.md"]);
  assert.deepEqual(res.upgraded, []);
  assert.deepEqual(res.skippedModified, []);
  assert.deepEqual(res.errors, []);
  assert.equal(readFileSync(join(project, "writer.md"), "utf-8"), defContent("writer", "v1"));
  assert.equal(readManifestAgents(project)["writer.md"], sha256(defContent("writer", "v1")));
  assert.equal(readStamp(project), "0.4.0");
});

test("validateAgentFile: ok, missing key, empty value, unknown tool, name mismatch, bad frontmatter", () => {
  assert.deepEqual(validateAgentFile(defContent("explore", "v1"), "explore.md"), []);

  const missingModel = defContent("explore", "v1").replace("model: claude-sonnet-4-5\n", "");
  assert.ok(
    validateAgentFile(missingModel, "explore.md").some((e) => e.includes("'model'")),
  );

  const emptyDesc = defContent("explore", "v1").replace(
    "description: v1 description for explore",
    "description:",
  );
  assert.ok(
    validateAgentFile(emptyDesc, "explore.md").some((e) =>
      e.includes("'description'") && e.includes("empty"),
    ),
  );

  const badTool = defContent("explore", "v1").replace(
    "tools: read, grep, find, ls",
    "tools: read, rm",
  );
  const toolErrors = validateAgentFile(badTool, "explore.md");
  assert.ok(toolErrors.some((e) => e.includes("unknown tool") && e.includes("rm")));

  const caseTypo = defContent("explore", "v1").replace("name: explore", "name: Explorer");
  assert.ok(
    validateAgentFile(caseTypo, "explore.md").some((e) => e.includes("filename stem")),
  );

  assert.ok(
    validateAgentFile("no frontmatter at all\n", "explore.md").some((e) =>
      e.includes("frontmatter"),
    ),
  );
});

test("first activation preserves a pre-existing user-authored def (ownership never inferred)", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");

  const userVersion = defContent("explore", "user-authored");
  writeFileSync(join(project, "explore.md"), userVersion);

  const res = seed(bundle, project, "0.4.0");
  assert.deepEqual(sorted(res.seeded), ["plan.md", "reviewer.md", "verification.md"]);
  assert.deepEqual(res.skippedModified, []); // not an upgrade — preserved silently
  assert.deepEqual(res.errors, []);
  assert.equal(readFileSync(join(project, "explore.md"), "utf-8"), userVersion);
  assert.equal(readStamp(project), "0.4.0");
  // No hash recorded for explore.md — it was never seeded by ithacus.
  assert.equal(readManifestAgents(project)["explore.md"], undefined);
});

test("malformed manifest: untrusted — preserve existing, seed missing, report error", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");

  const userVersion = defContent("explore", "user-authored");
  writeFileSync(join(project, "explore.md"), userVersion);
  writeFileSync(join(project, BUNDLE_MANIFEST_FILE), "{ this is not json");

  const res = seed(bundle, project, "0.4.0");
  assert.ok(
    res.errors.some((e) => e.includes(BUNDLE_MANIFEST_FILE) && e.includes("malformed")),
  );
  assert.deepEqual(sorted(res.seeded), ["plan.md", "reviewer.md", "verification.md"]);
  assert.equal(readFileSync(join(project, "explore.md"), "utf-8"), userVersion);
  // Manifest was rewritten cleanly with ONLY established ownership (3 seeded).
  const agents = readManifestAgents(project);
  assert.deepEqual(sorted(Object.keys(agents)), ["plan.md", "reviewer.md", "verification.md"]);

  // Follow-on upgrade with the repaired manifest: explore.md stays preserved.
  writeBundle(bundle, "v2");
  const res2 = seed(bundle, project, "0.4.1");
  assert.deepEqual(res2.errors, []);
  assert.deepEqual(res2.skippedModified, ["explore.md"]);
  assert.equal(readFileSync(join(project, "explore.md"), "utf-8"), userVersion);

  // Missing manifest (not malformed) is NOT an error — covered by case 1's
  // empty errors list; readManifest on a fresh dir returns null without error.
  assert.equal(readManifest(join(project, "no-such-dir")), null);
});

test("downgrade: no overwrite, stamp never moves backward", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v2");
  seed(bundle, project, "0.4.1");

  writeBundle(bundle, "v1");
  const res = seed(bundle, project, "0.4.0");
  assert.deepEqual(res.seeded, []);
  assert.deepEqual(res.upgraded, []);
  assert.deepEqual(res.skippedModified, []);
  assert.deepEqual(res.errors, []);
  for (const name of AGENT_NAMES) {
    assert.equal(readFileSync(join(project, `${name}.md`), "utf-8"), defContent(name, "v2"));
  }
  assert.equal(readStamp(project), "0.4.1");
  assertNoTmpFiles(project);
});

test(".local.md presence does not block seeding of <name>.md", (t) => {
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");

  const localPrompt = "USER-LOCAL explore system prompt body.";
  writeFileSync(
    join(project, "explore.local.md"),
    defContent("explore", "local").replace("local system prompt body for explore.", localPrompt),
  );

  const res = seed(bundle, project, "0.4.0");
  assert.deepEqual(sorted(res.seeded), [...EXPECTED_FILES].sort());
  assert.deepEqual(res.errors, []);
  assert.equal(readFileSync(join(project, "explore.md"), "utf-8"), defContent("explore", "v1"));
  assert.ok(readFileSync(join(project, "explore.local.md"), "utf-8").includes(localPrompt));
  assert.equal(readStamp(project), "0.4.0");
  assertNoTmpFiles(project);
});

test("resolver: bundled fallback > untouched seeded; .local.md tier; user-owned wins over .local.md", async (t) => {
  const { discoverIthacusAgents, findAgent } = await loadAgentsModule(t);
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");

  // Package-bundled fallback: empty project dir resolves straight to bundle.
  let agents = discoverIthacusAgents({ bundledDir: bundle, projectDir: join(project, "absent") });
  const bundledExplore = findAgent(agents, "explore");
  assert.equal(bundledExplore?.source, "bundled");
  assert.ok(bundledExplore?.filePath.startsWith(bundle));

  // Seed, then a <name>.local.md beats the untouched seeded copy.
  seed(bundle, project, "0.4.0");
  const localExplore = defContent("explore", "LOCAL-TIER");
  writeFileSync(join(project, "explore.local.md"), localExplore);

  agents = discoverIthacusAgents({ bundledDir: bundle, projectDir: project });
  const resolvedExplore = findAgent(agents, "explore");
  assert.equal(resolvedExplore?.filePath, join(project, "explore.local.md"));
  assert.ok(resolvedExplore?.systemPrompt.includes("LOCAL-TIER"));
  // Untouched seeded copy still wins over the packaged fallback.
  const resolvedPlan = findAgent(agents, "plan");
  assert.equal(resolvedPlan?.source, "project");
  assert.equal(resolvedPlan?.filePath, join(project, "plan.md"));

  // A user-modified <name>.md outranks even the .local.md.
  const userEdit = defContent("explore", "v1") + "\nUSER EDIT.\n";
  writeFileSync(join(project, "explore.md"), userEdit);
  agents = discoverIthacusAgents({ bundledDir: bundle, projectDir: project });
  const winner = findAgent(agents, "explore");
  assert.equal(winner?.filePath, join(project, "explore.md"));
  assert.equal(parseFrontmatter(userEdit).body, winner?.systemPrompt);
});

test("removed bundled def: project file retained, still discoverable, never pruned", async (t) => {
  const { discoverIthacusAgents, findAgent } = await loadAgentsModule(t);
  const { bundle, project } = mkWorkspace(t);
  writeBundle(bundle, "v1");
  seed(bundle, project, "0.4.0");

  // The 0.4.1 package stops bundling reviewer.md (simulated: delete ONLY the
  // bundle copy) and bumps everything else; the project reviewer.md def must
  // survive verbatim (§8.2 case 11 — removal is never authorization to delete).
  const reviewerV1 = defContent("reviewer", "v1");
  rmSync(join(bundle, "reviewer.md"));
  writeBundle(bundle, "v2", ["explore", "plan", "verification"]);

  const res = seed(bundle, project, "0.4.1");
  assert.deepEqual(res.errors, []);
  assert.deepEqual(sorted(res.upgraded), ["explore.md", "plan.md", "verification.md"]);
  assert.deepEqual(res.seeded, []);

  // Project file retained byte-for-byte; manifest keeps its seeded-hash history.
  assert.equal(readFileSync(join(project, "reviewer.md"), "utf-8"), reviewerV1);
  assert.equal(readManifestAgents(project)["reviewer.md"], sha256(reviewerV1));

  // Nothing deleted from the project dir (dotfiles excluded from the count).
  const projectFiles = readdirSync(project)
    .filter((n) => n.endsWith(".md") && !n.startsWith("."))
    .sort();
  assert.deepEqual(projectFiles, [...EXPECTED_FILES].sort());

  // Discovery still exposes the removed bundled name — as a project agent.
  const agents = discoverIthacusAgents({ bundledDir: bundle, projectDir: project });
  const reviewer = findAgent(agents, "reviewer");
  assert.ok(reviewer !== undefined, "removed bundled name must remain discoverable");
  assert.equal(reviewer?.source, "project");
  assert.equal(reviewer?.filePath, join(project, "reviewer.md"));
  assert.equal(reviewer?.systemPrompt, parseFrontmatter(reviewerV1).body);
  assert.equal(agents.length, EXPECTED_FILES.length);
});

test("bundled source of truth: real extensions/agents ships writer; plan is docs-only-write", () => {
  // §8.2 case 12: validation runs against the actual package source, not a
  // .pi local override. Roster stays dynamic — no fixed count assertion.
  const agentsDir = fileURLToPath(new URL("../extensions/agents/", import.meta.url));
  const files = readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort();
  assert.ok(files.includes("writer.md"), "extensions/agents/writer.md must ship in the 0.4.0 payload");

  for (const f of files) {
    const content = readFileSync(join(agentsDir, f), "utf-8");
    assert.deepEqual(validateAgentFile(content, f), [], `${f} must pass bundle validation`);
  }

  // writer is the full implementation role; package-portable default model
  // and NO provider pin (no device-specific provider assumption).
  const writerRaw = readFileSync(join(agentsDir, "writer.md"), "utf-8");
  const { frontmatter: wfm, body: wbody } = parseFrontmatter(writerRaw);
  const wtools = wfm.tools.split(",").map((t) => t.trim());
  for (const tool of ["read", "grep", "find", "ls", "bash", "write", "edit", "ithacus-mailbox"]) {
    assert.ok(wtools.includes(tool), `writer tools must include ${tool}`);
  }
  assert.ok(!("provider" in wfm), "bundled writer.md must not pin a provider");
  assert.ok(wbody.includes("git commit") && wbody.includes("git push"), "writer body must forbid git commit/push");

  // plan carries the docs-only-write contract in the BUNDLED source.
  const planRaw = readFileSync(join(agentsDir, "plan.md"), "utf-8");
  const { frontmatter: pfm, body: pbody } = parseFrontmatter(planRaw);
  const ptools = pfm.tools.split(",").map((t) => t.trim());
  for (const tool of ["bash", "write", "edit"]) {
    assert.ok(ptools.includes(tool), `plan tools must include ${tool}`);
  }
  assert.ok(pbody.includes("docs/**/*.md"), "plan body must carry the docs/**/*.md write contract");
});

test("semverCompare: patch/minor/major ordering; pre-release ignored", () => {
  assert.equal(semverCompare("0.4.1", "0.4.0"), 1);
  assert.equal(semverCompare("0.4.0", "0.4.0"), 0);
  assert.equal(semverCompare("0.4.0", "0.4.1"), -1);
  assert.equal(semverCompare("1.0.0", "0.9.9"), 1);
  assert.equal(semverCompare("0.5.0-rc1", "0.4.9"), 1);
  assert.equal(semverCompare("0.4.0", "0.10.0"), -1);
});

test("sha256 hex digest is stable + parseFrontmatter round-trips", () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const { frontmatter, body } = parseFrontmatter(defContent("explore", "v1"));
  assert.equal(frontmatter.name, "explore");
  assert.equal(frontmatter.model, "claude-sonnet-4-5");
  assert.ok(body.startsWith("v1 system prompt body"));
});
