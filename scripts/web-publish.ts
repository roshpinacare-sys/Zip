#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · web-publish — סוכן הענן של רשת-האחסון הריבונית (R50).
//
// מה שנמדד בפועל (probe1/probe2, 2026-09-19):
//   · comment ב-Steem: בסיס 976M RC + 320k/תו — מסלול מת.
//   · custom_json ב-Steem: בסיס ~65M + 320k/תו — המסלול החי.
//   · Hive: 509k/תו — יקר יותר. Steem הוא הנתיב.
//
// הארכיטקטורה על השרשרת (חשבון העוגן, סמכות posting):
//   · מניפסט: custom_json id=saos.web.v1 — חותם-sha256 של החבילה.
//     הולך ראשון, עולה ~110M RC — נוחת בריצה הראשונה שיש לה תקציב.
//   · צ׳אנקים: custom_json id=saos.web.c.v1 {h,i,d} — הבייטים עצמם,
//     בגודל שנקבע לפי המנה החיה בעת השידור (adaptive). מצטבר עד שלמות.
//   · שלמות = join(d) במיון-i ⇒ אורך s + sha256 של המניפסט. שום "אמון".
//
// אידמפוטנטי לחלוטין: סריקת היסטוריה לפני כל שידור; דילוג-כנה כשאין
// RC; הקומיט מתעדכן רק בריצה חיה. ההיסטוריה השופטת היחידה: השרשרת.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  WEB_OP_ID,
  WEB_CHUNK_OP_ID,
  WEB_PROTOCOL,
  WEB_ACCOUNT,
  sha256Hex,
  type WebInboxJob,
  type WebManifest,
} from "@/lib/web/netstore";
import { steemBroadcast, rpcV4, STEEM_RPC_NODES } from "@/lib/weave/graphene";
import type { GrapheneOperation } from "steem";

const ROOT = path.resolve(__dirname, "..");
const INBOX = path.join(ROOT, "sovereign", "web", "inbox");
const MANIFESTS = path.join(ROOT, "sovereign", "web", "manifests");
const PACKAGES = path.join(ROOT, "sovereign", "web", "packages");

const DRY = process.argv.includes("--dry");
const VERIFY_ONLY = process.argv.includes("--verify-only");
const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();
const ACCOUNT = WEB_ACCOUNT;

/** רצפת בטיחות: לא שולחים את הרשת מתחת לזה */
const RC_RESERVE = Number(process.env.WEB_RC_RESERVE || 20e6);
/** מודל המחיר שנלמד ממדידות probe2: cost ≈ BASE + K × אורך ה-json */
const RC_BASE = Number(process.env.WEB_RC_BASE || 65e6);
const RC_PER_CHAR = Number(process.env.WEB_RC_PER_CHAR || 320_000);
/** תוספת-בטיחות על האומדן */
const EST_MARGIN = 1.15;

let estBase = RC_BASE;
let estPerChar = RC_PER_CHAR;

// ── עזרי ריצה ────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[web-publish ${new Date().toISOString()}] ${msg}`);
}

function sh(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpcRead<T>(method: string, params: unknown): Promise<T | null> {
  for (const node of STEEM_RPC_NODES) {
    try {
      return await rpcV4<T>(node, method, params, 20_000);
    } catch {
      /* הצומת הבא */
    }
  }
  return null;
}

// ── מצב ה-RC החי ──────────────────────────────────────────────────────

interface RcAccount {
  max_rc: string | number;
  rc_manabar: { current_mana: string | number; last_update_time: number };
}

async function liveMana(): Promise<{ mana: number; max: number } | null> {
  const res = await rpcRead<{ rc_accounts: RcAccount[] }>("rc_api.find_rc_accounts", { accounts: [ACCOUNT] });
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

// ── סריקת ההיסטוריה — מה כבר על השרשרת ──────────────────────────────

interface HistoryScan {
  manifestOp: { block?: number; txid?: string } | null;
  chunks: Array<{ i: number; chars: number; block?: number; txid?: string }>;
  /** הגופים הגולמיים לשלב האימות הסופי */
  rawChunkMap: Map<number, { d: string; block?: number; txid?: string }>;
}

async function scanChain(hash: string): Promise<HistoryScan> {
  const out: HistoryScan = { manifestOp: null, chunks: [], rawChunkMap: new Map() };
  const hist = await rpcRead<Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string; block?: number }]>>(
    "condenser_api.get_account_history",
    [ACCOUNT, -1, 1000]
  );
  if (!Array.isArray(hist)) return out;
  for (const [, e] of hist) {
    const op = e.op;
    if (!op || op[0] !== "custom_json") continue;
    const id = op[1].id;
    if (id !== WEB_OP_ID && id !== WEB_CHUNK_OP_ID) continue;
    try {
      const pl = JSON.parse(String(op[1].json || "{}")) as {
        h?: string; i?: number; d?: string;
      };
      if (pl.h !== hash) continue;
      if (id === WEB_OP_ID) {
        out.manifestOp = { block: e.block, txid: e.trx_id };
      } else if (typeof pl.i === "number" && typeof pl.d === "string") {
        out.chunks.push({ i: pl.i, chars: pl.d.length, block: e.block, txid: e.trx_id });
        out.rawChunkMap.set(pl.i, { d: pl.d, block: e.block, txid: e.trx_id });
      }
    } catch {
      /* json זר */
    }
  }
  out.chunks.sort((a, b) => a.i - b.i);
  return out;
}

// ── שידור עם שער-RC לומד ─────────────────────────────────────────────

function estimateCost(jsonLen: number): number {
  return Math.round((estBase + estPerChar * jsonLen) * EST_MARGIN);
}

interface BroadcastOutcome {
  ok: boolean;
  skipped?: string;
}

async function guardedBroadcast(ops: GrapheneOperation[], jsonLen: number, label: string): Promise<BroadcastOutcome> {
  if (DRY || VERIFY_ONLY || !WIF) {
    return { ok: false, skipped: DRY ? "dry" : VERIFY_ONLY ? "verify-only" : "no-wif" };
  }
  const m = await liveMana();
  if (!m) return { ok: false, skipped: "rc-unreachable" };
  const need = estimateCost(jsonLen);
  if (m.mana < RC_RESERVE + need) {
    return {
      ok: false,
      skipped: `rc-budget (live=${(m.mana / 1e6).toFixed(0)}M < reserve=${(RC_RESERVE / 1e6).toFixed(0)}M + est=${(need / 1e6).toFixed(0)}M — דילוג-כנה, ה-cron ינסה שוב)`,
    };
  }
  const before = m.mana;
  const res = await steemBroadcast(ops, WIF);
  if (!res.txid && res.note) {
    // כישלון RC מלמד את המודל: "needs X RC" חושף את המחיר האמיתי
    const mm = /needs (\d+) RC/.exec(res.note);
    if (mm) {
      const real = Number(mm[1]);
      estBase = Math.max(1e6, Math.round(real - estPerChar * jsonLen));
      log(`  · מחיר אמיתי מהדחיה: ${real} RC ⇒ בסיס נלמד ${(estBase / 1e6).toFixed(0)}M`);
    }
    return { ok: false, skipped: `broadcast-rejected: ${res.note.slice(0, 140)}` };
  }
  const after = await liveMana();
  if (after) {
    const cost = Math.max(0, before - after.mana);
    if (cost > 0) {
      // למידה חיה של הקבועים
      estBase = Math.max(1e6, cost - estPerChar * jsonLen);
      log(`  · עלות נמדדה: ${(cost / 1e6).toFixed(1)}M RC (בסיס נלמד ${(estBase / 1e6).toFixed(0)}M)`);
    }
  }
  log(`  · ${label} שודר ✓`);
  return { ok: true };
}

// ── בניית הפעולות ─────────────────────────────────────────────────────

function manifestOp(manifest: WebManifest): { op: GrapheneOperation; jsonLen: number } {
  // המניפסט על השרשרת — קומפקטי בכוונה: כל תו עולה כסף
  const payload = {
    v: 1,
    protocol: WEB_PROTOCOL,
    name: manifest.name,
    sha256: manifest.sha256,
    bytes: manifest.bytes,
    mime: manifest.mime,
    entry: manifest.entry || "",
    s: manifest.b64len,
    at: manifest.at,
  };
  const json = JSON.stringify(payload);
  return {
    op: ["custom_json", {
      required_auths: [],
      required_posting_auths: [ACCOUNT],
      id: WEB_OP_ID,
      json,
    }],
    jsonLen: json.length,
  };
}

function chunkOp(hash: string, i: number, data: string): { op: GrapheneOperation; jsonLen: number } {
  const json = JSON.stringify({ v: 1, h: hash, i, d: data });
  return {
    op: ["custom_json", {
      required_auths: [],
      required_posting_auths: [ACCOUNT],
      id: WEB_CHUNK_OP_ID,
      json,
    }],
    jsonLen: json.length,
  };
}

/** גודל צ׳אנק שהמנה החיה מרשה — מינימום אמיתי 500 תווים */
function affordableChars(mana: number, remaining: number): number {
  const budget = Math.floor((mana - RC_RESERVE - estBase) / estPerChar);
  return Math.max(0, Math.min(remaining, Math.min(Math.max(500, budget), 6500)));
}

// ── רשומת המניפסט בריפו ──────────────────────────────────────────────

interface RepoRecord {
  manifest: WebManifest;
  status: "pending-seal" | "partial" | "complete";
  chain: {
    manifestOp?: { block?: number | null; txid?: string | null } | null;
    chunks?: Array<{ i: number; chars: number; block?: number | null; txid?: string | null }>;
  };
  inboxJob?: WebInboxJob;
  publishedBy?: string;
  verifiedAt?: string;
  note?: string;
}

function writeRecord(rec: RepoRecord): void {
  fs.mkdirSync(MANIFESTS, { recursive: true });
  fs.writeFileSync(path.join(MANIFESTS, `${rec.manifest.sha256}.json`), JSON.stringify(rec, null, 2) + "\n");
}

function readRecord(hash: string): RepoRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(MANIFESTS, `${hash}.json`), "utf8")) as RepoRecord;
  } catch {
    return null;
  }
}

// ── פרסום חבילה אחת ──────────────────────────────────────────────────

async function publishJob(job: WebInboxJob): Promise<"complete" | "progress" | "skipped"> {
  const hash = job.sha256;
  log(`חבילה: ${job.name} · ${job.bytes}B · sha256=${hash.slice(0, 16)}…`);

  const b64Path = path.join(INBOX, hash, "package.b64");
  if (!fs.existsSync(b64Path)) {
    log("  package.b64 חסר — דילוג");
    return "skipped";
  }
  const b64 = fs.readFileSync(b64Path, "utf8").trim();
  const bytes = Buffer.from(b64, "base64");
  if (sha256Hex(bytes) !== hash || bytes.length !== job.bytes) {
    log("  שלמות נכשלה — דילוג");
    return "skipped";
  }

  // עותק כתובת-חשיש למשמרת (ההגשה מאמתת אותו מול החותם שעל השרשרת)
  const binPath = path.join(PACKAGES, `${hash}.bin`);
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(PACKAGES, { recursive: true });
    fs.writeFileSync(binPath, bytes);
  }

  const manifest: WebManifest = {
    v: 1,
    protocol: WEB_PROTOCOL,
    name: job.name,
    sha256: hash,
    bytes: job.bytes,
    mime: job.mime,
    entry: job.entry,
    b64len: b64.length,
    chunkSize: 0, // גדלים אדפטיביים — השלמות נקבעת באורך+חשיש, לא בספירה
    mode: "chunks",
    by: ACCOUNT,
    at: job.createdAt || new Date().toISOString(),
  };

  const rec: RepoRecord = readRecord(hash) || {
    manifest,
    status: "pending-seal",
    chain: { manifestOp: null, chunks: [] },
    inboxJob: job,
    publishedBy: "cloud/web-publish",
  };
  // רענון שדות המשימה
  rec.inboxJob = job;

  const chain = await scanChain(hash);
  const charsOnChain = chain.chunks.reduce((s, c) => s + c.chars, 0);
  log(`  שרשרת: מניפסט ${chain.manifestOp ? "✓" : "—"} · צ׳אנקים ${chain.chunks.length} · תווים ${charsOnChain}/${b64.length}`);

  // 1. החותם (המניפסט) — הולך ראשון
  if (!chain.manifestOp) {
    const { op, jsonLen } = manifestOp(manifest);
    const out = await guardedBroadcast([op], jsonLen, "מניפסט");
    if (!out.ok) {
      rec.note = `מניפסט: ${out.skipped}`;
      if (!DRY && !VERIFY_ONLY) writeRecord(rec);
      log(`  ⏳ ${rec.note}`);
      return "progress";
    }
    // אימות מההיסטוריה — השופטת היחידה
    let ok = false;
    for (let t = 0; t < 6 && !ok; t++) {
      await sleep(4000);
      const again = await scanChain(hash);
      if (again.manifestOp) {
        rec.chain.manifestOp = again.manifestOp;
        ok = true;
      }
    }
    if (!ok) {
      rec.note = "המניפסט שודר אך טרם נראה בהיסטוריה — נאמת בריצה הבאה";
      if (!DRY && !VERIFY_ONLY) writeRecord(rec);
      return "progress";
    }
    log(`  · החותם על השרשרת ✓ ${JSON.stringify(rec.chain.manifestOp)}`);
  } else {
    rec.chain.manifestOp = chain.manifestOp;
  }
  rec.status = "partial";

  // 2. הצ׳אנקים — בקצב ה-RC האמיתי
  const seenIdx = new Set(chain.chunks.map((c) => c.i));
  const nextIdx = (chain.chunks.length ? Math.max(...chain.chunks.map((c) => c.i)) : 0) + 1;
  const remaining = b64.length - charsOnChain;
  void seenIdx;

  if (remaining > 0) {
    const m = await liveMana();
    if (!m) {
      rec.note = "RC לא נקרא — דילוג-כנה";
      writeRecordIfLive(rec);
      return "progress";
    }
    const size = affordableChars(m.mana, remaining);
    if (size < 500) {
      rec.note = `צ׳אנק הבא ממתין ל-RC (מנה ${(m.mana / 1e6).toFixed(0)}M ⇒ ${(estBase / 1e6).toFixed(0)}M+500×0.32M נדרשים)`;
      writeRecordIfLive(rec);
      log(`  ⏳ ${rec.note}`);
      return "progress";
    }
    const start = charsOnChain;
    const data = b64.slice(start, start + size);
    const { op, jsonLen } = chunkOp(hash, nextIdx, data);
    const out = await guardedBroadcast([op], jsonLen, `צ׳אנק ${nextIdx} (${size} תווים)`);
    if (!out.ok) {
      rec.note = `צ׳אנק ${nextIdx}: ${out.skipped}`;
      writeRecordIfLive(rec);
      log(`  ⏳ ${rec.note}`);
      return "progress";
    }
    let landed = false;
    for (let t = 0; t < 6 && !landed; t++) {
      await sleep(4000);
      const again = await scanChain(hash);
      const hit = again.chunks.find((c) => c.i === nextIdx);
      if (hit) {
        rec.chain.chunks = again.chunks;
        landed = true;
      }
    }
    if (!landed) {
      rec.note = `צ׳אנק ${nextIdx} שודר אך טרם נראה — נאמת בריצה הבאה`;
      writeRecordIfLive(rec);
      return "progress";
    }
    log(`  · צ׳אנק ${nextIdx} על השרשרת ✓ (${size} תווים)`);
  }

  // 3. שלמות?
  const finalScan = await scanChain(hash);
  const finalChars = finalScan.chunks.reduce((s, c) => s + c.chars, 0);
  rec.chain.chunks = finalScan.chunks;
  if (finalChars === b64.length) {
    // הרכבה מסודרת-אינדקס ואימות סופי — sha256 הוא השופט
    const parts = [...finalScan.rawChunkMap.keys()].sort((a, b) => a - b).map((i) => {
      const c = finalScan.rawChunkMap.get(i);
      if (!c) throw new Error(`צ׳אנק ${i} חסר בסריקה — סתירה פנימית`);
      return c.d;
    });
    const gotBytes = Buffer.from(parts.join(""), "base64");
    if (sha256Hex(gotBytes) === hash && gotBytes.length === job.bytes) {
      rec.status = "complete";
      rec.verifiedAt = new Date().toISOString();
      rec.note = "כל הבייטים על השרשרת ומאומתים";
      writeRecordIfLive(rec);
      log("  ✓ החבילה שלמה על השרשרת — מקצה לקצה");
      return "complete";
    }
    rec.note = "אימות-סופי נכשל — הריצה הבאה תחזור";
    writeRecordIfLive(rec);
    return "skipped";
  }

  rec.note = `מתקדם: ${finalChars}/${b64.length} תווים על השרשרת`;
  writeRecordIfLive(rec);
  log(`  ⏳ ${rec.note}`);
  return "progress";
}

function writeRecordIfLive(rec: RepoRecord): void {
  if (!DRY && !VERIFY_ONLY) writeRecord(rec);
}

function closeJob(hash: string): void {
  const dir = path.join(INBOX, hash);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  log(`סוכן שידור · חשבון=${ACCOUNT} · dry=${DRY} · verify-only=${VERIFY_ONLY} · wif=${WIF ? "יש" : "אין"}`);

  const m0 = await liveMana();
  if (m0) {
    log(`RC חי: ${(m0.mana / 1e6).toFixed(0)}M / ${(m0.max / 1e6).toFixed(0)}M (${((m0.mana / m0.max) * 100).toFixed(1)}%) · מודל מחיר: בסיס ${(estBase / 1e6).toFixed(0)}M + ${(estPerChar / 1e3).toFixed(0)}k/תו`);
  }

  if (!fs.existsSync(INBOX)) {
    log("אין דואר נכנס");
    return 0;
  }
  const jobs: WebInboxJob[] = [];
  for (const d of fs.readdirSync(INBOX)) {
    const jp = path.join(INBOX, d, "job.json");
    if (!fs.existsSync(jp)) continue;
    try {
      jobs.push(JSON.parse(fs.readFileSync(jp, "utf8")) as WebInboxJob);
    } catch {
      log(`משימה שחורה בתיקייה ${d}`);
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
    if (res === "complete") {
      closeJob(job.sha256);
      completed++;
    } else if (res === "progress") {
      progressed++;
    }
    const m = await liveMana();
    if (m && m.mana < RC_RESERVE) {
      log(`RC ברצפה (${(m.mana / 1e6).toFixed(0)}M) — עוצרים; ה-cron ימשיך`);
      break;
    }
  }

  if (DRY || VERIFY_ONLY) {
    log("דריי — אין גיט");
  } else {
    try {
      sh("git add -A sovereign/web");
      const status = sh("git status --porcelain -- sovereign/web");
      if (status.trim() !== "") {
        sh(`git commit -m "web-publish: ${completed} complete · ${progressed} in-progress · ${new Date().toISOString().slice(0, 16)}Z"`);
        sh("git push origin main");
        log("נדחף לריפו הריבוני");
      } else {
        log("אין שינויים לדחיפה");
      }
    } catch (e) {
      log(`שגיאת גיט: ${String(e).slice(0, 300)}`);
      return 1;
    }
  }
  return 0;
}

process.exit(await main());
