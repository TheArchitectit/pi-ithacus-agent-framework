/**
 * src/worker-status.test.ts — node:test unit tests for the Sprint 5.14
 * WorkerStatus state machine (docs/DESIGN_WORKER_STATUS.md §4: "table-driven
 * tests for each transition + unknown-line passthrough").
 *
 * Run: node --experimental-strip-types --test src/worker-status.test.ts
 * (imports use explicit .ts specifiers — the strip-only loader does no
 * .js→.ts remap; this file is excluded from the tsc build program.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapEventToStatus,
  canTransition,
  toAgentStatus,
  isTerminalStatus,
  isBlockedStatus,
  classifyFailure,
} from "./worker-status.ts";
import type { WorkerStatus } from "./events.ts";

// ---------------------------------------------------------------------------
// mapEventToStatus — the spec §4 table: [line, current, expected]
// ---------------------------------------------------------------------------

const HAPPY_PATH: Array<[string, WorkerStatus, WorkerStatus]> = [
  // spawn accepted, no signal yet → stays spawning
  ["", "spawning", "spawning"],
  ["   ", "spawning", "spawning"],
  // trust-prompt marker in child output → trust_required
  ["Do you trust the files in this folder?", "spawning", "trust_required"],
  // permission-request JSON event → tool_permission
  ['{"type":"permission_request","tool":"bash"}', "trust_required", "tool_permission"],
  ['{"type":"tool_permission_request","tool":"edit"}', "spawning", "tool_permission"],
  // child up, prompt queued → ready_for_prompt
  ['{"type":"session_started","sessionId":"s1"}', "tool_permission", "ready_for_prompt"],
  ['{"type":"agent_start"}', "spawning", "ready_for_prompt"],
  // first assistant turn / first usage event → working
  ['{"type":"message_delta"}', "ready_for_prompt", "working"],
  ['{"type":"message_delta"}', "spawning", "working"],
  ['{"type":"message_end","message":{"role":"assistant","content":[]}}', "ready_for_prompt", "working"],
  ['{"type":"message_end","message":{"usage":{"input":10,"output":20}}}', "spawning", "working"],
  ['{"type":"tool_execution_start","toolName":"read"}', "spawning", "working"],
];

test("mapEventToStatus: spec §2.2 happy-path transitions", () => {
  for (const [line, current, expected] of HAPPY_PATH) {
    assert.equal(mapEventToStatus(line, current), expected, `line=${JSON.stringify(line)} current=${current}`);
  }
});

const UNKNOWN_PASSTHROUGH: Array<[string, WorkerStatus]> = [
  ["compiling 42 modules…", "spawning"],
  ["random prose without markers", "working"],
  ['{"type":"telemetry","n":1}', "spawning"], // unknown JSON event type
  ['{"type":"turn_start"}', "working"],
  ['{"n":1}', "spawning"], // JSON without a string type
  ['[1,2,3]', "working"], // non-object JSON
  ["{broken json", "spawning"], // malformed JSON
  ['{"type":"message_end","message":{"role":"user"}}', "working"], // non-assistant boundary is no signal
];

test("mapEventToStatus: unknown lines pass through unchanged (never block the happy path)", () => {
  for (const [line, current] of UNKNOWN_PASSTHROUGH) {
    assert.equal(mapEventToStatus(line, current), current, `line=${JSON.stringify(line)} current=${current}`);
  }
});

test("mapEventToStatus: terminal states are absorbing — no line can exit them", () => {
  for (const terminal of ["done", "failed"] as const) {
    for (const [line] of HAPPY_PATH) {
      assert.equal(mapEventToStatus(line, terminal), terminal, `terminal=${terminal} line=${JSON.stringify(line)}`);
    }
    for (const [line] of UNKNOWN_PASSTHROUGH) {
      assert.equal(mapEventToStatus(line, terminal), terminal, `terminal=${terminal} line=${JSON.stringify(line)}`);
    }
  }
});

test("mapEventToStatus: trust markers are tolerant of phrasing", () => {
  assert.equal(mapEventToStatus("DO YOU TRUST this workspace?", "spawning"), "trust_required");
  assert.equal(mapEventToStatus("This is an untrusted workspace.", "spawning"), "trust_required");
  assert.equal(mapEventToStatus('{"type":"trust_prompt"}', "spawning"), "trust_required");
});

test("mapEventToStatus: progress validity — a late marker never rewinds progress", () => {
  // working → trust_required is NOT legal (trust precedes work).
  assert.equal(mapEventToStatus("Do you trust the files?", "working"), "working");
  // tool_permission → trust_required would rewind the blocked pipeline.
  assert.equal(mapEventToStatus("Do you trust the files?", "tool_permission"), "tool_permission");
  // working → tool_permission IS the legal mid-run grant dip.
  assert.equal(mapEventToStatus('{"type":"permission_request","tool":"bash"}', "working"), "tool_permission");
  // duplicate markers are idempotent self-loops.
  assert.equal(mapEventToStatus("Do you trust the files?", "trust_required"), "trust_required");
});

// ---------------------------------------------------------------------------
// canTransition — the transition table itself
// ---------------------------------------------------------------------------

const LEGAL: Array<[WorkerStatus, WorkerStatus]> = [
  ["spawning", "trust_required"],
  ["spawning", "tool_permission"],
  ["spawning", "ready_for_prompt"],
  ["spawning", "working"],
  ["spawning", "done"],
  ["spawning", "failed"],
  ["trust_required", "tool_permission"],
  ["trust_required", "ready_for_prompt"],
  ["trust_required", "working"],
  ["tool_permission", "ready_for_prompt"],
  ["tool_permission", "working"],
  ["ready_for_prompt", "tool_permission"],
  ["ready_for_prompt", "working"],
  ["working", "tool_permission"],
  ["working", "done"],
  ["working", "failed"],
];

const ILLEGAL: Array<[WorkerStatus, WorkerStatus]> = [
  ["trust_required", "spawning"], // no rewind to spawn
  ["tool_permission", "trust_required"], // blocked pipeline is forward-only
  ["ready_for_prompt", "trust_required"],
  ["working", "spawning"],
  ["working", "trust_required"],
  ["working", "ready_for_prompt"],
  ["done", "working"], // absorbing
  ["done", "failed"],
  ["failed", "done"],
  ["failed", "spawning"],
];

test("canTransition: every legal edge + self-loops", () => {
  for (const [from, to] of LEGAL) {
    assert.equal(canTransition(from, to), true, `${from} → ${to}`);
  }
  const ALL: WorkerStatus[] = [
    "spawning", "trust_required", "tool_permission", "ready_for_prompt", "working", "done", "failed",
  ];
  for (const s of ALL) assert.equal(canTransition(s, s), true, `self-loop ${s}`);
});

test("canTransition: illegal edges rejected", () => {
  for (const [from, to] of ILLEGAL) {
    assert.equal(canTransition(from, to), false, `${from} → ${to}`);
  }
});

// ---------------------------------------------------------------------------
// predicates + coarse mapping
// ---------------------------------------------------------------------------

test("isTerminalStatus / isBlockedStatus", () => {
  assert.equal(isTerminalStatus("done"), true);
  assert.equal(isTerminalStatus("failed"), true);
  assert.equal(isTerminalStatus("working"), false);
  assert.equal(isBlockedStatus("trust_required"), true);
  assert.equal(isBlockedStatus("tool_permission"), true);
  assert.equal(isBlockedStatus("working"), false);
  assert.equal(isBlockedStatus("done"), false);
});

test("toAgentStatus: spec §2.1 coarse mapping (blocked/ready persist as spawning)", () => {
  assert.equal(toAgentStatus("spawning"), "spawning");
  assert.equal(toAgentStatus("trust_required"), "spawning");
  assert.equal(toAgentStatus("tool_permission"), "spawning");
  assert.equal(toAgentStatus("ready_for_prompt"), "spawning");
  assert.equal(toAgentStatus("working"), "working");
  assert.equal(toAgentStatus("done"), "done");
  assert.equal(toAgentStatus("failed"), "failed");
});

// ---------------------------------------------------------------------------
// classifyFailure — spec §2.2's "failed + WorkerFailureKind", precedence order
// ---------------------------------------------------------------------------

test("classifyFailure: timeout flag is authoritative", () => {
  assert.equal(classifyFailure({ timedOut: true }), "timeout");
  assert.equal(classifyFailure({ timedOut: true, lastStatus: "tool_permission" }), "timeout");
});

test("classifyFailure: exits still blocked → permission_denied", () => {
  assert.equal(classifyFailure({ exitCode: 1, lastStatus: "trust_required" }), "permission_denied");
  assert.equal(classifyFailure({ exitCode: 1, lastStatus: "tool_permission" }), "permission_denied");
});

test("classifyFailure: context-window markers in the tails", () => {
  assert.equal(
    classifyFailure({ exitCode: 1, lastStatus: "working", outputTail: "Error: prompt is too long" }),
    "context_window",
  );
  assert.equal(
    classifyFailure({ exitCode: 1, stderrTail: "maximum context length exceeded" }),
    "context_window",
  );
});

test("classifyFailure: died before any assistant output → crash", () => {
  assert.equal(classifyFailure({ exitCode: 1, lastStatus: "spawning" }), "crash");
  assert.equal(classifyFailure({ exitCode: 2, lastStatus: "ready_for_prompt" }), "crash");
});

test("classifyFailure: everything else is honestly unknown (never guess)", () => {
  assert.equal(classifyFailure({ exitCode: 1, lastStatus: "working", outputTail: "some prose" }), "unknown");
  assert.equal(classifyFailure({}), "unknown");
  assert.equal(classifyFailure({ exitCode: 0, lastStatus: "working" }), "unknown");
});
