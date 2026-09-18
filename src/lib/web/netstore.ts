// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · netstore — רשת-האחסון הריבונית: השרשרת הציבורית כדיסק.
//
// דוקטרינה (פקודת המפעיל, R50): "האמת היא האימות של השרת על הרשת."
// השער הזה לא סומך על שום מקור מקומי: כל ביט שהוא מגיש נקרא
// מה-RPC הציבורי של Steem ומאומת ב-sha256 מול מניפסט שעצמו נושא
// את החשיש של התוכן. אין "גרסה מקומית" — יש רק שרשרת.
//
// מבנה האחסון על השרשרת (חשבון העוגן, סמכות posting בלבד):
//   · פוסט-מכולה: parent_permlink="saosweb", permlink=saosweb-<hash10>
//     body = מניפסט JSON (ובמצב inline גם התוכן עצמו ב-base64)
//   · צ׳אנק-תשובות: permlink=saosweb-<hash10>-c001.. — body=base64 גולמי
//   · עוגן אינדקס: custom_json id="saos.web.v1" {h,n,s,at} — ניתן לסריקה
//     ציבורית בהיסטוריית החשבון
//
// כל פונקציה כאן נטולת-מפתח: קריאה ואימות בלבד. השידור חי בענן
// (scripts/web-publish.ts + web-publish.yml) אצל WEAVE_STEEM_WIF.
// ─────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { inflateRawSync } from "zlib";
import path from "path";
import {
  STEEM_RPC_NODES,
  rpcV4,
  type DynamicGlobalProperties,
} from "@/lib/weave/graphene";

// ── קבועים ──────────────────────────────────────────────────────────

export const WEB_TAG = "saosweb";
export const WEB_OP_ID = "saos.web.v1";
export const WEB_PROTOCOL = "saos-web/1";
export const WEB_ACCOUNT = (process.env.WEB_STEEM_ACCOUNT || "cashmachine").toLowerCase();
/** תקרת מצב-inline: מניפסט+תוכן בפוסט אחד (גוף פוסט ≤64KB) */
export const MAX_INLINE_B64 = 44_000;
/** גודל צ׳אנק ברירת-מחדל במצב מרובה-צ׳אנקים */
export const DEFAULT_CHUNK_B64 = 6_000;

// ── טיפוסים ─────────────────────────────────────────────────────────

export interface WebChunk {
  i: number;
  permlink: string;
  sha256: string; // sha256 של מחרוזת ה-base64 של הצ׳אנק (הגוף החי)
}

export interface WebManifest {
  v: 1;
  protocol: "saos-web/1";
  name: string;
  sha256: string; // sha256 של בייטי התוכן המלאים
  bytes: number;
  mime: string;
  entry?: string; // קובץ פתיחה בתוך zip
  b64?: string; // מצב inline בלבד
  b64len: number;
  chunkSize: number;
  mode: "inline" | "chunks";
  chunks?: WebChunk[];
  by: string;
  at: string;
}

export interface ChainRef {
  permlink: string;
  txid?: string | null;
  block?: number | null;
}

export interface WebManifestRecord {
  manifest: WebManifest;
  status: "complete" | "partial";
  chain: {
    container?: ChainRef;
    chunks?: ChainRef[];
    anchor?: (ChainRef & { foundOnChain?: boolean }) | null;
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

export function containerPermlink(hash: string): string {
  return `saosweb-${hash.slice(0, 10)}`;
}

export function chunkPermlink(hash: string, i: number): string {
  return `saosweb-${hash.slice(0, 10)}-c${String(i).padStart(3, "0")}`;
}

export function looksLikeSha256(hash: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash);
}

/** RPC ציבורי עם ניסיון חלופה בין צמתים */
async function steemRpc<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      return await rpcV4<T>(node, method, params, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`steem-rpc-unreachable: ${String(lastErr).slice(0, 120)}`);
}

export interface ChainComment {
  author: string;
  permlink: string;
  body: string;
  created?: string;
  block?: number;
  trx_id?: string;
}

/** קריאת גוף פוסט/תגובה מהשרשרת — המקור היחיד לתוכן */
export async function getChainComment(
  permlink: string,
  account: string = WEB_ACCOUNT
): Promise<ChainComment | null> {
  const r = await steemRpc<ChainComment | null>(
    "condenser_api.get_content",
    [account, permlink]
  );
  if (!r || typeof r.body !== "string" || r.body.trim() === "") return null; // פוסט שלא נוצר מחזיר גוף ריק
  return r;
}

// ── מניפסט ──────────────────────────────────────────────────────────

/** מניפסט מהשרשרת: פוסט-המכולה. מאומת שהחשיש שבו תואם לחשיש המבוקש. */
export async function loadManifestFromChain(
  hash: string
): Promise<{ manifest: WebManifest; comment: ChainComment } | null> {
  const c = await getChainComment(containerPermlink(hash));
  if (!c) return null;
  let m: WebManifest;
  try {
    m = JSON.parse(c.body) as WebManifest;
  } catch {
    return null; // גוף שאינו מניפסט — לא חבילה שלנו
  }
  if (!m || m.protocol !== WEB_PROTOCOL || m.sha256 !== hash) return null;
  return { manifest: m, comment: c };
}

// ── מטמון תוכן (כתובות-תוכן = בלתי-משתנות ⇒ מטמון תמידי בתוך התהליך) ──

interface PackageCacheEntry {
  bytes: Buffer;
  manifest: WebManifest;
}

const pkgCache = new Map<string, PackageCacheEntry>();
const inflight = new Map<string, Promise<PackageCacheEntry>>();
const CACHE_MAX = 48;

/** בייטי החבילה מהשרשרת — כל צ׳אנק נבדק ב-sha256 בטעינה. */
export async function fetchPackageBytes(hash: string): Promise<PackageCacheEntry> {
  if (!looksLikeSha256(hash)) throw new Error("חשיש לא תקין — נדרש sha256 בן 64 תווי-הקס");
  const cached = pkgCache.get(hash);
  if (cached) return cached;
  const running = inflight.get(hash);
  if (running) return running;

  const task = (async (): Promise<PackageCacheEntry> => {
    const loaded = await loadManifestFromChain(hash);
    if (!loaded) {
      throw new Error("המניפסט לא נמצא על השרשרת — החבילה עדיין לא פורסמה או שהחשיש שגוי");
    }
    const m = loaded.manifest;
    let b64 = "";
    if (m.mode === "inline") {
      const inline = m.b64;
      if (!inline) throw new Error("מניפסט inline ללא שדה תוכן");
      b64 = inline;
    } else {
      const chunks = m.chunks ?? [];
      const bodies: string[] = [];
      for (const ch of chunks) {
        const c = await getChainComment(ch.permlink);
        if (!c) throw new Error(`צ׳אנק ${ch.i} חסר על השרשרת (${ch.permlink})`);
        const got = sha256Hex(c.body);
        if (got !== ch.sha256) {
          throw new Error(`צ׳אנק ${ch.i} לא עבר אימות: ${got.slice(0, 12)} ≠ ${ch.sha256.slice(0, 12)}`);
        }
        bodies.push(c.body);
      }
      b64 = bodies.join("");
    }
    const bytes = Buffer.from(b64, "base64");
    const gotHash = sha256Hex(bytes);
    if (gotHash !== hash) {
      throw new Error(`אימות-סופי נכשל: sha256 בפועל ${gotHash.slice(0, 12)} ≠ המניפסט ${hash.slice(0, 12)}`);
    }
    const entry: PackageCacheEntry = { bytes, manifest: m };
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

/** הצצה למטמון בלבד (בלי RPC) */
export function peekCache(hash: string): PackageCacheEntry | undefined {
  return pkgCache.get(hash);
}

// ── קורא ZIP מינימלי (STORE + DEFLATE) — בלי תלות חוץ ────────────────

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function parseZip(buf: Buffer): ZipEntry[] {
  // EOCD — סריקה לאחור מהסוף
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
    if (name.endsWith("/")) continue; // תיקייה
    // כותרת מקומית
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
    if (!map.has(base)) map.set(base, e); // מציאה לפי שם-בסיס גם בלי נתיב
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
}

/** הגשת קובץ מתוך חבילה על-פי נתיב פנימי. zip מפורק בזיכרון. */
export async function servePackageFile(hash: string, innerPath?: string): Promise<ServedFile> {
  const { bytes, manifest } = await fetchPackageBytes(hash);
  if (manifest.mime !== "application/zip") {
    return { bytes, mime: manifest.mime, manifest, resolvedPath: manifest.name };
  }
  const idx = zipIndex(parseZip(bytes));
  let wanted = (innerPath || manifest.entry || "index.html").replace(/^\/+/, "");
  if (wanted === "" || wanted.endsWith("/")) wanted += "index.html";
  if (wanted.includes("..")) throw new Error("נתיב לא חוקי");
  let hit = idx.get(wanted);
  if (!hit) hit = idx.get(wanted.split("/").pop() || "");
  if (!hit) {
    throw new Error(
      `הקובץ "${wanted}" לא נמצא בחבילה. קבצים: ${[...idx.keys()].slice(0, 12).join(", ")}`
    );
  }
  return { bytes: hit.data, mime: mimeOf(hit.name), manifest, resolvedPath: hit.name };
}

// ── אימות חי מלא (בלי מטמון) — מנוע ההוכחות ─────────────────────────

export interface VerifyChunkReport {
  i: number;
  permlink: string;
  onChain: boolean;
  expected: string;
  got: string | null;
  ok: boolean;
  created?: string;
}

export interface VerifyReport {
  hash: string;
  ok: boolean;
  name: string;
  mode: string;
  bytes: number;
  manifestOnChain: boolean;
  chunks: VerifyChunkReport[];
  totalB64: string | null;
  totalSha: string | null;
  anchor: { opId: string; onChain: boolean; raw?: unknown; block?: number | null; txid?: string | null } | null;
  manifest: WebManifest | null;
  at: string;
}

/** אימות מקיר לקיר מול השרשרת הציבורית — כל צ׳אנק, כל חשיש. */
export async function verifyPackageOnChain(hash: string): Promise<VerifyReport> {
  const report: VerifyReport = {
    hash,
    ok: false,
    name: "",
    mode: "",
    bytes: 0,
    manifestOnChain: false,
    chunks: [],
    totalB64: null,
    totalSha: null,
    anchor: null,
    manifest: null,
    at: new Date().toISOString(),
  };
  const loaded = await loadManifestFromChain(hash);
  if (!loaded) return report;
  report.manifestOnChain = true;
  const m = loaded.manifest;
  report.manifest = m;
  report.name = m.name;
  report.mode = m.mode;
  report.bytes = m.bytes;

  let b64 = "";
  if (m.mode === "inline") {
    b64 = m.b64 || "";
    report.chunks.push({
      i: 0,
      permlink: containerPermlink(hash),
      onChain: true,
      expected: hash,
      got: null,
      ok: true,
      created: loaded.comment.created,
    });
  } else {
    for (const ch of m.chunks ?? []) {
      const c = await getChainComment(ch.permlink);
      const got = c ? sha256Hex(c.body) : null;
      report.chunks.push({
        i: ch.i,
        permlink: ch.permlink,
        onChain: !!c,
        expected: ch.sha256,
        got,
        ok: !!c && got === ch.sha256,
        created: c?.created,
      });
      if (c) b64 += c.body;
    }
  }
  report.totalB64 = sha256Hex(b64);
  if (b64) {
    const bytes = Buffer.from(b64, "base64");
    report.totalSha = sha256Hex(bytes);
    report.bytes = bytes.length;
  }
  report.ok =
    report.manifestOnChain &&
    report.chunks.every((c) => c.ok) &&
    report.totalSha === hash;

  // עוגן האינדקס (custom_json) — סריקת היסטוריה אחרונה
  try {
    const hist = await steemRpc<
      Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string; block?: number }]>
    >("condenser_api.get_account_history", [WEB_ACCOUNT, -1, 120]);
    for (const [, e] of [...hist].reverse()) {
      const op = e.op;
      if (!op || op[0] !== "custom_json" || op[1].id !== WEB_OP_ID) continue;
      try {
        const pl = JSON.parse(String(op[1].json || "{}")) as { h?: string };
        if (pl.h === hash) {
          report.anchor = { opId: WEB_OP_ID, onChain: true, raw: pl, block: e.block ?? null, txid: e.trx_id ?? null };
          break;
        }
      } catch {
        /* דלג */
      }
    }
  } catch {
    /* ההיסטוריה אינה חובה לאימות התוכן */
  }
  return report;
}

// ── מצב ה-RC החי של חשבון האחסון (מד-חוזק הרשת) ─────────────────────

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
      dgp = await steemRpc<DynamicGlobalProperties>(
        "condenser_api.get_dynamic_global_properties",
        []
      );
    } catch {
      /* בלי זמן שרשרת נסתפק במנה הקפואה */
    }
    const nowSec = dgp
      ? Math.floor(new Date(dgp.time + "Z").getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const lut = Number(a.rc_manabar.last_update_time);
    const mana = Math.min(
      max,
      Number(a.rc_manabar.current_mana) + Math.max(0, nowSec - lut) * (max / 432_000)
    );
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

/** נתיבי הספריות של רשת-האחסון בריפו (אינדקס בלבד — השרשרת היא האמת) */
export function webRepoPaths(repoRoot: string) {
  return {
    manifests: path.join(repoRoot, "sovereign", "web", "manifests"),
    inbox: path.join(repoRoot, "sovereign", "web", "inbox"),
    packages: path.join(repoRoot, "sovereign", "web", "packages"),
  };
}

// ── פרופיל מה העוגנים נותנים (לתצוגה — אמת מדודה, לא שיווק) ─────────

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
      title: "אחסון קבוע על שרשרת ציבורית",
      detail:
        "פוסט של Steem שומר עד 64KB גוף על השרשרת לנצח — כל צומת מלא בעולם מחזיק עותק. אנחנו מפרקים כל תוכן לצ׳אנקים חתומים ב-sha256 וכותבים אותם כפוסטים בסמכות posting בלבד (אפס סיכון הון).",
      measured: "חבילת המשחקים: 9,643 בייטים = פוסט אחד",
    },
    {
      key: "identity",
      title: "חתימת רשת ללא שרת",
      detail:
        "חשבון העוגן (cashmachine, ~4,678 SP) חותם על כל צ׳אנק במפתח ה-posting. כל אחד יכול לאמת את החתימה מול ה-RPC הציבורי — ההרשאה היא השרשרת עצמה, לא אנחנו.",
      measured: "פעיל מ-2018 · 107 פרסומים · מעגן את הספר עד היום",
    },
    {
      key: "budget",
      title: "תקציב כתיבה כלכלי אמיתי (RC)",
      detail:
        "הכתיבה לשרשרת מוגבלת ב-Resource Credits הנטענים מ-SP: מאגר 2.35 מיליארד, התחדשות ~470 מיליון ביום. הרשת מפרסמת רק כשהמאגר מעל רצפת בטיחות — ולעולם לא מלווה מהעתיד.",
      measured: "המאגר נמדד חי בכל פעימה — ראה את המד",
    },
    {
      key: "index",
      title: "אינדקס ציבורי נטול-שרת",
      detail:
        "עוגן custom_json (id=saos.web.v1) מפרסם את חשיש כל חבילה להיסטוריית החשבון — סריקה ציבורית חושפת את כל מה שהרשת מאחסנת, בלי לשאול אותנו. הפוסטים עצמם מתויגים saosweb.",
      measured: "כל חבילה מקבלת permlink=saosweb-<hash10>",
    },
  ];
}
