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
#   1. Clean git tree (no uncommitted changes).
#   2. Full gate: build + lint + smoke + regression (incl. npm audit) +
#      guardrails + semantic + schema-health. (--soft-as-hard over the prior
#      release tag promotes any file a src/ commit grew past soft to blocking.)
#   3. Bump package.json + package-lock.json version.
#   4. Commit the version bump.
#   5. Tag (annotated) + push BEFORE publish — a push failure aborts before
#      the irreversible npm publish.
#   6. npm publish (the ONLY distribution path — PREVENT-DIST-001).
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
# + regression (file-sizes + npm audit + settings coverage + failure registry)
# + guardrails (PREVENT-* pattern scan) + semantic (AST unhandled-rejection)
# + schema-health (ith_* table contract).
#
# --soft-as-hard --pre-commit promotes soft-limit violations on files CHANGED
# since the prior release tag to blocking: this release's commits cannot grow
# a src/ file past 300 (ext past 400) toward the 500 hard limit — it must be
# split (delegate-shell + impl) instead of squeezed toward the ceiling.
echo "[deploy] running gate: build + lint + smoke + regression + guardrails + semantic + schema-health"
npm run build
npm run lint
npm test
PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)
if [[ -n "$PREV_TAG" ]]; then
	python3 scripts/regression_check.py --all --soft-as-hard --soft-as-hard-base "$PREV_TAG" --pre-commit
else
	# First release (no prior tag): headroom gate over the working-tree diff.
	python3 scripts/regression_check.py --all --soft-as-hard --pre-commit
fi
node scripts/guardrails-scan.mjs
node scripts/semantic-scan.mjs
node scripts/schema-health-check.mjs
echo "[deploy] gate green."

# --- 3. bump version ----------------------------------------------------------
CURRENT_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
	echo "[deploy] package.json already at v$NEW_VERSION."
else
	echo "[deploy] bumping package.json $CURRENT_VERSION → $NEW_VERSION"
	npm version "$NEW_VERSION" --no-git-tag-version
fi

# --- 4. commit version bump --------------------------------------------------
if git diff --quiet -- package.json package-lock.json; then
	echo "[deploy] nothing to commit (version already set)."
else
	echo "[deploy] committing version bump"
	git add package.json package-lock.json
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
