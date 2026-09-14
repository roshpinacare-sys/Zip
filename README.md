# weave-core · THE WEAVE — רשת האימות הריבונית לסוכני AI

> הבית הריבוני של THE WEAVE. ריפו `Zip` הריק הוסב לבית הזה ב-2026-09-14
> (הוראת המפעיל: "הפוך, אל תמחק"). הריפו הוא האמת — הסנדבוקס הוא רק workspace.

## מה חי כאן

| נתיב | מה |
|---|---|
| `src/` | הפלטפורמה המלאה — קונסולת Next.js + API + ספריות הקריפטו (`src/lib/weave/`) |
| `sovereign/ledger.json` | **הספר** — snapshot קנוני חסר-סודות של כל האימותים, checkpoints, סוכנים ושערים |
| `sovereign/weave-seal.enc` | ה-seal — מפתח הענן + מפתח הרשת (AES-256-GCM; ריפו פרטי) |
| `sovereign/anchor-baseline.leaves.json` | חומר ההוכחה של גזירת העוגנים — 90 קבצי הארכיון ⇒ שורש מרקל בספר |
| `sovereign/beat-report.json` | הדוח של הפעימה האחרונה (מקומית או ענן) |
| `.github/workflows/weave-heart.yml` | **הלב הענן** — כל 6 שעות GitHub מריץ את הרשת בעצמו |
| `SOVEREIGNTY.md` | מפת הריבונות: מה נגזר, מה חסר, מה העוגנים נותנים |
| `scripts/` | weave-beat (הפעימה) · weave-seal · anchor-baseline · sovereign-milestones · compile-anchor |

## איך הרשת חיה בלי אף אחד

```
bun scripts/weave-beat.ts --local   # פעימת ה-runner הראשי: verify → attest → checkpoint → push
                                     # (בענן: אותו סקריפט בדיוק, מ-weave-heart.yml)
```

שיפוט בריאות: השרשרת עצמה — טריות האימות האחרון + הדחיפה האחרונה.
סנדבוקס מת? הענן מזהה וממשיך לבד (TAKEOVER). שער-סודות חוסם כל דחיפה של מפתח.

## הרמה מ-clone נקי (SOV-3)

```bash
git clone <this-repo> && cd weave-core
bun install
bunx prisma generate && bunx prisma db push   # SQLite מקומי
cp .env.example .env                           # DATABASE_URL
bun scripts/weave-beat.ts --no-push            # ייבוא הספר + אימות מלא מחדש
bun run dev                                    # הקונסולה חיה
```

## חוקי הבית

1. **שום טענה בלי מדידה** — ראיה ריקה ⇒ UNMEASURED, לעולם לא VERIFIED.
2. **הספר הוא הספר** — `ledger.json` בגיט הוא האמת; SQLite הוא מטמון.
3. **מפתחות לא בגיט** — רק בתוך ה-seal (ריפו פרטי) או על מכונת הסוכן.
4. **כל דחיפה עוברת שער-סודות** — דפוס מפתח ב-diff ⇒ חסימה מוחלטת.
5. **תווית אמת מוצהרת תמיד** — REAL / LOCAL / NOT-YET.

*חלק מה-SAOS Ecosystem · org-בפועל: חשבון roshpinacare-sys · הצי חי ב-steem/weave (cloud-heart)*
