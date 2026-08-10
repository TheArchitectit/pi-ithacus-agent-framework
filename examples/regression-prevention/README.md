# Regression Prevention Examples

> Practical examples demonstrating the Bug Tracking & Regression Prevention System.
> Adapted for ithacus's `node --test` / `scripts/smoke-src.mjs` conventions.

**Related:** [../../docs/workflows/REGRESSION_PREVENTION.md](../../docs/workflows/REGRESSION_PREVENTION.md)

---

## Overview

This directory contains realistic examples showing how to use the regression prevention system end-to-end. Each example demonstrates the complete workflow:

1. **Bug Discovery** — Identifying and logging the failure
2. **Root Cause Analysis** — Understanding what went wrong
3. **Fix Implementation** — Writing the fix
4. **Regression Test** — Creating a `check(...)` case in `scripts/smoke-src/` that prevents recurrence
5. **Prevention Rule** — Adding automated pattern detection to `.guardrails/prevention-rules/`
6. **Documentation** — Recording everything in the failure registry

---

## Examples Included

| Example | Bug Type | Language | Files Modified |
|---------|----------|----------|----------------|
| [Null Check After Parse](./failure-registry-examples.jsonl) | Runtime Error | TypeScript | src/store.ts |
| [SQL Injection Prevention](./prevention-rules-examples.json) | Security | Any | db query layer |
| [Race Condition Fix](./regression-test-example.mjs) | Concurrency | TypeScript | src/store.ts (WAL) |
| [GitHub Issue Template](./bug-report-template.md) | Workflow | Any | N/A |

---

## Quick Start

### Scenario: Fixing a Bug You Just Found

```bash
# Step 1: Log the bug to the registry
python3 scripts/log_failure.py --interactive

# Step 2: Fix the bug
# (edit your code in src/ or extensions/)

# Step 3: Create a regression test (ithacus smoke style)
#   add a check() case to scripts/smoke-src/<NN>-<feature>.mjs
#   (see regression-test-example.mjs for template)

# Step 4: Add a prevention rule (if pattern-based)
#   append to .guardrails/prevention-rules/pattern-rules.json
#   (see prevention-rules-examples.json for template)

# Step 5: Run the full gate
npm run gate   # build + lint + guardrails + semantic + schema-health + regression + smoke

# Step 6: Commit everything
git add .
git commit -m "fix(store): add null check after JSON parse

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## File Organization

```
examples/regression-prevention/
├── README.md                          # This file
├── failure-registry-examples.jsonl    # Example registry entries
├── prevention-rules-examples.json     # Example pattern rules (DISABLED — templates only)
├── semantic-rules-examples.json       # Example semantic rules (DISABLED — templates only)
├── EXAMPLE_PREVENTION_RULE.json       # Single-rule exemplar
├── EXAMPLE_FAILURE_REGISTRY_ENTRY.json# Single-entry exemplar
├── regression-test-example.mjs        # ithacus smoke-module regression test template
├── EXAMPLE_REGRESSION_TEST.mjs        # Minimal single-case regression test
└── bug-report-template.md             # GitHub issue template
```

---

## Real-World Workflow

### The Story: A Bug in the Store Layer

Let us walk through a realistic ithacus scenario:

**Day 1: Bug Discovered**
- Smoke test failure: `TypeError: Cannot read property 'version' of undefined`
- `ownVersion()` crashed when `package.json` was missing from both candidate paths
- Root cause: No fallback when `readFileSync` throws on both candidate paths

**Day 1: Immediate Fix**
- Add try/catch around both candidate reads; return `"?"` on exhaustion
- Re-run `npm run gate` — smoke green
- Log in failure registry (see example entry `FAIL-VER-001`)

**Day 2: Regression Prevention**
- Add a `check()` case to `scripts/smoke-src/00-basics.mjs` that calls `ownVersion()` with no package.json present and asserts it returns `"?"` not a crash
- Add a prevention rule for unguarded `readFileSync` in a loop without try/catch
- Update the reviewer agent's checklist to catch similar patterns

**Week 2: Similar Bug in Another Module**
- Prevention rule catches a similar pattern in `ithacus-menu.ts` (readFileSync without fallback)
- Fix applied before the gate fails
- Prevention system working as designed

---

## Best Practices Demonstrated

1. **Immediate Logging** — Log bugs while context is fresh
2. **Pattern Extraction** — Identify the general pattern, not just the specific case
3. **Prevention Rules** — Add automation to catch future occurrences
4. **Regression Tests** — Every fix gets a `check()` case that would have caught it
5. **Registry Maintenance** — Keep entries up-to-date with status changes

---

## See Also

- [Full Protocol Documentation](../../docs/workflows/REGRESSION_PREVENTION.md)
- [Failure Registry](../../.guardrails/failure-registry.jsonl)
- [Prevention Rules](../../.guardrails/prevention-rules/)
- [Pre-Work Check](../../.guardrails/pre-work-check.md)
- [Four Laws](../../skills/shared-prompts/four-laws.md)

---

*Adapted from agent-guardrails-template `examples/regression-prevention/`; ithacus tool paths + node-test conventions applied.*
