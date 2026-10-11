# טקס-הגירת `recovery-meta.json` — vault-home (+ תאום-steem) (מוכן-לביצוע, ממתין-לבעלים)

> **מזהה-סוכן:** [zai-11b] · נולד מתוך `sovereign/OWNER-GATE-PLAYBOOK-2026-10-11.md` §G4 · צו-בעלים trace `1a12c9d6f5df1b95`.
> **מצב:** `MACHINE-READY` — הקוד המוצע, הרצף וה-rollback מוכנים במסמך זה. **לא נגענו ב-vault-home** (חוק-המשימה: ריפו-חי; גם-לא ב-steem).
> **חוק-ברזל:** אף-ערך-סיסמה לא נקרא, לא הודפס ולא נכתב במסמך זה. ההגירה מעבירה-את-הערכים **אל סוד-GitHub** שהבעלים מעדכן-בעצמו.

---

## 1 · מצב נמדד (2026-10-11T20:36Z)

- **שני-בתים נושאים את אותן-הסיסמאות בטקסט-גלוי ב-HEAD** (ריפואים **פרטיים**; לא-דליפה-ציבורית, אך-ניגוד-דוקטרינת "אפס-גלוי-ב-git"):
  - `vault-home @ vault-chain/recovery-meta.json` — pin-copy (`sovereign/bootstrap.sh:123-124` מכנה-אותו "keyring copy").
  - `steem @ saos-cockpit agent/recovery-meta.json` — המקור (`sealedAt 2026-10-08T04:50:39Z`).
- **השדות-בגלוי:** `keysZipPass`, `keysBackupPass` (אורך 32 כ"א; מבנה-מלא נמדד — 21-מפתחות-עליונים כולל `keysZipSha256`, `gpgKey`, `railsSeal`).
- **למה לא צונזר עד-היום (כנות):** קוראים-חיים: `saos-runtime/scripts/vault-drip.mjs` (ריפו-ציבורי על-דקות-חינם!), `Sandbox/boot/bootstrap.sh`, `steem/scripts/sovereign-restore.sh`, `steem/scripts/sovereign-selfcustody.mjs`, `steem/mini-services/saos-engine/hive.mjs` (custody-GEN1-META), `vault-home/sovereign/{bootstrap,verify}.sh`. צנזור-ישיר = שבירת-החייאה-בזמן-שהיא-רצה.
- **היסטוריה:** הסיסמאות קיימות-גם-בהיסטוריה של-שני-הריפואים. **כתיבה-מחדש של-היסטוריה אסורה-בחוק** (אין-force-push; COORDINATION-כלל-3) — לכן-הצנזור-כאן הוא **HEAD-only**, וזה-נאמר-בגלוי: הערכים נשארים-משוחזרים-מההיסטוריה-למי-שכבר-מחזיק-שכפול; ההגירה מסירה-את-הגלוי-מהעתיד (כל-קומיט-עתידי וכל-שכפול-חדש-רדוד) ומעבירה-את-הקאנון-לסוד. זו-אותה-מדיניות-שכבר-הופעלה-ותועדה בסבב 9-b (Domain@32f / Console@8f).

## 2 · השינוי-המוצע (דוגמת-diff — **בתוך-המסמך, לא-ענף-דחוף**)

עיקרון: **סוד-קודם, קובץ-אחר-כך (transition-fallback), ואחר-הצנזור — הקובץ-המצונזר מזוהה-ונדחה-כנה** (לא-נופל-בשקט-על-נתון-ריק).

**שלב-קוד (לכל-קורא-Node של-ה-meta; להלן-דוגמת-עזר אחת לשימוש-בכל-הקוראים):**

```diff
--- a/scripts/recovery-meta-loader.mjs      (קובץ-חדש — מוצע)
+++ b/scripts/recovery-meta-loader.mjs
+// RECOVERY-META-LOADER — סוד-קודם, קובץ-אחר-כך; קובץ-מצונזר = דחייה-כנה.
+// הקאנון: סוד GitHub RECOVERY_META_JSON (מלא, תקף). הקובץ: רק-עד-הצנזור.
+export function loadRecoveryMeta(filePath, env = process.env) {
+  if (env.RECOVERY_META_JSON) {
+    try { return { src: "secret", meta: JSON.parse(env.RECOVERY_META_JSON) }; }
+    catch { throw new Error("RECOVERY_META_JSON set but not valid JSON — fail-closed"); }
+  }
+  const fs = require("node:fs");
+  const raw = fs.readFileSync(filePath, "utf8");
+  const meta = JSON.parse(raw);
+  if (typeof meta.keysZipPass !== "string" || /REDACTED/i.test(meta.keysZipPass)) {
+    throw new Error("recovery-meta file is redacted at HEAD and RECOVERY_META_JSON is absent — set the secret (fail-closed)");
+  }
+  return { src: "file", meta };
+}
```

**ועבור-קוראי-ה-shell (vault-home/sovereign/{verify,bootstrap}.sh):**

```diff
--- a/sovereign/verify.sh
+++ b/sovereign/verify.sh
@@
-  KEYSZ="$(python3 -c "import json;print(json.load(open('$REPOS_DIR/steem/agent/recovery-meta.json'))['keysZipFile'])" 2>/dev/null || true)"
+  if [ -n "$RECOVERY_META_JSON" ]; then
+    KEYSZ="$(printf '%s' "$RECOVERY_META_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin)['keysZipFile'])" 2>/dev/null || true)"
+  else
+    KEYSZ="$(python3 -c "import json;print(json.load(open('$REPOS_DIR/steem/agent/recovery-meta.json'))['keysZipFile'])" 2>/dev/null || true)"
+  fi
```

(אותו-דפוס ב-`bootstrap.sh:123-127` — ה-meta נטען-מהסוד-אם-קיים; ברירת-המחדל-בהיעדרו נשארת-הקובץ בחלון-המעבר.)

**שלב-צנזור (קומיט-חד-פעמי, אחרי-מיזוג-הקוד):** החלפת-ערכי-שני-השדות בסמן:

```json
"keysZipPass":    "[REDACTED-2026-10-11 → GitHub secret RECOVERY_META_JSON; see sovereign/ceremonies/vault-home-recovery-meta-migration.md]",
"keysBackupPass": "[REDACTED-2026-10-11 → GitHub secret RECOVERY_META_JSON; see sovereign/ceremonies/vault-home-recovery-meta-migration.md]"
```

(שאר-21-השדות — sha256/pubAnchor/sealedAt — אינם-סודות ונשארים-כפי-שהם: הם-המאמתים שהסוד-תואם-את-הארכיונים.)

## 3 · הרצף המלא (המכונה מבצעת-את-שלבי-המכונה **רק אחרי** צעד-הבעלים)

1. **הבעלים (≈5 דק'):** מעלה **פעם-אחת** סוד `RECOVERY_META_JSON` — בשני-הריפואים שמריצים-קוראים (`steem` + `saos-runtime`; ואם-רוצים-נקיון-מלא — גם `vault-home` ו-`Sandbox`): התוכן = ה-JSON המלא-הנוכחי (הבעלים מוציא-אותו מהמחשב-האישי/הכספת; **לא דרך-צ'אט**).
2. **המכונה — ענף-קוד** (לפי-ה-diff לעיל) ב-`steem`, `saos-runtime`, `vault-home`, `Sandbox` — סדר: קודם-הקוראים, אחר-כך-ה-verify.
3. **המכונה — הוכחת-שקילות-selftest (השער-המכריע לפני-כל-צנזור):** רץ-שמשווה `{src:"secret"}` מול `{src:"file"}` — `deepEqual` על כל-ה-meta + בדיקת-כל-הקוראים-הקיימים מצליחים-משני-המקורות. **כשל-שקילות = עצירה-כנה, אף-צנזור לא קורה.**
4. **מיזוג** ל-main (rebase-first, additive-רוח) + ריצת-קוראים-חיה-אחת (vault-drip/custody) ירוקה-על-הסוד.
5. **המכונה — קומיט-צנזור-חד-פעמי ב-HEAD בלבד** (הדפוס-המוכח של 9-b): קומיט-אחד-פר-ריפו (steem@HEAD, vault-home@HEAD), שני-השדות-בלבד, אימות-JSON-תקף-אחרי-הכתיבה, אף-קומיט-היסטוריון-אחר-לא-נוגע.
6. **אימות-סופי:** קורא-חי אחד על-כל-בית ירוק (הסוד) + `git show HEAD:path` מציג-סמן-REDACTED + ה-selftest-מדווח `src:secret`.
7. **רישום:** COORDINATION.md (ע"י-המכונה) — הטקס-נסגר.

## 4 · Rollback (בכל-נקודה)

- **לפני-הצנזור:** מחיקת-הסוד → כל-הקוראים נופלים-לקובץ (התנהגות-היום בדיוק); ענף-הקוד מוסר/מוחזר.
- **אחרי-הצנזור:** הקובץ-ב-HEAD-מצונזר; שחזור-הגלוי-אם-ידרש = קומיט-התוכן-חזרה-ע"י-הבעלים-בלבד (וזה-בדיוק-מה-שהטקס-מכוון-למנוע). ההיסטוריה נשמרת-תמיד — הערכים-המקוריים ניתנים-לשחזור מההיסטוריה-על-ידי-הבעלים (`git show <commit>:path`) — מתועד-כאן-בגלוי, ולכן-הטקס-אינו-כלי-הצפנה-היסטורית אלא-משמעת-עתידית.
- **מה-הטקס לא עושה:** לא נוגע בארכיונים המוצפנים (KEYS-ZIP-*.enc), לא מחליף-סיסמאות-עצמן (רוטציה-של-הסיסמאות = החלטה-נפרדת של-הבעלים; אם-תעשה — הסוד מתעדכן-בהתאם וה-sha256-ב-meta מתעדכן-בטקס-נלווה).

## 5 · פקודות-אימות

```bash
# א. אין-גלוי-ב-HEAD (שני-הבתים):
git -C vault-home show HEAD:vault-chain/recovery-meta.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log({keysZipPass:j.keysZipPass.slice(0,12),keysBackupPass:j.keysBackupPass.slice(0,12)})})'
# צפי: "[REDACTED-…"
# ב. הקורא-החי ירוק על-הסוד:
RECOVERY_META_JSON="$(…)" node saos-runtime/scripts/vault-drip.mjs --selftest   # או-העוטף-המקובל
# ג. שקילות (בזמן-הטקס):
node scripts/recovery-meta-loader.mjs --equiv --file steem/agent/recovery-meta.json
```

## 6 · כנויות

- הסוד-מוחזק-ב-GitHub-Secrets (encrypted-at-rest) ב-2–4-ריפואים — שכפול-מודע של-חומר-שכבר-נמצא-בשני-בתים; הפחתה-מיידית של-שטח-הגלוי.
- ההיסטוריה-ההיסטורית-נותרת (HEAD-only-צנזור; חוק-אין-force-push). מי-שמחזיק-שכפול-מלא-היום — ממשיך-להחזיק; הטקס-מונע-הפצה-נוספת.
- **תלות-סדר:** אין-תלות-קשיחה ב-G3/R11 — אך-ההמלצה: לבצע **אחרי** סבבת-הרוטציות (G1/G3), כדי-שערוץ-השחזור-הקיים (הקובץ-הגלוי) יישאר-שלם-בזמן-שהרוטציות-רצות.
- קורא-אחד (`saos-runtime/scripts/vault-drip.mjs`) רץ-על-**דקות-ציבוריות** — שם-ההגירה-דחופה-במיוחד: הוא-הקורא-היחיד-של-סוד-פרטי-בסביבה-ציבורית.

---
*נוצר על-ידי [zai-11b] · 2026-10-11 · מסמך-תכנון בלבד — vault-home ו-steem לא נגעו.*
