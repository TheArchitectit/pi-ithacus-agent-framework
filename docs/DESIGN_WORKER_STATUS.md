# DESIGN: Richer Worker Status State Machine (Sprint 5.14)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Depends on**: Sprint 5.13 (live-progress overlay ✅-pending).
> **Source pattern**: claw-code `WorkerStatus`
> (`rust/crates/runtime/src/worker_boot.rs`) — see `RESEARCH_EXTERNAL_SOURCES.md`.
> **Guardrails**: PREVENT-ITH-004 (zero new deps); `src/` stays pi-agnostic.

## 1. Problem

ithacus models agent lifecycle as `src/types.ts` `AgentStatus = "spawning" |
"working" | "done" | "failed"` — 4 states. The live overlay (5.13) can only
show those four. Real dispatches have more distinguishable phases: waiting for
trust confirmation, waiting for a tool-permission grant, prompt ready but not
yet running, retrying after failure. claw-code models 7 states; ithacus users
asked for "per agent real time status" — richer states are cheap and directly
improve the 5.13 overlay.

## 2. Design

### 2.1 New enum in `src/types.ts`

```ts
export type WorkerStatus =
  | "spawning"             // dispatch accepted, child not yet up
  | "trust_required"       // child needs workspace trust confirmation
  | "tool_permission"      // child paused waiting for a tool-permission grant
  | "ready_for_prompt"     // child up, prompt queued, not yet running
  | "working"              // actively processing (tokens flowing)
  | "done"                 // finished successfully
  | "failed";              // finished with error

export type WorkerFailureKind =
  | "context_window"       // ran out of context (→ retry via Sprint 5.17)
  | "permission_denied"    // trust/tool permission never granted
  | "timeout"              // exceeded maxRuntimeMs
  | "crash"                // child process died
  | "unknown";
```

`AgentStatus` stays as the coarse stored type (backward compat with sqlite);
`WorkerStatus` is the live/runtime type. Mapping: spawning→spawning,
working→working, done→done, failed→failed; trust_required / tool_permission /
ready_for_prompt all persist as `spawning` until they become `working`.

### 2.2 Detection in the extension layer

`extensions/ithacus-dispatch.ts` maps child events → WorkerStatus:
- spawn accepted, no output yet → `spawning`
- trust-prompt marker in child output → `trust_required`
- permission-request JSON event → `tool_permission`
- first `assistant` turn / first usage event → `working`
- exit code 0 → `done`; non-zero → `failed` + `WorkerFailureKind`

Detection markers MUST be tolerant: unknown output never blocks the happy path
(defensive render rule from 5.13 §6.5).

### 2.3 Overlay rendering (extends 5.13)

| Status | Icon | Theme color |
|---|---|---|
| spawning | `◌` | muted |
| trust_required | `🔒` | warning accent |
| tool_permission | `🔑` | warning accent |
| ready_for_prompt | `›` | muted |
| working | `▸` | accent |
| done | `✓` | success |
| failed | `✗` | error |

## 3. Files changed

| File | Change |
|---|---|
| `src/types.ts` | add `WorkerStatus`, `WorkerFailureKind` types (pi-agnostic) |
| `extensions/ithacus-dispatch.ts` | event → status mapping |
| `extensions/ithacus-live.ts` | `AgentLive.status: WorkerStatus` + failureKind |
| `extensions/ithacus-live-card.ts` | per-status icon/color rows |
| `extensions/agents/*.md` | none |

## 4. Testing

- Unit (src): status-mapping pure function `mapEventToStatus(line, current)` in
  `src/worker-status.ts` — table-driven tests for each transition + unknown-line
  passthrough.
- Gate: `npm run build` + smoke + guardrails-scan + regression_check --all.

## 5. Out of scope

- Interactive granting of trust/permission from the overlay (read-only display).
- Changing sqlite-persisted `AgentStatus` (coarse type kept).
