# Project Guidelines — ithacus

## 0. Guardrails routing (READ FIRST)

* **docs/AGENT_GUARDRAILS.md** — MANDATORY safety protocols. Read before ANY
  code change. The Four Laws (Read First / Stay in Scope / Verify Before Commit
  / Halt When Uncertain) are NON-NEGOTIABLE.
* **.guardrails/failure-registry.jsonl** — append-only bug database. Check it
  (via `python3 scripts/regression_check.py --all`) before starting work.
* **.guardrails/prevention-rules/pattern-rules.json** — the `PREVENT-*` rules
  enforced by `scripts/guardrails-scan.mjs`.
* **.claude/hooks/** — pre/post-execution + pre-commit gates (AI attribution,
  secret scan). Non-fatal to dev, mandatory in CI.

**Four Laws:** Read Before Editing · Stay in Scope · Verify Before Committing ·
Halt When Uncertain.

## 1. What this is

`ithacus` is a **greenfield pi coding-agent extension** (TypeScript, Node >= 22.13,
ESM). It orchestrates coordinated sub-agent teams and lives directly in the
repo's `<repo>/.pi/ithacus/` folder — **the folder name is the project name**.

It borrows *patterns* (not code) from two references:
- **claw-code PR #3250** — team orchestration, `subagentModel` resolution,
  parallel read-only tool execution, model-resolution fallthrough.
- **pi-mega-compact** — the `.pi/<name>` folder convention, a single local
  `node:sqlite` store, zero-network-at-runtime, and the durable-trim "relieve
  context mid-run" lesson.

## 1. Architecture at a glance

- `src/` — **pi-agnostic**, fully unit-testable with `node --test`. No pi runtime
  types imported here. Key files: `config.ts` (loadConfig + per-repo scoping +
  pressure), `store.ts` (node:sqlite store + idempotent schema), `team.ts`
  (run/agent/task/inbox model + resolve_agent_model chain), `parallel.ts`
  (execute_batch), `trim.ts` (durable-trim decision), `types.ts`.
- `extensions/` — the **pi adapter layer**. `ithacus.ts` is the entry; handlers
  live under `ithacus-events/`; `ithacus-team.ts` dispatches teams;
  `ithacus-commands.ts` registers slash commands; `ithacus-runtime.ts` holds
  shared live state.

## 2. Hard project constraints (PREVENT-*)

| Rule | Severity | Meaning |
|------|----------|---------|
| PREVENT-ITH-001 | error | Never drop messages without an anchor floor (preserve recent N). |
| PREVENT-ITH-002 | error | Never split a toolCall/toolResult pair at a trim boundary. |
| PREVENT-ITH-003 | error | Never inject context as `role:"system"` — prepend via `systemPrompt`. |
| PREVENT-ITH-004 | critical | **Zero network calls at runtime.** Local node:sqlite + FS only. The only exception is a user-triggered localhost dashboard, annotated `// guardrails-allow PREVENT-ITH-004: <reason>`. |
| PREVENT-DIST-001 | error | Distribute ONLY via `npm publish` + `pi install npm:ithacus`. Never `.tgz` tarball or symlink for shipping. |

## 3. Workflow

- **Edits**: prefer small, single-file edits in `src/`; keep `src/` pi-agnostic.
- **Guardrails gate**: every change must pass `node scripts/guardrails-scan.mjs`
  (or `npm run guardrails`) + `python3 scripts/regression_check.py --all` before
  commit. The `pre-commit.sh` hook enforces AI attribution + secret scan.
- **Tests**: `node --experimental-strip-types scripts/smoke-src.mjs` (Node 26
  strips TS types natively — no `tsc` install needed). `npm run build` (tsc) is
  optional for type-checking only.
- **Commits**: one focused commit per task; AI-attribution REQUIRED
  (`Co-Authored-By: Claude <noreply@anthropic.com>` — see
  `docs/workflows/COMMIT_WORKFLOW.md`).

## 4. Token-saving rules

- Do NOT `ls -R` the whole tree; read targeted files.
- Do NOT re-read files you just edited.
- Read ONLY files relevant to the request.
