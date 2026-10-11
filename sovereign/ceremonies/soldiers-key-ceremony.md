# טקס-מפתות-החיילים — soldiers-key-ceremony (מוכן-לביצוע, ממתין-לבעלים)

> **מזהה-סוכן:** [zai-11b] · נולד מתוך `sovereign/OWNER-GATE-PLAYBOOK-2026-10-11.md` §G3 · צו-בעלים trace `1a12c9d6f5df1b95`.
> **מצב:** `MACHINE-READY` — התבניות והרצף מוכנים; הביצוע נעול במילת-בעלים + מפתחות-ה-owner החיים (או ההצהרה-עליהם).
> **חוק-ברזל:** אף-חומר-מפתח לא עובר בצ'אט, בקומיט, בקובץ או בקבלה. הערוץ-המאובטח היחיד = **GitHub-Secrets שהבעלים מעדכן ישירות**. המכונה קוראת סוד-זמן-ריצה בלבד, לעולם לא מדפיסה, ומוחקת-בסיום.
> **מקור-הראיות:** `saos-dex docs/archive/SAOS_BREAKTHROUGH_PROOF.md §15.4` (רשימת-ה-9 + הדחייה `tx_missing_owner_auth`) · `steem@saos-cockpit mini-services/saos-engine/state/army-custody.json` (כנות-חיה 20:15:40Z) · מדידת-השער של 11-b (20:34Z, `get_accounts`).

---

## 1 · מצב נמדד (2026-10-11T20:34–20:35Z, api.steemit.com)

- **9-החשבונות הנעולים לרוטציה:** `cashmachine · haran · israelnews · lsa · macrame · siq · tov · wog · woq` (כולם `last_owner_update 2026-10-07T19:05:18–33Z` — גל-GEN-1).
- **השורש:** `account_update` = אופ-בעלות; נחתם אך-ורק-עם **מפתח-ה-owner הנוכחי**. ל-9 האלה חומר-ה-owner החי **אינו במשמורת-האחוזה** → כל-ניסיון-חתימה בחומר-active/posting נדחה `tx_missing_owner_auth`. הפתרון-הכנופי לא-קיים: אין-עקיפת-owner-על-השרשרת — וזה טוב.
- **מה כן עובד בלי-הטקס (כנות):** posting מאומת 14/14; **ACTIVE=GEN-1 מאומת לכל-ה-9** (army-custody 20:15Z) → עבודה-יומית (פוסטים/הצבעות/claims/transfers) של-ה-9 מתאפשרת-כבר-היום עם-החומר-שבכספת. הטקס נועל רק **שינוי-רשויות** (ובעקבותיו — השלמת-owner-מלאה).
- **הוכחת-המנגנון:** `wic` סובב בהצלחה (tx `9fd13d50…`) ו-headcorner 8/8-רשויות-GEN-2 — אותו-קוד-רוטציה שירוץ כאן.
- **מחוץ-לטווח (מתועד):** `hcsoldier1/2/3` = LOST-NO-CUSTODY (`Domain agents/fleet-roster.json` — bannedCapital; אין-להאציל/להחזיק-הון שם) · `ynet` = אין-חומר-מפתח בכלל (פרוש-ריבוני).
- **בעלות-פרסום-חיה של-החשבונות:** posting של-ה-9 הוא מפתח-פר-חשבון ייחודי (ללא-account_auths — נמדד: `cashmachine.posting.account_auths=[]`) → הסיפוק שלנו מלא; אין-רשות-חשבון-זרה שצריך-לשמר.

## 2 · טבלת-fill-in — להשלמת-הבעלים (בערוץ-הסודות בלבד, לא-כאן!)

| חשבון | owner-pubkey חי (ציבורי, נמדד 20:34Z) | מפתח-owner חי? (הבעלים ממלא-בסוד) | גורל מוצע |
|---|---|---|---|
| cashmachine | `STM7Rp6auWyWPWRVaafT5CCtoUrHXnYQHesebPnskH3HwyAu8nh8N` | כן/לא-יודע/מוזנח | רוטציה-GEN-2 או הכרזה |
| haran | `STM7LK2d2oHw1Bk63fqc…` | | |
| israelnews | `STM7t1VE72QDKW6e7xZD…` | | |
| lsa | `STM7M5QQmSXbEh3PxfTU…` | | |
| macrame | `STM6ebPT6RWvHXuzq56g…` | | |
| siq | `STM69NZih1wNYpMRSfbg…` | | |
| tov | `STM8FFj1oU3dHHGvJiE5…` | | |
| wog | `STM7RXg2o2PZk1tqospN…` | | |
| woq | `STM6jcx7BrzawVR5E1Ah…` | | |

(ה-pubkeys המלאים נמדדו-חי וקיימים-ברשומת-המדידה של 11-b; המכונה תקרא-אותם שוב מהשרשרת בזמן-הטקס — לא-מהטבלה.)

**הערוץ-המאובטח — ההגדרה המדויקת:**
1. הבעלים: GitHub → ריפו **steem** → Settings → Secrets and variables → Actions → **New repository secret**.
2. שם-הסוד: `STEEM_SOLDIERS_OWNER_ROTATION` · ערך: JSON אחד:
```json
{"protocol":"SAOS-SOLDIERS-ROTATION/1","ownerTrace":"<trace-המילה-שלך>","wifs":{"cashmachine":"<owner-WIF>","haran":"<owner-WIF>","woq":"<owner-WIF>"},"neglected":[]}
```
   (רק-החשבונות שרוצים-לסובב; שאר-לרשימת `neglected` — וזו-עצמה-ההכרזה-הכנה של החלטה-ב.)
3. המכונה: קוראת את הסוד **בזמן-ריצה בלבד** (dispatch-workflow שיוכן בהמשך), מפעילה-רוטציה פר-חשבון, מאמתת-מול-השרשרת, **ובסוף-הרצה ההנחיה-הקבועה: הבעלים מוחק-את-הסוד** (המכונה לא מוחקת-סודות — זכות-בעלים).

## 3 · תבניות-ה-`account_update` המדויקות שהמכונה תבצע

המבנה זהה-למבנה-הקיים-במנוע (`saos-dex/grids/community.mjs:257` — אותו-op, אותו-סריאלייזר מוכח). **לכל-חשבון נבנה op אחד** — רשויות-מלאות-חדשות נגזרות-GEN-2 (עץ-HMAC מהזרע-הריבוני, דפוס-SETTLE-10.3 שכבר-הוכיח את עצמו על headcorner+wic), **ונחתם עם מפתח-ה-owner החי הישן מהסוד** (השימוש-האחרון שלו):

```json
["account_update", {
  "account": "<ACCOUNT>",
  "owner":   {"weight_threshold":1, "account_auths":[], "key_auths":[["<GEN2_OWNER_PUB>", 1]]},
  "active":  {"weight_threshold":1, "account_auths":[], "key_auths":[["<GEN2_ACTIVE_PUB>", 1]]},
  "posting": {"weight_threshold":1, "account_auths":[], "key_auths":[["<GEN2_POSTING_PUB>", 1]]},
  "memo_key": "<GEN2_MEMO_PUB>",
  "json_metadata": ""
}]
```

- **כללי-שימור (fail-closed):** לפני-בניית-ה-op המכונה קוראת את רשויות-החשבון-החיות ומשמרת **כל-`account_auths` קיים** (מדידת-היום: ריקים — אבל-הקוד משמר-בכל-מקרה; לא-מניחים). אם-מתגלה account_auth זר — הטקס נעצר-כנה לאותו-חשבון (רישום, לא-שידור).
- **גזירה:** `GEN2_*_PUB = privToPub(HMAC(SAOS-ROT2, "<account>/<role>"))` מהזרע-הריבוני שהבעלים מחזיק (מהמחשב-האישי / הכספת-הפנימית — לא-דרך-הסוד-הזה; הזרע-כבר-קיים-מ-SETTLE-10 והמכונה-המקומית-גוזרת-ממנו).
- **חתימה:** רק `steem.auth.sign`/`signAndBroadcast` עם ה-owner-WIF-מהסוד; קבלה = txid+block+שחזור-רשויות-חי. אפס-הדפסת-חומר.
- **סריאליזציה-חלופית על-blurt:** לא-בטקס-זה (blurt-טקס נפרד, אם-יידרש — ראה G5.5).

## 4 · רצף-הביצוע (קנרית-ראשונה, אפס-הימור-מרובה)

1. **הבעלים** מגדיר-את-הסוד (§2) — ≈5 דקות.
2. **המכונה — קנרית:** רוטציה **לחשבון-אחד** (המומלץ: `woq` — השווי-הגדול-ביותר מהעובדים, 66.4 SP מואצל; או-החשבון-שהבעלים בוחר): verify-then-sign (קריאת-רשויות → בניית-op → חתימה-ב-owner-מהסוד → שידור) → קריאה-אחרי-כתיבה (הרשויות-החיות חייבות-להציג את ה-pubkeys-החדשים עד-4-ניסיונות-שונים) → קבלה-כנה.
3. **המכונה — עיקור:** בדיקה שהמפתח-הישן כבר-לא מאשר (get_key_references/ניסיון-חתימה-תקפה-מבנית-נדחית) → אישור-מוות.
4. **הבעלים** מאשר-את-הקנרית (קבלה-ציבורית) → **המכונה** מריצה את-שאר-הרשימה (אותו-קוד, חשבון-אחר-חשבון, דלתא-בלבד, עצירה-על-כל-כשל).
5. **אימות-סופי:** `army-custody` מורץ-מחדש → 14/14 posting + 13/13 ACTIVE=GEN-2 (וה-`neglected` מסומנים-בכנות) → הרשומה נדחפת-כקבלה.
6. **הבעלים מוחק-את-הסוד.** הטקס-נסגר-רישומית ב-COORDINATION.md (ע"י-המכונה).

**פקודות-אימות (אחרי-סיום):**
```bash
# רשויות-חיות של-חשבון (מצפה לראות GEN2 pubkeys):
curl -s https://api.steemit.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_accounts","params":[["woq"]],"id":1}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).result[0];console.log({owner:a.owner.key_auths,active:a.active.key_auths,posting:a.posting.key_auths,memo:a.memo_key,last_owner_update:a.last_owner_update})})'
# והרצת army-custody מחדש (השופט-הקיים):
node mini-services/saos-engine/army-custody.mjs  # או-העוטף-המקובל בבית-החי
```

## 5 · החלטה-ב — נתיב-"מוזנחים" (תקף, כנה, זול)

- הבעלים מעלה-סוד זהה-עם `wifs:{}` ו-`neglected:[...]` → המכונה רושמת-הכרזה (fleet-roster/ONE-ROSTER-הערה), מפסיקה-כל-ניסיון-רוטציה, וממשיכה-להשתמש-ב-GEN-1-active-המאומת-לעבודה-היומית.
- רוטציה-עתידית נשארת-אפשרית-בכל-עת אם-המפתחות-יתגלו (הטקס-זהה).

## 6 · כנויות וגבולות

- **Rollback:** רוטציית-רשויות היא-קדימה-בלבד (אין-שחזור-מפתח-ישן — וזו-המטרה). עצירה-באמצע = הסרת-הסוד → כל-רגל מסרבת fail-closed; החשבונות-שכבר-סובבו נשארים-ברשות-הבעלים-החדשה (בלתי-הפיכה-ורצוי).
- **סיכונים גלויים:** (1) הזרע-הריבוני חייב-להיות-מגובה-לפני-הטקס — אבדן-זרע אחרי-רוטציה = אובדן-משמורת-מחדש (הבעלים מאמת-גיבוי-לפני-שלב-2); (2) מפתחות-owner-ישנים בידי-צד-שלישי מסוכנים-רק-עד-הרוטציה — לכן-הקנרית-קודמת-לשאר; (3) הסוד נשאר-ב-GitHub-Secrets-לזמן-קצר (encrypted-at-rest; מחיקה-מיידית-אחרי-הטקס).
- **מה-המכונה-תכין-אחרי-המילה (בלבד):** workflow-dispatch-זמני dispatch-only-ללא-cron-בריפו-steem שקורא-את-הסוד ומריץ-את-הקוד-המוכח (רוטציה-SETTLE-10-מותאמת-פר-חשבון); קבלות-ציבוריות-hash-only.
- **קשר להוכחת-11-a:** אחרי-הטקס, כל-החומר-הישן של-ה-9 מקבל-פסק-DEAD ב-`sovereign/KEY-PROOF-LATEST.md` (מסילת 11-a — עשוי-שלא-להיות-קיים-ב-HEAD-עדיין; הטקס-הזה-אינו-תלוי-בו).

---
*נוצר על-ידי [zai-11b] · 2026-10-11 · מסמך-תכנון בלבד — אף-מפתח לא נוצר, לא נקרא ולא שודר.*
