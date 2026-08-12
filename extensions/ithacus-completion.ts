/**
 * ithacus-completion.ts — durable dispatch-completion artifacts (Sprint 5.28,
 * docs/SPRINT_5_28_LIVE_DISPATCH_CONTROL.md §4.2 / §10).
 *
 * Holds `writeDispatchCompletion`, MOVED here from ithacus-dispatch.ts so that
 * BOTH the dispatch tool and the live-dispatch-control core import it without
 * an import cycle (control.ts imports completion.ts; dispatch imports
 * control.ts; completion never imports dispatch/control). Pure node:fs +
 * node:path + the IthRuntime type only — zero network (PREVENT-ITH-004).
 *
 * Extended (5.28, additive + non-breaking) with optional `parentDispatchId?`
 * and `controls?: ControlAction[]` keys so a split child links back to its
 * parent and the resume/swap/restart/retry chain is fully reconstructable.
 * An optional `statusOverride?` lets `stop` write a `status:"stopped"`
 * artifact (KEEP); `cancel` simply omits the write entirely (DISCARD — the
 * only audit is the events.log line from controlDispatch).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IthRuntime } from "./ithacus-runtime.js";
import type { RetryHopRecord } from "./ithacus-retry.js";
import type { ControlAction } from "./ithacus-control.js";

export interface CompletionInfo {
  cwd: string | undefined;
  dispatchId: string;
  agentType: string;
  res: { success: boolean; exitCode: number; durationMs: number; model?: string; provider?: string; output?: string; stderr?: string; error?: string } | undefined;
  startTime: number;
  task: string;
  paramsModel?: string;
  paramsProvider?: string;
  /** Sprint 5.17: per-attempt resilience record from dispatchWithResilience. */
  retryMeta?: RetryHopRecord[];
  /** Sprint 5.28: parent dispatch link (split children). */
  parentDispatchId?: string;
  /** Sprint 5.28: in-memory control audit trail (resume/swap/restart/retry/…). */
  controls?: ControlAction[];
  /** Sprint 5.28: explicit terminal status ("stopped" keeps the artifact;
   *  "success"/"failed" come from `res`). */
  statusOverride?: "stopped";
}

/**
 * Write a completion summary to `<repo>/.pi/ithacus/dispatch-completions/<id>.json`
 * so every dispatch leaves a durable artifact (dispatch id, agent, status,
 * duration, tail of the transcript). Best-effort + non-fatal — a dispatch must
 * never fail because the audit trail could not be written. The filename is a
 * sanitized version of the pi tool-call id + timestamp. Zero network.
 *
 * The target dir is the RUNTIME's per-repo state dir (runtime.currentStateDir,
 * refreshed with a no-op-safe bindRepo), NOT a direct config import — keeps
 * this module's import graph free of src/config.ts (whose ./permissions.js
 * specifier the smoke-ext harness cannot remap). When there is no runtime
 * (headless/stub), the completion file is skipped (belt-and-braces only).
 */
export function writeDispatchCompletion(runtime: IthRuntime | undefined, info: CompletionInfo): void {
  try {
    if (!runtime) return;
    runtime.bindRepo(info.cwd);
    const dir = join(runtime.currentStateDir, "dispatch-completions");
    mkdirSync(dir, { recursive: true });
    const safeId = info.dispatchId.replace(/[^A-Za-z0-9._-]/g, "_");
    const res = info.res;
    let status: string;
    if (info.statusOverride) status = info.statusOverride;
    else status = res?.success ? "success" : "failed";
    writeFileSync(
      join(dir, `${safeId}.json`),
      JSON.stringify(
        {
          dispatchId: info.dispatchId,
          ...(info.parentDispatchId ? { parentDispatchId: info.parentDispatchId } : {}),
          agent: info.agentType,
          status,
          exitCode: res?.exitCode ?? 1,
          durationMs: res?.durationMs ?? Date.now() - info.startTime,
          startedAt: new Date(info.startTime).toISOString(),
          finishedAt: new Date().toISOString(),
          model: res?.model ?? info.paramsModel,
          provider: res?.provider ?? info.paramsProvider,
          error: res?.error,
          task: info.task.slice(0, 200),
          outputTail: res?.output ? res.output.slice(-2000) : undefined,
          stderrTail: res?.stderr ? res.stderr.slice(-500) : undefined,
          // Sprint 5.17: resilience audit trail for Fleet/audit surfaces.
          ...(info.retryMeta && info.retryMeta.length > 0
            ? { retries: info.retryMeta.map((a) => ({
                attempt: a.index,
                kind: a.kind,
                action: a.action,
                fromModel: a.fromModel,
                toModel: a.toModel,
                reason: a.reason,
                compacted: a.compacted,
                success: a.success,
              })) }
            : {}),
          // Sprint 5.28: the in-memory control audit trail (additive).
          ...(info.controls && info.controls.length > 0 ? { controls: info.controls } : {}),
        },
        null,
        2,
      ),
    );
  } catch {
    /* non-fatal */
  }
}
