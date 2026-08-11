# DESIGN: Agent Permission Modes (Sprint 5.15)

> **Status**: SPEC COMPLETE — ready to implement after Sprint 5.13.
> **Source pattern**: claw-code `AgentsPermissionArg`
> (`rust/crates/claw-analog/src/agents.rs`) — 4 modes + named allowlists.
> **Guardrails**: PREVENT-ITH-004 (zero new deps); Stay in Scope.

## 1. Problem

ithacus agents are implicitly read-only (explore/plan/verification/reviewer)
except ad-hoc mutating dispatches. There is no declared, enforced permission
level per agent — a "writer" role was proposed but never formalized. claw-code
models explicit permission modes; ithacus should too, so dispatches are safe by
default and mutation is opt-in and auditable.

## 2. Design

### 2.1 Permission modes

```ts
// src/types.ts (pi-agnostic)
export type PermissionMode =
  | "read_only"        // read/grep/ls/find only
  | "workspace_write"  // + edit/write within repo worktree
  | "full_access";     // + bash + unrestricted tools (explicit opt-in only)

export interface AgentPermissions {
  mode: PermissionMode;
  allow?: string[];   // extra tool names beyond the mode's base set
  deny?: string[];    // explicit denies win over mode + allow
}
```

Three modes (not claw-code's four): `prompt` mode maps to read_only + a
prompt-only constraint already enforced by ithacus's prompt-builder; no need
for a separate enum value.

### 2.2 Base tool sets

| Mode | Base tools |
|---|---|
| read_only | read, grep, find, ls |
| workspace_write | + edit, write (scoped to the agent's worktree/cwd) |
| full_access | + bash and all registered tools |

`deny` always wins; `allow` adds to the base set. Resolution order:
deny → mode base → allow.

### 2.3 Declaration + enforcement

- **Declare**: `permission: <mode>` in agent frontmatter
  (`extensions/agents/*.md`), plus optional `allow:`/`deny:` lists.
  Missing → default `read_only` (fail-safe).
- **Enforce**: `extensions/ithacus-dispatch.ts` resolves the agent's
  `AgentPermissions` and passes a `--tools` allowlist (or denylist) to the
  child `pi` invocation. Enforcement is at the spawn boundary — the child
  process physically cannot call tools it wasn't given.
- **Audit**: every dispatch logs `{ agentId, mode, resolvedTools[] }` to the
  live store (visible in the 5.13 overlay footer) and to the ithacus store run
  record.

### 2.4 Agent definitions updated

| Agent | Mode |
|---|---|
| explore | read_only |
| plan | read_only |
| verification | read_only (+ `bash` in `allow` for running test commands) |
| reviewer | read_only |
| writer (NEW) | workspace_write |

The `writer` agent is added in this sprint (one frontmatter file, no other
changes) — it is the first workspace_write agent and exercises enforcement.

## 3. Files changed

| File | Change |
|---|---|
| `src/types.ts` | `PermissionMode`, `AgentPermissions` types |
| `src/permissions.ts` | NEW — pure resolve(decl, overrides) → toolset fn |
| `extensions/agents/{explore,plan,verification,reviewer}.md` | add `permission: read_only` (+ verification allow) |
| `extensions/agents/writer.md` | NEW — workspace_write agent definition |
| `extensions/ithacus-dispatch.ts` | resolve permissions → child `--tools` |

## 4. Testing

- Unit (src): `src/permissions.test.ts` — resolution matrix (mode × allow ×
  deny), deny-wins, missing→read_only, unknown mode→read_only.
- Integration: dispatch writer → confirm edit allowed; dispatch explore →
  confirm edit tool absent from child toolset.
- Gate: build + smoke + guardrails + regression.

## 5. Out of scope

- Interactive permission escalation (see claw-code's interactive `prompt` mode —
  future tier).
- Per-task permission narrowing (agents are static; tasks can't widen).
