// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · netstore — רשת-האחסון הריבונית: השרשרת הציבורית כאמת.
//
// דוקטרינה (פקודת המפעיל, R50): "האמת היא האימות של השרת על הרשת."
// שכבת האחסון (נמדד בפועל, probe1/probe2 2026-09-19):
//   · Steem custom_json — המסלול החי: בסיס ~65M RC + ~320k RC לתו.
//   · Steem comment — בסיס 976M RC — מסלול מת (מדידה קשה, כנה).
//   · Hive — 509k/תו, יקר יותר.
//
// מבנה על השרשרת (חשבון העוגן cashmachine, סמכות posting בלבד):
//   · חותם: custom_json id=saos.web.v1 {name, sha256, bytes, mime, entry,
//     s(b64len), at} — הולך ראשון. ~110M RC.
//   · צ׳אנקים: custom_json id=saos.web.c.v1 {h, i, d} — הבייטים עצמם,
//     בגודל אדפטיבי לפי המנה החיה. מצטבר עד שלמות (join ⇒ s ⇒ sha256).
//   · שלמות: join(d) לפי i ⇒ אורך s + sha256 חייבים להתאים לחותם.
//
// הגשה (השרת של הרשת): קודם צ׳אנקים מהשרשרת; מה שטרם הגיע מגיע
// מהעותק בריפו הריבוני (sovereign/web/packages/<hash>.bin) — אבל
// רק לאחר שה-sha256 שלו נבדק מול החותם שעל השרשרת. השרשרת היא
// השופטת; הריפו הוא רק מחסן מאומת.
//
// כל פונקציה כאן נטולת-מפתח: קריאה ואימות בלבד. השידור חי בענן
// (scripts/web-publish.ts + web-publish.yml) אצל WEAVE_STEEM_WIF.
// ─────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { inflateRawSync } from "zlib";
import { readFile } from "fs/promises";
import path from "path";
import {
  STEEM_RPC_NODES,
  rpcV4,
  type DynamicGlobalProperties,
} from "@/lib/weave/graphene";

// ── קבועים ──────────────────────────────────────────────────────────

export const WEB_TAG = "saosweb";
export const WEB_OP_ID = "saos.web.v1";
export const WEB_CHUNK_OP_ID = "saos.web.c.v1";
export const WEB_PROTOCOL = "saos-web/1";
export const WEB_ACCOUNT = (process.env.WEB_STEEM_ACCOUNT || "cashmachine").toLowerCase();

// ── טיפוסים ─────────────────────────────────────────────────────────

export interface WebChunk {
  i: number;
  chars: number;
  block?: number | null;
  txid?: string | null;
}

export interface WebManifest {
  v: 1;
  protocol: "saos-web/1";
  name: string;
  sha256: string;
  bytes: number;
  mime: string;
  entry?: string;
  b64len: number;
  chunkSize: number; // 0 = אדפטיבי
  mode: "chunks";
  by: string;
  at: string;
}

export interface WebManifestRecord {
  manifest: WebManifest;
  status: "pending-seal" | "partial" | "complete";
  chain: {
    manifestOp?: { block?: number | null; txid?: string | null } | null;
    chunks?: WebChunk[];
  };
  inboxJob?: {
    id: string;
    name: string;
    sha256: string;
    bytes: number;
    mime: string;
    entry?: string;
    status: string;
    createdAt: string;
    attempts?: number;
    lastNote?: string;
  };
  publishedBy?: string;
  verifiedAt?: string;
  note?: string;
}

export interface WebInboxJob {
  id: string;
  name: string;
  sha256: string;
  bytes: number;
  mime: string;
  entry?: string;
  status: "pending" | "uploading" | "done";
  createdAt: string;
  attempts?: number;
  lastNote?: string;
}

// ── עזרים ───────────────────────────────────────────────────────────

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function looksLikeSha256(hash: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash);
}

/** RPC ציבורי עם ניסיון חלופה בין צמתים */
async function steemRpc<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T | null> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      return await rpcV4<T>(node, method, params, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw new Error(`steem-rpc-unreachable: ${String(lastErr).slice(0, 120)}`);
  return null;
}

// ── סריקת ההיסטוריה — השרשרת מה יש עליה ──────────────────────────────

interface ChainWebOps {
  manifest: (WebManifest & { block?: number; txid?: string }) | null;
  chunks: Array<{ i: number; d: string; block?: number; txid?: string }>;
}

async function scanWebOps(hash: string, account: string = WEB_ACCOUNT): Promise<ChainWebOps> {
  const out: ChainWebOps = { manifest: null, chunks: [] };
  const hist = await steemRpc<Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string; block?: number }]>>(
    "condenser_api.get_account_history",
    [account, -1, 1000]
  );
  if (!Array.isArray(hist)) return out;
  for (const [, e] of hist) {
    const op = e.op;
    if (!op || op[0] !== "custom_json") continue;
    const id = op[1].id;
    if (id !== WEB_OP_ID && id !== WEB_CHUNK_OP_ID) continue;
    try {
      const pl = JSON.parse(String(op[1].json || "{}")) as Record<string, unknown>;
      if (pl.h !== undefined && pl.h !== hash && id === WEB_CHUNK_OP_ID) continue;
      if (id === WEB_OP_ID) {
        if (pl.sha256 !== hash) continue;
        out.manifest = {
          v: 1,
          protocol: WEB_PROTOCOL,
          name: String(pl.name || ""),
          sha256: String(pl.sha256 || ""),
          bytes: Number(pl.bytes || 0),
          mime: String(pl.mime || "application/octet-stream"),
          entry: pl.entry ? String(pl.entry) : undefined,
          b64len: Number(pl.s || 0),
          chunkSize: 0,
          mode: "chunks",
          by: account,
          at: String(pl.at || ""),
          block: e.block,
          txid: e.trx_id,
        };
      } else if (pl.h === hash && typeof pl.i === "number" && typeof pl.d === "string") {
        out.chunks.push({ i: pl.i, d: pl.d, block: e.block, txid: e.trx_id });
      }
    } catch {
      /* json זר */
    }
  }
  out.chunks.sort((a, b) => a.i - b.i);
  return out;
}

/** חותם החבילה מהשרשרת — null אם לא נחתם */
export async function loadManifestFromChain(hash: string): Promise<WebManifest | null> {
  const ops = await scanWebOps(hash);
  return ops.manifest;
}

// ── מטמון תוכן (כתובות-תוכן = בלתי-משתנות) ───────────────────────────

export interface PackageBytes {
  bytes: Buffer;
  manifest: WebManifest;
  /** מהיכן הגוף: שרשרת מלאה | ריפו מאומת-חותם */
  source: "chain" | "repo-sealed";
  /** כמה מהתווים כבר על השרשרת */
  chainChars: number;
  b64len: number;
}

const pkgCache = new Map<string, PackageBytes>();
const inflight = new Map<string, Promise<PackageBytes>>();
const CACHE_MAX = 48;

async function repoPackageBytes(hash: string): Promise<Buffer | null> {
  const p = path.join(process.cwd(), "sovereign", "web", "packages", `${hash}.bin`);
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}

/** בייטי החבילה — שרשרת קודם, ריפו-מאומת אחרי; חותם-שרשרת תמיד חובה. */
export async function fetchPackageBytes(hash: string): Promise<PackageBytes> {
  if (!looksLikeSha256(hash)) throw new Error("חשיש לא תקין — נדרש sha256 בן 64 תווי-הקס");
  const cached = pkgCache.get(hash);
  if (cached) return cached;
  const running = inflight.get(hash);
  if (running) return running;

  const task = (async (): Promise<PackageBytes> => {
    const ops = await scanWebOps(hash);
    if (!ops.manifest) {
      throw new Error("אין חותם על השרשרת עבור חשיש זה — החבילה לא נחתמה על ידי הרשת");
    }
    const m = ops.manifest;

    // 1) נסיון שרשרת-מלאה: הרכבה לפי אינדקס
    const joined = ops.chunks.map((c) => c.d).join("");
    if (joined.length === m.b64len) {
      const bytes = Buffer.from(joined, "base64");
      if (sha256Hex(bytes) === hash && bytes.length === m.bytes) {
        const entry: PackageBytes = { bytes, manifest: m, source: "chain", chainChars: joined.length, b64len: m.b64len };
        pkgCache.set(hash, entry);
        return entry;
      }
      throw new Error("אימות שרשרת נכשל — הבייטים שהורכבו אינם תואמים לחותם (דלג על ריפו: השרשרת השופטת)");
    }

    // 2) ריפו מאומת-חותם: המחסן מותר רק אם sha256 תואם לחותם שעל השרשרת
    const repoBytes = await repoPackageBytes(hash);
    if (!repoBytes) {
      throw new Error(
        `הצ׳אנקים על השרשרת חלקיים (${joined.length}/${m.b64len} תווים) ואין עותק-ריפו — ההגשה ממתינה להשלמת העלייה`
      );
    }
    if (sha256Hex(repoBytes) !== hash || repoBytes.length !== m.bytes) {
      throw new Error("עותק הריפו לא תואם לחותם שעל השרשרת — סירוב הגשה (השרשרת השופטת)");
    }
    const entry: PackageBytes = {
      bytes: repoBytes,
      manifest: m,
      source: "repo-sealed",
      chainChars: joined.length,
      b64len: m.b64len,
    };
    if (pkgCache.size >= CACHE_MAX) {
      const oldest = pkgCache.keys().next().value;
      if (oldest) pkgCache.delete(oldest);
    }
    pkgCache.set(hash, entry);
    return entry;
  })();

  inflight.set(hash, task);
  try {
    return await task;
  } finally {
    inflight.delete(hash);
  }
}

/** הצצה למטמון בלבד */
export function peekCache(hash: string): PackageBytes | undefined {
  return pkgCache.get(hash);
}

/** ניקוי מטמון של חבילה (אחרי התקדמות עלייה) */
export function evictCache(hash: string): void {
  pkgCache.delete(hash);
}

// ── קורא ZIP מינימלי (STORE + DEFLATE) — בלי תלות חוץ ────────────────

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function parseZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP לא תקין: לא נמצאה חתימת סוף-הארכיון");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`ZIP לא תקין: רשומת מדריך ${n} פגומה`);
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) {
      throw new Error(`ZIP לא תקין: כותרת מקומית של ${name} פגומה`);
    }
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`ZIP: שיטת דחיסה לא נתמכת (${method}) בקובץ ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export function zipIndex(entries: ZipEntry[]): Map<string, ZipEntry> {
  const map = new Map<string, ZipEntry>();
  for (const e of entries) {
    const safe = e.name.replace(/^\.\//, "");
    map.set(safe, e);
    const base = safe.includes("/") ? safe.slice(safe.lastIndexOf("/") + 1) : safe;
    if (!map.has(base)) map.set(base, e);
  }
  return map;
}

// ── MIME ──────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  zip: "application/zip",
};

export function mimeOf(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME[ext] || "application/octet-stream";
}

// ── הגשה ─────────────────────────────────────────────────────────────

export interface ServedFile {
  bytes: Buffer;
  mime: string;
  manifest: WebManifest;
  resolvedPath: string;
  source: "chain" | "repo-sealed";
}

export async function servePackageFile(hash: string, innerPath?: string): Promise<ServedFile> {
  const pkg = await fetchPackageBytes(hash);
  const { bytes, manifest } = pkg;
  if (manifest.mime !== "application/zip") {
    return { bytes, mime: manifest.mime, manifest, resolvedPath: manifest.name, source: pkg.source };
  }
  const idx = zipIndex(parseZip(bytes));
  let wanted = (innerPath || manifest.entry || "index.html").replace(/^\/+/, "");
  if (wanted === "" || wanted.endsWith("/")) wanted += "index.html";
  if (wanted.includes("..")) throw new Error("נתיב לא חוקי");
  let hit = idx.get(wanted);
  if (!hit) hit = idx.get(wanted.split("/").pop() || "");
  if (!hit) {
    throw new Error(`הקובץ "${wanted}" לא נמצא בחבילה. קבצים: ${[...idx.keys()].slice(0, 12).join(", ")}`);
  }
  return { bytes: hit.data, mime: mimeOf(hit.name), manifest, resolvedPath: hit.name, source: pkg.source };
}

// ── אימות חי מלא (בלי מטמון) — מנוע ההוכחות ─────────────────────────

export interface VerifyChunkReport {
  i: number;
  chars: number;
  onChain: boolean;
  block?: number | null;
  txid?: string | null;
}

export interface VerifyReport {
  hash: string;
  ok: boolean;
  name: string;
  bytes: number;
  sealOnChain: boolean;
  sealBlock: number | null;
  sealTxid: string | null;
  chainChars: number;
  b64len: number;
  residencyPct: number;
  assembledSha: string | null;
  repoCopy: { exists: boolean; shaMatches: boolean } | null;
  manifest: WebManifest | null;
  at: string;
}

/** אימות מקיר לקיר מול השרשרת הציבורית. */
export async function verifyPackageOnChain(hash: string): Promise<VerifyReport> {
  const report: VerifyReport = {
    hash,
    ok: false,
    name: "",
    bytes: 0,
    sealOnChain: false,
    sealBlock: null,
    sealTxid: null,
    chainChars: 0,
    b64len: 0,
    residencyPct: 0,
    assembledSha: null,
    repoCopy: null,
    manifest: null,
    at: new Date().toISOString(),
  };
  const ops = await scanWebOps(hash);
  if (!ops.manifest) return report;
  report.sealOnChain = true;
  report.sealBlock = ops.manifest.block ?? null;
  report.sealTxid = ops.manifest.txid ?? null;
  report.manifest = ops.manifest;
  report.name = ops.manifest.name;
  report.bytes = ops.manifest.bytes;
  report.b64len = ops.manifest.b64len;

  const joined = ops.chunks.map((c) => c.d).join("");
  report.chainChars = joined.length;
  report.residencyPct = report.b64len ? Math.round((joined.length / report.b64len) * 1000) / 10 : 0;

  if (joined) {
    const bytes = Buffer.from(joined, "base64");
    report.assembledSha = sha256Hex(bytes);
    report.bytes = bytes.length;
  }
  const repoBytes = await repoPackageBytes(hash);
  if (repoBytes) {
    report.repoCopy = { exists: true, shaMatches: sha256Hex(repoBytes) === hash };
  } else {
    report.repoCopy = { exists: false, shaMatches: false };
  }
  report.ok =
    report.sealOnChain &&
    joined.length === report.b64len &&
    report.assembledSha === hash;
  return report;
}

// ── מצב ה-RC החי של חשבון האחסון ─────────────────────────────────────

export interface RcProbe {
  account: string;
  mana: number;
  max: number;
  pct: number;
  regenPerDay: number;
  headBlock: number | null;
  chainTime: string | null;
}

export async function probeStorageRc(account: string = WEB_ACCOUNT): Promise<RcProbe | null> {
  try {
    const res = await steemRpc<{
      rc_accounts: Array<{
        max_rc: string | number;
        rc_manabar: { current_mana: string | number; last_update_time: number };
      }>;
    }>("rc_api.find_rc_accounts", { accounts: [account] });
    const a = res?.rc_accounts?.[0];
    if (!a) return null;
    const max = Number(a.max_rc);
    let dgp: DynamicGlobalProperties | null = null;
    try {
      dgp = await steemRpc<DynamicGlobalProperties>("condenser_api.get_dynamic_global_properties", []);
    } catch {
      /* בלי זמן שרשרת נסתפק במנה הקפואה */
    }
    const nowSec = dgp
      ? Math.floor(new Date(dgp.time + "Z").getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const lut = Number(a.rc_manabar.last_update_time);
    const mana = Math.min(max, Number(a.rc_manabar.current_mana) + Math.max(0, nowSec - lut) * (max / 432_000));
    return {
      account,
      mana: Math.round(mana),
      max,
      pct: Math.round((mana / Math.max(1, max)) * 1000) / 10,
      regenPerDay: Math.round((max / 432_000) * 86_400),
      headBlock: dgp?.head_block_number ?? null,
      chainTime: dgp?.time ?? null,
    };
  } catch {
    return null;
  }
}

/** נתיבי הספריות של רשת-האחסון בריפו */
export function webRepoPaths(repoRoot: string) {
  return {
    manifests: path.join(repoRoot, "sovereign", "web", "manifests"),
    inbox: path.join(repoRoot, "sovereign", "web", "inbox"),
    packages: path.join(repoRoot, "sovereign", "web", "packages"),
  };
}

// ── פרופיל מה העוגנים נותנים — אמת מדודה בלבד ───────────────────────

export interface AnchorCapability {
  key: string;
  title: string;
  detail: string;
  measured: string;
}

export function anchorCapabilities(): AnchorCapability[] {
  return [
    {
      key: "storage",
      title: "אחסון על שרשרת ציבורית — במחיר האמיתי",
      detail:
        "כל ביט שנכתב ל-Steem נשמר לנצח בכל צומת מלא בעולם. המחיר נמדד אצלנו בפועל: ~65M RC בסיס + ~320k RC לכל תו — החבילות עולות בצ׳אנקים אדפטיביים בקצב שהמאגר מרשה, והחותם (sha256) נוחת ראשון.",
      measured: "probe2: 1,000 תווים = 404M RC · 2,000 = 725M · 4,000 = 1,365M",
    },
    {
      key: "identity",
      title: "חתימת רשת ללא שרת",
      detail:
        "חשבון העוגן (cashmachine, ~4,678 SP) חותם על כל פעולה במפתח ה-posting. המפתח הציבורי אומת ב-2026-09-19 מול השרשרת (STM6EML1…) — ההרשאה היא השרשרת עצמה.",
      measured: "פעיל מ-2018 · 107 פרסומים · מעגן את הספר עד היום",
    },
    {
      key: "budget",
      title: "תקציב כתיבה כלכלי אמיתי (RC)",
      detail:
        "מאגר 2.35 מיליארד RC, התחדשות ~470 מיליון ביום. הרשת מפרסמת רק מעל רצפת בטיחות, מודדת את העלות בפועל אחרי כל שידור, ולומדת מדחיות (ההודעה needs-X-RC היא מדידה חינם). יותר SP = קצב הגירה גבוה יותר.",
      measured: "המאגר נמדד חי בכל פעימה — המד למעלה",
    },
    {
      key: "index",
      title: "חותם ואינדקס נטולי-שרת",
      detail:
        "החותם של כל חבילה (custom_json id=saos.web.v1) נושא את ה-sha256 ונודד בהיסטוריית החשבון הציבורית — כל אחד יכול לסרוק ולגלות מה הרשת מאחסנת. ההגשה מאומתת מול החותם בכל טעינה: השרשרת היא השופטת.",
      measured: "מבנה: {name, sha256, bytes, mime, entry, s, at}",
    },
  ];
}
