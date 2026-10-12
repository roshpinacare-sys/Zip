# תיק-העבודות של המשרד (BACKLOG)

> מחזור-השיפור-העצמי · office/retro.mjs · SAOS-OFFICE-RETRO/1 · 2026-10-11 23:56 UTC · trace 1a12c9d6f5df1b95 — חקר/זיקוק/תכנון/ביצוע

## סיכום נמדד

- **אוטובוס**: 15 green · 0 amber · 0 red · 1 grey (רישום: fallback-embedded)
- **שערי-בעלים**: לא-ידוע (מקור-השערים פרטי/לא-נגיש — כנה)
- **מחקר**: הממצאים מ-2026-10-11 — 3 ניסויים
- **E1 spread-regime (built-in)**: SPREAD-REGIME: value=100bps · delta=+6.50 vs 93.5 · מקור-בן-10.3h · HOLD (loosened) — הפיזור התרחב — לעקוב בלבד (verify/doc-only)
- **צווי-עבודה (work-orders)**: 6 פתוחים · 6 נפתרו · P1 פתוחים: 1
- **רווחיות (profit-oracle)**: verdict=FLAT · delta=0% מול-המדידה-הקודמת · שווי-נקי=455.32 SBD-equiv · grid=EDGE-NEGATIVE-GRID-HOLD · at=2026-10-11 23:52 UTC
- **פריטים**: 4 (SAFE 1 · MACHINE-PREP 2 · OWNER-WORD 1)

## בוצע במחזור זה (SAFE built-ins בלבד — חוק)

| id | כותרת | מחלקת-סיכון |
|----|-------|-------------|
| `builtin-refresh-lane` | רענון קבצי-המסילה: BACKLOG + RETRO-LATEST + retro-state (SAFE: כתיבה למסילה-שלו בלבד) | SAFE |
| `builtin-verify-bus` | אימות-אוטובוס: מדידת כל-הפידים הרשומים + טבלת-בריאות מוטמעת (SAFE: קריאה-בלבד) | SAFE |
| `builtin-e1-spread-regime` | אימות-משטר-הפיזור (E1): grid.json חי מול חוק-93.5bps — פסק-כנה לתיק (SAFE: קריאה-בלבד) | SAFE |

> כל-שאר הפריטים אינם מבוצעים — SAFE מתורגש כ-`executableBy: next-retro` (הרפרטואר-הבטוח צומח built-in אחד לכל-מחזור); MACHINE-PREP מוכן לבעלים; OWNER-WORD לעולם לא מבוצע-מכונה.

## תור מדורג

| # | id | מקור | כותרת | מחלקת-סיכון | ערך | מאמץ | דבר-בעלים | executableBy |
|---|----|------|-------|-------------|-----|------|-----------|--------------|
| 1 | `research-e1-spread-regime` | research/2026-10-11 (E1 spread-re… | E1 spread-regime — spread tightened (93.48 < 93.5 bps) — grid-side liquidity improving | SAFE | 4 | 2 | — | `builtin-e1-spread-regime` |
| 2 | `WO-unwired-adsmarket-marketing` | work-orders.json (Sandbox raw) | חבר את ערן-השיווק החי (private-1) למשטח-חי — fact-sheet/pitch/kits EN-HE נגישים מ-Domain | MACHINE-PREP | 7 | 2 | — | `owner-after-prep` |
| 3 | `research-e2-feed-divergence` | research/2026-10-11 (E2 feed-dive… | E2 feed-divergence — healthy band: divergence 252.14 bps ≤ 300 (feed_above_market) | MACHINE-PREP | 4 | 2 | — | `owner-after-prep` |
| 4 | `research-e3-rc-census` | research/2026-10-11 (E3 rc-census) | E3 rc-census — 4 RC-starved accounts (<40%): wog 25.94%, hcsoldier4 8.05%, hcsoldier5 2… | 🔒 OWNER-WORD | 4 | 2 | כן | `owner-only` |

## הצעה ראשית של המחזור

- **קובץ**: [PROPOSALS/2026-10-11-wo-unwired-adsmarket-marketing.md](PROPOSALS/2026-10-11-wo-unwired-adsmarket-marketing.md) — עבור הפריט המדורג ראשון.

## גבולות (חוקי-המחזור)

- retro לא משדר, לא חותם, לא נוגע בכסף/מפתחות/STASIS
- תופעות-לוואי: קבצי-המסילה שלו בלבד (office/*)
- אפס-סודות בכל-פלט (סורק fail-closed לפני כתיבה)
- שמות-ריפואים-פרטיים ממוסכים private-NN (7-b) — כולל שערים
- שערי-בעלים מוזכרים לפי id/כותרת מוקטנת בלבד
- כנות: לא-ידוע נשאר לא-ידוע; פיד אדום מודפס אדום

---
*נוצר אוטומטית על-ידי המשרד · SAOS-OFFICE-RETRO/1 · אפס-סודות (סרוק fail-closed) · ISO 2026-10-11T23:56:36.105Z*
