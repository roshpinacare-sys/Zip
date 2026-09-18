#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · web-publish — סוכן הענן של רשת-האחסון (R50).
//
// משימה: לקחת חבילה מהדואר הנכנס של הריפו הריבוני ולהעלות אותה
// לשרשרת Steem הציבורית — בסמכות posting בלבד, מודד-עלות-חיה,
// אידמפוטנטי לחלוטין (כל צ׳אנק נבדק על השרשרת לפני שידור) וכנה
// בדילוג: אין RC ⇒ המשימה נשארת בתור והריצה הבאה מנסה שוב.
//
// מבנה על השרשרת (חשבון העוגן):
//   · מכולה: פוסט שורש permlink=saosweb-<hash10>, תג=saosweb,
//     גוף=מניפסט JSON (במצב inline גם התוכן עצמו)
//   · צ׳אנקים: תגובות על המכולה permlink=saosweb-<hash10>-c001..
//   · אינדקס: custom_json id=saos.web.v1 {h,n,s,at} — הולך אחרון
//
// מגבלות-אמת שהקוד מכבד:
//   · פוסט שורש אחד לכל 5 דקות (קונצנזוס Steem) — מרווח בין מכולות
//   · תגובה אחת לכל 20 שניות (MIN_REPLY_INTERVAL) — מרווח בין צ׳אנקים
//   · תקציב RC: שידור רק מעל רצפת בטיחות + אומדן-עלות שנלמד חי
//
// דגלים: --dry (בלי שידור) · --verify-only (קריאה בלבד)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  sha256Hex,
  containerPermlink,
  chunkPermlink,
  WEB_TAG,
  WEB_OP_ID,
  WEB_PROTOCOL,
  WEB_ACCOUNT,
  MAX_INLINE_B64,
  DEFAULT_CHUNK_B64,
  type WebInboxJob,
  type WebManifest,
  type WebManifestRecord,
} from "@/lib/web/netstore";
import { steemBroadcast, rpcV4, STEEM_RPC_NODES } from "@/lib/weave/graphene";
import type { GrapheneOperation } from "steem";

const ROOT = path.resolve(__dirname, "..");
const INBOX = path.join(ROOT, "sovereign", "web", "inbox");
const MANIFESTS = path.join(ROOT, "sovereign", "web", "manifests");

const DRY = process.argv.includes("--dry");
const VERIFY_ONLY = process.argv.includes("--verify-only");
const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();
const ACCOUNT = WEB_ACCOUNT;

/** רצפת בטיחות: לא שולחים את הרשת מתחת לזה (עתודה לקווי העוגן) */
const RC_RESERVE = Number(process.env.WEB_RC_RESERVE || 150e6);
/** אומדן התחלתי לעלות פעולה — מתעדכן ממדידה חיה */
let estCost = Number(process.env.WEB_RC_EST || 150e6);

const ROOT_POST_GAP_MS = 5.5 * 60_000; // קונצנזוס: 5 דקות בין פוסטי-שורש
const REPLY_GAP_MS = 21_000; // קונצנזוס: 20 שניות בין תגובות
let lastOpAt = 0;
let lastRootAt = 0;

// ── עזרי ריצה ────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[web-publish ${new Date().toISOString()}] ${msg}`);
}

function sh(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── RPC קריאה (ציבורי) ───────────────────────────────────────────────

async function rpcRead<T>(method: string, params: unknown): Promise<T | null> {
  for (const node of STEEM_RPC_NODES) {
    try {
      return await rpcV4<T>(node, method, params, 20_000);
    } catch {
      /* צומת הבא */
    }
  }
  return null;
}

interface RcAccount {
  max_rc: string | number;
  rc_manabar: { current_mana: string | number; last_update_time: number };
}

/** מנה חיה עם רגנרציה — אותה נוסחה מוכחת מ-graphene.ts */
async function liveMana(): Promise<{ mana: number; max: number } | null> {
  const res = await rpcRead<{ rc_accounts: RcAccount[] }>("rc_api.find_rc_accounts", {
    accounts: [ACCOUNT],
  });
  const a = res?.rc_accounts?.[0];
  if (!a) return null;
  let nowSec = Math.floor(Date.now() / 1000);
  try {
    const dgp = await rpcRead<{ time: string }>("condenser_api.get_dynamic_global_properties", []);
    if (dgp?.time) nowSec = Math.floor(new Date(dgp.time + "Z").getTime() / 1000);
  } catch {
    /* שעון מקומי */
  }
  const max = Number(a.max_rc);
  const lut = Number(a.rc_manabar.last_update_time);
  const mana = Math.min(max, Number(a.rc_manabar.current_mana) + Math.max(0, nowSec - lut) * (max / 432_000));
  return { mana: Math.round(mana), max };
}

interface ChainContent {
  author?: string;
  permlink?: string;
  body?: string;
  created?: string;
}

async function getContent(permlink: string): Promise<ChainContent | null> {
  const r = await rpcRead<ChainContent | null>("condenser_api.get_content", [ACCOUNT, permlink]);
  if (!r || !r.body || r.body.trim() === "") return null;
  return r;
}

/** איתור block/txid מההיסטוריה — ההיסטוריה השופטת היחידה (best-effort) */
async function findRef(permlink: string): Promise<{ block: number; txid: string } | null> {
  const hist = await rpcRead<Array<[number, { op?: [string, { permlink?: string }]; trx_id?: string; block?: number }]>>(
    "condenser_api.get_account_history",
    [ACCOUNT, -1, 80]
  );
  if (!Array.isArray(hist)) return null;
  for (const [, e] of [...hist].reverse()) {
    const op = e.op;
    if (!op || op[0] !== "comment") continue;
    if (op[1].permlink === permlink) {
      return { block: e.block ?? 0, txid: e.trx_id || "" };
    }
  }
  return null;
}

async function findAnchorRef(hash: string): Promise<{ block: number; txid: string } | null> {
  const hist = await rpcRead<Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string; block?: number }]>>(
    "condenser_api.get_account_history",
    [ACCOUNT, -1, 120]
  );
  if (!Array.isArray(hist)) return null;
  for (const [, e] of [...hist].reverse()) {
    const op = e.op;
    if (!op || op[0] !== "custom_json" || op[1].id !== WEB_OP_ID) continue;
    try {
      const pl = JSON.parse(String(op[1].json || "{}")) as { h?: string };
      if (pl.h === hash) return { block: e.block ?? 0, txid: e.trx_id || "" };
    } catch {
      /* דלג */
    }
  }
  return null;
}

// ── שידור (מפתח בענן בלבד) ──────────────────────────────────────────

interface BroadcastOutcome {
  ok: boolean;
  skipped?: string;
  cost?: number;
}

/** שידור פעולות עם שער-RC חי, מדידת עלות וכיבוד מרווחי-הקונצנזוס */
async function guardedBroadcast(
  ops: GrapheneOperation[],
  kind: "root" | "reply" | "json"
): Promise<BroadcastOutcome> {
  if (DRY || VERIFY_ONLY || !WIF) {
    return { ok: false, skipped: DRY ? "dry" : VERIFY_ONLY ? "verify-only" : "no-wif" };
  }
  // מרווחי קונצנזוס
  const gap = kind === "root" ? ROOT_POST_GAP_MS : REPLY_GAP_MS;
  const lastMark = kind === "root" ? lastRootAt : lastOpAt;
  const since = Date.now() - lastMark;
  if (since < gap) {
    return { ok: false, skipped: `interval (${Math.ceil((gap - since) / 1000)}s left)` };
  }
  // שער RC
  const m = await liveMana();
  if (!m) return { ok: false, skipped: "rc-unreachable" };
  if (m.mana < RC_RESERVE + estCost) {
    return {
      ok: false,
      skipped: `rc-budget (live=${(m.mana / 1e6).toFixed(0)}M < reserve=${(RC_RESERVE / 1e6).toFixed(0)}M + est=${(estCost / 1e6).toFixed(0)}M — honest skip, cron will retry)`,
    };
  }
  const before = m.mana;
  const res = await steemBroadcast(ops, WIF);
  if (!res.txid && res.note) {
    return { ok: false, skipped: `broadcast-rejected: ${res.note}` };
  }
  const after = await liveMana();
  const cost = after ? Math.max(0, before - after.mana) : undefined;
  if (cost && cost > 0) {
    estCost = Math.round(cost * 1.15); // למידה חיה + מרווח בטיחות
    log(`  · עלות נמדדה: ${(cost / 1e6).toFixed(1)}M RC (אומדן הבא: ${(estCost / 1e6).toFixed(0)}M)`);
  }
  lastOpAt = Date.now();
  if (kind === "root") lastRootAt = Date.now();
  return { ok: true, cost };
}

function commentOp(
  permlink: string,
  title: string,
  body: string,
  parentAuthor: string,
  parentPermlink: string,
  allowReplies: boolean
): GrapheneOperation[] {
  return [
    [
      "comment",
      {
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        author: ACCOUNT,
        permlink,
        title,
        body,
        json_metadata: JSON.stringify({
          app: "saos-web/1",
          format: "saos-web",
          sha256: "see-manifest",
          tags: [WEB_TAG, "saos"],
        }),
      },
    ],
    [
      "comment_options",
      {
        author: ACCOUNT,
        permlink,
        max_accepted_payout: "0.000 SBD",
        percent_steem_dollars: 0,
        allow_votes: false,
        allow_curation_rewards: false,
        allow_replies: allowReplies,
        extensions: [],
      },
    ],
  ];
}

// ── תוכנית החבילה ────────────────────────────────────────────────────

interface ChunkPlan {
  mode: "inline" | "chunks";
  b64: string;
  chunks: Array<{ i: number; permlink: string; sha256: string; body: string }>;
}

function planPackage(hash: string, b64: string): ChunkPlan {
  if (b64.length <= MAX_INLINE_B64) {
    return { mode: "inline", b64, chunks: [] };
  }
  const size = DEFAULT_CHUNK_B64;
  const chunks: ChunkPlan["chunks"] = [];
  for (let off = 0, i = 1; off < b64.length; off += size, i++) {
    const body = b64.slice(off, off + size);
    chunks.push({ i, permlink: chunkPermlink(hash, i), sha256: sha256Hex(body), body });
  }
  return { mode: "chunks", b64, chunks };
}

function buildManifest(job: WebInboxJob, plan: ChunkPlan): WebManifest {
  // at = חותמת היצירה של המשימה — קבועה. אם היה נגזר מזמן-הריצה,
  // כל ריצה חוזרת הייתה בונה גוף מניפסט שונה והאידמפוטנציה הייתה נשברת.
  const at = job.createdAt || new Date().toISOString();
  const m: WebManifest = {
    v: 1,
    protocol: WEB_PROTOCOL,
    name: job.name,
    sha256: job.sha256,
    bytes: job.bytes,
    mime: job.mime,
    entry: job.entry,
    b64len: plan.b64.length,
    chunkSize: plan.mode === "inline" ? 0 : DEFAULT_CHUNK_B64,
    mode: plan.mode,
    by: ACCOUNT,
    at,
  };
  if (plan.mode === "inline") {
    (m as WebManifest & { b64?: string }).b64 = plan.b64;
  } else {
    m.chunks = plan.chunks.map((c) => ({ i: c.i, permlink: c.permlink, sha256: c.sha256 }));
  }
  return m;
}

// ── פרסום חבילה אחת ──────────────────────────────────────────────────

interface PublishResult {
  status: "complete" | "progress" | "skipped";
  note: string;
  record?: WebManifestRecord;
  costTotal?: number;
}

async function publishJob(job: WebInboxJob): Promise<PublishResult> {
  const hash = job.sha256;
  log(`חבילה: ${job.name} · ${job.bytes}B · sha256=${hash.slice(0, 16)}…`);

  const b64Path = path.join(INBOX, hash, "package.b64");
  if (!fs.existsSync(b64Path)) {
    return { status: "skipped", note: "package.b64 חסר בדואר הנכנס" };
  }
  const b64 = fs.readFileSync(b64Path, "utf8").trim();
  const bytes = Buffer.from(b64, "base64");
  const gotHash = sha256Hex(bytes);
  if (gotHash !== hash) {
    return { status: "skipped", note: `שלמות נכשלה: ${gotHash.slice(0, 12)} ≠ ${hash.slice(0, 12)}` };
  }
  if (bytes.length !== job.bytes) {
    return { status: "skipped", note: `גודל שונה מהמוצהר: ${bytes.length} ≠ ${job.bytes}` };
  }

  const plan = planPackage(hash, b64);
  const manifest = buildManifest(job, plan);
  const manifestBody = JSON.stringify(manifest);
  if (manifestBody.length > 63_000) {
    return { status: "skipped", note: `גוף מניפסט ${manifestBody.length} > 63,000 — חריגה` };
  }
  log(`  · תוכנית: ${plan.mode}${plan.mode === "chunks" ? ` · ${plan.chunks.length} צ׳אנקים` : " (פוסט אחד)"}`);

  const record: WebManifestRecord = {
    manifest,
    status: "partial",
    chain: { container: undefined, chunks: [], anchor: null },
    publishedBy: "cloud/web-publish",
  };
  let costTotal = 0;

  // 1. מכולה
  const cPermlink = containerPermlink(hash);
  let cont = await getContent(cPermlink);
  if (!cont) {
    const ops = commentOp(cPermlink, `SAOS WEB · ${job.name}`, manifestBody, "", WEB_TAG, plan.mode === "chunks");
    const out = await guardedBroadcast(ops, "root");
    if (!out.ok) {
      return { status: "progress", note: `מכולה לא שודרה: ${out.skipped}`, costTotal };
    }
    costTotal += out.cost || 0;
    // אימות הופעה
    for (let t = 0; t < 6 && !cont; t++) {
      await sleep(4000);
      cont = await getContent(cPermlink);
    }
    if (!cont) {
      return { status: "progress", note: "המכולה שודרה אך לא נקראה חזרה — נאמת בריצה הבאה", costTotal };
    }
    log(`  · מכולה על השרשרת: ${cPermlink}`);
  } else if (cont.body !== manifestBody) {
    // קיים פוסט באותו permlink עם גוף שונה — התנגשות חשיש (פרקטית אפסית)
    return { status: "skipped", note: "התנגשות permlink — גוף קיים שונה מהמניפסט" };
  }
  const ref = await findRef(cPermlink);
  record.chain.container = { permlink: cPermlink, block: ref?.block ?? null, txid: ref?.txid ?? null };

  // 2. צ׳אנקים (מצב chunks בלבד)
  for (const ch of plan.chunks) {
    let c = await getContent(ch.permlink);
    if (!c) {
      const ops = commentOp(
        ch.permlink,
        `SAOS WEB · ${job.name} · צ׳אנק ${ch.i}/${plan.chunks.length}`,
        ch.body,
        ACCOUNT,
        cPermlink,
        false
      );
      const out = await guardedBroadcast(ops, "reply");
      if (!out.ok) {
        record.note = `צ׳אנק ${ch.i}/${plan.chunks.length}: ${out.skipped}`;
        if (!DRY && !VERIFY_ONLY) writeRecord(record, job);
        return { status: "progress", note: record.note, record, costTotal };
      }
      costTotal += out.cost || 0;
      for (let t = 0; t < 6 && !c; t++) {
        await sleep(4000);
        c = await getContent(ch.permlink);
      }
      if (!c) {
        record.note = `צ׳אנק ${ch.i} שודר אך לא נקרא חזרה — נאמת בריצה הבאה`;
        if (!DRY && !VERIFY_ONLY) writeRecord(record, job);
        return { status: "progress", note: record.note, record, costTotal };
      }
    }
    const got = sha256Hex(c.body);
    if (got !== ch.sha256) {
      return { status: "skipped", note: `צ׳אנק ${ch.i} על השרשרת לא תואם (${got.slice(0, 10)} ≠ ${ch.sha256.slice(0, 10)})` };
    }
    const cref = await findRef(ch.permlink);
    record.chain.chunks!.push({ permlink: ch.permlink, block: cref?.block ?? null, txid: cref?.txid ?? null });
    log(`  · צ׳אנק ${ch.i}/${plan.chunks.length} על השרשרת ✓`);
  }

  // 3. כל הגופים קיימים — אימות-סופי מהשרשרת
  const joined =
    plan.mode === "inline"
      ? (JSON.parse((await getContent(cPermlink))!.body) as WebManifest).b64 || ""
      : plan.chunks.map((ch) => ch.body).join("");
  const finalBytes = Buffer.from(joined, "base64");
  const finalHash = sha256Hex(finalBytes);
  if (finalHash !== hash || finalBytes.length !== job.bytes) {
    return { status: "skipped", note: "אימות-סופי מהשרשרת נכשל — לא נכתב מניפסט" };
  }

  // 4. עוגן אינדקס (custom_json) — אידמפוטנטי
  let anchorRef = await findAnchorRef(hash);
  if (!anchorRef) {
    const payload = {
      v: 1,
      protocol: WEB_PROTOCOL,
      pkg: job.name,
      h: hash,
      n: plan.mode === "inline" ? 1 : plan.chunks.length,
      s: job.bytes,
      at: manifest.at,
    };
    const ops: GrapheneOperation[] = [
      [
        "custom_json",
        {
          required_auths: [],
          required_posting_auths: [ACCOUNT],
          id: WEB_OP_ID,
          json: JSON.stringify(payload),
        },
      ],
    ];
    const out = await guardedBroadcast(ops, "json");
    if (out.ok) {
      costTotal += out.cost || 0;
      anchorRef = await findAnchorRef(hash);
      record.chain.anchor = { permlink: WEB_OP_ID, block: anchorRef?.block ?? null, txid: anchorRef?.txid ?? null, foundOnChain: !!anchorRef };
      log(`  · עוגן אינדקס שודר${anchorRef ? ` · בלוק ${anchorRef.block}` : ""}`);
    } else {
      record.chain.anchor = null;
      record.note = `התוכן על השרשרת במלואו; עוגן האינדקט נדחה בכנות: ${out.skipped}`;
    }
  } else {
    record.chain.anchor = { permlink: WEB_OP_ID, block: anchorRef.block, txid: anchorRef.txid, foundOnChain: true };
  }

  record.status = "complete";
  record.verifiedAt = new Date().toISOString();
  writeRecord(record, job);
  log(`  ✓ החבילה שלמה על השרשרת · מאומשה קריאה-חוזרת · עלות כוללת ${(costTotal / 1e6).toFixed(1)}M RC`);
  return { status: "complete", note: "על השרשרת ומאומת", record, costTotal };
}

function writeRecord(record: WebManifestRecord, job: WebInboxJob): void {
  fs.mkdirSync(MANIFESTS, { recursive: true });
  fs.writeFileSync(
    path.join(MANIFESTS, `${job.sha256}.json`),
    JSON.stringify({ ...record, inboxJob: job }, null, 2) + "\n"
  );
}

// ── סגירת משימה שהושלמה: הסרה מהדואר הנכנס ──────────────────────────

function closeJob(hash: string): void {
  const dir = path.join(INBOX, hash);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  log(`סוכן שידור רשת-האחסון · חשבון=${ACCOUNT} · dry=${DRY} · verify-only=${VERIFY_ONLY} · wif=${WIF ? "יש" : "אין"}`);

  // סטטוס RC פותח — מד חי
  const m0 = await liveMana();
  if (m0) {
    log(`RC חי: ${(m0.mana / 1e6).toFixed(0)}M / ${(m0.max / 1e6).toFixed(0)}M (${((m0.mana / m0.max) * 100).toFixed(1)}%) · רצפה=${(RC_RESERVE / 1e6).toFixed(0)}M`);
  } else {
    log("אזהרה: RC לא נקרא — ממשיכים בזהירות");
  }

  if (!fs.existsSync(INBOX)) {
    log("אין דואר נכנס — אין מה לשדר");
    return 0;
  }
  const jobs: WebInboxJob[] = [];
  for (const d of fs.readdirSync(INBOX)) {
    const jp = path.join(INBOX, d, "job.json");
    if (!fs.existsSync(jp)) continue;
    try {
      jobs.push(JSON.parse(fs.readFileSync(jp, "utf8")) as WebInboxJob);
    } catch {
      log(`משימה שחורה בתיקייה ${d} — דולג`);
    }
  }
  if (!jobs.length) {
    log("אפס משימות ממתינות");
    return 0;
  }
  log(`${jobs.length} משימות בתור`);

  let completed = 0;
  let progressed = 0;
  for (const job of jobs) {
    const res = await publishJob(job);
    if (res.status === "complete") {
      closeJob(job.sha256);
      completed++;
    } else if (res.status === "progress") {
      progressed++;
      log(`  ⏳ ${res.note}`);
      // עדכון ניסיונות ב-job.json — בריצה חיה בלבד (דריי לא נוגע בדיסק)
      if (!DRY && !VERIFY_ONLY) {
        try {
          const jp = path.join(INBOX, job.sha256, "job.json");
          const j = JSON.parse(fs.readFileSync(jp, "utf8")) as WebInboxJob;
          j.attempts = (j.attempts || 0) + 1;
          j.lastNote = res.note;
          fs.writeFileSync(jp, JSON.stringify(j, null, 2) + "\n");
        } catch {
          /* כבר נסגר? */
        }
      }
    } else {
      log(`  ✗ ${res.note}`);
    }
    // עצירה מנומסת: אם המנה ירדה קרוב לרצפה — עוצרים להיום
    const m = await liveMana();
    if (m && m.mana < RC_RESERVE) {
      log(`RC נמוך (${(m.mana / 1e6).toFixed(0)}M < רצפה) — עוצרים; ה-cron ימשיך`);
      break;
    }
  }

  // גיט: רק אם משהו השתנה — ובכלל-לא בדריי/אימות-בלבד (לקח הריצה
  // המקומית הראשונה: commit ללא שמירת-דגל יצר קומיטי-רעש מקומיים)
  const hasManifests = fs.existsSync(MANIFESTS) && fs.readdirSync(MANIFESTS).length > 0;
  try {
    if (DRY || VERIFY_ONLY) {
      log("דריי — אין גיט");
    } else {
      sh("git add sovereign/web/manifests sovereign/web/inbox");
      const status = sh("git status --porcelain -- sovereign/web");
      if (status.trim() !== "") {
        sh(`git commit -m "web-publish: ${completed} complete · ${progressed} in-progress · ${new Date().toISOString().slice(0, 16)}Z"`);
        sh("git push origin main");
        log("נדחף לריפו הריבוני");
      } else {
        log("אין שינויים לדחיפה");
      }
    }
  } catch (e) {
    log(`שגיאת גיט: ${String(e).slice(0, 300)}`);
    return 1;
  }
  void hasManifests;
  return 0;
}

process.exit(await main());
