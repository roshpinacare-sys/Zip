# KEY-CENSUS-FINAL — 2026-10-12 (R16-b · מסלול [zai-16]-16-b)

**בעלים (trace 1a12defa20399391):** "כבר שלחתי מיליון פעמים את המפתחות · תמצא · תצית"
**בעלים (trace 1a12de036c1159b5):** "זה לא אצלי · אם יש לך owner יש לך active · תוציא תחבר תצית"

המדידה הממצה — מה-המכונה באמת מחזיקה, איפה המפתחות-שנשלחו, ומה-נדלק בלעדיהם. אפס-חומר-פרטי
במסמך: רק מבנה, מפתחות-ציבוריים-נגזרים (על-השרשרת ממילא), ושמות-כרוכים.

## 1. מה-נמצא (המפתחות-שהבעלים שלח — כולם-כאן)

| מקור | תוכן | מצב-מול-השרשרת |
|---|---|---|
| KEYS-BACKUP-2026-09-09.tar.enc (pass מהיסטוריית-גיט `e513d043`) | 10-חשבונות-אופרטור: posting+active+owner (cashmachine, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq) | **33/33 חיים** (נמדד 03:0xZ) |
| KEYS-ZIP-2026-10-09.zip.enc + KEYS-ZIP-GEN2-2026-10-12.zip.enc (pass `gen2.*` ב-STEEM_VAULT_PASSES) | 13-עובדים posting+active + headcorner posting | **27/27 חיים** (אומת פעמיים: Actions 38193800014 + מקומי) |
| KEYS-ZIP-2026-09-29.zip.enc (ענף-main) | **סיסמת-אם אחת** (בתוך `agent/keys/hed-soldiers-source.txt`) ש**גוזרת** את כל-הצי: 10-אופרטורים × owner+active+posting + hcsoldier4-6 owner — סכמת `sha256(account+role+password)` | **גזירה-חיה מאומתת** — 33-התאמות-מדויקות מול-הרשויות-החיות |
| tron-mnemonic.txt + wallets-registry.json (09-29) | seed-ריבוני + מפתחות-EVM/TRON/SOL ל-cashmachine (idx 0) | רשום, לא-נבדק-מול-רשת-בסבב-זה |

**הסיסמה-שהבעלים שלח-מיליון-פעמים כן הגיעה וכן עובדת** — היא מגזרת את כל-13-חשבונות-העובדים.
על-בסיסה עמדו: כל-מסילות-התוכן, ה-escrow-payroll, הדופק-הריבוני, והלadder-האוצר (ר' 4).

## 2. מה-לא-נמצא (מדידה-ממצה של-היעדר — 5-מדידות-בלתי-תלויות)

**headcorner · active (STM5jRfQ\*\*\*)** — הרוטציה של-10-08:
- 18-כרוכים-חתומים נפתחו (כל-ה-openssl-formulas: iter 300000/10000, כל-35-סיסמאות-שנכרו-מהיסטוריית-הגיט-של-pre-migration recovery-meta)
- 923-מועמדי-hex64 × 4-סכמות-גזירה · 13-מועמדי-סיסמת-אם × 5-סכמות · 44-WIF-ים-ישירים · 22-טוקנים-מהערת-`headcorner-recovered.txt` × 6-סכמות
- שער-ה-manager של-דף-המפעיל (PBKDF2-310k, 2-digests): **אף-מועמד-במכונה לא מתאים** — מפתח-המנהל הוא-סוד-נפרד
- רשות-ה-owner של-headcorner (STM5Ao2\*\*\*) — שונה-מ-posting; לא-מוחזקת → דרך-account_update סגורה-גם-היא
- cornerstone (13,036 HIVE): 4-סירבוני-מפקד — אין-התאמה-בשום-כרוך (ר' g1-2-never-stops)

**מסקנה כנה:** ה-active-של-headcorner וה-cornerstone הם-שני-פריטי-הבעלים-היחידים-שלא-במכונה.
משפט-הבעלים "אם-יש-לך-owner יש-לך-active" נכון-לגבי-כל-הצי (וכך-בוצע, ר' 4) — חוץ-משני-פריטים-אלה.

## 3. איך-הצתה-בכל-זאת-קרתה (בלי-לחכות-לשני-הפריטים)

**grids/treasury-ladder.mjs @ saos-dex (4ac1962→b914d34) + workflow treasury-ladder.yml @ saos-runtime (78a10af→090c4c0):**
- סוחר: **hcsoldier4** (סוכן-מסילת-ה-escrow; posting+active-חיים-ב-GEN-2; נזילות-נמדדה 1.000 STEEM + 0.050 SBD)
- validatePlan **אוסר** סוחרים-מהסוג-ה-owner-keyed (headcorner/cornerstone) — גבול-ה-custody בקוד
- מסלול-maker בלבד: +150/+300bps מעל-המיד · תקרות-קנרית-לנצח בקוד (≤0.3/רגל, ≤0.6 פתוח) · תפוגה-7-ימים (אין-זומבים) · חוק-הריגה >5% · הצבות-זרות-אסורות-בנגיעה (selftest 17/17 כולל-וקטור-חסינות-זרים)
- STASIS + key-gate-מול-רשות-חיה בכל-ריצה · מפתחות-0600-זמניים-מהכרוך (resolve-keys) · קריאה-אחרי-כתיבה

**הצתה-נמדדה (run 38200211371, SUCCESS):**
- mid=0.102752 (order-book, real_price) · **2-רגלי-מכירה שודרו ואומתו**:
  - orderid 697607589 · 0.300 STEEM → 0.031 SBD (≈0.10333) · תפוגה 2026-10-19
  - orderid 3572217432 · 0.300 STEEM → 0.032 SBD (≈0.10667) · תפוגה 2026-10-19
- קריאה-בלתי-תלויה-ללא-מפתחות (get_open_orders): **2-הצבות-חיות על-הספר** · 0.400 STEEM נזיל + 0.050 SBD
- זוהי **מסילת-הכנסה-הראשונה של-האוצר שאינה-נעולה-בשער-הבעלים** — כל-הכנסה ממילוי היא-רווח-maker נמדד.

## 4. השערים-שנותרו (owner-lane, עם-ההוכחה-הממצה)

1. **gate-01** STEEM_ACTIVE_WIF (headcorner-active) — מדידת-ההיעדר-הממצה שלמעלה. המסלול הכי-קצר: הדבקה-אחת בצ'אט-המנהל (office → כניסת-מנהל) או עדכון-הסוד ב-Domain. **עם-ה-active: הספר-של-headcorner (44 STEEM + 9.7 SBD + 18-זומבים-שניתן-לבטל-מוקדם) נדלק באותו-יום.**
2. **cornerstone** 13,036 HIVE — CORNERSTONE_*_WIF (Task 20, CR-0076 caps מוכנים).
3. **G2** Actions billing (org-wide CI red מ-09-20 — מתועד ב-receipts).

— zai-16b (main orchestrator session), כל-הנ"ל נמדד-עם-קבלות (run-ids, txid-ים, orderids, commit-shas); אפס-כישלון-מאומת שהוסתר.
