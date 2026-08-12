/**
 * ithacus-spawn.ts — the subprocess spawn helper (extracted from
 * ithacus-dispatch.ts in Sprint 5.13).
 *
 * Why a separate file: Sprint 5.13 (docs/DESIGN_LIVE_PROGRESS.md §6 file-size
 * guardrail: "ithacus-dispatch.ts stays ≤ 400 — split if needed") rewires
 * execute() (live overlay + store + event-bus wiring); ithacus-dispatch.ts
 * was 720 lines, so the subprocess layer moves here VERBATIM (plus the §5
 * rawJsonLine pass-through). ithacus-dispatch.ts keeps the tool registration
 * and re-exports spawnAgent so existing dispatch sites (ithacus-team.ts,
 * ithacus-swarm.ts — `import { spawnAgent } from "./ithacus-dispatch.js"`)
 * keep resolving unchanged.
 *
 * PREVENT-ITH-004 + PREVENT-PI-004: spawning a LOCAL `pi` subprocess is
 * intra-machine (no network). The import line carries the required
 * `// guardrails-allow ...` annotation (audited exception — same convention
 * as search.ts). This is NOT a network call.
 *
 * Mission made literal: each spawn IS a different agent with a different
 * model, in an isolated context window.
 */

import { spawn } from "node:child_process"; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: local-pi-subprocess-dispatch
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  discoverIthacusAgents,
  findAgent,
  type AgentConfig,
} from "./ithacus-agents.js";
import { loadPiSetupConfig } from "./ithacus-provider-config.js";
import { resolveProviderForModel } from "../src/provider-resolver.js";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Child extension (mailbox tool)
// ---------------------------------------------------------------------------

/**
 * Absolute path to the minimal extension loaded into EVERY dispatched child
 * subprocess via `-e/--extension`. With it, `ithacus-mailbox` is registered
 * in the fresh child pi process; without it the tool never registers and pi's
 * `--tools` allowlist silently drops the unknown name (child transcripts showed
 * only built-in tools). See extensions/ithacus-child-mailbox.ts for details.
 *
 * Imports in the child extension are resolved by pi's extension loader (the
 * same jiti-based loader that loads the parent extension in the interactive
 * session), so the `.js`-suffixed relative imports of sibling `src/extensions`
 * TypeScript modules resolve the same way here. PREVENT-ITH-004: the child
 * extension performs no network I/O.
 */

/**
 * Resolve the sibling mailbox extension to a path that ACTUALLY exists.
 *
 * The published npm payload is compiled: `dist/extensions/` ships only
 * `.js` (no `.ts`), so hard-coding the `.ts` sibling pointed `-e` at a file
 * that does not exist and every dispatched child exited 1 at pi startup
 * ("Extension path does not exist" — the 0.6.4 dispatch-killing bug).
 *
 * Prefer the variant matching this module's own flavor: running stripped TS
 * from source (`.ts`) prefers the sibling `.ts`; running compiled from dist
 * (`.js`) prefers the sibling `.js`. Falls back to the other variant when it
 * is the only one on disk. Returns null when neither exists so the caller can
 * degrade (run the child without the mailbox tool) instead of crashing pi.
 *
 * `extensionDir`/`preferTs` are injectable for unit tests.
 */
export function resolveChildMailboxPath(
  extensionDir: string,
  preferTs: boolean,
): string | null {
  const stems = preferTs
    ? ["ithacus-child-mailbox.ts", "ithacus-child-mailbox.js"]
    : ["ithacus-child-mailbox.js", "ithacus-child-mailbox.ts"];
  for (const stem of stems) {
    const candidate = path.join(extensionDir, stem);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export const CHILD_MAILBOX_EXTENSION: string | null = resolveChildMailboxPath(
  fileURLToPath(new URL(".", import.meta.url)),
  import.meta.url.endsWith(".ts"),
);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpawnAgentOpts {
  /** Any discovered agent name (discoverIthacusAgents: bundled or project markdown def); legacy role names match case-insensitively. */
  agent: string;
  /** Task prompt for the sub-agent. */
  task: string;
  /** Per-agent model override (realizes "different models per child"). */
  model?: string;
  /**
   * Per-dispatch provider override. When set, the child pi subprocess is
   * spawned with `--provider <name>`. When unset, the provider is resolved
   * from (in order): the model id prefix (`plexus/foo`), the agent's
   * frontmatter `provider:` field, or pi-setup's models.json. If none
   * resolves, spawnAgent fast-fails with a hint pointing to `/setup`.
   */
  provider?: string;
  /** Working directory for the child pi process. Defaults to process.cwd(). */
  cwd?: string;
  /** Tool allowlist override; defaults to the agent's frontmatter `tools`. */
  tools?: string[];
  /** Cancellation signal. */
  signal?: AbortSignal;
  /**
   * Live progress callback (task #25): fires on dispatch start, on each
   * parsed child JSON event (tool calls, text deltas, message_end), so the
   * parent UI can show what a dispatch is doing + which model as it runs.
   * Best-effort; callers may ignore it.
   *
   * Sprint 5.13 (DESIGN_LIVE_PROGRESS.md §5): `rawJsonLine` passes each
   * COMPLETE raw `--mode json` stdout line through untouched (phase "json"),
   * so the live-progress store can parse it in real time. The existing
   * "tool"|"text"|"message_end" phases stay as the non-JSON fallback.
   */
  onProgress?: (info: { phase: string; text: string; model?: string; rawJsonLine?: string }) => void;
  /**
   * Test seam: inject a fake subprocess spawn. Defaults to the real Node
   * process-spawn API. Smoke tests inject a stub that emits JSON
   * `message_end` lines, since real `pi` can't run in the harness (no model
   * keys / network). Production callers leave this unset.
   */
  spawnImpl?: typeof spawn;
}

export interface SpawnAgentResult {
  agent: string;
  task: string;
  success: boolean;
  /** Captured assistant text (concatenated message_end assistant content). */
  output: string;
  exitCode: number;
  stderr: string;
  /** Model the child actually ran with (after override resolution). */
  model?: string;
  /** Provider the child actually ran with (after resolution; `--provider`). */
  provider?: string;
  /** Source of the resolved provider ("model-prefix" | "explicit-param" | ...). */
  providerSource?: string;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// pi invocation (mirrors examples/extensions/subagent/index.ts getPiInvocation)
// ---------------------------------------------------------------------------

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

// ---------------------------------------------------------------------------
// JSON-line event parsing (no `any` / `as any` — type guard narrows)
// ---------------------------------------------------------------------------

interface AssistantMessage {
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  model?: string;
}

interface PiJsonEvent {
  type?: string;
  message?: AssistantMessage;
}

function isPiJsonEvent(v: unknown): v is PiJsonEvent {
  return typeof v === "object" && v !== null;
}

function extractAssistantText(message: AssistantMessage | undefined): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }
  let text = "";
  for (const part of message.content) {
    if (part && part.type === "text" && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}

/** Format a millisecond duration as a compact human-readable string. Shared
 *  with dispatch's final result header via dispatch's import of this module. */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// spawnAgent — the subprocess spawn (replaces pi.callTool at dispatch sites)
// ---------------------------------------------------------------------------

/**
 * Spawn a real `pi` subprocess for one ithacus agent role. Looks up the
 * agent's markdown definition (system prompt + tools + default model), builds
 * the spawn args, runs the child to completion, and captures the assistant
 * output via JSON-mode stdout.
 */
export async function spawnAgent(opts: SpawnAgentOpts): Promise<SpawnAgentResult> {
  const start = Date.now();
  const agents = discoverIthacusAgents();
  const agent: AgentConfig | undefined = findAgent(agents, opts.agent);

  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: opts.agent,
      task: opts.task,
      success: false,
      output: "",
      exitCode: 1,
      stderr: `Unknown agent: "${opts.agent}". Available: ${available}.`,
      durationMs: Date.now() - start,
      error: "unknown_agent",
    };
  }

  const model = opts.model ?? agent.model;
  const tools = opts.tools ?? agent.tools;

  // Resolve the provider so the child pi subprocess runs against a configured
  // provider instead of defaulting to (often unconfigured) anthropic on a bare
  // model id. Reads pi-setup's models.json + settings.json (cached). When no
  // provider resolves, fast-fail with a hint (do not spawn a doomed child).
  // An agent with NO model frontmatter skips resolution entirely and spawns
  // with pi's defaults (no --model/--provider) — that is a valid config.
  let resolvedModel: string | undefined = model;
  let resolvedProvider: string | undefined;
  let resolvedSource: string | undefined;
  if (model) {
    const resolved = resolveProviderForModel({
      model,
      explicitProvider: opts.provider,
      agentProvider: agent.provider,
      piConfig: loadPiSetupConfig(),
    });
    if (resolved.source === "unresolved") {
      return {
        agent: opts.agent,
        task: opts.task,
        success: false,
        output: "",
        exitCode: 1,
        stderr: `${resolved.error ?? "No provider resolved."}\n${resolved.hint ?? ""}`,
        model,
        durationMs: Date.now() - start,
        error: "provider_unresolved",
      };
    }
    resolvedModel = resolved.model;
    resolvedProvider = resolved.provider;
    resolvedSource = resolved.source;
  }

  // Sprint 5.13 guard (DESIGN_LIVE_PROGRESS.md §5): `--mode json` MUST be in
  // the child args — it's what makes the child emit the structured JSONL
  // events (tool_execution_start/end, message_end+usage) the live store
  // parses in real time. Already wired since the dispatch tool landed.
  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  // Load the ithacus mailbox extension into the child (see CHILD_MAILBOX_EXTENSION).
  // Required so `--tools` below does not drop the unregistered `ithacus-mailbox`.
  // Guard: only pass `-e` when the sibling actually exists. A stale/absent path
  // makes pi exit non-zero before the task even starts, killing every dispatch
  // (the 0.6.4 bug). Degrade to a child with its normal toolset rather than crash.
  if (CHILD_MAILBOX_EXTENSION) {
    args.push("-e", CHILD_MAILBOX_EXTENSION);
  }
  if (resolvedModel) args.push("--model", resolvedModel);
  if (resolvedProvider) args.push("--provider", resolvedProvider);
  if (tools && tools.length > 0) args.push("--tools", tools.join(","));

  let tmpDir: string | null = null;
  let tmpPromptPath: string | null = null;
  let output = "";
  let stderr = "";
  let exitCode = 0;
  let wasAborted = false;
  let capturedModel: string | undefined;

  try {
    if (agent.systemPrompt.trim()) {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ithacus-agent-"));
      tmpPromptPath = path.join(tmpDir, "prompt.md");
      await fs.promises.writeFile(tmpPromptPath, agent.systemPrompt, {
        encoding: "utf-8",
        mode: 0o600,
      });
      args.push("--append-system-prompt", tmpPromptPath);
    }
    args.push(`Task: ${opts.task}`);

    exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const doSpawn = opts.spawnImpl ?? spawn; // test seam: smoke injects a fake
      const proc = doSpawn(invocation.command, invocation.args, {
        cwd: opts.cwd ?? process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // Child identity: mirrors claw-code's CLAWD_AGENT_ID convention so a
        // spawned agent can identify itself (mailbox addressing, telemetry).
        env: { ...process.env, ITHACUS_AGENT_ID: agent.name },
      });
      let buffer = "";

      const processLine = (line: string): void => {
        if (!line.trim()) return;
        // Sprint 5.13 §5: pass every complete raw stdout line through via
        // rawJsonLine BEFORE classification, so the live-progress store can
        // parse it in real time. parseJsonlLine tolerates non-JSON (returns
        // null), and the existing phase classification below stays as the
        // flat-text fallback. This emission is the single new snippet in the
        // otherwise-verbatim move from ithacus-dispatch.ts.
        opts.onProgress?.({ phase: "json", text: "", rawJsonLine: line, model: capturedModel });
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        if (!isPiJsonEvent(parsed)) return;
        const t = parsed.type ?? "";
        // Final assistant message — accumulate output + capture the model the
        // child actually ran with (authoritative when resolution falls through).
        if (t === "message_end" && parsed.message) {
          output += extractAssistantText(parsed.message);
          if (parsed.message.model) capturedModel = parsed.message.model;
          opts.onProgress?.({ phase: "message_end", text: "", model: capturedModel });
          return;
        }
        // Streaming text delta (progressive, not accumulated into `output` —
        // message_end is the final source). Surface for live visibility.
        if (t === "message_delta") {
          const delta = (parsed as { delta?: { content?: Array<{ type?: string; text?: string }> } }).delta;
          const txt = delta?.content?.map((p) => p?.text ?? "").join("") ?? "";
          if (txt) opts.onProgress?.({ phase: "text", text: txt });
          return;
        }
        // Tool-use events — surface which tool the child is calling (the
        // "what is it doing" signal the parent needs).
        if (t.includes("tool")) {
          const name = (parsed as { name?: string; tool_name?: string }).name ?? (parsed as { tool_name?: string }).tool_name ?? t;
          opts.onProgress?.({ phase: "tool", text: String(name) });
          return;
        }
      };

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", () => {
        resolve(1);
      });

      if (opts.signal) {
        const killProc = (): void => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (opts.signal.aborted) killProc();
        else opts.signal.addEventListener("abort", killProc, { once: true });
      }
    });
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore temp cleanup errors */
      }
    }
  }

  const success = exitCode === 0 && output.length > 0 && !wasAborted;
  // The child's reported model wins (authoritative) over the resolved guess.
  const finalModel = capturedModel ?? resolvedModel;
  return {
    agent: opts.agent,
    task: opts.task,
    success,
    output,
    exitCode,
    stderr,
    model: finalModel,
    provider: resolvedProvider,
    providerSource: resolvedSource,
    durationMs: Date.now() - start,
    error: wasAborted ? "aborted" : success ? undefined : "nonzero_exit_or_empty_output",
  };
}
