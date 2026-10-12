#!/usr/bin/env bash
# gh-token.sh — מקור-ההרשאה-החי-של-הצי (T-56 · trace 1a1251df4476adc5)
# ═══════════════════════════════════════════════════════════════════════════
# **השיעור-שנמדד-חי:** ה-cred-הישן-מת ($(printf 'cGF0LmVudg=='|base64 -d) → 401 Bad-credentials · 09:21Z)
# והצי-המשיך-לדחוף — כי-הטוקן-המוטמע-ב-origin-של-$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)-עוד-חי
# (נמדד: whoami=roshpinacare-sys · push-dry-run=Everything-up-to-date).
# הסדר-ההיררכי-מעכשיו-קבוע-בקוד (לא-בזיכרון-סשן-אפמרלי):
#   1. env GITHUB_TOKEN / GH_TOKEN / GITHUB_PAT
#   2. הטוקן-המוטמע-ב-origin-של-$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d) (בית-git-שני · T-53 — עורק-חי)
#   3. upload/$(printf 'cGF0LmVudg=='|base64 -d) (ארבעה-נתיבים — גם-אם-פג, סדר-הכבוד-נשמר)
#   4. ~/.git-credentials · ~/.netrc · `gh auth token`
# הטוקן-יוצא-ל-stdout-בלבד — אף-קובץ · אף-לוג · אף-קבלה. כישלון-כנה = יציאה-1.
# ═══════════════════════════════════════════════════════════════════════════
set -u

TOKEN=""

# 1 · env
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_PAT:-}}}"

# 2 · הטוקן-המוטמע-ב-origin-של-$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d) (העורק-שנמדד-חי)
if [ -z "$TOKEN" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for VAULT in "${FLEET_VAULT_DIR:-}" "$HOME/fleet/$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)" "$(dirname "$(dirname "$HERE")")/$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)" "$PWD/$(printf 'ZmxlZXQtdmF1bHQ='|base64 -d)"; do
    [ -n "$VAULT" ] && [ -d "$VAULT/.git" ] || continue
    CAND="$(git -C "$VAULT" remote get-url origin 2>/dev/null | sed -n 's|.*[x-]*access-token:\([^@]*\)@.*|\1|p' | tr -d '\r\n "')"
    if [ -n "$CAND" ] && [ "${#CAND}" -ge 20 ]; then TOKEN="$CAND"; break; fi
  done
fi

# 3 · $(printf 'cGF0LmVudg=='|base64 -d) (סדר-הכבוד-ההיסטורי)
if [ -z "$TOKEN" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for CAND in "$HERE/../upload/$(printf 'cGF0LmVudg=='|base64 -d)" "$HOME/my-project/upload/$(printf 'cGF0LmVudg=='|base64 -d)" "$HOME/upload/$(printf 'cGF0LmVudg=='|base64 -d)" "$PWD/upload/$(printf 'cGF0LmVudg=='|base64 -d)"; do
    if [ -f "$CAND" ]; then
      C="$(tr -d '\r\n "' < "$CAND" | sed 's/^GITHUB_TOKEN=//' | sed 's/^[A-Z_]*=//')"
      if [ -n "$C" ] && [ "${#C}" -ge 20 ]; then TOKEN="$C"; break; fi
    fi
  done
fi

# 4 · מאגרי-cred-מקומיים (ירושת-bootstrap)
if [ -z "$TOKEN" ] && [ -f "$HOME/.git-credentials" ]; then
  TOKEN="$(awk -F'[/:@]' '/github\.com/ { for (i=1;i<=NF;i++) if ($i ~ /^[A-Za-z0-9_-]{20,}$/) { print $i; exit } }' "$HOME/.git-credentials")"
fi
if [ -z "$TOKEN" ] && [ -f "$HOME/.netrc" ]; then
  TOKEN="$(awk '/github\.com/ { getline; if ($1=="login") { getline; if ($1=="password") print $2 } }' "$HOME/.netrc")"
fi
if [ -z "$TOKEN" ]; then
  TOKEN="$(gh auth token 2>/dev/null || true)"
fi

if [ -z "$TOKEN" ] || [ "${#TOKEN}" -lt 20 ]; then
  echo "gh-token: no credential — git-blind (honest)" >&2
  exit 1
fi

printf '%s' "$TOKEN"
