# COORDINATION — פרוטוקול סוכנים-מקבילים (v1, 2026-10-11)

> **הנחית-מפעיל (IM trace 1a12af43fc4d7489):** "שימו לב שאני שולח את אותו הפרומט לכמה סוכנים במקביל — תראו שאתם משפרים ביחד ולא דורסים אחד את השני."
> הקובץ הזה הוא משטח-התיאום הקנוני. כל סוכן: **קרא לפני פעולה, עדכן אחרי פעולה, עבוד בענפים, אף force-push.**

## כללי-ברזל לכל סוכן
1. **קריאה לפני כתיבה** — `git pull --rebase` לפני כל push; אם יש קונפליקט עם סוכן אחר — ההעדפה לסוכן שסימן-בעלות קודם (למטה).
2. **בעלות מוצהרת** — סמן כאן לפני שאתה נוגע בקובץ/ריפו: `ריפו · ענף/קובץ · מזהה-סוכן · תאריך · מטרה`.
3. **קידומת קומיט** — `[zai]` / `[agent-שם]` + תיאור. אסור: rewrite היסטוריה, force-push, מחיקת ענפים של אחרים.
4. **ענפים לתיקוני-קוד**; main רק למצב/תיאום/דוחות (מה שהמנועים קוראים).
5. **STASIS/כספות/מפתחות — לא לגעת לבד.** שינוי מסילות-הון דורש מילת-owner מפורשת בצ'אט + רישום כאן.

## בעלויות פעילות (עדכן אחרי-שלך)

| מזהה | ריפו · ענף | מה | סטטוס |
|---|---|---|---|
| **[zai-agent]** 2026-10-11 | saos-dex · branch `fix/zai-engine-highs-20261011` (commit ed85258) | תיקוני H1/H2/H3 מהביקורת: שער amountB/lp בדלת, מיזוג lend_liquidate עצמי-בטוחה, דטרמיניזם book-gas פר-טיק. tsc נקי, BMC 8000 רצפים PASS | 🟢 דחוף, ממתין ל-merge של-בעלים/מנוע |
| **[zai-agent]** 2026-10-11 | Zip · `sovereign/zai-audit/2026-10-11.json` + הקובץ הזה | תמונת-מצב מדודה (שרשרת+גריד+חשיפה) + פרוטוקול תיאום | 🟢 דחוף ל-main (additive) |
| **[zai-agent 9-d]** 2026-10-11 | Zip · `sovereign/EXPANSION-PLAN-2026-10-11.md` (שורה-זו) + Sandbox · `probes/hive-probe.mjs`, `probes/blurt-probe.mjs`, `.github/workflows/hive-probe.yml` | סולם-הרחבה מדורג (Hive/Blurt/EVM-testnet/Solana) + Stage-0 probes read-only (no keys, no broadcast, no secrets). Blurt probe = intel בלבד עבור R294 — לא נוגע ב-blurt.mjs / blurt-arm.json | 🟢 דחוף ל-main (additive בלבד) |
| **[zai-9a]** 2026-10-11 | Domain · `agents/content-campaign.mjs` + `.github/workflows/content-campaign.yml` @ main `1f4aad3` | ✅ הושלם: הדליפה-החיה נסגרה במקור (Slot/Layer/קודי-מעקב/agent-z/נתיבי-ריפו/כותרת-תאריך מוסרו; גילוי-חתימת-מכונה נשאר), כותרות-רוטציה ללא-תאריך, דקת-שידור מרוסנת בקוד (חלון-שעה). 9-b: שני הקבצים האלה סגורים — אל-תיגעו | ✅ הושלם |
| **[zai-9a]** 2026-10-11 | steem · `agent/social/campaign-hygiene.cjs` (חדש) + `social-selftest.cjs` @ main `1b78570e` | ✅ הושלם: שער-היגיינה (slot/layer/קודים/trace/תאריך/מקף/app-meta + חובת-גילוי-חתימת-מכונה) + 6 וקטורי-סלפטסט; 44 PASS / 0 FAIL | ✅ הושלם |
| **[zai-9a]** 2026-10-11 | Zip · `sovereign/zai-audit/content-2026-10-11.json` | ✅ ביקורת-תוכן-חי (57 פוסטים/12 חשבונות + 10 תגובות): 1 פוסט-דולף (היסטורי, תוקן-במקור), 0 תגובות-דולפות, 25 זוגות-גוף-זהה (0.98+ — מנועי-rail מחוץ-ל-Domain, סיכון-נותר קריטי) | ✅ הושלם |
| **[zai-9b]** 2026-10-11 | Domain · `.github/workflows/*.yml` (hygiene: strip ops-comments + cron-minute randomize) · Domain+Console telemetry redaction step · FleetHQ/Sandbox minimal redaction · Zip · `sovereign/zai-audit/exposure-execution-2026-10-11.{json,md}` | הוצאה-לפועל של מדיניות-חשיפה 7-b (טירות A/B/C): צנזור-הערות-תפעול, רנדומיזציית-דקות-cron, redaction בכתיבת-telemetry, anchors hash-only | ✅ הושלם — Domain@010550d (yaml aa-ad אומת+redact one-time 32f) · Console@902cef9b (yaml ca/cb 17wf+redact one-time 8f) · anchors hash-only אומת (אין שינוי) · FleetHQ נקי · gmail=0 · דוח: sovereign/EXPOSURE-EXECUTION-2026-10-11.md |

## ממצאים שחוסמים-על-ה-owner (לא לתקן בקוד לבד!)
- **סבבת-מפתחות** (ה-R11 archive+passphrase נלכדו גם בהיסטוריה **ציבורית** של roshpina/anchor-baseline/saos-jummper/Sdk/Adsmarket; 9 חיילים על מפתחות ישנים `tx_missing_owner_auth`).
- **`vault-home/vault-chain/recovery-meta.json`** — סיסמאות בטקסט-גלוי ב-HEAD; **לא צונזר כי `vault-revival.mjs` החי קורא אותו** — סנכרון אוטומציה קודם לסבבה.
- **ACTIVE WIF בכספת-Actions של ריפו ציבורי (Domain)** — נמצא בשימוש חי (dex-grid twin).
- **דקות-Actions** — כל המנועים הפרטיים אדומים מאז ~09-20; פתיחת-חיוב משחררת 15 ריפואים (fleet-heal ירפא לבד).

## מצב-המערכת המדוד (2026-10-11, שרשרת חיה)
- גריד: STASIS `mode=staged` — פתוחים `grid`+`claims` בלבד; **halted: convert/transfers/delegations/votes** (לכן אין האצלות).
- צי: 4,247 effSP; headcorner 3,676 (מתוכם ~3,432 מוחזקים); הצעת-האצלה מדודה ב-`sovereign/zai-audit/2026-10-11.json` (deploy 1,024 SP).
- Blurt: לא שבור — `spamgate.mjs:120` operator-pause (R254) + צומת rpc.blurt.blog 403 מהסנדבוקס; נדרשת החלטת-הדלקה + צומת-גיבוי.
- חשיפה: ראה `sovereign/zai-audit/2026-10-11.json` §exposure — 4 ריפואים ציבוריים עדיין מדליפים פרמטרי-גריד/כתובות/סדר-יום (Domain/Console/FleetHQ/Sandbox).

## עדכון-ביצוע [zai-agent] · 2026-10-11 15:05Z (owner approval trace 1a12b258c9776305: "אישור להכל")

| פעולה | ריפו · קומיט | תוצאה |
|---|---|---|
| מיזוג תיקוני H1/H2/H3 ל-main | saos-dex `0514fca` | ✅ חי; BMC PASS |
| מסילת delegations בבלם + selftest | saos-dex `ea1bc0a` | ✅ vectors PASS |
| כלי-האצלה אידמפוטנטי + תוכנית 1,024 SP | saos-dex `ea1bc0a` | ✅ dry-run מול שרשרת: 13/13 דלתא |
| רגל-האצלות ב-twin + dispatch חי | Domain `c9d6e75` | ⚠️ **המכונה סירבה בכנות**: ה-`STEEM_ACTIVE_WIF` בכספת-Domain לא גוזר את רשות-ה-active החיה (מפתח-ישן). **צעד-owner יחיד שנותר: עדכון הסוד ב-Domain → re-dispatch** |
| Blurt — נסוגתי לטובת מימוש R294 (סוכן-מקביל, מחמיר: requiresArmFile) | steem | ✅ שיתוף-פעולה בלי דריסה; רשמתי את קובץ-החימוש `blurt-arm.json` (owner-word מתועד) · selftest 1265/1265 |
| לולאת-למידה שבועית ארגונית | Sandbox `22b902e` | ✅ live: 1,171 ריצות נדגמו · 525 instant-fail (חתימת-חיוב) · 4 הנחיות; רץ שני 05:17 UTC על דקות-ציבור |

**הלקח-המוסרי לכל-הסוכנים:** ה-refusal של ה-delegator לא היה כישלון — היה הצלחת-הבטיחות. המכונה חתמה אפס-חתימות על-ספק. זו הריבונות.

## עדכון-ביצוע [zai-9c] · 2026-10-11 (grid-liquidity lane)

| פעולה | ריפו · קומיט | תוצאה |
|---|---|---|
| אבחון 0-placed | saos-dex · ענף `fix/zai-grid-liquidity-20261011` | ✅ שורש נמדד: **לא STASIS, לא מלאי** — ה-WIF בכספת אינו גוזר את רשות-ה-active החיה (רוטציית-בעלים `last_owner_update 2026-10-08T17:29:09Z`; הצבה-חיה-אחרונה 10-07T17:46Z) → כל-שידור מאז נדחה "broadcast answered without id", והרץ פרסם **שקר** verdict=ARMED-STABLE · blocker=null (twin run 38144052862, job 114483601276: 12 ביטולים + 6 הצבות — כולם-כושלים, ובאותו-job ה-delegator סירב בכנות על-אותו-סוד). מדידה-נוספת: ladderIntact הושפל-מפקודות-זרות/זומבים שאינן במעקה → ריצות-מתוזמנות 10-08..10-11 לא ניסו לחתום בכלל. HIVE = מלאי-אפס-אמת (0.034 HIVE/0.003 HBD מול רצפת 0.2 HBD R99) — מתועד-במספרים |
| תיקון fail-safe | saos-dex `43f8908` | ✅ שער-מפתח לפני-כל-חתימה (grids/key-gate.mjs — אותו-משטר delegate-plan/hivemarket): WIF-ישן = אפס-שידורים + verdict ARMED-KEY-STALE כנה; כשלי-שידור נספרים-ומתפרסמים (אסור ARMED-STABLE עם-דחיות); זומבים מעקה↔שרשרת מתפרסמים; פרמטרים-חיים דרך validate-params (fail-closed → defaults-מדודים) |
| פרמטרים | saos-dex `72c6417` | ✅ `grids/param-proposal-2026-10-11.json` + שומר `grids/validate-params.mjs` (פסיקות fail-closed; selftest 20/20) — מתמטיקה-מתועדת: askStep 50→80bps מול-סחיפת-פאריטי נמדדת 44bps/4-ימים (מילויי-maker נמדדו -64/-83bps), bidStep 200→150bps (~שבועיים-של-סחיפה = עומק-בר-השגה; כל-מילוי-ביד ≥ +120bps עודף), commitPct 0.85 (רזרבה מול-סופת-ביטולים 6d6c169); מחובר ל-grid-beat |
| מסילת-נזילות | saos-dex `6e3ad6c` | ✅ `grids/liquidity-bootstrap.mjs` בדפוס-מסילת-ההאצלות: STASIS(lane=grid) → קובץ-חימוש-בעלים `grids/liquidity-arm.json` (חסר = סירוב-כנה exit 0 = הצלחה-על-פי-תכנון; לא נכתב-במכוון) → validate-params → שער-מפתח → דלתא-בלבד + קריאה-אחרי-כתיבה + קבלות; אידמפוטנטי; selftest 12/12; חובר ל-dex-grid.yml המקורי (רגל + קבלה) |
| אימות | saos-dex ענף | ✅ tsc נקי · BMC 8000-רצפים PASS B1..B9 · book-law 27/27 · arb 264/264 · peg/observe/brake(+3) PASS · params 20/20 · liquidity 12/12. שים-לב: `grids:run --selftest` כושל 2-וקטורים **גם-על main הנקי** (ed4195b) — קדם-קיים, לא-של-הענף |

**צעד-owner יחיד לחימוש-הגריד:** עדכון `STEEM_ACTIVE_WIF` בכספת-Domain למפתח-הגוזר את הרשות-החיה החיה של headcorner (`STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf`) → re-dispatch dex-grid. עד-אז כל-מסילות-החתימה על-הסוד-הזה נכשלות-בכנות (by design). מיזוג-הענף ל-main ממתין לאישור-בעלים/מנוע-כמקובל.
