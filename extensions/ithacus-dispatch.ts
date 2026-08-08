/**
 * ithacus-dispatch.ts — the LLM-invoked entry point + subprocess spawn helper.
 *
 * Replaces the phantom `pi.callTool(name, args)` dispatch (never existed on
 * `ExtensionAPI`) with the canonical pi pattern from pi-subagents + pi's
 * example subagent extension: `pi.registerTool(ToolDefinition)` whose
 * `execute()` body spawns a real `pi` subprocess via Node's process-spawn API.
 *
 * Two exports:
 *   - spawnAgent(opts): the subprocess-spawn helper. Used by the existing
 *     team/swarm dispatch sites (extensions/ithacus-team.ts,
 *     ithacus-swarm.ts) to clear the callTool tsc errors with a real fix.
 *   - registerDispatchTool(pi): registers `ithacus-dispatch` — the LLM tool
 *     that invokes spawnAgent. This is the entry point the model calls.
 *
 * PREVENT-ITH-004 + PREVENT-PI-004: spawning a LOCAL `pi` subprocess is
 * intra-machine (no network). The import line carries the required
 * `// guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: <reason>` annotation
 * covering BOTH rule sets that share the process-spawn-module pattern. This
 * is NOT a network call — the annotation documents the audited exception,
 * matching the search.ts convention.
 *
 * Mission made literal: each spawn IS a different agent with a different
 * model, in an isolated context window.
 */

import { spawn } from "node:child_process"; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: local-pi-subprocess-dispatch
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  discoverIthacusAgents,
  findAgent,
  type AgentConfig,
} from "./ithacus-agents.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpawnAgentOpts {
  /** ithacus AgentRole ("Explore"|"Plan"|"Verification"|"Reviewer") or markdown agent name. */
  agent: string;
  /** Task prompt for the sub-agent. */
  task: string;
  /** Per-agent model override (realizes "different models per child"). */
  model?: string;
  /** Working directory for the child pi process. Defaults to process.cwd(). */
  cwd?: string;
  /** Tool allowlist override; defaults to the agent's frontmatter `tools`. */
  tools?: string[];
  /** Cancellation signal. */
  signal?: AbortSignal;
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
  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (model) args.push("--model", model);
  if (tools && tools.length > 0) args.push("--tools", tools.join(","));

  let tmpDir: string | null = null;
  let tmpPromptPath: string | null = null;
  let output = "";
  let stderr = "";
  let exitCode = 0;
  let wasAborted = false;

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
      });
      let buffer = "";

      const processLine = (line: string): void => {
        if (!line.trim()) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        if (!isPiJsonEvent(parsed)) return;
        if (parsed.type === "message_end" && parsed.message) {
          output += extractAssistantText(parsed.message);
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
  return {
    agent: opts.agent,
    task: opts.task,
    success,
    output,
    exitCode,
    stderr,
    model,
    durationMs: Date.now() - start,
    error: wasAborted ? "aborted" : success ? undefined : "nonzero_exit_or_empty_output",
  };
}

// ---------------------------------------------------------------------------
// registerDispatchTool — the LLM-invoked `ithacus-dispatch` tool
// ---------------------------------------------------------------------------

interface DispatchDetails {
  agent: string;
  exitCode: number;
  model?: string;
  durationMs: number;
  success: boolean;
}

const DispatchParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      description:
        'ithacus agent role: "explore", "plan", "verification", or "reviewer". Defaults to "explore".',
    }),
  ),
  task: Type.String({ description: "Task for the sub-agent." }),
  model: Type.Optional(
    Type.String({ description: "Per-agent model override (different models per child)." }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the child pi process." }),
  ),
});

/**
 * Register the `ithacus-dispatch` tool. The LLM invokes this to spawn a
 * coordinated ithacus sub-agent (real pi subprocess, isolated context,
 * per-agent model). ithacus's existing team/swarm orchestration in src/ drives
 * the dispatch loop; this tool is the single LLM entry point.
 */
export function registerDispatchTool(pi: ExtensionAPI): void {
  const tool: ToolDefinition<typeof DispatchParams, DispatchDetails> = {
    name: "ithacus-dispatch",
    label: "ithacus dispatch",
    description:
      "Dispatch a coordinated ithacus sub-agent — a real pi subprocess with an isolated context window and a per-agent model. " +
      'Roles: explore (fast read-only recon), plan (implementation planner), verification (feasibility + post-check), reviewer (senior code review).',
    parameters: DispatchParams,
    async execute(
      _toolCallId: string,
      params: { agent?: string; task: string; model?: string; cwd?: string },
      signal: AbortSignal | undefined,
      _onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details: DispatchDetails }) => void) | undefined,
      _ctx: ExtensionContext,
    ) {
      const res = await spawnAgent({
        agent: params.agent ?? "explore",
        task: params.task,
        model: params.model,
        cwd: params.cwd,
        signal: signal ?? undefined,
      });
      return {
        content: [
          { type: "text" as const, text: res.output || res.stderr || "(no output)" },
        ],
        details: {
          agent: res.agent,
          exitCode: res.exitCode,
          model: res.model,
          durationMs: res.durationMs,
          success: res.success,
        },
      };
    },
  };

  pi.registerTool(tool);
}
