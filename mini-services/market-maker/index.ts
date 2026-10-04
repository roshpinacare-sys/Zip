// ─────────────────────────────────────────────────────────────────────
// WEAVE-MARKET-MAKER · מנוע-הגריד (Task 2-b · פורט 3049)
//
// סוחר-גריד דו-צדדי על השוק-הפנימי של Steem (SBD:STEEM): 5 פקודות-מכירה
// מעל המרכז + 5 פקודות-קנייה מתחתיו, במרווחי-רמה קבועים (bps). כל פעימה:
// מדידת ספר חי ← מרכז ← גדלי-תקציב ← סולם; סטיית-מרכז מעל 2×מרווח =
// ביטול+פריסה מחדש; פקודות פגות אחרי 24ש' (expiration מוטבע).
//
// הפרדת-סמכויות (כמו R80/R81):
//   · המנוע הזה מחליט מתי וכמה — הכספת מספקת חתימה — השרשרת שופטת.
//   · DRY (ברירת-מחדל): הכול מחושב ונרשם ל-dry-run-log.jsonl — אפס שידור.
//   · LIVE: אותו צינור-חתימה של עורק /api/money (steem.broadcast.sendAsync
//     עם WIF-מהכספת) + אימות-ביט-מול-ביט של הפומבי הנגזר מול רשות-ה-active
//     החיה לפני כל שידור (חוק R75 — השרשרת השופטת).
//
// תיאום money-mover (חוק-אחוות-הסוחרים):
//   · התקציב = יתרה-חופשית × budgetPct — והיתרה-החופשית של
//     get_accounts כבר מנוכה את כל הפקודות-הנעולות (שלנו ושל
//     money-mover כאחד, שהשוק-הפנימי מפקיד אצלו). שני-הסוחרים לעולם
//     לא נלחמים על אותם כספים.
//   · ביטול-פקודות: רק לפי רישום-orderid משלנו ב-state.registry —
//     פקודות money-mover (orderid אחר) לעולם לא נוגעות.
//   · אם money-mover באמצע פעולה (sovereign/money/state.json acting=true)
//     הפעימה מדלגת על פריסה — אין-שני-שידורים-חיים-במקביל על אותו חשבון.
//
// דוקטרינה:
//   · fail-closed: מפתח-חתימה נקרא רק מ~/.sovereign/vault/secrets (0600),
//     כל קריאה נרשמת ב-access.log (שם+זמן בלבד), חסר ⇒ יציאה 2 / סירוב-כנה.
//   · כנות: מדידה שנכשלה נרשמת ככישלון — אין "נניח שבסדר".
//   · כתיבת-מצב אטומית (tmp+rename) · טיימר-יחיד במשמר-גלובלי ·
//     שרת-יחיד חוצה-דורות (חוקי weblift/R124 של הצי).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { writeJsonAtomic, installDeadManWatch } from "../shared";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו ב-money-mover)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const DIR = `${HOME}/sovereign/market-maker`;
const CONFIG_FILE = `${DIR}/config.json`;
const STATE_FILE = `${DIR}/state.json`;
const DRY_LOG = `${DIR}/dry-run-log.jsonl`;
const LEDGER_FILE = `${DIR}/ledger.jsonl`;
const KILL_FILE = path.join(os.homedir(), ".sovereign", "mm-kill");
const VAULT = path.join(os.homedir(), ".sovereign", "vault");
const MOVER_STATE = `${HOME}/sovereign/money/state.json`;
const PORT = 3049;
const TICK_SEC = 60;
const TICK_MAX_MS = 90_000;
const ACCOUNT = "headcorner"; // זהות-החותם — נאמתת-ביט-מול-ביט מול הרשת בכל שידור (R75)
const RPC_NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const HIVE_RAIL_NOTE = "רגל HIVE מוגדרת enabled:false בתצורה — לא נבנה כאן כלום עד החלטת-מפעיל";

// ── תצורה ───────────────────────────────────────────────────────────

interface RailSteemConfig {
  enabled: boolean;
  mode: "dry" | "live";
  pair: string;
  gridLevels: number;
  spreadBps: number;
  levelSpacingBps: number;
  orderCap: number; // תקרת-גודל לפקודה-יחידה, ב-STEEM (נכס-הבסיס של הזוג)
  minOrder: number; // גודל-מזערי לפקודה, ב-STEEM
  budgetPct: number; // חלק מהיתרה-החופשית שמוקצה לסולם (ראה חוק-אחוות-הסוחרים בראש הקובץ)
  refreshHours: number; // גיל-מקסימלי לפקודה — ישנה ⇒ ביטול+פריסה מחדש
  feeRate: number; // הערכת-עמלה לספר (לא חוסם-שידור)
  fleetChurn: boolean; // חיילי-הצי — רק עם יכולת-active מאומתת (ראה fleetVerify)
  churnSize: number; // גודל-פקודת-חיול ב-STEEM
}
interface Config {
  rails: { steem: RailSteemConfig; hive: { enabled: boolean; reason: string } };
  dailyLossCapSbd: number;
  tickSec: number;
  _docs?: Record<string, string>;
}

const DEFAULT_CONFIG: Config = {
  rails: {
    steem: {
      enabled: true,
      mode: "dry",
      pair: "SBD:STEEM",
      gridLevels: 5,
      spreadBps: 120,
      levelSpacingBps: 60,
      orderCap: 1.0,
      minOrder: 0.05,
      budgetPct: 0.35,
      refreshHours: 24,
      feeRate: 0.0075,
      fleetChurn: true,
      churnSize: 0.05,
    },
    hive: { enabled: false, reason: "no-verified-active-key-or-liquidity-yet" },
  },
  dailyLossCapSbd: 0.5,
  tickSec: 60,
  _docs: {
    budgetLaw:
      "budget = free_balance × budgetPct · היתרה-החופשית (get_accounts) כבר מנוכה את כל הפקודות-הנעולות — שלנו ושל money-mover — לכן שני-הסוחרים לא מתחרים על אותם כספים",
    cancelLaw: "ביטול רק לפי orderid מרישום-המנוע עצמו (state.registry) — פקודות money-mover נוגעות-אסור",
    ladderLaw: "5 מכירות מעל המרכז + 5 קניות מתחתיו; רמה-ראשונה ב-±spreadBps/2, אחריהן צעדים של levelSpacingBps",
    driftLaw: "אם המרכז זז מעל 2×levelSpacingBps מאז הפריסה — ביטול+פריסה מחדש",
    fleetChurnLaw: "מופעל רק אחרי אימות-חי של רשות-active לחיילים מהכספת; אין-אימות ⇒ כבוי-בכנות, אין-ממציאים-מפתחות",
    killSwitchLaw: "קובץ ~/.sovereign/mm-kill קיים ⇒ אפס פריסות חדשות; מעבר-ל-live נסרב",
  },
};

function loadConfig(): Config {
  let cfg: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
    // מיזוג-חסרים בלבד: התצורה של המפעיל שולטת, ברירות-המחדל משלימות בכנות
    cfg = {
      ...cfg,
      ...raw,
      rails: {
        steem: { ...cfg.rails.steem, ...(raw.rails?.steem ?? {}) },
        hive: { ...cfg.rails.hive, ...(raw.rails?.hive ?? {}) },
      },
      _docs: { ...(cfg._docs ?? {}), ...(raw._docs ?? {}) },
    } as Config;
  } catch {
    // קובץ-חסר או פגום = כתיבת-ברירות-המחדל (אטומית) — עלייה ראשונה כנה
  }
  writeJsonAtomic(CONFIG_FILE, cfg);
  return cfg;
}

// ── כספת — fail-closed (דפוס tron-balance/money) ────────────────────

function vaultRead(name: string): string | null {
  const f = path.join(VAULT, "secrets", name);
  if (!fs.existsSync(f)) return null; // הקורא מחליט מה כנות-הכישלון שלו
  try {
    const st = fs.statSync(f);
    if ((st.mode & 0o077) !== 0) {
      console.error(`[market-maker] ${name} בכספת עם הרשאות רחבות-מדי (${(st.mode & 0o777).toString(8)}) — fail-closed`);
      return null;
    }
    try {
      fs.appendFileSync(path.join(VAULT, "access.log"), `${new Date().toISOString()} read ${name} (market-maker)\n`, { mode: 0o600 });
    } catch {
      /* הלוג לעולם לא חוסם את הקריאה */
    }
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    return null;
  }
}

/** מפתח-חתימה — נקרא רק במסילת-live. חסר ⇒ יציאה 2 (fail-closed, דפוס tron-balance). */
function loadSigningWif(): string {
  const wif = vaultRead("STEEM_ACTIVE_WIF");
  if (!wif || wif.length < 40) {
    console.error("market-maker: STEEM_ACTIVE_WIF לא בכספת — fail-closed, אפס חתימה");
    process.exit(2);
  }
  return wif;
}

// ── מצב ─────────────────────────────────────────────────────────────

interface RegistryOrder {
  orderid: number;
  side: "buy" | "sell";
  level: number;
  price: number; // SBD per STEEM
  amount: number; // STEEM
  total: number; // SBD
  placedAt: string;
  expiration: string;
  centerAtPlace: number;
  txid: string | null;
  dry: boolean;
}

interface MMState {
  service: string;
  version: string;
  bootedAt: string;
  mode: "dry" | "live";
  lastTick: string | null;
  ticks: number;
  centerPrice: number | null;
  spreadBps: number | null;
  openOrders: RegistryOrder[];
  fills24h: number;
  volume24hSteem: number;
  volume24hSbd: number;
  realizedPnlSbd: number;
  dailyPnlSbd: number;
  pnlDay: string;
  fillsSeen: number;
  internalFills: number;
  lastFillBlock: number;
  halted: boolean;
  haltedAt: string | null;
  haltedConfigMtimeMs: number | null;
  killSwitch: boolean;
  lastDecision: { at: string; kind: string; detail: string } | null;
  lastError: string | null;
  registry: Record<string, RegistryOrder>;
  fleetChurn: { configured: boolean; effective: boolean; verified: boolean; reason: string; soldiersChecked: number };
  coordination: { moverActing: boolean; moverCheckedAt: string | null; ourOrders: number; moverOrders: number };
  balances: { steemFree: number; sbdFree: number; measuredAt: string | null };
  lastModeChange: { at: string; from: string; to: string; by: string } | null;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function freshState(): MMState {
  return {
    service: "market-maker",
    version: "1.0.0",
    bootedAt: new Date().toISOString(),
    mode: "dry", // חוק: אף-עלייה-קרה לא מתחילה live — רק POST /mode מעביר
    lastTick: null,
    ticks: 0,
    centerPrice: null,
    spreadBps: null,
    openOrders: [],
    fills24h: 0,
    volume24hSteem: 0,
    volume24hSbd: 0,
    realizedPnlSbd: 0,
    dailyPnlSbd: 0,
    pnlDay: utcDay(),
    fillsSeen: 0,
    internalFills: 0,
    lastFillBlock: 0,
    halted: false,
    haltedAt: null,
    haltedConfigMtimeMs: null,
    killSwitch: fs.existsSync(KILL_FILE),
    lastDecision: null,
    lastError: null,
    registry: {},
    fleetChurn: { configured: false, effective: false, verified: false, reason: "טרם-נבדק", soldiersChecked: 0 },
    coordination: { moverActing: false, moverCheckedAt: null, ourOrders: 0, moverOrders: 0 },
    balances: { steemFree: 0, sbdFree: 0, measuredAt: null },
    lastModeChange: null,
  };
}

const G_MM = globalThis as unknown as { __MM_STATE__?: MMState; __MM_CONFIG__?: Config };

function readState(): MMState {
  const base = freshState();
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<MMState>;
    // המשכיות-אמת: רישום-פקודות, ספר-מילויים ומונים שורדים restart/hot-reload (לקח R84)
    return {
      ...base,
      mode: "dry", // חוק-הברזל: עלייה-קרה תמיד עולה dry; המפעיל מעביר ב-POST /mode
      bootedAt: base.bootedAt,
      ticks: typeof prev.ticks === "number" ? prev.ticks : 0,
      centerPrice: typeof prev.centerPrice === "number" ? prev.centerPrice : null,
      spreadBps: typeof prev.spreadBps === "number" ? prev.spreadBps : null,
      openOrders: Array.isArray(prev.openOrders) ? prev.openOrders : [],
      fills24h: typeof prev.fills24h === "number" ? prev.fills24h : 0,
      volume24hSteem: typeof prev.volume24hSteem === "number" ? prev.volume24hSteem : 0,
      volume24hSbd: typeof prev.volume24hSbd === "number" ? prev.volume24hSbd : 0,
      realizedPnlSbd: typeof prev.realizedPnlSbd === "number" ? prev.realizedPnlSbd : 0,
      dailyPnlSbd: prev.pnlDay === utcDay() && typeof prev.dailyPnlSbd === "number" ? prev.dailyPnlSbd : 0,
      pnlDay: utcDay(),
      fillsSeen: typeof prev.fillsSeen === "number" ? prev.fillsSeen : 0,
      internalFills: typeof prev.internalFills === "number" ? prev.internalFills : 0,
      lastFillBlock: typeof prev.lastFillBlock === "number" ? prev.lastFillBlock : 0,
      halted: prev.halted === true,
      haltedAt: prev.haltedAt ?? null,
      haltedConfigMtimeMs: prev.haltedConfigMtimeMs ?? null,
      killSwitch: fs.existsSync(KILL_FILE),
      lastDecision: prev.lastDecision ?? null,
      registry: prev.registry && typeof prev.registry === "object" ? prev.registry : {},
      fleetChurn: prev.fleetChurn ?? base.fleetChurn,
      coordination: prev.coordination ?? base.coordination,
      balances: prev.balances ?? base.balances,
      lastModeChange: prev.lastModeChange ?? null,
    };
  } catch {
    return base;
  }
}

// ציר-עולם (דפוס weblift/R124): אובייקט-מצב אחד לכל חיי-התהליך; דור-חם יורש
// את האובייקט החי — רק עלייה-קרה קוראת מהדיסק (ותמיד עולה dry — חוק-הברזל).
const coldBoot = G_MM.__MM_STATE__ == null;
let state: MMState = coldBoot ? readState() : G_MM.__MM_STATE__;
G_MM.__MM_STATE__ = state;
let cfg: Config = G_MM.__MM_CONFIG__ ?? loadConfig();
G_MM.__MM_CONFIG__ = cfg;

function saveState() {
  writeJsonAtomic(STATE_FILE, state);
}

function decision(kind: string, detail: string) {
  state.lastDecision = { at: new Date().toISOString(), kind, detail };
  console.log(`[market-maker] ${kind}: ${detail}`);
}

// ── יומני-jsonl (הוספה-בלבד · ראיה-אטומית-שורה) ─────────────────────

function appendJsonl(file: string, entry: Record<string, unknown>) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch (e) {
    console.error(`[market-maker] כתיבת-${path.basename(file)} נכשלה: ${String((e as Error)?.message ?? e)}`);
  }
}

const dryLog = (entry: Record<string, unknown>) => appendJsonl(DRY_LOG, { ts: new Date().toISOString(), mode: "dry", rail: "steem", ...entry });

// ── RPC-רב-צמתי (אותו דפוס העורק — bounded-wait R112) ──────────────

async function steemRpcOnce(node: string, method: string, params: unknown[], timeoutMs: number): Promise<any> {
  const res = await fetch(node, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`http ${res.status} @ ${node}`);
  const j = await res.json();
  if (j?.error) throw new Error(String(j.error.message ?? "rpc-error") + ` @ ${node}`);
  return j.result;
}

async function steemRpc(method: string, params: unknown[]): Promise<any> {
  let lastErr: unknown = null;
  for (const node of RPC_NODES) {
    try {
      return await steemRpcOnce(node, method, params, 12_000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all-steem-nodes-down");
}

// ── מדידות חיות ─────────────────────────────────────────────────────

async function bookMid(): Promise<{ mid: number; bestBid: number; bestAsk: number }> {
  const j = await steemRpc("condenser_api.get_order_book", [10]);
  const bids: Array<{ real_price: string }> = j?.bids ?? [];
  const asks: Array<{ real_price: string }> = j?.asks ?? [];
  const bestBid = Math.max(...bids.map((b) => parseFloat(b.real_price)).filter((n) => n > 0));
  const bestAsk = Math.min(...asks.map((a) => parseFloat(a.real_price)).filter((n) => n > 0));
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) throw new Error("book-empty-or-crossed");
  const mid = Math.round(((bestBid + bestAsk) / 2) * 1e6) / 1e6;
  if (!(mid > 0.001) || mid >= 1000) throw new Error("mid-out-of-range");
  return { mid, bestBid, bestAsk };
}

function parseAsset(s: string): { amount: number; asset: string } {
  const [a, t] = String(s ?? "").trim().split(/\s+/);
  return { amount: parseFloat(a) || 0, asset: t ?? "" };
}

interface ChainOrder {
  orderid: number;
  seller: string;
  side: "buy" | "sell";
  amount: number; // מה-כסף-נעול: STEEM למכירה, SBD לקנייה
  receive: number;
  price: number; // SBD per STEEM
  created: string;
  expiration: string;
}

async function ourOpenOrders(): Promise<{ ours: ChainOrder[]; all: ChainOrder[] }> {
  // צורת-השרשרת האמיתית: for_sale (מדורג ×1000) + sell_price {base, quote} —
  // מכירה: base=STEEM; קנייה: base=SBD. המחיר ב-SBD ל-STEEM בשני-הצדדים.
  const raw = await steemRpc("condenser_api.get_open_orders", [ACCOUNT]);
  const all: ChainOrder[] = (raw ?? []).map((o: any) => {
    const base = parseAsset(o?.sell_price?.base ?? "");
    const quote = parseAsset(o?.sell_price?.quote ?? "");
    const isSell = base.asset === "STEEM";
    const amount = isSell ? base.amount : quote.amount; // נכס-הבסיס STEEM בשני-הצדדים
    const total = isSell ? quote.amount : base.amount; // SBD
    const price = amount > 0 && total > 0 ? Math.round((total / amount) * 1e6) / 1e6 : 0;
    const forSale = Number(o?.for_sale ?? 0) / 1000;
    return {
      orderid: Number(o?.orderid ?? 0),
      seller: String(o?.seller ?? ""),
      side: (isSell ? "sell" : "buy") as "buy" | "sell",
      amount: amount > 0 ? amount : forSale,
      receive: total,
      price,
      created: String(o?.created ?? ""),
      expiration: String(o?.expiration ?? ""),
    };
  });
  return { ours: all, all };
}

async function balances(): Promise<{ steemFree: number; sbdFree: number }> {
  const accts = await steemRpc("condenser_api.get_accounts", [[ACCOUNT]]);
  const a = accts?.[0];
  if (!a) throw new Error("account-empty");
  // היתרה-החופשית — השוק-הפנימי מפקיד כל-פקודה-פתוחה אצלו: היתרה-כאן
  // כבר מנוכה את כל הנעול (שלנו ושל money-mover) — חוק-אחוות-הסוחרים.
  return { steemFree: parseAsset(a.balance).amount, sbdFree: parseAsset(a.sbd_balance).amount };
}

function moverActing(): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(MOVER_STATE, "utf8"));
    state.coordination.moverCheckedAt = new Date().toISOString();
    return m?.acting === true;
  } catch {
    return false; // קובץ-חסר = השכן לא רץ — אין מי שיתנגש
  }
}

// ── fleetChurn — אימות-חי של יכולת-active לחיילים (אין-ממציאים-מפתחות) ─

let fleetChecked = false;
async function fleetVerify(): Promise<void> {
  if (fleetChecked) return;
  fleetChecked = true;
  const fc = cfg.rails.steem.fleetChurn;
  const bundle = vaultRead("SA_FLEET_KEYS");
  if (!bundle) {
    state.fleetChurn = { configured: fc, effective: false, verified: false, reason: "SA_FLEET_KEYS לא בכספת — אין-יכולת-חיול מאומתת", soldiersChecked: 0 };
    return;
  }
  try {
    const bundleObj = JSON.parse(Buffer.from(bundle, "base64").toString("utf8")) as Record<string, string>;
    const names = Object.keys(bundleObj);
    const accts = await steemRpc("condenser_api.get_accounts", [names]);
    const byName = new Map<string, any>((accts ?? []).map((a: any) => [a.name, a]));
    const withActive: string[] = [];
    const nodeRequire = createRequire(path.join(HOME, "package.json"));
    const steem = nodeRequire("steem");
    for (const n of names) {
      const pub = steem.auth.wifToPublic(bundleObj[n]);
      const a = byName.get(n);
      const inActive = (a?.active?.key_auths ?? []).some((k: [string, number]) => k[0] === pub);
      if (inActive) withActive.push(n);
    }
    if (withActive.length > 0) {
      state.fleetChurn = { configured: fc, effective: fc, verified: true, reason: `אומת-חי: ${withActive.length}/${names.length} חיילים עם רשות-active`, soldiersChecked: names.length };
    } else {
      // המדידה-החיה: מפתחות-הצי בכספת הם posting-בלבד (נאומת מול רשויות-השרשרת)
      state.fleetChurn = { configured: fc, effective: false, verified: true, reason: "מפתחות-הצי בכספת הם posting-בלבד (אומת-חי מול רשויות-ה-active של השרשרת) — אין-יכולת-חיול, אין-ממציאים-מפתחות", soldiersChecked: names.length };
    }
  } catch (e) {
    state.fleetChurn = { configured: fc, effective: false, verified: false, reason: `אימות-חי נכשל: ${String((e as Error)?.message ?? e).slice(0, 90)} — כבוי-בכנות`, soldiersChecked: 0 };
  }
}

// ── חתימה ושידור — אותו צינור של עורק /api/money ───────────────────

let signingCtx: { steem: any; wif: string; verified: boolean } | null = null;

function signing(): { steem: any; wif: string; verified: boolean } {
  if (signingCtx) return signingCtx;
  const wif = loadSigningWif(); // fail-closed: exit(2) אם חסר
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  const steem = nodeRequire("steem");
  steem.api.setOptions({ url: "https://api.steemit.com" });
  signingCtx = { steem, wif, verified: false };
  return signingCtx;
}

/** חוק R75 — השרשרת השופטת: הפומבי-הנגזר חייב להיאמת מול רשות-ה-active החיה. */
async function verifySigner(): Promise<void> {
  const ctx = signing();
  if (ctx.verified) return;
  const derivedPub = ctx.steem.auth.wifToPublic(ctx.wif);
  const accts = await steemRpc("condenser_api.get_accounts", [[ACCOUNT]]);
  const a = accts?.[0];
  const ok = (a?.active?.key_auths ?? []).some((k: [string, number]) => k[0] === derivedPub);
  if (!ok) throw new Error("SIGNER-MISMATCH: המפתח-מהכספת לא תואם את רשות-ה-active החיה — אפס שידור");
  ctx.verified = true;
}

/** R112 — bounded-wait: כל שידור עם דדליין; timeout ≠ כישלון — השרשרת השופטת בסקר-orderid. */
async function broadcastOp<T>(p: Promise<T>): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("broadcast-timeout-45s")), 45_000)),
  ]);
}

async function chainCancelOrder(orderid: number): Promise<string | null> {
  const ctx = signing();
  await verifySigner();
  const res = await broadcastOp<any>(
    ctx.steem.broadcast.sendAsync(
      { extensions: [], operations: [["limit_order_cancel", { owner: ACCOUNT, orderid }]] },
      [ctx.wif],
    ),
  );
  return res?.id ?? null;
}

async function chainPlaceOrder(o: { orderid: number; side: "buy" | "sell"; amount: number; price: number; expiration: string }): Promise<string | null> {
  const ctx = signing();
  await verifySigner();
  // חוק-השרשרת (דפוס-מוכח מ-/api/money:1499): פורמט-פקיעה בדיוק-שניות, בלי מילישניות ובלי Z — אחרת "bad lexical cast"
  const expiration = o.expiration.replace(/\.\d{3}Z$/, "");
  const amountToSell = o.side === "sell" ? `${o.amount.toFixed(3)} STEEM` : `${(o.amount * o.price).toFixed(3)} SBD`;
  const minToReceive = o.side === "sell" ? `${(o.amount * o.price).toFixed(3)} SBD` : `${o.amount.toFixed(3)} STEEM`;
  const res = await broadcastOp<any>(
    ctx.steem.broadcast.sendAsync(
      {
        extensions: [],
        operations: [
          [
            "limit_order_create",
            {
              owner: ACCOUNT,
              orderid: o.orderid,
              amount_to_sell: amountToSell,
              min_to_receive: minToReceive,
              fill_or_kill: false,
              expiration,
            },
          ],
        ],
      },
      [ctx.wif],
    ),
  );
  return res?.id ?? null;
}

/** orderid = (ts × 16 + level×2 + side) mod 2^31 — נגזר-מרמה+זמן, ייחודי-בפועל; הרישום ב-state הוא מקור-האמת לביטולים. */
function deriveOrderid(side: "buy" | "sell", level: number): number {
  const ts = Math.floor(Date.now() / 1000);
  const raw = ts * 16 + level * 2 + (side === "sell" ? 1 : 0);
  return raw % 2147483647;
}

// ── מילויים — סקר fill_order בין הבלוק-שנראה לראש ──────────────────

interface LedgerFill {
  ts: string;
  rail: "steem";
  side: "buy" | "sell";
  price: number;
  amount: number; // STEEM
  total: number; // SBD
  feeEst: number; // SBD
  internal: boolean;
  txid: string;
  pnlSbd: number;
}

async function pollFills(): Promise<LedgerFill[]> {
  // דפדוף אחורה עד סימן-המים (limit מקסימלי = 100 לעמוד — חוק-השרשרת)
  const FILL_PAGES_MAX = 4;
  const lastSeen = state.lastFillBlock;
  const head = await steemRpc("condenser_api.get_account_history", [ACCOUNT, -1, 100]);
  if (!Array.isArray(head) || head.length === 0) return [];
  const headBlock = Number(head[head.length - 1]?.[1]?.block ?? 0);
  if (headBlock && lastSeen && headBlock <= lastSeen) return [];
  const fills: LedgerFill[] = [];
  let page: Array<[number, any]> = head;
  for (let p = 0; p < FILL_PAGES_MAX && page.length > 0; p++) {
    let minIdx = Infinity;
    let oldestBlock = Infinity;
    for (const [idx, rec] of page) {
      minIdx = Math.min(minIdx, Number(idx));
      oldestBlock = Math.min(oldestBlock, Number(rec?.block ?? 0));
      const block = Number(rec?.block ?? 0);
      if (lastSeen && block <= lastSeen) break; // הגענו למה שכבר נראה
      const [type, data] = rec.op ?? [];
      if (type !== "fill_order") continue;
      const weCurrent = data?.current_owner === ACCOUNT;
      const weOpen = data?.open_owner === ACCOUNT;
      if (!weCurrent && !weOpen) continue;
      // רק מילויים של פקודות-מרישום-שלנו — המילויים של money-mover לא שייכים לספר הזה
      const myOrderId = weCurrent ? Number(data.current_orderid) : Number(data.open_orderid);
      const reg = state.registry[String(myOrderId)];
      if (!reg) continue;
      const paid = weCurrent ? parseAsset(data.current_pays) : parseAsset(data.open_pays);
      const recv = weCurrent ? parseAsset(data.open_pays) : parseAsset(data.current_pays);
      let side: "buy" | "sell";
      let amount: number;
      let price: number;
      if (paid.asset === "STEEM" && recv.asset === "SBD") {
        side = "sell"; // מכרנו STEEM, קיבלנו SBD
        amount = paid.amount;
        price = paid.amount > 0 ? Math.round((recv.amount / paid.amount) * 1e6) / 1e6 : 0;
      } else if (paid.asset === "SBD" && recv.asset === "STEEM") {
        side = "buy";
        amount = recv.amount;
        price = recv.amount > 0 ? Math.round((paid.amount / recv.amount) * 1e6) / 1e6 : 0;
      } else continue;
      if (!(amount > 0) || !(price > 0)) continue;
      const total = Math.round(amount * price * 1e6) / 1e6;
      const feeEst = Math.round(total * cfg.rails.steem.feeRate * 1e6) / 1e6;
      // PnL-ממומש-מוערך: כמה רחוק המילוי ממרכז-הפריסה שלו, פחות העמלה-המוערכת
      const pnlSbd = Math.round(((side === "sell" ? price - reg.centerAtPlace : reg.centerAtPlace - price) * amount - feeEst) * 1e6) / 1e6;
      const internal = weCurrent && weOpen && data.open_owner === data.current_owner;
      fills.push({
        ts: `${String(rec.timestamp ?? "")}Z`,
        rail: "steem",
        side,
        price,
        amount,
        total,
        feeEst,
        internal,
        // מילויים-וירטואליים אין-להם trx_id — עדות-שרשרת כנה: בלוק+מיקום
        txid: String(rec?.trx_id ?? "") || `block:${block}#${rec?.op_in_trx ?? 0}`,
        pnlSbd,
      });
    }
    // כיסוי-מלא של הפער: אם העמוד הקודם עוד לא חזר אחורה מעבר לסימן-המים — דפדוף נוסף
    if (lastSeen && oldestBlock > lastSeen && minIdx > 1) {
      page = await steemRpc("condenser_api.get_account_history", [ACCOUNT, minIdx - 1, 100]);
      if (!Array.isArray(page) || page.length === 0) break;
    } else break;
  }
  if (headBlock) state.lastFillBlock = headBlock;
  return fills;
}

function recordFill(f: LedgerFill) {
  appendJsonl(LEDGER_FILE, f);
  state.fillsSeen += 1;
  state.fills24h += 1;
  state.volume24hSteem = Math.round((state.volume24hSteem + f.amount) * 1e6) / 1e6;
  state.volume24hSbd = Math.round((state.volume24hSbd + f.total) * 1e6) / 1e6;
  state.realizedPnlSbd = Math.round((state.realizedPnlSbd + f.pnlSbd) * 1e6) / 1e6;
  state.dailyPnlSbd = Math.round((state.dailyPnlSbd + f.pnlSbd) * 1e6) / 1e6;
  if (f.internal) state.internalFills += 1;
}

// ── בניית-הסולם ─────────────────────────────────────────────────────

interface PlannedOrder {
  side: "buy" | "sell";
  level: number;
  price: number;
  amount: number; // STEEM
  total: number; // SBD
}

function planLadder(mid: number, steemFree: number, sbdFree: number): { planned: PlannedOrder[]; note: string } {
  const c = cfg.rails.steem;
  const half = c.spreadBps / 2;
  const steemBudget = steemFree * c.budgetPct; // חוק-אחוות-הסוחרים: יתרה-חופשית בלבד
  const sbdBudget = sbdFree * c.budgetPct;
  const planned: PlannedOrder[] = [];
  let trimmed = 0;
  for (let i = 0; i < c.gridLevels; i++) {
    const offsetBps = half + i * c.levelSpacingBps;
    // מכירה מעל המרכז — התקציב ב-STEEM
    let sellAmt = Math.min(steemBudget / c.gridLevels, c.orderCap);
    if (sellAmt >= c.minOrder && sellAmt <= steemBudget) {
      const price = Math.round(mid * (1 + offsetBps / 10_000) * 1e6) / 1e6;
      planned.push({ side: "sell", level: i + 1, price, amount: Math.round(sellAmt * 1000) / 1000, total: Math.round(sellAmt * price * 1000) / 1000 });
    } else trimmed++;
    // קנייה מתחת למרכז — התקציב ב-SBD
    const price = Math.round(mid * (1 - offsetBps / 10_000) * 1e6) / 1e6;
    let buyAmt = Math.round(Math.min(sbdBudget / c.gridLevels / price, c.orderCap) * 1000) / 1000;
    if (buyAmt >= c.minOrder && buyAmt * price <= sbdBudget) {
      planned.push({ side: "buy", level: i + 1, price, amount: buyAmt, total: Math.round(buyAmt * price * 1000) / 1000 });
    } else trimmed++;
  }
  const note =
    trimmed > 0
      ? `${trimmed} רמות נחתכו בכנות — תקציב-צד/תקרת-פקודה/מינימום לא התקיימו (תקציב ${steemBudget.toFixed(3)} STEEM / ${sbdBudget.toFixed(3)} SBD)`
      : `תקציב ${steemBudget.toFixed(3)} STEEM / ${sbdBudget.toFixed(3)} SBD × ${c.budgetPct}`;
  return { planned, note };
}

// ── פעימה ───────────────────────────────────────────────────────────

let ticking = false;
let tickStartedAt = 0;

async function tick(): Promise<{ ok: boolean; detail: string }> {
  if (ticking) return { ok: false, detail: "פעימה-בטיסה" };
  ticking = true;
  tickStartedAt = Date.now();
  try {
    state.ticks += 1;
    state.killSwitch = fs.existsSync(KILL_FILE);
    // גלגול-יום: מוני-היום מתאפסים בחצות-UTC
    if (state.pnlDay !== utcDay()) {
      state.pnlDay = utcDay();
      state.dailyPnlSbd = 0;
    }
    // היפוך-עצמי מהפסק: רק איפוס-תצורה (mtime חדש של config.json) מקים מחדש
    if (state.halted && state.haltedConfigMtimeMs != null) {
      const mt = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : null;
      if (mt != null && mt > state.haltedConfigMtimeMs) {
        state.halted = false;
        state.haltedAt = null;
        state.haltedConfigMtimeMs = null;
        decision("UNHALTED", "התצורה אופסה מאז-העצירה — המנוע חוזר לעבוד (החלטת-מפעיל נמדדה מ-mtime)");
      }
    }
    await fleetVerify();

    const c = cfg.rails.steem;
    if (!c.enabled) {
      decision("RAIL-DISABLED", "מסילת-STEEM כבויה בתצורה");
      saveState();
      return { ok: false, detail: "מסילה-כבויה" };
    }
    // חוק-בטיחות: התצורה לעולם לא מעירה live לבדה — אחרי עלייה-קרה נדרש POST /mode ידני

    // מילויים — קודם-כול: עבודה שנעשתה נספרת לפני החלטות חדשות
    try {
      const fills = await pollFills();
      for (const f of fills) recordFill(f);
      if (fills.length > 0) decision("FILLS", `${fills.length} מילויים חדשים נספרו מהשרשרת (Σ24ש' volume ${state.volume24hSbd.toFixed(3)} SBD)`);
      // כילוי-רישום: פקודה שנמחקה מהשרשרת כבר לא פתוחה
      const { ours } = await ourOpenOrders();
      const liveIds = new Set(ours.map((o) => o.orderid));
      for (const reg of Object.values(state.registry)) {
        if (reg.dry) continue; // פקודות-יבשה לא חיות על השרשרת — נכחדות רק בגרירה/תפוגה/החלפה
        if (!liveIds.has(reg.orderid)) {
          delete state.registry[String(reg.orderid)];
        }
      }
      state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
      state.coordination.ourOrders = ours.filter((o) => state.registry[String(o.orderid)]).length;
      state.coordination.moverOrders = ours.length - state.coordination.ourOrders;
      state.lastError = null; // המדידה חזרה לעבוד — השגיאה-הישנה לא תישאר תלויה כנגד האמת
    } catch (e) {
      state.lastError = `fills/orders: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
    }

    // מיד ויתרות
    const { mid, bestBid, bestAsk } = await bookMid();
    const bal = await balances();
    state.balances = { steemFree: bal.steemFree, sbdFree: bal.sbdFree, measuredAt: new Date().toISOString() };
    state.centerPrice = mid;
    state.spreadBps = Math.round(((bestAsk - bestBid) / mid) * 10_000);
    state.lastTick = new Date().toISOString();

    // שערים-קשים לפני פריסה
    if (state.halted) {
      decision("HALTED", `המנוע עצור-עצמית (אובדן-יומי ${state.dailyPnlSbd.toFixed(3)} SBD מול תקרה ${cfg.dailyLossCapSbd}) — רק איפוס-תצורה מקים`);
      saveState();
      return { ok: false, detail: "halted" };
    }
    if (state.killSwitch) {
      decision("KILL-SWITCH", "קובץ-ההרג קיים (~/.sovereign/mm-kill) — אפס פריסות; מדידה-בלבד");
      saveState();
      return { ok: true, detail: "kill-switch" };
    }
    if (cfg.dailyLossCapSbd > 0 && state.pnlDay === utcDay() && state.dailyPnlSbd <= -cfg.dailyLossCapSbd) {
      state.halted = true;
      state.haltedAt = new Date().toISOString();
      state.haltedConfigMtimeMs = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : null;
      appendJsonl(DRY_LOG, { ts: new Date().toISOString(), mode: state.mode, rail: "steem", action: "HALT", note: `תקרת-אובדן-יומי נחצה: ${state.dailyPnlSbd.toFixed(3)} ≤ −${cfg.dailyLossCapSbd} SBD — המנוע עצר את עצמו עד איפוס-תצורה` });
      decision("SELF-HALT", `אובדן-יומי ${state.dailyPnlSbd.toFixed(3)} SBD חצה את התקרה (${cfg.dailyLossCapSbd}) — עצירה-עצמית עד איפוס-תצורה`);
      saveState();
      return { ok: false, detail: "self-halt" };
    }
    if (state.mode === "live" && moverActing()) {
      state.coordination.moverActing = true;
      decision("YIELD-MOVER", "money-mover באמצע-פעולה (acting=true) — הפעימה מדלגת על פריסה (אין-שני-שידורים-במקביל על אותו חשבון)");
      saveState();
      return { ok: true, detail: "yield-to-mover" };
    }
    state.coordination.moverActing = false;

    // סטיית-מרכז: הקו זז מעל 2×מרווח מאז-הפריסה ⇒ גרירת-הסולם
    const placedCenter = state.openOrders.length > 0 ? state.openOrders.reduce((s, o) => s + o.centerAtPlace, 0) / state.openOrders.length : null;
    const driftBps = placedCenter != null && placedCenter > 0 ? Math.round(((mid - placedCenter) / placedCenter) * 10_000) : 0;
    const needRecenter = placedCenter != null && Math.abs(driftBps) > 2 * cfg.rails.steem.levelSpacingBps;

    // פקודות-ישנות מעבר ל-refreshHours ⇒ גרירה
    const now = Date.now();
    const stale = state.openOrders.filter((o) => (now - new Date(o.placedAt).getTime()) > cfg.rails.steem.refreshHours * 3_600_000);
    // חוק-אמת-r189: מצב-חי עם פקודות-וירטואליות = הסולם מעולם לא שודר — חובה-פריסה-חיה
    const virtualInLive = state.mode === "live" ? state.openOrders.filter((o) => o.dry).length : 0;
    const reason =
      virtualInLive > 0
        ? `מעבר-dry→live: ${virtualInLive} פקודות-וירטואליות-יבשה מוחלפות בפריסה-חיה על-השרשרת`
        : state.openOrders.length === 0
          ? "סולם-ריק — פריסה-ראשונה"
          : needRecenter
            ? `המרכז זז ${driftBps > 0 ? "+" : ""}${driftBps}bps מאז-הפריסה (${placedCenter!.toFixed(6)} → ${mid.toFixed(6)}) — ביטול+פריסה-מחדש`
            : stale.length > 0
              ? `${stale.length} פקודות ישנות מעבר ל-${cfg.rails.steem.refreshHours}ש' — גרירה`
              : null;

    if (!reason) {
      decision("ON-GRID", `הסולם על הקו: ${state.openOrders.length} פקודות · drift ${driftBps}bps · מרכז ${mid.toFixed(6)} · תקציב ${bal.sbdFree.toFixed(3)} SBD חופשיים`);
      saveState();
      return { ok: true, detail: "on-grid" };
    }

    // תכנון-הסולם החדש
    const { planned, note } = planLadder(mid, bal.steemFree, bal.sbdFree);
    if (planned.length === 0) {
      decision("NO-BUDGET", `אין-מה-לפרוס: ${note}`);
      saveState();
      return { ok: true, detail: "no-budget" };
    }

    if (state.mode === "dry") {
      // DRY — מחשב-הכול, רושם-הכול, משדר-כלום. פקודות-יבשה חיות ברישום-וירטואלי
      // (dry:true) — כך נמדדים-חי גם סטיית-המרכז והגרירה והתפוגה, בדיוק
      // כמו ב-live, בלי אף-שידור. פקודות-חיות-אמיתיות (מסש-live קודם) לא נוגעות-כאן.
      const virtualOld = state.openOrders.filter((o) => o.dry);
      for (const o of virtualOld) {
        dryLog({ action: "cancel", side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, orderid: o.orderid, note: reason });
        delete state.registry[String(o.orderid)];
      }
      const expiration = new Date(now + cfg.rails.steem.refreshHours * 3_600_000).toISOString();
      for (const o of planned) {
        const orderid = deriveOrderid(o.side, o.level);
        state.registry[String(orderid)] = { orderid, side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, placedAt: new Date(now).toISOString(), expiration, centerAtPlace: mid, txid: null, dry: true };
        dryLog({ action: "place", side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, orderid, expiration, note });
      }
      state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
      decision("DRY-LADDER", `DRY: ${planned.length} פקודות (${reason}) — ${note} · אפס-שידור`);
      saveState();
      return { ok: true, detail: `dry:${planned.length}` };
    }

    // LIVE — ביטול-ישן (רק-רישום-שלנו) ואז פריסה
    let cancelled = 0;
    for (const o of state.openOrders) {
      if (o.dry) {
        delete state.registry[String(o.orderid)]; // פקודה-וירטואלית — מעולם לא הייתה על השרשרת, אין-מה-לבטל
        continue;
      }
      try {
        const txid = await chainCancelOrder(o.orderid);
        delete state.registry[String(o.orderid)];
        cancelled += 1;
        console.log(`[market-maker] cancel ${o.orderid} txid=${txid ?? "chain-judge"}`);
      } catch (e) {
        state.lastError = `cancel ${o.orderid}: ${String((e as Error)?.message ?? e).slice(0, 100)}`;
      }
    }
    let placed = 0;
    const expiration = new Date(now + cfg.rails.steem.refreshHours * 3_600_000).toISOString();
    for (const o of planned) {
      const orderid = deriveOrderid(o.side, o.level);
      try {
        const txid = await chainPlaceOrder({ orderid, side: o.side, amount: o.amount, price: o.price, expiration });
        state.registry[String(orderid)] = { orderid, side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, placedAt: new Date().toISOString(), expiration, centerAtPlace: mid, txid, dry: false };
        placed += 1;
        console.log(`[market-maker] place ${o.side} L${o.level} ${o.amount}STEEM @${o.price} orderid=${orderid} txid=${txid ?? "chain-judge"}`);
      } catch (e) {
        state.lastError = `place ${o.side} L${o.level}: ${String((e as Error)?.message ?? e).slice(0, 100)}`;
      }
    }
    state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
    decision("LIVE-LADDER", `LIVE: בוטלו ${cancelled}, הוצבו ${placed}/${planned.length} · ${reason} · ${note}`);
    saveState();
    return { ok: placed > 0, detail: `live:${placed}` };
  } catch (e: any) {
    state.lastError = String(e?.message ?? e).slice(0, 160);
    decision("ERROR", state.lastError);
    saveState();
    return { ok: false, detail: state.lastError };
  } finally {
    ticking = false;
  }
}

// ── שרת-HTTP יחיד חוצה-דורות (חוק weblift/R124) ────────────────────

const G_MM_SRV = globalThis as unknown as { __MM_SERVER__?: unknown };
if (!G_MM_SRV.__MM_SERVER__) {
  G_MM_SRV.__MM_SERVER__ = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1", // פקודות-מסחר מ-localhost בלבד (חוק R123)
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true, service: "market-maker", port: PORT, now: new Date().toISOString() });
      }
      if (url.pathname === "/status") {
        state.killSwitch = fs.existsSync(KILL_FILE);
        return Response.json({
          ok: true,
          service: "market-maker",
          port: PORT,
          state,
          config: { rails: cfg.rails, dailyLossCapSbd: cfg.dailyLossCapSbd, tickSec: cfg.tickSec, _docs: cfg._docs },
          now: new Date().toISOString(),
        });
      }
      if (url.pathname === "/tick" && req.method === "POST") {
        const r = await tick();
        return Response.json({ ok: r.ok, detail: r.detail, state }, { status: r.ok ? 200 : 503 });
      }
      if (url.pathname === "/mode" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const target = body?.mode;
        if (target !== "dry" && target !== "live") {
          return Response.json({ ok: false, error: "mode חייב להיות dry או live" }, { status: 400 });
        }
        state.killSwitch = fs.existsSync(KILL_FILE);
        if (target === "live") {
          if (state.killSwitch) {
            return Response.json({ ok: false, error: "קובץ-ההרג קיים (~/.sovereign/mm-kill) — מעבר-ל-live נסרב עד הסרתו" }, { status: 423 });
          }
          if (state.halted) {
            return Response.json({ ok: false, error: "המנוע עצור-עצמית (תקרת-אובדן) — רק איפוס-תצורה מחזיר" }, { status: 423 });
          }
          if (!fs.existsSync(path.join(VAULT, "secrets", "STEEM_ACTIVE_WIF"))) {
            return Response.json({ ok: false, error: "STEEM_ACTIVE_WIF לא בכספת — fail-closed, אין-חתימה, אין-מעבר-ל-live" }, { status: 409 });
          }
        }
        const from = state.mode;
        state.mode = target;
        cfg.rails.steem.mode = target; // התצורה משקפת את המצב החי
        writeJsonAtomic(CONFIG_FILE, cfg);
        state.lastModeChange = { at: new Date().toISOString(), from, to: target, by: "operator:/mode" };
        decision("MODE-CHANGE", `המצב עבר מ-${from} ל-${target}${target === "live" ? " — הסולם הבא ישודר לשרשרת" : " — אפס-שידור מעתה"}`);
        saveState();
        return Response.json({ ok: true, mode: state.mode, from, to: target });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// ── טיימר-יחיד (חוק R111) + שומר-פעימה (R112) ──────────────────────

const G = globalThis as unknown as { __MM_TIMER__?: ReturnType<typeof setInterval> };
if (G.__MM_TIMER__) clearInterval(G.__MM_TIMER__);
G.__MM_TIMER__ = setInterval(() => {
  const nowMs = Date.now();
  if (ticking && tickStartedAt && nowMs - tickStartedAt > TICK_MAX_MS) {
    ticking = false;
    console.log(`[market-maker] שומר-פעימה: tick נעול >${Math.round(TICK_MAX_MS / 60_000)} דק' — שוחרר בכנות (כל-ה-fetches deadline-bound)`);
  }
  void tick();
}, Math.max(30, cfg.tickSec || TICK_SEC) * 1000);

// r143-c — מתג-איש-מת: שתיקת-פעימות מעל 15 דק' ⇒ יציאה לתחייה (fleet-guard יקים)
installDeadManWatch({
  id: "market-maker",
  lastMs: () => (state.lastTick ? new Date(state.lastTick).getTime() : state.bootedAt ? new Date(state.bootedAt).getTime() : 0),
  stallMs: 15 * 60_000,
  logFile: `${HOME}/sovereign/keeper/logs/market-maker-daemon.log`,
});

saveState();
console.log(`[market-maker] חי על פורט ${PORT} · mode=${state.mode} (dry=ברירת-מחדל, live רק ב-POST /mode) · רגל-HIVE: ${HIVE_RAIL_NOTE}`);
// חוק-בטיחות כנה: תצורה שמבקשת live אחרי עלייה-קרה לא מעירה שידורים לבדה —
// המנוע עולה dry ומדווח שנדרשת החלטת-מפעיל חיה (POST /mode)
if (cfg.rails.steem.mode === "live" && state.mode === "dry") {
  decision("COLD-BOOT-SAFE", "התצורה מבקשת live אך עלייה-קרה תמיד עולה dry — נדרש POST /mode {\"mode\":\"live\"} מהמפעיל");
}
void tick();
