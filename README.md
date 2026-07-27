# pi-ithacus-agent-framework

Brings popular agentic coding styles into [pi](https://github.com/earendil-works/pi). Structured agent workflows, guardrails, task tracking, and a setup flow that makes spawning sub-agents and agents easy to navigate.

## What's here now

**Core orchestration**
- **Workflow DAG engine** — topological sort, wave execution (parallel within wave, sequential across)
- **Team orchestration** — translates team plans into pi-native sub-agent dispatch with per-agent model assignment
- **Sprint task framework** — task lifecycle store with priorities, dependencies, and SQLite persistence
- **Parallel tool execution** — read-only tools run concurrently, state-mutating tools run sequentially (from PR #3250)

**Safety & guardrails**
- **Prevention rules** — pattern matching, semantic rules, and pre-work checks that keep agents from going off the rails
- **Reverse Prompt Validation** — scores prompt quality (clarity, specificity, scope, safety) before execution; blocks on low safety scores
- **File reservations** —agents claim file paths via SQLite to prevent conflicting writes

**Agent management**
- **Model profiles** — 5 pre-seeded profiles (Speed, Quality, Reasoning, Code, Local) with per-role assignment and cost estimation
- **Presence tracking** — agent status registry with heartbeat and stuck detection
- **Cost tracking** — token usage and spend per agent, per role, per run
- **Worktree isolation** — git worktree per agent with auto-cleanup on completion/failure
- **Async background runs** — detached child processes that survive parent session disconnect

**Context & memory**
- **Checkpoint/rewind** — mark checkpoints, prune exploratory context, keep concise summaries
- **Hashline edits** — content-hash anchored edit format that reduces token cost ~40% vs native
- **Hindsight memory** — retain key facts, recall by relevance, reflect (compress sessions into mental model)
- **Stream rules** — regex-based rules that fire mid-generation and survive context compaction
- **Durable trim relief** — compacts context during long team runs at safe settle points

**Multi-agent workflows**
- **DAG step executor** — retry, timeout, on_error routing with rich step types (CONDITION, LOOP, HUMAN_REVIEW, SUBWORKFLOW)
- **YAML workflow templates** — loader + validator with minimal indentation-based parser
- **Inter-agent negotiation** — TaskOffer/Accept/Reject/Counter protocol with resource requests
- **Agent handoff** — capability-based routing with priority and availability weighting
- **Swarm dispatch** — priority-ordered work queue with blocked-wait, checkpointing, and result aggregation
- **Result synthesis** — merges multiple agent outputs with attribution, conflict detection, and confidence scoring

**Intelligence & tooling**
- **Advisor mode** — second model watches turns and injects notes (concern/blocker/suggestion) with budget control
- **Code review** — P0-P3 priority scoring with confidence per finding, aggregated into a verdict
- **Atomic commit splits** — analyzes working tree changes, splits unrelated changes into dependency-ordered commits
- **Config inheritance** — reads 8 formats (Cursor MDC, Cline .clinerules, Codex AGENTS.md, Copilot applyTo, Aider, Continue, Cody, generic)
- **Skills auto-discovery** — 3-layer discovery (extension < user < project) with SKILL.md validation
- **GitHub schemes** — `pr://`, `issue://`, `conflict://` URI resolution
- **Metrics** — counters, gauges, histograms with Prometheus and OTLP export
- **Plugin registry** — lifecycle hooks and context injection into agent spawn
- **Activity feed** — event table tracking agent actions with metadata

**Pi-agnostic client layers (injectable transports, zero-network in src/)**
- **LSP client** — 14 operations (diagnostics, definition, references, rename, code actions, symbols, hover, etc.)
- **DAP client** — 28 debug adapter operations (breakpoints, stack traces, variables, eval, etc.)
- **Browser automation client** — tabs, navigation, evaluate, screenshots, click, type, snapshot
- **Persistent eval client** — Python + Bun cells with tool re-entry bridge
- **TUI client** — differential rendering, tool cards, edit previews, ask picker, QR codes
- **Collab relay client** — host/join/leave, chat/edit/presence broadcast, read-only links
- **AST matcher** — regex-based structural matching with ast-grep-style capture syntax
- **Goal loops** — autonomous multi-turn with LLM judge and threshold-driven completion
- **Dynamic workflows** — function-based workflow engine with trust model and budget enforcement
- **Scheduler** — cron, interval, and one-shot scheduling with max-runs and deadline

## What's coming

- **Sub-agent setup dashboard** — React web UI pairing with [pi-setup](https://github.com/TheArchitectit/pi-setup) for configuring agents and sub-agents without editing JSON. Same dashboard style as [pi-mega-compact](https://github.com/TheArchitectit/pi-mega-compact)
- **Extension wiring** — connecting the pi-agnostic LSP/DAP/browser/eval/TUI/collab clients to real runtime processes (LSP servers, Puppeteer/CDP, debug adapters, etc.)
- **Budget governor** — USD cap with 50%/90% alerts and refuse-to-exceed
- **Leader election** — capability-based election and delegation
- **Keyword router** — weighted task routing by keyword to agent roles
- **In-process messaging bus** — pub/sub blackboard for swarm agents
- **Failure recovery protocol** — Phoenix-style structured recovery states
- **Distributed task claiming** — leases with stale-expiry for multi-node dispatch
- **Deadline queue** — pop by highest priority or earliest deadline, overdue tracking
- **Sprint tracker** — sprint/status/tasks/token-metrics/file-mod tracking
- **52-week planning scheduler** — Gantt-style dependency-aware auto-scheduling
- **A2A protocol adapter** — HTTP/JSON-RPC, SSE streaming, HMAC webhooks, Agent Card discovery, federation

## How it fits in

Install alongside [pi-mega-compact](https://github.com/TheArchitectit/pi-mega-compact) for context compression and pi-setup for the React config dashboard. Together they give you a full agentic coding environment that runs with any OpenAI-compatible provider — local or cloud.

## Architecture

All `src/` modules are **pi-agnostic** — they never touch the network, filesystem, or process layer directly (PREVENT-ITH-004). Every external dependency (LSP transport, browser driver, DAP transport, LLM actor, etc.) is injectable via dependency injection, so the entire codebase is unit-testable with mocks. Real runtime wiring lives in `extensions/` where exception annotations are explicit.

## Install

```bash
pi install npm:pi-ithacus-agent-framework
```

From source:

```bash
git clone https://github.com/TheArchitectit/pi-ithacus-agent-framework.git \
  ~/.pi/agent/extensions/pi-ithacus-agent-framework
cd ~/.pi/agent/extensions/pi-ithacus-agent-framework
npm install && npm run build
```

## License

MIT

## ☕ Support

If this project helped you, consider buying me a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-TheArchitectit-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/TheArchitectit)
