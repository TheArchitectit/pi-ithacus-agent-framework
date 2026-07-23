# GAP ANALYSIS: ithacus vs oh-my-pi

> **Last updated**: 2025-01  
> **ithacus**: v0.1.0 — 14 files, 1,216 lines (TypeScript, ESM, pi extension)  
> **oh-my-pi**: v17.0.9 ([can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)) — 55K+ LoC Rust core, 19.3k stars, 535 releases

---

## 1. Overview

**oh-my-pi** is a **complete rewrite of the Pi platform** — not an extension, not a plugin, but a fork of Pi itself. It ships a Rust core with TypeScript orchestration, delivering native-performance tools, embedded LSP/DAP, browser automation, multi-model collaboration, and a custom TUI. It is a monolithic platform replacement.

**ithacus** is a **pi extension** — 14 files, ~1,216 lines of TypeScript that run inside the standard Pi runtime. It adds coordinated sub-agent teams, durable context trimming, a local SQLite store, and formal safety guardrails. It installs via `pi install npm:ithacus` and requires zero network calls at runtime.

**These are not direct competitors.** oh-my-pi is the platform; ithacus is a plugin. However, oh-my-pi's feature set defines what "best-in-class" looks like for a coding agent, and informs what ithacus should build, integrate, or intentionally defer.

---

## 2. Feature Matrix

### 2.1 Tools

| Capability | oh-my-pi | ithacus | Notes |
|---|---|---|---|
| File read (files, dirs, archives, SQLite, PDF, notebooks, URLs, internal schemes) | ✅ `read` — single tool, 15+ source types | ❌ Uses pi built-in | omp's read handles everything from zip to jupyter to `pr://` |
| File write | ✅ `write` | ❌ Uses pi built-in | |
| Hashline edit | ✅ `edit` — content-hash anchored | ❌ Uses pi's default edit format | omp: 61% fewer output tokens, stale-anchor recovery |
| AST edit (preview + accept) | ✅ `ast_edit` | ❌ | Structured AST-aware edits with diff preview |
| AST grep (50+ grammars) | ✅ `ast_grep` | ❌ | Tree-sitter based, cross-language |
| Regex search | ✅ `search` | ❌ Uses pi built-in | |
| Glob find | ✅ `find` | ❌ Uses pi built-in | |
| Bash (PTY + background) | ✅ `bash` — full PTY, background tasks | ❌ Uses pi built-in | omp: real PTY emulation, background task management |
| Eval (Python + Bun, tool re-entry) | ✅ `eval` — persistent cells | ❌ | Agent can load CSV from Python, chart from JS, bridge tools |
| SSH | ✅ `ssh` | ❌ | Remote execution |
| LSP (14 operations) | ✅ `lsp` | ❌ | Diagnostics, navigation, symbols, renames, code actions, willRenameFiles |
| DAP / Debug (28 operations) | ✅ `debug` | ❌ | Breakpoints, stepping, threads, stack, variables, attach lldb/dlv/debugpy |
| Subagent task fanout | ✅ `task` — worktree isolation, schema validation | ✅ `planRun` — mode presets (tiny..mega), 4 roles | omp: typed results, cost+duration per agent, concurrency control |
| Hub (message/wait/cancel agents) | ✅ `hub` | ❌ | |
| Todo (phase tracking) | ✅ `todo` | ❌ | |
| Ask (structured questions) | ✅ `ask` | ❌ | picker UI in TUI |
| Browser (Puppeteer + CDP) | ✅ `browser` | ❌ | Stealth by default, tab management |
| Web search (25 providers) | ✅ `web_search` | ❌ | Perplexity, Gemini, Anthropic, Exa, Jina, Kagi, Tavily, Brave, etc. |
| GitHub schemes (`pr://`, `issue://`) | ✅ `github` | ❌ | Read `pr://1428` returns same shape as `read src/foo.ts` |
| Image generation | ✅ `generate_image` | ❌ | |
| Image inspection | ✅ `inspect_image` | ❌ | |
| TTS | ✅ `tts` | ❌ | |
| Checkpoint | ✅ `checkpoint` | ❌ | Mark state for collapse-and-report |
| Rewind | ✅ `rewind` | ❌ | Prune exploratory context, keep concise report |
| Retain / Recall / Reflect | ✅ `retain` / `recall` / `reflect` | ✅ SQLite `recall` (decision/fact/preference) | omp: full Hindsight memory with session compression |
| Resolve (preview actions) | ✅ `resolve` | ❌ | |
| **Total built-in tools** | **32** | **0** (uses pi's built-ins) | |

### 2.2 Edit Format

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Edit algorithm | **Hashline** — content-hash anchored edits | pi default (apply_patch / search-replace) |
| Stale-anchor recovery | ✅ Auto-retries with fuzzy match | ❌ |
| Token efficiency | 61% fewer output tokens | Baseline |
| AST-aware edits | ✅ `ast_edit` with preview+accept | ❌ |
| AST grep | ✅ 50+ tree-sitter grammars | ❌ |

### 2.3 Subagents & Orchestration

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Fan-out model | `task` tool — spawns isolated agents | `planRun` with mode presets (tiny/small/medium/large/xlarge/mega) |
| Isolation | ✅ Git worktree per agent | ❌ No worktree isolation |
| Result validation | ✅ Schema-validated typed results | ❌ Prose parsing |
| Cost tracking | ✅ Per-agent cost + duration | ❌ |
| Constraints | ✅ Constraints block per task | ❌ |
| Concurrency control | ✅ Configurable parallelism | ✅ `execute_batch` parallel mode |
| Role system | N/A (task-based) | ✅ 4 roles: Explore, Plan, Verification, Reviewer |
| Model resolution | Implicit | ✅ 4-tier fallthrough chain (PR #3250 pattern) |

### 2.4 Memory

| Feature | oh-my-pi | ithacus |
|---|---|---|
| System | **Hindsight** (retain/recall/reflect) | SQLite recall (decision/fact/preference) |
| Scope | Project-scoped | Project-scoped |
| Session compression | ✅ Compresses into mental model, loads on first turn | ❌ |
| Pressure scaling | ❌ | ✅ Scales review frequency by context pressure |
| Anchor floor | N/A | ✅ Never drops recent messages (PREVENT-ITH-001) |
| Tool-pair preservation | N/A | ✅ Never splits toolCall/toolResult (PREVENT-ITH-002) |

### 2.5 Advisor & Review

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Advisor mode | ✅ Second model watches every turn, injects inline notes (concern/blocker/suggestion) | ❌ |
| Advisor context | Separate context + model | N/A |
| Code review | ✅ `/review` — dedicated reviewer subagents, P0-P3 priority, confidence scoring, parallel branch/commit/uncommitted sweep | ❌ |

### 2.6 Collaboration & Communication

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Session relay | ✅ `/collab` — puts session on relay | ❌ |
| QR code sharing | ✅ | ❌ |
| Read-write / read-only links | ✅ | ❌ |
| Sealed frames | ✅ Client-side sealing | ❌ |
| Presence (who's online) | ✅ | ❌ |
| File reservations | ✅ | ❌ |

### 2.7 Code Execution

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Persistent Python | ✅ `eval` — long-lived process | ❌ |
| Persistent Bun/JS | ✅ `eval` — long-lived process | ❌ |
| Tool re-entry bridge | ✅ Agent loads CSV from Python, charts from JS | ❌ |
| Matplotlib / visualization | ✅ Inline rendering | ❌ |

### 2.8 Search & Web

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Web search providers | 25 (Perplexity, Gemini, Anthropic, Codex, xAI, Exa, Jina, Kagi, Tavily, Firecrawl, Brave, etc.) | ❌ |
| Site-aware extraction | ✅ GitHub, npm, PyPI, arxiv, SO, HN, MDN | ❌ |
| Security databases | ✅ NVD, OSV, CISA KEV | ❌ |
| Browser automation | ✅ Puppeteer + CDP, stealth mode | ❌ |

### 2.9 LSP & DAP

| Feature | oh-my-pi | ithacus |
|---|---|---|
| LSP operations | 14 (diagnostics, navigation, symbols, renames, code actions, willRenameFiles) | ❌ |
| DAP operations | 28 (breakpoints, stepping, threads, stack, variables, attach lldb/dlv/debugpy) | ❌ |
| Language servers | Multiple (language-agnostic) | ❌ |

### 2.10 Platform Features

| Feature | oh-my-pi | ithacus |
|---|---|---|
| GitHub schemes | ✅ `pr://`, `issue://`, `conflict://` | ❌ |
| Atomic commit splits | ✅ Dependency-ordered commits, source > tests > docs scoring | ❌ |
| Conflict resolution | ✅ `conflict://N` scheme | ❌ |
| Config inheritance | ✅ 8 formats (Cursor MDC, Cline .clinerules, Codex AGENTS.md, Copilot applyTo, etc.) | ❌ |
| Stream rules | ✅ Time-traveling regex — aborts mid-token, injects system reminder, retries, survives compaction | ❌ |
| Checkpoint / Rewind | ✅ Mark state, prune exploratory context | ❌ |
| TUI | ✅ Differential rendering, tool cards, edit previews, ask picker, QR codes, sixel images | ❌ (uses pi default) |
| Self-update | ✅ Built-in | ❌ |
| Skills | ✅ Auto-discovery, `skill://` scheme | ❌ |
| Native performance | ✅ 55K LoC Rust (ripgrep, glob, find, AST, PTY, highlight, BPE counting) | ❌ Uses pi's built-in tools (shell out) |
| Provider support | 40+ (Frontier APIs, Coding plans, Self-hosted, Custom YAML) | pi's providers + CLAWCUSTOMOPENAI_* env vars |

---

## 3. Honest Assessment

oh-my-pi is **not an extension** — it's a platform rewrite. ithacus cannot and should not replicate its Rust native layer. The right framing:

| Category | Strategy | Rationale |
|---|---|---|
| **Build as extension features** | Advisor mode, checkpoint/rewind, hashline edits, presence, file reservations, cost reporting, workflow DAG, worktree isolation | These are feature-level additions that fit the extension model |
| **Integrate oh-my-pi patterns** | Stream rules (regex-based mid-stream injection), config inheritance (read existing rule files), subagent schema validation | These are patterns we can adapt without Rust |
| **Cannot replicate** | 55K LoC Rust native tools, 32 built-in tools, 14 LSP ops, 28 DAP ops, embedded bash, persistent Python/Bun eval, browser automation, collab relay | Requires Rust rewrite; not viable for an extension |
| **Unique to ithacus** | Zero-network guardrails (PREVENT-ITH-004), formal safety rules, pi-agnostic separation, lightweight footprint, PR #3250 model chain | These are our differentiators |

---

## 4. CRITICAL Gaps (blocks adoption)

These gaps represent features that power users will expect from a serious coding agent. Without them, ithacus cannot compete for users evaluating against oh-my-pi.

| ID | Gap | Impact | Effort | oh-my-pi reference |
|---|---|---|---|---|
| **C1** | **Hashline edit format** | 61% fewer output tokens, perfect edits on first attempt | Medium | `edit` tool with content-hash anchoring |
| **C2** | **LSP integration** | IDE-level code intelligence (renames, references, diagnostics) | High | 14 LSP ops via `lsp` tool |
| **C3** | **Advisor mode** | Second model watching every turn, catching issues the primary misses | Medium | Inline notes injection, separate context |
| **C4** | **Checkpoint/Rewind** | Context management for long sessions — collapse exploratory context | Medium | `checkpoint` + `rewind` tools |
| **C5** | **Schema-validated subagent results** | Typed output instead of prose parsing — reliability | Low | Schema validation on `task` results |
| **C6** | **Worktree isolation** | Safe parallel edits without merge conflicts | Medium | Git worktree per `task` agent |
| **C7** | **Atomic commit splits** | Dependency-ordered commits, source scored above tests/docs | Medium | `omp commit` via `git_overview`/`diff`/`hunk` |

---

## 5. IMPORTANT Gaps (expected by users)

These gaps represent features users will look for once they've experienced oh-my-pi.

| ID | Gap | Impact | Effort |
|---|---|---|---|
| **I1** | Stream rules (time-traveling regex injection) | Survives compaction, injects rules mid-stream | Medium |
| **I2** | Conflict resolution (`conflict://` scheme) | Structured merge conflict handling | Medium |
| **I3** | Browser automation (Puppeteer/CDP) | Full web interaction capability | High |
| **I4** | Web search (25 providers) | Broad search coverage | Medium |
| **I5** | GitHub schemes (`pr://`, `issue://`) | Read PRs as files, atomic commit splits | Medium |
| **I6** | Config inheritance (8 formats) | Reads Cursor MDC, Cline, Codex, Copilot rules | Low |
| **I7** | Skills auto-discovery | `skill://` scheme, automatic skill loading | Medium |
| **I8** | Self-update | Built-in update mechanism | Low |
| **I9** | Hindsight memory (retain/recall/reflect) | Full session compression into mental model | Medium |
| **I10** | Code review with P0-P3 verdict | Structured review with priority ranking | Medium |
| **I11** | TUI with differential rendering | Tool cards, edit previews, ask picker, QR codes | High |
| **I12** | `/collab` relay | Real-time collaboration, QR codes, sealed frames | High |
| **I13** | Code execution (Python + Bun eval) | Persistent cells with tool re-entry bridge | High |
| **I14** | AST edits with preview | AST-aware edits, 50+ grammar grep | High |

---

## 6. What ithacus Does Better

ithacus has genuine advantages that oh-my-pi does not replicate:

| # | Advantage | Detail |
|---|---|---|
| 1 | **Zero-network runtime** (PREVENT-ITH-004) | oh-my-pi makes network calls for web search, collab relay, self-update, etc. ithacus runs entirely offline — critical for air-gapped / regulated environments |
| 2 | **Formal safety guardrails** | `PREVENT-*` rules enforced by `scripts/guardrails-scan.mjs` — no equivalent in oh-my-pi |
| 3 | **Pi-agnostic separation** | `src/` is fully unit-testable with `node --test` — no pi runtime required |
| 4 | **Lightweight footprint** | 14 files, 1,216 lines vs 55K+ LoC monolith |
| 5 | **`node:sqlite` single store** | Simple, reliable, no distributed state complexity |
| 6 | **PR #3250 model chain** | 4-tier fallthrough with `custom/` qualification for provider resolution |
| 7 | **Durable trim with anchor floor** | Never drops recent messages (PREVENT-ITH-001), never splits tool-call pairs (PREVENT-ITH-002) |
| 8 | **Extension model** | `pi install npm:ithacus` — no platform fork needed, works with upstream Pi |

---

## 7. Strategic Positioning

ithacus occupies the **"lean + safe pi extension"** niche. oh-my-pi is the **"full platform rewrite"** approach. They serve different audiences:

| Audience | oh-my-pi | ithacus |
|---|---|---|
| **Primary user** | Power users who want everything built-in | Teams who want guardrails, zero-network, minimal footprint |
| **Deployment** | Full platform replacement | `pi install npm:ithacus` |
| **Maintenance** | Monolithic — tight coupling | Modular — extension API boundary |
| **Risk** | High (platform fork, diverges from upstream Pi) | Low (standard extension, works with upstream) |
| **Compliance** | Network calls require review | Zero-network by default |

### Recommended Strategy

**Adopt oh-my-pi's best patterns as pi extension features**, without replicating its Rust native layer:

1. **Phase 1 (Quick wins)**: Schema-validated subagent results (C5), config inheritance (I6), self-update (I8)
2. **Phase 2 (Core gaps)**: Hashline edit format (C1), advisor mode (C3), checkpoint/rewind (C4), stream rules (I1)
3. **Phase 3 (Deep integration)**: LSP integration (C2), worktree isolation (C6), atomic commits (C7)
4. **Phase 4 (Stretch)**: GitHub schemes (I5), web search (I4), Hindsight memory (I9)

**Do NOT attempt**: Rust native layer, browser automation, collab relay, persistent eval, TUI rewrite — these require platform-level changes.

---

*This analysis is based on oh-my-pi v17.0.9 capabilities as documented. oh-my-pi is actively developed with 535 releases; feature gaps may shift with future versions.*
