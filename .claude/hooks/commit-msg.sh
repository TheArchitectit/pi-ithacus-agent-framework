#!/bin/bash
# Commit-Msg Hook - Validates the commit message.
# Git passes the message file path as $1 to `commit-msg` (reliably, unlike
# `pre-commit` in some environments). Enforces AI attribution per
# docs/workflows/COMMIT_WORKFLOW.md and AGENT_GUARDRAILS.md.

set -euo pipefail

echo "[GUARDRAILS] Commit-message validation running..."

COMMIT_MSG_FILE="${1:-.git/COMMIT_EDITMSG}"

if [ ! -f "$COMMIT_MSG_FILE" ]; then
    echo "[ERROR] Commit message file not found: $COMMIT_MSG_FILE"
    exit 1
fi

# Check for AI attribution in commit message (MANDATORY)
if ! grep -qi "Co-Authored-By:" "$COMMIT_MSG_FILE"; then
    echo "[ERROR] Commit message missing AI attribution"
    echo "[INFO] Add: Co-Authored-By: Claude <noreply@anthropic.com>"
    exit 1
fi

echo "[GUARDRAILS] Commit-message validation passed"
