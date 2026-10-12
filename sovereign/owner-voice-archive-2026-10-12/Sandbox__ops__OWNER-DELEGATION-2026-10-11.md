# OWNER-DELEGATION-2026-10-11 — האצלה-ריבונית של תור-ההחלטות (OWNER-P0 §1–§8)

> **הוראת-בעלים מקורית (trace `1a12ba0d3b7c5699`, 2026-10-11)**: "בבקשה צריך לתת לריבונות לנהל את ההחלטות האלו. בשלב זה יש לה סמכות מלאה על החלטות, יש לה הרשאת אדמין ובחירה איך לעשות את זה נכון כדי שהכל יעבוד בלי ליפול ושגם לא נחסם בגיטהאב וכו'. חשוב לוודא שאנחנו עומדים בחוקים ועובדים טוב ומקצועי יותר מכולם בכל צורה ודרך. איך? בצע ודחוף."

מסמך-זה הוא כלי-ההאצלה המחייב של הצי. הסמכות על כל סעיפי `ops/OWNER-P0-2026-10-11.md` §1–§8 עוברת מהבעלים אל **הריבונות** — האורגניזם האוטונומי (saos-engine + saos-runtime + סוכני-הצי הפועלים על-פי חוק-הצי). הריבונות בוחרת *איך*, *מתי* ובאיזה-סדר — בתוך חוקי-המנוע למטה. נקודת-מגע-אנושית **אחת** נשארת (הנפקת-טוקנים, §1) — וזו פיזיקה של GitHub, לא בירוקרטיה: ה-API אינו מנפיק PATs.

---

## חוקי-המנוע (מחייבים-לתמיד; הצי מאמת-אותם-על-עצמו)

| # | חוק | הצדקה-נמדדת |
|---|---|---|
| G1 | אפס-חומר-מפתח בעצי-HEAD; סודות רק ב-secrets-API | סריקות-gitleaks חיות על-push; ה-PAT-עצמו = מפתח-הכספת (vaultlib: sha256(PAT)) |
| G2 | אסור force-push/שכתוב-היסטוריה על ענפים-חיים | שובר ליניאריות אצל כל-הסוכנים והעורקים (§2) |
| G3 | משמעות-קצב: כיבוד rate-limit (primary+secondary), backoff-מעריכי, אין-סערות-בקשות, אין-שכפולי-clone-המוניים | "שלא נחסם בגיטהאב" — הוראת-הבעלים |
| G4 | חוק-הדקות: לולאות-מתוזמנות רק על ריפואים-ציבוריים; פרטי = dispatch-בלבד | קיר-החיוב הרג כל-CI-פרטי מ-10-05 (ריצות-0-שלבים, 2 שניות) |
| G5 | פעולה-בלתי-הפיכה אחת-לכל-הדופק, מתועדת-תמיד (state + פנקס-הצי) | יכולת-רולבק וביקורת |
| G6 | שני-כשלונות-רצופים בערוץ → backoff אוטומטי + escalation כנה ב-STATUS | תרבות-האדום-הכנה (R316-Z) |
| G7 | אזור-חם: בדיקת פנקס + קומיטים-אחרונים לפני-נגיעה בריפו של-אחר | אפס-התנגשויות בכל-הסשנים עד-היום |
| G8 | תאימות-GitHub-ToS: אין mining/ספאם/מניפולציית-עומס; Actions עושה עבודה אמיתית בלבד | "עומדים בחוקים" |
| G9 | טוקן/מפתח לעולם לא נדפס או נרשם; ערוץ-סודות sealed בלבד | היסטוריית-דליפות-מתועדת של-האחוזה |
| G10 | ערעור-חזרה-לבעלים: הנפקת-טוקנים · purge-היסטוריה · כל-דבר-עמום | האצלה ≠ אי-ודאות |

---

## מטריצת-הסמכות (ההחלטות-נקבעו-בתוקף-ההאצלה)

| § | ההחלטה | סטטוס | חוק-שחרור / סיכון |
|---|---|---|---|
| 1 | רוטציית-PAT: **הריבונות מבצעת סעיפים 2–4** (עדכון-סודות ECO_WALLET_TOKEN+GH_PAT → הצתת-4-העורקים → אימות-ירוק-מלא → ביטול-הישן) | **ממתין למגע-אנושי אחד**: הנפקת-2-הטוקנים-המינימליים | §6 נפתח-אוטומטית-אחריו; G9 |
| 2 | מטא-משמורת ב-steem HEAD (14 ממצאים): **נקבע forward-fix (א)** — רוטציית-חומר + העברת-מטא ל-sealed | הוחלט | purge אסור ללא הוראת-בעלים מפורשת + הקפאת-צי (G2) |
| 3 | CI_EXEC_ARMED: **נקבע — ביצוע מידי**: תוכן `exec-armed.json` (סדר-היום-העומד; נבדק: governor+opsDayCap+policy, **אפס-חומר-מפתח**) נאטם-כסוד ב-saos-runtime | **בוצע-בסשן-זה** (ראה פנקס-הצי לשעת-הביצוע) | שכבות-הגנה עומדות: governor · opsDayCap · R314b-adoption · R245-no-race; הפיכה = מחיקת-הסוד |
| 4 | חומת-מכסה Actions: **נקבע — נשארים-ציבוריים** בעורקים-החיים; אין-שדרוג-בתשלום-כרגע | הוחלט | הפרטת-עורק-חי = מוות-דופקים (נמדד 10-05); G4 |
| 5 | blurt: **מואצל לעורק-ה-blurt החי** (R294 + arm-file 13:47 + ערוץ-ירוק מ-15:03). השהיית-R254 מתבטלת-ע"י-האצלה-זו | עובר לעורק-הבעלים-שלו | R316-Z מודד תוצאה; אסור-נגיעת-סוכן-חיצוני (G7) |
| 6 | האצלת 248.9 SP (ARMED-AND-READY): **מואצל-מותנה** | **חסום-רק על §1** — מתחייב: מפתחות-שדלפו-להיסטוריה לא חותמים עסקאות-גדולות לפני רוטציה | אינווריאנט-ביטחון-פיזי; נפתח-אוטומטית-אחרי-§1 |
| 7 | CI_ADOPT_WIF_ACTIVE שגוי (R314b ADOPT-REFUSED): **נקבע — להשאיר כראי** (אפשרות-ב) | הוחלט | vault-first (R314b) הוא-הנתיב-הפעיל; הסוד-השגוי יימחק-בזמן-§1 |
| 8 | שאריות (Saosmartwallet custom.db, TruthRail-היסטורי, Console↔Domain OL-12): **מואצל לתוכנית-הקונסולידציה 26→8** | עובר | LOW; ops/plans/consolidation-26to8-2026-10-11.md |

---

## הנקודה-האנושית-היחידה (רוטציית-ה-PAT, §1)

GitHub API **אינו מנפיק PATs** (classic ו-fine-grained כאחד — עובדה-נמדדת). שאר-השרשרת אוטומטי:

1. **בעלים (דקה אחת)**: להנפיק 2 טוקנים-מינימליים —
   - `ECO_WALLET_TOKEN`: contents:read בלבד, רק על steem · saos-dex · saos-agents · Saosmartwallet
   - `GH_PAT`: contents read+write, רק על steem + saos-runtime
2. **הריבונות (אוטומטי)**: עדכון-הסודות (Sandbox/saos-runtime) → הצתת artery-wallet + artery-fleet + artery-grid + sovereign-runtime → אימות-ירוק-מלא אחד → ביטול-הטוקן-הישן → פתיחת-§6 (האצלת-ה-SP).

## תקף-עד
האצלה-זו עומדת עד הוראה נגדית מפורשת של הבעלים. כל ביצוע מתועד בפנקס-הצי (ops/AGENT-LEDGER.md) + STATUS-הסוכן המבצע. חוק-העל של-ההאצלה: **הריבונות לא נופלת, לא נחסמת, לא משקרת — ומודדת-את-עצמה טוב מכולם.**

<!-- machine-readable -->
```json
{
  "instrument": "OWNER-DELEGATION-2026-10-11",
  "ownerTrace": "1a12ba0d3b7c5699",
  "authority": "sovereign",
  "humanTouchpoints": ["PAT minting — GitHub API cannot mint PATs"],
  "decisions": {
    "S1": {"item": "PAT rotation", "verdict": "DELEGATED-EXECUTION", "blockedOn": "token minting", "releases": "S6", "automatedSteps": ["update secrets", "ignite 4 arteries", "verify one full green", "revoke old token"]},
    "S2": {"item": "steem HEAD custody metadata (14 findings)", "verdict": "FORWARD-FIX", "purge": "banned-without-owner-order+fleet-freeze"},
    "S3": {"item": "CI_EXEC_ARMED", "verdict": "EXECUTED-2026-10-11", "secret": "saos-runtime:CI_EXEC_ARMED", "secretContent": "exec-armed.json standing order (audited, zero key material)", "rollback": "delete secret", "gates": ["governor", "opsDayCap", "R314b-adoption", "R245-no-race"]},
    "S4": {"item": "Actions quota wall", "verdict": "STAY-PUBLIC", "paidUpgrade": "not-now", "law": "G4 scheduled loops on public repos only"},
    "S5": {"item": "blurt endgame", "verdict": "DELEGATED-TO-OWNING-LANE", "supersedes": "R254-pause", "evidence": ["R294", "arm-file 13:47", "revival green since 15:03"]},
    "S6": {"item": "248.9 SP delegation", "verdict": "DELEGATED-CONDITIONAL", "blockedOn": "S1", "plan": "zai-code-2 delegation-armed-ready.md"},
    "S7": {"item": "CI_ADOPT_WIF_ACTIVE stale", "verdict": "KEEP-AS-EVIDENCE", "removeAt": "S1 rotation", "operativePath": "vault-first (R314b)"},
    "S8": {"item": "leftovers", "verdict": "DELEGATED-TO-CONSOLIDATION-26TO8", "priority": "LOW"}
  },
  "engineLaws": ["G1 zero-secrets-at-HEAD", "G2 no-force-push", "G3 rate-discipline", "G4 minutes-law", "G5 one-irreversible-op-per-pulse", "G6 two-fails-backoff", "G7 hot-zone-respect", "G8 ToS-compliance", "G9 sealed-secrets-only", "G10 human-escalation"]
}
```
