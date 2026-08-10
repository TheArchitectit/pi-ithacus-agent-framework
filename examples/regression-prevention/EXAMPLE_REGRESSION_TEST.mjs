/**
 * Example Regression Test (ithacus node-test / smoke style) — minimal template.
 *
 * Copy this template when creating a new regression test in
 * scripts/smoke-src/<NN>-<feature>.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * parseJsonConfig — FIXED VERSION (stand-in for src/<module>.ts export).
 * Returns null for invalid input instead of crashing.
 * @param {string | null | undefined} input
 * @returns {unknown}
 */
function parseJsonConfig(input) {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

test("FAIL-abc123de: invalid JSON returns null instead of throwing", () => {
  /**
   * Regression test for FAILURE_ID: FAIL-abc123de
   *
   * Original Bug:
   *   JSON.parse result was accessed without a null check, causing a TypeError
   *   when input was invalid JSON or null.
   *
   * Impact:
   *   API endpoint crashed, returning a 500 error to users instead of a
   *   graceful error response.
   *
   * Fix:
   *   Added a defensive null check + try/catch around JSON.parse.
   *   Returns null for invalid input instead of crashing.
   *
   * Affected Files:
   *   - src/utils/parser.ts
   */
  // This test would FAIL with the buggy code (throws TypeError) and PASSES
  // with the fix (returns null).
  assert.equal(parseJsonConfig("not valid json {{{"), null);
});

test("FAIL-abc123de: null input returns null", () => {
  assert.equal(parseJsonConfig(null), null);
});

test("FAIL-abc123de: empty string returns null", () => {
  assert.equal(parseJsonConfig(""), null);
});

test("FAIL-abc123de: valid JSON parses correctly (no regression)", () => {
  const result = parseJsonConfig('{"key": "value", "number": 42}');
  assert.notEqual(result, null);
  // @ts-expect-error — result is unknown in template
  assert.equal(result.key, "value");
  // @ts-expect-error — result is unknown in template
  assert.equal(result.number, 42);
});

test("FAIL-abc123de: fix preserves original behavior for all JSON types", () => {
  const cases = [
    ['{"a": 1}', { a: 1 }],
    ["[1, 2, 3]", [1, 2, 3]],
    ['"string"', "string"],
    ["123", 123],
    ["true", true],
    ["null", null],
  ];
  for (const [jsonStr, expected] of cases) {
    assert.deepEqual(parseJsonConfig(jsonStr), expected);
  }
});
