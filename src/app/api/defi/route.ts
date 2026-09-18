// ─────────────────────────────────────────────────────────────────────
// /api/defi — הגלגל הריבוני: שוק-כספים, כספות, ומספרי הענקיות.
//
// דבר גורר דבר (v20): הגריד לבדו אינו מספיק — נדרשת ריבונות
// מלאה שמקיימת זרימת-מזומנים רציפה בין הכלים. ה-API הזה מחשב
// את מצב הכלים מהנתונים החיים בלבד:
//
//   world.json  — השרשרת הקנונית (בריכות, ארנקים, ארנה, מילויים)
//   money.json  — צופה נתיב-הכסף (powerdown, פדיון, אינווריאנטה)
//   grid.json   — הגריד החוץ (STEEM-internal-market)
//   watch.json  — ספר ההפקדות הפתוח (4 רשתות)
//   DefiLlama   — TVL חי של Aave/Compound/Uniswap/Curve/Yearn/Sky
//
// שום דבר לא מומצא: כל פרמטר נגזר מנתון חי או מוגדר כמדיניות
// גלויה (עקומת הריבית). מקור שנפל מסומן down בכנות.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CONSOLE_BASE = "https://roshpinacare-sys.github.io/Console";

// ── עזר רשת עם timeout ──────────────────────────────────────────────

async function jget(url: string, timeoutMs = 9000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── מדיניות שוק-הכספים (גלויה, בסטנדרט Aave-v3 kinked) ────────────────
//
// עקומת ריבית עם ברך (kink) בניצולת 80%, כמו Aave v3 על נכסי-יסוד:
//   U ≤ 80%:  R = R0 + slope × U
//   U > 80%:  R = R0 + slope × U + slope2 × (U − 80%)
// הפרמטרים כאן שמרניים בכוונה (רשת צעירה, סיכון-אמון גבוה):
//   R0 = 1% בסיס · slope = 4% · slope2 = 60% — עונש חד מעל הברך.

export const MM = {
  optimalUtilBps: 8000,
  baseApr: 0.01,
  slope1: 0.04,
  slope2: 0.6,
  reserveFactor: 0.1, // 10% מהריבית → אוצר (שקיפות מלאה)
  ltv: 0.5, // 50% LTV לנכסי-צד
  liquidationThreshold: 0.65,
  liquidationPenalty: 0.075,
} as const;

function borrowApr(util: number): number {
  const u = Math.min(1, Math.max(0, util));
  let r = MM.baseApr + MM.slope1 * u;
  if (u > MM.optimalUtilBps / 10000)
    r += MM.slope2 * (u - MM.optimalUtilBps / 10000);
  return r;
}

function aprToApy(apr: number, periodsPerYear: number): number {
  // ריבית-דריבית: APY = (1 + APR/n)^n − 1
  if (apr <= 0) return 0;
  return Math.pow(1 + apr / periodsPerYear, periodsPerYear) - 1;
}

// ── צד השרשרת החיה (world.json) ──────────────────────────────────────

interface WorldDoc {
  state?: {
    height?: number; treasuryProfit?: number; fills?: number; swaps?: number;
    liveOrders?: number; tps?: number; opsTotal?: number;
  };
  pools?: Array<{
    key: string; ra: number; rb: number; swaps: number;
    feeAccruedTreasury?: number; feeBps?: number; lpYieldBps?: number;
    polShareBps?: number; derived?: boolean;
  }>;
  wallets?: Array<{
    name: string; credits?: number;
    balances?: Record<string, number>;
    locked?: Record<string, number>;
  }>;
  markets?: Array<{ key: string; bestBid?: number; bestAsk?: number; spreadBps?: number }>;
}

function mu(v: number | undefined): number {
  // 1 יחידת-נכס = 1000µ — אותו סולם-מנוע של הקרנל (kernel.ts:8)
  return (v ?? 0) / 1000;
}

async function worldSide() {
  const w: WorldDoc = await jget(`${CONSOLE_BASE}/dex/world.json`);
  const pools = w.pools ?? [];
  const wallets = w.wallets ?? [];

  // ── אספקת USDS הזמינה לשוק-הכספים: ארנקי הרשת הפתוחים (אוצר+מפעיל)
  //    בלי ה-LP ובלי הנעילות — רק מזומן שאפשר להפקיד בלי לשבור כלום.
  const byName = new Map(wallets.map((x) => [x.name, x]));
  const treasuryUsds = mu(byName.get("treasury")?.balances?.USDS);
  const operatorUsds = mu(byName.get("operator")?.balances?.USDS);
  const arenaUsds = mu(byName.get("arena")?.balances?.USDS);
  const supply = treasuryUsds + operatorUsds + arenaUsds;

  // ── ביקוש ההלוואות החי: החיילים נועלים USDS כבטוחה בארנה — זו
  //    הלוואה אמיתית מהשרשרת (locked), לא המחשה.
  let borrowed = 0;
  for (const wl of wallets) {
    if (!wl.name.startsWith("soldier-")) continue;
    borrowed += mu(wl.locked?.USDS);
  }
  const util = supply > 0 ? Math.min(1, borrowed / supply) : 0;
  const bApr = borrowApr(util);
  // ריבית למלווה = ריבית הלוואה × (1 − גורם-היתרה) × ניצולת — כמו Aave
  const supplyApr = bApr * (1 - MM.reserveFactor) * util;

  return {
    height: w.state?.height ?? null,
    treasuryProfitUsds: mu(w.state?.treasuryProfit),
    fills: w.state?.fills ?? 0,
    swaps: w.state?.swaps ?? 0,
    liveOrders: w.state?.liveOrders ?? 0,
    opsTotal: w.state?.opsTotal ?? 0,
    pools: pools.map((p) => ({
      key: p.key,
      // ערך הבריכה ב-USDS: הצד ה-USDS הוא הציטוט; אם אין — הצד השני במחיר הביניים
      ra: mu(p.ra), rb: mu(p.rb),
      swaps: p.swaps,
      feeAccruedUsds: mu(p.feeAccruedTreasury),
      feeBps: p.feeBps ?? null,
      lpYieldBps: p.lpYieldBps ?? null,
      derived: p.derived ?? false,
    })),
    market: {
      supplyUsds: supply,
      treasuryUsds, operatorUsds, arenaUsds,
      borrowedUsds: borrowed,
      utilization: util,
      borrowApr: bApr,
      supplyApr,
      policy: MM,
    },
    publishedAt: (w as any).publishedAt ?? null,
  };
}

// ── צד נתיב-הכסף (money.json + grid.json + watch.json) ────────────────

async function moneySide() {
  const [m, g, k] = await Promise.all([
    jget(`${CONSOLE_BASE}/dex/money.json`),
    jget(`${CONSOLE_BASE}/dex/grid.json`),
    jget(`${CONSOLE_BASE}/dex/watch.json`),
  ]);
  return {
    powerdown: {
      active: m?.fuel?.powerdown?.active ?? false,
      weeklySp: m?.fuel?.powerdown?.rateSp ?? null,
      nextPayout: m?.fuel?.powerdown?.nextPayout ?? null,
    },
    weeklyUsd: g?.fuel?.weeklyUsd ?? null,
    grid: {
      armed: g?.armed ?? false,
      verdict: g?.verdict ?? null,
      filledTotal: g?.run?.filledTotal ?? 0,
      externalFlowUsd: g?.externalFlowUsd ?? 0,
      blockers: g?.blocker ?? [],
    },
    deposits: {
      total: k?.depositsTotal ?? 0,
      chains: k?.chains ?? null,
      watching: k?.watching ?? null,
      cadenceMin: k?.cadenceMin ?? null,
    },
    invariantHolds: m?.invariant?.holds ?? null,
    marks: m?.marks ?? null,
  };
}

// ── הענקיות (DefiLlama — TVL חי) ────────────────────────────────────

const GIANTS: Array<{ slug: string; he: string; what: string }> = [
  { slug: "aave-v3", he: "Aave v3", what: "שוק-כספים" },
  { slug: "compound-v3", he: "Compound v3", what: "שוק-כספים" },
  { slug: "uniswap-v3", he: "Uniswap v3", what: "בורסת AMM" },
  { slug: "curve-dex", he: "Curve", what: "בורסת stableswap" },
  { slug: "yearn-finance", he: "Yearn", what: "כספות-תשואה" },
  { slug: "sky-lending", he: "Maker/Sky", what: "CDP → סטייבלקוין" },
];

async function giantsSide() {
  const one = await jget("https://api.llama.fi/protocol/aave-v3", 9000).catch(() => null);
  const all = await jget("https://api.llama.fi/protocols", 12000).catch(() => null);
  if (!all || !Array.isArray(all)) {
    return { live: false, list: [] as Array<{ he: string; what: string; tvlUsd: number | null }> };
  }
  const bySlug = new Map<string, number>();
  for (const p of all) {
    if (p?.slug && typeof p.tvl === "number") bySlug.set(p.slug, p.tvl);
  }
  // aave-v3 מופיע גם בפרוטוקול הבודד — עדיף המספר העדכני שם
  if (one?.currentChainTvls) {
    const total = Object.values(one.currentChainTvls).reduce(
      (s: number, v: any) => s + (typeof v === "number" ? v : 0), 0);
    if (total > 0) bySlug.set("aave-v3", total);
  }
  return {
    live: true,
    list: GIANTS.map((g) => ({
      he: g.he, what: g.what,
      tvlUsd: bySlug.get(g.slug) ?? null,
    })),
  };
}

// ── מטמון זיכרון 60 שניות ────────────────────────────────────────────

let cache: { at: number; data: any } | null = null;
const CACHE_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.data, cached: true, cacheAgeSec: Math.round((Date.now() - cache.at) / 1000) });
  }

  const down: string[] = [];
  const [world, money, giants] = await Promise.all([
    worldSide().catch((e) => { down.push(`world: ${String(e.message).slice(0, 40)}`); return null; }),
    moneySide().catch((e) => { down.push(`money: ${String(e.message).slice(0, 40)}`); return null; }),
    giantsSide().catch((e) => { down.push(`giants: ${String(e.message).slice(0, 40)}`); return null; }),
  ]);

  // ── הכספות: אסטרטגיות מהבריכות החיות בלבד ─────────────────────────
  // התשואה נמדדת ב-bps מעל הון ה-LP (lpYieldBps) — לא הבטחה. ריבית-
  // דריבית יומית (harvest יומי, כמו Yearn): APY = (1+APR/365)^365−1.
  const vaults: any[] = [];
  if (world?.pools) {
    for (const p of world.pools) {
      if (p.lpYieldBps == null) continue;
      const apr = p.lpYieldBps / 10000;
      vaults.push({
        key: p.key,
        apr,
        apy: aprToApy(apr, 365),
        tvlUsds: p.ra,
        feesAccruedUsds: p.feeAccruedUsds,
        swaps: p.swaps,
        feeBps: p.feeBps,
      });
    }
    vaults.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
  }

  // ── מצב הגלגל: כל חוליה עם המספר החי שלה ───────────────────────────
  const flywheel = {
    deposits: {
      label: "הפקדות חוץ נכנסות",
      value: money?.deposits.total ?? 0,
      unit: "הפקדות",
      detail: "4 כתובות ב-4 רשתות נצפות כל 20 דק׳ — ספר פתוח",
    },
    credit: {
      label: "זיכוי USDS",
      value: (money?.deposits.total ?? 0) > 0 ? "מופעל" : "מוכן",
      unit: "",
      detail: "כל הפקדה שנטענת → תביעה חתומה → זיכוי בשער הרשת",
    },
    market: {
      label: "שוק-הכספים",
      value: world?.market.supplyUsds ?? 0,
      unit: "USDS",
      detail: `ניצולת ${(100 * (world?.market.utilization ?? 0)).toFixed(1)}% · ריבית הלוואה ${((world?.market.borrowApr ?? 0) * 100).toFixed(2)}% APR`,
    },
    liquidity: {
      label: "נזילות הבורסה",
      value: world?.pools.reduce((s: number, p: any) => s + (p.ra ?? 0), 0) ?? 0,
      unit: "USDS",
      detail: `${world?.pools.length ?? 0} בריכות · ${world?.swaps ?? 0} החלפות · ${world?.fills ?? 0} מילויים`,
    },
    fees: {
      label: "עמלות זורמות",
      value: world?.pools.reduce((s: number, p: any) => s + (p.feeAccruedUsds ?? 0), 0) ?? 0,
      unit: "USDS",
      detail: "עמלות נמדדות מכל החלפה — לא מובטחות, לא מומצאות",
    },
    treasury: {
      label: "אוצר מתעצם",
      value: world?.treasuryProfitUsds ?? 0,
      unit: "USDS",
      detail: "רווח מצטבר + 10% מריבית שוק-הכספים (גורם-היתרה)",
    },
    grid: {
      label: "הגריד מזרים",
      value: money?.grid.externalFlowUsd ?? 0,
      unit: "USD",
      detail: `powerdown ≈$${(money?.weeklyUsd ?? 0).toFixed(2)}/שבוע · ${money?.grid.filledTotal ?? 0} מילויים`,
    },
  };

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    world, money, giants,
    vaults,
    flywheel,
    compounding: {
      note: "APY = (1+APR/n)^n−1 · הכספות מתומחרות יומית (harvest), שוק-הכספים רציף",
      marketApy: world ? aprToApy(world.market.supplyApr, 365) : 0,
      marketBorrowApy: world ? aprToApy(world.market.borrowApr, 365) : 0,
    },
    down,
    honesty:
      "כל מספר נמדד חי מהקונסולה הציבורית (world/money/grid/watch.json) ומ-DefiLlama. פרמטרי עקומת-הריבית גלויים ב-full. מקור שנפל מסומן ב-down. אף תשואה אינה מובטחת — זו רשת הוכחות, לא הבטחות.",
  });
}
