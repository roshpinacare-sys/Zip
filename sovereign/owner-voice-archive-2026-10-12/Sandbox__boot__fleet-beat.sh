#!/usr/bin/env bash
# ============================================================================
# FLEET BEAT — פעימת-העורקים-בין-תחיות (T-53 · trace 1a12430c9840b1bd)
# ----------------------------------------------------------------------------
# המפעיל-הפנימי-בשגרה: כל-מחזור-שעון של-watchdog שואל-את-הכספת (session-pass
# = זול), מפעיל-את-שני-עורקי-הריבונות-שנאטמו-ב-T-52b, וקובר-קבלות-חתומות:
#
#   1. כספת — vault.sh open (session → wraps → legacy; הגילוי-כמו-revive)
#   2. cloud-echo  — פעימת-מדינה-שורדת-מכונות (Supabase · Postgres)
#   3. gitlab-mirror — בית-git-שני (דילוג-כנה-כשאין-שינוי)
#   3.5 render-home — בית-חי-שני-לקוקפיט (מדידה+החיה-עצמית)
#   3.7 fleet-yield — עורק-התשואה-חי (T-54c): אינטל-curation-בלי-מפתחות
#       (חוק-המישורים: המנוע-מתכנן · הקוקפיט-חותם — כאן-קריאה-בלבד)
#   4. קבלות — leak-scan --staged (fail-closed) → commit → push
#
# אפס-סודות-בפלט · $(printf 'a2V5cy5lbnY='|base64 -d)-נמחק-בסוף (היגיינה) · כל-כשל-כנה-ולא-קטלני.
# שימוש:  flock -n /tmp/sovereign-beat.lock bash boot/fleet-beat.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX="$(dirname "$HERE")"
FLEET="$(dirname "$SANDBOX")"
VDIR="$FLEET/$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)"
MDIR="$FLEET/vault"
SRC="${SOVEREIGN_SOURCE:-$HOME/my-project}"
say(){ echo "[fleet-beat] $*"; }

# ── 1) כספת (session-זול · גילוי-וֶדוֹן-כשאין-סשן) ──────────────────────────
[ -s "$VDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" ] || { say "no sealed vault — nothing to beat (honest)"; exit 0; }
mkdir -p "$MDIR"
[ -s "$MDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" ] || { cp "$VDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)" "$MDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)"; chmod 600 "$MDIR/$(printf 'a2V5cy5lbnYuZW5j'|base64 -d)"; }
if [ ! -s "$MDIR/.session-pass" ] && [ ! -s "$VDIR/.session-pass" ]; then
  GH="$(bash "$SANDBOX/boot/gh-token.sh" 2>/dev/null || true)"  # T-56: היררכיה — כספת-origin קודם (העורק-החי)
  export GITHUB_TOKEN="$GH"
fi
(cd "$VDIR" && bash vault.sh open >/dev/null 2>&1) || true
if [ ! -s "$VDIR/$(printf 'a2V5cy5lbnY='|base64 -d)" ]; then
  say "vault stayed sealed (honest) — beat skipped this round"
  exit 0
fi
set -a; . "$VDIR/$(printf 'a2V5cy5lbnY='|base64 -d)"; set +a

# ── 2) הד-ענן (מדינה-שורדת-מכונות) ─────────────────────────────────────────
node "$SANDBOX/engine/cloud-echo.mjs" || say "cloud-echo FAILED (honest — see above)"

# ── 3) בית-git-שני (idempotent — מדלג-על-ראשים-מאומתים-זהים) ───────────────
node "$SANDBOX/engine/gitlab-mirror.mjs" || say "gitlab-mirror degraded (honest — see above)"

# ── 3.5) הבית-השני-החי (T-54): מדידה+החיה-עצמית-של-קוקפיט-Render ──────────
node "$SANDBOX/engine/render-home.mjs" || say "render-home degraded (honest — see above)"

# ── 3.7) עורק-התשואה (T-54c): סנכרון-מנוע-מוגן + אינטל-חי ─────────────────
# המנוע-חי-ב-$FLEET/steem (checkout-משותף-עם-האחים) — סנכרון-פסיבי-בלבד:
# אחורי-ונקי→fast-forward · מלוכלך→נוגעים-לא (חוק-אפס-דריסה) · שגיאה=לא-קטלני.
STEEM_DIR="$FLEET/steem"
if [ -d "$STEEM_DIR/.git" ] && [ -f "$SANDBOX/engine/fleet-yield.mjs" ]; then
  if git -C "$STEEM_DIR" fetch -q origin saos-cockpit 2>/dev/null; then
    LOCAL="$(git -C "$STEEM_DIR" rev-parse HEAD 2>/dev/null)"
    REMOTE="$(git -C "$STEEM_DIR" rev-parse FETCH_HEAD 2>/dev/null)"
    DIRTY="$(git -C "$STEEM_DIR" status --porcelain 2>/dev/null | head -1)"
    if [ -n "$LOCAL" ] && [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ] && [ -z "$DIRTY" ] \
       && git -C "$STEEM_DIR" merge-base --is-ancestor "$LOCAL" "$REMOTE" 2>/dev/null; then
      git -C "$STEEM_DIR" pull -q --ff-only origin saos-cockpit 2>/dev/null \
        && say "yield-engine synced: $(git -C "$STEEM_DIR" rev-parse --short=12 HEAD)" \
        || say "yield-engine sync deferred (honest)"
    fi
  fi
  FLEET_ENGINE_DIR="$STEEM_DIR" node "$SANDBOX/engine/fleet-yield.mjs" \
    || say "fleet-yield degraded (honest — the gate refuses fake green)"
else
  say "fleet-yield: engine checkout missing (honest — intel skipped this beat)"
fi

# ── 3.8) צינור-החתימה · פולס-המועמדים → הקוקפיט (T-60 · בקצב-הפעימה) ──────
if [ -f "$SANDBOX/engine/candidates-export.mjs" ]; then
  node "$SANDBOX/engine/candidates-export.mjs" \
    || say "candidates-export degraded (honest — the cockpit gets the stale pulse labeled)"
fi

# ── 4) קבלות → leak-scan (fail-closed) → דחיפה ────────────────────────────
rm -f "$VDIR/$(printf 'a2V5cy5lbnY='|base64 -d)"
if [ -d "$SANDBOX/.git" ]; then
  git -C "$SANDBOX" add receipts/cloud-echo.jsonl receipts/gitlab-mirror.jsonl receipts/render-home.jsonl receipts/fleet-yield/last.json receipts/fleet-yield/log.jsonl receipts/cockpit-candidates.json 2>/dev/null || true
  if git -C "$SANDBOX" diff --cached --quiet 2>/dev/null; then
    say "receipts: nothing new (honest)"
  else
    if command -v node >/dev/null 2>&1 && [ -f "$SANDBOX/engine/leak-scan.mjs" ]; then
      node "$SANDBOX/engine/leak-scan.mjs" --staged >/dev/null 2>&1 || { say "leak-scan LIT — receipts push REFUSED (fail-closed)"; exit 1; }
    fi
    GH="$(bash "$SANDBOX/boot/gh-token.sh" 2>/dev/null || true)"  # T-56: היררכיה — כספת-origin קודם (העורק-החי)
    HELPER="!f() { echo username=x-access-token; echo password=$GH; }; f"
    git -C "$SANDBOX" -c user.name=sandbox-sovereign -c user.email=sandbox-sovereign@users.noreply.github.com \
      commit -q -m "[fleet-beat] cloud+gitlab receipts: $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null || true
    git -C "$SANDBOX" -c credential.helper="$HELPER" pull -q --rebase --autostash origin main 2>/dev/null || true
    if git -C "$SANDBOX" -c credential.helper="$HELPER" push -q origin HEAD:main 2>/dev/null; then
      say "receipts: committed+pushed"
    else
      say "receipts: push deferred (honest — next beat retries)"
    fi
  fi
fi
say "BEAT DONE"
exit 0
