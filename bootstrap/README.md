# BOOTSTRAP — בוטסטראפ-ריבוני (Task 7-b)

**סקריפט אחד, מוגדר-בגיט, מקים-את-הצי-כולו על-מכונה-ריקה:**
`bootstrap/sovereign-revive.mjs` — ריפו ← תלות ← סודות ← השגרה ← בריאות.

> דוקטרינת-האב (REVIVE-FROM-WIPE.md): הריפו-הוא-הבית; הסנדבוקס-כונן-זמני.
> הסקריפט-הזה הוא הגוף-המכני של-הדוקטרינה — כל-מה-שחשוב-חוזר-מהגיט-בלבד.

---

## שחזור-מחיקה-מלאה — 3 שלבים

### שלב 1 · גיט — קלון-בית-הקוד (והסקריפט-עצמו)

```bash
# אימות: PAT-ב-env או בקובץ pat.env (להלן). אימות-ה-store-הקנוני:
git config --global credential.helper store
printf 'https://x-access-token:%s@github.com\n' "$GIT_TOKEN" > ~/.git-credentials && chmod 600 ~/.git-credentials

mkdir -p /home/z/my-project && cd /home/z/my-project
git clone https://github.com/roshpinacare-sys/Zip.git        zip        # ← הבית + הסקריפט הזה
git clone https://github.com/roshpinacare-sys/saos-dex.git   saos-dex   # ← השרשרת + מקור-האמת למפתחות
git clone https://github.com/roshpinacare-sys/Console.git    /home/z/Console
git clone https://github.com/roshpinacare-sys/Domain.git     /home/z/Domain   # קנרית-החיים
git clone https://github.com/roshpinacare-sys/steem.git      /home/z/steem    # כספת-מוצפנת
```

הסקריפט-עצמו משלים-קלונים-חסרים (אותם-יעדים-בדיוק) — אפשר-לקלון-רק-את-Zip-ולהריץ-אותו.

### שלב 2 · סודות — env-בלבד, אף-סוד-לא-נכתב-לגיט

מקור-האמת למפתחות: `saos-dex/.env` (ה-WIFs-הוכחו **4/4 מול-השרשראות** — verify-owner-key;
BLURT=STEEM-active הוכח ב-`scripts/blurt-key-derive-prove.mjs`).

- **יש-.env-קיים** (מוחזר-מחוץ-לגיט / מהכספת-לפי-worklog-Task-7) → הסקריפט-קורא-אותו. זהו.
- **אין-.env** → מעבירים-סודות-כ-env-והסקריפט-כותב-את-הקובץ (chmod 600 · gitignored-מאומת-בכל-ריצה):

```bash
export GIT_TOKEN=github_pat_...                 # או: SAOS_GIT_PAT / BOOTSTRAP_PAT / pat.env-קיים
export STEEM_ACTIVE_WIF=...  STEEM_POSTING_WIF=...
export HIVE_ACTIVE_WIF=...   HIVE_POSTING_WIF=...    # זהות-בלבד — G1-ידחה-כנה-עד-מימון
export BLURT_ACTIVE_WIF=...                      # = STEEM-active (מוכח)
# אופציונלי: DEX_OPERATOR_TOKEN (ברירת-מחדל: random-48-hex) · DATABASE_URL (ברירת-מחדל: file:../db/dex.db)
```

PAT — סדר-הקריאה (נמדד-כיום): env `GIT_TOKEN`→`SAOS_GIT_PAT`→`BOOTSTRAP_PAT`,
ואז קבצים: `my-project/upload/pat.env` → `/home/z/revive/pat.env` → `zip/upload/pat.env`
(מפתחות-מקובלים: `PAT`/`ZIP_PAT`/`WEAVE_OPS_PAT`/`GITHUB_TOKEN`, או-טוקן-גולמי).

### שלב 3 · בוטסטראפ

```bash
cd /home/z/my-project/zip
bun bootstrap/sovereign-revive.mjs          # בוטסטראפ מלא
bun bootstrap/sovereign-revive.mjs --check  # מדידה-בלבד: אפס-השגרה/הרג/התקנה — דוח-כנה
```

**הערכת-זמן (היסטוריה-נמדדת: 5-מחיקות · ~75 דק' מהוראה-עד-שרשרת-חיה):**

| שלב | זמן-טיפוסי |
|---|---|
| קלונים (5 ריפואים) | 1–3 דק' |
| bun install (zip + saos-dex + שורש) | 2–6 דק' |
| DEX build (next build — רק-אם-חסר) | 2–5 דק' |
| השגרת-הצי (24 שירותים · detached) | ~30 ש' |
| בריאות + עדויות | ~1 דק' |

---

## מה-הסקריפט-עושה

1. **ריפו** — מוודא/משכפל את 5-הריפואים מ-github.com/roshpinacare-sys (Zip · saos-dex · Console · Domain · steem). קלון-קיים = לא-נוגעים. אין-PAT-וצריך-קלון → fail-closed.
2. **תלות** — `bun install` ב-zip, saos-dex והשער-השורש (רק-אם-node_modules-חסר).
3. **סודות** — קורא `saos-dex/.env` או-בונה-אותו-מ-ENV. מדווח-נוכחות-WIFs-בשמות-בלבד. מאמת-gitignore-חי. **אף-סוד-לא-נדפס/נרשם/נדחף.**
4. **מצב-סוברן** — no-clobber מ-zip: businesses/economy/governance/money/revenue/**proofs**.
5. **השגרה** (חוק-detached-spawn: `Bun.spawn` + stdin:ignore + יומן-קובץ — הילד-שורד-את-האב):
   - **:3000** קונסולה — סנכרון-src מ-zip + מיזוג-תלות + db:push + `bun run dev` (או-מעץ-zip-ישירות במכונה-גולמית)
   - **:3010 DEX** — `bun --bun next start` + `DATABASE_URL` + תקרת-JSC-512MB (לקח-oom) + build-אוטומטי-אם-חסר
   - **:3054 dex-guard** — השומר-הנצחי-של-השרשרת (`HEALTH_PORT=3054`)
   - **דיבוני-bun** — :3033 pulse · :3034 money-mover · :3035 hunter · :3036 keeper · :3037 student · :3038 fleet-verify · :3039 weblift · :3040 curation · :3041 kpi · :3042 governance · :3043 treasury-audit · :3044 scout-market · :3045 business · :3046 content-factory · :3048 llm-bridge · :3049 market-maker · :3050 web-console · :3051 dex-grid · :3052 proof-law · :3053 arbitrage
   - **:3047 decision-brain** — python `server.py` (ראה-כנות-להלן)
6. **בריאות** — טבלת TCP+GET-חיה לכל-הפורטים (/health-קודם, /-כנפילה — חוק-r202) עם-retry, עדויות (saos_height · db_ok · canary.repo), וסיכום UP/DOWN **כנה**. exit-0-רק-אם-כל-ה-core-UP (check: תמיד-0).

## אידמפוטנטיות

- שירות-שעונה-HTTP → לא-נוגעים (אין-כפילויות-לעולם) · TCP-בלי-HTTP (נעול) → ניקוי-והשגרה (full-בלבד) · מת → השגרה.
- ריצה-חוזרת = תיקון-הפערים-בלבד. לוג: `/home/z/fleet-tmp/logs/bootstrap.log` + יומן-לכל-שירות באותה-תיקייה.

## כנות (מה-לא-חוזר-מהגיט)

- **decision-brain :3047** — דורש-python-עם-מודול-`laya` (venv `/home/z/laya-eval/venv`-אבד-עם-הסנדבוקס; נמדד-חסר). הסקריפט-חוסם-בכנות-עם-התרופה:
  `uv venv /home/z/laya-eval/venv && uv pip install --python /home/z/laya-eval/venv/bin/python laya`
  או-ריצה-מלאה-עם `BOOTSTRAP_DECISION_BRAIN=provision` (מאספק-ומשגר; checkpoint-~644MB-ב-decide-הראשון · ~2GB-RAM).
- **pat.rar · סיסמת-הכספת · סיסמת-ה-seal** — אצל-המפעיל-בלבד (fail-closed-מכוון).
- **חימוש-מנועי-כסף** (curation-arm · market-maker-live · dex-grid-armed) — POST-מפעיל-בלבד (חוק-הדיבונים/עלייה-קרה).
- **HIVE** — WIF-זהות-בלבד; מימון-חתימה-נדרש-מהמפעיל.

## פרמטרים (env — אף-סוד-קשיח-בקוד)

| משתנה | ברירת-מחדל | תפקיד |
|---|---|---|
| `GIT_TOKEN` / `SAOS_GIT_PAT` / `BOOTSTRAP_PAT` | — | PAT-לקלונים (env-בלבד) |
| `BOOTSTRAP_PAT_FILE` | — | קובץ-pat.env-ידני |
| `BOOTSTRAP_MYPROJECT` | `/home/z/my-project` | עץ-העבודה |
| `BOOTSTRAP_HOME` | `/home/z` | קלוני-התאומים + laya |
| `BOOTSTRAP_ORG` | `roshpinacare-sys` | ארגון-הגיט |
| `FLEET_LOG_DIR` | `/home/z/fleet-tmp/logs` | יומני-הבוטסטראפ-והשירותים |
| `BOOTSTRAP_SKIP_SRC_SYNC` | — | `1` = דלג-על-סנכרון-src-לשער |
| `BOOTSTRAP_DECISION_BRAIN` | — | `provision` = התקן-laya-והשגר |
| `STEEM_*_WIF` `HIVE_*_WIF` `BLURT_ACTIVE_WIF` | — | לבניית-.env-כשחסר |

## מצב-חי-בעת-הכתיבה (2026-10-07 · נמדד)

check: **UP 22/24** → אחרי-ריצה-מלאה-אידמפוטנטית: **UP 23/24** (proof-law-:3052-הוקם-ומאמת-שרשרת-chain=true · 33-רשומות).
DOWN-היחיד: decision-brain :3047 (BLOCKED-NO-LAYA — כנות-למעלה). עדויות: saos_height-זורם · canary.repo=roshpinacare-sys/Domain.
פתוח-חי-חוץ-למנדט: `saos_db_ok 0` ב-DEX-הרץ (evidence-DB-check-נכשל-בתהליך-הקיים; השרשרת-ממשיכה-לזרום) — למפעיל/מהנדס-ה-DEX.
