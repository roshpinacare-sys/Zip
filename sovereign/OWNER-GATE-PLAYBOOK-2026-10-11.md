# OWNER-GATE-PLAYBOOK-2026-10-11 — מדריך-השערים החי של הבעלים

> **מזהה-סוכן:** [zai-11b] (owner-gate-playbook) · **צו-בעלים:** trace `1a12c9d6f5df1b95` — "פתרון-ריבוני למה-שנותר-לבעלים · הכל-משתמש-בהכל · חקר→זיקוק→תכנון→ביצוע · שלא-יפגע-בפעילות-הכללית".
> **חוק-המספרים:** כל-מספר כאן נמדד חי ב-**2026-10-11T20:30–20:36Z** או מצוטט מקובץ-קיים עם-נתיב. אסור מספר-בלי-מקור. מה שלא-ניתן-לאימות נשאר "לא-ידוע" בכנות.
> **זהו מסמך-תכנון (זיקוק+תכנון בלבד):** אף-שער לא הורם, אף-שידור לא בוצע, אף-כספת/מפתח לא נגעו במשימה זו. קריאה-בלבד (RPC+API+git).

---

## 0 · איך-לקרוא את המדריך (לבעלים)

כל-שער = מקטע אחד, מבנה קבוע:

| שדה | משמעות |
|---|---|
| **מצב נמדד** | מה קורה עכשיו, עם-חותמת-זמן ופקודת-אימות |
| **נתיב-ריבוני** | הפתרון המוכן מראש — מה המכונה כבר בנתה |
| **צעדי-הבעלים** | הרשימה המדויקת הממוספרת — דקות, לא שעות |
| **מה-זה-משחרר** | התוצאות הצפויות, כולל-מה **לא** משתחרר (כנות) |
| **עלות/תועלת** | דקות-בעלים מול ערך |
| **Rollback** | איך חוזרים לאחור בבטחה |
| **פקודת-אימות** | הפקודה שמוכיחה שהשער נפתח (המכונה תריץ חלק מהן אוטומטית) |

**מצבים:** `WAITING-OWNER` (ממתין לבעלים) · `MACHINE-READY` (המכונה השלימה את חלקה; נותר צעד-בעלים אחד) · `DISSOLVED` (השער התמוסס — עובד בלי-פעולה) · `INCIDENT` (תקלה-חיה).

**שלושת ההמלצות החדות** (הזמנת-עבודה לפי תשואה-לדקת-בעלים): §G1 (מפתח-הכספת) ← §G2 (חיוב-Actions) ← §G4 (סיסמאות-הכספת). כל-השאר יכול לחכות לשבוע.

---

## G1 · `STEEM_ACTIVE_WIF` בכספת-Domain — מסילת-החתימה של המכונה

**מצב:** `WAITING-OWNER` (השער היחיד שחוסם כל-חתימה-מכונה של headcorner)

**מצב נמדד (2026-10-11T20:34Z, head_block 110,356,376, api.steemit.com):**
- רשות-ה-active החיה של @headcorner: `STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf` (רוטציה `last_owner_update 2026-10-08T17:29:09`).
- הבעלים **כבר סוחר את הגריד ישירות עם GEN-2**: חלון 505-אופים 19:55→20:24Z = 242 הצבות + 247 ביטולים; 25 פקודות פתוחות עכשיו (18 bids נעולים 30.450 STEEM + 7 asks נעולים 92.531 SBD); פקודה חדשה נוצרה ב-20:34:24.
- ה-WIF שבכספת-Domain אינו גוזר את הרשות החיה → **כל-חתימת-מכונה נדחית** (נמדד: twin run 38144052862 job 114483601276 — 12 ביטולים + 6 הצבות "broadcast answered without id"; ה-delegator סירב באותו-job).
- **זה לא כשל — זו ריבונות.** עד-שהסוד יעודכן, כל-מסילת-חתימה על הסוד הזה נכשלת fail-closed **מתוכנן** (grids/key-gate.mjs — שער-רשות-חי לפני-כל-חתימה, מרוטציית 9-c).

**השער שמאמת (קובץ קיים, מוזג ל-main @ f7f5db6):** `saos-dex/grids/key-gate.mjs` — `activeAuthorityOk({account, wif, rpc})`: גוזר את ה-pubkey מה-WIF (`wifToPublicSafe`), קורא את רשות-ה-active החיה (`condenser_api.get_accounts`), משווה; אי-התאמה = `ok:false, reason:"…stale key… owner action: update the vault secret"`, **אפס-ניסיונות-שידור**. ה-WIF עצמו לעולם לא נרשם ללוג. אותו-שער מותקן ב-grid-beat (STEEM), ב-delegate-plan, וב-liquidity-bootstrap.

**צעדי-הבעלים (≈3 דקות):**
1. GitHub → ריפו **Domain** → Settings → Secrets and variables → Actions.
2. עדכון הסוד `STEEM_ACTIVE_WIF` — להדביק את ה-WIF הפרטי ש**גוזר** את `STM5jRfQ…NSXDQf` (מפתח-GEN-2, האותו-חומר שהבעלים כבר משתמש-בו ישירות לגריד; להיזהר מרווחים/שורה-חדשה בהדבקה).
3. Re-dispatch: Actions → **dex-grid** → Run workflow (או שהמכונה תעשה זאת — פקודת-ה-dispatch מוכנה ב-API: `POST /repos/roshpinacare-sys/Domain/actions/workflows/dex-grid.yml/dispatches`).
4. (ראו הערת-הסדר ב-G5.4 — לפני re-dispatch של ההאצלות: החלטת-תוכנית.)

**אימות אוטומטי שהמכונה תריץ (מיד אחרי-העדכון):** grid-beat מפעיל `activeAuthorityOk` **לפני** כל-חתימה; ה-verdict הציבורי יעבור `ARMED-KEY-STALE` → `ARMED-STABLE` רק-עם-הצבות אמיתיות שנספרות. אימות-ידני עצמאי:
```bash
# מקומית, בלי-לחשוף-את-ה-WIF (ההשוואה על pubkeys בלבד):
node -e 'import("steem").then(s=>{const pub=s.default.auth.wifToPublic(process.env.STEEM_ACTIVE_WIF);console.log(pub==="STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf"?"KEY-MATCH":"KEY-MISMATCH")})'
# או: פשוט להריץ dex-grid twin ולקרוא את verdict החדש ב-db/grid-public.json
```

**מה-זה-משחרר:** (1) twin-הגריד ב-Domain חוזר להציב/לבטל (כרגע הבעלים לבדו); (2) ה-delegator (re-dispatch לפי G5.4); (3) `grids/liquidity-bootstrap.mjs` (מסילת-העומק — arm-file `grids/liquidity-arm.json` נכתב-על-ידי-בעלים + שער-מפתח); (4) כל-מסילת-חתימה עתידית שמשתמשת בסוד הזה.
**מה-לא-משתחרר:** חיילים (להם יש מפתחות-GEN-1 חיים משלהם בכספת — עובד כבר, ראו G3), פוסטים/הצבעות (posting-authority נפרד, מאומת 14/14).

**עלות/תועלת:** 3 דקות-בעלים ← מחזיר את מסילת-החתימה-האוטונומית של-המכונה כולה (השער-המרכזי של-המשטר). **Rollback:** הסוד הישן נשאר במקום עד-אימות; אם אחרי-העדכון מופיע `ARMED-KEY-STALE` — ההדבקה שגויה; להחזיר את הערך-הקודם באותו-מסך (עד-1 דקה; אפס-נזק — המכונה רק מסרבת).

---

## G2 · חיוב-Actions — 15 ריפואים פרטיים אדומים

**מצב:** `WAITING-OWNER`

**מצב נמדד (GitHub API, 2026-10-11T20:30–20:33Z, sample last-100-runs/ריפו):**

| ריפו | ריצות-כושלות מאז 09-20 | ריצה-אחרונה | תפקיד |
|---|---|---|---|
| saos-dex | 100/100 | 10-11T20:14Z | מנוע-הדקס (משקף-ציבורי קיים — למטה) |
| Zip | 100/100 | 10-09T18:13Z | מצב-ריבוני (משקף-ציבורי קיים) |
| saos-sovereign-foundry | 90/100 | 10-07T00:57Z | קונסולה v1 |
| steem | 97/100 | 10-11T20:22Z | מנוע-הצי (משקף-ציבורי קיים) |
| Defi | 71/100 | 10-06T11:50Z | קאנון+קבלות |
| Saosmartwallet | 24/40 | 10-11T19:29Z | מוצר-ארנק |
| saos-jummper | 21/41 | 10-06T11:22Z | נוטריון-הצלבה |
| saos-control-center | 21/37 | 10-11T19:29Z | מראת-משרד |
| Adsmarket | 18/38 | 10-06T11:25Z | שיווק |
| Sdk | 18/38 | 10-06T11:24Z | ארכיון-אימות |
| roshpina | 19/39 | 10-06T11:26Z | קרנל-דמו |
| anchor-baseline | 19/39 | 10-11T19:29Z | קונפורמציה |
| Project-files | 9/25 | 10-06T11:29Z | ארכיון |
| saos-sovereign-platform | 9/100 | 10-06T11:28Z | קונסולה v2 |
| sanbox | 7/7 | 10-11T19:00Z | מפקדה-מקומית |

- חתימת-חומת-החיוב נמדדה מחדש: ריצות-כישלון של **3–5 שניות, 0-שלבים, לוגים-ריקים** (דגימות: Zip [5,4,4,5,3,4], saos-dex [3,3,3,3,3,3]…). הציבוריים חיים וירוקים (Sandbox/Console/Domain/lighthouse/beacon/TruthRail/saos-agents/FleetHQ/saos-runtime).
- מפתה-עדכון על-הנחת-הסבבים-הקודמים: **כל-ה-workflows בריפואים-הפרטיים הם היום dispatch-only** (0 מפעילי-cron בכל-ה-15, נמדד-חי; הסרת-ה-cron בוצעה 10-06 11:52Z "sovereign-ci"). **הרמת-החיוב משחזרת את היכולת-לרוץ — לא את ההקפדה-האוטומטית.** ההקפדה חוזרת דרך fleet-heal.

**מה קורה אוטומטית אחרי-ההרמה:** `Sandbox/heal/fleet-heal.mjs` (cron `5,35 * * * *`, קובץ קיים) סורק את הריפואים, מאבחן `MINUTES-BLOCKED` (כישלון ≤120ש בפרטי) מול אדום-אמתי, ומצית כל-ריפו-אדום **לכל-היותר פעם/24h** (PROBE_TTL) עם קנרית `sanbox` → הריפוי מתגלה מעצמו תוך ≤24h לכל-הריפואים. קבלות: `heal/latest.json` ("green:0 blocked:15 healed:0" — ההבטחה ממתינה לטריגר מאז 10-09).

**מפת-קריטיות — מה באמת רץ שם (האם יש תאום-ציבורי?):**
- **כבר יש להם תאומים-ציבוריים חיים (העבודה-הכספית/המצבית נמשכת גם-היום):**
  - `steem` (מנוע-21-הפאזות) → **saos-runtime** (ציבורי; 286 ריצות; משכפל `steem:saos-cockpit` ומריץ ci-cycle; ריצה-אחרונה 10-11T20:23Z).
  - `saos-dex` (dex-grid/dex-beat) → **Domain dex-grid twin** (ציבורי; cron `26 3 * * *` + dispatch; שער-STASIS) + dex-beat מוצת מ-Console.
  - `Zip` (weave-anchor/heart/ecosystem) → **Domain weave-anchor-lines** + **Console weave-heart** (ציבוריים; הקומיטים של weave-anchor[bot] נמשכים, cp#1584 10-11T07:37Z).
- **נשארים private-only אחרי-ההרמה (QA/ראיות — אין-כסף שם):** gitleaks-על-push (כל-ה-15), selftests (foundry-tests, platform-selftest, jumpper-tests 673-וקטורים, conformance-selftest 35/35, control-center-build, wallet-verify, claims-guard, sdk-verify, archive-keeper, canary, controls-audit, baseline-integrity), מראת-המשרד (SovereignConsole office-mirror). `vault-home`: 0-workflows — אין-מה-להחיות (המכונות שלו מקומיות).
- mission-critical יחיד מבחינת-מנגנון-הכספות: **אין** — כל-מסילות-החתימה/הכספת רצות ב-Domain/Console/Sandbox/saos-runtime (ציבוריים-חיים) או מקומית (vault-home). הפרטיים-האדומים = ראיות/QA/ביקורת-שרשרת-אספקה.

**צעדי-הבעלים (≈5 דקות):** GitHub → (ימין-עליון, תמונת-פרופיל) → **Settings → Billing and plans → Plans & usage** → שדרוג תוכנית או רכישת-דקות (GitHub Free מעניק 500 דק'/חודש לפרטי; המסלולים בתשלום מעניקים 3,000+). **לא ניתן-לאימות-API איזו-תוכנית מופעלת כיום** (שדה `plan` לא-מוחזר לטוקן הקיים — לא-ידוע בכנות; המסך מציג).
- הערכת-צריכה (מסומנת כהערכה): עם-triggers-dispatch-only, הצריכה השוטפת = פרובות-fleet-heal (≤15 dispatch/יום × ~2–4 דק') + dispatch-ידניים ≈ **30–60 דק'/יום בשיא-הריפוי, ואז-שקט** (אחרי-החלמה הפרובות נפסקות). רק החזרת-cron תצרוך-במאות/חודש — וזו-החלטה-נפרדת-ומודעת (המלצה: לא-להחזיר-cron-המוני; להסתפק-ב-fleet-heal + התאומים-הציבוריים).

**עלות/תועלת:** 5 דקות + (אופציונלי) מחיר-מסלול ← 15 ריפואים חוזרים להיות-מוכחים-ירוקים (gitleaks/selftests/ראיות), וההבטחה העומדת של fleet-heal ממומשת. **Rollback:** חזרה-לתוכנית-החינמית תחסום שוב ריצות-פרטיות — ללא-נזק-מצטבר (הריצות-פשוט-חוזרות לחתימת-3-5ש).

---

## G3 · סבבת-מפתות R11 / 9-החיילים `tx_missing_owner_auth`

**מצב:** `WAITING-OWNER` (עם-ארטיפקט-מוכן — טקס-הטקס בנוי)

- **הוכחת-המתים:** ראה `sovereign/KEY-PROOF-LATEST.md` (**מסילת 11-a** — ייתכן שעדיין לא קיים ב-HEAD כשקוראים את זה; המסילה בונה אותו במקביל: חילוץ-hash → גזירת-pubkey → `get_key_references` + רשויות-חיות של-14-חשבונות → פסק DEAD/ALIVE לכל-חומר-שדלף-בהיסטוריה-הציבורית של roshpina/anchor-baseline/saos-jummper/Sdk/Adsmarket).
- **רוטציית-ראש כבר בוצעה:** @headcorner נסובב ל-GEN-2 ב-10-08T17:29Z (8/8-רשויות חדשות; SAOS_BREAKTHROUGH_PROOF.md §15.3: "המפתחות-הדלופים: מתים-על-השרשרת"). הסיכון-הציבורי-ההיסטורי = החומר-בהיסטוריה של 5-הריפואים; הפסק המכונה = הוכחת-DEAD שבועית (11-a), לא-עוד-רוטציה-של-ריפואים.

**9-החיילים — הרשימה המדויקת** (SAOS_BREAKTHROUGH_PROOF.md §15.4; אומת-חי 20:34Z, `condenser_api.get_accounts`):

`cashmachine · haran · israelnews · lsa · macrame · siq · tov · wog · woq`

- למה בדיוק `tx_missing_owner_auth`: `account_update` הוא **אופ-בעלות** — נחתם אך-ורק-עם **מפתח-ה-owner הנוכחי** של-החשבון (threshold 1, `key_auths` יחיד). ל-9 האלה **חומר-מפתח-ה-owner החי לא נמצא-אי-פעם במשמורת-האחוזה** (הוחלף אחרי-איטום-הכספת / אבד-עם-זרע-v1). המכונה ניסתה לסובב עם-חומר-active/posting שבידה → השרשרת דחתה `tx_missing_owner_auth`. כנות-מלאה נרשמה — אף-זיוף.
- **מה כן עובד (נמדד-חי 20:15–20:34Z, `army-custody.json` + RPC):** כל-14 החשבונות מאומתים posting; **ה-9 מאומתים גם ACTIVE=GEN-1** (המפתח-החי בכספת תואם את הרשות-החיה) → המכונה יכולה לחתום-עבורם כל-אופ-active רגיל (פוסטים, הצבעות, transfers, claims) היום. hcsoldier4/5/6 מאומתים אף ACTIVE=GEN-2. wic סובב בהצלחה (tx `9fd13d50…`) — הוכחת-המנגנון. ynet: אין-חומר-מפתח-בכלל (operator-delegated, פרוש-מתועד).
- לכן ה-9 **לא חוסמים פעילות-יומיומית** — הם חוסמים רק: שינוי-רשויות (רוטציה-מכונה) והחזקת-owner-מלאה. שווי-ההאצלות שעליהם כרגע: workers 5×75 + micros 30+30+10.7+66.4 = 487.1 SP מה-603.3 הפרוסים (ראו G5.4).

**מה על הבעלים להוציא (שתי-החלטות, לא-עבודה):**
- **החלטה-א:** לספק את מפתחות-ה-owner החיים של-ה-9 (מהערוץ-המקורי שממנו-נולדו) → המכונה משלימה רוטציה-GEN-2-מלאה לכולם במנגנון SETTLE-10 שכבר-הוכח על headcorner+wic.
- **החלטה-ב:** להכריז "מוזנחים" → המכונה מפסיקה-לנסות רוטציה; החשבונות ממשיכים-לעבוד כעובדי-GEN-1-active (המצב-הנוכחי, מתועד-כנה); רוטציה-עתידית אפשרית-תמיד כשהמפתחות-יתגלו.
- בכל-מקרה: **אסור חומר-מפתח בצ'אט/בריפו.** הערוץ-המאובטח המוגדר: הבעלים מעדכן **GitHub-Secrets ישירות** (כמו-G1) — המכונה קוראת-סוד-זמן-ריצה בלבד, מבצעת, ומוחקת-אחר-אימות.

**ארטיפקט-מוכן:** `sovereign/ceremonies/soldiers-key-ceremony.md` — טבלת-fill-in ל-9 החשבונות + תבניות-ה-`account_update` JSON המדויקות שהמכונה **תבצע** ברגע-שהבעלים מספק-מפתחות-דרך-הסוד (או-חותם-בעצמו). ראו-שם את הרצף המלא.

**עלות/תועלת:** החלטה-א ≈ 10 דקות-בעלים (העלאת-סוד-אחד) ← רוטציה-מלאה-ואוטומטית של-9 חשבונות + סגירת-סיכון-R11-הפנימי. החלטה-ב ≈ 1 דקה ← כנות-מתועדת, סיכון-ללא-שינוי (מצב-נוכחי-מאובטח-כבר-יחסית: GEN-1 חי-ולא-שדלף-כידוע). **Rollback:** רוטציה-היא-חד-כיוונית-לטובה; אם-רוצים-לעצור-באמצע — הסרת-הסוד עוצרת-את-הטקס (fail-closed, כמו-תמיד).

---

## G4 · vault-home `recovery-meta.json` — סיסמאות בטקסט-גלוי

**מצב:** `MACHINE-READY` (טקס-ההגירה מוכן; צעד-בעלים אחד)

- **נמדד (20:36Z, HEAD של vault-home ושל steem@saos-cockpit):** `vault-chain/recovery-meta.json` (vault-home) ו-`agent/recovery-meta.json` (steem) — שתי-העותקים נושאים `keysZipPass` + `keysBackupPass` **בגלוי** (אורך 32 כ"א; הערכים עצמם לא-נקראו/לא-הודפסו-במשימה-זו). vault-home הוא **pin-copy** של הקובץ-ב-steem (`sovereign/bootstrap.sh:123-124`).
- **למה לא צונזר:** קוראים-חיים תלויים-בשדות: `saos-runtime/scripts/vault-drip.mjs`, `Sandbox/boot/bootstrap.sh`, `steem/scripts/sovereign-restore.sh` + `sovereign-selfcustody.mjs` + `hive.mjs` (custody), `vault-home/sovereign/{bootstrap,verify}.sh`. צנזור-ידני עכשיו = שבירת-מנגנון-ההחייאה-בעוד-הוא-רץ.
- **לא נגענו ב-vault-home** (חוק-המשימה; הריפו-חי).

**הפתרון-המוכן:** `sovereign/ceremonies/vault-home-recovery-meta-migration.md` — טקס-הגירה-מלא: (1) הבעלים מעלה-פעם-אחת סוד `RECOVERY_META_JSON` (תוכן-ה-meta המלב-המוצפן-ללא-הצורך-בקובץ); (2) ענף-קוד קטן (דוגמת-ה-diff **בתוך-המסמך**, לא-דחוף): קורא-קודם-סוד, נופל-לקובץ-אם-חסר (fallback כנה); (3) הוכחת-שקילות-selftest; (4) מיזוג; (5) **קומיט-צנזור-חד-פעמי ב-HEAD בלבד** (הדפוס-המוכח של 9-b: Domain@32f/Console@8f); (6) rollback.
- **כנות-מתועדת:** ההיסטוריה נשארת (כמו-ב-32f/8f). כתיבה-מחדש של-היסטוריה **קיימת-ככלי אך אסורה-בחוק** (אין-force-push; COORDINATION-כלל-3) — הצנזור יהיה HEAD-only והמסמך אומר-זאת בגלוי. הסיסמאות עוברות-לסוד; ההיסטוריה-הישנה נותרת-מתועדת-כסיכון-מוכר (ריפואים-פרטיים; סבבת-R11-כוללת-אותן).

**עלות/תועלת:** 5 דקות-בעלים (העלאת-סוד-אחד) + מכונה-מבצעת-את-השאר ← אפס-גלוי-ב-HEAD בשני-הבתים, בלי-לשבור-קורא-אחד. **Rollback:** ה-fallback-לקובץ שומר-על-תאימות-מלאה; היפוך = מחיקת-הסוד → הקוד חוזר-לקרוא-מהקובץ (הצנזור-ב-HEAD-נשאר-כתוב-אבל-הסוד משוחזר-ממנו-בעת-הצורך).

---

## G5 · מסילות-STASIS — אחת-אחת, המלצה-מדודה

**מצב-הבלם (grids/state/STASIS.json, נמדד 20:31Z):** `mode=staged`, פתוחים `grid`, `claims`, `delegations` (delegations נפתחה 10-11T14:20Z). עצורות: `convert`, `agent-swap-api`, `transfers`, `votes`.

### G5.1 · convert — המלצה: **DEPRECATE** (סגירת-המסילה)
- **נמדד-חי 20:34Z:** `sbd_print_rate=0`, `sbd_interest_rate=0`, `total_reward_fund_steem="0.000 STEEM"`, `total_reward_shares2="0"` (dgp). המרת SBD→STEEM בשער-הרשמי מחזירה בדיוק-את-ערך-הקלט ואפס-ריבית על-ההחזקה — **המסילה מתה-כלכלית** (לא-תקולה: מדיניות-השרשרת). convert-plan.json אחרון = CONVERT-HOLD 10-04.
- **ההמלצה:** לא-להרים-לעולם. סגירה = הצהרת-בעלים אחת; המכונה (אחרי-מילה) תסמן את המסילה deprecated ב-STASIS.json (`history` append — לא-מחיקה; חוק-resumePolicy) ותפסיק-לחשב-תוכניות-convert. חיסכון: פשטות-מנגנון + אפס-בלבול-עתידי. עלות-אפס (אין-הכנסה-שנמדדה-ממנה-מעולם-בחלון-כלשהו).

### G5.2 · transfers — מתי-נפתחות (מדיניות-משיכה-מהגריד)
- **נמדד:** נזיל צי 20.85 STEEM + 10.43 SBD; נעול-בגריד 30.450 STEEM + 92.531 SBD (20:35Z); הכנסה-נמדדת-ראשונה +0.295 SBD/43-דק (10-d 19:47Z). טבלת-הניתוב הפנימית כבר-ב-ECONOMIC-PLAN §4: "הון-רותח חוזר-לספר, הון-קר נשאר-SP".
- **ההמלצה — מדרגת-פתיחה מוחשית:**
  1. **transfers-פנימיות (headcorner→עובדי-הצי)** — נפתחות אוטומטית-מתוקשבת כאשר **הכנסת-הגריד הנמדדת ≥ 5 SBD/שבוע ב-2-חלונות-שבועיים-רצופים** (המכשיר-המודד כבר-קיים: Sandbox research-lane E1, cron שבועי, LEDGER.md). עד-אז: סגור — כל-הנזיל הוא-דלק-גריד (ask-side) לפי-פרמטרי-9-c.
  2. **תקרת-משיכה-ריבונית:** כאשר SBD-נזיל של-headcorner > 100 SBD (מעל-צורך-העוגן-הפנימי) — המכונה רשאית להציע-משיכה, **ביצוע רק במילת-בעלים פר-העברה** (אף-העברה-חוץ-לא-אוטונומית-לעולם).
  3. **engine-transfers (SWAP.BLURT bridge)** — נשאר סגור: מלאי-Blurt שלנו ≈ 0.083 BLURT (probe 20:15Z); אין-הון לנתב.
- מה דרוש-מכנית: מילת-בעלים ב-COORDINATION.md + `stagedLanes.allow += "transfers"` ב-STASIS.json (עריכה-עצמה = מילת-בעלים; ערכי-הסף יישמרו-ב-arm-file-חדש `grids/transfers-arm.json` בדפוס-liquidity-arm — יוכן-על-ידי-המכונה אחרי-המילה).

### G5.3 · votes — הצעת-מדיניות-הצבעה-מובנית (כולל-כלכלה כנה)
- **נמדד:** 0 אופי-curation_reward בחלון-505-האופים (19:55–20:24Z) וגם-לא-בחלון-43-הדק של-10-d; VP headcorner **50.47%** (5047, 20:34Z) — יושבת-בטלה; קורציה-חיים-מצטברת 90.0 SP על-7.7-שנים (~0.07%/שנה); 5-הפוסטים-האחרונים של-הצי pending **0.000–0.004 SBD** (2–3 הצבעות-לפוסט); **הבעלים כבר מצביע ידנית** (5-הצבעות 20:15–20:16Z: משקלים 2500–5834, חוץ+פנים: rebe.torres12/lifetrail/casino-insider/hcsoldier5/woq).
- **כלכלה כנה (חוק-אין-מספרים-ממציאים):** אוצר-התגמולים **ריק** (total_reward_fund_steem=0; דפוס-הקורציה ההיסטורי מת על-השרשרת-הנוכחית — מצא-10-d). התקרה-הפרופורציונלית (ECONOMIC-PLAN §3, חץ-3): נתח-משקל-הצי 0.00176% מ-~23.3M STEEM-שקול/שנה-בצינור-7-הימים → **תקרה ~102 STEEM/שנה (~10.4 SBD/שנה)**. תשואה-מציאותית-נכונה-להצבעות-פנימיות-על-פוסטי-הצי: **≤0.02 SBD/שבוע** — כלומר הערך האמיתי אינו ה-SBD אלא **המולטיפלייר המבני**: trail-הצי על-אותם-פוסטים מגדיל-את-הרשימה-שנראית-ב-feed-חוץ (מנגנון-R290 של 7-a), וה-SP-עצמו כבר-מייצר-דלק-RC.
- **הצעת-המדיניות (ניסוי-מבוקר 14-יום, כולל-עצמי-כנה):**
  1. **טווח:** headcorner מצביע-על **פוסטי-הצי קודם** (blog של-12-החשבונות, 0.000–0.004 SBD-כיום) + עד-30% מהקצבה-היומית על-תוכן-חוץ-איכותי מהפיד (TOPICS הקיימים ב-curate.mjs).
  2. **קצב:** ≤10 הצבעות/יום; משקל 2–5% (2500–5000 — הטווח-שהבעלים כבר משתמש-בו ידנית); **אפס-הצבעה-עצמית ל-headcorner על-פוסטיו-שלו** (דוקטרינת-curate.mjs הקיימת); הצבעות-פנימיות על-פוסטי-העובדים = הלב-של-הניסוי (הפצה, לא-רווח).
  3. **רצפות:** VP-floor 80% (אם-מתחת — דילוג-יום); RC-floor 40%.
  4. **מדידה:** research-lane E-חדש (E4-curation) מודד שבועית: אופי-curation_reward + pending-פוסטים-פנימיים; סף-הצלחה = עלייה-נמדדת-בהפצה (votes-לפוסט 2–3 → ≥8), לא-ה-SBD.
  5. **תשואה-צפויה לכתיבה-כנה:** ~0.00–0.02 SBD/שבוע מקורציה; הערך = מולטיפלייר-הפצה. אין-הצדקה-כלכלית-ישירה — יש-הצדקה-מבנית.
- **קובץ-החימוש שהמנוע יצפה:** בדפוס-הקיים (`grids/liquidity-arm.json`, `state/blurt-arm.json`): **`grids/votes-arm.json`** (חדש; SAOS-VOTES-ARM/1: sealedAt+trace-owner+dailyCap+weightBand+vpFloor). שימו-לב-בכנות: **נכון-ל-20:31Z אין-עדיין צרכן-קוד לקובץ הזה** — יצירתו (curate.mjs יקרא-אותו; נכתב-על-ידי-הבעלים בלבד) היא-משימת-מכונה-אחרי-המילה, במסילת-STASIS: `stagedLanes.allow += "votes"` + STEEM_POSTING_WIF בסביבת-הריצה (הביצוע-עצמו posting-authority בלבד).

### G5.4 · delegations — **DISSOLVED** (דוגמת-הראייה ש-מילת-בעלים → זרימה)
- **נמדד-חי 20:35Z:** 14-יעדים, 972,758 vests = **603.3 SP** (workers 75×5; siq/tov/wic 30; wog 10.7; woq 66.4; חיילים 17×3; hive-177702 10) — שונתה-היום **על-ידי-הבעלים-עצמו עם-GEN-2**. השער-התמוסס: לא-המכונה הצליחה — **הבעלים עשה זאת ישירות**, וזו-הוכחת-האפשר. STASIS: מסילת-delegations נפתחה מכנית 10-11T14:20Z (רשומת-היסטוריה ב-STASIS.json).
- **אזהרת-סדר לפני re-dispatch-מכונה:** `grids/state/delegation-plan.json` (חתום-14:20Z) מגדיר **סכומים-אבסולוטיים שונים** (1,024 SP: posters 150, micros 50, חיילים 8). ריצת-מכונה-כפי-שהוא-עכשיו **תשנה את מבנה-הבעלים החי**: תעלה posters 75→150, תוריד woq 66.4→50 וחיילים 17→8. **לפני** כל-re-dispatch: הבעלים בוחר — (א) re-seal התוכנית ל-תמונת-603.3-החיה (המכונה תבצע דלתא=0 — אפס-אופים; מומלץ), או (ב) לאשר-את-ה-1024 (המכונה תממש). עד-אז: לא-להצית-את רגל-ה-delegator ב-twin.
- ערך-הדוגמה לשערים-הנותרים: כשמילת-בעלים + מפתח-חי מתחברים — הזרימה-קורית-בדקות. G1 הוא-בדיוק-השער-שנותר.

### G5.5 · blurt — רשימת-הצתה (והחלטות A/B/C)
- **עדכון-חי שמתקן-הנחות-קודמות:** ה-pause של-R254 **כבר אינו המצב** — R294 (פקודת-בעלים 10-11 "החשבונות blurt לא מחוברים… צריך לטפל בזה") פתח-את-blurt כניסוי-המחמיר-ביותר; `state/blurt-arm.json` **קיים-וחמוש** (`armed:true, mode:staged-trial`, נכתב-לפי-הטקס-המכוון); `CHAIN_POLICY.blurt` = `allowed:true, requiresArmFile:true` (spamgate.mjs, origin/saos-cockpit 4e6245bf).
- **צמתים (נמדד):** `blurt-probe.json` @20:15:40Z = **BLURT-PROBE-OK** דרך `blurt-rpc.saboin.com` (skew-0); מכאן (סביבה-זו) כל-4-הצמתים כושלים (saboin ETIMEDOUT / blurt.blog HTML-error / world NXDOMAIN / latam ECONNRESET) — **הגישה תלוית-רשת**; המסדר-הנכון (saboin ראשון) כבר-מוגדר ב-`BLURT_NODES` ב-blurt.mjs. מ-Actions-ענן: blurt.blog = 403/429 (נמדד 9-d) → הענן-זקוק-ל-saboin.
- **רשימת-הצתה (סדר-מחייב, כל-שלב fail-closed):**
  1. **צומת-גיבוי/קונפיג:** `BLURT_NODES=["https://blurt-rpc.saboin.com","https://rpc.blurt.blog"]` — כבר-מוגדר ב-blurt.mjs (לא-דורש-ערך-חדש; אם-רוצים-צומת-שלישי — החלטה-מכונה-עתידית).
  2. **custody-judge:** `blurt-custody-judge.mjs` מאמת WIF-פוסטינג של-הרוסטר-מול-הרשויות-החיות על-blurt (probe מדד: headcorner/cashmachine/haran postingKeySet=true). אם-השופט-ירוק — המשך; אם-לא — זהו-בדיוק-"החשבונות-לא-מחוברים" שהבעלים-הזכיר → טקס-מפתחות-blurt (דומה-G3, ערוץ-סודות-זהה).
  3. **BLURT-SIGNER:** הסריאלייזר הכללי (`blurt-ser.mjs`) מכסה-היום `account_update` בלבד → משימת-מכונה: להרחיב ל-comment/vote (אופים-2) לפני-השידור-הראשון.
  4. **שידור-ראשון:** ניסוי-המחמיר-ביותר — 1-פוסט/יום, ≥1800-תווים, self-sim ≤0.20, תגובות ≥300-תווים (gates-חתומים-ב-arm-file).
- **החלטות:** **א=להצית** (להשלים-custody+ser ולשדר-ניסוי) — המלצה-אם-המטרה-היא-נוכחות-מרובת-רשתות; **ב=להחזיק** (arm-חמוש, רק-probe-שבועי) עד-סיום-R11/GEN-2-ב-blurt-גם-כן — בטוח; **ג=להוציא-מכלל-שימוש** (פרישה-ריבונית של-רוסטר-blurt) — חוסך-משטר-שלם. המלצת-המכונה: **ב-עכשיו, א-אחרי-שה-custody-judge-ירוק** (ה-custody-הוא-השער-האמיתי; הצמתים-כבר-לא).

---

## G6 · החלטות-מוצר פתוחות (A/B)

### G6.1 · Saosmartwallet — מסד-הכספת שנעשה-git
- **נמדד:** `db/custom.db` = 4,046,848-בייט ב-HEAD (248-VaultEntry AES-GCM כולל-owner/active של-headcorner; מקור-הזרע "upload/הדקור.txt"; 165-GateSessions; 5-d/5-c). ריפו פרטי. הריפו-עצמו: עיצוב-מלא, רנטיים-מעולם-לא.
- **א:** **הוצאה-מגרסה** (המומלץ): קומיט-אחד שמפסיק-tracking + מוחק-מ-HEAD (דפוס-9-b), הכספת-הריבונית נשארת-vault-home (הקאנון), והמסד מוגדר-כארטיפקט-עיצוב. בתוך-סבבת-R11 (אחרי-רוטציות) — כמו-32f/8f. עלות-בעלים: מילה-אחת; המכונה מבצעת.
- **ב:** להשאיר-כמו-שהוא-ולהכריז את הריפו-כארכיון-עיצוב-כולל-ה-DB. עלות-אפס, אך "המפתחות-לעולם-לא-עוזבים-את-הלקוח" נשאר-כוזב-בארכיטקטורה והמסד-המצפין-מתארח-ב-git — ניגוד-דוקטרינה מתמשך.
- **המלצה: א** (מיד אחרי-סבבת-G1/G3, כדי-שה-DB-לא-יהיה נתיב-השחזור-היחיד-אם-משהו-מתבלגן-ברוטציות).

### G6.2 · saos-agents — npm vs GitHub-Packages vs Release-only
- **נמדד:** קוד-אמיתי (2,005-Loc + selftest 98/98, 10-c), **אפס-ייבוא בכל-האחוזה** (ריצות-vendored-זהות בתוך-steem), Release v0.1.0 קיים (asset-406106235), npm-E403×3 (fine-grained-PAT על-User-חשבון = לא-אפשרי-לפי-PUBLISH.md-שלו).
- **א:** לפרסם (GitHub-Packages — לא-דורש-חשבון-npm; טוקן write:packages) — שדרוג-מפיץ-אמיתי, אך-מוסיף-משטר-אספקה שאין-לו-צרכן-אמיתי-היום.
- **ב (המומלץ): להישאר-Release-only** עד-לקוח-חוץ-ראשון: הרוסטר-vendored-הוא-הצרכן-בפועל; פרסום-היום = תחזוקה-ללא-ביקוש. טריגר-להערכה-מחדש: ייבוא-חוץ-ראשון או-ריצות-vendored-מתחילות-לסטות-מהמקור.
- **המלצה: ב** — זה-גם-היחיד שלא-מוסיף-שטח-אספקה.

---

## 7 · טבלת-סיכום — סדר-הפעלה לפי תשואה-לדקת-בעלים

| # | שער | מצב | דקות-בעלים | מה-נפתח | Rollback |
|---|---|---|---|---|---|
| 1 | G1 STEEM_ACTIVE_WIF | WAITING-OWNER | ~3 | כל-חתימת-המכונה (twin/delegator/liquidity) | החזרת-סוד-ישן |
| 2 | G2 חיוב-Actions | WAITING-OWNER | ~5 | 15-ריפואים חוזרים-להיות-מוכחים (fleet-heal ≤24h) | חזרה-לתוכנית-חינם |
| 3 | G4 recovery-meta | MACHINE-READY | ~5 | אפס-גלוי-ב-HEAD ×2 בתים | מחיקת-סוד→fallback-קובץ |
| 4 | G3 9-חיילים | WAITING-OWNER | ~10 (א) / ~1 (ב) | רוטציה-מלאה או-כנות-מתועדת | הסרת-סוד=עצירה-כנה |
| 5 | G5.4 delegations re-seal | MACHINE-READY | ~1 | תוכנית-מכונה מיושרת-לחיה (או-1024 מאושר) | STASIS-רשום-בהיסטוריה |
| 6 | G5.5 blurt ב | WAITING-OWNER | ~1 | probe-שבועי-בלבד, אף-שידור | — |
| 7 | G5.1 convert | WAITING-OWNER (מילה) | ~1 | מסילה-מתה נסגרת-רישומית | — |
| 8 | G6.1/G6.2 | WAITING-OWNER | ~1×2 | דוקטרינה-מיושרת | — |
| 9 | G5.2/G5.3 transfers/votes | WAITING-OWNER (מילות-מדיניות) | ~2×2 | פתיחה-מדורגת-מתוקשבת | STASIS-חוזר-בהיסטוריה |

**סה"כ דקות-בעלים לפתיחת-הלב הכלכלי (1+2):** ≈8 דקות.

---

## נספח-א · פקודות-אימות (רץ-עצמאי, ללא-סודות)

```bash
# 1. רשות-ה-active החיה של headcorner (צריכה להיות STM5jRfQ…NSXDQf):
curl -s https://api.steemit.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_accounts","params":[["headcorner"]],"id":1}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result[0].active.key_auths[0][0]))'

# 2. מוות-כלכלי של-convert (print/interest=0, אוצר-ריק):
curl -s https://api.steemit.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_dynamic_global_properties","params":[],"id":1}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;console.log({print:r.sbd_print_rate,interest:r.sbd_interest_rate,fund:r.total_reward_fund_steem})})'

# 3. האצלות-חיות (14-יעדים, 603.3-SP עם 1612.4-vests/SP):
curl -s https://api.steemit.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_vesting_delegations","params":["headcorner","",100],"id":1}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;console.log(r.length,"targets",r.reduce((a,x)=>a+parseFloat(x.vesting_shares),0),"vests")})'

# 4. חומת-החיוב (ריצות-פרטיות-כושלות 3–5ש):
#    GitHub API (עם-ה-PAT-מהכספת, ללא-הדפסת-טוקן):
#    GET /repos/roshpinacare-sys/<repo>/actions/runs?per_page=100 → conclusion=failure → duration<10s

# 5. מצב-הבלם:
cat saos-dex/grids/state/STASIS.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.mode, JSON.stringify(j.stagedLanes.allow))})'

# 6. צמתי-blurt (מהסביבה-שבה-הם-נגישים; מ-Actions-ענן צפה-403/429 מ-blurt.blog):
curl -s https://blurt-rpc.saboin.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_dynamic_global_properties","params":[],"id":1}'
```

## נספח-ב · מקורות-ראשיים

- RPC-חי: `econ11b/rpc-measure*.json`, `econ11b/blurt-probe.json`, `econ11b/gh-repos.json`, `econ11b/gh-workflows.json` (מוניטור-משימה 11-b; timestamps-פנימיים 20:30–20:36Z 2026-10-11).
- שער-המפתח: `saos-dex/grids/key-gate.mjs` (merge f7f5db6) · הבלם: `saos-dex/grids/state/STASIS.json` · תוכנית-האצלות: `saos-dex/grids/state/delegation-plan.json`.
- כנות-כספות-חיה: `steem@saos-cockpit mini-services/saos-engine/state/army-custody.json` (20:15:40Z) · `state/blurt-arm.json` · `state/blurt-probe.json`.
- חיילים: `saos-dex docs/archive/SAOS_BREAKTHROUGH_PROOF.md §15.4` · `Domain agents/fleet-roster.json` (bannedCapital: hcsoldier1/2/3 LOST-NO-CUSTODY) · טקס: `Zip sovereign/ceremonies/soldiers-key-ceremony.md`.
- vault-home: `vault-chain/recovery-meta.json` + `steem agent/recovery-meta.json` · קוראים-חיים: `saos-runtime/scripts/vault-drip.mjs` ועוד (רשימה ב-G4) · טקס: `Zip sovereign/ceremonies/vault-home-recovery-meta-migration.md`.
- חיוב: `Sandbox heal/fleet-heal.mjs` (PROBE_TTL 24h, CANARY sanbox) + קבלות `heal/latest.json` · עמדת-הטאומים: worklog 5-b/9-c/10-x.
- תוכניות-קיימות: `sovereign/ECONOMIC-PLAN-2026-10-11.md` §3–4 · `sovereign/ONE-ROSTER-2026-10-11.md` · `sovereign/EXPANSION-PLAN-2026-10-11.md`.
- הוכחת-מפתחות-שבועית: `sovereign/KEY-PROOF-LATEST.md` (מסילת 11-a — עשוי-שלא-להיות-ב-HEAD-עדיין).

---
*נוצר על-ידי [zai-11b] · 2026-10-11 · קריאה-בלבד — אף-שער לא הורם בביצוע-מסמך זה.*
