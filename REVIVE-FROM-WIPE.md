# REVIVE-FROM-WIPE — הקמת-הבית מהריפו לבד (הדוקטרינה 2026-10-06)

> הוראת-המפעיל: **"רק הריפו — הסנדבוקס נמחק כל-כמה-שעות"**.
> הריפו = הבית היחיד. הסנדבוקס = כונן-זמני. כל-מה-שחשוב — בגיט.
> סדר-ההחזרה כאן מדויק-ומנוסה-חי (Tasks 1–9-b · ראו worklog.md §יומן-הסנדבוקס).

## 1 · מה שורד ומה נמחק

**שורד (בגיט):**
- כל-הקוד והמצב-המגולל: saos-dex · Zip · Domain · Console · והשאר
- היומן המלא: `zip/worklog.md` (כולל יומן-הסנדבוקס Tasks 1–9)
- הכספת-המוצפנת: `KEYS-ZIP-2026-09-10.zip.enc` + recovery-meta (נתיב-Task 7)
- דוקטרינות: חוק-השרידות · live-wins · בלי-billing · proof-gate

**נמחק (וחייב-שחזור):**
- תהליכים (הצי כולו) · node_modules · DB חי (dex.db/state)
- `zip/upload/pat.env` + `my-project/upload/pat.env` (gitignored — בכוונה)
- `upload/headcorner.txt` (מפתח-האב — gitignored — בכוונה)

## 2 · סדר-ההחזרה

**a. PAT — סמכות-הגיט:**
- אם `upload/pat.rar` קיים ב-mount-העלאות → חילוץ (node-unrar-js; הסיסמה אצל-המפעיל) → `pat.env`
- הצבה-כפולה: `zip/upload/pat.env` **וגם** `my-project/upload/pat.env` (chmod 600 — ה-hunter קורא את-השני!)
- gitignore מאומת בשני-העצים (`upload/` — שורה 62 ב-my-project)

**b. מפתח-האב (headcorner) — דוקטרינת-הכספת:**
- `upload/headcorner.txt` = מצב-אב — ממנו-נגזרים-כל-התפקידים. אף-מפתח-אחר אינו-חוקי.
- אם-נעלם: שחזור-הכספת-החיה מהגיט לפי worklog Task 7 (KEYS-ZIP...enc → sha-תואם → פענוח → `zip/agent/keys/`)
- אימות-מחייב: `bun scripts/verify-owner-key.ts` (ב-saos-dex) → **4/4 MATCH** מול-STEEM-החיה, או-כלום

**c. קלונים:**
```
git clone https://github.com/roshpinacare-sys/Zip.git zip
git clone https://github.com/roshpinacare-sys/saos-dex.git saos-dex
```

**d. ה-DEX (לב-הבית, :3010):**
- הדרך-הקנונית: dex-guard בסלון-mm (keeper מחיה אותו) — בון-שורד
- ידני: `cd saos-dex && bun --bun next start -p 3010` (פרודקשן; basePath **/saos-dex** חובה-בכל-curl!)
- node/next-טהור נשחט-ע"י-ה-reaper — בון-בלבד (חוק-2026-10-06)

**d+. סודות-ה-DEX (.env) — בלעדיהן המסילות מנוטרלות (relay account:null · saos_db_ok 0):**
- יצירה: `saos-dex/.env` (chmod 600 · gitignored-מאומת) — נגזר-קנונית ממקור-הבעלים (אפס-הדפסת-סוד!):
  `DATABASE_URL=file:../db/dex.db` · `SAOS_RELAY_AGENT_ACCOUNT=headcorner` · `HIVE_ANCHOR_ACCOUNT=headcorner`
  `STEEM_POSTING_WIF=<WIF('posting')>` · `STEEM_ACTIVE_WIF=<WIF('active')>` · `BLURT_ACTIVE_WIF=<WIF('active')>` · `HIVE_ACTIVE_WIF=<WIF('active')>`(זהות-בלבד — G1 ידחה-כנה)
  `DEX_OPERATOR_TOKEN=<random 48-hex>` · `SAOS_RELAY_SIGNING_SESSION_UNLOCKED=1` (שער-סשן 1/6 — דוקטרינת ensureUnlocked לדמון-בלתי-מושגח)
- נוסחת-הגזירה הקנונית (src/lib/owner-key.ts r137 · verify-owner-key.ts): `WIF(role)=base58check(0x80 ‖ sha256(account+role+password))` — **אימות 4/4 מול STEEM חובה לפני**
- אזהרה: `verify-headcorner-key.ts` יציג NONE — הוא מפרש-סיסמת-אב כ-WIF-גולמי (עדשה-שגויה); הסמכות היא `verify-owner-key.ts`
- M2: `src/lib/dex/signer.ts` = מודול-המפתחות-היחיד (EnvSigner) — כל-קריאות-המפתחות והחתימות שם (Task 10)

**d++. תיקון-מירוץ-כותבים (אם ה-boot מסרב):** "SNAPSHOT INTEGRITY FAILURE … refusing load" = פיצול-כותבים-כפולים (תהליכי-רפאים!). סדר-התיקון המנוסה (Task 10):
1. גבה: `cp db/dex.db db/dex.db.pre-recovery-<שעה>`
2. `git restore db/state-snapshot.json db/klines.json` (נקודה-עקבית-מהגיט, עידן-חד-כותבי)
3. גזום-זנב-המירוץ: `DELETE FROM BlockHeader WHERE height > <גובה-הסנאפשוט>` (בלבד! שאר-הטבלאות אינן-unique-גובה)
4. הרוג-כל-תהליכי-next-על-:3010 (כולל-רפאים — בדוק `readlink /proc/PID/cwd` → "(deleted)") ותן-ל-dex-guard-להחיות
5. צפה-בלוג: `chain live · height H · (snapshot — verified vs DB stateRoot)` = הצלחה · tape.jsonl נשאר-שלם (עדות-אפנד)

**e. הצי + הקונסולה:**
```
bun scripts/daemons-revive.mjs     # core 3033–3046 (pulse, hunter, keeper, student...)
bun scripts/web-revive-once.mjs    # סופרוויזר :3050 — מאז r192-d הפורט שייך לגלאי-הארביטראז;
                                   #   הסופרוויזר רואה-תפוס ומוותר (נוהג-תחרות-פורטים — תקין)
```
- **הקונסולה-הריבונית = :3000 (my-project next dev) — `bun scripts/dev-revive.mjs`**
  ⚠ לקח-מחיקה #3 (2026-10-07): חובה לפני-עליית :3000 — **סנכרון-src מ-zip** (zip/src/app/api → src/app/api · zip/src/lib → src/lib · components/weave · hooks · types · page/layout/globals · prisma/schema + db:push · מיזוג-תלות מ-zip/package.json) — בלי זה /api/money מחזיר 404 וכל-שרשרת-הכסף (money-mover · treasury-audit) מתה-בכנות (HONEST-FAIL)
  ⚠ לקח-מחיקה #3: **בדיקת-דורס-:3000** — DEX next-start שנולד כש-3010 תפוס מדלג ל-:3000 ודורך על הקונסולה; הרוג דורס ש-cwd-שלו ≠ my-project
  ⚠ שחזור-סוברן: `cp -rn zip/sovereign/{businesses,economy,governance,money,revenue} sovereign/` (no-clobber — רישומים שהמנועים קוראים)
  ⚠ הכל-כבר-ממוכן: `bash scripts/revive/revive-on-pat.sh "<PAT>"` (שלב ה+ · 2026-10-07)
- keeper מפקח-מעתה גם על web:3050 (r205 — fleet-defs)
- סימלינקים-חוזרים: `mini-services/{hunter,pulse,weblift,web}` + `scripts` → עץ-zip

**f. אימות-קצה (כולם-חייבים-ענות):**
| בדיקה | תשובה-נדרשת |
|---|---|
| `:3000/api/health` | 200 (דרך-הגשר → קונסולה) |
| `:3000/api/money` | 200 + `keyPresent:true` + יתרות-חיות (שער-הכסף — בלעדיו המנועים HONEST-FAIL) |
| `:3010/saos-dex/api/dex/metrics` | `saos_height` זורם · `saos_db_ok 1` |
| `:3010/saos-dex/api/dex/relay` | `enabled:true · account:"headcorner"` · steem+blurt anchored גדל · mismatches:0 |
| `:3033` `:3034` `:3035` `:3036` `:3040` `:3043` `:3049` `:3050` `:3051` | 200 |
| `:3035` → `canary.repo` | **roshpinacare-sys/Domain** (v1.4.0) |
| keeper patrol | web:UP · הצי-UP |

## 3 · מה-אינו-ניתן-לשחזור-מהריפו (כנות)
- `pat.rar` עצמו — אם mount-העלאות נעלם, המפעיל מעלה מחדש
- סיסמת-הכספת / סיסמת-ה-seal — אצל-המפעיל בלבד
- דקות-Actions של ריפוא-פרטיים — לא-חוזרות בלי-billing (ולא-צריך: הקנרית על Domain חינם-לנצח)
