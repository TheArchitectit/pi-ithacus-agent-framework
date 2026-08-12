/**
 * ithacus-control-tool.ts — registers the INTERNAL `ithacus-control` tool
 * (Sprint 5.28, docs/SPRINT_5_28_LIVE_DISPATCH_CONTROL.md §5).
 *
 * The second control surface over the SAME core as the `/ithacus-ctrl` slash
 * command (extensions/ithacus-control.ts). Lets the interactive parent (or a
 * higher-order orchestrating agent) issue live-dispatch control verbs on a
 * running/paused dispatch: pause / resume(+start) / stop / restart / retry /
 * cancel / swap_model / swap_agent / add_agent (split_task). Every action is
 * audited by controlDispatch (dispatch log + events.log); kill/respawn is
 * AbortController-only (SIGTERM→SIGKILL via spawnAgent's signal handler).
 *
 * PREVENT-ITH-004: zero network — pure in-process orchestration over the
 * registry + AbortController; no subprocess-module spawn here.
 */

import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { IthRuntime } from "./ithacus-runtime.js";
import { controlDispatch, type ControlVerb, type ControlAction } from "./ithacus-control.js";
import { registerToolWithVisibility } from "./ithacus-tool-registry.js";
import { ToolVisibility } from "../src/tool-visibility.js";

const ControlParams = Type.Object({
  verb: Type.Union(
    [
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("start"),
      Type.Literal("stop"),
      Type.Literal("restart"),
      Type.Literal("retry"),
      Type.Literal("cancel"),
      Type.Literal("swap_model"),
      Type.Literal("swap_agent"),
      Type.Literal("split_task"),
      Type.Literal("add_agent"),
    ],
    { description: "Control verb." },
  ),
  dispatchId: Type.String({ description: "dispatchId of the live/paused dispatch to control." }),
  model: Type.Optional(Type.String({ description: "swap_model: target model id." })),
  provider: Type.Optional(Type.String({ description: "swap_model: target provider." })),
  agent: Type.Optional(Type.String({ description: "swap_agent / split_task: target agent name." })),
  task: Type.Optional(Type.String({ description: "split_task(add_agent): the sub-task prompt." })),
  keepOriginal: Type.Optional(
    Type.Boolean({ description: "split_task: keep the original dispatch running (default true)." }),
  ),
});

interface ControlDetails {
  verb: ControlVerb;
  dispatchId: string;
  result: ControlAction["result"];
  spawnedDispatchId?: string;
  continuation?: boolean;
  reason?: string;
  error?: string;
}

export function registerControlTool(pi: ExtensionAPI, runtime: IthRuntime): void {
  const tool: ToolDefinition<typeof ControlParams, ControlDetails> = {
    name: "ithacus-control",
    label: "ithacus live dispatch control",
    description:
      "Live-dispatch control for running ithacus sub-agents (INTERNAL): pause, resume/start, " +
      "stop, restart, retry, cancel, swap_model, swap_agent, add_agent (split_task). " +
      "Acts on a dispatchId from a prior ithacus-dispatch call. pause/stop/cancel abort the " +
      "child (SIGTERM→SIGKILL via AbortController); resume/retry/swap/restart respawn a fresh " +
      "child reusing the same dispatchId (with a continuation summary). Returns the audit action.",
    parameters: ControlParams,
    async execute(
      _toolCallId,
      params: {
        verb: ControlVerb;
        dispatchId: string;
        model?: string;
        provider?: string;
        agent?: string;
        task?: string;
        keepOriginal?: boolean;
      },
      _signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      try {
        const action = await controlDispatch(
          params.verb,
          params.dispatchId,
          {
            model: params.model,
            provider: params.provider,
            agent: params.agent,
            task: params.task,
            keepOriginal: params.keepOriginal,
          },
          {
            runtime,
            // ctx.cwd is only a hint: controlDispatch uses the dispatch's own cwd.
          },
        );
        void ctx;
        const tail = action.spawnedDispatchId ? ` → spawned ${action.spawnedDispatchId}` : "";
        const err = action.result === "ok" ? "" : ` (${action.error ?? action.reason ?? ""})`;
        return {
          content: [
            {
              type: "text" as const,
              text: `ithacus-control ${params.verb} ${params.dispatchId}: ${action.result}${tail}${err}`,
            },
          ],
          details: {
            verb: params.verb,
            dispatchId: params.dispatchId,
            result: action.result,
            spawnedDispatchId: action.spawnedDispatchId,
            continuation: action.continuation,
            reason: action.reason,
            error: action.error,
          },
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `ithacus-control ${params.verb} ${params.dispatchId}: error ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          details: {
            verb: params.verb,
            dispatchId: params.dispatchId,
            result: "error",
            error: e instanceof Error ? e.message : String(e),
          },
        };
      }
    },
  };

  registerToolWithVisibility(pi, tool, ToolVisibility.INTERNAL);
}
