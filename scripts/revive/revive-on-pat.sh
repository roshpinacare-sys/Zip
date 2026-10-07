#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# REVIVE-ON-PAT — החזרה לדקה אחת ברגע שה-PAT חוזר (מחיקה #3, 2026-10-06)
# שימוש:  bash /home/z/revive/revive-on-pat.sh "ghp_..."   (או ZIP_PAT בסביבה)
# סדר-הריצה לפי zip/REVIVE-FROM-WIPE.md (שלבים א–ו). אידמפוטנטי, fail-soft.
# ═══════════════════════════════════════════════════════════════════════
set -u
PAT="${1:-${ZIP_PAT:-${PAT:-}}}"
MP=/home/z/my-project
RV=/home/z/revive
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✗ $1"; FAIL=$((FAIL+1)); }
step(){ echo; echo "── $1 ─────────────────────────────────────────"; }

[ -n "$PAT" ] || { echo "שימוש: $0 \"<PAT>\"  — בלי PAT אין מה לשחזר (fail-closed)"; exit 1; }

step "א׳ · PAT — הצבה כפולה (חוק-המקומות)"
mkdir -p $MP/upload $MP/zip 2>/dev/null
for dst in "$MP/upload/pat.env" "$RV/pat.env"; do
  printf 'PAT=%s\nZIP_PAT=%s\nWEAVE_OPS_PAT=%s\nGITHUB_TOKEN=%s\n' "$PAT" "$PAT" "$PAT" "$PAT" > "$dst"
  chmod 600 "$dst" && ok "נכתב + chmod 600: $dst"
done

step "ב׳ · שיבוט Zip + saos-dex (הבית הנצחי חוזר)"
git config --global credential.helper store 2>/dev/null
printf 'https://x-access-token:%s@github.com\n' "$PAT" > ~/.git-credentials && chmod 600 ~/.git-credentials
if [ ! -d $MP/zip/.git ]; then
  git clone --quiet "https://x-access-token:${PAT}@github.com/roshpinacare-sys/Zip.git" $MP/zip \
    && git -C $MP/zip remote set-url origin https://github.com/roshpinacare-sys/Zip.git \
    && ok "Zip משובט → $MP/zip" || bad "שיבוט Zip"
else ok "Zip כבר קיים"; fi
if [ ! -d $MP/saos-dex/.git ]; then
  git clone --quiet "https://x-access-token:${PAT}@github.com/roshpinacare-sys/saos-dex.git" $MP/saos-dex \
    && git -C $MP/saos-dex remote set-url origin https://github.com/roshpinacare-sys/saos-dex.git \
    && ok "saos-dex משובט → $MP/saos-dex" || bad "שיבוט saos-dex"
else ok "saos-dex כבר קיים"; fi
# כתוביות-PAT חוזרות למקומן בתוך העץ (מוגן-גיט)
if [ -d $MP/zip ]; then
  mkdir -p $MP/zip/upload && printf 'PAT=%s\nZIP_PAT=%s\n' "$PAT" "$PAT" > $MP/zip/upload/pat.env && chmod 600 $MP/zip/upload/pat.env && ok "zip/upload/pat.env הוצב"
fi

step "ג׳ · סימלינקים (mini-services → עץ zip; scripts → zip/scripts)"
mkdir -p $MP/mini-services
for d in $MP/zip/mini-services/*/; do
  name=$(basename "$d"); [ "$name" = "node_modules" ] && continue
  [ -e "$MP/mini-services/$name" ] || ln -s "$d" "$MP/mini-services/$name" 2>/dev/null
done
[ -e $MP/scripts ] || ln -s $MP/zip/scripts $MP/scripts 2>/dev/null
ok "סימלינקים הוצבו ($(ls $MP/mini-services | wc -l) שירותים)"

step "ד׳ · החייאת הצי — daemons-revive + web-revive-once (חוק-detached)"
if [ -f $MP/zip/scripts/daemons-revive.mjs ]; then
  setsid nohup bun $MP/zip/scripts/daemons-revive.mjs >/tmp/daemons-revive.log 2>&1 < /dev/null &
  ok "daemons-revive.mjs הורץ (detached)"
else bad "daemons-revive.mjs לא נמצא ב-zip/scripts"; fi
sleep 3
if [ -f $MP/zip/scripts/web-revive-once.mjs ]; then
  setsid nohup bun $MP/zip/scripts/web-revive-once.mjs >/tmp/web-revive.log 2>&1 < /dev/null &
  ok "web-revive-once.mjs הורץ (detached)"
else bad "web-revive-once.mjs לא נמצא"; fi

step "ה׳ · DEX ייצור על :3010 — bun בלבד + basePath /saos-dex"
if [ -d $MP/saos-dex ]; then
  cd $MP/saos-dex && [ -d node_modules ] || bun install --silent 2>/dev/null | tail -1
  if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:3010/saos-dex/api/dex/metrics 2>/dev/null; then
    mkdir -p $MP/sovereign/logs
    setsid nohup bun --bun next start -p 3010 > $MP/sovereign/logs/dex-prod.log 2>&1 < /dev/null &
    ok "DEX production הורץ (bun --bun next start -p 3010)"
  else ok "DEX כבר חי על :3010"; fi
fi

step "ה+ · השער-הריבוני :3000 — סנכרון-src מ-zip (לקח-מחיקה #3: בלי זה /api/money מת)"
if [ -d $MP/zip/src ]; then
  mkdir -p $MP/src/app $MP/src/components/weave $MP/src/hooks $MP/sovereign
  cp -r $MP/zip/src/app/api/*  $MP/src/app/api/ 2>/dev/null
  cp -r $MP/zip/src/lib/*      $MP/src/lib/      2>/dev/null
  cp -r $MP/zip/src/types      $MP/src/          2>/dev/null
  cp -r $MP/zip/src/hooks/*    $MP/src/hooks/    2>/dev/null
  cp -r $MP/zip/src/components/weave/* $MP/src/components/weave/ 2>/dev/null
  for f in page.tsx layout.tsx globals.css; do cp $MP/zip/src/app/$f $MP/src/app/$f 2>/dev/null; done
  cp $MP/zip/src/instrumentation.ts $MP/src/instrumentation.ts 2>/dev/null
  cp $MP/zip/prisma/schema.prisma $MP/prisma/schema.prisma 2>/dev/null
  # מודולי-הספר שנטענים-דינמית (saoslite.ts → ../../../console/*.js)
  mkdir -p $MP/console && cp $MP/zip/console/gate-crypto.js $MP/zip/console/saos-live.js $MP/zip/console/acid-engine.js $MP/console/ 2>/dev/null
  ok "src+prisma סונכרנו מ-zip ($(ls $MP/src/app/api | wc -l) נתיבי-API)"
  # תלות-חסרה מ-zip (blurtjs/ethers/steem וכו') — מיזוג לתוך package.json + התקנה
  python3 - <<'PYEOF'
import json
z = json.load(open("/home/z/my-project/zip/package.json"))
c = json.load(open("/home/z/my-project/package.json"))
changed = False
for sec in ("dependencies", "devDependencies"):
    for k, v in z.get(sec, {}).items():
        if k not in c.get(sec, {}):
            c.setdefault(sec, {})[k] = v; changed = True
json.dump(c, open("/home/z/my-project/package.json", "w"), indent=2)
print("deps merged" if changed else "deps ok")
PYEOF
  (cd $MP && bun install --silent >/dev/null 2>&1 && bun run db:push >/dev/null 2>&1 && ok "תלות+DB תקינים") || bad "התקנת-תלות/DB"
else bad "zip/src לא נמצא"
fi
# שחזור-מצב-סוברן (רישומים שהמנועים קוראים — לא דורס חדש-מחיים)
cp -rn $MP/zip/sovereign/businesses $MP/zip/sovereign/economy $MP/zip/sovereign/governance $MP/zip/sovereign/money $MP/zip/sovereign/revenue $MP/sovereign/ 2>/dev/null && ok "סוברן שוחזר מ-zip (no-clobber)" || ok "סוברן כבר מלא"
# הריגת-דורס-פורט 3000 (מחיקה #3: DEX next-start דרך על 3000 כש-3010 היה תפוס)
squatter=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oE "pid=[0-9]+" | head -1 | cut -d= -f2)
if [ -n "$squatter" ]; then
  cwd=$(readlink /proc/$squatter/cwd 2>/dev/null)
  if [ "$cwd" != "$MP" ] && [ "$cwd" != "$MP/zip" ]; then
    kill "$squatter" 2>/dev/null && sleep 2 && ok "דורס :3000 (cwd=$cwd) הוסר"
  fi
fi
# עליית השער (dev-revive מנותק; אידמפוטנטי — אם :3000 עונה לא נוגע)
if [ -f $MP/zip/scripts/dev-revive.mjs ]; then
  setsid nohup bun $MP/zip/scripts/dev-revive.mjs >/tmp/dev-revive.log 2>&1 < /dev/null &
  ok "dev-revive.mjs הורץ (detached)"
else bad "dev-revive.mjs לא נמצא"
fi

step "ו׳ · טבלת-אימות מקצה-לקצה"
sleep 20
declare -A checks=(
  ["console :3000/api/health"]="http://127.0.0.1:3000/api/health"
  ["money-gate :3000/api/money"]="http://127.0.0.1:3000/api/money"
  ["DEX :3010 metrics"]="http://127.0.0.1:3010/saos-dex/api/dex/metrics"
  ["pulse :3033"]="http://127.0.0.1:3033/"
  ["money-mover :3034"]="http://127.0.0.1:3034/"
  ["hunter :3035"]="http://127.0.0.1:3035/"
  ["keeper :3036"]="http://127.0.0.1:3036/"
  ["curation :3040"]="http://127.0.0.1:3040/"
  ["treasury-audit :3043"]="http://127.0.0.1:3043/"
  ["market-maker :3049"]="http://127.0.0.1:3049/status"
  ["arbitrage :3050"]="http://127.0.0.1:3050/"
  ["dex-guard :3051"]="http://127.0.0.1:3051/"
)
for name in "${!checks[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${checks[$name]}" 2>/dev/null)
  [ "$code" = "200" ] && ok "$name → 200" || bad "$name → $code"
done
h=$(curl -s --max-time 5 "http://127.0.0.1:3010/saos-dex/api/dex/metrics" 2>/dev/null | grep -oE 'saos_height[": ]+[0-9]+' | grep -oE '[0-9]+$' | head -1)
[ -n "$h" ] && ok "saos_height זורם: $h" || bad "saos_height לא נמדד"
cv=$(curl -s --max-time 5 "http://127.0.0.1:3035/" 2>/dev/null | grep -o '"canary.repo":"[^"]*"' | head -1)
[ "$cv" = '"canary.repo":"Domain"' ] && ok "hunter canary.repo=Domain" || bad "hunter canary.repo לא מאומת ($cv)"

step "ז׳ · מפתח-הראש — verify-owner-key (fail-closed; חוסם כסף אמיתי)"
if [ -f $MP/saos-dex/scripts/verify-owner-key.ts ]; then
  (cd $MP/saos-dex && bun scripts/verify-owner-key.ts 2>&1 | tail -6)
elif [ -f $MP/zip/scripts/verify-owner-key.ts ]; then
  (cd $MP/zip && bun scripts/verify-owner-key.ts 2>&1 | tail -6)
else bad "verify-owner-key.ts לא נמצא (ב-saos-dex/scripts)"; fi

step "ח׳ · מנועי-הכנסה — מדידת-מצב כנה (חימוש ידני בלבד, חוק-הדיבונים)"
cv2=$(curl -s --max-time 4 http://127.0.0.1:3040/ 2>/dev/null | grep -o '"armed":true')
[ -n "$cv2" ] && ok "curation חמוש" || echo "  ℹ curation לא חמוש — חימוש: curl -X POST :3040/ -d '{\"action\":\"arm\"}'"
mk=$(curl -s --max-time 4 http://127.0.0.1:3049/status 2>/dev/null | grep -o '"mode":"[a-z]*"' | head -1)
echo "  ℹ market-maker: $mk (dry→live רק ב-POST /mode של המפעיל — חוק-עלייה-קרה)"

echo; echo "════════════════════════════════════════════════"
echo "תוצאה: ✓ $PASS  ·  ✗ $FAIL"
echo "נותר ידני (בעלים-בלבד, fail-closed): שחזור-כספת לפי worklog Task 7"
echo "אחרי הכל: סנכרן יומן-מצב → zip/worklog.md (Task 10) + דחיפה"
echo "════════════════════════════════════════════════"
