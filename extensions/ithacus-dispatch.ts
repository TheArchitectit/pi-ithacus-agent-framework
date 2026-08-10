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
import { loadPiSetupConfig } from "./ithacus-provider-config.js";
import { resolveProviderForModel } from "../src/provider-resolver.js";
import type { IthRuntime } from "./ithacus-runtime.js";
import { maybeShowFirstDispatchNotice } from "./ithacus-onboarding.js";
import { registerToolWithVisibility } from "./ithacus-tool-registry.js";
import { ToolVisibility } from "../src/tool-visibility.js";

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
   */
  onProgress?: (info: { phase: string; text: string; model?: string }) => void;
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

/** Format a millisecond duration as a compact human-readable string. */
function fmtDuration(ms: number): string {
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

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
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

// ---------------------------------------------------------------------------
// registerDispatchTool — the LLM-invoked `ithacus-dispatch` tool
// ---------------------------------------------------------------------------

interface DispatchDetails {
  agent: string;
  exitCode: number;
  model?: string;
  provider?: string;
  providerSource?: string;
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
    Type.String({ description: "Per-agent model override (different models per child). Accepts a bare id (`claude-haiku-4-5`) or a provider-prefixed id (`plexus/claude-mythos-5`)." }),
  ),
  provider: Type.Optional(
    Type.String({
      description:
        "Per-dispatch provider override (e.g. 'plexus'). When unset, the provider is resolved from the model id prefix, the agent's frontmatter `provider:`, or pi-setup's config. If none resolves, dispatch fast-fails with a hint to run /setup.",
    }),
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
export function registerDispatchTool(pi: ExtensionAPI, runtime?: IthRuntime): void {
  const tool: ToolDefinition<typeof DispatchParams, DispatchDetails> = {
    name: "ithacus-dispatch",
    label: "ithacus dispatch",
    description:
      "Dispatch a coordinated ithacus sub-agent — a real pi subprocess with an isolated context window and a per-agent model. " +
      'Roles: explore (fast read-only recon), plan (implementation planner), verification (feasibility + post-check), reviewer (senior code review).',
    parameters: DispatchParams,
    async execute(
      _toolCallId: string,
      params: { agent?: string; task: string; model?: string; provider?: string; cwd?: string },
      signal: AbortSignal | undefined,
      onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details: DispatchDetails }) => void) | undefined,
      _ctx: ExtensionContext,
    ) {
      // First-dispatch onboarding notice (one-shot, per-repo). Persisted in the
      // ith_kv store table via markOnboardingSeen(). Silent after the first
      // dispatch in a repo. Only fires when a runtime is wired (entry passes
      // it; the smoke harness calls registerDispatchTool without one).
      if (runtime) maybeShowFirstDispatchNotice(runtime);
      const agentType = params.agent ?? "explore";
      runtime?.dispatchStarted(agentType);
      let res;
      try {
        // Live visibility (task #25): surface dispatch start + each child event
        // to the parent UI via onUpdate, so the user can SEE what the dispatch
        // is doing + which model while it runs — not just the final output.
        const taskPreview = params.task.slice(0, 80) + (params.task.length > 80 ? "…" : "");
        const emit = (text: string, details: DispatchDetails): void => {
          onUpdate?.({ content: [{ type: "text" as const, text }], details });
        };
        emit(`ithacus · ${agentType}\ntask: ${taskPreview}\n  ⟳ spawning sub-agent…`, {
          agent: agentType, exitCode: -1, durationMs: 0, success: false,
          model: params.model, provider: params.provider,
        });
        res = await spawnAgent({
          agent: agentType,
          task: params.task,
          model: params.model,
          provider: params.provider,
          cwd: params.cwd,
          signal: signal ?? undefined,
          onProgress: (info) => {
            const modelTag = info.model ? ` · ${info.model}` : "";
            const line = info.phase === "tool" ? `  → ${info.text}`
              : info.phase === "text" ? `  … ${info.text.slice(-200)}`
              : info.phase === "message_end" ? `  ✓ done`
              : `  · ${info.phase}`;
            emit(`ithacus · ${agentType}${modelTag}\n${line}`, {
              agent: agentType, exitCode: -1, durationMs: 0, success: false,
              model: info.model ?? params.model, provider: params.provider,
            });
          },
        });
      } finally {
        runtime?.dispatchEnded(agentType);
      }
      // Final result: a visible status header (agent/model/duration/status)
      // PREPENDED to the child's output — so the parent LLM and any tool
      // result renderer see what actually ran, not just the prose.
      const modelStr = res.model ? `${res.model}${res.provider ? `@${res.provider}` : ""}` : "default";
      const dur = fmtDuration(res.durationMs);
      const statusMark = res.success ? "✓ success" : `✗ failed (exit ${res.exitCode})`;
      const header = `ithacus · ${res.agent}\nmodel: ${modelStr} · ${dur} · ${statusMark}`;
      return {
        content: [
          { type: "text" as const, text: `${header}\n\n${res.output || res.stderr || "(no output)"}` },
        ],
        details: {
          agent: res.agent,
          exitCode: res.exitCode,
          model: res.model,
          provider: res.provider,
          providerSource: res.providerSource,
          durationMs: res.durationMs,
          success: res.success,
        },
      };
    },
  };

  registerToolWithVisibility(pi, tool, ToolVisibility.INTERNAL);
}
