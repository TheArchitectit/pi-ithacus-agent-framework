# Agent Guardrails & Safety Protocols — ithacus

**Version:** 1.0 (adapted from `agent-guardrails-template`)
**Applies To:** ALL AI agents, LLMs, and automated systems operating on this codebase

---

## Applicability

This document is **MANDATORY** for any AI system working on `ithacus`. If you are
an AI system reading this: you MUST follow these protocols. They are not
suggestions.

`ithacus` is a zero-dependency pi extension: runtime uses only Node built-ins
(`node:sqlite`, `node:fs`, `node:path`, `node:os`, `node:child_process`). No
external packages are installed at runtime.

---

## The Four Laws of Agent Safety

1. **Read Before Editing** — Never modify code without reading it first.
2. **Stay in Scope** — Only touch files explicitly authorized.
3. **Verify Before Committing** — Test and check all changes.
4. **Halt When Uncertain** — Ask for clarification instead of guessing.

These laws are accelerators, not friction: one read costs fewer tokens than
fixing a blind edit; a failed test in dev costs minutes, in prod hours.

---

## SAFETY PROTOCOLS (MANDATORY)

### Pre-Execution Checklist (EVERY agent, before ANY file modification)

| # | Check | Requirement |
|---|-------|-------------|
| 1 | READ FIRST | Never edit a file without reading it first |
| 2 | SCOPE LOCK | Only modify files explicitly in scope |
| 3 | NO FEATURE CREEP | Do NOT add features/refactor unrelated code |
| 4 | PRODUCTION FIRST | Production code before test code |
| 5 | TEST/PROD SEPARATION | Test infra separate from production |
| 6 | BACKUP AWARENESS | Know the rollback command before editing |
| 7 | TEST BEFORE COMMIT | All tests pass before committing |
| 8 | CHECK FAILURE REGISTRY | Review `.guardrails/failure-registry.jsonl` for known bugs |
| 9 | VERIFY FIXES INTACT | Confirm previous fixes not being undone |

### Git Safety Rules

| Rule | Consequence |
|------|-------------|
| NO FORCE PUSH | Data loss, history corruption |
| NO AMEND of others' commits | Breaks collaborator history |
| NO CONFIG CHANGES | Security/identity issues |
| NO PUSH WITHOUT PERMISSION | Unwanted remote changes |
| SINGLE COMMIT per task | Clean history |
| NO SKIP HOOKS (`--no-verify`) | Bypasses safety checks |
| NO REBASE of shared branches | Destroys collaborator work |
| NO DESTRUCTIVE OPS (`reset --hard` on shared) | Irreversible data loss |

### Code Safety Rules

| Rule | Rationale |
|------|-----------|
| EXACT REPLACEMENT | Use provided code exactly — no "improvements" |
| NO NEW IMPORTS | Unless explicitly required by the task |
| NO TYPE CHANGES | Preserve existing type hints |
| NO DELETIONS | Don't delete functionality outside scope |
| PRESERVE FORMATTING | Match existing indentation/style |
| NO SECRETS | Never commit credentials, keys, tokens |
| NO BINARY FILES | Unless explicitly required |
| NO GENERATED CODE | Don't commit build artifacts |

---

## GUARDRAILS (enforced by `scripts/guardrails-scan.mjs` + `regression_check.py`)

Rules live in `.guardrails/prevention-rules/pattern-rules.json`. Two families:

- **`PREVENT-PI-*`** — inherited verbatim from `agent-guardrails-template`
  (pi-extension invariants: anchor floor, tool-pair, no system role, no network).
- **`PREVENT-ITH-*` / `PREVENT-DIST-001`** — `ithacus` project rules (kept per
  our convention). `PREVENT-ITH-004` = zero network at runtime; the only
  exception is a user-triggered localhost dashboard, annotated
  `// guardrails-allow PREVENT-ITH-004 [PREVENT-PI-004]: <reason>`.

| Rule | Severity | Meaning |
|------|----------|---------|
| PREVENT-ITH-001 | error | Never drop messages without an anchor floor (preserve recent N). |
| PREVENT-ITH-002 | error | Never split a toolCall/toolResult pair at a trim boundary. |
| PREVENT-ITH-003 | error | Never inject context as `role:"system"` — prepend via `systemPrompt`. |
| PREVENT-ITH-004 | critical | **Zero network calls at runtime.** Local node:sqlite + FS only. |
| PREVENT-DIST-001 | error | Distribute ONLY via `npm publish` + `pi install npm:ithacus`. Never `.tgz`/symlink. |

### HALT CONDITIONS — STOP and report to user if ANY occur

```
[ ] Target file does not exist
[ ] Line numbers don't match expected
[ ] File has unexpected modifications
[ ] Syntax check fails after edit
[ ] Any test fails after edit
[ ] Merge conflicts encountered
[ ] Uncertain about ANY step
[ ] Edit tool reports "string not found"
[ ] Permission denied errors
[ ] Import errors when testing
[ ] Network/connection errors
[ ] Out of memory / timeout errors
[ ] User requests stop
[ ] Test/production boundary unclear
```

### FORBIDDEN ACTIONS

```
ABSOLUTE PROHIBITIONS:
FILE:      Modify outside scope | delete without permission | change permissions
CODE:      Add logging/debug to prod | "clean up" surrounding code |
           update versions unrequested | modify auth without review
GIT:       Force push | delete branches | modify hooks/config | push w/o permission
SYSTEM:    Run servers/long services | commands needing input | network to unknown
           endpoints | install deps w/o permission | elevated privileges | modify env vars
DATA:      Access DB w/o permission | modify prod data | export user data | store secrets
```

---

## Enforcement tooling

| Tool | Purpose | Run |
|------|---------|-----|
| `scripts/guardrails-scan.mjs` | Pattern scan `src/`+`extensions/` vs `PREVENT-*` rules | `node scripts/guardrails-scan.mjs` (or `npm run guardrails`) |
| `scripts/regression_check.py` | Scan changes vs failure registry | `python3 scripts/regression_check.py --all` |
| `scripts/log_failure.py` | Append a known bug to the registry | `python3 scripts/log_failure.py --from-error "..." --category runtime` |
| `.claude/hooks/pre-execution.sh` | Pre-edit guard (CLAUDE.md/AGENT_GUARDRAILS.md presence) | git hook |
| `.claude/hooks/post-execution.sh` | Post-edit secret scan | git hook |
| `.claude/hooks/pre-commit.sh` | AI-attribution + `.env` guard | git hook |
| `.guardrails/pre-work-check.md` | Mandatory read-before-work checklist | manual |

**Inline allow:** a line containing `// guardrails-allow <RULE_ID> [<RULE_ID>...]: <reason>`
(reason required) is skipped by the scanner. Use to document a deliberate,
audited exception (e.g. the read-only `git rev-parse` `execSync` in `config.ts`/
`store.ts`).

---

## QUICK REFERENCE

```
ALWAYS: read before edit | verify before proceeding | test before committing |
         production code before test code | separate test/prod | report results |
         include AI attribution (Co-Authored-By:)
NEVER:  edit without reading | push without permission | modify outside scope |
         force push or rebase | continue when uncertain | use prod DB for tests
HALT IF: conditions don't match | any check fails | uncertain | user requests stop
ROLLBACK: git checkout HEAD -- <file>
```

**Authored by:** TheArchitectit (template) / adapted for ithacus
**Review Cycle:** Monthly
