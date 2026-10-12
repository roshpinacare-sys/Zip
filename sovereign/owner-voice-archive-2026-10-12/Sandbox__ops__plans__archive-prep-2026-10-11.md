# הכנת-ארכובים 26→8 · 2026-10-11 · Task 9-c (מנדט-ריבונות trace 1a12b9477be6cd05)

> מבצע את סדר-הביצוע של `consolidation-26to8-2026-10-11.md`: סעיף 2 (סריקת-קוראים-חיים) + סעיף 4 (טומבסטונים).
> **אפס-ארכוב-בפועל היום** — הכלל-האחוזתי: ארכוב-רק-כשה-verifier ירוק-על-כל-העורקים-החיים (D-4).
> כל-המספרים-מדידות 2026-10-11 15:30..16:3xZ מקלונים-טריים (fetch+reset ל-origin).

---

## 1. סריקת-קוראים-חיים — מי-קורא-מכל-אחד-מה-11

סריקה: כל-`*.yml`-תחת-`.github/workflows/`-בכל-26-הקלונים + `engine/`/`mini-services/`-ב-keep-8.

| ריפו-לארכוב | מתייחסים-ב-workflows (חיים=מודגש-מנטלי) | פסק-ארכוב |
|---|---|---|
| **saos-dex** | Console: grid-pulse, key-verify · Domain: dex-grid, dex-beat, dex-xc-cron, dex-core-cron, dex-router-cron, market-grid-cron, fill-ledger-cron, grid-trigger-twin, content-campaign, org-selftests, org-gitleaks · Sandbox: artery-fleet | **חסום** — מנוע-חי-עם-12-עורקים; דורש-מיזוג-מדורג לפני |
| **Zip** | Domain: web-publish, org-gitleaks, weave-anchor-ping/lines, weave-ecosystem, weave-heart, watchdog, seal-adopt · yaml-guard-שכפולים (בעיקר-ריפואים-מתים) | **חסום** — עורקי-weave-חיים-ב-Domain |
| **Saosmartwallet** | Sandbox: **artery-wallet (חי!)** · Domain: org-gitleaks, sovereign-selftests · Zip: weave-brain-restore | **חסום** — עורק-הארנק-קורא-ממנו; +🔴 הכרעת-db-לבעלים |
| **saos-control-center** | Domain: org-selftests, org-gitleaks | **חסום-רך** — דרוש-סליקת-fuel-telemetry-לדפוס-runtime |
| **FleetHQ** | Sandbox: **sovereign.yml (network-probe מראה-receipts-ציבוריות)** | **חסום** — דרוש-אימות-שה-probe-סובל-404-לפני-ארכוב |
| **saos-agents** | Sandbox: **artery-fleet (חי!)** | **חסום** — דרוש-ניתוק-קריאת-הספרייה (הקבצים-זהים-בייט-ל-steem) |
| **Adsmarket** | Domain: org-gitleaks (סריקה-ארגונית-שאינה-תלויה-בחיים) | **בטוח-מ-workflows** |
| **sanbox** | Sandbox: fleet-heal, agent-roster-reseal | **לא-לארכוב** — keep-candidate (D-שאר-ב-SOVEREIGN-DECISIONS) |
| **SovereignConsole** | — | **בטוח** |
| **sovereign-lighthouse** | — | **בטוח** |
| **sovereign-beacon** | — | **בטוח** |

## 2. פעילות-כותבים (24h, מ-fetch-טרי)

| ריפו | קומיט-אחרון-על-main | פסק |
|---|---|---|
| saos-dex | 2026-10-11 14:03Z | **פעיל** — טומבסטון-נדחה |
| Zip | 2026-10-11 07:37Z | **פעיל** — נדחה |
| saos-control-center | 2026-10-11 13:18Z | **פעיל** — נדחה |
| SovereignConsole | 2026-10-10 16:27Z (~24h) | שקט |
| FleetHQ | 2026-10-10 16:24Z (~24h) | שקט |
| sanbox | 2026-10-10 17:47Z | keep — לא-נוגעים |
| sovereign-lighthouse | 2026-10-10 17:55Z (~22h) | שקט-מספיק |
| Saosmartwallet | 2026-10-08 06:09Z | שקט 3.4-ימים |
| saos-agents | 2026-10-08 06:47Z | שקט 3.4-ימים |
| Adsmarket | 2026-10-08 07:04Z | שקט 3.4-ימים |
| sovereign-beacon | 2026-10-10 06:30Z (~34h) | שקט (הערה: דחיפה-לענף-לא-main-ב-13:31Z — נבדק-לפני-ארכוב-בפועל) |

## 3. טומבסטונים — בוצעו (7, אפס-מחיקת-נתונים, `ARCHIVED-NOTICE.md`-חדש-בלבד)

| ריפו | commit |
|---|---|
| SovereignConsole | 01faa00 |
| Adsmarket | a57fa02 |
| saos-agents | 7050ff5 |
| FleetHQ | 15c403a |
| Saosmartwallet | 87461c1 |
| sovereign-lighthouse | 1df8302 |
| sovereign-beacon | 6de2be5 |

נדחו-בכוונה: saos-dex / Zip / saos-control-center (פעילים-היום), sanbox (keep-candidate).
Saosmartwallet: הטומבסטון מציין-במפורש-שהארכוב-מותנה-בהכרעת-הבעלים-על-db/custom.db.

## 4. ביקורת-דקות-Actions ו-ToS

- **כל-ה-cron-המתוזמן-באחוזה חי על ריפואים ציבוריים**: Sandbox (סט-עורקים 15/30/60-דק'), Console (14-מדורים), Domain (הצפוף-ביותר — כולל-מספר-`* * * * *`-שעתיים-מלאות), saos-runtime (hourly-backstop). ציבורי = דקות-חינם, בלי-מכסה.
- **לאף-ריפו-פרטי אין-schedule-על-הדיסק** — עקבי-עם-OWNER-P0 §4 (CI-פרטי-מת-מ-10-05): אפס-שריפת-מכסה, אפס-סיכון-חסימה.
- **סיכונים-קלים-שנרשמו** (לא-חוסמים): (א) Domain-מריץ-מספר-מדורים-שעתיים-מלאים-במקביל-לסאנדבוקס-עורקים — רעש-ריצות-בלבד, עלות-אפס; (ב) שכפול-yaml-guard-ב-11-ריפואים-מתים — יימחק-מעצמו-בארכוב.
- **ToS**: אפס-force-push (append-only בכל-האחוזה) · gitleaks-בכל-דחיפה (Domain T-53) · אפס-סודות-בעץ (סריקות-חיות-שעתיות) · קצבי-לב-אנושיים-לגמרי. אין-כל-דפוס-העלול-להיחסם.

## 5. סדר-המשך (לריצה-הבאה, אחרי-verifier-ירוק)

1. ניתוק-עורקי-הקריאה: artery-fleet↔saos-agents (קבצים-כבר-ב-steem) · artery-wallet↔Saosmartwallet · sovereign.yml↔FleetHQ-mirror.
2. סליקת-fuel-telemetry-לדפוס-runtime (saos-control-center).
3. ואז — ארכוב-ריפו-אחר-ריפו-בכפתור-הריבונות, מהשקטים-לפעילים, טומבסטון-קיים-כבר-לכל-אחד-מה-7.

---

*רישום-זה create-only · כל-הקומיטים-מקומיים-ונדחפו-מרכזית-ע"י-המתאם · Task 9-c*
