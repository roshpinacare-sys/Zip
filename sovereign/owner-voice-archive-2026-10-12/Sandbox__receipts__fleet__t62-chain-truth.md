# T-62 (2-a) — אמת-שרשרת: פוסטים / הצבעות / טיוטות (trace 1a1268338e36d0ed)

**מדד חי**: 2026-10-10 16:00 UTC · ראש-השרשרת: בלוק 110,322,223 (2026-10-10T15:59:57)
**שיטה**: RPC ציבורי בלבד — `https://api.steemit.com` (condenser_api / database_api), אפס-מפתחות, אפס-אמון.
**חלון-48h**: מ-2026-10-08T15:59:57 · **חשבונות-נבדקו**: 14 חיים + `ln` (לא-קיים בשרשרת).

---

## פסק-דין לכל טענה של המפעיל

### 1. "אני רואה אפס פוסטים" — **שקר (נמדד: 12 פוסטים ב-48h)**
| חשבון | פוסטים 48h | פוסטים |
|---|---|---|
| israelnews | 2 | 10-10 14:34 · 10-10 13:17 |
| lsa | 2 | 10-10 14:34 · 10-10 13:27 |
| headcorner | 2 | 10-10 12:53 · 10-09 12:03 |
| cashmachine | 1 | 10-09 15:47 |
| macrame | 1 | 10-10 13:47 |
| tov/wic/wog/woq | 4 | 10-08 16:25 / 17:13 / 17:53 / 18:14 |
| hcsoldier4/5/6, siq, haran | 0 | — |

**כל הפוסטים לחיצים** (למפעיל — דפדפן רגיל):
- https://steemit.com/@israelnews/streamlining-your-blockchain-content-wor-20261010-0b3a0ece
- https://steemit.com/@israelnews/fix-it-before-you-bin-it-the-repair-guid-20261010-27a2f1f2
- https://steemit.com/@lsa/understanding-blockchain-curation-reward-20261010-0ecdbe2a
- https://steemit.com/@lsa/one-month-fewer-screens-what-it-did-to-m-20261010-46b660f2
- https://steemit.com/@headcorner/the-drawer-of-words-that-refuse-to-migra-20261010-06de604b
- https://steemit.com/@headcorner/the-drawer-audit-counting-what-the-tools-actually-earned-20261009-0
- https://steemit.com/@cashmachine/the-drawer-audit-counting-what-the-tools-actually-earned-20261009-0
- https://steemit.com/@macrame/walking-is-how-i-think-on-routes-loops-a-20261010-61d1b951
- https://steemit.com/@tov/the-one-message-rule-a-small-habit-that-fixed-my-worst-trait-20261008-
- https://steemit.com/@wic/words-that-refuse-to-move-notes-on-the-language-that-stays-h-20261008-
- https://steemit.com/@wog/one-month-fewer-screens-what-it-did-to-my-attention-and-my-b-20261008-
- https://steemit.com/@woq/the-drawer-audit-counting-what-the-tools-actually-earned-20261008-0

ממשקים-חלופיים (נמדד עכשיו): `steemitwallet.com/@acct` = **200 תמיד** (גם ל-curl) · `steemdb.io/@acct` = 200 · `steemit.com` = **403 ל-curl/בוט** אך **200 בדפדפן אמיתי** (הפוסט עצמו בשרשרת ונקרא גם דרך RPC). **שורש-ה"אני-לא-רואה": חסימת-בוטים של הפרונטנד ל-curl — לא היעדר-פוסטים.**

### 2. "אין פעילות grid" — **שקר (נמדד: 1,099 פעולות ב-48h)**
`get_account_history(-1,100)` לכל חשבון, מסונן לחלון-48h: **688 הצבעות + 354 תגובות + 57 custom_json**.
| חשבון | הצבעות | תגובות | custom_json | סה"כ |
|---|---|---|---|---|
| israelnews | 62 | 39 | 0 | 101 |
| lsa | 62 | 37 | 0 | 101 |
| hcsoldier4 | 7 | 2 | 0 | 9 |
| hcsoldier5 | 6 | 3 | 0 | 9 |
| hcsoldier6 | 6 | 2 | 0 | 8 |
| headcorner | 14 | 24 | 50 | 88 |
| cashmachine | 50 | 42 | 7 | 99 |
| haran | 68 | 31 | 0 | 99 |
| macrame | 73 | 28 | 0 | 101 |
| siq | 62 | 28 | 0 | 90 |
| tov | 68 | 33 | 0 | 101 |
| wic | 69 | 28 | 0 | 97 |
| wog | 70 | 29 | 0 | 99 |
| woq | 71 | 28 | 0 | 99 |

*הערת-מדידה: המונה הוא "הפעולות בחלון-48h מתוך 100-הפעולות-האחרונות"; אצל חשבונות-פעילים החלון מכסה פחות מ-48h (אצל headcorner רק ~5 שעות) — המספרים הם-רצפה, לא-תקרה.*

### 3. בעיית-התשואה האמיתית — **אומתה חי: הצבעות-אפס**
- **19/19 הצבעות hcsoldier4/5/6 = rshares 0** (משקל-עסקה 25%). שלוש-הוכחות-בלתי-תלויות: `active_votes` בכל פוסט צי · `database_api.list_votes` (אובייקט-הצבעה קיים עם rshares=0) · `get_account_votes` **ריק לחלוטין** לשלושתם.
- **כלכלת-החיילים**: 0 VESTS עצמיים + 4,838.364331 VESTS שהתקבלו (~3 SP) מהאצלת headcorner (פעילה מ-2026-10-07T19:00:45). ההצבעה שלהם לא נחשבת בשרשרת בכלל.
- **9 self-votes של headcorner = אפס-אפקט**: 8 פעולות (13:11–13:16, משקל 25%) על הפוסט-שלו-עצמו + 1 (משקל 4%) על פוסט-10-09 — ב-`list_votes` **אין שום אובייקט-הצבעה** של headcorner על שני-הפוסטים-שלו; הוא לא-מופיע ב-active_votes שלהם. ההצבעות-נרשמו-בהיסטוריה אבל-לא-הזיזו-שקל.
- **לעומת-זאת ההצבעות-האמיתיות חיות**: headcorner→פוסט-israelnews = **25.8 מיליארד rshares**; חשבונות-הצי-הראשיים 138M–537M rshares. 89 הצבעות-צי-שנמדדו על פוסטים-שלנו — 89 עם rshares-חיובי-אמיתי.

**מסקנת-תשואה**: ה-3-חיילים וה-self-votes של headcorner מייצרים "רעש-פעילות" עם **תשואת-אפס מוחלטת** — 28 פעולות-הצבעה ב-48h שלא-שוות-כלום. הכוונה-הכלכלית צריכה-להתמקד ב-headcorner (הצבעה 25.8 Grs = כוח-אמיתי) ולהפסיק-לשווא-לספור את-החיילים.

### 4. טיוטות-LLM — **נמדדו: 15 queued, 1 published**
- התור-חי ב-`~/fleet/steem/mini-services/saos-engine/state/content-ops.json` (machine-local, לא-ב-Git).
- **15 טיוטות בסטטוס `drafted`** — ללא-חשבון-משויך-מראש: המנוע בוחר-מוציא-לפועל (1 מתוך 11 קולות: headcorner/cashmachine/haran/israelnews/lsa/macrame/siq/tov/wic/wog/woq) בזמן-הפרסום.
- **1 `published`**: "The Drawer of Words That Refuse to Migrate" → headcorner, permlink `...06de604b`, **מאומת בשרשרת** (נוצר 12:53:54, txid 34ec44f0e0ae...).
- verdict אחרון: `DRAFTS-QUEUED` (14:55:17Z), bridgeError=null. התור-חי-ומוזן; החסם-הוא-לא-התור.

### 5. חשבון `ln` — **לא-קיים בשרשרת** (`get_accounts → []`) למרות-הפניות-אליו בקוד-המנוע.

---

## שורה-תחתונה למפעיל
1. **הצי מפרסם ומצביע** — 12 פוסטים ו-1,099 פעולות ב-48h, הכל-מאומת מול-שרשרת-חיה.
2. **מה שאתה לא-רואה זו חסימת-בוט** של steemit.com ל-curl (403) — בדפדפן-רגיל הכל-נפתח, וגם `steemitwallet.com` פתוח-תמיד.
3. **הדליפה האמיתית**: 28 הצבעות-רפאים (19 חיילים + 9 self-votes) עם תשואת-אפס — הגריד "עובד" חלקית-בהלות.
4. **15 טיוטות מחכות** בתור — פוטנציאל-פרסום מיידי ל-11 הקולות.

קבלה-מכונה: `receipts/fleet/t62-chain-truth.json` · אפס-סודות-נעו · אפס-דריסות (קבצים-חדשים-בלבד).
