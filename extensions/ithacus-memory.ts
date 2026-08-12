/**
 * ithacus-memory.ts — /ithacus-memory consolidation command (Sprint 5.18).
 *
 * Manual entry point for memory consolidation (DESIGN_MEMORY_CONSOLIDATION.md):
 *   /ithacus-memory consolidate            → dry-run plan preview (no change)
 *   /ithacus-memory consolidate --apply    → commit the dry-run plan
 *   /ithacus-memory status                 → active memory count + thresholds
 *
 * The pipeline itself lives in src/consolidate.ts (pure, pi-agnostic); this
 * adapter only loads active rows from the store, runs consolidate(), and (on
 * --apply) commits via IthStore.applyConsolidation. The dry-run plan is always
 * shown before any mutation (dry-run-first + confirm) — nothing destructive
 * without an audit trail.
 *
 * String-returning handler (discarded by pi today, like the other /ithacus-*
 * commands) — the durable output-display wiring is the shared pending task.
 * runMemoryCommand is exported for unit/smoke testing.
 *
 * Zero network, zero new deps (PREVENT-ITH-004).
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { IthRuntime } from "./ithacus-runtime.js";
import type { IthacusConfig } from "../src/config.js";
import { consolidate, type ConsolidationPlan, type MemoryRecord } from "../src/consolidate.js";

/** Number of most-recent active memories to feed the pipeline (bounded scan). */
const MAX_PIPELINE_ROWS = 2000;

export function registerMemoryCommands(
  pi: ExtensionAPI,
  runtime: IthRuntime,
  config: IthacusConfig,
): void {
  pi.registerCommand("ithacus-memory", {
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      await runMemoryCommand(runtime, config, args ?? "", ctx);
    },
  });
}

/** Pure-ish command core: loads active rows, runs the pipeline, returns the
 *  human-readable report (and commits only on --apply). */
export async function runMemoryCommand(
  runtime: IthRuntime,
  config: IthacusConfig,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<string> {
  runtime.bindRepo(ctx.cwd);
  const repoId = runtime.repoId(ctx.cwd);
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const verb = parts[0] ?? "status";

  if (verb === "status") {
    const count = runtime.store.memoryCount(repoId);
    const c = config.consolidation;
    const thresholdNote = count >= c.autoThreshold
      ? ` (over autoThreshold ${c.autoThreshold} — consolidate recommended)`
      : "";
    return [
      `ithacus memory: ${count} active memories for ${repoId}${thresholdNote}`,
      `  collapseThreshold=${c.collapseThreshold} clusterThreshold=${c.clusterThreshold} windowMs=${c.windowMs}`,
      `  usage: /ithacus-memory status | consolidate [--apply]`,
    ].join("\n");
  }

  if (verb !== "consolidate") {
    return "usage: /ithacus-memory status | consolidate [--apply]";
  }

  const apply = parts.includes("--apply");
  const c = config.consolidation;
  const rows = runtime.store.db
    .prepare(
      `SELECT id, kind, text, repoId, ts FROM ith_memories WHERE repoId = ? AND superseded_by IS NULL AND collapsed_into IS NULL ORDER BY ts DESC LIMIT ?`,
    )
    .all(repoId, MAX_PIPELINE_ROWS) as unknown as MemoryRecord[];

  const plan: ConsolidationPlan = consolidate(rows, {
    collapseThreshold: c.collapseThreshold,
    clusterThreshold: c.clusterThreshold,
    windowMs: c.windowMs,
  });

  const collapsedCount = plan.collapse.reduce((s, g) => s + g.memberIds.length, 0);
  const clusteredCount = plan.cluster.reduce((s, cl) => s + cl.memberIds.length, 0);
  const lines: string[] = [
    `ithacus memory consolidation (${rows.length} active rows scanned)`,
    `  supersede: ${plan.supersede.length} obsolete`,
    `  collapse:  ${plan.collapse.length} group(s) merging ${collapsedCount} entries into ${plan.collapse.length} survivors`,
    `  cluster:   ${plan.cluster.length} cluster(s) covering ${clusteredCount} entries`,
  ];
  for (const s of plan.supersede.slice(0, 20)) lines.push(`  supersede ${s.id} -> ${s.supersededBy}`);
  for (const g of plan.collapse.slice(0, 10)) lines.push(`  collapse ${g.mergedId} <- ${g.memberIds.join(", ")}`);
  for (const cl of plan.cluster.slice(0, 10)) lines.push(`  cluster ${cl.tag} [${cl.memberIds.join(", ")}]`);

  if (!apply) {
    lines.push("(dry-run — re-run with /ithacus-memory consolidate --apply to commit)");
    return lines.join("\n");
  }
  runtime.store.applyConsolidation(plan);
  lines.push(`committed: ${plan.supersede.length} superseded, ${collapsedCount} collapsed, ${clusteredCount} clustered`);
  return lines.join("\n");
}
