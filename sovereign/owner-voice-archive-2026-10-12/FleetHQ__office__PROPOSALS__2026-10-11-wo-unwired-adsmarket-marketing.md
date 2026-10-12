# הצעה: חבר את ערן-השיווק החי (private-1) למשטח-חי — fact-sheet/pitch/kits EN-HE נגישים מ-Domain

- **מזהה**: `WO-unwired-adsmarket-marketing` · **מחלקת-סיכון**: MACHINE-PREP (הכנה-מכונה) · **דבר-בעלים**: לא
- **מקור**: work-orders.json (Sandbox raw) · **ערך/מאמץ**: 7/2
- **נוצר**: 2026-10-11 23:56 UTC על-ידי office/retro.mjs (office-retro (zai-11d · E1-deed zai-13c)) · SAOS-OFFICE-RETRO/1

## הקשר נמדד (מה-חקר)

- אוטובוס: 15 green · 0 amber · 0 red · 1 grey — מקור-רישום: fallback-embedded (registry לא-נגיש: HTTP 404 (private-7 פרטי — גם עם-token נדחה) — משתמש ב-snapshot מוטמע (…)
  - console-mirror-status: grey — private-raw — ה-token בסביבה אינו-מוסמך לריפו זה (לא-ידוע, כנה)
- מחקר (2026-10-11): E1✅ E2✅ E3✅
- שערים: GATE-STATUS לא-נגיש (HTTP 404) — מצבי-השערים לא-ידועים כעת (מקור-פרטי; כנה, לא-מדומה)
- דיג'סט: חי מ-2026-10-11 23:54 UTC

## תוכנית (צעדים)

1. המכונה מכינה את הארטיפקטים (מסמך/בדיקות/רשימת-צעדים) — לא מבצעת שינוי-מצב.
2. הביצוע עצמו ממתין להכרעת-בעלים או למחזור הבא עם built-in מאושר.
3. עדכון ה-BACKLOG במחזור הבא עם תוצאת-ההכנה.

## פקודות-אימות (חסרות-סודות)

```bash
node office/retro.mjs --selftest          # חוקי-המחזור ירוקים
node office/retro.mjs --verify-bus        # בריאות-האוטובוס בשידור-חי
node office/retro.mjs                     # מחזור מלא — תיק-עבודות מחדש
```

## Rollback

- קבצי-המסילה (BACKLOG/RETRO-LATEST/retro-state) נכתבים additive לכל-מחזור — שחזור = ריצה חוזרת או `git revert` על קבלת-המחזור.
- אין-שינוי-מצב חוץ-מסילתי כלל — אין מה להחזיר מחוץ ל-office/.

---
*מחזור-השיפור-העצמי של המשרד · trace 1a12c9d6f5df1b95 — חקר/זיקוק/תכנון/ביצוע · נוצר אוטומטית, כנה בכל-שדה.*
