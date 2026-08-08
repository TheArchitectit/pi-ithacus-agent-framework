#!/bin/bash
# Pre-Commit Hook — runs before git commit.
#
# Gate order (cheap → expensive): secret scan → pattern scan → semantic AST
# scan → regression (file-size + npm audit + failure registry) → smoke test.
# All stages short-circuit on first failure. The whole gate runs in <5s on a
# warm repo (guardrails+semantic are microseconds; regression is 1-2s; smoke
# is 2-3s). Any failure aborts the commit — fix before retrying.
#
# (AI-attribution check lives in commit-msg.sh — git passes the message file
#  to `commit-msg` reliably, but not to `pre-commit` in all environments.)

set -euo pipefail

echo "[GUARDRAILS] Pre-commit gate running..."

# --- 1. secret scan -----------------------------------------------------------
if command -v trufflehog &> /dev/null; then
	if ! trufflehog git file://. --since-commit HEAD --only-verified --fail 2>/dev/null; then
		echo "[ERROR] Potential secrets detected in staged files"
		exit 1
	fi
fi

# Rudimentary secret detection (basic patterns — same as ci.yml secret gate).
STAGED_FILES=$(git diff --cached --name-only)
if echo "$STAGED_FILES" | grep -q '\.env'; then
	echo "[ERROR] .env file is staged. Add to .gitignore or use environment variables."
	exit 1
fi

# --- 2. guardrails pattern scan (PREVENT-* rules) -----------------------------
if ! node scripts/guardrails-scan.mjs; then
	echo "[ERROR] Guardrails scan failed — fix PREVENT-* violations or annotate"
	echo "        with // guardrails-allow <RULE_ID>: <reason>"
	exit 1
fi

# --- 3. semantic AST scan (SEMANTIC-001: unhandled promise rejection) --------
if ! node scripts/semantic-scan.mjs; then
	echo "[ERROR] Semantic scan failed — add .catch() to flagged promise chains"
	exit 1
fi

# --- 4. regression check (file-size + npm audit + failure registry) ----------
# --all checks both staged + unstaged; --pre-commit exits non-zero on:
#   - any file past the HARD line limit (src 500, ext 500, test 600)
#   - any active failure-registry entry matching a changed file
#   - any RUNTIME HIGH/CRITICAL npm vulnerability
#   - any MEGACOMPACT_* env var without a dashboard settings entry (ithacus
#     has no dashboard → this check is a no-op here, inherited from mega-compact)
if ! python3 scripts/regression_check.py --all --pre-commit; then
	echo "[ERROR] Regression check failed — see output above"
	exit 1
fi

# --- 5. smoke test (pi-agnostic src/ layer) ----------------------------------
# Final gate: the 612-assertion smoke harness. Skipped on doc-only commits
# (no .ts files staged) to keep doc edits fast — the gate's purpose is to
# catch code regressions, not block documentation tweaks.
HAS_TS=0
for f in $STAGED_FILES; do
	if [[ "$f" == *.ts ]]; then
		HAS_TS=1
		break
	fi
done
if [[ "$HAS_TS" -eq 1 ]]; then
	if ! npm test >/dev/null 2>&1; then
		echo "[ERROR] Smoke test failed — re-run with \`npm test\` to see failures"
		exit 1
	fi
fi

echo "[GUARDRAILS] Pre-commit gate green."
