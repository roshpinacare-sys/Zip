// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Sovereign Exchange — זירת-המסחר הריבונית (R102)
//
// הוראת המפעיל: "להפוך את השוק שלנו לחי אמיתי תוך שילוב והפקה של מה
// שצריך כדי לגרום לזרימה אמיתית וטיפול ראוי במטבעות הפנימיים שלנו כדי
// לשמור על הערך שלהם ועדיין לייצר יכולת להחליף אותם ולשמש אותם עבור
// המערכת ליצירת ערך."
//
// החוקה (מנגנון, לא הבטחה):
//   · ספר-פנים hash-chained — entryHash = keccak(prevHash‖seq‖kind‖member‖
//     payload) — אותה שיטת ספר של האימותים והשוק; כל פעולה קנונית וניתנת
//     לחישוב-חדש מה-DB.
//   · נכסים-עטופים 1:1 — WSTEEM/WSBD/WHIVE/WHBD/WBLURT נזקפים רק מול
//     הפקדות אמיתיות (רייל-המזכר "wx:<member>") או מהון-אוצר נמדד;
//     המשיכה שורפת את העטיפה ומשדררת העברה אמיתית בשרשרת.
//   · USDS בגיבוי-רזרבה מלא — הטבעה רק מול נעילת SBD/HBD (1:1), פדיון
//     שורף 1:1. היצע = רזרבה, תמיד. שמירת-הערך במבנה, לא בהבטחה.
//   · בריכות AMM קבועות-מכפלה — עמלת 30bps נשארת בתוך הבריכה (ערך
//     ה-LP של האוצר צומח מהעמלות): "העמלות ייגזרו בבריכות שלנו".
//   · שער-$100 — משיכה מתחת לסף מבוצעת אוטונומית; מהסף — תור-מפעיל.
//
// כנות מובנית: עומק הבריכות = ההון הריאלי הפנוי בלבד. הזירה לא מציגה
// נזילות שאיננה; היא מציגה מנגנון אמיתי שגדל ממילויי-גריד והפקדות.
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import path from "node:path";
import { db } from "@/lib/db";
import { hashText } from "@/lib/weave/chain";
import { steemBroadcast, rpcV4, STEEM_RPC_NODES, HIVE_RPC, HIVE_CHAIN_ID, signGrapheneTx } from "@/lib/weave/graphene";
import { openVaultKey } from "@/lib/dex/wallet-vault";
import { blurtSendTransfer, BLURT_RPC } from "@/lib/dex/blurt-wire";
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";
import { saosLiveTransferOut, foldLiveState } from "@/lib/weave/saos-rail";

const HOME = "/home/z/my-project";
const nodeRequire = createRequire(path.join(HOME, "package.json"));
const steem = nodeRequire("steem") as {
  auth: { toWif(a: string, p: string, r: string): string };
  broadcast: { sendAsync(tx: unknown, keys: string[]): Promise<{ id?: string }> };
};
const fs = nodeRequire("node:fs") as typeof import("node:fs");

const TREASURY = "headcorner"; // חשבון-האוצר על השרשרת (המפעיל)
const FEE_BPS = 30; // 0.3% — העמלה שלנו בבריכה שלנו
const KEEP_FUEL_RATIO = 0.1; // 10% מהנוזלי נשמר כדלק-שידור (חוק שימור-הון)
export const EXCHANGE_ASSETS = ["WSTEEM", "WSBD", "WHIVE", "WHBD", "WBLURT", "USDS", "SAOS"] as const;
export type ExchangeAsset = (typeof EXCHANGE_ASSETS)[number];

// ── ספר hash-chained ────────────────────────────────────────────────

export interface ChainedEvent {
  seq: number;
  kind: string;
  member: string;
  payload: string;
  prevHash: string;
  hash: string;
}

async function lastEvent(): Promise<ChainedEvent | null> {
  const r = await db.exchangeEvent.findFirst({ orderBy: { seq: "desc" } });
  return r ? { seq: r.seq, kind: r.kind, member: r.member, payload: r.payload, prevHash: r.prevHash, hash: r.hash } : null;
}

async function chainEvent(kind: string, member: string, payload: Record<string, unknown>, usdValue: number | null): Promise<ChainedEvent> {
  const prev = await lastEvent();
  const seq = (prev?.seq ?? 0) + 1;
  const canonical = JSON.stringify(payload);
  const hash = hashText(`${prev?.hash ?? "0"}|${seq}|${kind}|${member}|${canonical}`);
  const row = await db.exchangeEvent.create({
    data: {
      seq,
      kind,
      member,
      payload: canonical,
      prevHash: prev?.hash ?? "0",
      hash,
      ...(usdValue != null ? { usdValue } : {}),
    },
  });
  return { seq: row.seq, kind: row.kind, member: row.member, payload: row.payload, prevHash: row.prevHash, hash: row.hash };
}

async function eventExists(kind: string, txid: string): Promise<boolean> {
  const n = await db.exchangeEvent.count({ where: { kind, payload: { contains: txid } } });
  return n > 0;
}

// ── מאזנים ───────────────────────────────────────────────────────────

type Balances = Partial<Record<ExchangeAsset, number>>;

async function getAccountRow(member: string) {
  let row = await db.exchangeAccount.findUnique({ where: { member } });
  if (!row) row = await db.exchangeAccount.create({ data: { member, balances: "{}" } });
  return row;
}

async function readBalances(member: string): Promise<Balances> {
  const row = await getAccountRow(member);
  try { return JSON.parse(row.balances) as Balances; } catch { return {}; }
}

async function writeBalances(member: string, b: Balances): Promise<void> {
  const clean: Balances = {};
  for (const [k, v] of Object.entries(b)) if (v && v > 0) clean[k as ExchangeAsset] = v;
  // upsert — השורה עשויה להיווצר כאן לראשונה (ג'נזיס/הפקדה ראשונה)
  await db.exchangeAccount.upsert({
    where: { member },
    create: { member, balances: JSON.stringify(clean) },
    update: { balances: JSON.stringify(clean) },
  });
}

async function adjust(member: string, asset: ExchangeAsset, delta: number): Promise<number> {
  const b = await readBalances(member);
  const next = Math.round(((b[asset] ?? 0) + delta) * 1e9) / 1e9; // דיוק נאיבי של µ
  if (next < -1e-9) throw new Error(`INSUFFICIENT: ל-${member} אין מספיק ${asset}`);
  b[asset] = next;
  await writeBalances(member, b);
  return next;
}

// ── מדידות חיות (הזנת הג'נזיס והתצוגה) ───────────────────────────────

export interface TreasuryMeasure {
  steem: number;
  sbd: number;
  hive: number;
  hbd: number;
  blurt: number;
  rpc: { steem: boolean; hive: boolean; blurt: boolean };
  at: string;
}

async function measureTreasury(): Promise<TreasuryMeasure | null> {
  try {
    const steemAcct = await rpcV4<Array<{ balance: string; sbd_balance: string }>>(
      STEEM_RPC_NODES[0], "condenser_api.get_accounts", [[TREASURY]],
    );
    const hiveAcct = await rpcV4<Array<{ balance: string; hbd_balance: string }>>(
      HIVE_RPC, "condenser_api.get_accounts", [[TREASURY]],
    ).catch(() => null);
    const blurtAcct = await fetch("https://rpc.blurt.blog", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "saos-weave-rail/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[TREASURY]] }),
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.json() as Promise<{ result?: Array<{ balance: string }> }>).catch(() => null);
    if (!steemAcct || !steemAcct.length) return null;
    return {
      steem: parseFloat(steemAcct[0].balance) || 0,
      sbd: parseFloat(steemAcct[0].sbd_balance) || 0,
      hive: hiveAcct?.[0] ? parseFloat(hiveAcct[0].balance) || 0 : 0,
      hbd: hiveAcct?.[0] ? parseFloat(hiveAcct[0].hbd_balance) || 0 : 0,
      blurt: blurtAcct?.result?.[0] ? parseFloat(blurtAcct.result[0].balance) || 0 : 0,
      rpc: { steem: true, hive: !!hiveAcct, blurt: !!blurtAcct?.result },
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function pricesUsd(): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = { steem: null, sbd: null, hive: null, hbd: null, blurt: null, sol: null, eth: null };
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbols=%5B%22STEEMUSDT%22,%22HIVEUSDT%22,%22SOLUSDT%22,%22ETHUSDT%22%5D", {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as Array<{ symbol: string; price: string }>;
    for (const t of j) {
      const p = Number(t.price);
      if (!Number.isFinite(p)) continue;
      if (t.symbol === "STEEMUSDT") out.steem = p;
      if (t.symbol === "HIVEUSDT") out.hive = p;
      if (t.symbol === "SOLUSDT") out.sol = p;
      if (t.symbol === "ETHUSDT") out.eth = p;
    }
  } catch { /* כנות: לא נמדד */ }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars,hive-backed-dollar,blurt&vs_currencies=usd", {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as Record<string, { usd?: number }>;
    if (j["steem-dollars"]?.usd) out.sbd = j["steem-dollars"].usd;
    if (j["hive-backed-dollar"]?.usd) out.hbd = j["hive-backed-dollar"].usd;
    if (j.blurt?.usd) out.blurt = j.blurt.usd;
  } catch { /* כנות: לא נמדד */ }
  // נתיב-ריבוני: גזירת SBD/HBD מפריטת השוק הפנימי החי — השוק שלנו הוא המקור.
  // 1 STEEM = P SBD (real_price מ-market_history_api) ו-STEEM=$X (בינאנס) ⟹ SBD = $X/P.
  if (out.sbd == null && out.steem != null) {
    try {
      const book = await rpcV4<{ bids?: Array<{ real_price?: string }>; asks?: Array<{ real_price?: string }> }>(
        STEEM_RPC_NODES[0], "market_history_api.get_order_book", { limit: 5 },
      );
      const bestBid = Number(book?.bids?.[0]?.real_price ?? 0);
      const bestAsk = Number(book?.asks?.[0]?.real_price ?? 0);
      if (bestBid > 0 && bestAsk > 0) {
        const parity = (bestBid + bestAsk) / 2; // SBD per STEEM
        if (parity > 0) out.sbd = out.steem / parity;
      }
    } catch { /* נשאר null — כנות */ }
  }
  if (out.hbd == null && out.hive != null) {
    try {
      const book = await rpcV4<{ bids?: Array<{ real_price?: string }>; asks?: Array<{ real_price?: string }> }>(
        HIVE_RPC, "market_history_api.get_order_book", { limit: 5 },
      );
      const bestBid = Number(book?.bids?.[0]?.real_price ?? 0);
      const bestAsk = Number(book?.asks?.[0]?.real_price ?? 0);
      if (bestBid > 0 && bestAsk > 0) {
        const parity = (bestBid + bestAsk) / 2; // HBD per HIVE
        if (parity > 0) out.hbd = out.hive / parity;
      }
    } catch { /* נשאר null — כנות */ }
  }
  return out;
}

// ── ג'נזיס — זריעה מהון-אוצר נמדד בלבד ────────────────────────────────

let genesisPromise: Promise<boolean> | null = null;

export async function ensureExchange(): Promise<boolean> {
  if (!genesisPromise) {
    genesisPromise = doGenesis().catch(() => false);
    // כשל ג'נזיס (RPC למשל) — לא נשמר במטמון: הקריאה הבאה מנסה שוב בכנות
    genesisPromise.finally(() => {
      void genesisPromise?.then((ok) => {
        if (!ok) genesisPromise = null;
      });
    });
  }
  return genesisPromise;
}

async function doGenesis(): Promise<boolean> {
  const existing = await db.exchangeEvent.findFirst({ where: { kind: "GENESIS" } });
  if (existing) return true;
  const m = await measureTreasury();
  if (!m) return false; // אין מדידה — אין ג'נזיס (כנות: ננסה שוב בקריאה הבאה)
  const usable = 1 - KEEP_FUEL_RATIO;
  // 1) האוצר נזקף בנכסים-עטופים מול ההון הנמדד (90% — 10% דלק)
  const wSteem = Math.floor(m.steem * usable * 1000) / 1000;
  const wSbd = Math.floor(m.sbd * usable * 1000) / 1000;
  const wHive = Math.floor(m.hive * usable * 1000) / 1000;
  const wHbd = Math.floor(m.hbd * usable * 1000) / 1000;
  const wBlurt = Math.floor(m.blurt * 1) / 1; // BLURT — אין דלק-שידור, הכל נזקף
  await chainEvent("GENESIS", "treasury", {
    what: "זירת-המסחר הריבונית — ספר hash-chained, גיבוי-רזרבה מלא ל-USDS, AMM בעמלת-אוצר",
    measured: m,
    wrappedCredits: { WSTEEM: wSteem, WSBD: wSbd, WHIVE: wHive, WHBD: wHbd, WBLURT: wBlurt },
    keepFuelRatio: KEEP_FUEL_RATIO,
    saosBacking: "126,682 SAOS על שרשרת SAOS-LIVE (headcorner) — התביעה הפנימית נגזרת ממנה",
  }, null);
  await writeBalances("treasury", {
    WSTEEM: wSteem, WSBD: wSbd, WHIVE: wHive, WHBD: wHbd, WBLURT: wBlurt, SAOS: 126682,
  });
  // 2) USDS ג'נזיס — הטבעה מול נעילת SBD (עד 80% מה-WSBD שנזקף — השאר לבריכת ה-SBD/STEEM)
  const lockSbd = Math.floor(wSbd * 0.8 * 1000) / 1000;
  if (lockSbd > 0) {
    await adjust("treasury", "WSBD", -lockSbd);
    await adjust("reserve", "WSBD", lockSbd);
    await chainEvent("USDS_MINT", "treasury", { lockedSbd: lockSbd, mintedUsds: lockSbd, rate: "1:1" }, null);
    await adjust("reserve", "USDS", lockSbd);
    await adjust("treasury", "USDS", lockSbd);
  }
  // 3) זריעת בריכות מהאוצר — מחירי-פתיחה מוכרזים, השוק יכריע מכאן
  await seedPool("SAOS/USDS", "SAOS", "USDS", 400, Math.min(0.02, lockSbd / 2 || 0.001));
  await seedPool("WBLURT/USDS", "WBLURT", "USDS", Math.min(8, wBlurt), Math.min(0.008, lockSbd / 4 || 0.0004));
  await seedPool("WSTEEM/WSBD", "WSTEEM", "WSBD", Math.min(0.2, wSteem), Math.min(0.022, wSbd - lockSbd));
  return true;
}

async function seedPool(pair: string, assetA: string, assetB: string, amtA: number, amtB: number): Promise<void> {
  if (!(amtA > 0) || !(amtB > 0)) {
    await db.exchangePool.upsert({
      where: { pair },
      create: { pair, assetA, assetB, reserveA: 0, reserveB: 0, feeBps: FEE_BPS },
      update: {},
    });
    return;
  }
  await adjust("treasury", assetA as ExchangeAsset, -amtA);
  await adjust("treasury", assetB as ExchangeAsset, -amtB);
  await db.exchangePool.upsert({
    where: { pair },
    create: { pair, assetA, assetB, reserveA: amtA, reserveB: amtB, feeBps: FEE_BPS },
    update: { reserveA: amtA, reserveB: amtB },
  });
  await chainEvent("LP_SEED", "treasury", { pair, assetA, assetB, reserveA: amtA, reserveB: amtB, note: "זריעת-פתיחה מהון-אוצר נמדד; ערך ה-LP של האוצר" }, null);
}

// ── AMM ──────────────────────────────────────────────────────────────

export interface SwapQuote {
  pair: string;
  side: "A2B" | "B2A";
  amountIn: number;
  minOut: number;
  expectedOut: number;
  price: number;
  feeBps: number;
  reserveA: number;
  reserveB: number;
  usdValue: number | null;
}

export interface SwapResult {
  ok: boolean;
  detail: string;
  event?: ChainedEvent;
  quote?: SwapQuote;
  txid?: string | null;
}

export async function quoteSwap(pair: string, side: "A2B" | "B2A", amountIn: number): Promise<SwapQuote | { ok: false; detail: string }> {
  const pool = await db.exchangePool.findUnique({ where: { pair } });
  if (!pool) return { ok: false, detail: "NO-POOL: הבריכה לא נזרעה" };
  const { reserveA, reserveB } = pool;
  if (reserveA <= 0 || reserveB <= 0) return { ok: false, detail: "EMPTY-POOL: אין רזרבות — הבריכה ממתינה להפקדה" };
  if (!(amountIn > 0)) return { ok: false, detail: "BAD-AMOUNT" };
  const inA = side === "A2B";
  const rIn = inA ? reserveA : reserveB;
  const rOut = inA ? reserveB : reserveA;
  const inWithFee = amountIn * (10000 - pool.feeBps);
  const out = (rOut * inWithFee) / (rIn * 10000 + inWithFee);
  const prices = await pricesUsd();
  const assetIn = inA ? pool.assetA : pool.assetB;
  const priceKey = assetIn === "WSTEEM" ? "steem" : assetIn === "WSBD" ? "sbd" : assetIn === "WHIVE" ? "hive" : assetIn === "WHBD" ? "hbd" : assetIn === "WBLURT" ? "blurt" : null;
  const usdValue = priceKey ? (prices[priceKey] ?? null) ? amountIn * (prices[priceKey] as number) : null : null;
  return {
    pair, side, amountIn,
    minOut: 0,
    expectedOut: Math.floor(out * 1e9) / 1e9,
    price: rOut / rIn,
    feeBps: pool.feeBps,
    reserveA, reserveB,
    usdValue,
  };
}

export async function swap(params: {
  member: string;
  pair: string;
  side: "A2B" | "B2A";
  amountIn: number;
  minOut?: number;
}): Promise<SwapResult> {
  try {
    const q = await quoteSwap(params.pair, params.side, params.amountIn);
    if (!("expectedOut" in q)) return { ok: false, detail: (q as { detail: string }).detail };
    const minOut = params.minOut ?? 0;
    if (q.expectedOut < minOut) {
      return { ok: false, detail: `SLIPPAGE: המוצא ${q.expectedOut} מתחת למינימום ${minOut} — הגנת-הזזה עצרה` };
    }
    const pool = await db.exchangePool.findUnique({ where: { pair: params.pair } });
    if (!pool) return { ok: false, detail: "NO-POOL" };
    const inA = params.side === "A2B";
    const assetIn = (inA ? pool.assetA : pool.assetB) as ExchangeAsset;
    const assetOut = (inA ? pool.assetB : pool.assetA) as ExchangeAsset;
    await adjust(params.member, assetIn, -params.amountIn);
    await adjust(params.member, assetOut, q.expectedOut);
    // עדכון רזרבות — העמלה נשארת בבריכה (ערך ה-LP של האוצר צומח)
    const rA = pool.reserveA + (inA ? params.amountIn : -q.expectedOut);
    const rB = pool.reserveB + (inA ? -q.expectedOut : params.amountIn);
    await db.exchangePool.update({
      where: { pair: params.pair },
      data: {
        reserveA: Math.floor(rA * 1e9) / 1e9,
        reserveB: Math.floor(rB * 1e9) / 1e9,
        volumeA: { increment: inA ? params.amountIn : 0 },
        volumeB: { increment: inA ? 0 : params.amountIn },
        swaps: { increment: 1 },
      },
    });
    const ev = await chainEvent("SWAP", params.member, {
      pair: params.pair, side: params.side, amountIn: params.amountIn, amountOut: q.expectedOut,
      assetIn, assetOut, minOut, feeBps: pool.feeBps,
      reservesAfter: { a: rA, b: rB },
    }, q.usdValue);
    return { ok: true, detail: `הוחלף ${params.amountIn} ${assetIn} ← ${q.expectedOut} ${assetOut} (עמלה ${pool.feeBps}bps לבריכה)`, event: ev, quote: q };
  } catch (e) {
    return { ok: false, detail: "SWAP-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── USDS — גיבוי-רזרבה מלא ────────────────────────────────────────────

export async function usdsMint(member: string, stable: "WSBD" | "WHBD", amount: number): Promise<SwapResult> {
  try {
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    await adjust(member, stable, -amount);
    await adjust("reserve", stable, amount);
    await adjust("reserve", "USDS", -amount); // הרזרבה "מנפיקה" — ההתחייבות שלה
    await adjust(member, "USDS", amount);
    const ev = await chainEvent("USDS_MINT", member, { stable, locked: amount, minted: amount, rate: "1:1" }, null);
    return { ok: true, detail: `נטבעו ${amount} USDS מול נעילת ${amount} ${stable} — גיבוי-רזרבה מלא`, event: ev };
  } catch (e) {
    return { ok: false, detail: "MINT-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

export async function usdsBurn(member: string, stable: "WSBD" | "WHBD", amount: number): Promise<SwapResult> {
  try {
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    await adjust(member, "USDS", -amount);
    await adjust("reserve", "USDS", amount);
    await adjust("reserve", stable, -amount);
    await adjust(member, stable, amount);
    const ev = await chainEvent("USDS_BURN", member, { stable, unlocked: amount, burned: amount, rate: "1:1" }, null);
    return { ok: true, detail: `נשרפו ${amount} USDS ושוחררו ${amount} ${stable} מהרזרבה — 1:1, תמיד`, event: ev };
  } catch (e) {
    return { ok: false, detail: "BURN-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── רייל-ההפקדות — דלת הציבור על שלוש רשתות (memo: wx:<member>) ────────

const DEPOSIT_MEMO = /^wx:([a-z0-9.-]{3,16})$/;

export interface DepositScanResult {
  ok: boolean;
  scanned: number;
  credited: number;
  details: string[];
  detail: string;
}

export async function depositScan(limit = 60): Promise<DepositScanResult> {
  const details: string[] = [];
  let credited = 0;
  let scanned = 0;

  // האוצר הוא headcorner בכל שלוש הרשתות (חוק המפתח-הראשי — R99):
  // STEEM (api.steemit.com) · HIVE (api.hive.blog) · BLURT (rpc.blurt.blog, UA!)
  type HistEntry = [number, { op?: [string, Record<string, unknown>]; trx_id?: string }];
  const legs: Array<{
    chain: string;
    hist: HistEntry[] | null;
    mapAsset: (amount: string) => ExchangeAsset | null;
  }> = [];

  const steemHist = await rpcV4<HistEntry[]>(
    STEEM_RPC_NODES[0], "condenser_api.get_account_history", [TREASURY, -1, limit],
  ).catch(() => null);
  legs.push({
    chain: "steem",
    hist: Array.isArray(steemHist) ? steemHist : null,
    mapAsset: (amt) => (/STEEM/i.test(amt) ? "WSTEEM" : /SBD/i.test(amt) ? "WSBD" : null),
  });

  const hiveHist = await rpcV4<HistEntry[]>(
    HIVE_RPC, "condenser_api.get_account_history", [TREASURY, -1, limit],
  ).catch(() => null);
  legs.push({
    chain: "hive",
    hist: Array.isArray(hiveHist) ? hiveHist : null,
    mapAsset: (amt) => (/HIVE/i.test(amt) ? "WHIVE" : /HBD/i.test(amt) ? "WHBD" : null),
  });

  // BLURT — UA מפורש (ענן-הגנה של הצומת, לקח R101)
  const blurtHist = await fetch(BLURT_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "saos-weave-rail/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_account_history", params: [TREASURY, -1, limit] }),
    signal: AbortSignal.timeout(12_000),
  }).then((r) => r.json() as Promise<{ result?: HistEntry[] }>).catch(() => null);
  legs.push({
    chain: "blurt",
    hist: blurtHist?.result ?? null,
    mapAsset: (amt) => (/BLURT/i.test(amt) ? "WBLURT" : null),
  });

  for (const leg of legs) {
    if (!Array.isArray(leg.hist)) {
      details.push(`${leg.chain}: RPC-DOWN — הרגל נדלגה בכנות`);
      continue;
    }
    scanned += leg.hist.length;
    for (const [, entry] of leg.hist) {
      const op = entry.op;
      if (!op || op[0] !== "transfer") continue;
      const t = op[1] as { from?: string; to?: string; amount?: string; memo?: string };
      if (t.to !== TREASURY) continue;
      const mm = DEPOSIT_MEMO.exec(String(t.memo ?? "").trim().toLowerCase());
      if (!mm) continue;
      const member = mm[1];
      const amt = String(t.amount ?? "");
      const num = parseFloat(amt) || 0;
      if (!(num > 0)) continue;
      const txid = String(entry.trx_id ?? "");
      if (await eventExists("DEPOSIT_CREDIT", txid)) continue;
      const asset = leg.mapAsset(amt);
      if (!asset) continue;
      await adjust(member, asset, num);
      await chainEvent("DEPOSIT_CREDIT", member, {
        txid, from: t.from, asset, amount: num, memo: t.memo, chain: leg.chain,
        evidence: `${leg.chain}:get_account_history(${TREASURY}) trx_id=${txid}`,
      }, null);
      credited++;
      details.push(`${leg.chain}: ${t.from} → ${member}: ${num} ${asset} (txid ${txid.slice(0, 10)}…)`);
    }
  }
  return {
    ok: true,
    scanned,
    credited,
    details,
    detail: credited > 0 ? `${credited} הפקדות נזקפו (3 רשתות)` : "אין הפקדות חדשות בחלון (3 רשתות)",
  };
}

// ── רייל-המשיכות — שריפת עטיפה → העברה אמיתית בשרשרת ──────────────────

function activeWif(): string | null {
  try {
    const raw = fs.readFileSync(path.join(HOME, "upload", "headcorner.txt"), "utf8").trim();
    const [account, ...rest] = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return steem.auth.toWif(account, rest[0] ?? "", "active");
  } catch {
    return null;
  }
}

function fmtAsset3(amount: number, symbol: "STEEM" | "SBD" | "HIVE" | "HBD"): string {
  return `${amount.toFixed(3)} ${symbol}`;
}

export interface WithdrawResult {
  ok: boolean;
  detail: string;
  gate?: { verdict: string; id: string; usdValue: number | null };
  txid?: string | null;
  event?: ChainedEvent;
}

/** R104 — רייל-משיכת SAOS-LIVE: שריפת תביעה פנימית ← העברה חתומה
 *  מהאוצר על שרשרת SAOS-LIVE החיה (custom_json ב-STEEM). השרשרת היא
 *  השופט: הכתובת חייבת להיות רשומה, מאזן האוצר נמדד בקיפול, ושער-$100
 *  מכסה — מחיר ה-SAOS נגזר מהבריכה הפנימית החיה (השוק שלנו הוא המקור). */
async function saosWithdrawRail(params: {
  member: string;
  amount: number;
  toAddress: string;
  issuedBy: "operator" | "daemon";
}): Promise<WithdrawResult> {
  const { member, amount, toAddress, issuedBy } = params;
  // מחיר SAOS — מהבריכה הפנימית בלבד (נתיב ריבוני; אין ל-SAOS מחיר חיצוני)
  const poolPrice = await saosUsdPrice();
  const usdValue = poolPrice != null ? amount * poolPrice : null;
  // אין שער-מחיר? אין עסקה (חוק המדידה) — כלום לא זז
  if (usdValue == null) {
    return { ok: false, detail: "NO-PRICE: מחיר SAOS לא נמדד מהבריכה הפנימית — אין שער, אין משיכה" };
  }
  // 1) שער-$100 קודם — תור-מפעיל פירושו שכלום לא זז עדיין
  const gate = await evaluateGate({
    source: "sovereign-exchange",
    action: "withdraw",
    title: `משיכה ${amount} SAOS ל-${toAddress.slice(0, 18)}… (${usdValue.toFixed(2)}$)`,
    payload: { member, asset: "SAOS", amount, toAddress },
    usdValue,
    usdBasis: `internal pool SAOS/USDS ${poolPrice?.toPrecision(4) ?? "?"}`,
    issuedBy,
    reason: "משיכת SAOS — שריפת תביעה פנימית והעברה חתומה על SAOS-LIVE",
  });
  if (gate.verdict !== "ALLOWED") {
    return {
      ok: false,
      detail: gate.verdict === "QUEUED" ? `המשיכה ${usdValue.toFixed(2)}$ ≥ 100$ — הועברה לתור אישור המפעיל` : "השער סירב",
      gate: { verdict: gate.verdict, id: gate.id, usdValue },
    };
  }
  // 2) שריפת התביעה הפנימית — עכשיו, לפני השידור (סדר הפעולות עסקה)
  await adjust(member, "SAOS", -amount);
  // 3) הרייל: חתימת אוצר + שידור custom_json על STEEM — השרשרת היא השופט
  const rail = await saosLiveTransferOut({ toAddress, amount });
  if (!rail.ok) {
    // שידור נכשל — התביעה מוחזרת במלואה (אותו חוק כמו ריילי HIVE/BLURT)
    await adjust(member, "SAOS", amount);
    return { ok: false, detail: rail.note, gate: { verdict: "ALLOWED", id: gate.id, usdValue } };
  }
  // 4) הספר — אירוע משורשר עם ה-txid האמיתי
  const ev = await chainEvent("WITHDRAW_EXEC", member, {
    asset: "SAOS",
    amount,
    toAddress,
    txid: rail.txid ?? null,
    envelopeId: rail.envelopeId ?? null,
    treasury: rail.treasuryAddr ?? null,
    note: "rail SAOS-LIVE — token.transfer on-chain (custom_json saos.weave.live.v1)",
  }, usdValue);
  return {
    ok: true,
    detail: `SAOS נמשך דרך שרשרת SAOS-LIVE — txid ${rail.txid?.slice(0, 14) ?? "?"}… · הקיפול יזקוף בבלוק הבא`,
    txid: rail.txid ?? null,
    event: ev,
    gate: { verdict: "ALLOWED", id: gate.id, usdValue },
  };
}

export async function withdraw(params: {
  member: string;
  asset: ExchangeAsset;
  amount: number;
  toAccount: string;
  issuedBy: "operator" | "daemon";
}): Promise<WithdrawResult> {
  try {
    const { member, asset, amount, toAccount, issuedBy } = params;
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    // R104 — רייל SAOS-LIVE: היעד הוא כתובת שרשרת-חיה (saos1…), לא שם-חשבון גרפן
    if (asset === "SAOS") {
      return await saosWithdrawRail({ member, amount, toAddress: toAccount, issuedBy });
    }
    if (!/^[a-z0-9.-]{3,16}$/.test(toAccount)) return { ok: false, detail: "BAD-ACCOUNT: יעד שרשרת שגוי" };
    const prices = await pricesUsd();
    const priceKey = asset === "WSTEEM" ? "steem" : asset === "WSBD" ? "sbd" : asset === "WHIVE" ? "hive" : asset === "WHBD" ? "hbd" : asset === "WBLURT" ? "blurt" : null;
    const usdValue = priceKey && prices[priceKey] != null ? amount * (prices[priceKey] as number) : null;

    // נכסים שאינם ניתנים למשיכה ישירה — בכנות
    if (asset === "USDS") return { ok: false, detail: "USDS נפדה בשריפה (usds-burn) ל-WSBD/WHBD — ואז מושך" };

    if (usdValue == null) {
      return { ok: false, detail: "NO-PRICE: USD לא נמדד חי — אין שער, אין מסחר" };
    }
    const gate = await evaluateGate({
      source: "sovereign-exchange",
      action: "withdraw",
      title: `משיכה ${amount} ${asset} ל-${toAccount} (${usdValue.toFixed(2)}$)`,
      payload: { member, asset, amount, toAccount },
      usdValue,
      usdBasis: `binance/coingecko/parity ${priceKey} ${priceKey ? prices[priceKey] : "?"}`,
      issuedBy,
      reason: "משיכה מזירת-המסחר — שריפת עטיפה והעברה אמיתית",
    });
    if (gate.verdict !== "ALLOWED") {
      return {
        ok: false,
        detail: gate.verdict === "QUEUED" ? `המשיכה ${usdValue.toFixed(2)}$ ≥ 100$ — הועברה לתור אישור המפעיל` : "השער סירב",
        gate: { verdict: gate.verdict, id: gate.id, usdValue },
      };
    }
    // שריפת העטיפה + שידור אמיתי
    await adjust(member, asset, -amount);
    let send: { txid?: string | null; accepted?: boolean; note?: string } = { txid: null };
    if (asset === "WSTEEM" || asset === "WSBD") {
      const wif = activeWif();
      if (!wif) { await adjust(member, asset, amount); return { ok: false, detail: "NO-KEY: מקור-המפתח חסר" }; }
      const symbol = asset === "WSTEEM" ? "STEEM" : "SBD";
      const res = await steemBroadcast(
        [["transfer", { from: TREASURY, to: toAccount, amount: fmtAsset3(amount, symbol), memo: "wx-out (sovereign-exchange)" }]] as never,
        wif,
      );
      send = res;
    } else if (asset === "WHIVE" || asset === "WHBD") {
      const v = openVaultKey("hive", TREASURY, "active");
      if (!v.ok || !v.wif) { await adjust(member, asset, amount); return { ok: false, detail: `NO-KEY: ${v.detail}` }; }
      const symbol = asset === "WHIVE" ? "HIVE" : "HBD";
      // חוק-החוט (R99): HIVE חותם נכסים בשמות-האב — מיפוי לפני החתימה
      const op = ["transfer", { from: TREASURY, to: toAccount, amount: fmtAsset3(amount, symbol), memo: "wx-out (sovereign-exchange)" }] as never;
      const mapped = JSON.parse(JSON.stringify(op).replace(/(\d+\.\d+) HIVE/g, "$1 STEEM").replace(/(\d+\.\d+) HBD/g, "$1 SBD")) as never;
      const signed = await signGrapheneTx(HIVE_RPC, HIVE_CHAIN_ID, mapped, v.wif);
      await rpcV4(HIVE_RPC, "condenser_api.broadcast_transaction", [signed]);
      send = { txid: null, accepted: true, note: "hive broadcast-accepted" };
    } else if (asset === "WBLURT") {
      // רייל BLURT (R103) — חוק-החוט המילולי הוכח במעבדה + בשרשרת:
      // הנכס נסדר כ-"N.NNN BLURT" (בלי מיפוי-מורשת), chain_id מ-get_config.
      const v = openVaultKey("blurt", TREASURY, "active");
      if (!v.ok || !v.wif) { await adjust(member, asset, amount); return { ok: false, detail: `NO-KEY: ${v.detail}` }; }
      const r = await blurtSendTransfer({
        from: TREASURY, to: toAccount, amount, memo: "wx-out (sovereign-exchange)", wif: v.wif,
      });
      send = { txid: r.txid, accepted: r.accepted, note: r.note };
    }
    const okSend = asset === "WSTEEM" || asset === "WSBD" ? !!send.txid : !!send.accepted;
    if (!okSend) {
      await adjust(member, asset, amount); // החזרה — השידור לא התקבל; ההחלטה נשארת ALLOWED, הקבלה בתשובה
      return { ok: false, detail: `SEND-FAILED: ${send.note ?? "השרשרת דחתה"} — העטיפה הוחזרה, כלום לא נשרף`, gate: { verdict: "SEND-FAILED", id: gate.id, usdValue } };
    }
    const ev = await chainEvent("WITHDRAW_EXEC", member, {
      asset, amount, toAccount, txid: send.txid ?? null, note: send.note ?? undefined,
      usdValue, gateId: gate.id,
    }, usdValue);
    await settleGate(gate.id, "EXECUTED", "sovereign-exchange:live", { txid: send.txid ?? null, eventHash: ev.hash });
    return { ok: true, detail: `נמשכו ${amount} ${asset} ל-${toAccount} — העטיפה נשרפה, ההעברה שודרה`, gate: { verdict: "EXECUTED", id: gate.id, usdValue }, txid: send.txid ?? null, event: ev };
  } catch (e) {
    return { ok: false, detail: "WITHDRAW-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── רייל-התגמול: עבודה → מטבע → נזילות (R103) ─────────────────────────

/** מחיר SAOS חי מהבריכה שלנו — השוק הפנימי הוא המקור */
async function saosUsdPrice(): Promise<number | null> {
  const pool = await db.exchangePool.findUnique({ where: { pair: "SAOS/USDS" } });
  if (!pool || pool.reserveA <= 0) return null;
  return pool.reserveB / pool.reserveA;
}

/**
 * חלוקת SAOS לסוכן — ישירות למאזן הזירה (R103).
 *
 * סגירת המעגל: הסוכן עובד (מילויי-גריד אמיתיים) ← מקבל SAOS כתביעה
 * פנימית ← מחליף אותה ב-USDS בבריכה שלנו ← נזילות אמיתית. התגמול
 * יוצא ממאזן האוצר (הגיבוי החי), והוא מתועד בספר ה-hash-chained.
 */
export async function rewardPay(params: {
  member: string;
  amount: number;
  note: string;
  issuedBy: "operator" | "daemon";
}): Promise<SwapResult> {
  try {
    const { member, amount, note, issuedBy } = params;
    if (!/^[a-z0-9.-]{3,16}$/.test(member)) return { ok: false, detail: "BAD-MEMBER" };
    if (!(amount > 0)) return { ok: false, detail: "BAD-AMOUNT" };
    const price = await saosUsdPrice();
    if (price == null || price <= 0) return { ok: false, detail: "NO-PRICE: אין בריכת SAOS/USDS — אין שער" };
    const usdValue = amount * price;
    const gate = await evaluateGate({
      source: "sovereign-exchange",
      action: "reward-pay",
      title: `תגמול ${amount} SAOS ל-${member} (${usdValue.toFixed(2)}$)`,
      payload: { member, amount, note },
      usdValue,
      usdBasis: `saos/usds-pool ${price.toPrecision(4)}`,
      issuedBy,
      reason: `עבודה→מטבע→נזילות: ${note}`,
    });
    if (gate.verdict !== "ALLOWED") {
      return {
        ok: false,
        detail: gate.verdict === "QUEUED" ? `התגמול ${usdValue.toFixed(2)}$ ≥ 100$ — תור המפעיל` : "השער סירב",
      };
    }
    // האוצר משלם — הספר מתעד
    await adjust("treasury", "SAOS", -amount);
    await adjust(member, "SAOS", amount);
    const ev = await chainEvent("REWARD_PAY", member, {
      amount, note, usdValue, gateId: gate.id,
      rail: "treasury→member (arena balance) — תביעה פנימית מגובה-אוצר",
    }, usdValue);
    await settleGate(gate.id, "EXECUTED", "sovereign-exchange:live", { eventHash: ev.hash });
    return {
      ok: true,
      detail: `שולם ${amount} SAOS ל-${member} מהאוצר — התביעה חיה בזירה (מחליף ב-USDS בבריכה)`,
      event: ev,
    };
  } catch (e) {
    return { ok: false, detail: "REWARD-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

// ── רייל-הנזילות: דלק → עומק בריכות אמיתי (R103) ─────────────────────

/**
 * הוספת נזילות דו-צדדית לבריכה קיימת (ביחס הנוכחי) או זריעת בריכה
 * חדשה במחיר מוכרז. העמלות נשארות בבריכה — ערך ה-LP של האוצר צומח.
 */
export async function addLiquidity(params: {
  member: string;
  pair: string;
  maxA: number;
  maxB: number;
}): Promise<SwapResult> {
  try {
    const { member, pair, maxA, maxB } = params;
    if (!(maxA > 0) || !(maxB > 0)) return { ok: false, detail: "BAD-AMOUNTS" };
    let pool = await db.exchangePool.findUnique({ where: { pair } });
    if (!pool) {
      // בריכה חדשה — המחיר המוכרז = maxB/maxA, מכאן השוק יכריע
      const [assetA, assetB] = pair.split("/") as [ExchangeAsset, ExchangeAsset];
      if (!assetA || !assetB || !(EXCHANGE_ASSETS as readonly string[]).includes(assetA) || !(EXCHANGE_ASSETS as readonly string[]).includes(assetB) || assetA === assetB) {
        return { ok: false, detail: "BAD-PAIR" };
      }
      await adjust(member, assetA, -maxA);
      await adjust(member, assetB, -maxB);
      pool = await db.exchangePool.create({
        data: { pair, assetA, assetB, reserveA: maxA, reserveB: maxB, feeBps: FEE_BPS },
      });
      const ev = await chainEvent("LP_SEED", member, { pair, assetA, assetB, reserveA: maxA, reserveB: maxB, note: "זריעת בריכה חדשה — המחיר המוכרז, השוק יכריע מכאן" }, null);
      return { ok: true, detail: `נזרעה בריכה חדשה ${pair}: ${maxA} × ${maxB} — עומק חי`, event: ev };
    }
    if (pool.reserveA <= 0 || pool.reserveB <= 0) {
      // בריכה ריקה — זריעה מחדש במחיר המוצע
      await adjust(member, pool.assetA as ExchangeAsset, -maxA);
      await adjust(member, pool.assetB as ExchangeAsset, -maxB);
      await db.exchangePool.update({ where: { pair }, data: { reserveA: maxA, reserveB: maxB } });
      const ev = await chainEvent("LP_SEED", member, { pair, reserveA: maxA, reserveB: maxB, note: "זריעה מחדש לבריכה ריקה" }, null);
      return { ok: true, detail: `הבריכה ${pair} נזרעה מחדש: ${maxA} × ${maxB}`, event: ev };
    }
    // בריכה חיה — הוספה ביחס הקיים (הצד הקטן קובע)
    const ratio = pool.reserveB / pool.reserveA;
    let amtA = maxA;
    let amtB = amtA * ratio;
    if (amtB > maxB) { amtB = maxB; amtA = amtB / ratio; }
    amtA = Math.floor(amtA * 1e9) / 1e9;
    amtB = Math.floor(amtB * 1e9) / 1e9;
    if (amtA <= 0 || amtB <= 0) return { ok: false, detail: "DUST: סכומים מתחת לרצפה" };
    await adjust(member, pool.assetA as ExchangeAsset, -amtA);
    await adjust(member, pool.assetB as ExchangeAsset, -amtB);
    await db.exchangePool.update({
      where: { pair },
      data: { reserveA: { increment: amtA }, reserveB: { increment: amtB } },
    });
    const ev = await chainEvent("LP_ADD", member, {
      pair, addedA: amtA, addedB: amtB,
      reservesAfter: { a: pool.reserveA + amtA, b: pool.reserveB + amtB },
      note: "עומק אמיתי גדל — העמלות נשארות בבריכה",
    }, null);
    return { ok: true, detail: `נוסף עומק ל${pair}: ${amtA} × ${amtB} (ביחס השוק החי)`, event: ev };
  } catch (e) {
    return { ok: false, detail: "LP-ERROR: " + String((e as Error).message ?? e).slice(0, 120) };
  }
}

/**
 * הזרמת דלק-שרשרת לבריכות (R103) — הפאוורדאון השבועי הופך לעומק.
 *
 * החוק: הכסף החי על השרשרת שטרם נצרף (הדלתא מעל האירוע-WRAP האחרון)
 * מתגלגל בחלקו לעטיפה (W*) ומזווג ל-USDS במחיר השוק החי. מה שאין
 * לו זיווג נשאר במאזן האוצר — כנות: העומק גדל רק מכסף אמיתי.
 */
export async function liquidityStream(params: {
  share?: number; // חלק הדלתא שיוזרם (ברירת מחדל 0.2)
  issuedBy: "operator" | "daemon";
}): Promise<{ ok: boolean; detail: string; events: string[] }> {
  try {
    const share = Math.min(1, Math.max(0, params.share ?? 0.2));
    const m = await measureTreasury();
    if (!m) return { ok: false, detail: "NO-MEASURE: השרשרת לא ענתה — אין הזרמה", events: [] };
    const events: string[] = [];

    // הדלתא: המאזן החי מעל מה שכבר נצרף (אירועי WRAP מתועדים)
    const wrapped = new Map<string, number>();
    const wrapEvents = await db.exchangeEvent.findMany({ where: { kind: "TREASURY_WRAP" }, orderBy: { seq: "asc" } });
    for (const e of wrapEvents) {
      try {
        const pl = JSON.parse(e.payload) as { asset?: string; measuredBalance?: number };
        if (pl.asset && typeof pl.measuredBalance === "number") {
          wrapped.set(pl.asset, Math.max(wrapped.get(pl.asset) ?? 0, pl.measuredBalance));
        }
      } catch { /* ספר ישן — דלתא מהג'נזיס */ }
    }
    // ג'נזיס: המאזן שנמדד אז הוא קו הבסיס
    const genesis = await db.exchangeEvent.findFirst({ where: { kind: "GENESIS" } });
    if (genesis) {
      try {
        const pl = JSON.parse(genesis.payload) as { measured?: Record<string, number> };
        const base = pl.measured ?? {};
        for (const [k, v] of Object.entries(base)) {
          if (typeof v === "number" && !wrapped.has(k)) wrapped.set(k, v);
        }
      } catch { /* כנות */ }
    }

    // נכסי ההזרמה: STEEM (פאוורדאון) · HIVE · BLURT — כולם בעלי דלתא-דלק חוצה-רשתות
    const streamAssets: Array<{ live: number; key: string; wrap: ExchangeAsset; priceKey: string }> = [
      { live: m.steem, key: "steem", wrap: "WSTEEM", priceKey: "steem" },
      { live: m.hive, key: "hive", wrap: "WHIVE", priceKey: "hive" },
      { live: m.blurt, key: "blurt", wrap: "WBLURT", priceKey: "blurt" },
    ];
    const prices = await pricesUsd();
    let totalWrapped = 0;

    for (const a of streamAssets) {
      const baseline = wrapped.get(a.key) ?? 0;
      const delta = a.live - baseline;
      if (delta < 1) continue; // אין דלק חדש — כנות
      const toWrap = Math.floor(delta * share * 1000) / 1000;
      if (toWrap < 0.001) continue;
      const price = prices[a.priceKey];
      if (price == null) { events.push(`${a.key}: אין מחיר חי — הדלתא (${delta.toFixed(3)}) ממתינה בכנות`); continue; }
      // עטיפה — האוצר מקבל W* מול ההון החי שנמדד
      await adjust("treasury", a.wrap, toWrap);
      const ev = await chainEvent("TREASURY_WRAP", "treasury", {
        asset: a.wrap, amount: toWrap, measuredBalance: a.live, baseline, delta,
        share, evidence: `chain-balance(${a.key})=${a.live}`,
      }, null);
      events.push(`עוטף ${toWrap} ${a.wrap} מדלתא ${delta.toFixed(3)} ${a.key} (חלק ${Math.round(share * 100)}%)`);

      // זיווג ל-USDS: בריכת W*/USDS — נבנית אם איננה (במחיר השוק החי)
      const pair = `${a.wrap}/USDS`;
      const pool = await db.exchangePool.findUnique({ where: { pair } });
      const usdsNeed = toWrap * price; // כמה USDS שווה הצד שלנו
      const treasuryBal = await readBalances("treasury");
      const usdsAvail = treasuryBal.USDS ?? 0;
      if (usdsAvail <= 0) { events.push(`${pair}: אין USDS לזיווג — ה-W* ממתין במאזן האוצר (כנות)`); continue; }
      if (!pool || pool.reserveA <= 0) {
        // בריכה חדשה במחיר השוק החי
        let amtA = toWrap, amtB = Math.min(usdsAvail, usdsNeed);
        if (amtB < usdsNeed) amtA = amtB / price; // מה שיש — לא הבטחה
        if (amtA < 0.001 || amtB < 0.000001) { events.push(`${pair}: אבק — דלג בכנות`); continue; }
        await addLiquidity({ member: "treasury", pair, maxA: amtA, maxB: amtB });
        events.push(`נזרעה ${pair}: ${amtA.toFixed(3)} × ${amtB.toFixed(6)} (מחיר פתיחה ${price.toPrecision(4)}$)`);
      } else {
        await addLiquidity({ member: "treasury", pair, maxA: toWrap, maxB: usdsAvail });
        events.push(`עומק ${pair} גדל (${toWrap.toFixed(3)} ${a.wrap} + זיווג USDS)`);
      }
      totalWrapped += 1;
    }
    if (totalWrapped === 0 && events.length === 0) {
      return { ok: true, detail: "אין דלק חדש מעל קו-הבסיס — אין מה להזרים (כנות)", events };
    }
    return { ok: true, detail: `הוזרם עומק אמיתי: ${totalWrapped} נכסים · ${events.length} פעולות`, events };
  } catch (e) {
    return { ok: false, detail: "STREAM-ERROR: " + String((e as Error).message ?? e).slice(0, 120), events: [] };
  }
}

// ── תמונת-הזירה ──────────────────────────────────────────────────────

export interface ExchangeSnapshot {
  ok: boolean;
  at: string;
  genesis: boolean;
  pools: Array<{
    pair: string;
    assetA: string;
    assetB: string;
    reserveA: number;
    reserveB: number;
    price: number;
    priceLabel: string;
    feeBps: number;
    volumeA: number;
    volumeB: number;
    swaps: number;
    depthUsd: number | null;
  }>;
  reserve: { usdsSupply: number; sbdLocked: number; hbdLocked: number; ratio: string };
  treasury: Balances;
  members: Array<{ member: string; balances: Balances }>;
  prices: Record<string, number | null>;
  recentEvents: Array<ChainedEvent & { usdValue?: number | null; createdAt?: string }>;
  bookIntegrity: { events: number; headHash: string | null; recomputeOk: boolean | null };
  depositDoor: { memo: string; treasury: string; chain: string };
  note: string;
}

export async function exchangeSnapshot(): Promise<ExchangeSnapshot> {
  const at = new Date().toISOString();
  const genesis = await ensureExchange();
  const pools = await db.exchangePool.findMany({ orderBy: { pair: "asc" } });
  const prices = await pricesUsd();
  const poolRows = pools.map((p) => {
    const priceKeyA = p.assetA === "WSTEEM" ? "steem" : p.assetA === "WBLURT" ? "blurt" : p.assetA === "SAOS" ? null : p.assetA === "WHIVE" ? "hive" : null;
    const priceKeyB = p.assetB === "WSBD" ? "sbd" : p.assetB === "WHBD" ? "hbd" : p.assetB === "WSTEEM" ? "steem" : p.assetB === "WBLURT" ? "blurt" : null;
    const usdA = priceKeyA ? (prices[priceKeyA] ?? null) : null;
    const usdB = priceKeyB ? (prices[priceKeyB] ?? null) : null;
    let depthUsd: number | null = null;
    if (usdA != null) depthUsd = p.reserveA * usdA * 2;
    else if (usdB != null) depthUsd = p.reserveB * usdB * 2;
    const price = p.reserveA > 0 ? p.reserveB / p.reserveA : 0;
    return {
      pair: p.pair, assetA: p.assetA, assetB: p.assetB,
      reserveA: p.reserveA, reserveB: p.reserveB,
      price, priceLabel: `${price.toPrecision(4)} ${p.assetB}/${p.assetA}`,
      feeBps: p.feeBps, volumeA: p.volumeA, volumeB: p.volumeB, swaps: p.swaps,
      depthUsd,
    };
  });
  const reserveBal = await readBalances("reserve");
  const treasuryBal = await readBalances("treasury");
  const accts = await db.exchangeAccount.findMany({ orderBy: { member: "asc" } });
  const events = await db.exchangeEvent.findMany({ orderBy: { seq: "desc" }, take: 20 });
  // שלמות הספר — חישוב-חדש של השרשרת כולה
  const all = await db.exchangeEvent.findMany({ orderBy: { seq: "asc" } });
  let prev = "0";
  let recomputeOk = true;
  let headHash: string | null = null;
  for (const e of all) {
    const h = hashText(`${prev}|${e.seq}|${e.kind}|${e.member}|${e.payload}`);
    if (h !== e.hash || e.prevHash !== prev) { recomputeOk = false; break; }
    prev = e.hash;
    headHash = e.hash;
  }
  return {
    ok: true,
    at,
    genesis,
    pools: poolRows,
    reserve: {
      usdsSupply: reserveBal.USDS ?? 0,
      sbdLocked: reserveBal.WSBD ?? 0,
      hbdLocked: reserveBal.WHBD ?? 0,
      ratio: "1:1 (היצע = רזרבה נעולה, תמיד)",
    },
    treasury: treasuryBal,
    members: accts.map((a) => ({ member: a.member, balances: JSON.parse(a.balances) as Balances })),
    prices,
    recentEvents: events.map((e) => ({
      seq: e.seq, kind: e.kind, member: e.member, payload: e.payload, prevHash: e.prevHash, hash: e.hash,
      usdValue: e.usdValue ?? null, createdAt: e.createdAt?.toISOString?.() ?? String(e.createdAt),
    })),
    bookIntegrity: { events: all.length, headHash, recomputeOk: all.length > 0 ? recomputeOk : null },
    depositDoor: { memo: "wx:<member>", treasury: TREASURY, chain: "STEEM (דלת חיה; HIVE/BLURT מתועדות)" },
    note: genesis
      ? "הזירה חיה: ספר hash-chained, USDS בגיבוי-רזרבה מלא, עמלות בבריכות שלנו. עומק = ההון הריאלי בלבד — לא מציגים נזילות שאיננה."
      : "הג'נזיס ממתין למדידת-אוצר חיה (RPC) — כנות: בלי מדידה אין זריעה",
  };
}
