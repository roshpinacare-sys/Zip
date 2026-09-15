#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-anchor — קו ה-Steem/Hive מהספר (G2)
//
// הרשת הריבונית מעידה על עצמה מחוץ לגיטהאב: root של ה-checkpoint
// האחרון עולה כ-custom_json (id=saos.weave.core.v1, סמכות posting —
// "אפס סיכון הון" לפי מסמך המפתחות של הצי) על שתי שרשראות ציבוריות:
//   · Steem — steem-js native, העבר מדויק של הצי (Task 79/82)
//   · Hive  — חתימה מקומית עם chain_id + שער RC (דילוג-כנה, לא כשל)
//
// ההוכחה חוזרת לספר: אימות ANCHOR חתום (EIP-191, מפתח הענן מה-seal)
// שנושא את שני ה-txids — כל אדם יכול לאמת מחדש מול ה-RPC הציבורי.
//
// רץ בשני עולמות, אותה מכניקה:
//   · הענן (weave-anchor.yml, יומי) — מ-Actions Secrets: WEAVE_STEEM_WIF
//   · ה-runner הראשי (הסנדבוקס) — מ-.env.local: WEAVE_STEEM_WIF
//
// משמרת המפתח: ה-WIF לעולם לא בגיט, לא בלוגים; המקור — כספת הצי.
//
// דגלים: --dry (בלי שידור וכתיבה) · --no-push · --verify-only (קריאה בלבד)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { verifyLedger, ensureCloudAgent, ensureNetworkKeyFromSeal, createCheckpointNow } from "@/lib/weave/beat";
import { resolveOpenMarkets, type SettlementResult } from "@/lib/weave/market";
import { appendAttestation } from "@/lib/weave/ledger";
import { sealOpen } from "./weave-seal";
import {
  STEEM_RPC_NODES,
  HIVE_RPC,
  buildPostingCustomJson,
  steemBroadcast,
  hiveBroadcast,
  hiveRcGate,
  findInHistory,
  sleep,
  type GrapheneOperation,
} from "@/lib/weave/graphene";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const LINE_PATH = path.join(ROOT, "sovereign", "steem-line.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "anchor-report.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";

const IS_ACTIONS = !!process.env.GITHUB_ACTIONS;
const DRY = process.argv.includes("--dry");
const NO_PUSH = process.argv.includes("--no-push");
const VERIFY_ONLY = process.argv.includes("--verify-only");

// העד החי: חשבון-צי עם מפתח posting חי בשתי השרשראות (נמדד 2026-09-14:
// LIVE-MATCH ב-Steem וב-Hive כאחד, RC בריא). ניתן להחלפה דרך הסביבה.
const ACCOUNT = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const OP_ID = "saos.weave.core.v1";
const ANCHORS_RING = 32; // טבעת-64 קטנה — הספר הוא האמת, הקובץ רק מראה

const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();

interface AnchorRecord {
  checkpoint: number;
  root: string;
  attFrom: number;
  attTo: number;
  attestations: number;
  at: string;
  commit: string;
  account: string;
  txids: { steem: string | null; hive: string | null };
  hiveNote?: string | null;
  attSeq?: number;
  runner?: string;
}

interface SteemLine {
  line: string;
  account: string;
  opId: string;
  createdAt: string;
  anchors: AnchorRecord[];
  last?: AnchorRecord;
}

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

// ── שער הסודות (חוק הברזל) — מקור קנוני אחד: weave-gate ──
import { secretGate, filterKnownHashes } from "./weave-gate";

function readLine(): SteemLine {
  try {
    return JSON.parse(fs.readFileSync(LINE_PATH, "utf8")) as SteemLine;
  } catch {
    return { line: "steem+hive", account: ACCOUNT, opId: OP_ID, createdAt: new Date().toISOString(), anchors: [] };
  }
}

function writeLine(line: SteemLine): void {
  const capped = { ...line, anchors: line.anchors.slice(-ANCHORS_RING) };
  capped.last = capped.anchors[capped.anchors.length - 1] || undefined;
  fs.writeFileSync(LINE_PATH, JSON.stringify(capped, null, 2) + "\n");
}

async function localLedgerState(): Promise<{ count: number; head: string }> {
  const [last, count] = await Promise.all([
    db.attestation.findFirst({ orderBy: { seq: "desc" } }),
    db.attestation.count(),
  ]);
  return { count, head: last?.entryHash ?? "0x" + "0".repeat(64) };
}

async function main(): Promise<void> {
  const runner: "github-actions" | "local-primary" =
    IS_ACTIONS ? "github-actions" : "local-primary";
  const gitHead = gitOrNull("git rev-parse --short HEAD") ?? "unknown";
  const repoSlug = process.env.GITHUB_REPOSITORY ?? "roshpinacare-sys/Zip";
  const runUrl = process.env.GITHUB_SERVER_URL
    ? `${process.env.GITHUB_SERVER_URL}/${repoSlug}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  console.log(`[weave-anchor] runner=${runner} head=${gitHead} account=@${ACCOUNT} opId=${OP_ID}`);

  // 1. בענן — checkout טרי; מקומית — pull קודם (ה-remote הוא האמת)
  if (runner === "local-primary" && gitOrNull("git remote get-url origin")) {
    const pull = gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`) ?? "";
    if (pull.includes("CONFLICT")) {
      throw new Error("קונפליקט pull — הרץ ידנית: git pull --rebase ואז weave-anchor");
    }
    if (pull) console.log("[weave-anchor] pull:", pull.split("\n").slice(-2).join(" "));
  }

  // 2. ייבוא ledger.json אם הקובץ חדש מה-DB המקומי
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const local = await localLedgerState();
    if (snap.chainCount > local.count) {
      const res = await importLedger(snap);
      console.log(`[weave-anchor] יובאו ${res.imported.attestations} אימותים מ-ledger.json`);
    }
  }

  // 3. פתיחת seal — זהות הענן חותמת את אימות ה-ANCHOR
  const seal = sealOpen();
  const cloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
  console.log(`[weave-anchor] seal פתוח · cloud=${seal.cloudAddress} (חותם העדות)`);
  // השלמת מפתח הרשת מה-seal — אותו לקח של run #3 של הלב: ייבוא הספר משאיר
  // את השורה ללא devKey, וה-checkpoint שהעוגן יוצר ייכשל בלי זה
  await ensureNetworkKeyFromSeal(seal.networkKeyHex);
  console.log(`[weave-anchor] מפתח רשת הושלם מה-seal · ${seal.networkAddress}`);

  // 4. הספר חייב להיות תקין לפני כל עדות
  const verify = await verifyLedger();
  if (!verify.valid) {
    throw new Error(`הספר שבור (firstBreak=${verify.firstBreak ?? "?"}) — אין עדות על ספר שקרי`);
  }
  console.log(`[weave-anchor] ledger תקין: ${verify.checked} אימותים · ${verify.sigOk}/${verify.checked} חתימות`);

  // 5. ה-checkpoint האחרון — מה שעולה לשרשרת
  const cp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
  if (!cp) {
    throw new Error("אין checkpoint בספר — הרץ פעימה קודם (weave-beat)");
  }

  const line = readLine();
  const alreadyAnchored = line.last && line.last.root === cp.root;

  // 6. dedupe: root זה כבר עוגן ⇒ אימות-קריאה בלבד (ההיסטוריה השופטת)
  if (alreadyAnchored || VERIFY_ONLY) {
    const last = line.last;
    let stillOnChain: string | null = null;
    if (last && last.txids.steem) {
      stillOnChain = await findInHistory(STEEM_RPC_NODES[0], ACCOUNT, OP_ID, last.at, 2, 100).catch(() => null);
    }
    const report = {
      at: new Date().toISOString(),
      runner,
      mode: "ALREADY-ANCHORED (verify-only)",
      checkpoint: { index: cp.index, root: cp.root },
      lastAnchor: last ?? null,
      historyReadback: stillOnChain
        ? { verdict: "ON-CHAIN", txid: stillOnChain }
        : { verdict: last ? "READBACK-EMPTY (history window or node blind)" : "no-anchor-yet" },
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(
      `[weave-anchor] root ${cp.root.slice(0, 14)}… כבר עוגן (cp#${last?.checkpoint ?? "?"}) · ` +
        `readback=${report.historyReadback.verdict} — אין שידור חדש`
    );
    return;
  }

  // 7. בניית המטען — קנוני, מתועד, ניתן לאימות עצמאי
  const at = new Date().toISOString();
  const attestations = await db.attestation.count();
  const headRow = await db.attestation.findFirst({ orderBy: { seq: "desc" } });
  const payload = {
    protocol: "saos-weave-core/v1",
    action: "checkpoint",
    at,
    net: "weave-core",
    repo: repoSlug,
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    attestations,
    headHash: headRow?.entryHash ?? "0x" + "0".repeat(64),
    commit: gitHead,
  };
  const op: GrapheneOperation = buildPostingCustomJson(ACCOUNT, OP_ID, payload);

  console.log(
    `[weave-anchor] מעגן cp#${cp.index} · root=${cp.root.slice(0, 18)}… · att ${cp.attFrom}..${cp.attTo} · ${DRY ? "DRY" : WIF ? "שידור" : "אין WIF — DRY כנה"}`
  );

  if (DRY || !WIF) {
    const report = {
      at,
      runner,
      mode: DRY ? "DRY" : "NO-WIF (honest dry — key not in env)",
      payload,
      note: "לא שודר דבר; לא נכתבה עדות. הוכחה או לא קרה.",
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log("[weave-anchor] DRY — הודגם בלבד, לא שודר ולא נדחף");
    return;
  }

  // 8. שידור — Steem ראשי (חינם), Hive מאחורי שער RC (דילוג-כנה)
  //    (הלקח מהמדידה הראשונה: operations הוא מערך-פעולות — [op] ולא op)
  const txids: { steem: string | null; hive: string | null } = { steem: null, hive: null };
  const notes: string[] = [];

  const st = await steemBroadcast([op], WIF);
  txids.steem = st.txid;
  if (st.note) notes.push(`steem: ${st.note}`);
  console.log(`[weave-anchor] steem: ${st.txid ? `שודר ✓ ${st.txid.slice(0, 12)}…` : `לא אושר — ${st.note ?? ""}`}`);

  let hiveSkipped: string | null = null;
  const gate = await hiveRcGate(ACCOUNT).catch(() => null);
  if (gate && !gate.ok) {
    hiveSkipped = gate.reason ?? "rc-gated";
    notes.push(`hive: ${hiveSkipped}`);
    console.log(`[weave-anchor] hive: דילוג-כנה — ${hiveSkipped}`);
  } else {
    const hv = await hiveBroadcast([op], WIF);
    if (hv.note) notes.push(`hive: ${hv.note}`);
    console.log(
      `[weave-anchor] hive: ${
        hv.accepted
          ? `השידור התקבל — ממתין לאישור היסטוריה`
          : `נכשל — ${hv.note ?? "?"}`
      }`
    );
  }

  // 9. אישור מההיסטוריה — השופטת היחידה (שני הכיוונים)
  for (let i = 0; i < 5 && !txids.steem; i++) {
    await sleep(3000);
    for (const node of STEEM_RPC_NODES) {
      txids.steem = await findInHistory(node, ACCOUNT, OP_ID, at, 1, 100).catch(() => null);
      if (txids.steem) break;
    }
  }
  if (!hiveSkipped) {
    for (let i = 0; i < 5 && !txids.hive; i++) {
      await sleep(3000);
      txids.hive = await findInHistory(HIVE_RPC, ACCOUNT, OP_ID, at, 2, 100).catch(() => null);
    }
  }

  const landed = [txids.steem, txids.hive].filter(Boolean).length;
  console.log(
    `[weave-anchor] עיגון הושלם: ${landed}/2 שרשראות` +
      (txids.steem ? ` · steem ${txids.steem.slice(0, 12)}…` : "") +
      (txids.hive ? ` · hive ${txids.hive.slice(0, 12)}…` : "")
  );

  if (landed === 0) {
    // אף שרשרת לא קלטה — כישלון כנה, אין עדות, הריצה אדומה; הניסיון הבא יעגן
    const report = {
      at,
      runner,
      mode: "BROADCAST-FAILED (no chain landed — honest red, nothing attested)",
      payload,
      notes,
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    throw new Error(`העיגון נכשל בשתי השרשראות — ${notes.join(" | ")}`);
  }

  // 10. העדות חוזרת לספר — txids בראיה, חתום במפתח הענן
  const explorerSteem = txids.steem ? `https://steemscan.com/transaction/${txids.steem}` : null;
  const explorerHive = txids.hive ? `https://hiveblockexplorer.com/tx/${txids.hive}` : null;
  const claim =
    `קו Steem/Hive: checkpoint #${cp.index} root ${cp.root.slice(0, 18)}… עוגן on-chain ` +
    `כ-custom_json ${OP_ID} מאת @${ACCOUNT} (סמכות posting) — עד חיצוני ציבורי ובלתי-תלוי בגיטהאב לאמת הספר.`;
  const evidence = [
    `steemTxid=${txids.steem ?? "null"}`,
    `hiveTxid=${txids.hive ?? "null"}`,
    `account=${ACCOUNT}`,
    `opId=${OP_ID}`,
    `authority=posting`,
    `checkpoint=${cp.index} root=${cp.root} attFrom=${cp.attFrom} attTo=${cp.attTo}`,
    `attestations=${attestations}`,
    `headHash=${headRow?.entryHash}`,
    `commit=${gitHead}`,
    explorerSteem ? `explorerSteem=${explorerSteem}` : null,
    explorerHive ? `explorerHive=${explorerHive}` : null,
    `payloadAt=${at}`,
    `runner=${runner}`,
    runUrl ? `run=${runUrl}` : null,
    hiveSkipped ? `hiveSkip=${hiveSkipped}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const att = await appendAttestation({
    agentId: cloudAgent.id,
    claim,
    claimType: "ANCHOR",
    evidence,
  });
  console.log(`[weave-anchor] אימות ANCHOR נכתב: seq=${att.seq} · entry=${att.entryHash.slice(0, 18)}…`);

  // סולם-ההוכחות: checkpoint חדש שמכסה את אימות ה-ANCHOR — כך העוגן הבא
  // (בענן, מחר) מעיד על checkpoint שכולל את ראיית העיגון של היום.
  const newCp = await createCheckpointNow();
  if (newCp) {
    console.log(`[weave-anchor] checkpoint #${newCp.index} נוצר (מכסה att ${newCp.attFrom}..${newCp.attTo}) · root=${newCp.root.slice(0, 16)}…`);
  }

  // 10.5 שוק האמת — המכריע רוכב על קו העיגון (Task 19, תיקון באג חבוי):
  //      העוגנים חיים תמיד — כל ריצה יוצרת checkpoint חדש שהריצה הבאה
  //      מעגנת — ולכן הספר "טרי" לנצח מעצם קיומם. אבל הלב הענן מפיק
  //      פעימה מלאה רק ב-TAKEOVER — שלעולם לא מגיע כשהעוגנים מזינים
  //      את איתות הטריות. התוצאה שנתפסה בקריאה: resolveOpenMarkets
  //      לעולם לא רץ בענן — שווקים פתוחים נתלים לנצח. התיקון: קו
  //      העיגון עצמו נושא את המכריע — 4 פעמים ביום, על ספר שזה עתה
  //      אומת (fail-closed: ספר שבור לא מסלק, כמו בפעימה §5.5).
  let marketSettlement: SettlementResult | null = null;
  let marketCheckpoint: { index: number; root: string } | null = null;
  if (verify.valid) {
    marketSettlement = await resolveOpenMarkets();
    if (marketSettlement.attSeqs.length > 0) {
      const mcp = await createCheckpointNow();
      if (mcp) marketCheckpoint = { index: mcp.index, root: mcp.root };
    }
    if (marketSettlement.settled.length > 0 || marketSettlement.refunded.length > 0) {
      console.log(
        `[weave-anchor] שוק האמת נסלק: ${marketSettlement.settled.length} הוכרעו · ${marketSettlement.refunded.length} הוחזרו · אימותים att${marketSettlement.attSeqs.join(",att")}${marketCheckpoint ? ` · cp#${marketCheckpoint.index}` : ""}`
      );
    }
  }

  // 11. רישום הקו + ייצוא הספר
  const record: AnchorRecord = {
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    attestations,
    at,
    commit: gitHead,
    account: ACCOUNT,
    txids,
    hiveNote: hiveSkipped,
    attSeq: att.seq,
    runner,
  };
  line.anchors.push(record);
  writeLine(line);

  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  console.log(`[weave-anchor] ledger.json ייוצא: ${snap.chainCount} אימותים · head=${snap.headHash.slice(0, 18)}…`);

  const report = {
    at,
    runner,
    mode: "ANCHORED",
    checkpoint: { index: cp.index, root: cp.root, attFrom: cp.attFrom, attTo: cp.attTo },
    txids,
    hiveSkipped,
    notes,
    attSeq: att.seq,
    nextCheckpoint: newCp ? { index: newCp.index, root: newCp.root } : null,
    ...(marketSettlement
      ? {
          market: {
            settled: marketSettlement.settled,
            refunded: marketSettlement.refunded,
            attSeqs: marketSettlement.attSeqs,
            checkpoint: marketCheckpoint,
          },
        }
      : {}),
    attestations: snap.chainCount,
    context: { runner, gitHead, repoSlug, runUrl },
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  if (NO_PUSH) {
    console.log("[weave-anchor] --no-push — הודגם, לא נדחף");
    return;
  }

  // 12. שער-סודות ודחיפה — כמו הלב; זהות העוגן בענן בלבד
  if (!gitOrNull("git remote get-url origin")) {
    throw new Error("אין remote origin — בלי ריפו אין עדות");
  }
  if (IS_ACTIONS) {
    sh('git config user.name "weave-anchor[bot]" && git config user.email "weave-anchor[bot]@users.noreply.github.com"');
  }
  execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
  const staged = gitOrNull("git diff --cached") ?? "";
  const leak = secretGate(filterKnownHashes(staged));
  if (leak) {
    execSync("git reset", { cwd: ROOT, stdio: "ignore" });
    throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff — כלום לא נדחף`);
  }
  const nFiles = (gitOrNull("git diff --cached --name-only") ?? "").split("\n").filter(Boolean).length;
  const marketNote = marketSettlement
    ? ` · market ${marketSettlement.settled.length}s/${marketSettlement.refunded.length}r`
    : "";
  const msg = `weave-anchor: ${at} · cp#${cp.index} · ${landed}/2 chains · att ${att.seq}${marketNote}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: "ignore" });
  const pushOut = gitOrNull(`git push origin ${BRANCH}`) ?? "push ok";
  console.log(`[weave-anchor] gitkeeper: ${nFiles} files · ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ANCHOR-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
