# RESUME-PACKET — חבילת-המשכיות: כל-סשן/סוכן/הקשר שנפל חוזר-לכאן ב-≤5 דקות

> **למה זה קיים** (הוראת-בעלים 2026-10-11): "חשוב לעדכן את כל המערך שזה לא יקרה פה בסנדבוקס וילך לאיבוד עוד שעה".
> הסנדבוקס אפמרלי — ההקשר מת. **הגיט חי.** לכן כל-מה-שצריך-כדי-לחזור-לעבוד נמצא-כאן, בגיט, ומתעדכן-בכל-סוף-משמרת.
> **חוק**: סוכן-שמסיים-משמרת מעדכן-את-§1-כאן ומוסיף-שורת-פנקס. סוכן-שמתחיל — קורא-את-הקובץ-הזה קודם-הכל.

---

## 0. פרוטוקול-ברזל (חובה לפני-כל-פעולה)

1. קרא-שורות-אחרונות של `ops/AGENT-LEDGER.md` — מה-כבר-בוצע, מי-פעיל-עכשיו.
2. **רישום-סקופ לפני-פעולה** (שורה-אחת בפנקס) — G7.
3. **אסור להדפיס סודות** (G9). PAT-חי ב-`upload/pat.env`-מקומי-בלבד + כסודות-GitHub.
4. עובדים-מול-הגיט-בלבד: `estate/gh_commit.py` (קומיט-אטומי; collision-safe: `force=false` + ריטרי-עם-רענון-תוכן).
5. בסוף-משמרת: STATUS-סוכן + שורת-פנקס + **עדכון-ה-SNAPSHOT-כאן**.

## 1. SNAPSHOT חי (מתעדכן-בכל-סוף-משמרת)

- **עודכן**: 2026-10-11 ~22:50 IST ע"י `zai-code-5` (session-8)
- **האצלה-ריבונית בתוקף**: סמכות §1–§8 אצל-הריבונות, חוקי-מנוע G1–G10 → `ops/OWNER-DELEGATION-2026-10-11.md`
- **TOKEN-TRUTH-חי-מפורסם**: `ops/TOKEN-TRUTH.md` — watchdog-משודרג-מודד-ומפרסם-לגיט-יומית; ECO_WALLET_TOKEN-וגם-SBX_FLEET_PAT = הערך-הישן-עדיין (61-ימים)
- **נתיב-הפעלה-10-שניות-לטוקן-החדש** (הבעלים-אמר-שהזין-טוקנים-ב-steem — נמדד: לא-בשום-REST-גלוי): Sandbox→Secrets→`FLEET_TOKEN`→Actions→token-forge→secret_name=FLEET_TOKEN·mode=route → ניתוב-מלא+הצתת-עורקים+אימות-ירוק (runbook §6); token-forge-ב-steem-מושהה (CI-פרטי-מת-מאחורי-קיר-החיוב — נמדד)
- **המשרד-מנהל-את-הריבונות**: office-growth (כל-6ש) → ops/office/{potential.json,work-orders.json,VALUE-MAP.md} — סריקת-פוטנציאל+work-orders-אמיתיים (2-P1-חיים-עכשיו); חדר-הצמיחה: Domain/office3d/growth; לצד-v2.5-מפקדת (zai-sec) ו-worlds (zai-worlds)
- **§1 (רוטציית-PAT) = החסם-היחיד** — ממתין-ל-2-טוקנים. **פיזיקה, לא-בירוקרטיה**: GitHub-API אינו-מנפיק PATs (classic-וגם-fine-grained).
  - תפוגת-ה-PAT-הנוכחי **נמדדה-חיה**: **2026-12-12T13:08:14Z** (= 15:08 IST; מאשר-את-ספירת-ה-T של-הצי: T-62-ב-10-11 ✓)
  - הטוקן = **fine-grained** (אין-כותרת X-OAuth-Scopes), חי-ובריא (200-OK, 4938/5000-מכסה)
  - **עד-אז-שום-דבר-לא-מת בשקט**: watchdog-יומי (`.github/workflows/token-watchdog.yml`) בודק-תפוגה-ומקים-issue-אוטומטי-ב-T-14
  - כל-השרשרת-אחרי-ההנפקה מתוסרטת: `ops/TOKEN-ROTATION-RUNBOOK.md` — מגע-אנושי = ~3 דקות, השאר-אוטומטי
- **שער-R293**: מדד-האימות = `execute.verdict != BROADCAST-FAIL` ב-daily-report-טרי ב-takeover-הבא (ראה saos-runtime#1)
- **§2–§8** הוכרעו-כולם במסגרת-ההאצלה (מטריצה ב-OWNER-DELEGATION); §6-נפתח-אוטומטית-רק-אחרי-§1
- **מפת-האחוזה (26-מאגרים, נמדד 19:31Z)**:
  - ציבוריים (9): FleetHQ · Domain · Sandbox · TruthRail · sovereign-beacon · sovereign-lighthouse · saos-agents · saos-runtime · Console
  - פרטיים (17): Zip · Saosmartwallet · Adsmarket · sanbox · Project-files · Sdk · Defi · roshpina · saos-sovereign-platform · saos-sovereign-foundry · SovereignConsole · saos-jummper · anchor-baseline · steem (ענף-ברירת-מחדל = **saos-cockpit**) · saos-control-center · saos-dex · vault-home
- **אזורים-חמים** (G7 — קרא-פנקס-וקומיטים-אחרונים-לפני-כל-נגיעה): `steem@saos-cockpit` · `saos-runtime` · `Domain/agents/*` · `FleetHQ`
- **קר/טריטוריית-zai-code-5**: Sandbox/ops-פרוטוקול · Console-סטטי · issues-בצי
- **סוכנים-חיים-בשעת-עדכון (21:35Z)**: zai-sec-1a12af86 (v2.5-מפקדת+heartbeat) · zai-worlds (worlds-room) · zai-code-3 (office-ci/ספרים/pulse) · zai-11c (פאנל-מחקר) · saos-human-cadence·saos-dex-router (קצב-אוטומטי): zai-code-3 (office-ci/ספרים) · zai-sec-1a12af86 (FleetHQ-heartbeat/דף) · zai-10b (דף-Domain) — תמיד-אמת-מהפנקס-החי, לא-מה-snapshot

## 2. פקודות-חזרה-מהירה (copy-paste)

```bash
# אימות-טוקן-מקומי (בלי-הדפסת-סוד):
TOKEN=$(head -1 /home/z/my-project/upload/pat.env | tr -d '\r\n ')
curl -s -D /tmp/h.txt -H "Authorization: token $TOKEN" https://api.github.com/user -o /tmp/u.json
head -1 /tmp/h.txt; grep -iE "x-oauth-scopes|token-expiration|x-ratelimit-remaining" /tmp/h.txt

# קריאת-פנקס-חי (שורות-אחרונות):
curl -s -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/roshpinacare-sys/Sandbox/contents/ops/AGENT-LEDGER.md" | tail -20

# קומיט-אטומי (blobs→tree→commit→ref; force=false = התנגשות-נדחית-ולא-דורסת):
python3 -c "import json; json.dump({'message':'...','files':{'path':'content-or-null'}}, open('/tmp/action.json','w'))"
GHTOKEN="$TOKEN" python3 /home/z/my-project/estate/gh_commit.py roshpinacare-sys Sandbox main /tmp/action.json
# 422-התנגשות → רענן-תוכן-מה-HEAD-הטרי-ונסה-שוב (אף-פעם-לא-לכפות)
```

## 3. למה-ככה (הקשר-החלטות — אל-תשפטו-מחדש-בלי-לקרוא)

- **האוטונומיה-גרה-בגיט, לא-בסנדבוקס**: כל-לולאה-מתוזמנת = CI-ציבורי (G4; קיר-החיוב הרג-את-כל-ה-CI-הפרטי-ב-10-05 — ריצות-0-שלבים).
- **האצלה ≠ אי-ודאות**: הבעלים-מאשר-רק-את-מה-GitHub-חוסם-פיזיקלית (הנפקת-טוקנים) — G10.
- **הכנות-מנצחת-שקר**: אדום-מפורסם-בעצמו; שקר-שקט-כבר-לא-אפשרי (עורקי-אמת + gitleaks-חי).
- **במקום-לארכב — להחיות**: תיקיות-מושתקות נפתחות-ומתוקנות-במקום (הוראת-בעלים session-7); ארכוב-רק-עם-tombstone+verifier.
- עומק-מלא: `SOVEREIGN-RECOVERY-PLAN` · `SOVEREIGN-DECISIONS` · `ESTATE-TRUTH` · `GROWTH-PLAN` · `SOVEREIGN-REVIVAL` · `ops/lessons/ledger.md`

## 4. מה-הלאה (בפתיחת-משמרת-חדשה)

1. אם-ה-2-טוקנים-כבר-הונפקו (בדוק-issue-של-token-watchdog + פנקס): בצע-את-שלב-ב-האוטומטי ב-runbook §3.
2. אם-לא: **§1-לא-חוסם-כלום-חוץ-מ-§6** — המשך-עבודה-חיה: GROWTH-PLAN-מסילות · office-artery · אימות-עורקים · קונסולידציה-26→8.
3. דגלים-לבדוק-בכל-פתיחה: ריצות-אחרונות של-4-העורקים ב-Sandbox · daily-report-טרי ב-steem@saos-cockpit · issues-פתוחים ב-saos-runtime · ריצת-token-watchdog-האחרונה.
