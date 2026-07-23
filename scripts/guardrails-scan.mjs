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

function main() {
  const rules = loadRules();
  const files = [...walk(join(root, "extensions")), ...walk(join(root, "src"))];
  let violations = 0;
  for (const file of files) {
    if (isExcluded(file)) continue;
    const lines = readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of rules) {
        if (!ruleAppliesTo(rule, file)) continue;
        // Inline allow: `// guardrails-allow <RULE_ID> [<RULE_ID>...]: <reason>`
        // (reason required). Supports multiple space-separated rule IDs so one
        // audited exception can cover both template (PREVENT-PI-*) and project
        // (PREVENT-ITH-*) rule sets.
        const allowMatch = line.match(/guardrails-allow\s+([A-Z0-9-]+(?:\s+[A-Z0-9-]+)*)\s*:\s*(\S+)/);
        if (allowMatch) {
          const allowed = allowMatch[1].split(/\s+/);
          if (allowed.includes(rule.rule_id)) continue;
        }
        try {
          if (new RegExp(rule.pattern).test(line)) {
            console.error(`[GUARDRAILS][${rule.severity}] ${rule.rule_id} ${file}:${i + 1} — ${rule.message}`);
            violations++;
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
