# Project Guidelines — ithacus

## 0. Project identity & glossary (READ FIRST — NON-NEGOTIABLE)

Keep these four entities straight. Do NOT conflate them. Ever.

| Entity | What it IS | Role in this repo |
|--------|------------|-------------------|
| **ithacus** | **The PROJECT.** A standalone agent framework that runs with pi.dev, letting you set different agents with different models to do task work. This is what we are BUILDING. | Everything in `src/`, `extensions/`, `docs/` |
| **DevGate** | The development FRAMEWORK / dev tooling. Test runner, regression scanner, guardrails scanner, semantic scanner, schema-health, deploy pipeline, CI workflows. NOT a thing being built here — adapted copies live in `ithacus/scripts/` + `.github/workflows/`. Source clone is gitignored at `DevGate-Agentic-Framework/`. | `scripts/` (vendored adapted copies), `.github/workflows/` |
| **.guardrails/** | The RULES we follow. `pattern-rules.json` (PREVENT-ITH-* / PREVENT-DIST-*) + `semantic-rules.json` (SEMANTIC-*) + `failure-registry.jsonl` (bug db). DevGate scripts ENFORCE these; guardrails = the policy. | `.guardrails/` |
| **pi-mega-compact** | A SEPARATE, UNRELATED project (a compression extension). ithacus is NOT pi-mega-compact and is NOT a derivative of it. All references to it must be REMOVED from this repo. Do not re-introduce them. | OUT of scope. Scrub on sight. |

**The mission, stated plainly:**
> ithacus is an agent framework to run with pi.dev so we can set different
> agents with different models to do task work.

## 0.5. Guardrails routing

* **docs/AGENT_GUARDRAILS.md** — MANDATORY safety protocols. Read before ANY
  code change. The Four Laws (Read First / Stay in Scope / Verify Before Commit
  / Halt When Uncertain) are NON-NEGOTIABLE.
* **.guardrails/failure-registry.jsonl** — append-only bug database. Check it
  (via `python3 scripts/regression_check.py --all`) before starting work.
* **.guardrails/prevention-rules/pattern-rules.json** — the `PREVENT-*` rules
  enforced by `scripts/guardrails-scan.mjs`.
* **.claude/hooks/** — pre/post-execution + pre-commit gates (AI attribution,
  secret scan, full gate). Non-fatal to dev, mandatory in CI.

**Four Laws:** Read Before Editing · Stay in Scope · Verify Before Committing ·
Halt When Uncertain.

## 1. What this is

`ithacus` is a **standalone agent framework** (TypeScript, Node >= 22.13,
ESM) that runs with pi.dev. Its purpose: let you set different agents with
different models to do task work. It lives directly in the repo's
`<repo>/.pi/ithacus/` folder — **the folder name is the project name**.

ithacus is its own framework. It is NOT a derivative of pi-mega-compact or
any other extension. Historical repo comments mentioning pi-mega-compact as a
"pattern source" are STALE and are being scrubbed (task #25) — do not treat
them as authoritative and do not re-introduce such references.

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
| PREVENT-ITH-004 | critical | **No external service / no subscription required.** Runs on local pi + Node built-ins; the extension source itself makes zero network calls at runtime (scan-enforced). Spawned sub-agents call your configured pi providers. Annotated exceptions for local-only integrations (e.g. dispatching the local `pi` binary, `// guardrails-allow PREVENT-ITH-004: <reason>`). |
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
