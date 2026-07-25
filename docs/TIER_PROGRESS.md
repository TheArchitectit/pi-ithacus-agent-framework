# Tier Progress — ithacus

> Status: Active. Retrospective log per SPRINT_PLAN.md §process (“retrospective: after each tier completion”).
> Captures ACTUAL delivered state (files, line counts, smoke assertions) vs the MASTER_PLAN estimates.

## How to read this

- **Est.** = MASTER_PLAN.md predicted file/line counts.
- **Actual** = verified from `wc -l` at the tier merge commit.
- Line-count guidance: src/ ≤ 300 lines/file; all source files under 500.

---

## TIER 1 — Foundation (v0.2.0) — COMPLETE ✅

Sprints 1.1–1.4 (Weeks 1–8). Adds the workflow DAG, async/worktree isolation,
presence/reservations/cost, and the two unique differentiators (Model Profiles,
Reverse Prompt Validation).

### Delivered sprints

| Sprint | Feature | Key files |
|---|---|---|
| 1.1 | Workflow DAG engine + task schema | `src/workflow.ts`, `src/team.ts` (tasksFromWorkflow) |
| 1.2 | Worktree isolation + async background runs | `src/worktree.ts`, `src/async.ts` |
| 1.3 | Presence + reservations + cost | `src/presence.ts`, `src/reservations.ts`, `src/cost.ts`, `src/store-presence.ts` |
| 1.4 | Model profiles + RPV + integration | `src/model-profiles.ts`, `src/validator.ts`, `src/store-model-profiles.ts`, `extensions/ithacus-profiles.ts` |

### Retrospective

- **Size discipline held.** store.ts extraction pattern (`store-presence.ts`,
  `store-model-profiles.ts`) kept the original store.ts at 275 lines; types
  split into `types-sprint-2.ts` / `types-sprint-2.3.ts` re-exported from
  `types.ts` to stay under 300.
- **Two audit-driven P1 fixes in 1.3** (heartbeat resurrecting completed
  agents; stale reservations permanently blocking files) — both caught by the
  build+audit loop before merge.
- **Smoke harness scales.** Started at ~37 assertions (Sprint 1.1), reached
  ~288 by end of TIER 1; every src/ module is covered via the `node
  --experimental-strip-types` temp-dir rewrite harness.

### Numbers

| Metric | Est. | Actual |
|---|---|---|
| New src/ files | ~11 | 14 (incl. type-split helpers) |
| src/ lines | ~1,750 | ~2,064 across 14 files |
| Largest src/ file | — | `config-formats.ts` (291, T2) / `store.ts` (275) |
| Smoke assertions | — | ~288 (cumulative through T1) |

---

## TIER 2 — Competitive Parity (v0.3.0) — COMPLETE ✅

Sprints 2.1–2.3 (Weeks 9–14). Adds the hashline edit format,
checkpoint/rewind, stream rules + 8 config-format parsers + skill discovery,
and advisor/code-review/atomic-commit intelligence.

### Delivered sprints

| Sprint | Feature | Key files |
|---|---|---|
| 2.1 | Hashline edit + checkpoint/rewind | `src/hashline.ts`, `src/checkpoint.ts` |
| 2.2 | Stream rules + config formats + skills | `src/stream-rules.ts`, `src/config-formats.ts` |
| 2.3 | Advisor + code review + atomic commits | `src/advisor.ts`, `src/review.ts`, `src/commits.ts`, `extensions/ithacus-advisor.ts` |

### Retrospective

- **Hashline token reduction measured ≥ 0.4** vs native edit format on the
  2000-char benchmark (acceptance: 40%+). Stale-anchor recovery tolerates ≤3
  lines of drift.
- **8 config formats parsed** (Cursor MDC, Cline, Codex, Copilot applyTo, Aider,
  Continue, Cody, generic) with a single `parseConfigFormat` dispatch.
- **3-layer skill discovery** (extension < user < project) with id dedup so a
  project SKILL.md correctly overrides the extension-layer one.
- **Two audit-fix cycles** in 2.2 (`$&` capture contract mismatch; types.ts
  >300 line split) — both resolved before merge.
- **PREVENT-ITH-004 held** across all src/ modules: only node:crypto/node:fs/
  node:sqlite imports; zero runtime network. Review scoring uses pure regex
  heuristics.

### Numbers

| Metric | Est. | Actual |
|---|---|---|
| New src/ files | ~5 | 8 (incl. type-split helpers) |
| src/ lines | ~1,500 | ~1,321 across new files |
| Largest new src/ file | — | `config-formats.ts` (291) |
| Smoke assertions (cumulative) | 90+ | ~288 (T2 added review/commits/advisor/hashline/checkpoint/configs/skills coverage) |

---

## Cumulative through TIER 2

| Layer | Files | Lines |
|---|---|---|
| `src/` (pi-agnostic, smoke-tested) | 25 | 3,385 |
| `extensions/` (pi adapter) | 9 | 639 |
| `scripts/` (harness + guardrails) | 4 | 1,766 |

- All `src/` files ≤ 300 lines (max: `config-formats.ts` 291).
- All `extensions/` files ≤ 131 lines.
- All source/extension files **under 500 lines**. (Two non-source files exceed
  500: `scripts/smoke-src.mjs` at 866 — the test harness — and
  `docs/DESIGN_MODEL_PROFILES.md` at 733 — a design doc.)
- Guardrails scan: clean. Regression check: no regressions.
- Zero network calls at runtime (PREVENT-ITH-004).

---

## Next: TIER 3 — Differentiation (v0.4.0)

Sprints 3.1–3.2 (Weeks 15–18). Adds hindsight memory, web search providers
  (with PREVENT-ITH-004 exception annotation), and GitHub schemes
  (`pr://`, `issue://`, `conflict://`). Will require the first annotated
  network exceptions in the codebase.

---

## TIER 4 — Aspirational (v1.0+) — IN PROGRESS

### Sprint 4.1 — LSP Integration — COMPLETE ✅

**Scope delivered:** pi-agnostic src/ LSP client layer (not the extension wiring).

| File | Lines | Purpose |
|---|---|---|
| src/lsp.ts | 221 | LspClient over injectable LspTransport; 14 LSP ops + lifecycle + shutdown |
| src/types-sprint-4.1.ts | 122 | Pure LSP type declarations (Diagnostic, Location, Hover, Symbol, ...) |

- 14 LSP operations: diagnostics, definition, references, rename, codeAction, workspaceSymbols, documentSymbol, hover, signatureHelp, formatting, foldingRange, selectionRange, linkedEditingRange, semanticTokensFull.
- `LspTransport` is injectable (DI pattern mirrors `search.ts` FetchFn): zero network/process in src/ (PREVENT-ITH-004 — no annotation needed).
- Spec-compliant: `WorkspaceEdit` parsed via `{changes?, documentChanges?}` (flattenWorkspaceEdit); `LocationLink` normalized to `LspLocation`; `LspMethod` enum bijects to client methods (publishDiagnostics push-notif replaced by diagnostic pull-request).
- 455 smoke assertions pass (cumulative through Sprint 4.1).
- Real LSP server spawning (child_process/node:net) deferred to extensions/ — out of scope for this src/ sprint.

### Sprint 4.2 — Browser + Persistent Eval — COMPLETE ✅

**Scope delivered:** pi-agnostic src/ browser + eval clients (not the extension wiring).

| File | Lines | Purpose |
|---|---|---|
| src/browser.ts | 132 | BrowserClient over injectable BrowserDriver; tabs, goto, evaluate, screenshot, click, type, snapshot, optional stealth |
| src/eval.ts | 82 | EvalClient over injectable EvalRuntime; persistent cells + tool re-entry bridge |
| src/types-sprint-4.2.ts | 95 | Pure types (BrowserTab, Screenshot, ElementSnapshot, NetworkEvent, EvalCell, EvalCellResult, ...) |

- Two injectable transports: `BrowserDriver` (Puppeteer/CDP-shaped) + `EvalRuntime` (Python/Bun persistent cells). DI pattern mirrors lsp.ts LspTransport + search.ts FetchFn.
- Zero network/process/IPC in src/ (PREVENT-ITH-004 — no annotation needed). Real Puppeteer/CDP/Bun/Python wiring deferred to extensions/.
- Browser stealth mode is optional+guarded — driver throws if unsupported rather than silently degrading.
- Eval cells are per-client scoped: `list()` returns only this client's tracked cells (contract for extensions/ to respect).
- 485 smoke assertions pass (cumulative through Sprint 4.2).
- ⚠️ `types.ts` at 299/300 — future type additions must go into a new `types-sprint-N.N.ts` split file, not types.ts directly.
