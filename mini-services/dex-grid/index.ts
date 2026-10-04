// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · dex-grid — הגריד-המתנגד על הרשת שלנו (r193 · פורט 3051).
//
// הוראת המפעיל (trace 1a1060bf3883050d): "אני רוצה לייצר עוד גרידים
// מתנגדים על הרשת שלנו מצד שני... רוב אם לא כל התעבורה בכלל תקרה על
// הרשת שלנו אבל אנחנו חייבים להשיג נזילות... ניסיון להנזיל את המטבעות
// דמה שיש לנו בצורה חכמה וגם את הצמודים... מוכח מרווח לא מופסד."
//
// מה זה — סולם-תיקון דו-צדדי על בריכות-ה-DEX שלנו (WSTEEM/WSBD,
// WBLURT/USDS) סביב פאריטת-הפיד החיה:
//   · כשמחיר-הבריכה סוטה ≥ צעד מהפיד — המנוע מבצע סוופ-תיקון על
//     הבריכה שמחזיר אותה לפאריטה ולוכד את הפער (+עמלת-הבריכה נשארת
//     בבריכה — דלק-ספרד-יצרן).
//   · "מתנגד": כשספר-השרשרת (Steem) נעצר-כנה ב-L3-SKEW (צד-אחד-רעב),
//     הגריד שלנו מטה את גודלו פי-2 לעבר הצד שמקבל את זרימת-הפליטים —
//     התעבורה-שאין-לה-לאן-ללכת על-השרשרת נסחרת על-הרשת-שלנו.
//   · דלק: mode="dry" ברירת-מחדל · mode="armed" → חי-אוטומטי כשעומק-
//     הבריכה חוצה את סף-הזריעה (גל-ה-convert 10-06/07 — הזריעה-
//     המתוכננת מ-r192-a) · קפסות-L4 מחייבות.
//
// חוקים: L2 (אין-נגיעה ברצועת-orderid — המנוע סוחר רק על הבריכות
// שלנו) · L3 (מרכז=פיד; אין-פיד → דילוג-כנה) · L4 (קפסות-קוד +
// kill-switch ~/.sovereign/dex-grid-kill) · L5 (PnL ממילויים-בלבד,
// מדוד מול המרכז-בשעת-הביצוע).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { installDeadManWatch, writeJsonAtomic } from "../shared";

const PORT = Number(process.env.DEX_GRID_PORT || 3051);
const TICK_MS = 30_000;
const DIR = "/home/z/my-project/mini-services/dex-grid";
const STATE_FILE = path.join(DIR, "state.json");
const FILLS_FILE = path.join(DIR, "fills.jsonl");
const CONFIG_FILE = path.join(DIR, "config.json");
const KILL_FILE = path.join(
  (process.env.HOME ?? "/home/z") + "/.sovereign",
  "dex-grid-kill",
);
const EXCHANGE_URL = "http://127.0.0.1:3000/api/exchange";
const MM_STATUS_URL = "http://127.0.0.1:3049/status";
const UA = { "user-agent": "saos-sovereign/1.0" };

// ── מתמטיקה טהורה (נבדקת ב-/selftest) ────────────────────────────────

export function calcDevBps(poolMid: number, center: number): number | null {
  if (!(poolMid > 0) || !(center > 0)) return null;
  return Math.round(((poolMid - center) / center) * 1e4);
}

/** כיוון-התיקון: poolMid>center → מוכרים-את-הנכס-העשיר לבריכה (A2B); poolMid<center → קונים-אותו (B2A). */
export function decideSide(poolMid: number, center: number): "A2B" | "B2A" | null {
  const dev = calcDevBps(poolMid, center);
  if (dev == null || dev === 0) return null;
  return dev > 0 ? "A2B" : "B2A";
}

export function levelCount(devBps: number, stepBps: number, maxLevels: number): number {
  if (!(stepBps > 0) || maxLevels < 1) return 0;
  return Math.max(0, Math.min(maxLevels, Math.floor(Math.abs(devBps) / stepBps)));
}

export function opposeBias(skew: number | null, cfg: { enabled: boolean; skewWide: number; skewNarrow: number; biasMult: number }, side: "A2B" | "B2A"): number {
  if (!cfg.enabled || skew == null) return 1;
  // skew גבוה = בידים-רעבים-למוכרים על השרשרת → הזרימה קונה → אנחנו מוכרים (A2B) בהטיה
  if (skew >= cfg.skewWide) return side === "A2B" ? cfg.biasMult : 1;
  if (skew <= cfg.skewNarrow) return side === "B2A" ? cfg.biasMult : 1;
  return 1;
}

/** PnL מול-המרכז ביחידות-נכס-B: הוגנות-היציאה מול מה ששילמנו (A2B: קיבלנו-B; B2A: שילמנו-B-תמורת-A-בשווי-מרכז). */
export function pnlAtCenter(side: "A2B" | "B2A", amountIn: number, amountOut: number, center: number): number {
  if (!(center > 0) || !(amountIn >= 0) || !(amountOut >= 0)) return 0;
  // A2B: מכרנו A וקיבלנו B — רווח = מה-שקיבלנו פחות שווי-הקלט במרכז
  // B2A: קנינו A ב-B — רווח = שווי-היציאה במרכז פחות מה-ששילמנו
  return side === "A2B" ? amountOut - amountIn * center : amountOut * center - amountIn;
}

export function capSizeUsd(wantUsd: number, caps: { maxTxUsd: number; maxDailyVolumeUsd: number }, dailyVolumeUsd: number): number {
  return Math.max(0, Math.min(wantUsd, caps.maxTxUsd, Math.max(0, caps.maxDailyVolumeUsd - dailyVolumeUsd)));
}

// ── מצב ──────────────────────────────────────────────────────────────

interface FillRecord {
  at: string;
  pair: string;
  side: "A2B" | "B2A";
  assetIn: string;
  assetOut: string;
  amountIn: number;
  amountOut: number;
  poolMid: number;
  center: number;
  devBps: number;
  level: number;
  sizeUsd: number;
  pnlB: number;
  pnlUsd: number | null;
  opposeBias: number;
  centerSource: string;
  seq?: number;
}

interface DexGridState {
  version: string;
  service: string;
  port: number;
  bootedAt: string;
  ticks: number;
  lastTickAt: number;
  effectiveMode: "dry" | "live" | "halted";
  haltReason: string | null;
  day: string;
  dailyVolumeUsd: number;
  dailyLossUsd: number;
  realizedPnlUsd: number | null;
  fills: FillRecord[];
  decisions: Array<{ at: string; pair: string; text: string }>;
  oppose: { active: boolean; skew: number | null; mmMode: string | null; note: string };
  centers: Record<string, { value: number | null; source: string }>;
  markets: Record<string, string>;
  lastError: string | null;
  configVersion: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initState(): DexGridState {
  return {
    version: "1.0.0-r193",
    service: "dex-grid",
    port: PORT,
    bootedAt: new Date().toISOString(),
    ticks: 0,
    lastTickAt: Date.now(),
    effectiveMode: "dry",
    haltReason: null,
    day: today(),
    dailyVolumeUsd: 0,
    dailyLossUsd: 0,
    realizedPnlUsd: 0,
    fills: [],
    decisions: [],
    oppose: { active: false, skew: null, mmMode: null, note: "טרם-נמדד" },
    centers: {},
    markets: {},
    lastError: null,
    configVersion: "?",
  };
}

const G = globalThis as unknown as { __DEX_GRID_STATE__?: DexGridState };
const state: DexGridState = G.__DEX_GRID_STATE__ ?? initState();
G.__DEX_GRID_STATE__ = state;

function log(msg: string): void {
  try {
    fs.appendFileSync(path.join(DIR, "dex-grid.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* כנה */ }
  console.log(msg);
}

function pushDecision(pair: string, text: string): void {
  state.decisions.unshift({ at: new Date().toISOString(), pair, text });
  if (state.decisions.length > 80) state.decisions.length = 80;
}

function persist(): void {
  try {
    const fileState = {
      ...state,
      fills: state.fills.slice(0, 50),
      decisions: state.decisions.slice(0, 40),
    };
    writeJsonAtomic(STATE_FILE, fileState);
  } catch (e) {
    log(`persist FAILED: ${e instanceof Error ? e.message : e}`);
  }
}

function killSwitchOn(): boolean {
  try { return fs.existsSync(KILL_FILE); } catch { return true; }
}

function loadConfig(): Record<string, any> {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return raw;
  } catch (e) {
    log(`config read FAILED: ${e instanceof Error ? e.message : e}`);
    return { version: "?", mode: "dry", pairs: {}, caps: { maxTxUsd: 0, maxDailyVolumeUsd: 0 }, oppose: { enabled: false, skewWide: 0.6, skewNarrow: 0.4, biasMult: 1 } };
  }
}

// ── מקורות-חיים ──────────────────────────────────────────────────────

async function jget(url: string, ms: number): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms), headers: { accept: "application/json", ...UA } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function jpost(url: string, body: unknown, ms: number): Promise<any | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

let geckoCache: { at: number; v: Record<string, number> | null } | null = null;
async function coingeckoUsd(): Promise<Record<string, number> | null> {
  if (geckoCache && Date.now() - geckoCache.at < 60_000) return geckoCache.v;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars,hive,hive_dollar,blurt&vs_currencies=usd",
      { cache: "no-store", signal: AbortSignal.timeout(5_000), headers: UA },
    );
    if (!res.ok) { geckoCache = { at: Date.now(), v: null }; return null; }
    const j = (await res.json()) as Record<string, { usd?: number }>;
    const v: Record<string, number> = {};
    for (const [k, o] of Object.entries(j)) if (typeof o?.usd === "number") v[k] = o.usd;
    geckoCache = { at: Date.now(), v: Object.keys(v).length ? v : null };
    return geckoCache.v;
  } catch { geckoCache = { at: Date.now(), v: null }; return null; }
}

async function steemFeedSbdPerSteem(): Promise<{ value: number | null; source: string }> {
  for (const rpc of ["https://api.steemit.com", "https://api.justyy.com"]) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json", ...UA },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_current_median_history_price", params: [], id: 1 }),
        signal: AbortSignal.timeout(4_000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const j: any = await res.json();
      const m: string | undefined = j?.result?.base;
      const q: string | undefined = j?.result?.quote;
      const base = m?.match(/^([\d.]+)\s+SBD$/)?.[1];
      const quote = q?.match(/^([\d.]+)\s+STEEM$/)?.[1];
      if (base && quote && Number(quote) > 0) return { value: Number(base) / Number(quote), source: `פיד-השרשרת (${rpc})` };
    } catch { /* ה-RPC הבא */ }
  }
  const g = await coingeckoUsd();
  if (g?.steem && g?.["steem-dollars"]) return { value: g["steem-dollars"] / g.steem, source: "CoinGecko-נגזר (פיד-נפל)" };
  return { value: null, source: "אין-מרכז" };
}

async function hiveFeedHbdPerHive(): Promise<{ value: number | null; source: string }> {
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json", ...UA },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_current_median_history_price", params: [], id: 1 }),
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    if (res.ok) {
      const j: any = await res.json();
      const base: string | undefined = j?.result?.base;
      const quote: string | undefined = j?.result?.quote;
      const b = base?.match(/^([\d.]+)\s+HBD$/)?.[1];
      const q = quote?.match(/^([\d.]+)\s+HIVE$/)?.[1];
      if (b && q && Number(q) > 0) return { value: Number(b) / Number(q), source: "פיד-השרשרת (hive)" };
    }
  } catch { /* כנה */ }
  return { value: null, source: "אין-מרכז" };
}

// ── מרכז-לפי-בריכה ───────────────────────────────────────────────────

async function centerFor(pair: string, cfgPair: any, snapPrices: Record<string, number | null>, gecko: Record<string, number> | null): Promise<{ value: number | null; source: string }> {
  const src = String(cfgPair?.center ?? "");
  if (src === "steem-feed") {
    const feed = await steemFeedSbdPerSteem();
    if (feed.value != null) return feed;
    // נפילות-ריבוניות: שרשרת-המחירים של הריפו (CEX÷פאריטה) → CoinGecko-נגזר
    const sbd = snapPrices["sbd"] ?? gecko?.["steem-dollars"] ?? null;
    const steem = snapPrices["steem"] ?? gecko?.steem ?? null;
    if (sbd != null && steem != null && steem > 0) return { value: sbd / steem, source: "שרשרת-המחירים-הריבונית (פיד-נפל)" };
    return { value: null, source: feed.source };
  }
  if (src === "hive-feed") return hiveFeedHbdPerHive();
  if (src === "coingecko-blurt") {
    const p = snapPrices["blurt"] ?? gecko?.blurt ?? null;
    return p != null ? { value: p, source: "שרשרת-המחירים-הריבונית (BLURT/USD)" } : { value: null, source: "אין-מרכז-BLURT (CoinGecko-429/אין-CEX) — כנה" };
  }
  return { value: null, source: `מרכז-לא-מוכר (${src})` };
}

async function usdPricesFor(pair: string, snapPrices: Record<string, number | null>, gecko: Record<string, number> | null): Promise<{ a: number | null; b: number | null; source: string }> {
  // הקנון: שרשרת-המחירים של הריפו (pricesUsd — CoinGecko→CEX→פאריטה-סוברנית); CoinGecko-ישיר רק-כגיבוי
  if (pair === "WSTEEM/WSBD") {
    return {
      a: snapPrices["steem"] ?? gecko?.steem ?? null,
      b: snapPrices["sbd"] ?? gecko?.["steem-dollars"] ?? null,
      source: "שרשרת-המחירים-הריבונית",
    };
  }
  if (pair === "WBLURT/USDS") {
    return {
      a: snapPrices["blurt"] ?? gecko?.blurt ?? null,
      // כנות-L5: USDS מגובה 1:1 ב-WSBD — ערכו ב-USD הוא מחיר-ה-SBD, לא $1
      b: snapPrices["sbd"] ?? gecko?.["steem-dollars"] ?? null,
      source: "שרשרת-המחירים-הריבונית (USDS=SBD-גיבוי)",
    };
  }
  return { a: null, b: null, source: "לא-מוגדר" };
}

// ── פעימה ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const t0 = Date.now();
  state.ticks += 1;
  state.lastTickAt = Date.now();

  // גלגול-יום
  if (state.day !== today()) {
    state.day = today();
    state.dailyVolumeUsd = 0;
    state.dailyLossUsd = 0;
    state.haltReason = null;
  }

  const cfg = loadConfig();
  state.configVersion = String(cfg.version ?? "?");
  const caps = cfg.caps ?? {};
  const opposeCfg = cfg.oppose ?? { enabled: false, skewWide: 0.6, skewNarrow: 0.4, biasMult: 1 };

  // kill-switch (L4) — fail-closed
  if (killSwitchOn()) {
    state.effectiveMode = "dry";
    state.markets = { ...state.markets, kill: "KILL — ~/.sovereign/dex-grid-kill קיים" };
    pushDecision("*", "kill-switch פעיל — אפס-פעולה");
    persist();
    return;
  }

  // מדידת-השכן: מנוע-הגריד על השרשרת (הטיית-ההתנגדות)
  const mm = await jget(MM_STATUS_URL, 3_000);
  const mmMode = mm?.mode ?? null;
  let skew: number | null = null;
  const sk = mm?.l3?.skew ?? mm?.skew ?? null;
  if (typeof sk === "number") skew = sk;
  else {
    // ניתוח-כנה משורת-ההחלטה האחרונה (0.9624 דוגמה מהשטח)
    const m = String(mm?.lastDecision?.detail ?? "").match(/skew ([\d.]+)/);
    if (m) skew = Number(m[1]);
  }
  state.oppose = {
    active: opposeCfg.enabled && skew != null && (skew >= opposeCfg.skewWide || skew <= opposeCfg.skewNarrow),
    skew,
    mmMode,
    note: skew == null
      ? "סקיו לא נמדד — הטיית-התנגדות כבויה-כנה"
      : skew >= opposeCfg.skewWide
        ? "השרשרת רעבה-למוכרים — הטיה ×" + opposeCfg.biasMult + " למכירת-הצד-העשיר אצלנו"
        : skew <= opposeCfg.skewNarrow
          ? "השרשרת רעבה-לקונים — הטיה ×" + opposeCfg.biasMult + " לקניית-הצד-הזול אצלנו"
          : "סקיו בטווח-רגוע — אין-הטיה",
  };

  // דלפק-הבריכות שלנו
  const snap = await jget(EXCHANGE_URL, 6_000);
  const pools: any[] = Array.isArray(snap?.pools) ? snap.pools : [];
  const snapPrices: Record<string, number | null> = (snap?.prices ?? {}) as Record<string, number | null>;
  const gecko = await coingeckoUsd();
  state.markets = {
    ...state.markets,
    exchange: snap?.ok ? "ok" : "fail",
    mm: mm ? "ok" : "fail",
    feed: state.centers["WSTEEM/WSBD"]?.value != null ? "ok" : "fail",
  };

  // קביעת-מצב-אפקטיבי (dry | armed→live בעומק | halt-יומי)
  const armed = String(cfg.mode ?? "dry") === "armed";
  const wsteemPool = pools.find((p) => p.pair === "WSTEEM/WSBD");
  const depthOk = armed && wsteemPool && typeof wsteemPool.depthUsd === "number" && wsteemPool.depthUsd >= (cfg.arm?.minPoolDepthUsd ?? 20);
  if (state.dailyLossUsd <= -(caps.maxDailyLossUsd ?? 1)) {
    state.effectiveMode = "halted";
    state.haltReason = `תקרת-אובדן-יומי (${state.dailyLossUsd.toFixed(3)} ≤ −${caps.maxDailyLossUsd ?? 1}) — עצירה-עצמית עד-גלגול-היום (L4)`;
  } else if (armed && depthOk) {
    state.effectiveMode = "live";
    state.haltReason = null;
  } else {
    state.effectiveMode = "dry";
    if (armed && !depthOk) state.haltReason = `מזוין-וממתין-לדלק: עומק-הבריכה ${wsteemPool?.depthUsd ?? "?"} < סף-הזריעה ${cfg.arm?.minPoolDepthUsd ?? 20}`;
    else state.haltReason = null;
  }

  if (!pools.length) {
    pushDecision("*", "אין-בריכות-חיות מהדלפק — דילוג-כנה");
    persist();
    return;
  }

  for (const [pair, cfgPair] of Object.entries<any>(cfg.pairs ?? {})) {
    if (!cfgPair?.enabled) continue;
    const pool = pools.find((p) => p.pair === pair);
    if (!pool) { pushDecision(pair, "בריכה-לא-נמצאה בדלפק-החי"); continue; }
    const has = Number(pool.reserveA) > 0 && Number(pool.reserveB) > 0;
    if (!has) { pushDecision(pair, "בריכת-אבק (רזרבות-0) — כנה"); continue; }

    const { value: center, source: centerSource } = await centerFor(pair, cfgPair, snapPrices, gecko);
    state.centers[pair] = { value: center, source: centerSource };
    if (center == null || !(center > 0)) { pushDecision(pair, `אין-מרכז (${centerSource}) — דילוג-כנה (L3)`); continue; }

    const poolMid = Number(pool.reserveB) / Number(pool.reserveA);
    const devBps = calcDevBps(poolMid, center);
    if (devBps == null) continue;
    const stepBps = Math.round(Number(cfgPair.stepPct ?? 0.01) * 1e4);
    const lvl = levelCount(devBps, stepBps, Number(cfgPair.maxLevels ?? 3));
    const side = decideSide(poolMid, center);
    if (!side || lvl < 1) {
      pushDecision(pair, `בתוך-הסולם (dev ${devBps}bps < צעד ${stepBps}bps) — אין-פעולה`);
      continue;
    }

    const bias = opposeBias(skew, opposeCfg, side);
    const wantUsd = Number(cfgPair.sizeUsdPerLevel ?? 2) * Math.min(lvl, Number(cfgPair.maxLevels ?? 3)) * bias;
    const sizeUsd = capSizeUsd(wantUsd, { maxTxUsd: Number(caps.maxTxUsd ?? 2), maxDailyVolumeUsd: Number(caps.maxDailyVolumeUsd ?? 20) }, state.dailyVolumeUsd);
    if (sizeUsd <= 0) {
      pushDecision(pair, `קפסות-L4 מנקזות-את-הרמה (רצוי ${wantUsd.toFixed(2)}$ · יומי ${state.dailyVolumeUsd.toFixed(2)}$) — דילוג`);
      continue;
    }

    const assetIn = side === "A2B" ? pool.assetA : pool.assetB;
    const assetOut = side === "A2B" ? pool.assetB : pool.assetA;
    const { a: usdA, b: usdB } = await usdPricesFor(pair, snapPrices, gecko);
    const priceIn = side === "A2B" ? usdA : usdB;
    if (priceIn == null || !(priceIn > 0)) { pushDecision(pair, "אין-מחיר-USD לנכס-הכניסה — דילוג-כנה"); continue; }

    // עומק-הבריכה חוסם (L1) — לא רוצים לגרור-מחיר-עצמנו מעבר-השפעה-סבירה
    const reserveIn = side === "A2B" ? Number(pool.reserveA) : Number(pool.reserveB);
    const maxInUnits = reserveIn * Number(caps.reserveFrac ?? 0.05);
    let amountIn = sizeUsd / priceIn;
    if (amountIn > maxInUnits) {
      amountIn = maxInUnits;
      pushDecision(pair, `הצטמצם לעומק-הבריכה (L1): ${maxInUnits.toFixed(6)} ${assetIn}`);
    }
    if (!(amountIn > 0)) continue;

    if (state.effectiveMode !== "live") {
      pushDecision(pair, `${side} רמה-${lvl} (${devBps}bps, הטיה×${bias}, ${sizeUsd.toFixed(2)}$) — DRY (מצב ${state.effectiveMode})`);
      continue;
    }

    // חי: quote → swap עם minOut (שומר-החלקה L4)
    const q = await jget(`${EXCHANGE_URL}?with=quote&pair=${encodeURIComponent(pair)}&side=${side}&amountIn=${amountIn}`, 6_000);
    const expectedOut = Number(q?.quote?.expectedOut ?? 0);
    if (!(expectedOut > 0)) { pushDecision(pair, "quote לא חזר — דילוג-כנה"); continue; }
    const minOut = expectedOut * (1 - Number(caps.slippageGuard ?? 0.01));
    const r = await jpost(EXCHANGE_URL, { action: "swap", pair, side, amountIn, minOut }, 10_000);
    if (!r?.ok) {
      pushDecision(pair, `swap נדחה: ${String(r?.error ?? r?.detail ?? "לא-ידוע").slice(0, 120)}`);
      state.lastError = String(r?.error ?? r?.detail ?? "swap-reject").slice(0, 200);
      continue;
    }
    const amountOut = Number(r.outAmount ?? r.quote?.expectedOut ?? expectedOut);
    const pnlB = pnlAtCenter(side, amountIn, amountOut, center);
    const pnlAssetUsd = usdB; // יחידת-ה-PnL היא נכס-היציאה (B — WSBD/USDS, משווק-בכנות ל-SBD)
    const pnlUsd = pnlAssetUsd != null ? pnlB * pnlAssetUsd : null;
    const fill: FillRecord = {
      at: new Date().toISOString(),
      pair, side, assetIn, assetOut,
      amountIn: Math.round(amountIn * 1e6) / 1e6,
      amountOut: Math.round(amountOut * 1e6) / 1e6,
      poolMid: Math.round(poolMid * 1e9) / 1e9,
      center: Math.round(center * 1e9) / 1e9,
      devBps, level: lvl,
      sizeUsd: Math.round(sizeUsd * 100) / 100,
      pnlB: Math.round(pnlB * 1e9) / 1e9,
      pnlUsd: pnlUsd == null ? null : Math.round(pnlUsd * 10000) / 10000,
      opposeBias: bias,
      centerSource,
    };
    state.fills.unshift(fill);
    if (state.fills.length > 200) state.fills.length = 200;
    if (fill.seq == null) fill.seq = state.fills.length;
    state.dailyVolumeUsd = Math.round((state.dailyVolumeUsd + fill.sizeUsd) * 100) / 100;
    state.realizedPnlUsd = state.realizedPnlUsd == null ? fill.pnlUsd : (state.realizedPnlUsd ?? 0) + (fill.pnlUsd ?? 0);
    if (fill.pnlUsd != null && fill.pnlUsd < 0) state.dailyLossUsd = Math.round((state.dailyLossUsd + fill.pnlUsd) * 10000) / 10000;
    try {
      fs.appendFileSync(FILLS_FILE, JSON.stringify(fill) + "\n");
    } catch { /* כנה */ }
    pushDecision(pair, `FILL ${side} ${fill.amountIn} ${assetIn}→${fill.amountOut} ${assetOut} (dev ${devBps}bps, הטיה×${bias}) PnL=${fill.pnlB} ${assetOut}`);
    log(`FILL ${pair} ${side} in=${fill.amountIn} out=${fill.amountOut} dev=${devBps}bps pnlB=${fill.pnlB}`);
  }

  persist();
  log(`tick #${state.ticks} ok ${Date.now() - t0}ms · mode=${state.effectiveMode} · oppose=${state.oppose.active} · fills=${state.fills.length}`);
}

// ── selftest — טהור, אפס-רשת ─────────────────────────────────────────

function selftest(): { ok: boolean; passed: number; failed: string[] } {
  const failed: string[] = [];
  let passed = 0;
  const t = (name: string, cond: boolean) => { if (cond) passed += 1; else failed.push(name); };

  t("dev-אפס", calcDevBps(0.1041, 0.1041) === 0);
  t("dev-חיובי", calcDevBps(0.1051, 0.1041) === Math.round(((0.1051 - 0.1041) / 0.1041) * 1e4));
  t("dev-null-על-אפס", calcDevBps(0, 0.1) == null);
  t("side-A2B-עשיר", decideSide(0.11, 0.1041) === "A2B");
  t("side-B2A-זול", decideSide(0.10, 0.1041) === "B2A");
  t("side-null-בתוך-צעד", decideSide(0.1041, 0.1041) == null);
  t("רמות-מדויק", levelCount(180, 60, 4) === 3);
  t("רמות-תקרה", levelCount(999, 60, 4) === 4);
  t("רמות-אפס", levelCount(30, 60, 4) === 0);
  t("הטיה-skew-רעב-למוכרים", opposeBias(0.7, { enabled: true, skewWide: 0.6, skewNarrow: 0.4, biasMult: 2 }, "A2B") === 2);
  t("הטיה-צד-השני-לא-מוטה", opposeBias(0.7, { enabled: true, skewWide: 0.6, skewNarrow: 0.4, biasMult: 2 }, "B2A") === 1);
  t("הטיה-skew-רעב-לקונים", opposeBias(0.3, { enabled: true, skewWide: 0.6, skewNarrow: 0.4, biasMult: 2 }, "B2A") === 2);
  t("הטיה-כבויה", opposeBias(0.9, { enabled: false, skewWide: 0.6, skewNarrow: 0.4, biasMult: 2 }, "A2B") === 1);
  t("הטיה-בטווח-רגוע", opposeBias(0.5, { enabled: true, skewWide: 0.6, skewNarrow: 0.4, biasMult: 2 }, "A2B") === 1);
  t("pnl-מכירה-מעל-המרכז", pnlAtCenter("A2B", 1, 0.1051, 0.1041) > 0);
  t("pnl-מכירה-מתחת-המרכז", pnlAtCenter("A2B", 1, 0.103, 0.1041) < 0);
  t("pnl-קנייה-מתחת-המרכז", pnlAtCenter("B2A", 1.0, 10, 0.1041) > 0); // שילם 1.0 עבור מה ששווה 1.041 במרכז
  t("pnl-קנייה-בדיוק-בפאריטה-אפס", Math.abs(pnlAtCenter("B2A", 1.041, 10, 0.1041)) < 1e-9);
  t("pnl-אפס-על-פאריטה", Math.abs(pnlAtCenter("A2B", 1, 0.1041, 0.1041)) < 1e-12);
  t("קפסה-tx", capSizeUsd(5, { maxTxUsd: 2, maxDailyVolumeUsd: 20 }, 0) === 2);
  t("קפסה-יומי", capSizeUsd(5, { maxTxUsd: 2, maxDailyVolumeUsd: 20 }, 19) === 1);
  t("קפסה-מותשת", capSizeUsd(5, { maxTxUsd: 2, maxDailyVolumeUsd: 20 }, 20) === 0);
  t("קפסה-שלילי-אפס", capSizeUsd(5, { maxTxUsd: 2, maxDailyVolumeUsd: 20 }, 25) === 0);

  return { ok: failed.length === 0, passed, failed };
}

// ── שרת ──────────────────────────────────────────────────────────────

function handle(req: Request): Response {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/status") {
    return Response.json({
      ok: true,
      service: "dex-grid",
      port: PORT,
      mode: state.effectiveMode,
      configMode: String(loadConfig().mode ?? "?"),
      haltReason: state.haltReason,
      killSwitch: killSwitchOn(),
      bootedAt: state.bootedAt,
      now: new Date().toISOString(),
      ticks: state.ticks,
      lastTickAt: new Date(state.lastTickAt).toISOString(),
      day: state.day,
      dailyVolumeUsd: state.dailyVolumeUsd,
      dailyLossUsd: state.dailyLossUsd,
      realizedPnlUsd: state.realizedPnlUsd,
      fillsCount: state.fills.length,
      oppose: state.oppose,
      centers: state.centers,
      markets: state.markets,
      lastError: state.lastError,
      configVersion: state.configVersion,
      caps: loadConfig().caps ?? null,
    });
  }
  if (p === "/grid") {
    const cfg = loadConfig();
    const ladder: Record<string, unknown> = {};
    for (const [pair, cp] of Object.entries<any>(cfg.pairs ?? {})) {
      const c = state.centers[pair]?.value;
      const step = Number(cp?.stepPct ?? 0.01);
      ladder[pair] = {
        center: c,
        centerSource: state.centers[pair]?.source ?? null,
        stepPct: step,
        levels: c != null
          ? Array.from({ length: Number(cp?.maxLevels ?? 3) }, (_, i) => ({
              buy: c * (1 - step * (i + 1)),
              sell: c * (1 + step * (i + 1)),
            }))
          : null,
        sizeUsdPerLevel: cp?.sizeUsdPerLevel ?? null,
      };
    }
    return Response.json({ ok: true, mode: state.effectiveMode, ladder, oppose: state.oppose, decisions: state.decisions.slice(0, 20) });
  }
  if (p === "/fills") {
    const n = Math.max(1, Math.min(200, Number(url.searchParams.get("n") ?? 20)));
    return Response.json({ ok: true, count: state.fills.length, fills: state.fills.slice(0, n) });
  }
  if (p === "/pnl") {
    return Response.json({
      ok: true,
      realizedPnlUsd: state.realizedPnlUsd,
      dailyLossUsd: state.dailyLossUsd,
      dailyVolumeUsd: state.dailyVolumeUsd,
      day: state.day,
      fills: state.fills.slice(0, 50),
      note: "PnL ממילויים-בלבד, מדוד מול מרכז-הפיד בשעת-הביצוע (חוק-L5)",
    });
  }
  if (p === "/selftest") {
    const r = selftest();
    return Response.json({ ...r, at: new Date().toISOString() }, { status: 200 });
  }
  return Response.json({ ok: false, error: "not-found", endpoints: ["/status", "/grid", "/fills?n=", "/pnl", "/selftest"] }, { status: 404 });
}

// ── עלייה ────────────────────────────────────────────────────────────

try {
  const cfg = loadConfig();
  state.configVersion = String(cfg.version ?? "?");
} catch { /* כנה */ }

installDeadManWatch({
  id: "dex-grid",
  lastMs: () => state.lastTickAt,
  stallMs: 10 * 60_000,
  logFile: "/home/z/my-project/sovereign/keeper/logs/dex-grid-daemon.log",
});

const B = globalThis as unknown as {
  Bun?: {
    serve: (opts: { port: number; hostname: string; fetch: (req: Request) => Response | Promise<Response> }) => unknown;
  };
};

B.Bun?.serve({ port: PORT, hostname: "127.0.0.1", fetch: handle });
log(`dex-grid up :${PORT} · mode=${state.effectiveMode} · r193 — הגריד-המתנגד על הרשת שלנו`);

const timer = setInterval(() => { void tick().catch((e) => { state.lastError = String(e).slice(0, 200); log(`tick ERR: ${e}`); persist(); }); }, TICK_MS);
timer.unref?.();

void tick().catch((e) => { state.lastError = String(e).slice(0, 200); log(`first-tick ERR: ${e}`); });
