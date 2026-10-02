# session-handoff — מסירת-סשן (harness · r151)

**Last Updated:** 2026-10-02T22:05Z · **Current Objective:** הכנסה-אמת-מעל-$0.01/יום · **Recommended Next Step:** `bash init.sh` ירוק → פתוח-אחד מ-progress.md → מדידה-וראיה.

> מטרה: כל סשן חדש עובד תוך דקות. עדכן בסוף-כל-סשן. אין סודות בקובץ זה.

## מצב-עתה (עודכן: 2026-10-02T22:05Z)

- **קומיט:** local==origin==b9216de (+ גל-r151 על-גביו). תמיד `git pull --rebase` לפני-עבודה — יש 2 סשנים-מקבילים + עוגנים-אוטומטיים.
- **צי-החיים (נמדד 22:00Z):** 3000 בית · 3038 fleet-verify · 3040 קיורציה (217 beats) · 3041 kpi-scribe · 3042 governance · 3043 treasury-audit · 3044 scout-market · 3045 business-engine (54 ticks) · 3046 מפעל-תוכן (12 ticks, 2 פוסטים).
- **הכנסה (כנה):** קיורציה = הנתיב-הראשי (4,285 SP על 6% משקל) · מפעל-תוכן: 22 הצבעות-חוץ + 1 תגובה + 0.006 SBD ביום-הוול · מיקרו-גריד: PnL ממומש −1.119 SBD — הודק r151, מדידת-השפעה בעוד ~7 ימים.

## חסמים (blockers)

- **WEAVE_PUBLIC_URL / D-TREASURY** — שערים-פתוחים שהוגדרו כהכרעות-מפעיל; אין להמציא-ערכים בשמו.
- **דלק (B-1):** fuel.totalFuel=0 — תביעות-העטיפה ממתינות-בשלות (17.983 WSTEEM נמדדו ב-GET /api/money); שורת-הרג: 2026-10-16.

## איך-להמשיך (next step ישר)

1. `bash init.sh` — עד-שהכל ירוק (tsc · eslint · צי-הפורטים · מפעל · קיורציה).
2. קרא progress.md (רשומה אחת אחרונה) + feature_list.json (active_feature + next_step של כל F).
3. בחר פתוח מהרשימה ב-progress.md או next_step חי-מ-feature_list.json.
4. בסיום: עדכן feature_list.json (ראיה!) → progress.md (רשומה-חדשה בראש) → קובץ זה → commit+push.

## קבצים-קריטיים (מפה-מהירה)

| מה | איפה |
|---|---|
| מצב-המפעל | sovereign/businesses/content-factory-state.json |
| מצב-הקיורציה | sovereign/curation/state.json |
| מצב-הכסף + PnL | sovereign/money/state.json · pnl-scan.json |
| רישום-העסקים | sovereign/businesses/registry.json · ONE-READ.md (למפעיל) |
| יומן-העבודה המלא | worklog.md (append בלבד) |
| סודות (מקומי) | upload/pat.env · upload/headcorner.txt — לעולם לא בגיט |
