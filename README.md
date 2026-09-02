# ithacus

Turns [pi](https://github.com/earendil-works/pi) from a single coding agent into a team.

ithacus is the orchestration layer that sits between pi and your LLM provider. It handles the stuff that matters when you're running multiple agents: who gets which task, what model they use, how much it costs, what happens when they fail, and how their context survives long enough to actually finish the job.

## Install

```bash
pi install npm:ithacus
```

From source:

```bash
git clone https://github.com/TheArchitectit/pi-ithacus-agent-framework.git \
  ~/.pi/agent/extensions/pi-ithacus-agent-framework
cd ~/.pi/agent/extensions/pi-ithacus-agent-framework
npm install && npm run build
```

## What it does

**Team dispatch.** You describe a task. ithacus breaks it down, assigns sub-agents through pi native subprocess spawning, picks the right model for each one (Speed for exploration, Quality for reviews, Local for simple stuff), and tracks everything through SQLite. Each agent gets its own git worktree so they don't step on each other.

**Cost-aware routing.** Five model profiles with cost multipliers. Speed costs 0.5x, Quality costs 3x, Local costs 0.1x. The system routes simple tasks to cheap models and saves the expensive ones for where they matter. Over a month of daily use, that is the difference between $525 and $150 in API costs.

**Inter-agent negotiation.** Agents don't just get told what to do. They get a TaskOffer with budget, deadline, and required capabilities. They can accept, reject, or counter-offer. Resource locking is reader-writer — multiple agents can read a file simultaneously, only one writes at a time. This is the kind of coordination human teams do verbally, encoded as a protocol.

**Result synthesis.** When multiple agents produce outputs, the synthesis engine merges them. Majority vote. Weighted merge. Conflict detection with attribution — if three agents disagree, you see exactly who said what and why. Quality scoring on every result.

**Dispatch resilience.** When a sub-agent fails on context window overflow, ithacus rebuilds a compacted continuation from durable state and spawns a fresh child. Never reuses the dead session. Transient failures get exponential backoff. Auth failures stop immediately — no retrying a broken key 12 times.

## How it works with pi-mega-compact

ithacus handles short-term context: in-conversation checkpoints, retry continuations, live progress snapshots. [pi-mega-compact](https://github.com/earendil-works/pi-mega-compact) handles long-term memory: three-layer semantic dedup, RAPTOR hierarchical compression, KV cache poison detection, cross-repo recall.

They are designed to run together. When both are loaded, ithacus steps back from compaction entirely. pi-mega-compact owns the window — it decides when to compact, what to recall, and what to inject into the context tail. ithacus keeps its checkpoints and memory consolidation (those are its own stores), but it does not call compact. This was not always the case. Earlier versions had both systems independently deciding to compact the same turn, which produced duplicate context dumps. The fix was simple: one authority. ithacus defers. mega-compact decides.

If you run ithacus without pi-mega-compact, set `ITHACUS_SELF_COMPACT=true` to restore the built-in compaction path. It fires at the 40% window mark and uses the same checkpoint/prune logic.

## Context and memory

- **Checkpoints.** Mark a point in the conversation, prune exploratory messages after it, keep a concise summary. Rewind to any checkpoint. Mirrored to SQLite for cross-run visibility via `/ithacus-checkpoints`.
- **Hindsight.** Lessons learned from a session, recalled by relevance. Separate from pi-mega-compact's context memory — this is about what worked and what didn't, not what was said.
- **Memory consolidation.** SUPERSEDE → COLLAPSE → CLUSTER pipeline on the ith_memories table. Obsolete entries get tombstoned. Near-duplicates merge into the newest. Semantic clusters get tagged for faster recall. Pure functions, dry-run plans, metadata-only — never rewrites text.

## Safety

- **Guardrails.** Pattern matching and pre-work checks that keep agents from running destructive commands. Forbidden patterns: `rm -rf`, `DROP TABLE`, force push to main, `--no-verify`. Path validation. Tool permission scopes.
- **File reservations.** Agents claim file paths via SQLite. Two agents writing to the same file is a bug, not a race condition.
- **Team layout rules.** Four-phase pipeline enforcement. Strategy → Platform → Development → Security review. Team size must be 4-6. Hard gates before production.

## Also includes

Code review with P0-P3 scoring. Atomic commit splits. Config inheritance from 8 formats (Cursor, Cline, Codex, Copilot, Aider, Continue, Cody, generic). Skills auto-discovery. GitHub URI schemes (`pr://`, `issue://`, `conflict://`). Metrics with Prometheus/OTLP export. Plugin registry with lifecycle hooks. LSP client (14 ops). DAP client (28 ops). Browser automation. TUI with differential rendering. Collab relay. AST matcher. Goal loops. Scheduler. A2A protocol adapter. Advisor mode (second model watching turns, budget-limited notes).

## Architecture

All `src/` modules are pi-agnostic. They never touch the network, filesystem, or process layer directly. Every external dependency is injectable. The entire codebase is unit-testable with mocks. Real runtime wiring lives in `extensions/` where it is explicit and annotated.

## License

BSD 3-Clause

## ☕ Support

If this project helped you, consider buying me a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-TheArchitectit-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/TheArchitectit)

---

## ☕ Sponsor

If this project helps you, consider sponsoring on GitHub: [github.com/sponsors/TheArchitectit](https://github.com/sponsors/TheArchitectit)
