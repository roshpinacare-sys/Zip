# מפת תפקידי הצי — קאנון אחד לכל תפקיד (26 ריפואריים, אפס ארכיון)

**מקור:** הנחיית בעלים trace `1a12c57bccbf89bd` — "כל התיקיות צריכות להיות בשימוש קבוע שימושי... אם יש כפילויות זיופים הפרעות יש לטפל בהן ולהתאים". פסק-דין D1 של ביקורת 2026-10-11 מתוקן: לא קיפאון — **שחרור + תפקיד**.

**מצב חי נמדד 2026-10-11T19:10Z (API):** 26/26 פעילים, 0 ארכובים. ההשתקות ההיסטוריות (Sdk, Project-files, anchor-baseline, Defi, roshpina, saos-sovereign-platform, SovereignConsole, FleetHQ, saos-sovereign-foundry) שוחררו כולן לפני 19:10.

## הקאנון — תפקיד אחד לכל ריפו

| ריפו | נראות | תפקיד קאנון | מצב חי 19:10Z |
|---|---|---|---|
| **FleetHQ** | public | **המשרד** — חדר-מבצעים חי (agent-hq), ממשל, תיאום | נדחף 19:06 |
| **Domain** | public | **הוויטרינה** — המשרד ראשון + דופק רשת חי (Pages) | נדחף 18:57 |
| **TruthRail** | public | **ערוץ הקבלות** — אימות keyless, אפס סודות | נדחף 16:33 |
| **saos-runtime** | public | **מארח הריצה** — heartbeat + revival rails | נדחף 18:56; heartbeat ירוק 18:46 |
| **Sandbox** | public | מעבדת אינטגרציה ציבורית | 116 commits/24h |
| **Console** | public | קונסולה ציבורית + מראת פרסום | 46/24h |
| **saos-agents** | public | ליבת תזמור הסוכנים (canon 5-e) | נדחף 16:26 |
| **sovereign-beacon** | public | אספן עדכונים חוץ-מכונה | נדחף 16:26:49 |
| **sovereign-lighthouse** | public | תצוגת המגדלור (Pages) | נדחף 16:26:47 |
| **steem** | private | שריון-מטמון custody + מערכת הסוכן על השרשרת (branch of record: saos-cockpit) | נדחף 18:52 |
| **vault-home** | private | כספת המפתחות החתומה — קאנון סודות | נדחף 16:26 |
| **Zip** | private | אריזות מפתחות מוצפנות (KEYS-ZIP) | נדחף 19:06 |
| **saos-dex** | private | **הבורסה** — ספר-הזמנות, AMM, D-023 convert, מושל T2 | נדחף 16:30 |
| **roshpina** | private | **פלטפורמת הערך** — מנוע עמלות ורווח (economic canon) | רגועה מ-10-08 → תור החייאה |
| **Saosmartwallet** | private | ארנק הבעלים (owner-only 🔴) | נדחף 16:26 |
| **saos-control-center** | private | כניסת מפתח חכם + בקרה | נדחף 13:18 |
| **saos-jummper** | private | נוטריון הוכחות חוצה-שרשרת (Ethereum anchor) | רגועה מ-10-08 → תור החייאה |
| **saos-sovereign-foundry** | private | **חי** (פסיקת בעלים) — עיגון חוצה-רשתות, אנרגיה | נדחף 15:43 |
| **Adsmarket** | private | קיט השיווק — מזין תוכן ל-Domain | D-ROT ממתין |
| **SovereignConsole** | private | מראת-ענן DR של הקונסולה | רגועה מ-10-10 → מדיניות סנכרון |
| **saos-sovereign-platform** | private | עותק קאנוני עומד (DR snapshot) | רגועה מ-10-08 |
| **Sdk** | private | SDK הסוכנים — ממשקי הצי | רגועה מ-10-08 → תור החייאה |
| **Project-files** | private | מצבור קבצי עבודה והעלאות | רגועה מ-10-08 |
| **anchor-baseline** | private | בסיס-ייחוס קפוא לשחזור (baseline 5356dab) | רגועה מ-10-07 |
| **Defi** | private | מעבדת מחקר DeFi | רגועה מ-10-08 |
| **Sandbox/sandbox-private** | pair | N4→D2 נפתר T-63 (שינוי-שם בוצע) | 5fb059a2 |

## כפילויות ודרכי טיפול (תיקון, לא בריחה)

1. **Sandbox ↔ sandbox-private** (טיפוס כפול) — ✅ **נפתר T-63 (N4→D2)**: הריבונות ביצעה את שינוי-השם `sanbox → sandbox-private` בכתב-הרשאה של הבעלים (״הריבונות מחליטה״, trace 1a12d4ae2964f45d) — redirect 301 אומת, קבלה ב-README של הריפו, צומת הגרף עודכן. נותר: עדכון-תיעוד רדום בקבצים היסטוריים (הפניות GitHub מכסות).
2. **Console ↔ SovereignConsole**: Console = ציבורית קאנון; SovereignConsole = מראת DR פרטית. **מדיניות:** סנכרון שבועי אחד-way Console→SovereignConsole (משימת lane), ואז אפס סתירה.
3. **saos-sovereign-platform ↔ saos-sovereign-foundry**: platform = עותק DR עומד; foundry = חי (פסיקת בעלים). **מדיניות:** foundry המקור; platform מסונכרן ידנית בכל אבן-דרך.
4. **vault-home ↔ Zip**: vault-home = כספת הקאנון; Zip = חבילות הפצה מוצפנות. שניהם חיים ומוצדקים (הפרדת סוד/פצה).
5. **Defi ↔ saos-dex**: Defi = מחקר; saos-dex = ייצור. **כלל:** קוד שעובר בדיקות עובר מ-Defi ל-saos-dex; Defi אף פעם לא מסחר אמיתי.
6. **Domain ↔ Adsmarket**: Domain = ויטרינה חיה (Pages); Adsmarket = מחסן תוכן פרטי. **כלל:** Adsmarket מזין, Domain מציג — תוכן נמדד (freshness gate).

## זרימת ערך וצמיחה כלכלית (תכנון חי)

- **מנוע רווח ראשי:** saos-dex (T2 מושל + D-023 convert). מצב: EDGE-NEGATIVE-GRID-HOLD (lifetime −2.30%). עדכון-שער D3 מוצע: מדגם ≥20 fills, hysteresis resume 1.2% מול hold 1.0%, mirror-חסר → HOLD fail-closed.
- **מפתח ההתנעה:** D-023 ממתין escrow ≥1 SBD — זו ההשקעה הבאה עם התשואה המוגדרת ביותר (edge נמדד +40.8% על מסילת ה-convert).
- **מנוע עמלות:** roshpina (fee engine) — החייאה הכלכלית הבאה בתור.
- **ערוץ תוכן:** R67-C (2 פוסטים/יום) על steem — ערך רשת שוטף, שערי T3 אוכפים איכות.
- **שיווק:** Domain office-first + דופק חי (מבוצע 2026-10-11) — הראייה החיה היא המוצר השיווקי.
- **תור מחקר וגילוי:** (א) הגנת push-protection על סודות בכל הציבוריים; (ב) watchdog freshness ל-Domain; (ג) נוטריון saos-jummper לעיגון קבלות TruthRail על Ethereum; (ד) SDK ממשק אחיד לסוכנים חדשים.

כל ריפו עם "תור החייאה" חייב שיא lane ב-write-log.jsonl לפני עבודה — לא לתקוע שני סוכנים את אותו ריפו.
