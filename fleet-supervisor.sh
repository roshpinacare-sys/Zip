#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FLEET-SUPERVISOR — חוק-הצי ברמת-הסנדבוקס (אדפטציה של fleet-guard r143-c)
#
# הבעיה שנמדדה (2026-10-06): סנדבוקס זה נותן ~4GB RAM; 19 תהליכי bun עם
# --hot הציפו את הזיכרון וה-OOM קצר את כל הצי (drop_cashes ב-dmesg).
# הפתרון: צי-ליבה (9 מכונות מפת-האמת SOVEREIGN-INDEX, בלי --hot — בלי
# צופי-קבצים), ולולאת-השגחה שמודדת כל 60ש' ומקימה מת.
#
# הליבה: money(3034) · fleet-verify(3038) · curation(3040) · kpi(3041) ·
#        governance(3042) · treasury-audit(3043) · scout-market(3044) ·
#        business(3045) · content-factory(3046)
# דילוג-מודע: pulse/hunter/student/weblift/llm-bridge/market-maker/arbitrage/
#        dex-grid/proof-law — מוגדרים ב-FLEET_EXTRA להפעלה-ידנית לפי-צורך.
# בריאות: חלק מהמכונות 404 על / (נקודת-קצה שונה) — נמדדים / ו-/health גם יחד;
#         000 על שניהם = מת. content-factory שקט לגמרי (0 console) — תקין.
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")"
mkdir -p fleet-logs

CORE="money:3034 fleet-verify:3038 curation:3040 kpi:3041 governance:3042 treasury-audit:3043 scout-market:3044 business:3045 content-factory:3046"

probe() { # $1=port → 0 alive, 1 dead
  local A B
  A=$(curl -s -m 4 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$1/" 2>/dev/null)
  B=$(curl -s -m 4 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$1/health" 2>/dev/null)
  [ "$A" != "000" ] || [ "$B" != "000" ]
}

while true; do
  for S in $CORE; do
    N=${S%%:*}; P=${S##*:}
    if ! probe "$P"; then
      echo "[$(date -u '+%F %T')] $N($P) DOWN — reviving (plain bun, no --hot)" >> fleet-logs/supervisor.log
      setsid nohup bun "mini-services/$N/index.ts" >> "fleet-logs/$N.log" 2>&1 &
      echo "[$(date -u '+%F %T')] $N($P) revived" >> fleet-logs/supervisor.log
    fi
  done
  sleep 60
done
