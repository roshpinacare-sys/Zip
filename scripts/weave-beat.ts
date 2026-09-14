#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-beat — ה-runner של מחזור הפעימה הריבוני
//
// רץ בשני עולמות, אותה מכניקה:
//   · הענן (GitHub Actions, .github/workflows/weave-heart.yml):
//       אם הספר "חי" (אימות/דחיפה טרייה מה-runner הראשי) ⇒ אימות-בלבד.
//       אם ישן/חסר ⇒ TAKEOVER: אימות → הרחבה → checkpoint → push.
//       השרשרת עצמה השופטת — כמו cloud-heart של הצי.
//   · ה-runner הראשי (הסנדבוקס/מקומי): פעימה מלאה תמיד (--local).
//
// זרימה:
//   pull → ייבוא ledger.json אם ה-remote חדש מהמקומי → פתיחת seal →
//   runBeat (verify→attest→checkpoint→שערים) → ייצוא ledger.json →
//   דוח → שער-סודות → commit+push.
//
// דגלים: --no-push (בדיקה מקומית בלי דחיפה) · --local (runner ראשי)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { runBeat, verifyLedger, type BeatContext } from "@/lib/weave/beat";
import { sealOpen } from "./weave-seal";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "beat-report.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";

const IS_ACTIONS = !!process.env.GITHUB_ACTIONS;
const FORCE_LOCAL = process.argv.includes("--local");
const NO_PUSH = process.argv.includes("--no-push");

// טריקות רעננות שהספר עצמו קובע: אימות אחרון או דחיפת גיט אחרונה
const STALE_ATTMin = Number(process.env.WEAVE_STALE_MIN || 26 * 60); // 26 שעות
const STALE_GIT_MIN = Number(process.env.WEAVE_GIT_STALE_MIN || 20 * 60); // 20 שעות
// דגל השתלטות ידנית: דולג על דוקטרינת החיים — הענן לוקח פיקוד גם אם
// הספר טרי (dispatch של force-beat). למד היטב: סף "999999" הפך הכול
// ל"טרי" והענן נסוג — נתפס במדידה (run #2, 2026-09-14) ותוקן בדגל מפורש.
const FORCE_BEAT = process.env.WEAVE_FORCE_BEAT === "1";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    throw new Error(`פקודה נכשלה: ${cmd}\n${(err.stderr || err.stdout || "").slice(-500)}`);
  }
}

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

// ── שער הסודות (חוק הברזל של gitkeeper) — לא דוחפים לעולם מפתח/PAT ──
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "steem/hive WIF", re: /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: "blurt WIF", re: /\bB[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: "EVM private key (64hex)", re: /\b0x[0-9a-fA-F]{64}\b/ },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "github_pat token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "x-access-token url", re: new RegExp("x-access-token:[A-Za-z0-9_\\-]+@") },
];

function secretGate(stagedDiff: string): string | null {
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(stagedDiff)) return p.name;
  }
  return null;
}

// חריגה מבוקרת: שדות hash ציבוריים (0x + 64hex בשם שדה קנוני) מוסרים מה-diff
// לפני השער — הם אינם סוד וכל אחד מאמת אותם מחדש. כל שורה אחרת שמכילה
// 64hex — כולל devKeyHex אמיתי או ערך חשוד בטקסט — נשארת ונתפסת ע"י השער.
function filterKnownHashes(diff: string): string {
  const KNOWN_HASH_FIELDS =
    /"(entryHash|root|prevRoot|prevHash|headHash|digest|recomputedHead|evidenceHash|leaf|sha256|id)"\s*:/i;
  const KNOWN_HASH_KV = /(headHash|recomputedHead|root|entryHash|digest|prevHash)=/i;
  return diff
    .split("\n")
    .filter((line) => {
      if (!/0x[0-9a-fA-F]{64}/.test(line)) return true; // אין 64hex — נשארת
      // שורת hash ציבורי מוכרת — מוסרת (השער לא צריך לראות אותה)
      if (KNOWN_HASH_FIELDS.test(line) || KNOWN_HASH_KV.test(line)) return false;
      return true; // 64hex לא מוכר — נשארת ותיבדק בשער
    })
    .join("\n");
}

async function localLedgerState(): Promise<{ count: number; head: string }> {
  const [last, count] = await Promise.all([
    db.attestation.findFirst({ orderBy: { seq: "desc" } }),
    db.attestation.count(),
  ]);
  return { count, head: last?.entryHash ?? "0x" + "0".repeat(64) };
}

async function main(): Promise<void> {
  const runner: BeatContext["runner"] = IS_ACTIONS && !FORCE_LOCAL ? "github-actions" : "local-primary";
  const gitHead = gitOrNull("git rev-parse --short HEAD") ?? "unknown";
  const repoSlug = process.env.GITHUB_REPOSITORY ?? "roshpinacare-sys/weave-core";
  const runUrl = process.env.GITHUB_SERVER_URL
    ? `${process.env.GITHUB_SERVER_URL}/${repoSlug}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  console.log(`[weave-beat] runner=${runner} head=${gitHead}`);

  // 1. בענן — checkout טרי; מקומית — pull קודם (ה-remote הוא האמת)
  if (runner === "local-primary" && gitOrNull("git remote get-url origin")) {
    const pull = gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`) ?? "";
    if (pull.includes("CONFLICT")) {
      throw new Error("קונפליקט pull — הרץ ידנית: git pull --rebase, ייבוא ledger.json, ואז beat");
    }
    if (pull) console.log("[weave-beat] pull:", pull.split("\n").slice(-2).join(" "));
  }

  // 2. ייבוא ledger.json אם הקובץ חדש מה-DB המקומי
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const local = await localLedgerState();
    if (snap.chainCount > local.count) {
      console.log(`[weave-beat] מייבא ledger.json: ${snap.chainCount} > ${local.count} מקומי`);
      const res = await importLedger(snap);
      console.log(
        `[weave-beat] יובאו ${res.imported.attestations} אימותים · מפתחות מקומיים נשמרו: ${res.keysPreserved.agents}`
      );
    } else if (snap.chainCount === local.count && snap.headHash !== local.head) {
      throw new Error(
        "סתירה: ledger.json וה-DB באותו אורך אבל head שונה — נדרשת בדיקה ידנית"
      );
    }
  }

  // 3. פתיחת seal — מפתחות הענן והרשת
  const seal = sealOpen();
  console.log(`[weave-beat] seal פתוח · cloud=${seal.cloudAddress} · network=${seal.networkAddress}`);

  // 4. דוקטרינת חיים (ענן בלבד): ספר טרי ⇒ אימות-בלבד, אין הרחבה
  //    force-beat דולג עליה — השתלטות ידנית מדגימה (SOV-2, אימון)
  if (runner === "github-actions" && FORCE_BEAT) {
    console.log("[weave-beat] FORCE-BEAT: dispatch ידני — הענן לוקח פיקוד ללא קשר לטריות");
  } else if (runner === "github-actions") {
    const lastAtt = await db.attestation.findFirst({ orderBy: { createdAt: "desc" } });
    const attAgeMin = lastAtt
      ? (Date.now() - lastAtt.createdAt.getTime()) / 60000
      : Infinity;
    const gitLast = gitOrNull("git log -1 --format=%cI");
    const gitAgeMin = gitLast ? (Date.now() - new Date(gitLast).getTime()) / 60000 : Infinity;
    const fresh = attAgeMin < STALE_ATTMin || gitAgeMin < STALE_GIT_MIN;

    if (fresh) {
      const verify = await verifyLedger();
      const report = {
        at: new Date().toISOString(),
        runner,
        mode: "ALIVE-VERIFY-ONLY",
        verdict: verify.valid ? "LEDGER-VALID (primary runner live — cloud stands down)" : "LEDGER-BROKEN",
        verify,
        beat: null,
        gatesClosed: [],
        freshness: {
          attestAgeMin: Number.isFinite(attAgeMin) ? Math.round(attAgeMin) : null,
          gitAgeMin: Number.isFinite(gitAgeMin) ? Math.round(gitAgeMin) : null,
        },
        context: { runner, gitHead, repoSlug, runUrl },
      };
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
      console.log(
        `[weave-beat] SANDBOX-ALIVE (attest ${Math.round(attAgeMin)}min / git ${Math.round(gitAgeMin)}min) — הענן נסוג, אימות בלבד`
      );
      console.log(`[weave-beat] verdict=${report.verdict} · checked=${verify.checked} · sigOk=${verify.sigOk}`);
      // אימות בלבד — לא דוחפים כלום (אפס כתיבה לשרשרת)
      return;
    }
    console.log(
      `[weave-beat] TAKEOVER: attest ${Math.round(attAgeMin)}min / git ${Math.round(gitAgeMin)}min — הענץ לוקח פיקוד`
    );
  }

  // 5. הפעימה עצמה
  const context: BeatContext = { runner, gitHead, repoSlug, runUrl };
  const result = await runBeat(context, seal.cloudKeyHex);

  console.log(
    `[weave-beat] verdict=${result.verdict} · checked=${result.verify.checked} · sigOk=${result.verify.sigOk}`
  );
  if (result.beat) {
    console.log(
      `[weave-beat] beat seq=${result.beat.seq} · entry=${result.beat.entryHash.slice(0, 18)}… · cp=${
        result.beat.checkpoint ? `#${result.beat.checkpoint.index} root=${result.beat.checkpoint.root.slice(0, 14)}…` : "אין חדש"
      }`
    );
  }
  if (result.gatesClosed.length > 0) {
    console.log(`[weave-beat] שערים שנסגרו: ${result.gatesClosed.map((g) => `${g.code}←att${g.attSeq}`).join(", ")}`);
  }

  // 6. ייצוא הספר + דוח
  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `[weave-beat] ledger.json ייוצא: ${snap.chainCount} אימותים · head=${snap.headHash.slice(0, 18)}…`
  );

  if (result.verdict !== "LEDGER-VALID") {
    // שרשרת שבורה — לא דוחפים, דוח אדום נשמר מקומית
    throw new Error(
      `השרשרת שבורה (firstBreak=${result.verify.firstBreak ?? "?"}) — הפעימה נעצרה, לא נדחף ספר שקרי`
    );
  }

  if (NO_PUSH) {
    console.log("[weave-beat] --no-push — הודגם בלבד, לא נדחף");
    return;
  }

  // 7. שער-סודות ואז דחיפה — בלי origin אין ריבונות; נכשלים בקול רם
  if (!gitOrNull("git remote get-url origin")) {
    throw new Error("אין remote origin — מוגדר: git remote add origin <url>. בלי ריפו אין פעימה");
  }
  // זהות הרץ בענן בלבד — כך שהיסטוריית הגיט מבדילה פעימות ענן מפעימות מקומיות
  if (IS_ACTIONS && !FORCE_LOCAL) {
    sh('git config user.name "weave-heart[bot]" && git config user.email "weave-heart[bot]@users.noreply.github.com"');
  }
  execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
  const staged = gitOrNull("git diff --cached") ?? "";
  const leak = secretGate(filterKnownHashes(staged));
  if (leak) {
    execSync("git reset", { cwd: ROOT, stdio: "ignore" });
    throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff — כלום לא נדחף`);
  }

  const nFiles = (gitOrNull("git diff --cached --name-only") ?? "").split("\n").filter(Boolean).length;
  const msg = `weave-heart: beat ${result.at} · seq ${result.beat?.seq ?? "?"} · ${result.verify.checked} att · ${result.verify.sigOk}/${result.verify.checked} sig`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: "ignore" });
  const pushOut = gitOrNull(`git push origin ${BRANCH}`) ?? "push ok";
  console.log(`[weave-beat] gitkeeper: ${nFiles} files · ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("BEAT-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
