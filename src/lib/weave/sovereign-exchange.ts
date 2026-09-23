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
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";

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

// ── רייל-ההפקדות — דלת הציבור על STEEM (memo: wx:<member>) ────────────

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
  try {
    const hist = await rpcV4<Array<[number, { op?: [string, Record<string, unknown>]; trx_id?: string }]>>(
      STEEM_RPC_NODES[0], "condenser_api.get_account_history", [TREASURY, -1, limit],
    );
    if (!Array.isArray(hist)) return { ok: false, scanned: 0, credited: 0, details, detail: "RPC-DOWN" };
    for (const [, entry] of hist) {
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
      const asset: ExchangeAsset | null = /STEEM/i.test(amt) ? "WSTEEM" : /SBD/i.test(amt) ? "WSBD" : null;
      if (!asset) continue;
      await adjust(member, asset, num);
      await chainEvent("DEPOSIT_CREDIT", member, {
        txid, from: t.from, asset, amount: num, memo: t.memo,
        evidence: `steem:get_account_history(${TREASURY}) trx_id=${txid}`,
      }, null);
      credited++;
      details.push(`${t.from} → ${member}: ${num} ${asset} (txid ${txid.slice(0, 10)}…)`);
    }
    return { ok: true, scanned: hist.length, credited, details, detail: credited > 0 ? `${credited} הפקדות נזקפו` : "אין הפקדות חדשות בחלון" };
  } catch (e) {
    return { ok: false, scanned: 0, credited: 0, details, detail: "SCAN-ERROR: " + String((e as Error).message ?? e).slice(0, 100) };
  }
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
    if (!/^[a-z0-9.-]{3,16}$/.test(toAccount)) return { ok: false, detail: "BAD-ACCOUNT: יעד שרשרת שגוי" };
    const prices = await pricesUsd();
    const priceKey = asset === "WSTEEM" ? "steem" : asset === "WSBD" ? "sbd" : asset === "WHIVE" ? "hive" : asset === "WHBD" ? "hbd" : asset === "WBLURT" ? "blurt" : null;
    const usdValue = priceKey && prices[priceKey] != null ? amount * (prices[priceKey] as number) : null;

    // נכסים שאינם ניתנים למשיכה ישירה — בכנות
    if (asset === "USDS") return { ok: false, detail: "USDS נפדה בשריפה (usds-burn) ל-WSBD/WHBD — ואז מושך" };
    if (asset === "SAOS") return { ok: false, detail: "SAOS נשלף דרך רייל SAOS-LIVE החי — שלב מתועד הבא; בזירה הוא תביעה-פנימית מגובה-אוצר" };
    if (asset === "WBLURT") return { ok: false, detail: "משיכת BLURT — NOT-YET בכנות: אין שידור-Blurt מוכח (chain_id לא אומת מה-RPC); הרייל מתועד כצעד הבא" };

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
