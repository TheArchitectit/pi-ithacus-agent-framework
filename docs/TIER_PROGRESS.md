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

### Sprint 4.3 — TUI + Collab Relay — COMPLETE ✅

**Scope delivered:** pi-agnostic src/ TUI + collab clients (not the extension wiring).

| File | Lines | Purpose |
|---|---|---|
| src/tui.ts | 174 | TuiClient over injectable TuiRenderer; differential rendering (add/update/remove + kind-only changes), edit previews, ask picker, QR codes |
| src/collab.ts | 117 | CollabClient over injectable CollabRelay; host/join/leave, chat/edit/presence broadcast, subscribe, read-only link stub |
| src/types-sprint-4.3.ts | 79 | Pure types (ToolCard, EditPreview, AskOption, QrCode, CollabParticipant, CollabSession, CollabMessage) |

- Two injectable transports: `TuiRenderer` (differential-render surface) + `CollabRelay` (broadcast/subscribe). DI pattern mirrors lsp.ts/search.ts.
- `renderDiff` computes minimal add/update/remove deltas, detecting kind-only ToolCard transitions (tool_call→tool_result) so the renderer always repaints lifecycle changes.
- Collab msg-ids are monotonic (Date.now+counter) — no collisions in tight broadcast loops.
- Zero network/IPC/TTY in src/ (PREVENT-ITH-004 — no annotation needed). Real WebSocket + pi TUI wiring deferred to extensions/ (where the PREVENT-ITH-004 exception annotation lives for collab relay).
- ⚠️ `types.ts` now at 300/300 (zero headroom) — all future type additions MUST continue in new `types-sprint-N.N.ts` split files, never in types.ts directly.

### Sprint 4.4 — DAP + AST + Goal Loops — COMPLETE ✅

**Scope delivered:** pi-agnostic src/ layer with injectable transports. Real DAP process wiring + tree-sitter/ast-grep + LLM calls deferred to extensions/ (where PREVENT-ITH-004 exception annotations live).

| File | Lines | Purpose |
|---|---|---|
| src/dap.ts | 224 | DapClient over injectable DapTransport — 28 DAP operations: lifecycle (initialize/launch/attach/disconnect), config (setExceptionBreakpoints/setBreakpoints), execution control (continue/pause/next/stepIn/stepOut/stepBack/restartFrame/configurationDone), thread+stack (threads/stackTrace/scopes/variables), eval+data (evaluate/setVariable/source/loadedSources/modules), advanced (completions/goto/restart/terminate/setFunctionBreakpoints), + stopped/terminated/output event subscriptions |
| src/ast.ts | 102 | RegexAstMatcher (regex-based structural approximation) over injectable AstMatcher backend; findMatches, applyRewrite ($NAME capture expansion), expandTemplate, validateRewrite, chainRewrites. Real ast-grep/tree-sitter backend injectable in extensions/ |
| src/goal-loops.ts | 127 | Autonomous multi-turn goal loops with injectable LlmActor (proposes next action) + LlmJudge (verdict + score); runGoalLoop with completeThreshold, maxIterations, onIteration, execute callback; manual steps (addStep/updateStep), stopGoalLoop, summarizeLoop |
| src/types-sprint-4.4.ts | 147 | Pure types (DapBreakpoint/DapStackFrame/DapVariable/DapScope/DapThread/DapStoppedEvent/DapStopReason, AstMatch/AstRewrite/AstRewriteResult, GoalStep/GoalIteration/GoalLoop) |

- Three injectable transports: `DapTransport` (request+on+isReady), `AstMatcher` (findMatches backend), `LlmActor`/`LlmJudge` (propose+judge). DI pattern mirrors lsp.ts/search.ts/collab.ts/tui.ts.
- DAP client handles missing `transport.on` gracefully (returns no-op unsubscribe) — matches the defensive pattern from collab.ts.
- AST matcher translates ast-grep-style `$$$NAME` capture syntax to regex; `RegexAstMatcher` is the src/ fallback (real ast-grep injectable in extensions/).
- Goal loops support both judge-verdict-driven completion (complete/failed/continue) and threshold-driven (score >= 0.8), plus manual step planning and execute/onIteration callbacks.
- Zero network/process/IPC/TTY in src/ (PREVENT-ITH-004 — no annotation needed). Real debug-adapter spawning, tree-sitter parsing, and LLM calls are extension-layer concerns.
- types.ts remains at 300/300 (zero headroom, untouched); Sprint 4.4 types live in the new `types-sprint-4.4.ts` split file and are imported directly.
- ⚠️ `npm run build` (tsc) had 2 newly-introduced errors in src/ast.ts (TS2724 AstMatcher import, TS18047 m-null-de-narrow) — both fixed via inline interface + const capture; tsc now passes clean for ast.ts.
- 573 smoke assertions pass (+56 new for Sprint 4.4: 20 DAP, 11 AST, 18 goal-loops, plus 7 type/structure checks); guardrails + regression checks clean.
