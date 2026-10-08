#!/bin/bash
# sovereign-cadence.sh — הקצב-הריבוני (פתרון-הבילינג של המפעיל: קרון מקומי במקום דקות-Actions)
# שעתי: פעימת-תחרות + הצבעת-חיילים + קיפול-מצב לגיט (zip + SovereignConsole).
# יומי: תחיית-כספת-האתר מהשרשרת + מלגות-האוצר האוטונומיות (top-3 שבועי).
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

# 1.7) Task 17 — פעימת-המוח: decide() — החלטות-אוטונומיות + אימות-שערים + רישום-שרשרת
cd "$ZIP" && bun scripts/decide-beat.ts >> "$LOG" 2>&1 || log "decide-beat FAIL"

# 2) יומי: תחיית-כספת-האתר (השרשרת היא הגיבוי) + מלגות-האוצר (אוטונומי מלא)
if [ "$MODE" = "daily" ]; then
  cd "$MP" && bun zip/scripts/web-vault-rescan.mjs >> "$LOG" 2>&1 || log "web-vault-rescan FAIL"
  # Task 12 — מלגות-האוצר: top-3 התחרות מקבלים SAOS פנימי (250/150/100),
  # תקרות-קשיחות בשרת, אידמפוטנטי-שבועי (ISO), אפס-שידור-חיצוני.
  curl -s -m 45 -X POST http://127.0.0.1:3000/api/exchange \
    -H "Content-Type: application/json" \
    -d '{"action":"scholarship-pay"}' >> "$LOG" 2>&1 || log "scholarship-pay FAIL"
  log "scholarship-pay fired"
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

# 3.5) Task 12 — קיפול-SovereignConsole (הקונסולה-החיה + worklog + מצב-סוברן)
cd "$MP" || exit 1
git add -A 2>/dev/null
if ! git diff --cached --quiet; then
  git commit -m "[cadence] console state fold (${MODE}) $(date -u +%FT%TZ)" >> "$LOG" 2>&1 || true
  if git push origin main >> "$LOG" 2>&1; then
    log "console push OK"
  else
    git pull --rebase=merges origin main >> "$LOG" 2>&1 || true
    git push origin main >> "$LOG" 2>&1 && log "console push OK (2nd)" || log "console push FAIL"
  fi
else
  log "console: no state delta"
fi
log "=== cadence $MODE end ==="
