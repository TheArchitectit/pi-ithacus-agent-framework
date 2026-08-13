#!/usr/bin/env node
/**
 * scripts/schema-health-check.mjs — ithacus deploy / pre-commit gate.
 *
 * Validates the live SQLite schema at ~/.pi/ithacus/sqlite.db against the
 * column registry below (built from the CREATE TABLE statements in
 * src/store.ts, src/store-presence.ts, src/store-model-profiles.ts,
 * src/store-events.ts, src/store-swarm.ts, src/task-store.ts).
 *
 * Fails hard (exit 1) if:
 *   - PRAGMA integrity_check != ok
 *   - any FK-like orphan row is found (ithacus has no declared FKs, but
 *     cross-table integrity is enforced here — agents→runs, tasks→runs,
 *     inbox→agents, costs→agents, swarm_results→swarm_runs, etc.)
 *   - any expected column is missing from its table
 *
 * Usage: node scripts/schema-health-check.mjs [--db <path>]
 * Default DB: ~/.pi/ithacus/sqlite.db
 *
 * Vendored from DevGate-Agentic-Framework (schema-health-check.mjs), adapted
 * to ithacus's ith_* tables + .pi/ithacus DB path.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// --- column registry --------------------------------------------------------
// Each entry: [table, column]. Keeps the contract honest: a new column added
// in a store file MUST be added here, or the deploy gate will flag the drift.
const EXPECTED_COLUMNS = [
  // src/store.ts — core tables
  ["ith_runs", "runId"],
  ["ith_runs", "modePreset"],
  ["ith_runs", "createdAt"],
  ["ith_runs", "summary"],
  ["ith_runs", "status"],

  ["ith_agents", "id"],
  ["ith_agents", "runId"],
  ["ith_agents", "role"],
  ["ith_agents", "model"],
  ["ith_agents", "provider"],
  ["ith_agents", "status"],
  ["ith_agents", "lastSeen"],
  ["ith_agents", "resultSchema"],
  ["ith_agents", "resultValidated"],

  ["ith_tasks", "id"],
  ["ith_tasks", "runId"],
  ["ith_tasks", "title"],
  ["ith_tasks", "ownerClaim"],
  ["ith_tasks", "status"],
  ["ith_tasks", "dependsOn"],
  ["ith_tasks", "wave"],
  ["ith_tasks", "phase"],

  ["ith_inbox", "id"],
  ["ith_inbox", "agentId"],
  ["ith_inbox", "fromAgent"],
  ["ith_inbox", "payload"],
  ["ith_inbox", "ts"],
  ["ith_inbox", "read"],

  ["ith_memories", "id"],
  ["ith_memories", "kind"],
  ["ith_memories", "text"],
  ["ith_memories", "repoId"],
  ["ith_memories", "ts"],
  // B7 (Sprint 5.29): close pre-existing drift — these migration-added columns
  // (src/store.ts applyConsolidation) were never registered. Bridge adds none.
  ["ith_memories", "superseded_by"],
  ["ith_memories", "collapsed_into"],
  ["ith_memories", "cluster_tag"],

  ["ith_worktrees", "agentId"],
  ["ith_worktrees", "runId"],
  ["ith_worktrees", "path"],
  ["ith_worktrees", "branch"],
  ["ith_worktrees", "cleaned"],
  ["ith_worktrees", "createdAt"],

  ["ith_async_runs", "runId"],
  ["ith_async_runs", "status"],
  ["ith_async_runs", "pid"],
  ["ith_async_runs", "logPath"],
  ["ith_async_runs", "exitCode"],
  ["ith_async_runs", "startedAt"],
  ["ith_async_runs", "completedAt"],
  ["ith_async_runs", "error"],

  // src/store-events.ts
  ["ith_events", "id"],
  ["ith_events", "runId"],
  ["ith_events", "agentId"],
  ["ith_events", "action"],
  ["ith_events", "metadata"],
  ["ith_events", "ts"],

  // src/store-presence.ts
  ["ith_presence", "agentId"],
  ["ith_presence", "runId"],
  ["ith_presence", "status"],
  ["ith_presence", "lastHeartbeat"],
  ["ith_presence", "stuckThresholdMs"],
  ["ith_presence", "createdAt"],

  ["ith_reservations", "agentId"],
  ["ith_reservations", "runId"],
  ["ith_reservations", "filePath"],
  ["ith_reservations", "scope"],
  ["ith_reservations", "createdAt"],

  ["ith_costs", "id"],
  ["ith_costs", "agentId"],
  ["ith_costs", "runId"],
  ["ith_costs", "inputTokens"],
  ["ith_costs", "outputTokens"],
  ["ith_costs", "model"],
  ["ith_costs", "ts"],

  // src/store-model-profiles.ts
  ["ith_model_profiles", "id"],
  ["ith_model_profiles", "name"],
  ["ith_model_profiles", "tier"],
  ["ith_model_profiles", "model"],
  ["ith_model_profiles", "fallbackModels"],
  ["ith_model_profiles", "description"],
  ["ith_model_profiles", "costMultiplier"],
  ["ith_model_profiles", "isBuiltIn"],
  ["ith_model_profiles", "createdAt"],

  ["ith_team_model_assignments", "runId"],
  ["ith_team_model_assignments", "role"],
  ["ith_team_model_assignments", "profileId"],
  ["ith_team_model_assignments", "model"],
  ["ith_team_model_assignments", "createdAt"],

  // src/store-swarm.ts
  ["ith_swarm_runs", "runId"],
  ["ith_swarm_runs", "swarmName"],
  ["ith_swarm_runs", "total"],
  ["ith_swarm_runs", "successful"],
  ["ith_swarm_runs", "failed"],
  ["ith_swarm_runs", "blocked"],
  ["ith_swarm_runs", "totalDurationMs"],
  ["ith_swarm_runs", "createdAt"],

  ["ith_swarm_results", "runId"],
  ["ith_swarm_results", "itemId"],
  ["ith_swarm_results", "itemName"],
  ["ith_swarm_results", "success"],
  ["ith_swarm_results", "output"],
  ["ith_swarm_results", "error"],
  ["ith_swarm_results", "durationMs"],
  ["ith_swarm_results", "role"],

  ["ith_swarm_checkpoints", "runId"],
  ["ith_swarm_checkpoints", "seq"],
  ["ith_swarm_checkpoints", "checkpoint"],

  // src/task-store.ts (memory-mcp-style task table, no ith_ prefix)
  ["tasks", "id"],
  ["tasks", "name"],
  ["tasks", "status"],
  ["tasks", "agent_id"],
  ["tasks", "input"],
  ["tasks", "output"],
  ["tasks", "error"],
  ["tasks", "created_at"],
  ["tasks", "updated_at"],
  ["tasks", "completed_at"],
];

// ithacus has no declared FOREIGN KEY constraints (CREATE TABLE statements
// don't include FKs). Enforce cross-table integrity here instead.
const ORPHAN_CHECKS = [
  { child: "ith_agents",    childCol: "runId",    parent: "ith_runs",         parentCol: "runId" },
  { child: "ith_tasks",     childCol: "runId",    parent: "ith_runs",         parentCol: "runId" },
  { child: "ith_inbox",     childCol: "agentId", parent: "ith_agents",       parentCol: "id" },
  { child: "ith_costs",     childCol: "agentId", parent: "ith_agents",       parentCol: "id" },
  { child: "ith_worktrees", childCol: "agentId", parent: "ith_agents",       parentCol: "id" },
  { child: "ith_presence", childCol: "agentId", parent: "ith_agents",       parentCol: "id" },
  { child: "ith_swarm_results",     childCol: "runId", parent: "ith_swarm_runs", parentCol: "runId" },
  { child: "ith_swarm_checkpoints", childCol: "runId", parent: "ith_swarm_runs", parentCol: "runId" },
  { child: "ith_team_model_assignments", childCol: "runId", parent: "ith_runs", parentCol: "runId" },
];

// --- main -------------------------------------------------------------------
const args = process.argv.slice(2);
let dbPath = resolve(homedir(), ".pi", "ithacus", "sqlite.db");

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--db" && args[i + 1]) {
    dbPath = args[++i];
  }
}

if (!existsSync(dbPath)) {
  console.error(`[schema-health-check] DB not found at ${dbPath} — skipping (cold install OK)`);
  process.exit(0);
}

let failures = 0;
let warnings = 0;
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL");

// 1. integrity_check ---------------------------------------------------------
try {
  const rows = db.prepare("PRAGMA integrity_check").all();
  for (const row of rows) {
    const val = row.integrity_check ?? row["integrity_check"] ?? "";
    if (val !== "ok") {
      console.error(`[schema-health-check] integrity_check FAIL: ${val}`);
      failures++;
    }
  }
} catch (err) {
  console.error(`[schema-health-check] integrity_check error: ${err?.message ?? err}`);
  failures++;
}

// 2. Cross-table orphan checks (no declared FKs in ithacus — enforced here) -
for (const { child, childCol, parent, parentCol } of ORPHAN_CHECKS) {
  try {
    // Guard: skip if either table is absent (cold/partial install).
    const childExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(child);
    const parentExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(parent);
    if (!childExists || !parentExists) continue;

    const rows = db.prepare(
      `SELECT COUNT(*) AS c FROM ${child} WHERE ${childCol} IS NOT NULL AND ${childCol} NOT IN (SELECT ${parentCol} FROM ${parent})`
    ).get();
    if (rows && rows.c > 0) {
      console.error(`[schema-health-check] Orphan: ${rows.c} ${child}.${childCol} rows missing in ${parent}.${parentCol}`);
      failures++;
    }
  } catch (err) {
    // Non-fatal: a check misconfigured against a renamed column shouldn't
    // block deploy — surface as a warning.
    console.error(`[schema-health-check] WARNING: orphan check ${child}.${childCol}→${parent}.${parentCol} skipped: ${err?.message ?? err}`);
    warnings++;
  }
}

// 3. Column audit (contract vs. DB) ------------------------------------------
const missingTables = new Set();
for (const [table, column] of EXPECTED_COLUMNS) {
  if (missingTables.has(table)) continue;
  try {
    const rows = db.prepare(`PRAGMA table_info('${table}')`).all();
    if (rows.length === 0) {
      console.error(`[schema-health-check] Missing table: ${table}`);
      missingTables.add(table);
      failures++;
      continue;
    }
    const found = rows.some((r) => r.name === column);
    if (!found) {
      console.error(`[schema-health-check] Missing column: ${table}.${column}`);
      failures++;
    }
  } catch (err) {
    console.error(`[schema-health-check] table_info(${table}) error: ${err?.message ?? err}`);
    failures++;
  }
}

db.close();

if (failures > 0) {
  console.error(`\n[schema-health-check] ${failures} failure(s) found. Deploy blocked.`);
  process.exit(1);
}
if (warnings > 0) {
  console.error(`[schema-health-check] ${warnings} warning(s) (non-blocking).`);
}
console.log("[schema-health-check] all checks passed.");
process.exit(0);
