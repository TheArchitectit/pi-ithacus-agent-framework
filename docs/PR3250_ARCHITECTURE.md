# PR #3250 — Team Orchestration Architecture

Author: TheArchitectit (roger@vroger.com)
Commit: d500c6567826488a700a880f06d3bb52f0d46cc9
Repo: ultraworkers/claw-code
Branch: fork/feat/team-pr-clean
Files changed: 18 (+3160 / -215)

---

## 1. Overview

PR #3250 adds coordinated sub-agent team execution to claw-code. A single LLM session can spin up N independent sub-agents that work in parallel, communicate via a shared mailbox, claim tasks atomically to prevent duplication, and report progress to a background watcher — all through filesystem primitives with zero external dependencies.

The PR touches 5 subsystems:

| # | Subsystem | Layer | Purpose |
|---|-----------|-------|---------|
| 1 | subagentModel wiring | runtime/config | Route sub-agents to a cheaper/faster model |
| 2 | Provider namespace separation | api/providers | Isolate custom OpenAI-compat endpoints |
| 3 | Parallel tool execution | tools/lib | Run read-only tools concurrently |
| 4 | Team coordination | tools/lib | Mailbox, claims, status, mode presets |
| 5 | Slash commands | commands + CLI | /team on\|off\|status, Ctrl+T toggle |

---

## 2. Subsystem 1 — subagentModel Wiring

### Problem

The `subagentModel` setting existed in config validation but was never actually read or stored. Sub-agents always fell back to the hard-coded `DEFAULT_AGENT_MODEL`.

### Solution

```
resolve_agent_model(Option<&str>) -> String
├── explicit model param (caller passes it)
├── subagentModel from RuntimeConfig  ← NEW
├── session's configured `model`      ← NEW
└── DEFAULT_AGENT_MODEL (fallback)
```

**Files:**
- `runtime/src/config.rs` — `subagent_model` field + accessor on `RuntimeFeatureConfig`
- `tools/src/lib.rs` — `resolve_agent_model()` chain, `load_subagent_model_from_config()`, `load_main_model_from_config()`

**Key insight:** The chain tries the cheapest/fastest model first (explicit → subagentModel → session model → default), so callers that don't specify a model automatically get the subagentModel if configured.

---

## 3. Subsystem 2 — Provider Namespace Separation

### Problem

Custom OpenAI-compatible endpoints (e.g. local vLLM, proxy gateways) shared the `OPENAI_*` env var namespace with real OpenAI. This caused credential conflicts and proxy 404s when bare model names were sent to the wrong provider.

### Solution

**New provider kind:** `custom-openai`
- Dedicated env vars: `CLAWCUSTOMOPENAI_API_KEY` / `CLAWCUSTOMOPENAI_BASE_URL`
- Default base URL intentionally empty — forces user to configure, prevents accidental credential leakage to real OpenAI

**Bare model normalization:** `qualify_for_provider()`
```rust
fn qualify_for_provider(model: &str) -> String {
    if model.starts_with("custom/") || model.contains('/') {
        return model.to_string();  // already qualified
    }
    if config.provider().kind() == Some("custom-openai") {
        return format!("custom/{model}");  // add prefix
    }
    model.to_string()
}
```

**Credential injection:** `inject_config_as_env_fallbacks()` runs at process startup + before each sub-agent spawn so `/setup`-saved credentials reach child threads without leaking into tests.

**Files:**
- `api/src/providers/openai_compat.rs` — `custom_openai()` constructor, `CUSTOM_OPENAI_ENV_VARS`
- `api/src/providers/mod.rs` — `custom/` prefix routing in `metadata_for_model()` + `detect_provider_kind()`, generic fallback token limit
- `api/src/error.rs` — `status_code()` + `response_body()` for 404 fallthrough detection
- `api/src/lib.rs` — re-exports `model_token_limit`, `ModelTokenLimit`
- `rusty-claude-cli/src/setup_wizard.rs` — option 5 saves `kind: 'custom-openai'`
- `rusty-claude-cli/src/main.rs` — `is_custom_openai_provider()`, `config_model_for_current_dir()` normalization

---

## 4. Subsystem 3 — Parallel Tool Execution

### Problem

When the model returns multiple `tool_use` blocks (e.g. 5 `read_file` calls), they executed sequentially. This was the biggest latency bottleneck for exploration-heavy tasks.

### Solution: 3-Phase Tool Loop

```
execute_batch(calls: &[ToolCall]) -> Vec<ToolResult>
├── Phase 1: Pre-hooks + permission checks (sequential — hooks may mutate state)
├── Phase 2: Tool execution (parallel for read-only via std::thread::scope)
└── Phase 3: Post-hooks + session updates (sequential — preserves ordering)
```

**Classification:**

| Category | Tools | Execution |
|----------|-------|----------|
| Parallel-safe (read-only) | read_file, glob_search, grep_search, WebFetch, WebSearch, ToolSearch, Skill, LSP, Git* | `std::thread::scope` → concurrent |
| Sequential-only (side-effect) | bash, write_file, edit_file, MCP, Agent, TaskCreate, NotebookEdit, REPL, PowerShell | Serial execution |

**Safety guarantees:**
- Pre/post hooks always sequential
- Permission checks complete before any tool executes
- Results pushed to session in original model order
- Thread scopes ensure all parallel work completes before return
- Falls back to sequential for single-tool batches

**Impact:** 5 parallel `read_file` calls → ~5x faster.

**Files:**
- `tools/src/lib.rs` — `execute_batch()` override on `ToolExecutor`, `is_parallel_safe()` classification
- `tools/MULTI_TOOL_README.md` — developer documentation

---

## 5. Subsystem 4 — Team Coordination Layer

This is the core of the PR. It adds 6 new tools and a background watcher thread.

### 5.1 Tool Inventory

| Tool | Actions | Permission | Purpose |
|------|---------|------------|--------|
| **TeamCreate** | — | DangerFullAccess | Spawn N agents with mode presets |
| **TeamDelete** | — | DangerFullAccess | Tear down team, clean mailbox + claims |
| **TeamStatus** | status/summary/events/inbox/kill/suggestions | ReadOnly | Monitor or terminate agents |
| **AgentMessage** | send/read/broadcast | ReadOnly | Inter-agent communication via FS mailbox |
| **TaskClaim** | claim/release/list | ReadOnly | Atomic task deduplication via tmp+rename |
| **AgentSuggestion** | — | ReadOnly | Propose AGENTS.md additions |
| **ContextRequest** | — | ReadOnly | Request files/symbols (budget: 3 cycles) |

### 5.2 Data Flow

```
TeamCreate("my-team", mode="3x", prompt="Refactor auth module")
│
├─ expand_team_mode("3x", prompt) → 12 tasks:
│   Explore×3, Plan×3, Verification×3, Reviewer×3
│
├─ For each task:
│   ├─ AgentInput { prompt, subagent_type, team_id, task_id }
│   ├─ resolve_agent_model() → qualify_for_provider()
│   ├─ spawn_agent_job() → std::thread::spawn
│   │   ├─ inject_config_as_env_fallbacks()
│   │   ├─ claim_task(task_id, agent_id, team_id)  ← atomic tmp+rename
│   │   ├─ build_agent_runtime()
│   │   │   ├─ with_auto_compaction_input_tokens_threshold(70% of model limit)
│   │   │   └─ with_turn_progress_reporter(TeamInboxReporter)
│   │   ├─ runtime.run_turn()
│   │   ├─ release_claim(task_id)
│   │   └─ persist_agent_terminal_state() → post_agent_completion_to_team_inbox()
│   └─ Agent manifest → {agent_id}.json on disk
│
├─ Persist team manifest → teams/{team_id}.json
│
└─ spawn_team_watcher() → background thread
    └─ Polls inbox/ every 1s, prints [team] progress to stderr
       Updates teams/{team_id}.json status when all agents finish
```

### 5.3 Mailbox Architecture

```
~/.clawd-agents/
├── mailbox/
│   ├── {agent-id}/          # Per-agent inbox
│   │   └── msg-{ts}.json   # AgentMessage send
│   └── team/{team-id}/     # Team-level events
│       ├── tp-{agent}-{iter}-{ts}.json  # TeamInboxReporter progress
│       └── kill-{agent}-{ts}.json       # Kill signals
├── claims/
│   └── {task-id}.lock      # Atomic task claim file
├── teams/
│   ├── {team-id}.json      # Team manifest
│   └── {team-id}-events.jsonl  # Append-only event log
├── suggestions/
│   └── suggestion-{agent}-{ts}.json  # AGENTS.md proposals
└── worktrees/
    └── {agent-id}/          # Git worktree per agent (optional)
```

### 5.4 Atomic Task Claims

The `claim_task()` function uses tmp+rename for atomicity:
```rust
fn claim_task(task_id, agent_id, team_id) -> Result<bool> {
    let tmp = dir.join(format!("{task_id}.lock.tmp.{agent_id}"));
    let lock = dir.join(format!("{task_id}.lock"));
    fs::write(&tmp, json!({task_id, agent_id, team_id, claimed_at}));
    match fs::rename(&tmp, &lock) {
        Ok(()) => Ok(true),           // Won the race
        Err(_) => { fs::remove_file(&tmp); Ok(false) }  // Lost
    }
}
```

This is safe on POSIX: `rename(2)` is atomic when src and dst are on the same filesystem. The loser's `rename` fails, they clean up their temp file, and the task is already claimed.

### 5.5 Mode Presets

| Mode | Alias | Per-role count | Total agents |
|------|-------|---------------|-------------|
| 1x | tiny | 1 | 4 (3 builders + 1 reviewer) |
| 2x | small | 2 | 8 (6 + 2) |
| 3x | medium | 3 | 12 (9 + 3) |
| 4x | large | 4 | 16 (12 + 4) |
| 5x | xlarge | 5 | 20 (15 + 5) |
| 6x | mega | 6 | 24 (18 + 6) |

Roles: Explore, Plan, Verification + Reviewer (1 per 3 builders, min 1). Reviewers are read-only — they can't write files or run bash.

> **Formula:** `reviewer_count = max(1, (3 * n) / 3) = n` where n = mode multiplier. With 3 builder roles, the 1-per-3 rule always equals n reviewers per team.

### 5.6 TeamInboxReporter

Implements `TurnProgressReporter` trait. On every tool call:
1. Writes a JSON progress event to the team inbox
2. Every 5 iterations: auto-commits git changes (progress preservation)
3. Checks for kill signals from the team lead

### 5.7 AGENTS.md Shared Learnings

Sub-agents receive the contents of `AGENTS.md` (if it exists) appended to their system prompt. This creates a feedback loop:
1. Agents use `AgentSuggestion` to propose patterns/pitfalls
2. Human reviews with `TeamStatus(action='suggestions')`
3. Accepted suggestions go into `AGENTS.md`
4. Next team run inherits the learnings

---

## 6. Subsystem 5 — Slash Commands & REPL

### /team command

```
/team on     → CLAWD_AGENT_TEAMS=1
/team off    → CLAWD_AGENT_TEAMS=0
/team status → show current state
```

### Ctrl+T toggle

Hotkey toggle in the REPL, same env var. `TeamCreate` checks this var and refuses with a clear message if teams are disabled.

### /setup re-run

`ProviderSwap` outcome in the REPL re-runs the setup wizard and hot-swaps the active model.

### run_turn_to<W: Write>()

Refactored `run_turn` to accept a generic writer, enabling both stdout REPL and TUI dashboard output from the same code path.

**Files:**
- `commands/src/lib.rs` — `SlashCommand::Team`, `SlashCommand::Lsp`, `/team` spec
- `rusty-claude-cli/src/main.rs` — `TeamToggle`, `ProviderSwap` read outcomes, `run_turn_to<W>`, `run_repl_from_cli()`
- `rusty-claude-cli/src/input.rs` — `ReadOutcome::TeamToggle`, `ReadOutcome::ProviderSwap`, Ctrl+T keybinding

---

## 7. File Layout (18 files)

### API Layer (4 files)
| File | Changes |
|------|--------|
| `api/src/error.rs` | `status_code()`, `response_body()` for 404 fallthrough |
| `api/src/lib.rs` | Re-exports `model_token_limit`, `ModelTokenLimit` |
| `api/src/providers/mod.rs` | `custom/` routing, generic token limit fallback |
| `api/src/providers/openai_compat.rs` | `custom_openai()` constructor, `CLAWCUSTOMOPENAI_*` env vars |

### Runtime Layer (3 files)
| File | Changes |
|------|--------|
| `runtime/src/config.rs` | `subagent_model` field + accessor |
| `runtime/src/conversation.rs` | `execute_batch` on `ToolExecutor`, `TurnProgressReporter` trait, 3-phase loop |
| `runtime/src/lib.rs` | Re-exports of all new items |

### Tools Layer (2 files)
| File | Changes |
|------|--------|
| `tools/src/lib.rs` | **Core:** 6 new tools, `run_team_create`, `run_agent_message`, `run_task_claim`, `run_team_status`, `run_agent_suggestion`, `run_context_request`, `expand_team_mode`, `spawn_team_watcher`, `claim_task`, `release_claim`, `qualify_for_provider`, `resolve_agent_model`, `TeamInboxReporter`, `post_agent_completion_to_team_inbox`, `setup_agent_worktree`, `teardown_agent_worktree`, worktree-aware `run_agent_job` |
| `tools/MULTI_TOOL_README.md` | Developer documentation for parallel execution + sub-agents |

### CLI Layer (4 files)
| File | Changes |
|------|--------|
| `commands/src/lib.rs` | `SlashCommand::Team`, `SlashCommand::Lsp`, `/team` spec |
| `rusty-claude-cli/src/main.rs` | `TeamToggle`, `ProviderSwap`, `run_turn_to<W>`, `run_repl_from_cli`, `is_custom_openai_provider`, env injection |
| `rusty-claude-cli/src/input.rs` | `ReadOutcome::TeamToggle`, `ReadOutcome::ProviderSwap`, Ctrl+T |
| `rusty-claude-cli/src/setup_wizard.rs` | Option 5 → `custom-openai` kind, `CLAWCUSTOMOPENAI_*` env vars |

### Config & Docs (2 files)
| File | Changes |
|------|--------|
| `rusty-claude-cli/Cargo.toml` | Dependency adjustments |

### Minor / Ancillary (4 files)
| File | Changes |
|------|--------|
| `Cargo.lock` | File mode change (100755→100644), no content diff |
| `Cargo.toml` (workspace) | `unsafe_code` lint relaxed from `forbid` to `warn` (TUI dup/dup2 needs unsafe) |
| `api/src/client.rs` | `custom-openai` provider match arm in `ProviderClient::new()` |
| `tools/src/lane_completion.rs` | `team_id`/`task_id` fields added to test struct |

---

## 8. Key Design Decisions

| Decision | Rationale |
|----------|----------|
| FS mailbox (not in-process channels) | Agents run in separate threads that may crash; FS survives panics. Enables kill signals and manual inspection. |
| Atomic tmp+rename for claims | POSIX `rename(2)` is atomic on same FS. No lock files, no stale locks, no `fcntl` complexity. |
| `CLAWD_AGENT_TEAMS` env var gate | Zero-config toggle. Thread-safe (env reads are atomic). Doesn't require config file changes. |
| `std::thread::scope` for parallel tools | Scoped threads borrow parent's stack lifetime — no `'static` bounds, no `Arc`. Natural fit for read-only batch. |
| Generic token limit fallback (`_ => 128K`) | Prevents "unknown model → no limit → context overflow" bug for custom/proxy models. |
| 70% auto-compaction threshold | Leaves headroom for the compaction summary itself + the next turn. Avoids hitting the hard limit. |
| `inject_config_as_env_fallbacks` at two points | Process startup (main REPL) + pre-spawn (sub-agent threads). Already-set env vars preserved. |
| AGENTS.md feedback loop | Agents propose, humans approve. Prevents agents from overwriting shared learnings unilaterally. |
| Git worktree per agent (opt-in) | Isolation prevents merge conflicts between parallel agents. Falls back to CWD if worktree creation fails. |
| `[team]` stderr prefix | Machine-parseable progress events. The watcher thread is the only writer — no interleaving. |

---

## 9. Patterns Borrowed by Ithacus

The pi-ithacus-agent-framework TypeScript port replicates these patterns:

| PR #3250 (Rust) | Ithacus (TS/pi) | Status |
|-----------------|-----------------|--------|
| `TeamCreate` mode presets | `src/team.ts` `planRun()` | 🟡 Different model |
| `resolve_agent_model` chain | `src/team.ts` `resolveAgentModel()` | ✅ |
| `qualify_for_provider()` custom/ prefix | `src/team.ts` `qualifyForProvider()` | ✅ |
| `execute_batch` parallel-safe | `src/parallel.ts` `executeBatch()` | ✅ |
| FS mailbox → DB inbox | `store.ts` `sendMessage`/`unread`/`markRead` | ✅ |
| `/team on\|off\|status` → `/ithacus-team` | `extensions/ithacus-commands.ts` | ✅ Adapted name |
| 404 chain-fallthrough | Model-call wrapper | ⬜ Not yet |
| `/setup` credential injection | `extensions/ithacus-team.ts` | ⬜ Not yet |
| `TeamInboxReporter` progress | `dashboard.json` stub | 🟡 Partial |

---

*Document generated from commit d500c65 of ultraworkers/claw-code, PR #3250.*
