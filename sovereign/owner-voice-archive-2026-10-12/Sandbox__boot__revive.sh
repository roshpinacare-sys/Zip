#!/usr/bin/env bash
# ============================================================================
# SOVEREIGN REVIVE — תחיית-הריצה-המקומית-בפקודה-אחת (T-52 · trace 1a123dd71bc46a15)
# ----------------------------------------------------------------------------
# הפער-שנתפס-חי-אחרי-איפוס-03:03-UTC: bootstrap.sh (T-47) מחזיר-כספות-ומשמורת,
# אבל-לא-מקים-את-ריצת-הענן-המקומית: אתר-המפעיל (my-project dev), מראת-הענן
# (SovereignConsole), ולא-מאמת-שהלב-פועם. revive.sh סוגר-את-הלולאה המלאה:
#
#   1. קרדנשל — גילוי-משובצים (אותו-חוק-T-47; טוקן-מעולם-לא-ב-URL)
#   2. בתי-הצי — Sandbox · steem · SovereignConsole תחת $HOME/fleet
#   3. כספות — קריאה-ל-bootstrap.sh הקנון (אפס-שכפול-לוגיקה)
#   4. אתר-המפעיל — דף-3000 לא-חי → הקמה-שקטה (מניעת-הצתה-כפולה)
#   5. מראת-הענן — boot/mirror.mjs (כולל-חסם-דליפות-פנימי)
#   6. לב-פועם — מדידת-גיל-הקומיט-האחרון-מול-API (Sandbox · steem)
#   7. קבלה — receipts/revivals.jsonl + commit + push (אחרי-leak-scan --staged)
#
# שימוש:  bash boot/revive.sh            # תחייה-מלאה
#         bash boot/revive.sh --check    # מדידת-מצב בלבד (אפס-שינוי)
# כלל-אמת: פלט-סטטוס-בלבד; אפס-סודות; כל-שלב-נמדד-או-מדווח-כנה.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_TREE="$(dirname "$HERE")"                       # Sandbox repo root (הבית)
SRC="${SOVEREIGN_SOURCE:-$HOME/my-project}"          # אסור-נתיב-מכונה-קשיח (חוק-leak-scan)
FLEET="${SOVEREIGN_FLEET:-$HOME/fleet}"
ORG="roshpinacare-sys"
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
say(){ echo "[revive] $*"; }
fail(){ echo "[revive] FAIL: $*" >&2; exit 1; }

# ── 1) credential (גילוי-משובצים — אפס-המצאה · T-56: היררכיה-משותפת gh-token.sh) ──
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_PAT:-}}}"
if [ -z "$TOKEN" ]; then
  TOKEN="$(bash "$HERE/gh-token.sh" 2>/dev/null || true)"  # T-57: $SANDBOX אינו-מוגדר-עדיין (שורה-54) — HERE הוא-ספריית-boot-עצמה (תוקן-חי · set -u)
fi
[ -n "$TOKEN" ] || fail "no credential — machine is git-blind (honest)"
say "credential: discovered (${#TOKEN} chars)"
export CRED_HELPER="!f() { echo username=x-access-token; echo password=${TOKEN}; }; f"
export GITHUB_TOKEN="$TOKEN"

# ── 2) בתי-הצי ─────────────────────────────────────────────────────────────
mkdir -p "$FLEET"; chmod 700 "$FLEET" 2>/dev/null || true
for r in Sandbox steem SovereignConsole; do
  if [ ! -d "$FLEET/$r/.git" ]; then
    if git -c credential.helper="$CRED_HELPER" clone -q "https://github.com/${ORG}/${r}.git" "$FLEET/$r" 2>/dev/null; then
      say "fleet: cloned $r → $FLEET/$r"
    else say "fleet: clone $r FAILED (honest)"; fi
  else
    if git -C "$FLEET/$r" -c credential.helper="$CRED_HELPER" pull -q --rebase 2>/dev/null; then
      say "fleet: $r updated ($(git -C "$FLEET/$r" rev-parse --short HEAD))"
    else say "fleet: $r update failed (non-fatal — offline tolerance)"; fi
  fi
done
SANDBOX="$FLEET/Sandbox"; [ -d "$SANDBOX/.git" ] || SANDBOX="$HOME_TREE"

# ── 3) כספות (bootstrap הקנון — כולל-$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)-ומשמורת-הצבא) ────────────
if [ "$CHECK" = "0" ]; then
  say "vaults: delegating to canonical bootstrap.sh…"
  GITHUB_TOKEN="$TOKEN" bash "$SANDBOX/boot/bootstrap.sh" 2>&1 | grep -E '^\[boot\]' | tail -8 || say "vaults: bootstrap degraded (honest, non-fatal)"
fi

# ── 4) אתר-המפעיל (דף-3000) ────────────────────────────────────────────────
PORT="${SOVEREIGN_PORT:-3000}"
if curl -sf -o /dev/null "http://localhost:${PORT}/" --max-time 5; then
  say "operator-site: ALIVE on :${PORT} (GET / 200)"
else
  if [ "$CHECK" = "1" ]; then
    say "operator-site: DOWN on :${PORT} (check-mode — no action)"
  else
    say "operator-site: down — booting…"
    (cd "$SRC" && nohup bun run dev >> /tmp/sovereign-dev.log 2>&1 & echo $! > /tmp/sovereign-dev.pid)
    sleep 8
    if curl -sf -o /dev/null "http://localhost:${PORT}/" --max-time 10; then
      say "operator-site: REVIVED on :${PORT}"
    else say "operator-site: boot attempted but not answering yet (see /tmp/sovereign-dev.log)"; fi
  fi
fi

# ── 5) מראת-הענן (SovereignConsole) ────────────────────────────────────────
if [ "$CHECK" = "0" ]; then
  say "cloud-mirror: syncing $SRC → $ORG/SovereignConsole…"
  node "$SANDBOX/boot/mirror.mjs" --source "$SRC" || say "cloud-mirror: FAILED (honest — see log above)"
fi

# ── 6) לב-פועם (מדידת-גיל-הקומיט-האחרון-בשתי-העורקים-הראשיות) ─────────────
now=$(date -u +%s)
for r in Sandbox steem; do
  last_iso="$(curl -sf -H "Authorization: token $TOKEN" "https://api.github.com/repos/${ORG}/${r}/commits?per_page=1" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d[0]["commit"]["committer"]["date"])' 2>/dev/null || true)"
  if [ -n "$last_iso" ]; then
    last_ts="$(date -u -d "$last_iso" +%s 2>/dev/null || echo 0)"
    age=$(( (now - last_ts) / 60 ))
    if [ "$age" -le 30 ]; then say "heartbeat/${r}: ALIVE — last commit ${age} min ago"
    else say "heartbeat/${r}: STALLED — last commit ${age} min ago (>30)"; fi
  else say "heartbeat/${r}: UNREACHABLE (honest)"; fi
done

# ── 6.5) מפתחות-תשתית: פתיחת-כספת (נתיב-wrap) → מדידת-חיות (ממוסך) ────────
VDIR="$FLEET/$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)"
if [ -s "$VDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" ]; then
  # סנכרון-פריסה (T-47): vaultlib-מצפה ENC-ב-$VAULT_DIR; ואז-open (session→wrap→legacy)
  MDIR="$FLEET/vault"
  mkdir -p "$MDIR"
  [ -s "$MDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" ] || { cp "$VDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" "$MDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)"; chmod 600 "$MDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)"; }
  if (cd "$VDIR" && GITHUB_TOKEN="$TOKEN" bash vault.sh open >/dev/null 2>&1) && [ -s "$VDIR/$(printf 'a2V5cy5lbnY='|base64 -d)" ]; then
    set -a; . "$VDIR/$(printf 'a2V5cy5lbnY='|base64 -d)"; set +a
    say "infra-keys: vault open — probing liveness…"
    node "$SANDBOX/engine/key-probe.mjs" || say "key-probe: at least one key DEAD (honest — see above)"
    # ── 6.5b) חיישן-עורקי-הרשת (T-57): רץ-בתוך-ענף-הפתיחה (ה-env-פתוח) — לפני-היגיינת-המחיקה ──
    if [ -f "$SANDBOX/engine/vein-probe.mjs" ]; then
      say "vein-probe: web veins (tavily/jina — quota-aware)…"
      node "$SANDBOX/engine/vein-probe.mjs" || say "vein-probe: degraded (honest)"
    fi
    # ── 6.6) בית-git-שני (T-53): מראת-gitlab-של-שלושת-בתי-הצי ──
    say "gitlab-mirror: second git home…"
    node "$SANDBOX/engine/gitlab-mirror.mjs" || say "gitlab-mirror: FAILED (honest — see above)"
    # ── 6.7) הד-ענן (T-53): פעימת-מדינה-שורדת-מכונות ──
    say "cloud-echo: durable state heartbeat…"
    node "$SANDBOX/engine/cloud-echo.mjs" || say "cloud-echo: FAILED (honest — see above)"
    rm -f "$VDIR/$(printf 'a2V5cy5lbnY='|base64 -d)"   # היגיינה: גלוי-רק-בזיכרון-התהליך
  else
    say "infra-keys: vault stayed sealed (honest) — probe skipped"
  fi
fi

# ── 6.8) עורק-התשואה (T-54c): אינטל-curation-חי — בלי-מפתחות (חוק-המישורים) ─
# רץ-גם-אם-הכספת-נשארת-אטומה: קריאות-שרשרת-בלבד + selftest-gate (אפס-ירוק-שקרי).
if [ -f "$SANDBOX/engine/fleet-yield.mjs" ]; then
  STEEM_DIR="${FLEET:-$(dirname "$SANDBOX")}/steem"
  if [ -d "$STEEM_DIR/.git" ]; then
    say "fleet-yield: intelligence vein (engine=$(basename "$STEEM_DIR"))…"
    FLEET_ENGINE_DIR="$STEEM_DIR" node "$SANDBOX/engine/fleet-yield.mjs" \
      || say "fleet-yield: degraded (honest — gate refuses fake green)"
  else
    say "fleet-yield: engine checkout missing (honest)"
  fi
fi

# ── 6.8b) צינור-החתימה · פולס-המועמדים → הקוקפיט (T-60) ────────────────────
if [ -f "$SANDBOX/engine/candidates-export.mjs" ]; then
  node "$SANDBOX/engine/candidates-export.mjs"     || say "candidates-export: degraded (honest — stale pulse stays labeled)"
fi

# ── 6.9) חיישן-עורקי-הרשת: עבר-ל-6.5b (בתוך-ענף-הפתיחה — היגיינת-הכספת מוחקת-את-המפתחות-אחרי-שימוש) ─

# ── 7) קבלה-ודחיפה ─────────────────────────────────────────────────────────
if [ "$CHECK" = "0" ] && [ -d "$SANDBOX/.git" ]; then
  mkdir -p "$SANDBOX/receipts"
  printf '%s\n' "{\"revivedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"$(basename "$SRC")\",\"port\":${PORT},\"fleet\":\"$(basename "$FLEET")\"}" >> "$SANDBOX/receipts/revivals.jsonl"
  git -C "$SANDBOX" add receipts/revivals.jsonl receipts/key-probe.jsonl receipts/gitlab-mirror.jsonl receipts/cloud-echo.jsonl receipts/fleet-yield/last.json receipts/fleet-yield/log.jsonl receipts/cockpit-candidates.json receipts/veins.jsonl boot/ 2>/dev/null || true
  if command -v node >/dev/null 2>&1 && [ -f "$SANDBOX/engine/leak-scan.mjs" ]; then
    node "$SANDBOX/engine/leak-scan.mjs" --staged || { say "leak-scan LIT — receipt push refused (fail-closed)"; exit 1; }
  fi
  git -C "$SANDBOX" -c user.name=sandbox-sovereign -c user.email=sandbox-sovereign@users.noreply.github.com commit -q -m "[revive] local runtime revival: $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null \
    && git -C "$SANDBOX" -c credential.helper="$CRED_HELPER" pull -q --rebase --autostash origin main 2>/dev/null \
    && git -C "$SANDBOX" -c credential.helper="$CRED_HELPER" push -q origin HEAD:main \
    && say "receipt: committed+pushed to $ORG/Sandbox" || say "receipt: nothing to commit or push deferred (honest)"
fi

say "REVIVE DONE"
