#!/usr/bin/env bash
# ============================================================================
# SOVEREIGN WATCHDOG — המפעיל-המקומי (T-52 · trace 1a123dd71bc46a15)
# ----------------------------------------------------------------------------
# הרבדה-שנייה-של-המפעיל-הפנימי: ב-GitHub (T-51) המטרונום-נצחי-מפקח-על-העורקים;
# כאן-מקומית, השומר-על-ריצת-הענן-המקומית-בין-איפוסי-סנדבוקס:
#   · אתר-המפעיל (:3000) נפל → הקמה-שקטה (מניעת-הצתה-כפולה)
#   · מראת-הענן — mirror.mjs מדי-מחזור (אידמפוטנטי: אין-קומיט-בלי-שינוי-עץ)
#   · יומן-מקומי — /tmp/sovereign-watchdog.log (אפס-סודות)
# אינו-שורד-איפוס-מכונה (שום-תהליך-מקומי-לא-שורד) — אחרי-איפוס השלב-הראשון-הוא
# boot/revive.sh; זהו-השלב-השני: לא-לתת-לשום-דבר-למות-בין-איפוסים.
#
# שימוש:  nohup bash boot/watchdog.sh >/dev/null 2>&1 &   (מופעל-מ-revive)
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX="${SOVEREIGN_FLEET:-$HOME/fleet}/Sandbox"
[ -d "$SANDBOX/.git" ] || SANDBOX="$(dirname "$HERE")"
SRC="${SOVEREIGN_SOURCE:-$HOME/my-project}"
PORT="${SOVEREIGN_PORT:-3000}"
INTERVAL="${SOVEREIGN_WATCH_INTERVAL:-900}"   # 15 דק' — אותו-קצב-מטרונום
LOG="${SOVEREIGN_WATCH_LOG:-/tmp/sovereign-watchdog.log}"
LOCK="/tmp/sovereign-mirror.lock"

say(){ printf '%s [watchdog] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

say "born (interval=${INTERVAL}s src=$(basename "$SRC") port=${PORT} sandbox=$SANDBOX)"
while true; do
  # ── 1) אתר-המפעיל ──
  if ! curl -sf -o /dev/null "http://localhost:${PORT}/" --max-time 5; then
    say "operator-site DOWN — quiet boot…"
    (cd "$SRC" && nohup bun run dev >> /tmp/sovereign-dev.log 2>&1 & echo $! > /tmp/sovereign-dev.pid)
    sleep 10
    if curl -sf -o /dev/null "http://localhost:${PORT}/" --max-time 10; then
      say "operator-site REVIVED"
    else say "operator-site still not answering (honest — check /tmp/sovereign-dev.log)"; fi
  fi
  # ── 2) מראת-הענן (חד-גישה: flock — אפס-מירוץ-מול-revive) ──
  if curl -sf -o /dev/null "http://localhost:${PORT}/" --max-time 5; then
    if flock -n "$LOCK" node "$SANDBOX/boot/mirror.mjs" --source "$SRC" >> "$LOG" 2>&1; then
      say "mirror cycle OK"
    else say "mirror cycle FAILED this round (honest)"; fi
  fi
  # ── 2.5) פעימת-עורקים: כספת→cloud-echo+gitlab-mirror (T-53 · flock-מוגן) ──
  VDIR_BEAT="$(dirname "$SANDBOX")/$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)"
  if [ -s "$VDIR_BEAT/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" ]; then
    if flock -n /tmp/sovereign-beat.lock bash "$SANDBOX/boot/fleet-beat.sh" >> "$LOG" 2>&1; then
      say "fleet-beat OK"
    else say "fleet-beat degraded this round (honest)"; fi
  fi
  sleep "$INTERVAL"
done
