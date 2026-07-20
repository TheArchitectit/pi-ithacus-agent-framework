# Commit Workflow — ithacus

Adapted from `agent-guardrails-template`. Enforced by
`.claude/hooks/pre-commit.sh` (which blocks commits missing AI attribution and
staged `.env` files).

## Rules

1. **One focused commit per task.** Commit after each to-do item; this keeps
   history reversible.
2. **AI attribution REQUIRED.** Every commit message MUST include:
   ```
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
3. **Single focus.** No unrelated changes in the same commit.
4. **No secrets in diff.** API keys, tokens, passwords, private keys, `.env`
   contents, DB connection strings → block immediately.
5. **Pre-commit requirements:** all relevant tests pass, `npm run guardrails`
   is clean, no lint errors.

## Commit message format

```
<type>: <description>

[optional body]

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

## Git safety (also in docs/AGENT_GUARDRAILS.md)

- NO force push, NO amend of others' commits, NO rebase of shared branches,
  NO `--no-verify`, NO `reset --hard` on shared branches.
- Push ONLY when the user explicitly requests it.
