# Regression Tests

This directory contains regression tests for bugs that have been fixed. These tests ensure that once a bug is fixed, it stays fixed.

---

## Purpose

Regression tests:
- Verify that fixed bugs don't reoccur
- Document the conditions that caused the original bug
- Provide a safety net during refactoring
- Are NEVER deleted (only deprecated if the feature is removed)

---

## Naming Convention

```
<module>.regression.<failure-id>.test.ts

Examples:
-config.regression.FAIL-abc123de.test.ts
team.regression.FAIL-def456gh.test.ts
store.regression.FAIL-ghi789jk.test.ts
```

---

## Test Structure

Every regression test MUST include:

1. **JSDoc comment with failure_id**
2. **Description of the original bug**
3. **Description of the fix**
4. **Test that fails with old code, passes with fix**

### Template

```typescript
/**
 * Regression test for FAILURE-ID: FAIL-abc123de
 *
 * Bug: Brief description of what was broken
 * Fix: Brief description of how it was fixed
 * File: src/config.ts (the file that had the bug)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { functionUnderTest } from '../src/module.js';

describe('Module - Regression FAIL-abc123de', () => {
  it('should handle the specific bug scenario correctly', () => {
    // Arrange
    const inputData = ...; // The input that triggered the bug

    // Act
    const result = functionUnderTest(inputData);

    // Assert
    assert.deepStrictEqual(result, expectedResult);
  });

  it('should handle edge case related to the bug', () => {
    // Additional edge case related to the bug
  });
});
```

---

## Adding a New Regression Test

### When to Add

- When you fix a bug
- When a bug is found in production
- When you prevent a potential bug

### Steps

1. **Fix the bug first** (in production code)
2. **Create the test file** following the naming convention
3. **Verify the test fails** with the old code (if possible)
4. **Verify the test passes** with the fix
5. **Log the failure** to the registry:
   ```bash
   python3 scripts/log_failure.py --interactive
   ```
6. **Run regression check** to verify everything passes:
   ```bash
   python3 scripts/regression_check.py
   ```

---

## Directory Structure

```
tests/regression/
├── README.md (this file)
├── config.regression.FAIL-abc123de.test.ts
├── team.regression.FAIL-def456gh.test.ts
└── store.regression.FAIL-ghi789jk.test.ts
```

---

## Running Regression Tests

```bash
# Run all regression tests (via node:test)
node --test tests/regression/*.test.ts

# Run specific regression test
node --test tests/regression/config.regression.FAIL-abc123de.test.ts

# Run as part of full test suite
node --test tests/**/*.test.ts

# Run smoke tests (includes regression)
node --experimental-strip-types scripts/smoke-src.mjs
```

---

## Integration with Failure Registry

Each regression test corresponds to an entry in `.guardrails/failure-registry.jsonl`.

### Linking Test to Registry

The failure_id in the test name and docstring links to the registry entry.

Example registry entry:
```json
{
  "failure_id": "FAIL-abc123de",
  "category": "runtime",
  "severity": "high",
  "error_message": "TypeError: Cannot read property of undefined",
  "regression_test": "tests/regression/config.regression.FAIL-abc123de.test.ts"
}
```

---

## Best Practices

### DO

✓ Test the exact scenario that caused the bug
✓ Include edge cases related to the bug
✓ Name tests clearly after what they prevent
✓ Keep tests independent (no shared state)
✓ Make tests deterministic (no randomness)
✓ Document the original bug thoroughly

### DON'T

✗ Delete regression tests (mark deprecated instead)
✗ Combine multiple bug tests into one file
✗ Make tests that pass even with the bug
✗ Skip regression tests in CI
✗ Forget to update the failure registry

---

## Deprecating Tests

If a feature is removed and its regression test is no longer relevant:

1. **Don't delete the test file**
2. **Mark as deprecated in JSDoc:**
   ```typescript
   /**
    * DEPRECATED: Feature X was removed in v2.0.0
    * Original bug: ...
    */
   ```
3. **Update registry entry status** to "deprecated"
4. **Keep the file** as historical documentation

---

## Quick Reference

```bash
# Log a new bug
python3 scripts/log_failure.py --interactive

# Check for regressions
python3 scripts/regression_check.py

# Run all regression tests
node --test tests/regression/*.test.ts

# View failure registry
cat .guardrails/failure-registry.jsonl
```

---

**Related Documents:**
- [.guardrails/pre-work-check.md](../../.guardrails/pre-work-check.md) - Pre-work checklist
- [.guardrails/failure-registry.jsonl](../../.guardrails/failure-registry.jsonl) - Bug database
- [scripts/regression_check.py](../../scripts/regression_check.py) - Regression detection
- [scripts/log_failure.py](../../scripts/log_failure.py) - Failure logging

---

**Last Updated:** 2026-03-27
**Version:** 1.0 (adapted for ithacus from agent-guardrails-template)
