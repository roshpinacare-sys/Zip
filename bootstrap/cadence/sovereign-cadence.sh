#!/bin/bash
# sovereign-cadence.sh — הקצב-הריבוני (פתרון-הבילינג של המפעיל: קרון מקומי במקום דקות-Actions)
# שעתי: פעימת-תחרות + קיפול-מצב לגיט (zip). יומי: תחיית-כספת-האתר מהשרשרת.
# חוק: אפס-תלות-סנדבוקס — הארטיפקטים חיים בגיט; הריצה יכולה להיות בכל מכונה.

set -u
export HOME=/home/z
MP=/home/z/my-project
ZIP=$MP/zip
LOG=/home/z/fleet-tmp/logs/cadence.log
mkdir -p /home/z/fleet-tmp/logs

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }

MODE="${1:-hourly}"
log "=== cadence $MODE start ==="

# 1) פעימת-תחרות (מדידת on-chain, אפס מפתחות)
cd "$ZIP" && bun scripts/competition-beat.mjs >> "$LOG" 2>&1 || log "competition-beat FAIL"

# 1.5) מנוע-הצבעת-החיילים (posting-authority חי; תקציב 4/שרשרת/חייל/יום)
cd "$ZIP" && bun scripts/soldier-vote-beat.mjs --max 2 >> "$LOG" 2>&1 || log "soldier-vote-beat FAIL"

# 2) יומי: תחיית-כספת-האתר (השרשרת היא הגיבוי)
if [ "$MODE" = "daily" ]; then
  cd "$MP" && bun zip/scripts/web-vault-rescan.mjs >> "$LOG" 2>&1 || log "web-vault-rescan FAIL"
fi

# 3) קיפול-המצב לגיט (zip = המקור-בענן)
cd "$ZIP" || exit 1
git add sovereign/competition/ sovereign/web/manifests/ 2>/dev/null
if ! git diff --cached --quiet; then
  git commit -m "[cadence] competition+vault state (${MODE}) ${MODE}:${now:-$(date -u +%FT%TZ)}" >> "$LOG" 2>&1 || true
  if git push origin main >> "$LOG" 2>&1; then
    log "push OK"
  else
    # rebase על state-pushes של הענן וניסיון-שני
    git pull --rebase=merges origin main >> "$LOG" 2>&1 || true
    git push origin main >> "$LOG" 2>&1 && log "push OK (2nd)" || log "push FAIL"
  fi
else
  log "no state delta"
fi
log "=== cadence $MODE end ==="
