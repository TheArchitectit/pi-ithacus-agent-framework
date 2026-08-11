// ---- richer worker-status state machine (Sprint 5.14, module 28) ---------
import { failures, check, workerStatus } from "./_harness.mjs";
export async function run(ctx) {
const { mapEventToStatus, canTransition, toAgentStatus, isTerminalStatus, isBlockedStatus, classifyFailure } = workerStatus;
check("workerStatus module loads (machine + helpers exported)",
  [mapEventToStatus, canTransition, toAgentStatus, isTerminalStatus, isBlockedStatus, classifyFailure]
    .every((f) => typeof f === "function"));

// spec §2.2 detection markers — the happy-path progression
check("ws.spawn accepted, no signal → stays spawning", mapEventToStatus("", "spawning") === "spawning");
check("ws.trust text marker → trust_required",
  mapEventToStatus("Do you trust the files in this folder?", "spawning") === "trust_required");
check("ws.permission JSON event → tool_permission",
  mapEventToStatus('{"type":"tool_permission_request","tool":"bash"}', "trust_required") === "tool_permission");
check("ws.ready JSON event → ready_for_prompt",
  mapEventToStatus('{"type":"session_started"}', "tool_permission") === "ready_for_prompt");
check("ws.first assistant turn → working",
  mapEventToStatus('{"type":"message_delta"}', "ready_for_prompt") === "working");

// spec §2.2 tolerance rule: unknown output NEVER blocks the happy path
check("ws.unknown prose passthrough", mapEventToStatus("compiling 42 modules…", "spawning") === "spawning");
check("ws.unknown JSON event passthrough", mapEventToStatus('{"type":"telemetry","n":1}', "working") === "working");
check("ws.malformed JSON passthrough", mapEventToStatus("{broken", "spawning") === "spawning");

// progress validity — terminal absorbing, blocked pipeline forward-only
check("ws.terminal absorbing (done/failed eat every line)",
  mapEventToStatus('{"type":"message_delta"}', "done") === "done" &&
  mapEventToStatus("Do you trust the files?", "failed") === "failed");
check("ws.no rewind working→trust", canTransition("working", "trust_required") === false);
check("ws.mid-run grant dip legal (working→tool_permission→working)",
  canTransition("working", "tool_permission") && canTransition("tool_permission", "working"));
check("ws.blocking detection helpers",
  isBlockedStatus("trust_required") && isBlockedStatus("tool_permission") && !isBlockedStatus("working"));
check("ws.terminal helpers", isTerminalStatus("done") && isTerminalStatus("failed") && !isTerminalStatus("working"));

// spec §2.1 coarse mapping — blocked/ready persist as spawning until working
check("ws.toAgentStatus coarse map (spec §2.1)",
  toAgentStatus("trust_required") === "spawning" && toAgentStatus("tool_permission") === "spawning" &&
  toAgentStatus("ready_for_prompt") === "spawning" && toAgentStatus("working") === "working" &&
  toAgentStatus("done") === "done" && toAgentStatus("failed") === "failed");

// spec §2.2 failure classification — "non-zero → failed + WorkerFailureKind"
check("ws.classify timeout (authoritative flag)", classifyFailure({ timedOut: true }) === "timeout");
check("ws.classify permission_denied (died still blocked)",
  classifyFailure({ exitCode: 1, lastStatus: "tool_permission" }) === "permission_denied");
check("ws.classify context_window marker",
  classifyFailure({ exitCode: 1, lastStatus: "working", outputTail: "Error: prompt is too long" }) === "context_window");
check("ws.classify crash (non-zero exit before any assistant output)",
  classifyFailure({ exitCode: 1, lastStatus: "spawning" }) === "crash");
check("ws.classify unknown floor (never guess)",
  classifyFailure({ exitCode: 1, lastStatus: "working", outputTail: "some prose" }) === "unknown" &&
  classifyFailure({}) === "unknown");
}
