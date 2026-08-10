/**
 * Regression Test Template and Examples (ithacus node-test / smoke style)
 *
 * This file demonstrates the regression-testing pattern for ithacus's Bug
 * Tracking & Regression Prevention System. ithacus uses `node --test` +
 * `scripts/smoke-src.mjs` (check() assertions), NOT Python unittest. Copy the
 * TEMPLATE section and adapt it for your bug fix.
 *
 * Related:
 *   - ../../docs/workflows/REGRESSION_PREVENTION.md
 *   - ../failure-registry-examples.jsonl
 *   - ../prevention-rules-examples.json
 *
 * Usage:
 *   1. Copy the TEMPLATE block below into scripts/smoke-src/<NN>-<feature>.mjs
 *   2. Update FAILURE_ID, description, and check() cases
 *   3. Run with: node --experimental-strip-types scripts/smoke-src.mjs
 *      (or the full gate: npm run gate)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// =============================================================================
// TEMPLATE — Copy and customize for new regression tests
// =============================================================================
//
// // scripts/smoke-src/42-<feature>.mjs
// /**
//  * Regression test for FAILURE_ID: FAIL-XXX-NNN
//  *
//  * Bug: <Brief description of what was broken>
//  * Fix: <Brief description of how it was fixed>
//  * Registry: ../../.guardrails/failure-registry.jsonl
//  *
//  * This test MUST fail with the buggy code and pass with the fix.
//  * If this test ever fails, the bug has been reintroduced.
//  */
// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { check } from "./_harness.mjs";
// import { /* production fn */ } from "../../src/<module>.ts";
//
// test("FAIL-XXX-NNN: <scenario> should <expected behavior>", () => {
//   // This check would have caught the original bug where <what happened>.
//   check("FAIL-XXX-NNN: <short label>", /* actual */ , /* expected */);
// });

// =============================================================================
// EXAMPLE 1: Null Check After JSON Parse (FAIL-WEB-001)
// =============================================================================
// Mirrors ithacus's store/parse paths. Shows a regression test for a bug where
// parsing a payload without a null check caused a TypeError.

/**
 * Parse a payment-amount payload — FIXED VERSION.
 * @param {string} payload
 * @returns {Record<string, unknown>}
 */
function parseAmount(payload) {
  if (!payload) throw new Error("Empty payload received");
  let data;
  try {
    data = JSON.parse(payload);
  } catch (e) {
    throw new Error(`Invalid JSON in payload: ${e.message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Payload must be a JSON object");
  }
  if (!("amount" in data)) throw new Error("Missing required field: amount");
  if (typeof data.amount !== "number") throw new Error("Amount must be a number");
  return data;
}

test("FAIL-WEB-001: empty payload raises clear error, not TypeError", () => {
  // Buggy code: const data = JSON.parse(payload); return data.amount;
  // Would throw: TypeError: Cannot read properties of undefined
  assert.throws(() => parseAmount(""), /Empty payload/);
});

test("FAIL-WEB-001: invalid JSON raises clear error", () => {
  // Buggy code would crash with SyntaxError, then TypeError downstream.
  assert.throws(() => parseAmount("not valid json {{ "), /Invalid JSON/);
});

test("FAIL-WEB-001: non-object JSON is rejected", () => {
  // "null" or "123" pass JSON.parse but fail on property access.
  assert.throws(() => parseAmount("null"), /must be a JSON object/);
});

test("FAIL-WEB-001: missing amount field fails gracefully", () => {
  assert.throws(() => parseAmount('{"currency": "USD"}'), /Missing required field/);
});

test("FAIL-WEB-001: valid payload parses correctly (no regression)", () => {
  const result = parseAmount('{"amount": 99.99, "currency": "USD"}');
  assert.equal(result.amount, 99.99);
  assert.equal(result.currency, "USD");
});

// =============================================================================
// EXAMPLE 2: SQLite WAL race condition (FAIL-CACHE-001)
// =============================================================================
// Mirrors ithacus's IthStore. Shows a regression test for a race condition in
// concurrent cache/store updates. ithacus's store sets PRAGMA journal_mode=WAL
// and serializes writes through a single connection — this test guards that.

test("FAIL-CACHE-001: serialized writes do not lose updates (smoke-style check)", async () => {
  // In ithacus, the equivalent test would import IthStore from ../../src/store.ts
  // and run check("FAIL-CACHE-001: ...", actual, expected). This template shows
  // the assertion shape using a plain in-memory counter to keep it self-contained.
  let counter = 0;
  const increments = 1000;
  // Simulate serialized (single-threaded) increments — the fix guarantees ordering.
  for (let i = 0; i < increments; i++) counter++;
  assert.equal(counter, increments, "no updates should be lost under serialized writes");
});

// =============================================================================
// EXAMPLE 3: Environment Variable Validation (FAIL-CFG-001)
// =============================================================================
// Mirrors ithacus's loadConfig + pressure. Shows a regression test for missing
// env-var validation that crashed on startup.

const REQUIRED_VARS = ["DATABASE_URL", "API_KEY", "SECRET_KEY"];

/**
 * Load required config — FIXED VERSION.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
function loadConfig(env) {
  const config = {};
  const missing = [];
  for (const v of REQUIRED_VARS) {
    const val = env[v];
    if (!val) missing.push(v);
    else config[v] = val;
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Please set them before starting the application.`,
    );
  }
  return config;
}

test("FAIL-CFG-001: missing DATABASE_URL raises clear startup error", () => {
  // Buggy code would crash later with: TypeError: Cannot read properties of undefined
  assert.throws(() => loadConfig({}), /Missing required.*DATABASE_URL/s);
});

test("FAIL-CFG-001: error lists ALL missing vars, not just first", () => {
  assert.throws(
    () => loadConfig({}),
    (err) => REQUIRED_VARS.every((v) => String(err.message).includes(v)),
  );
});

test("FAIL-CFG-001: valid environment loads successfully (no regression)", () => {
  const config = loadConfig({
    DATABASE_URL: "postgresql://localhost/db",
    API_KEY: "test-api-key",
    SECRET_KEY: "test-secret-key",
  });
  assert.equal(config.DATABASE_URL, "postgresql://localhost/db");
  assert.equal(config.API_KEY, "test-api-key");
  assert.equal(config.SECRET_KEY, "test-secret-key");
});
