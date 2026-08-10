# GAP ANALYSIS: ithacus vs oh-my-pi

> **Last updated**: 2026-05 (regenerated against v0.3.2 from the v0.1.0 freeze)
> **ithacus**: v0.3.2 — 65 src files + 20 extension files (~8.6K lines, TypeScript, ESM, pi extension)
> **oh-my-pi**: v17.0.9 ([can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)) — 55K+ LoC Rust core, 19.3k stars, 535 releases

v0.3.2 delivered TIER 1–4 plus TIER 5 sprints 5.1–5.4, 5.10 (dispatch),
5.11 (menu/widget). The prior matrix's ithacus column was a v0.1.0 snapshot
showing ❌ for features that have since shipped — statuses re-verified below.

---

## 1. Overview

**oh-my-pi** is a **complete rewrite of the Pi platform** — not an extension, not a plugin, but a fork of Pi itself. It ships a Rust core with TypeScript orchestration, delivering native-performance tools, embedded LSP/DAP, browser automation, multi-model collaboration, and a custom TUI. It is a monolithic platform replacement.

**ithacus** is a **pi extension** — 65 src files + 20 extension files of TypeScript that run inside the standard Pi runtime. It adds coordinated sub-agent teams, durable context trimming, a local SQLite store, formal safety guardrails, a sub-agent dispatch tool (`ithacus-dispatch`), a TUI status menu (`/ithacus-menu`) + always-visible version widget, per-agent model/provider resolution, and a hindsight memory layer. It installs via `pi install npm:ithacus` and requires no external service or subscription — the extension source makes zero network calls at runtime except audited, annotated opt-in exceptions (search, and — planned — A2A + loopback dashboard).

**These are not direct competitors.** oh-my-pi is the platform; ithacus is a plugin. However, oh-my-pi's feature set defines what "best-in-class" looks like for a coding agent, and informs what ithacus should build, integrate, or intentionally defer.

---

## 2. Feature Matrix

### 2.1 Tools

| Capability | oh-my-pi | ithacus | Notes |
|---|---|---|---|
| File read (files, dirs, archives, SQLite, PDF, notebooks, URLs, internal schemes) | ✅ `read` — single tool, 15+ source types | Uses pi built-in | omp's read handles everything from zip to jupyter to `pr://` |
| File write | ✅ `write` | ❌ Uses pi built-in | |
| Hashline edit | ✅ `edit` — content-hash anchored | ✅ `src/hashline.ts` | shipped |
| AST edit (preview + accept) | ✅ `ast_edit` | 🟡 `src/ast.ts` (structural AST matcher, capture syntax; no preview/accept UX) | |
| AST grep (50+ grammars) | ✅ `ast_grep` | 🟡 regex-based AST matcher only — no tree-sitter grammars | |
| Regex search | ✅ `search` | Uses pi built-in | |
| Glob find | ✅ `find` | Uses pi built-in | |
| Bash (PTY + background) | ✅ `bash` — full PTY, background tasks | Uses pi built-in + `src/async.ts` detached runs | |
| Eval (Python + Bun, tool re-entry) | ✅ `eval` — persistent cells | 🟡 `src/eval.ts` pi-agnostic client layer (injectable runtime; no wired transport yet) | TIER 4 client |
| SSH | ✅ `ssh` | ❌ | |
| LSP (14 operations) | ✅ `lsp` | 🟡 `src/lsp.ts` pi-agnostic client (14 ops, injectable transport; not wired to a live server) | TIER 4 client |
| DAP / Debug (28 operations) | ✅ `debug` | 🟡 `src/dap.ts` pi-agnostic client (28 ops; injectable transport) | TIER 4 client |
| Subagent task fanout | ✅ `task` — worktree isolation, schema validation | ✅ `planRun` presets + `ithacus-dispatch` real pi subprocess, per-agent model/provider, typed `SpawnAgentResult`, worktree isolation | |
| Hub (message/wait/cancel agents) | ✅ `hub` | 🟡 `ith_inbox` table + presence; mailbox tool is task #16 | |
| Todo (phase tracking) | ✅ `todo` | Uses pi built-in todo | |
| Ask (structured questions) | ✅ `ask` | Uses pi built-in ask | |
| Browser (Puppeteer + CDP) | ✅ `browser` | 🟡 `src/browser.ts` pi-agnostic client (tabs/navigation/evaluate/screenshot; injectable driver, not wired) | TIER 4 client |
| Web search (25 providers) | ✅ `web_search` | 🟡 `extensions/` search.ts (annotated PREVENT-ITH-004 exception; fewer providers) | |
| GitHub schemes (`pr://`, `issue://`) | ✅ `github` | ✅ `src/schemes.ts` (`pr://`, `issue://`, `conflict://`) | shipped |
| Image generation | ✅ `generate_image` | ❌ | |
| Image inspection | ✅ `inspect_image` | ❌ | |
| TTS | ✅ `tts` | ❌ | |
| Checkpoint | ✅ `checkpoint` | ✅ `src/checkpoint.ts` | shipped |
| Rewind | ✅ `rewind` | ✅ checkpoint rewind | shipped |
| Retain / Recall / Reflect | ✅ `retain` / `recall` / `reflect` | ✅ `src/hindsight.ts` + `store-hindsight.ts` | shipped |
| Resolve (preview actions) | ✅ `resolve` | ❌ | |
| **Built-in/tool count** | **32 built-in** | **pi built-ins + `ithacus-dispatch` + client layers** | |

### 2.2 Edit Format

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Edit algorithm | **Hashline** — content-hash anchored edits | ✅ `src/hashline.ts` shipped |
| Stale-anchor recovery | ✅ Auto-retries with fuzzy match | 🟡 basic handling |
| Token efficiency | 61% fewer output tokens | ~40% reduction (README claim) |
| AST-aware edits | ✅ `ast_edit` with preview+accept | 🟡 AST matcher only |
| AST grep | ✅ 50+ tree-sitter grammars | 🟡 regex-based only |

### 2.3 Subagents & Orchestration

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Fan-out model | `task` tool — spawns isolated agents | ✅ `planRun` presets + `ithacus-dispatch` real subprocess (isolated context, per-agent model/provider) |
| Isolation | ✅ Git worktree per agent | ✅ `src/worktree.ts` + `ithacus-worktree.ts` |
| Result validation | ✅ Schema-validated typed results | ✅ typed `SpawnAgentResult` + team resultSchema column |
| Cost tracking | ✅ Per-agent cost + duration | ✅ `src/cost.ts` |
| Constraints | ✅ Constraints block per task | ⬜ (next: guardrails injection, task #21) |
| Concurrency control | ✅ Configurable parallelism | ✅ `execute_batch` + dispatch |
| Role system | N/A (task-based) | ✅ 4 markdown agents (explore/plan/verification/reviewer) |
| Model resolution | Implicit | ✅ 4-tier PR #3250 chain + pi-setup credential injection |

### 2.4 Memory

| Feature | oh-my-pi | ithacus |
|---|---|---|
| System | **Hindsight** (retain/recall/reflect) | ✅ hindsight (retain/recall/reflect in `src/hindsight.ts`) |
| Scope | Project-scoped | Project-scoped (repoId) |
| Session compression | ✅ Compresses into mental model | ✅ reflect + durable trim |
| Pressure scaling | ❌ | ✅ Scales review frequency by context pressure |
| Anchor floor | N/A | ✅ PREVENT-ITH-001 |
| Tool-pair preservation | N/A | ✅ PREVENT-ITH-002 |

### 2.5 Advisor & Review

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Advisor mode | ✅ Second model watches every turn, injects notes | ✅ `src/advisor.ts` + `ithacus-advisor.ts` extension |
| Code review | ✅ `/review`, P0-P3 priority, confidence scoring | ✅ `src/review.ts` + reviewer agent |

### 2.6 Collaboration & Communication

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Session relay | ✅ `/collab` | 🟡 `src/collab.ts` client layer (injectable relay transport) |
| Presence (who's online) | ✅ | ✅ `src/presence.ts` + `store-presence.ts` |
| File reservations | ✅ | ✅ `src/reservations.ts` |
| Inter-agent messaging | hub | 🟡 inbox table; mailbox tool (#16) + A2A (#24) queued |

### 2.7 Code Execution

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Persistent Python/Bun | ✅ `eval` persistent cells | 🟡 `src/eval.ts` client layer only |

### 2.8 Search & Web

| Feature | oh-my-pi | ithacus |
|---|---|---|
| Web search providers | 25 | 🟡 extensions search.ts (annotated exception) |
| Site-aware extraction | ✅ | ❌ |

### 2.9 LSP & DAP

| Feature | oh-my-pi | ithacus |
|---|---|---|
| LSP operations | 14 | 🟡 `src/lsp.ts` client (14 ops, injectable transport) |
| DAP operations | 28 | 🟡 `src/dap.ts` client (28 ops, injectable transport) |

### 2.10 Platform Features

| Feature | oh-my-pi | ithacus |
|---|---|---|
| GitHub schemes | ✅ | ✅ `src/schemes.ts` |
| Atomic commit splits | ✅ | ✅ `src/commits.ts` |
| Conflict resolution | ✅ `conflict://N` | ✅ `src/schemes.ts` conflict |
| Config inheritance | ✅ 8 formats | ✅ `src/config-formats.ts` (8 formats) |
| Stream rules | ✅ | ✅ `src/stream-rules.ts` |
| Checkpoint / Rewind | ✅ | ✅ `src/checkpoint.ts` |
| TUI | ✅ differential rendering | 🟡 `src/tui.ts` client layer + real `/ithacus-menu` overlay + version widget (5.11) |
| Self-update | ✅ | ⬜ (npm publish + `pi update --extensions`; version-bump notice tells the user when it changed) |
| Skills | ✅ auto-discovery | ✅ 3-layer skills (extension < user < project) |
| Native performance | ✅ 55K LoC Rust | ❌ (TypeScript + pi built-ins; intentional) |
| Provider support | 40+ | pi providers; per-agent model@provider resolution shipped |

---

## 3. Honest Assessment

oh-my-pi is **not an extension** — it's a platform rewrite. ithacus cannot and should not replicate its Rust native layer. The right framing:

| Category | Strategy | Status 2026-05 |
|---|---|---|
| **Build as extension features** | Advisor, checkpoint/rewind, hashline, presence, reservations, cost, workflow DAG, worktree, commits, review, hindsight, stream-rules, schemes, config-formats, skills, plugins, metrics | ✅ ALL SHIPPED (TIER 1–4 + 5.1–5.4, 5.10, 5.11) |
| **Integrate oh-my-pi patterns** | Stream rules, config inheritance, subagent schema validation | ✅ shipped |
| **Pi-agnostic client layers** | LSP/DAP/browser/eval/TUI/collab (DI transports, no runtime wiring) | ✅ src/ layers shipped (TIER 4); extension wiring = "coming" |
| **Cannot replicate** | Rust native tools, persistent eval runtime, browser runtime, collab runtime, 32-tool monolith | Intentionally deferred — extension model can't and shouldn't |
| **Unique to ithacus** | Zero-network guardrails, formal PREVENT rules, pi-agnostic src/, lightweight footprint, PR #3250 model chain, version widget/menu | Shipped + differentiating |

---

## 4. CRITICAL Gaps — status 2026-05

All seven are now **resolved or have a shipped extension/client-level equivalent**:

| ID | Gap | Status |
|---|---|---|
| C1 | ~~Hashline edit format~~ | ✅ `src/hashline.ts` |
| C2 | ~~LSP integration~~ | 🟡 `src/lsp.ts` client layer; live-server wiring pending |
| C3 | ~~Advisor mode~~ | ✅ shipped |
| C4 | ~~Checkpoint/Rewind~~ | ✅ shipped |
| C5 | ~~Schema-validated subagent results~~ | ✅ typed SpawnAgentResult + team resultSchema |
| C6 | ~~Worktree isolation~~ | ✅ shipped |
| C7 | ~~Atomic commit splits~~ | ✅ shipped |

## 5. IMPORTANT Gaps — status 2026-05

| ID | Gap | Status |
|---|---|---|
| I1 stream rules | ✅ shipped | |
| I2 conflict scheme | ✅ in schemes.ts | |
| I3 browser | 🟡 client layer only | |
| I4 web search | 🟡 extensions exception | |
| I5 GitHub schemes | ✅ shipped | |
| I6 config inheritance | ✅ shipped (8 formats) | |
| I7 skills | ✅ shipped | |
| I8 self-update | ⬜ npm+pi flow anyway; bump-notice shipped 5.11 | |
| I9 hindsight | ✅ shipped | |
| I10 code review | ✅ shipped | |
| I11 TUI | 🟡 client layer + real 5.11 overlay/widget | |
| I12 collab | 🟡 client layer only | |
| I13 eval | 🟡 client layer only | |
| I14 AST preview/grep | 🟡 matcher only | |

## 6. What ithacus Does Better

Unchanged + sharpened by shipping:

1. **Zero-network runtime** (PREVENT-ITH-004, scan-enforced, audited exceptions only)
2. **Formal safety guardrails** — PREVENT-* + PREVENT-PI-* with hooks + CI
3. **Pi-agnostic src/** — 65 files fully unit-testable with `node --test`
4. **Lightweight** — ~8.6K lines vs 55K Rust monolith
5. **`node:sqlite` single store** — one source of truth
6. **PR #3250 model chain + pi-setup credential injection** at spawn
7. **Durable trim anchor floor / no pair-splitting**
8. **Extension model** — `pi install npm:ithacus`, never a fork; version widget + bump notice keep users on the latest

## 7. Strategic Positioning

Same niche (lean + safe pi extension), now with the CRITICAL band closed:

- Phase 1-4 of the "adopt patterns" plan are all shipped.
- Live-client wiring (LSP/DAP/browser/eval/collab) and the A2A/ToolVisibility/typed-workflow ports from memory-mcp are the 2026-05 queue (tasks #21-#24).
- Do NOT attempt: Rust native layer, monolithic platform — extension boundary is the product.

---

*Regenerated 2026-05 against oh-my-pi v17.0.9 + ithacus v0.3.2. oh-my-pi is actively developed (535 releases); feature gaps may shift.*
