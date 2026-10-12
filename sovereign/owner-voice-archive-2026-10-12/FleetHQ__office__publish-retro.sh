#!/usr/bin/env bash
# publish-retro.sh — מפרסם את תוצרי מחזור-השיפור-העצמי לענף office-pages של FleetHQ (Pages).
# Lane: zai-11d (owner mandate trace 1a12c9d6f5df1b95). Mirrors office-window/publish.sh
# (10-a's battle-tested pattern — READ IT FIRST was the order; this is that pattern,
# pointed at the retro lane):
#   * THROWAWAY GIT WORKTREE — the main checkout never switches branches (a checkout
#     would delete this very script mid-run — the lesson 10-a learned the hard way).
#   * rebase-before-push · no force-push · noreply identity · GITHUB_TOKEN only (never
#     printed) · idempotent (identical tree → no commit) · fail-closed token check.
# Publishes under retro/ prefix: index.html, BACKLOG.md, RETRO-LATEST.md,
# retro-state.json, PROPOSALS-latest.md.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root (stays on whatever branch was checked out)

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "publish-retro: GH_TOKEN/GITHUB_TOKEN missing — refusing to push anonymously (fail-closed)" >&2
  exit 1
fi

REPO_SLUG="${GITHUB_REPOSITORY:-roshpinacare-sys/FleetHQ}"
DIST_INDEX="$(pwd)/office/dist/index.html"
BACKLOG="$(pwd)/office/BACKLOG.md"
RETRO_LATEST="$(pwd)/office/RETRO-LATEST.md"
RETRO_STATE="$(pwd)/office/retro-state.json"
[ -f "$DIST_INDEX" ] || { echo "publish-retro: office/dist/index.html missing — run retro.mjs first" >&2; exit 1; }
[ -f "$BACKLOG" ] || { echo "publish-retro: office/BACKLOG.md missing — run retro.mjs first" >&2; exit 1; }
[ -f "$RETRO_LATEST" ] || { echo "publish-retro: office/RETRO-LATEST.md missing — run retro.mjs first" >&2; exit 1; }
[ -f "$RETRO_STATE" ] || { echo "publish-retro: office/retro-state.json missing — run retro.mjs first" >&2; exit 1; }
# latest proposal (newest PROPOSALS/*.md) — optional but expected after a full cycle
LATEST_PROPOSAL="$(ls -1t "$(pwd)"/office/PROPOSALS/*.md 2>/dev/null | head -1 || true)"

# identity: noreply only (gmail=0 law)
git config user.name "fleet-office-bot"
git config user.email "roshpinacare-sys@users.noreply.github.com"
git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git"

# rebase-first: fetch the branch explicitly
git fetch origin "+office-pages:refs/remotes/origin/office-pages"
if git show-ref --verify --quiet refs/remotes/origin/office-pages; then
  BASE="refs/remotes/origin/office-pages"
else
  BASE="$(git rev-parse HEAD)"   # first publish ever: start from current tip (orphan-style)
fi

WT="$(mktemp -d)"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT
git worktree add --detach "$WT" "$BASE" >/dev/null

ROOT="$(pwd)"

(
  cd "$WT"
  mkdir -p retro
  cp "$DIST_INDEX" retro/index.html
  cp "$BACKLOG" retro/BACKLOG.md
  cp "$RETRO_LATEST" retro/RETRO-LATEST.md
  cp "$RETRO_STATE" retro/retro-state.json
  git add retro
  if [ -n "$LATEST_PROPOSAL" ] && [ -f "$LATEST_PROPOSAL" ]; then
    cp "$LATEST_PROPOSAL" retro/PROPOSALS-latest.md
    git add retro/PROPOSALS-latest.md
  fi
  if git diff --cached --quiet; then
    echo "publish-retro: dist identical to office-pages HEAD — nothing to commit"
  else
    git commit -q -m "[zai] office-retro: self-improvement cycle published $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  fi
  # drift guard: rebase onto the latest remote tip before pushing (no force-push, ever)
  git fetch origin "+office-pages:refs/remotes/origin/office-pages"
  git rebase refs/remotes/origin/office-pages
  git push origin HEAD:office-pages
  HEADSHA="$(git rev-parse --short HEAD)"
  FILES_LINE="retro/index.html · retro/BACKLOG.md · retro/RETRO-LATEST.md · retro/retro-state.json"
  [ -n "$LATEST_PROPOSAL" ] && FILES_LINE="$FILES_LINE · retro/PROPOSALS-latest.md"
  SUMMARY_LINES="## office-retro publish
- branch: \`office-pages\` @ \`${HEADSHA}\`
- files: ${FILES_LINE}
- rebase-before-push honored · no force-push · GITHUB_TOKEN only"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$SUMMARY_LINES" >> "$GITHUB_STEP_SUMMARY"
  else
    printf '%s\n' "$SUMMARY_LINES"
  fi
)
