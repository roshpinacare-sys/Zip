# מפקד-נכסים-לא-מחוברים (UNWIRED ASSETS CENSUS) · 2026-10-11 · [zai-12a]

> **הוראת-בעלים (trace 1a12cf99469635d9):** "בדוק מה לא מחובר — יש לנו טונות של תוכן איכותי שעבדנו עליו, אבל דרך כל-כך הרבה שכבות דברים טובים אולי תקועים; שהכל ירוויח."
> **שיטה:** אפס טענות-מאמינים. לכל נכס: grep אמפירי על 6 הקלונים + .github/workflows, מדידת-גיל מהספר עצמו (חותמת-זמן), curl חי לכל-קישור-ציבורי, ורק-אז פסק. הפסקים: **LIVE** (מחובר-וחי) · **UNWIRED** (איכותי, אפס-צרכנים) · **BROKEN** (מחובר-שבור: מצביע-מת/יצרן-מאוחר/העתק-קפוא) · **ORPHANED** (יתום: מפורסם-ואף-אחד-לא-קורא).
> כלל-הצו (Sandbox ops/sovereign/DECIDER/CHARTER.md): R4 אל-דריכה — תיקון-במסילה-שלי בלבד; לשאר: work-orders.json (ערוץ-zai-code-5 המוסכם).

---

## 1) שקף-מפקד — 31 נכסים נמדדו

| פסק | מספר |
|---|---|
| LIVE (מחובר-וחי) | **19** |
| UNWIRED (איכותי-ללא-צרכנים) | **6** |
| BROKEN (מחובר-שבור) | **4** |
| ORPHANED (מפורסם-ומיותם) | **2** |
| (המפקד עצמו: מסמך-זה = חיבור-ראשון לנכסים 1,13,14,15,19,23,29) | — |

---

## 2) הטבלה המרכזית — כל-נכס נמדד

| נכס | ריפו/נתיב | איכות | נגיעה-אחרונה | צרכנים-היום (מדידה) | צרכנים-פוטנציאליים | עלות-חיבור | פסק |
|---|---|---|---|---|---|---|---|
| knowledge-cards.json (39 כרטיסי-HE, 43KB) | Domain/agents | 4 | code 10-11 (fab65f3) | **0** — grep מדויק `knowledge-cards.json` ב-6 קלונים+workflows: **אפס-הופעות** | עמוד-verify (12-c) · office-feed (חובר-היום, §5) · content-campaign | S | **UNWIRED** |
| knowledge-cards-en.json (39 כרטיסי-EN) | Domain/agents | 4 | 10-11 | 4 אמיתיים: fleet-social.cjs:43 · soldiers-blog.cjs:77 · measure-learn.cjs:49 · venture-desk.cjs:216 | verify-EN | — | **LIVE** |
| skill-library.json + skill-library-gate.cjs + skill-library/ | Domain/agents | 4 | book 10-04 / gate v1.5.0 | run-evals.cjs (recruit.yml יומי 04:44) · office-artery.mjs · harness-audit.cjs · fleet-census.cjs · flow-map | לולאת-retro | — | **LIVE** |
| cognition/ (organism.json + beat-book + lane-guards) | Domain/agents | 4 | organism 10-11T19:09Z | cognition-beat.yml (שעתי 43*) · capital-gate · flow-map | — | — | **LIVE** |
| reef/ (rung3-stack.yaml + guarded_episode.py) + reef-rung3.cjs + reef-harness-evo.cjs → evo-windows.cjs | Domain/agents | 3 | ספרים 10-03/10-04 (**7-8 ימים**) · קוד 10-11 | אין-workflow: אף-cron לא מריץ evo-windows/reef-rung3 (grep 6 קלונים). evo-windows.json נצרך ע"י pulse.cjs:141 (evidence-גיל-כנה) | לולאת-retro (11-d) · research-lane | S | **ORPHANED-PRODUCER** |
| learning-ledger.json (56KB) + learning-summary.json | Domain/agents | 4 | 10-10T18:47Z | measure-learn (self-audience.yml יומי) · fleet-indicators.cjs:3 · harness-audit · venture-desk · collapse-drill · **FleetHQ agent-hq** (books.ts, watchdog.ts, plant-books.ts, post-batcher.ts) · office-feed (חובר-היום) | verify | — | **LIVE** |
| capability-matrix.json | Domain/agents | 3 | book 10-08T21:06Z | treasury-route.yml (push) · office-artery · public-pulse:2 · reconcile · FleetHQ books-lineage | — | — | **LIVE** |
| one-bloc.json (verdict DEGRADED — כנות) | Domain/agents | 3 | 10-11T11:02Z | recruit.yml יומי · pulse.cjs:2 · harness-audit · run-evals | — | — | **LIVE** |
| persona-store.cjs + personas.enc + persona-slots.enc | Domain/agents | 4 | — | 10 צרכנים (arb-mesh, community-founder, human-cadence, fleet-social, soldiers-blog, dex-core, public-pulse, self-audience, tribridge, soldiers-curate) | — | — | **LIVE** |
| evals/ (run-evals.cjs — E1..E67+ , eval-results.json) | Domain/agents | 5 | ריצה 10-11T11:02Z | recruit.yml (יומי) · claims-audit:2 · pulse | office-retro (FleetHQ) | — | **LIVE** |
| cmmq/cmmq.sh (לקוח-MCP-מנוהל) | Domain/agents | 3 | — | **0 ריצות** — המארח `mini-services/mcp-host` **לא קיים באף-קלון מ-6** (ls) | שיקום-המארח או מצבה-כנה | L | **BROKEN** (לקוח-בלי-שרת) |
| swe-guard/guard_env.py (LocalEnvironment-מוגן) | Domain/agents | 3 | — | רק שרשרת-reef-rung3 (עצמה-לא-מתוזמנת) | רנטיים-mini-swe | M | **UNWIRED** |
| dex/onramp.json | Domain/dex | 4 | **העותק 09-19T22:31 = 528ש׳** (מדידה: onramp.at) | Sandbox engine/scribe.mjs (הלומד) קורא **את-העותק-הקפוא** (flow-map.json:1931 מדווח age=524.9h בכנות) · index.html לא | דפי-defi/money | S | **BROKEN** (פער-שיקוף) |
| dex/showcase.json | Domain/dex | 4 | **העותק 09-19T22:31 = 528ש׳** | כנ"ל | כנ"ל | S | **BROKEN** |
| dex/relay.json | Domain/dex | 3 | **העותק 09-19T22:30 = 528ש׳** | כנ"ל | כנ"ל | S | **BROKEN** |
| (היצרן-החי) Console/dex/{onramp,showcase,relay}.json | Console/dex | 4 | **10-11T20:14Z — טרי** (curl 200) | **אף-משקף** — dex-mirror.mjs:21 FILES=[grid,world,state,credits,portfolio] **מדלג על 3 הקבצים**; mirror-from-console.mjs DATA גם-כן | dex-mirror work-order | S | **LIVE-מקור / ORPHANED-PRODUCER** |
| dex/mirror-stub.json | Domain/dex | 5 | — | מוגש-ציבורית (200) — "Not available in the public mirror" כנות-מכונה | — | — | **LIVE** |
| dex/credits.json | Domain/dex | 3 | 10-10 (משוקף, credits:[]) | dex-mirror · דפי-כסף | — | — | **LIVE** |
| dex/portfolio.json + pnl-desk.json + xc-{intents,ops,requests}.json | Domain/dex | 3-4 | portfolio 10-10 · pnl 10-11T15:02 · **xc 10-04 (תורים-ריקים-כנים)** | versus.html (portfolio) · money pages (pnl) · dex-xc.cjs:65-67 (ספרי-עצמו) · run-evals | — | — | **LIVE** (xc = מצב-חוסר-פעילות-כן) |
| ops/FLOW-PLAN / GROWTH-PLAN / OWNER-P0 / RESUME-PACKET / TOKEN-TRUTH / ESTATE-TRUTH | Sandbox/ops | 3-4 | 10-11 | **0 צרכני-מכונה** — רק הפניות-מסמך (AGENT-LEDGER, README של zai-code-3/5, RESUME-PACKET) | שער-טריות-מסמכים ב-fresh-oracle (12-b) · סוכן-ההמשך-הבא | S | **UNWIRED** (עמוד-שדרה-להמשכיות — מומלץ-שער-חי) |
| engine/integrity-guard.mjs | Sandbox/engine | 4 | — | artery-integrity.yml (selftest+ריצה+קומיט) | — | — | **LIVE** |
| console/ (קונסולת-מפעיל חתומה: index.html + params.json + sealed-payload.bin) | Sandbox/console | 4 | — | pages.yml מפרסם ב-push (runs 52/49/48 green, event=push) · tools/seal.mjs מייצר | — | — | **LIVE** |
| ops/office/potential.json + VALUE-MAP.md | Sandbox/ops | 3 | — | office-growth.yml (delta מול-קודם) · Domain office3d/growth/index.html | — | — | **LIVE** |
| potential.json + potential.html (Pages 200, gen 10-11T21:00Z) | FleetHQ→office-pages | 3 | 10-11T21:00Z | **0** — אין-קישור-ניווט ב-render.mjs, אין-קורא ב-6 קלונים | חלון-המשרד (nav) · retro | S | **ORPHANED** (משטח-יתום) |
| DESIGN.md (13-הפניות) · MEMORY.md (15) | FleetHQ | 3 | 10-10 | תוך-ריפו (README, קוד) | — | — | **LIVE** (מסמכים) |
| FLEET-BINDING.md | FleetHQ | 2 | 10-10 | 3 הפניות-תוך-ריפו, **0 חוצי-ריפו** | agent-hq binding | — | **ORPHANED-DOC** |
| download/README.md ("Here are all the generated files.") | FleetHQ | 1 | — | **0** | למחוק או למלא | S | **ORPHANED** (שארית-תבנית) |
| .gitignore — **סימני-קונפליקט חתומים ב-HEAD** (שורות 110-116) | FleetHQ | — | HEAD | **שובר-כלים**: rg מחזיר `error parsing glob '>>>>>>> 7073840...'` (נמדד); git מתייחת לסימנים כדפוסי-ignore-רגילים | פתרון-הקונפליקט (שתי-השורות נחוצות) | S | **BROKEN** |
| agent/social/{cadence,content-v3,comment-quality}.cjs (selftest 44/44 PASS) | steem/agent/social | 4 | — | **social-selftest.cjs בלבד** — לא-מתוזמן-באף-workflow | מו"ל-גיבוי | S | **UNWIRED** |
| social-cadence.yml (גיבוי-מו"ל, dispatch-only) | steem/.github | 2 | — | **0 ריצות מעולם** (API: total=None) + **מצביע-מת**: clone-Domain ואז `node agents/social/cadence-run.cjs` — ב-Domain/agents/social/ יש 3 קבצים בלבד, **אין cadence-run.cjs** (git ls-tree) → ריצת-חירום-אמיתית תיפול | תיקון-נתיב לעותק-של-steem | S | **BROKEN** (מצביע-מת+מעולם-לא-נבדק) |
| כל-המצביעים-הציבוריים בדפים (Domain index.html: 10 כתובות · FleetHQ office+retro: 12) | ציבורי | — | — | **22/22 curl=200** (steemit.com/@headcorner = 403-ל-CLI-בלבד — חסימת-בוטים, חי-בדפדפן; blurt-rpc.saboin.com = 503 — תקלת-צומת-ידועה, מתועדת-כנה) | — | — | **ALIVE** — טענת-ה-AGENT-LEDGER על "dead raw-roots ל-digest" **לא-הופקה**: raw-FleetHQ (office-state, office-ci/verdict) = 200 מדוד |
| engine/scribe.mjs + ops/flow/flow-map.json | Sandbox | 5 | שעתי | הצופה-שמאיר-את-פער-528ש׳ בעצמו (flow-map:1931) | — | — | **LIVE** (השרת-המפוצץ) |

**הערת-מדידה (שקיפות-כלים):** במהלך-הסריקה נתגלה ששכבת-ההצגה-בסנדבוקס מעוותת-פלט-מסוים (רצף `[m` נבלע בתצוגה — דמה ל-`branches: ain]`); כל-ממצא-קריטי אומת שוב בשכבת-בייטים (od/cmp/git show). שני-הממצאים-הקשים (סימני-קונפליקט ב-FleetHQ .gitignore, מצביע-המת ב-steem social-cadence.yml) עמדו-באימות-בייטים. טענת-`ain]` בטריגרי-workflows התבררה כתופעת-תצוגה — הבייטים האמיתיים: `branches: [main]` (od מדוד) והריצות-בפועל push-מופעלות-וירוקות (Sandbox pages runs 52/49/48).

---

## 3) עדויות-מפתח (קטעי-מדידה)

1. **אפס-צרכנים לכרטיסי-HE:** `rg -n "knowledge-cards\.json"` בכל-6-הקלונים (למעט-הקובץ-עצמו ולמעט `-en`): **אפס-שורות**. לעומתו ה-EN: 4 קריאות-קובץ אמיתיות (`readFileSync(...knowledge-cards-en.json)`).
2. **פער-השיקוף:** `Domain/agents/dex-mirror.mjs` שורה 21: `const FILES = ["grid.json","world.json","state.json","credits.json","portfolio.json"]` — onramp/showcase/relay חסרים. המקור-ב-Console טרי (10-11T20:14Z, curl 200); העותק-ב-Domain בן 528ש׳; flow-map.json (שעתי) מדווח זאת בעצמו: `"age=524.9h > 48h (consumer: Sandbox/engine/scribe.mjs (learner))"`.
3. **steem:** API ריצות ל-social-cadence.yml → `total: None` (אפס-ריצות-מעולם); `git ls-tree origin/main agents/social/` ב-Domain → 3 קבצים בלבד (SOCIAL-AUDIT-REPORT.md, audit_activity.cjs, social-audit-receipt.json) — אין cadence-run.cjs.
4. **FleetHQ .gitignore @ HEAD** (git show, od): `<<<<<<< HEAD` / `=======` / `>>>>>>> 7073840 ([z-3d] exec-14: office 3D v2...)` — קונפליקט-לא-פתור-חתום; rg נכשל עליו בפועל.
5. **FleetHQ potential:** Pages 200 + generatedAt 21:00:56Z — אבל `rg "potential" office-window/render.mjs` → אפס-הופעות (אין-ניווט, אין-צרכן).
6. **כל-הקישורים-הציבוריים חיים:** 22 כתובות-ייחודיות מ-Domain-index/FleetHQ-office/retro → 200 (חריגים מתועדים-לעיל).

---

## 4) תוכנית-החיבור TOP-10 (דירוג ערך÷עלות)

| # | חיבור | ערך | עלות | בעלות | מצב |
|---|---|---|---|---|---|
| 1 | **dex-mirror.mjs FILES += onramp/showcase/relay** — מחסל את-השקר-בן-528ש׳, מזרים ספרי-onramp/relay חיים ללומד (scribe) ולעתיד לדפי-הכסף | גבוה | S (1 שורה+בדיקה) | zai-10b/Domain-dex | **WO-unwired-dex-mirror (P1)** |
| 2 | **knowledge-cards.json (HE) → צריכה-ציבורית** — הושלם-חלקית היום: office-feed.mjs מפרסם כרטיס-היום (tier-A: id+title+tag+ספירה; אימות-redaction נקי 0-פגיעות). השלב-הבא: משטח-verify (12-c) או פאנל-index | גבוה | S | ✅ חובר-במסילה-שלי (§5) + המלצה-ל-12-c | **חובר-חלקית** |
| 3 | **steem social-cadence.yml — תיקון-מצביע** (לרוץ על עותק-steem עצמו: `agent/social/cadence-run.cjs`) + dispatch-מבחן-אחד — מו"ל-הגיבוי יעבוד-בחירום-אמיתי | גבוה (חוסן-פרסום) | S | zai-9a/steem | **WO-unwired-steem-social-cadence (P2)** |
| 4 | **evo-windows.cjs → cron שבועי** (או מצבה-כנה) — שרשרת-ה-reef (harness-evo→evo-windows→evidence-ל-pulse) חדלה 7-8 ימים; pulse רץ על-ראיות-מזדקנות | בינוני | S | zai-10/Domain | **WO-unwired-evo-windows (P2)** |
| 5 | **FleetHQ .gitignore — פתרון-הקונפליקט-החתום** (שתי-ההצהרות נחוצות: public/office-state.json + /dist-office3d/) — מסיר-שבירת-כלים | בינוני | S | zai-13/zai-code-5/zai-sec (מסילה-חמה — WO בלבד) | **WO-unwired-fleethq-gitignore (P2)** |
| 6 | **FleetHQ potential.html → קישור-ניווט בחלון-המשרד** — משטח-חי-ממילא (200, 21:00Z) שאף-אחד-לא-מגיע-אליו | בינוני | S | zai-13 | **WO-unwired-fleethq-potential-link (P3)** |
| 7 | **מסמכי-ops של Sandbox → שער-טריות ב-fresh-oracle (12-b)** — עמוד-השדרה של-המשכיות-הסוכנים (RESUME-PACKET/TOKEN-TRUTH וכו') נטול-צרכן-מכונה | בינוני | S | zai-12b (המסילה-כבר-בנויה-שם) | **WO-unwired-sandbox-ops-docs (P3)** |
| 8 | **cmmq/mcp-host — הכרעה:** שיקום-המארח (CR-0031/32) או מצבה-כנה `retired/` — לקוח-שאינו-מדבר-עם-שרת הוא-רעש | בינוני | M/L | zai-10/Domain | **WO-unwired-cmmq-host (P3)** |
| 9 | **swe-guard/guard_env.py — הכרעה דומה:** רנטיים-mini-swe או מצבה | נמוך-בינוני | M | zai-10/Domain | **WO-unwired-swe-guard (P3)** |
| 10 | **capability-matrix — טריות:** ה-book בן 3 ימים כי-המו"ל (treasury-route.yml) push-only → dispatch שבועי-קבוע | נמוך | S | zai-10/Domain | **WO-unwired-capability-fresh (P3)** |

**מה-נבדק-וכבר-חי (לא-לתקן):** 19 ה-LIVE — כולל ההעתקה-הכנה של mirror-stub, הלומד-שמאיר-על-הפער-בעצמו, הכנות של xc-תורים-ריקים, וה-evals-היומיים.

---

## 5) מה-חובר-בפועל (Phase 3 — מסילות-שלי בלבד)

1. **Domain/agents/office-feed.mjs (המסילה-שלי מ-10-b):** שני-בלוקים-additive-חדשים ל-`dex/office-feed.json`:
   - `learning` — כרטיס-היום מ-knowledge-cards.json (HE — **הצרכן-המכונתי-הראשון-שלהם**) + ספירת-מעורבות-חיצונית מ-learning-summary.json. tier-A: id/title/tag/ספירות-בלבד (סריקת-redaction: 0-פגיעות ב-39 הכותרות).
   - `mirror` — מדידת-גיל-כנה של dex/{onramp,showcase,relay}.json מול-חוק-48ש׳ — עד-שה-work-order-מספר-1 יבוצע, הפער **גלוי-לכל** בהזנה-הציבורית (רוח-הצו: אפס-שקר-טריות).
   - selftest הורחב (keys+redaction) וריצה-חיה ירוקה.
2. **Zip sovereign/UNWIRED-ASSETS-2026-10-11.md** — מסמך-זה (החיבור: ראיית-היתומים עצמה-נכס).
3. **Sandbox ops/office/work-orders.json** — 9 שורות-work-order (WO-unwired-dex-mirror P1 · steem-social-cadence / evo-windows / fleethq-gitignore P2 · potential-link / sandbox-ops-docs / cmmq-host / swe-guard / capability-fresh P3) — הערוץ-המוסכם; אפס-עריכה-במסילות-אחרים, R4.

*לא נגעתי: FleetHQ (מסילה-חמה zai-13/zai-code-5/zai-sec), ops/integrity, DECIDER, office3d, worlds, KEY-PROOF/GATE-STATUS/FLEET-BUS (11-lanes), COORDINATION.md (המתאם-סוגר).*

---

## 6) החיבור-החסר-היקר-ביותר (שורה-אחת)

**הצי מייצר ספרים-איכותיים מהר-משהוא קורא אותם:** הכיוון-הכלכלי-החסר הוא **צרכן-מנוהל-אחד לכל-ספר** — לולאת-ה-retro (11-d) כבר-רצה על-16 הזנות-ה-bus; היא-צריכה-לקבל-בבלימה-את-שני-המשפחות-היתומות-שנותרו: **ספרי-הלמידה (knowledge-cards-HE + reef/evo + swe-guard)** ו**ספרי-הכסף-הלא-משוקפים (onramp/showcase/relay)**. חוק-הבית-המוצע: *לכל-ספר-חדש — צרכן-מוצהר ביום-הולדתו, או מצבה-כנה ביום-השבוע* (כפי-ש-retired/TOMBSTONE.md כבר-מלמד).

---
*מפקד-נכסים · zai-12a · כל-שורה-נמדדה (grep/curl/od/API/git) · אפס-המצאה · R4 נשמר (work-orders למסילות-אחרים)*
