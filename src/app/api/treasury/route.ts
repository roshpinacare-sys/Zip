// ─────────────────────────────────────────────────────────────────────
// /api/treasury — מלאי-הכסף האמת של הרשת, מדידה חיה מהשרשרות.
//
// שום דבר לא מומר "מידע" — כל מספר כאן נקרא מ-RPC ציבורי או מ-API
// ציבורי בזמן הבקשה (או ממטמון 60 שניות). שרשרת שנפלה מסומנת
// "down" בכנות — אף מספר לא מומצא, אף טענה לא מתקבלת מסתם.
//
// מקורות: api.steemit.com · api.hive.blog · apilist.tronscanapi.com ·
// ethereum-rpc.publicnode.com · solana-rpc.publicnode.com ·
// blockchain.info · api.binance.com · הקונסולה הציבורית שלנו.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

// ── כתובות-הצי (כולן פומביות, אומתו מול המניפסט ומול השרשרות) ────────

const STEEM_FLEET = [
  "headcorner",
  "cashmachine",
  "haran",
  "lsa",
  "macrame",
  "siq",
  "tov",
  "wic",
  "wog",
  "woq",
  "ynet",
  "israelnews",
  "powerspan",
] as const;

const TRON_ADDRS = [
  { label: "כתובת-ההפקדה (TRON)", address: "TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e" },
  { label: "משמורת-הדלת (2 TRX · הגיבוי של WTRX)", address: "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy" },
  { label: "headcorner (idx=2)", address: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn" },
  { label: "headcorner (R11-derive)", address: "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU" },
] as const;

const EVM_ADDRS = [
  { label: "כתובת-ההפקדה (EVM)", address: "0x9978ab0f642bbf0b75e92db0e639ee863e053ac4" },
  { label: "headcorner (idx=2)", address: "0x2767e8146c11bad1d9b0784f11325375195c1b0f" },
  { label: "סוכן-הלב (0x0FB6)", address: "0x0fb6c1807d8d7945b5e3a14ea3679e19795cb545" },
] as const;

const SOL_ADDRS = [
  { label: "כתובת-ההפקדה (SOL)", address: "8SGkrAjepscF3ttD5UzxyFwX8DgREUBD3cjNe5ZEmnCk" },
  { label: "headcorner (idx=2)", address: "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL" },
  { label: "headcorner (R11-derive)", address: "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj" },
] as const;

const BTC_ADDRS = [
  { label: "כתובת-ההפקדה (BTC)", address: "bc1qpgfuznfxncqqvs3j20p3p38kesu4ljsqhha58c" },
  { label: "headcorner (idx=2)", address: "bc1qf7czhpnpkc8mwx32r5gleqw0kj99j823822pmg" },
] as const;

const EVM_RPC = "https://ethereum-rpc.publicnode.com";
const SOL_RPC = "https://solana-rpc.publicnode.com";

// ── עזרי-רשת: טיימאאוט אמת, ניסיון-כפול רק לרשתות-החלושות ────────────

async function jget(url: string, ms = 12000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function jpost(url: string, body: unknown, ms = 12000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<any> {
  const j = await jpost(url, { jsonrpc: "2.0", id: 1, method, params });
  if (j?.error) throw new Error(String(j.error.message ?? "rpc-error"));
  return j.result;
}

// ── שרשראות ──────────────────────────────────────────────────────────

async function steemSide() {
  const [accts, props] = await Promise.all([
    rpcCall("https://api.steemit.com", "condenser_api.get_accounts", [[...STEEM_FLEET]]),
    rpcCall("https://api.steemit.com", "condenser_api.get_dynamic_global_properties", []),
  ]);
  const fund = parseFloat(props.total_vesting_fund_steem);
  const shares = parseFloat(props.total_vesting_shares);
  const perVest = shares > 0 ? fund / shares : 0;
  const head = accts.find((a: any) => a.name === "headcorner");
  const toWithdraw = Number(head?.to_withdraw ?? 0) / 1e6;
  const rate = parseFloat(head?.vesting_withdraw_rate ?? "0");
  const paymentsLeft = rate > 0 ? Math.min(13, Math.ceil(toWithdraw / rate)) : 0;
  const next = head?.next_vesting_withdrawal ? new Date(head.next_vesting_withdrawal + "Z") : null;
  const rows = accts.map((a: any) => {
    const steem = parseFloat(a.balance);
    const sbd = parseFloat(a.sbd_balance);
    const vests = parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares);
    const sp = vests * perVest;
    const received = parseFloat(a.received_vesting_shares) * perVest;
    return { name: a.name, steem, sbd, sp, receivedSp: received };
  });
  return {
    perVest,
    accounts: rows,
    powerdown: {
      active: paymentsLeft > 0 && next !== null && next.getTime() > Date.now(),
      weeklySteem: rate * perVest,
      nextPayment: next ? next.toISOString() : null,
      paymentsLeft,
      totalRemainingSteem: toWithdraw * perVest,
    },
  };
}

async function hiveSide() {
  const [accts, props] = await Promise.all([
    rpcCall("https://api.hive.blog", "condenser_api.get_accounts", [[...STEEM_FLEET]]),
    rpcCall("https://api.hive.blog", "condenser_api.get_dynamic_global_properties", []),
  ]);
  const fund = parseFloat(props.total_vesting_fund_hive);
  const shares = parseFloat(props.total_vesting_shares);
  const perVest = shares > 0 ? fund / shares : 0;
  const rows = accts.map((a: any) => ({
    name: a.name,
    hive: parseFloat(a.balance),
    hbd: parseFloat(a.hbd_balance ?? a.sbd_balance ?? 0),
    hp: (parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares)) * perVest,
  }));
  return { accounts: rows };
}

async function tronSide() {
  const out = [];
  for (const t of TRON_ADDRS) {
    const j = await jget(
      `https://apilist.tronscanapi.com/api/account?address=${t.address}`,
    );
    out.push({
      label: t.label,
      address: t.address,
      trx: Number(j.balance ?? 0) / 1e6,
      trc20: (j.trc20token_balances ?? []).length,
    });
  }
  return out;
}

async function evmSide() {
  const out = [];
  for (const e of EVM_ADDRS) {
    const [balHex, nonce] = await Promise.all([
      rpcCall(EVM_RPC, "eth_getBalance", [e.address, "latest"]),
      rpcCall(EVM_RPC, "eth_getTransactionCount", [e.address, "latest"]).catch(() => null),
    ]);
    out.push({
      label: e.label,
      address: e.address,
      eth: parseInt(balHex, 16) / 1e18,
      txsSent: nonce !== null ? parseInt(nonce, 16) : null,
    });
  }
  return out;
}

async function solSide() {
  const out = [];
  for (const s of SOL_ADDRS) {
    let lamports: number | null = null;
    // ניסיון-כפול: publicnode לפעמים חונק בשקט מהסנדבוקס
    for (const ep of [SOL_RPC, "https://api.mainnet-beta.solana.com"]) {
      try {
        const r = await rpcCall(ep, "getBalance", [s.address]);
        lamports = r?.value ?? null;
        if (lamports !== null) break;
      } catch {
        /* נקודה הבאה */
      }
    }
    if (lamports === null) throw new Error("sol-rpc-unreachable");
    out.push({ label: s.label, address: s.address, sol: lamports / 1e9 });
  }
  return out;
}

async function btcSide() {
  const joined = BTC_ADDRS.map((b) => b.address).join("|");
  const j = await jget(`https://blockchain.info/balance?active=${joined}&cors=true`);
  return BTC_ADDRS.map((b) => ({
    label: b.label,
    address: b.address,
    btc: (j[b.address]?.final_balance ?? 0) / 1e8,
    txs: j[b.address]?.n_tx ?? 0,
  }));
}

async function pricesSide() {
  const syms = ["STEEMUSDT", "HIVEUSDT", "TRXUSDT", "ETHUSDT", "SOLUSDT", "BTCUSDT"];
  const parts = await Promise.all(
    syms.map((s) =>
      jget(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`, 8000)
        .then((j) => [s.replace("USDT", ""), Number(j.price)] as const)
        .catch(() => [s.replace("USDT", ""), null] as const),
    ),
  );
  const p: Record<string, number | null> = Object.fromEntries(parts);
  // SBD/HBD לא נסחרים בביננס — הסימון החי האחרון של הגריד שלנו, עם נפילה-כנה
  try {
    const g = await jget("https://roshpinacare-sys.github.io/Console/dex/grid.json", 8000);
    if (g?.marks?.sbdUsd) p.SBD = Number(g.marks.sbdUsd);
  } catch {
    /* בלי סימון — null */
  }
  if (p.SBD != null) p.HBD = p.SBD;
  return p;
}

// ── מצב-הרשת מהקונסולה הציבורית (מלאי נאמנות גבוה) ───────────────────

async function networkSide() {
  const out: Record<string, unknown> = {};
  try {
    const w = await jget("https://roshpinacare-sys.github.io/Console/dex/world.json", 8000);
    out.height = w?.state?.height ?? null;
    // סולם-המנוע: 1 יחידת-נכס = 1000µ (kernel.ts:8) — treasuryProfit במילי-USDS
    out.treasuryProfitUsds = (w?.state?.treasuryProfit ?? 0) / 1e3;
    out.backingWsteem = w?.state?.backing?.WSTEEM != null ? w.state.backing.WSTEEM / 1e3 : null;
    out.publishedAt = w?.publishedAt ?? null;
    out.halted = w?.state?.halted ?? null;
  } catch {
    out.height = null;
  }
  try {
    const w = await jget("https://roshpinacare-sys.github.io/Console/dex/watch.json", 8000);
    out.depositsTotal = w?.depositsTotal ?? null;
    out.chains = w?.chains ?? null;
  } catch {
    out.depositsTotal = null;
  }
  try {
    const g = await jget("https://roshpinacare-sys.github.io/Console/dex/grid.json", 8000);
    out.gridVerdict = g?.verdict ?? null;
    out.gridArmed = g?.armed ?? null;
  } catch {
    out.gridVerdict = null;
  }
  return out;
}

// ── מטמון SWR (stale-while-revalidate) ──────────────────────────────
//
// לקח-R53 (נמדד חי): שער-הכסף מרענן כל 60 שניות — בדיוק בגבול ה-TTL
// הישן, ולכן כמעט כל poll אכל 1.1–1.4 שניות של 8 מקורות-חיים.
// מעתה: תשובה מיידית תמיד אחרי הראשונה; רענון-רקע single-flight.

const SWR_KEY = "api:treasury";
const SWR_TTL_MS = 60_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeTreasury);
  return NextResponse.json(
    {
      ...value,
      cached: meta.cached,
      stale: meta.stale,
      cacheAgeSec: meta.cacheAgeSec,
      refreshing: meta.refreshing,
    },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}

async function composeTreasury() {
  const down: string[] = [];

  const [steem, hive, tron, evm, sol, btc, prices, network] = await Promise.all([
    steemSide().catch((e) => {
      down.push(`steem: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    hiveSide().catch((e) => {
      down.push(`hive: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    tronSide().catch((e) => {
      down.push(`tron: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    evmSide().catch((e) => {
      down.push(`evm: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    solSide().catch((e) => {
      down.push(`sol: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    btcSide().catch((e) => {
      down.push(`btc: ${String(e.message).slice(0, 40)}`);
      return null;
    }),
    pricesSide().catch(() => null),
    networkSide().catch(() => ({})),
  ]);

  const p = prices ?? {};
  const usd = (k: string): number | null => {
    const v = p[k];
    return typeof v === "number" && v > 0 ? v : null;
  };

  // סכומי-USD: רק מחירים חיים — בלי מחיר אין סכום (לא ממצאים)
  let steemLiquidUsd = 0;
  let steemVestingUsd = 0;
  const steemPrice = usd("STEEM");
  if (steem && steemPrice) {
    for (const a of steem.accounts) {
      steemLiquidUsd += a.steem * steemPrice + a.sbd * (usd("SBD") ?? 0);
      steemVestingUsd += a.sp * steemPrice;
    }
  }
  let hiveUsd = 0;
  if (hive && usd("HIVE")) {
    for (const a of hive.accounts) {
      hiveUsd += a.hive * (usd("HIVE") ?? 0) + a.hbd * (usd("HBD") ?? 0) + a.hp * (usd("HIVE") ?? 0);
    }
  }
  const tronUsd = tron ? tron.reduce((s, t) => s + t.trx * (usd("TRX") ?? 0), 0) : 0;
  const evmUsd = evm ? evm.reduce((s, e) => s + e.eth * (usd("ETH") ?? 0), 0) : 0;
  const solUsd = sol ? sol.reduce((s, x) => s + x.sol * (usd("SOL") ?? 0), 0) : 0;
  const btcUsd = btc ? btc.reduce((s, x) => s + x.btc * (usd("BTC") ?? 0), 0) : 0;

  const liquidUsd = steemLiquidUsd + hiveUsd + tronUsd + evmUsd + solUsd + btcUsd;
  const data = {
    ok: down.length === 0,
    fetchedAt: new Date().toISOString(),
    down: down.length ? down : undefined,
    usd: {
      total: steemVestingUsd + liquidUsd,
      liquid: liquidUsd,
      vesting: steemVestingUsd,
      missingPrices: ["STEEM", "HIVE", "TRX", "ETH", "SOL", "BTC", "SBD"].filter((k) => usd(k) === null),
    },
    steem: steem ?? undefined,
    hive: hive ?? undefined,
    tron: tron ?? undefined,
    evm: evm ?? undefined,
    sol: sol ?? undefined,
    btc: btc ?? undefined,
    prices: p,
    network,
  };
  return data;
}
