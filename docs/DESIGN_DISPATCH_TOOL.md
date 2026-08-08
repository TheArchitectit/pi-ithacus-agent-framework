# Design: ithacus Dispatch Tool Migration

> **Status**: Spec — not yet implemented. Gate is RED on 2 `callTool` errors
> (`ithacus-swarm.ts:67`, `ithacus-team.ts:97`) by design; this doc is the
> plan to clear them in a dedicated sprint. Do NOT stub or fake `callTool`
> to make tsc green — that re-introduces the "weaken the gate" anti-pattern.
>
> **Decision**: Hybrid — register an `ithacus-dispatch` tool via
> `pi.registerTool()` (LLM-invoked entry point) AND ship ithacus's agent
> roster as markdown files matching the `pi-subagents` convention.
>
> **Scope**: This doc covers the dispatch-layer migration only. ithacus's
> existing `src/` orchestration (swarm, negotiation, synthesis, queue,
> handoff, plan) is KEPT — the tool wraps it, not replaces it.

---

## 1. The problem

ithacus's extension layer dispatches sub-agents via:

```ts
await pi.callTool("ithacus-agent", { agent, task, model });   // ithacus-team.ts:97
await pi.callTool("swarm-agent", { item, role, prompt });     // ithacus-swarm.ts:67
```

**`ExtensionAPI.callTool` does not exist.** Verified against the installed
`@earendil-works/pi-coding-agent` type definitions (`dist/core/extensions/types.d.ts`):

```
ExtensionAPI surface: on(), registerTool(), registerCommand(),
registerShortcut(), registerFlag(), getFlag(), registerMessageRenderer(),
registerEntryRenderer(), sendMessage(), sendUserMessage(), appendEntry(),
setSessionName(), getSessionName(), setLabel(), exec(),
getActiveTools(), getAllTools(), setActiveTools(), getCommands(),
setModel(), getThinkingLevel(), setThinkingLevel(), registerProvider(),
unregisterProvider(), events
```

Zero spawn/run/callTool/invoke methods. ithacus's dispatch core was built on a
method that never existed — it only "passed" because `scripts/smoke-src.mjs`
imports `src/` modules directly and never exercises the extension dispatch
path (612 assertions, all on the pi-agnostic layer).

---

## 2. The canonical pi pattern (from pi-subagents source)

Researched from three authoritative sources, all consistent:

1. **`pi-subagents` v0.44.0** (`~/.pi/agent/npm/node_modules/pi-subagents/`) —
   the canonical subagent package, loaded in THIS pi session. Source at
   `src/extension/index.ts:539-581` + `src/extension/fanout-child.ts:174-188`.
2. **pi's example subagent extension** (`examples/extensions/subagent/`) —
   ships with `@earendil-works/pi-coding-agent`.
3. **The installed `ExtensionAPI` + `ToolDefinition` type surface**.

### 2.1 The tool registration shape

```ts
import { Type } from "typebox";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

const DispatchParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent role name..." })),
  task:  Type.String({ description: "Task for the agent..." }),
  model: Type.Optional(Type.String({ description: "Model override..." })),
  // ... swarm / chain / plan variants
});

const tool: ToolDefinition<typeof DispatchParams, DispatchDetails> = {
  name: "ithacus-dispatch",
  label: "ithacus dispatch",
  description: "Dispatch a coordinated sub-agent team to do task work...",
  parameters: DispatchParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // orchestration lives here — calls ithacus's existing src/ modules
    return { /* AgentToolResult<DispatchDetails> */ };
  },
};

pi.registerTool(tool);   // <-- the LLM-invoked entry point
```

`ToolDefinition` contract (from `types.d.ts`):
- `name`, `label`, `description`, `parameters` (TypeBox `TSchema`).
- `execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>>`.
- Optional `prepareArguments`, `executionMode` (`"sequential" | "parallel"`),
  `renderCall`/`renderResult` (TUI components).

### 2.2 Subprocess-per-agent (isolated context + per-child model)

From `pi-subagents/src/extension/index.ts` + `examples/extensions/subagent/index.ts`:
inside `execute()`, subagents are spawned as **real `pi` processes** via
`node:child_process` `spawn`. The child `pi` runs with an isolated context
window and a `--model` flag for per-agent model assignment. Output captured
via JSON mode, returned as `AgentToolResult`.

This is the "different agents with different models to do task work" mission
made literal: each child `pi` process IS a different agent with a different
model, isolated from the parent.

### 2.3 Markdown agent definitions

From `pi-subagents/agents/` + `examples/extensions/subagent/agents/`:
agents are plain markdown files with YAML frontmatter:

```markdown
---
name: scout
description: Fast codebase recon returning compressed context for handoff
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

You are a scout. Quickly investigate a codebase and return structured findings...
```

Loaded via `discoverAgents()` (exported from `@earendil-works/pi-coding-agent`)
which searches `~/.pi/agent/agents/` (user) + `.pi/agents/` (project),
3-layer precedence (builtin < user < project).

---

## 3. ithacus hybrid architecture

ithacus OWNS the orchestration (swarm loop, negotiation, synthesis, priority
queue, handoff, plan runner) — all already built in `src/`. what's missing is
the **entry point**: a `pi.registerTool` wrapper that turns those modules
into an LLM-invocable tool.

### 3.1 The dispatch tool (extension layer)

New file: `extensions/ithacus-dispatch.ts` — registers `ithacus-dispatch` via
`pi.registerTool()`. Its `execute()` body dispatches to ithacus's existing
orchestration, but instead of `pi.callTool(name, args)`, it spawns real `pi`
subprocesses (the pi-subagents pattern) for each agent in the roster.

```
LLM invokes ithacus-dispatch tool
   │
   ▼
execute() in extensions/ithacus-dispatch.ts
   │
   ├── reads params (mode/preset, goal, agents[], model overrides)
   │
   ├── calls src/swarm.ts runSwarm() / src/plan.ts executePlan()
   │   (ithacus's orchestration — queue, negotiation, synthesis, handoff)
   │
   └── for each agent the orchestration dispatches:
        spawn("pi", ["--model", agentModel, "--agent", agentRole, ...])
          ↳ child pi process with isolated context
          ↳ markdown agent definition loaded via discoverAgents()
          ↳ JSON output captured → AgentToolResult
```

### 3.2 The agent roster (markdown layer)

New directory: `extensions/agents/` — ithacus's role definitions as markdown
files, matching the `pi-subagents` convention so the spawned child `pi`
processes pick up ithacus's roles:

| File | Role | Maps to ithacus mode preset role |
|---|---|---|
| `extensions/agents/explore.md` | Explore | scout/recon (read-only, fast) |
| `extensions/agents/plan.md` | Plan | planner (read-only, structured plan) |
| `extensions/agents/verification.md` | Verification | reviewer (read-only, quality) |
| `extensions/agents/worker.md` | Worker | general-purpose implementer |

Each file: YAML frontmatter (`name`, `description`, `tools`, `model`) +
body = system prompt. The `model` field is the per-agent model assignment
that realizes the mission ("different agents with different models").

### 3.3 Clean separation of concerns

| Layer | Owns | Lives in |
|---|---|---|
| **LLM entry point** | `pi.registerTool`, parameter schema, returning AgentToolResult | `extensions/ithacus-dispatch.ts` (new) |
| **Orchestration** | swarm loop, queue, negotiation, synthesis, handoff, plan | `src/swarm.ts`, `src/queue.ts`, `src/negotiation.ts`, `src/synthesis.ts`, `src/handoff.ts`, `src/plan.ts` (existing, kept) |
| **Agent spawn** | real `pi` subprocess via `node:child_process` spawn, isolated context, `--model` per child | `extensions/ithacus-dispatch.ts` (new spawn helper) |
| **Agent definitions** | role prompts + tool allowlists + default models | `extensions/agents/*.md` (new) |

The existing `createTeam` / `runSwarm` / `executePlan` paths in
`ithacus-team.ts` / `ithacus-swarm.ts` / `ithacus-plan.ts` keep their shape
but swap the `pi.callTool(...)` line for the in-file spawn helper.

---

## 4. Migration changes (what gets edited)

### 4.1 Clear the 2 tsc errors (the red flag)

**`extensions/ithacus-team.ts:97`** — replace `pi.callTool(...)`:
```ts
// BEFORE (phantom API):
const result = await pi.callTool("ithacus-agent", { agent, task, model });

// AFTER (real pi subprocess):
const result = await spawnAgent({ agent, task, model, cwd: ctx.cwd, signal });
```

**`extensions/ithacus-swarm.ts:67`** — same swap, in the swarm dispatch loop.

The `spawnAgent` helper lives in the new `extensions/ithacus-dispatch.ts`
(or a small `extensions/ithacus-spawn.ts` if dispatch.ts is over 500 lines).

### 4.2 Register the dispatch tool

**`extensions/ithacus.ts`** (entry) — add `registerDispatchTool(pi, runtime)`
call alongside the existing command registrations:
```ts
registerTeamCommands(pi, runtime, config);
registerSessionHandlers(pi, runtime, config);
registerDispatchTool(pi, runtime, config);   // NEW
```

### 4.3 Ship the agent roster

**`extensions/agents/*.md`** — 4 markdown files (explore, plan,
verification, worker). Match the `pi-subagents` frontmatter schema exactly.

### 4.4 PREVENT-ITH-004 annotation

`node:child_process` `spawn("pi", ...)` is a subprocess spawn — it does NOT
violate PREVENT-ITH-004 (zero network), since `pi` is a local binary and the
spawn is intra-machine. No `guardrails-allow` annotation needed (the rule
targets `node:http`/`node:https`/`node:net`/`fetch`/`WebSocket`, not
`node:child_process`). Confirm by re-reading the rule's pattern in
`.guardrails/prevention-rules/pattern-rules.json` before merging.

---

## 5. What this is NOT

- **NOT** a re-architecture of ithacus's orchestration. The swarm loop,
  negotiation, synthesis, queue, handoff, and plan runner stay exactly as
  built in `src/`. Only the dispatch entry point changes.
- **NOT** a replacement of `pi-subagents`. ithacus ships its OWN dispatch
  tool because its orchestration (priority queue, synthesis, negotiation)
  is richer than pi-subagents' single/parallel/chain modes. ithacus may
  also compose WITH pi-subagents' agent definitions if the user has that
  package installed (3-layer discovery picks up ithacus's `extensions/agents/`
  regardless).
- **NOT** a runtime dependency. `node:child_process` is a Node built-in.
  ithacus stays zero-runtime-deps (PREVENT-ITH-004 compliant).
- **NOT** touching the command handlers. `/ithacus-team`, `/ithacus-swarm`,
  `/ithacus-plan` slash commands keep working — they call the same
  `createTeam` / `runSwarm` / `executePlan` functions, which now dispatch via
  `spawnAgent` instead of the phantom `pi.callTool`.

---

## 6. Acceptance criteria (for the sprint that builds this)

- [ ] `npm run gate` green (the 2 `callTool` errors cleared by real fix, not stub).
- [ ] `ithacus-dispatch` tool registered; LLM can invoke it.
- [ ] Spawning a child `pi` process produces an isolated context window.
- [ ] Per-agent `--model` override respected (different models per child).
- [ ] ithacus's existing orchestration (`runSwarm`, `executePlan`) drives
      the dispatch loop unchanged.
- [ ] 4 markdown agent files in `extensions/agents/`, loadable by
      `discoverAgents()`.
- [ ] PREVENT-ITH-004 stays green (no `node:http`/`net`; `child_process` OK).
- [ ] No `as any` (PREVENT-011); typed `AgentToolResult<DispatchDetails>`.
- [ ] `extensions/ithacus-dispatch.ts` ≤ 300 lines; split if it grows past.
- [ ] Smoke tests cover the dispatch path (currently uncovered — the gap
      that let `callTool` ship broken).

---

## 7. Sprint placement

Add as **Sprint 5.10 — Dispatch Tool Migration** in `docs/SPRINT_PLAN.md`
(after Sprint 5.9 A2A). It's the capstone that makes Sprints 5.1-5.9
actually runnable under the current pi API — they were all built on the
phantom `callTool`. Blocked by nothing; blocks all of Tier 5 runtime.

Update `ITHACUS_DESIGN.md` P3 (Orchestrate sub-agents as plans dispatched
through pi's native agent runtime) to note: dispatch is via
`pi.registerTool` + subprocess spawn, not `pi.callTool`.

---

## 8. References

- `pi-subagents` v0.44.0 source: `src/extension/index.ts:539-581` (registerTool),
  `src/extension/fanout-child.ts:174-188` (ToolDefinition shape).
- pi example subagent extension: `examples/extensions/subagent/index.ts`
  (spawn("pi", ...) in execute body), `agents.ts` (discoverAgents),
  `agents/{planner,reviewer,scout,worker}.md` (markdown frontmatter).
- `ExtensionAPI` + `ToolDefinition` types: `dist/core/extensions/types.d.ts`
  in `@earendil-works/pi-coding-agent`.
- pi.dev docs: https://pi.dev/docs/latest/extensions (registerTool contract).
