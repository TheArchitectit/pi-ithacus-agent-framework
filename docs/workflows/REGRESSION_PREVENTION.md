# Regression Prevention Protocol

> Comprehensive guide to preventing bug reintroduction using the failure registry and prevention rules.
>
> Adapted from the agent-guardrails-template; ithacus-specific tool paths and
> node-test conventions applied. The shared `.guardrails/` rule store +
> scanners are already a strict superset of the template, so this doc is the
> missing workflow glue tying them together.

**Related:** [AGENT_GUARDRAILS.md](../AGENT_GUARDRAILS.md) | [workflows/COMMIT_WORKFLOW.md](./COMMIT_WORKFLOW.md) | [TIER_PROGRESS.md](../TIER_PROGRESS.md)

---

## Overview

The Regression Prevention System ensures that once a bug is fixed, it stays fixed. It consists of:

1. **Failure Registry** — append-only log of all bugs (`.guardrails/failure-registry.jsonl`)
2. **Prevention Rules** — automated pattern detection (`.guardrails/prevention-rules/*.json`)
3. **Pre-Work Checks** — mandatory verification before editing
4. **Regression Tests** — permanent tests for fixed bugs (`scripts/smoke-src/`)
5. **Gate Integration** — automated enforcement (`npm run gate`, `.claude/hooks/`)

---

## Failure Registry

### Location
```
.guardrails/failure-registry.jsonl
```

### Format
Each line is a JSON object:
```json
{
  "failure_id": "FAIL-abc123de",
  "timestamp": "2026-02-07T10:00:00Z",
  "category": "runtime",
  "severity": "high",
  "error_message": "TypeError: Cannot read property of undefined",
  "root_cause": "Missing null check after JSON.parse",
  "affected_files": ["src/store.ts"],
  "fix_commit": "a1b2c3d4",
  "regression_pattern": "JSON\\.parse\\(.*\\)\\.\\w+",
  "prevention_rule": "Always null-check parsed JSON before property access",
  "status": "active"
}
```

### Categories
| Category | Description | Example |
|----------|-------------|---------|
| `build` | Build/compilation errors | Missing import, tsc error |
| `runtime` | Runtime exceptions | Null pointer, undefined access, SQLITE_BUSY |
| `test` | Test failures | Smoke assertion errors, timeouts |
| `type` | Type system errors | Type mismatches, inference failures |
| `lint` | Style/lint violations | guardrails-scan, semantic-scan |
| `deploy` | Deployment failures | npm publish errors, version mismatch |
| `config` | Configuration errors | Missing env vars, invalid config |
| `regression` | Reintroduced bugs | Previously fixed bugs that returned |

### Severity Levels
| Level | Impact | Response Time |
|-------|--------|---------------|
| `critical` | System down, data loss | Immediate |
| `high` | Major feature broken | Within 4 hours |
| `medium` | Minor feature issue | Within 24 hours |
| `low` | Cosmetic, non-blocking | Next sprint |

---

## Using the Registry

### Log a New Failure

Interactive mode (recommended):
```bash
python3 scripts/log_failure.py --interactive
```

Quick entry from error message:
```bash
python3 scripts/log_failure.py \
  --from-error "TypeError: Cannot read property 'x' of undefined" \
  --category runtime \
  --severity high \
  --root-cause "Missing null check" \
  --affected-files src/store.ts \
  --fix-commit abc1234
```

### List Failures

```bash
python3 scripts/log_failure.py --list
python3 scripts/log_failure.py --list | grep runtime   # filtered
```

### View / Update

```bash
python3 scripts/log_failure.py --show FAIL-abc123de
python3 scripts/log_failure.py --resolve FAIL-abc123de   # mark resolved
python3 scripts/log_failure.py --deprecate FAIL-abc123de # no longer relevant
```

---

## Prevention Rules

### Location
```
.guardrails/prevention-rules/
├── pattern-rules.json      # Regex-based rules (PREVENT-PI-* + PREVENT-ITH-* + PREVENT-DIST-*)
├── semantic-rules.json     # AST-based rules (SEMANTIC-*)
├── extracted-rules.json    # Auto-extracted patterns
├── team-layout-rules.json  # Repo layout invariants
└── web-ui-team-rules.json  # UI team conventions
```

ithacus is a **strict superset** of the template's rule families: all `PREVENT-PI-*` rules verbatim, plus ithacus's own `PREVENT-ITH-001..004` (anchor floor, tool-pair integrity, no system-role injection, zero-network) and `PREVENT-DIST-001` (npm-only distribution). Never blindly merge a template update over these — ithacus's project rules must survive.

### Pattern Rule Shape
```json
{
  "rule_id": "PREVENT-001",
  "failure_id": "FAIL-abc123de",
  "name": "Null check after async parse",
  "enabled": true,
  "pattern": "JSON\\.parse\\(.*\\)\\s*\\.\\w+",
  "forbidden_context": "without.*null.*check",
  "message": "Previous bug: Direct property access on JSON.parse without null check",
  "severity": "error",
  "file_glob": ["*.js", "*.ts"],
  "suggestion": "Add null check: const data = JSON.parse(...); if (data) { ... }"
}
```

### Enabling/Disabling Rules

Edit the rule file and set `enabled: true/false`. **Never delete rules** — only disable them. History is important.

### Audited Exceptions

Some imports are intentional but match a scanned pattern (e.g. `node:child_process` for local `pi` subprocess dispatch). Annotate the import line with a multi-ID allow:

```ts
import { spawn } from "node:child_process"; // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: local-pi-subprocess-dispatch
```

ithacus's `guardrails-scan.mjs` parses multiple rule IDs in one annotation (an upgrade over the template's single-ID parser).

---

## Pre-Work Check Protocol

### MANDATORY: Before ANY File Edit

**Step 1: Read Pre-Work Check Document**
```bash
cat .guardrails/pre-work-check.md
```

**Step 2: Run Regression Check**
```bash
python3 scripts/regression_check.py --all
# TypeScript / JS projects without Python can use the Node fallback:
node scripts/guardrails-scan.mjs   # scans extensions/ + src/ for critical/error rules
```

**Step 3: Check Registry for Your Files**
```bash
python3 scripts/log_failure.py --list | grep <your-file>
```

**Step 4: Verify Understanding**
- [ ] I know what bugs have been fixed in these files
- [ ] I understand the patterns that caused them
- [ ] I will not reintroduce these patterns

### During Development

```bash
python3 scripts/regression_check.py --unstaged   # after making changes
```

### Before Commit

```bash
python3 scripts/regression_check.py --staged
```

---

## Regression Testing Requirements

### Every Bug Fix MUST Include:

1. **The fix itself** (production code)
2. **A regression test** (test code)
3. **A registry entry** (documentation)

### Regression Test Location

ithacus uses node's built-in test runner via the smoke harness:
```
scripts/smoke-src/
├── <NN>-<feature>.mjs          # modules imported + run by smoke-src.mjs
└── _harness.mjs                 # shared imports + check() helper
```

Add a `check(...)` case to the relevant module (or a new numbered module) that would fail on the buggy code and pass on the fix. Naming: the module name reflects the feature, and the `check` string references the failure id.

### Regression Test Shape (ithacus smoke style)

```js
import { failures, check, IthStore, cfg, mkdtempSync, join, tmpdir, execSync } from "./_harness.mjs";
export async function run(ctx) {
  // Regression for FAIL-abc123de: JSON.parse result accessed without null check
  const tmp = mkdtempSync(join(tmpdir(), "ith-fix-"));
  execSync("git init -q && git commit -q --allow-empty -m init", { cwd: tmp });
  const store = new IthStore(tmp, cfg.loadConfig());
  check("FAIL-abc123de: parse handles invalid JSON", /* ... */ true);
}
```

### Docstring/Comment Requirements

Every regression test MUST include (as a comment above the case):
- The failure_id
- Brief bug description
- Brief fix description

---

## Gate Integration

### The Full Gate (`npm run gate`)

ithacus enforces regression prevention through a composite gate run before every commit/deploy:

```bash
npm run gate   # = build + lint + guardrails + semantic + schema-health + regression + test
```

| Stage | Script | What it catches |
|---|---|---|
| build | `tsc -p tsconfig.json` | Type errors, missing imports |
| lint | `tsc --noEmit` | Type-only recheck |
| guardrails | `scripts/guardrails-scan.mjs` | PREVENT-* pattern violations |
| semantic | `scripts/semantic-scan.mjs` | SEMANTIC-* AST violations |
| schema-health | `scripts/schema-health-check.mjs` | openclaw.plugin.json / package.json drift |
| regression | `python3 scripts/regression_check.py --all` | failure-registry diff vs changed files |
| test | `node --experimental-strip-types scripts/smoke-src.mjs` + `scripts/smoke-ext.mjs` | 600+ src + 73 ext smoke assertions |

### Pre-Commit Hook

`.claude/hooks/pre-commit.sh` runs AI-attribution + secret-scan + the regression check. Non-fatal to dev, mandatory in CI. Bypass with `--no-verify` (not recommended).

### What the Gate Checks

1. **Diff Analysis** — `regression_check.py` scans staged diff against prevention rules
2. **File History** — warns if modifying files with known bugs
3. **Test Requirements** — smoke suite must pass
4. **Pattern Matching** — fails if known bad patterns detected

---

## Review Protocol

### For Authors

Before requesting review:
- [ ] `npm run gate` passes
- [ ] All bug fixes have regression `check(...)` cases
- [ ] Registry entries created for new bugs
- [ ] No previous fixes were undone

### For Reviewers (ithacus `reviewer` agent or human)

- [ ] Changes don't match known bug patterns
- [ ] Files with active failures reviewed carefully
- [ ] Regression tests exist for bug fixes
- [ ] Prevention rules updated if needed

---

## Common Scenarios

### Scenario 1: Fixing a New Bug

1. Fix the bug
2. Add a `check(...)` regression case to the relevant smoke module
3. Log in registry: `python3 scripts/log_failure.py --interactive`
4. Consider adding a prevention rule to `.guardrails/prevention-rules/*.json`
5. Commit with `fix:` prefix + `Co-Authored-By: Claude <noreply@anthropic.com>`

### Scenario 2: Modifying File with Known Bugs

1. Read registry entries for the file: `log_failure.py --list | grep <file>`
2. Understand what was fixed before
3. Run `regression_check.py --all` before editing
4. Be extra careful with similar patterns
5. Verify your changes don't undo fixes

### Scenario 3: Bug Reintroduced

1. Don't panic — this is why we have the system
2. Fix it again (with better understanding)
3. Update registry entry: increase severity, update `regression_pattern`, add prevention rule if missing
4. Strengthen the regression `check(...)`
5. Review why the gate didn't catch it

### Scenario 4: False Positive

1. Verify it's truly a false positive
2. Update rule to exclude valid cases (`forbidden_context`, refined regex)
3. Disable rule if necessary (never delete)
4. Document the decision

---

## Metrics and Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Registry Coverage | 100% | % of bugs logged |
| Regression Rate | 0% | Bugs reintroduced / total bugs |
| Prevention Rate | >90% | Issues caught by automation |
| Check Adoption | 100% | % of edits with pre-check |

---

## Quick Reference

```bash
# Before work
cat .guardrails/pre-work-check.md
python3 scripts/regression_check.py --all

# During work
python3 scripts/regression_check.py --unstaged

# Before commit (the full gate)
npm run gate

# Log new bug
python3 scripts/log_failure.py --interactive

# List bugs
python3 scripts/log_failure.py --list

# Resolve bug
python3 scripts/log_failure.py --resolve FAIL-xxx
```

---

**Related Documents:**
- [AGENT_GUARDRAILS.md](../AGENT_GUARDRAILS.md) — Core safety protocols (Four Laws)
- [workflows/COMMIT_WORKFLOW.md](./COMMIT_WORKFLOW.md) — Commit + AI-attribution workflow
- [TIER_PROGRESS.md](../TIER_PROGRESS.md) — Delivered-state log

*Adapted from agent-guardrails-template `docs/workflows/REGRESSION_PREVENTION.md`; ithacus tool paths + node-test conventions applied, GitHub-Actions/Python-testdir sections replaced with `npm run gate` + `scripts/smoke-src/`.*
