#!/usr/bin/env bash
#
# scripts/deploy.sh — Authoritative publish pipeline for ithacus.
#
# Vendored + adapted from DevGate-Agentic-Framework/scripts/deploy.sh.
# Stripped every mega-compact-specific step (React dashboard build, dashboard
# tab smoke, VC2C encoder/model/tokenizer asset gate, @mongodb-js/zstd native
# binding preflight, stale dashboard runner bounce) — ithacus has none of those.
# ithacus is zero-runtime-deps (node built-ins only) and ships no assets.
#
# Enforces (in order):
#   0. Registry preflight: npm auth live (npm whoami) + target version NOT
#      already on the registry. Fails fast BEFORE any irreversible work.
#   1. Clean git tree (no uncommitted changes).
#   2. Full gate: build + lint + smoke + regression (failure registry +
#      pattern violations) + guardrails + semantic + schema-health.
#   2b. Payload verify: npm pack --dry-run must contain dist/extensions/
#       ithacus.js + extensions/agents/*.md — a broken tarball is never
#       tagged, let alone published. package.json "files" whitelists dist/
#       + extensions/agents only: src/, scripts/, tests/, docs/ never ship.
#   3. Bump package.json version (package-lock.json IS committed: CI uses
#      `npm ci`, which requires the lockfile).
#   4. Commit the version bump.
#   5. Tag (annotated) + push BEFORE publish — a push failure aborts before
#      the irreversible npm publish.
#   6. npm publish (the ONLY distribution path — PREVENT-DIST-001).
#      package.json "prepublishOnly" reruns the full gate, so even a manual
#      `npm publish` can never skip testing.
#   7. Merge release branch into master.
#   8. GitHub release with notes.
#   9. Post-publish device instructions.
#
# Usage:
#   ./scripts/deploy.sh 0.2.0
#
# Exit codes: non-zero on any failure (set -euo pipefail). Nothing is published
# if any step fails.

set -euo pipefail

# --- args --------------------------------------------------------------------
if [[ $# -ne 1 ]]; then
	echo "usage: $0 <new-version>" >&2
	echo "  e.g. $0 0.2.0" >&2
	exit 2
fi

NEW_VERSION="$1"
NEW_VERSION="${NEW_VERSION#v}" # accept v-prefixed input

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
	echo "[deploy] ERROR: '$NEW_VERSION' is not a valid semver." >&2
	exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[deploy] ithacus publish pipeline → v$NEW_VERSION"
echo "[deploy] working dir: $ROOT"

# --- 0. registry preflight (fail fast, BEFORE any irreversible work) ----------
# a) npm auth must be live; discovering this at step 6 (after tag push) is too late.
if ! npm whoami >/dev/null 2>&1; then
	echo "[deploy] ERROR: not logged in to npm. Run: npm login" >&2
	exit 1
fi
echo "[deploy] npm auth OK (user: $(npm whoami))."
# b) the target version must NOT already be on the registry.
if npm view "ithacus@$NEW_VERSION" version >/dev/null 2>&1; then
	echo "[deploy] ERROR: ithacus@$NEW_VERSION is already published on the registry." >&2
	exit 1
fi
echo "[deploy] registry preflight OK: ithacus@$NEW_VERSION not yet published."
echo "[deploy] ithacus uses --experimental-strip-types at runtime (Node ≥ 22.6 strips"
echo "[deploy] TS types natively), but tsc build+lint stay in the gate — type safety"
echo "[deploy] is enforced, not optional. A failing build means: FIX IT, don't skip it."

# --- 1. clean git tree --------------------------------------------------------
if ! git diff --quiet; then
	echo "[deploy] ERROR: working tree has unstaged changes. Commit or stash first." >&2
	git diff --stat >&2 || true
	exit 1
fi
if ! git diff --cached --quiet; then
	echo "[deploy] ERROR: index has staged but uncommitted changes. Commit first." >&2
	exit 1
fi
echo "[deploy] git tree clean."

# --- 2. full gate -------------------------------------------------------------
# build (tsc) + lint (tsc --noEmit) + smoke (node --experimental-strip-types)
# + regression (failure registry + pattern violations)
# + guardrails (PREVENT-* pattern scan) + semantic (AST unhandled-rejection)
# + schema-health (ith_* table contract).
#
# NOTE: deploy.sh previously passed --soft-as-hard [--soft-as-hard-base TAG]
# to promote soft-limit violations on changed files to blocking. That feature
# was never implemented in regression_check.py (it rejects unknown args), so
# the deploy gate aborted before publish. Removed until the file-size
# soft/hard-limit promotion feature is implemented in a future sprint. For
# 0.1.0 (first release, no prior tag) this is a no-op anyway.
echo "[deploy] running gate: build + lint + smoke + regression + guardrails + semantic + schema-health"
npm run build
npm run lint
npm test
python3 scripts/regression_check.py --all --pre-commit
node scripts/guardrails-scan.mjs
node scripts/semantic-scan.mjs
node scripts/schema-health-check.mjs
echo "[deploy] gate green."

# --- 2b. npm payload verification (before tagging/pushing) -------------------
# The gate built dist/, so the payload can be checked now. A broken tarball
# must never be tagged, let alone published.
PACK_LIST="$(npm pack --dry-run 2>&1)"
for required in "dist/extensions/ithacus.js" "extensions/agents/explore.md"; do
	if ! grep -qF "$required" <<<"$PACK_LIST"; then
		echo "[deploy] ERROR: npm payload missing '$required' — package would be broken." >&2
		printf '%s\n' "$PACK_LIST" | grep -E "total files|package size" >&2 || true
		exit 1
	fi
done
echo "[deploy] npm payload verified (dist/extensions + extensions/agents present)."

# --- 3. bump version ----------------------------------------------------------
CURRENT_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
	echo "[deploy] package.json already at v$NEW_VERSION."
else
	echo "[deploy] bumping package.json $CURRENT_VERSION → $NEW_VERSION"
	npm version "$NEW_VERSION" --no-git-tag-version
fi

# --- 4. commit version bump --------------------------------------------------
# package-lock.json IS committed (CI's `npm ci` requires it). npm version bumps
# its version field too, so stage it whenever it exists.
if git diff --quiet -- package.json; then
	echo "[deploy] nothing to commit (version already set)."
else
	echo "[deploy] committing version bump"
	git add package.json
	[[ -f package-lock.json ]] && git add package-lock.json
	git commit -m "chore(release): v$NEW_VERSION

Release v$NEW_VERSION published via scripts/deploy.sh.

Co-Authored-By: ithacus deploy.sh <noreply@ithacus>"
fi

# --- 5. tag + push BEFORE publish --------------------------------------------
# Order matters: push the commit + tag BEFORE npm publish so a push failure
# (e.g. no upstream branch) aborts the script before an irreversible publish.
TAG="v$NEW_VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	echo "[deploy] tag $TAG already exists; skipping tag creation."
else
	echo "[deploy] creating tag $TAG"
	# Annotated tag (-a): `git push --follow-tags` only pushes annotated tags.
	git tag -a "$TAG" -m "Release v$NEW_VERSION"
fi
echo "[deploy] pushing commits + tags (git push --follow-tags)"
if ! git push --follow-tags 2>/dev/null; then
	echo "[deploy] git push --follow-tags failed; setting upstream and retrying"
	CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
	git push --set-upstream origin "$CURRENT_BRANCH" --follow-tags
fi

# --- 5b. verify the tag reached origin ----------------------------------------
if ! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
	echo "[deploy] pushing tag $TAG explicitly (not found on origin after --follow-tags)"
	git push origin "$TAG"
fi

# --- 6. publish (npm only — PREVENT-DIST-001) --------------------------------
echo "[deploy] publishing to npm (npm publish — the only valid distribution path)"
npm publish
echo "[deploy] published v$NEW_VERSION to npm."

# --- 7. merge release branch into master -------------------------------------
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "master" ]]; then
	echo "[deploy] merging $CURRENT_BRANCH → master"
	git fetch origin master 2>/dev/null || true
	git checkout master
	if git merge --no-edit "$CURRENT_BRANCH" 2>/dev/null; then
		git push origin master
		echo "[deploy] merged + pushed master."
	else
		echo "[deploy] WARN: merge conflicts on master — resolving with release branch versions."
		git checkout --theirs package.json package-lock.json 2>/dev/null || true
		git add package.json package-lock.json
		git commit --no-edit 2>/dev/null || true
		git push origin master
		echo "[deploy] merged (conflict-resolved) + pushed master."
	fi
	git checkout "$CURRENT_BRANCH"
else
	echo "[deploy] already on master — skipping merge."
fi

# --- 8. create GitHub release with notes ------------------------------------
PREV_TAG=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || true)
if [[ -n "$PREV_TAG" ]]; then
	# `sed -n '1,15p'` not `head -15` — head closes the pipe early and trips
	# SIGPIPE under `set -o pipefail` (the 0.13.7-mid-publish-abort bug).
	RELEASE_NOTES=$(git log --pretty=format:"- %s" "$PREV_TAG..$TAG" 2>/dev/null \
		| grep -vE "^- chore\(release\)" \
		| sed -n '1,15p' || true)
else
	RELEASE_NOTES=$(git log --pretty=format:"- %s" "$TAG" 2>/dev/null | sed -n '1,15p' || true)
fi
RELEASE_NOTES="${RELEASE_NOTES:-(no commit notes extracted)}"
if command -v gh >/dev/null 2>&1; then
	echo "[deploy] creating GitHub release $TAG with notes"
	gh release create "$TAG" \
		--title "v$NEW_VERSION" \
		--notes "$(printf '## What changed\n\n%s\n\n**Install:** `pi install npm:ithacus`' "$RELEASE_NOTES")" \
		|| echo "[deploy] WARN: gh release create failed (gh not authenticated or release exists) — skipping"
else
	echo "[deploy] WARN: gh CLI not installed — skipping GitHub release. Tag $TAG is pushed."
fi

# --- 9. post-publish device instructions ------------------------------------
echo
echo "============================================================"
echo " PUBLISHED v$NEW_VERSION — post-publish device steps"
echo "============================================================"
echo "On EACH device running ithacus:"
echo
echo "  1. Install the extension from the registry (npm-only, no .tgz):"
echo "       pi install npm:ithacus"
echo
echo "  2. Confirm the installed version is v$NEW_VERSION:"
echo "       find ~/.pi/agent/extensions -path '*ithacus/package.json' \\"
echo "           -exec grep -m1 '\"version\"' {} \\;"
echo
echo "  3. ithacus has zero runtime deps + no dashboard, so the gate's"
echo "     schema-health + guardrails + semantic scan IS the install-time"
echo "     regression check. If a device opens a fresh sqlite.db, the store"
echo "     creates the ith_* tables idempotently on first run."
echo "============================================================"
echo "[deploy] done."
