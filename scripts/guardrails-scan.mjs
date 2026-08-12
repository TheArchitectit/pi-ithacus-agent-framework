#!/usr/bin/env node
// Node fallback for the guardrails pattern-scan (mirrors scripts/regression_check.py
// for 'critical'/'error' rules). Lets `npm run lint` / `node scripts/guardrails-scan.mjs`
// work in a TypeScript project without Python present.
//
// Loads .guardrails/prevention-rules/pattern-rules.json and scans *.ts / *.js under
// extensions/ and src/ for lines matching any enabled critical/error rule.
//
// Inline allow: a line containing `// guardrails-allow <RULE_ID>: <reason>` is
// skipped (reason text required). Use this to document a deliberate, audited
// exception (e.g. a localhost dev server) without disabling the rule project-wide.
//
// Project-specific file exclusions (e.g. a dev-only dashboard) can be added to the
// SCAN_EXCLUSIONS array below — paths are repo-relative.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rulesPath = join(root, ".guardrails", "prevention-rules", "pattern-rules.json");

// Repo-relative paths exempt from scanning (optional, project-specific).
const SCAN_EXCLUSIONS = [
  // "extensions/dashboard-server.ts",
];

function loadRules() {
  const data = JSON.parse(readFileSync(rulesPath, "utf-8"));
  return data.rules.filter(
    (r) => r.enabled !== false && ["critical", "error"].includes(r.severity),
  );
}

/** Minimal glob matcher (supports * and **). */
function globMatch(glob, path) {
  const re = new RegExp(
    "^" + glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "__(DS__)") // temp marker for /**
      .replace(/\*\*/g, ".*")
      .replace(/__\(DS__\)/g, ".*") // restore /**
      .replace(/\*/g, "[^/]*") + "$",
  );
  return re.test(path);
}

function repoRel(file) {
  return file.startsWith(root + "/") ? file.slice(root.length + 1) : file;
}

function ruleAppliesTo(rule, file) {
  const globs = rule.file_glob;
  if (!Array.isArray(globs) || globs.length === 0) return true;
  // walk() yields absolute paths; globs are repo-relative, so match against the
  // path with the repo root stripped. (Earlier versions passed absolute paths
  // to the glob, which never matched — silently disabling every file_glob rule.)
  const rel = repoRel(file);
  return globs.some((g) => globMatch(g, rel));
}

function isExcluded(file) {
  return SCAN_EXCLUSIONS.includes(repoRel(file));
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc; // directory absent (e.g. no extensions/ or src/ yet) — nothing to scan
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!["node_modules", "dist", "guardrails-template", ".git"].includes(name)) walk(p, acc);
    } else if (/\.(ts|js)$/.test(name) && !name.endsWith(".d.ts")) {
      acc.push(p);
    }
  }
  return acc;
}

// Sprint 5.24 (DESIGN_TWO_TIER_POLICY.md §3.1): two-tier connectivity policy.
// Tier R (Remote, opt-in, default OFF) modules live ONLY under extensions/opt-in/
// and are the ONLY place `guardrails-allow PREVENT-ITH-004` annotations are honored
// for NETWORK-capable constructs (fetch/http/net/ws/grpc/libp2p). Local-only exception
// annotations (child_process / node:sqlite / loopback / in-process, e.g. spawning the
// local `pi` binary, `git rev-parse`, local DB) remain honored anywhere (they are the
// documented Tier-L local exceptions preserved by §3.1). A PREVENT-ITH-004 annotation
// on a network construct OUTSIDE opt-in is an error, and every extensions/opt-in/*.ts
// MUST carry a valid file-level annotation header.
//
// Pre-existing Tier-L web-search exception (grandfathered, NOT to be extended):
// src/search.ts is the documented CONTROLLED network exception (MASTER_PLAN §R2
// "Make search opt-in ... document as controlled exception"). Its existing network
// annotations stay honored here; migrating search under opt-in/ is a separate, later
// task. Do NOT add files to this set — new Tier-R network code must live under
// extensions/opt-in/ and new Tier-L network annotations are errors.
const OPT_IN_DIR = "extensions/opt-in";
const OPT_IN_HEADER_LINES = 20;
const NETWORK_CONSTRUCT_RE = /(fetch\(|https?:\/\/|new WebSocket|net\.|XMLHttpRequest)/;
const GRANDFATHERED_TIER_L_NETWORK = new Set(["src/search.ts"]);

function isOptIn(file) {
  return repoRel(file).startsWith(OPT_IN_DIR + "/");
}

// True when the line carries a NETWORK-capable construct that the opt-in-only rule
// governs (fetch/http/ws/net). Local child_process/sqlite/LOOPBACK constructs are NOT
// network. Loopback (http://localhost / 127.0.0.1 / ::1) is a Tier-L local exception
// (e.g. providers.ts placeholder default base URL http://localhost:8001/v1).
function hasNetworkConstruct(line) {
  if (/(fetch\(|new WebSocket|net\.|XMLHttpRequest)/.test(line)) return true;
  const raw = line.match(/https?:\/\/([^\/\s"']+)/)?.[1] || "";
  if (!raw) return false;
  let host = raw;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? host : host.slice(1, end);
  } else {
    host = host.split(":")[0];
  }
  host = host.toLowerCase();
  return !(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost"));
}

// A valid opt-in annotation header line: `// guardrails-allow PREVENT-ITH-004: <capability>`
// (reason required). Reused for both the header check and inline-allow logic.
function allowIds(line) {
  const m = line.match(/guardrails-allow\s+([A-Z0-9-]+(?:\s+[A-Z0-9-]+)*)\s*:\s*(\S+)/);
  return m ? m[1].split(/\s+/) : [];
}

function main() {
  const rules = loadRules();
  const files = [...walk(join(root, "extensions")), ...walk(join(root, "src"))];
  let violations = 0;
  const report = (file, lineNo, ruleId, severity, message) => {
    console.error(`[GUARDRAILS][${severity}] ${ruleId} ${repoRel(file)}:${lineNo} — ${message}`);
    violations++;
  };
  for (const file of files) {
    if (isExcluded(file)) continue;
    const lines = readFileSync(file, "utf-8").split("\n");
    const inOptIn = isOptIn(file);

    // Every opt-in module must self-declare its capability via a valid file-level
    // PREVENT-ITH-004 annotation header (DESIGN_TWO_TIER_POLICY.md §3.1).
    if (inOptIn) {
      const header = lines.slice(0, OPT_IN_HEADER_LINES).join("\n");
      const headerOk = header.split("\n").some((hl) => allowIds(hl).includes("PREVENT-ITH-004"));
      if (!headerOk) {
        report(file, 1, "PREVENT-ITH-004", "error",
          `opt-in module must carry a file-level '// guardrails-allow PREVENT-ITH-004: <capability>' annotation header (see DESIGN_TWO_TIER_POLICY.md §3.1)`);
      }
    }

    lines.forEach((line, i) => {
      const allowed = allowIds(line);
      const allowed004 = allowed.includes("PREVENT-ITH-004");
      if (allowed004 && !inOptIn && hasNetworkConstruct(line) &&
          !GRANDFATHERED_TIER_L_NETWORK.has(repoRel(file))) {
        // Network-construct annotations are honored ONLY under extensions/opt-in/.
        // A network PREVENT-ITH-004 allow in a non-opt-in (non-grandfathered) file is
        // itself an error and never suppresses the pattern (DESIGN_TWO_TIER_POLICY.md §3.1).
        report(file, i + 1, "PREVENT-ITH-004", "error",
          `PREVENT-ITH-004 annotation on a network construct is only honored under ${OPT_IN_DIR}/ (DESIGN_TWO_TIER_POLICY.md §3.1)`);
      }
      for (const rule of rules) {
        if (!ruleAppliesTo(rule, file)) continue;
        // Inline allow: `// guardrails-allow <RULE_ID> [<RULE_ID>...]: <reason>`
        // (reason required). Supports multiple space-separated rule IDs so one
        // audited exception can cover both template (PREVENT-PI-*) and project
        // (PREVENT-ITH-*) rule sets. For PREVENT-ITH-004, a network-construct allow is
        // honored only for opt-in files or the grandfathered web-search exception;
        // local-only (child_process/sqlite/loopback) allows are honored anywhere.
        if (allowed.includes(rule.rule_id)) {
          if (rule.rule_id !== "PREVENT-ITH-004" || inOptIn ||
              GRANDFATHERED_TIER_L_NETWORK.has(repoRel(file)) ||
              !hasNetworkConstruct(line)) continue;
        }
        try {
          if (new RegExp(rule.pattern).test(line)) {
            report(file, i + 1, rule.rule_id, rule.severity, rule.message);
          }
        } catch { /* ignore bad regex */ }
      }
    });
  }
  if (violations > 0) {
    console.error(`\nGUARDRAILS: ${violations} violation(s) found.`);
    process.exit(1);
  }
  console.log("GUARDRAILS: pi pattern scan clean.");
}

try { main(); } catch (e) { console.error("guardrails-scan error:", e.message); process.exit(1); }
