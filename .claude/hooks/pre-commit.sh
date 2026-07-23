#!/bin/bash
# Pre-Commit Hook - Runs before git commit.
# Validates: no .env staged, optional trufflehog secret scan.
# (AI-attribution check lives in commit-msg.sh — git passes the message file
#  to `commit-msg` reliably, but not to `pre-commit` in all environments.)

set -euo pipefail

echo "[GUARDRAILS] Pre-commit validation running..."

# Check for secrets in staged files using trufflehog if available
if command -v trufflehog &> /dev/null; then
    if ! trufflehog git file://. --since-commit HEAD --only-verified --fail 2>/dev/null; then
        echo "[ERROR] Potential secrets detected in staged files"
        exit 1
    fi
fi

# Rudimentary secret detection (basic patterns)
STAGED_FILES=$(git diff --cached --name-only)
if echo "$STAGED_FILES" | grep -q '\.env'; then
    echo "[ERROR] .env file is staged. Add to .gitignore or use environment variables."
    exit 1
fi

echo "[GUARDRAILS] Pre-commit validation passed"
