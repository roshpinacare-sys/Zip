// ─────────────────────────────────────────────────────────────────────
// /api/money — מוביל הכסף (R81 · THE MONEY-MOVER).
//
// הוראת המפעיל שיצרה את המערכת: "שנכנס אתמול כסף מה קרה איתו אני רואה
// שסתם הוא יושב מחכה.. גרוע מאוד. אין מצב שעושים תוכנית ואז מחכים למשהו
// תקוע שיזוז. המערכת צריכה להיות דינמית ומבינה בשוק חי ולא לחכות אלא
// לפעול ותמיד לחפש הזדמנויות טובות יותר."
//
// האבחנה שיצרה את R81 (נמדדה חי, 2026-09-22T00:20Z): תשלום הפאוורדאון
// (475.5 STEEM, 19/09) ישב 389.96 STEEM בתוך 3 פקודות מכירה שהוצבו
// לפי פאריטה חיצונית 0.1142 — ולא זזו מאז. השוק הפנימי נסחר 0.096–0.099,
// והפאריטה עצמה זזה ל-0.1189: הפקודות היו תקועות גם כלפי השוק וגם
// מתחת-לפאריטה-החיה. מנוע ה-grid שהציב אותן מת (Actions). R81 הוא
// התשובה: מוביל כסף חי.
//
// הפרדת הסמכויות (דוקטרינת R80, מורחבת לכסף):
//   · המוביל (mini-services/money, פורט 3034) — מחליט מתי. מדיניות
//     קשיחה: גרירת-פאריטה, קירור-30-דקות, תקציב-12-פעולות/יום,
//     פריסת-דלק אוטומטית בנחיתת פאוורדאון.
//   · העורק (ה-POST הזה) — מחליט איך: גוזר את מפתח-ה-active בזיכרון-
//     ההרצה בלבד מה-upload של המפעיל, מאמת ביט-מול-ביט מול הרשות
//     החיה, ואז משדר limit_order_cancel + limit_order_create חתומים.
//     המפתח לעולם לא נכתב, לא נדפס, לא נשמר.
//   · השרשרת (Steem) — השופטת. הספר הפתוח: פקודות, יתרות ומילויים
//     נקראים חסרי-מפתחות מ-api.steemit.com בכל מחזור. אין שום מצב
//     מקומי שהוא מקור-אמת.
//
// חוקי רצפת-הערך (hard-coded, לא המלצות):
//   1. לעולם לא מוצבת פקודת מכירה מתחת לפאריטה החיה (ערך-USD חיצוני
//      של STEEM) — רצפה נאכפת בקוד: אם הפאריטה לא נמדדת חי, הפעולה
//      מסורבת בכנות (אין שער — אין מסחר).
//   2. סולם שלוש רמות: פאריטה, +1%, +2% — כל ביד שיחצה את הקו ממלא
//      את רמה-1 באופן מיידי; השוק עושה את העבודה, הסולם הוא מלכודת-ערך.
//   3. כשהפאריטה זזה >50bps מהסולם שהוצב — הסולם נגרר אליה
//      (cancel+replace). הכסף לעולם לא יושב על מחיר אתמול.
//   4. נחיתת דלק (פאוורדאון שבועי) מוצבת בסולם בתוך מחזור אחד.
//   5. כל פעולה מחזירה קבלה: txid לכל cancel, txid לכל create,
//      מחירים, סכומים — הכול ניתן למדידה-חוזרת מהשרשרת.
//
// מקורות חיים (חסרי-מפתחות): api.steemit.com (חשבון · פקודות · ספר ·
// היסטוריה) · api.binance.com (STEEMUSDT) · api.coingecko.com (SBD,
// עם נפילה-כנה ל-money.json) · apilist.tronscanapi.com (משמרת+פדיון).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { swrGet, cacheHeader, swrInvalidate } from "@/lib/live/swr";
import { operatorFromRequest } from "@/lib/operator-auth";
import { evaluateGate, settleGate } from "@/lib/weave/tx-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCOUNT = "headcorner"; // החותם — הזהות מוכרזת מהמפתח עצמו (R75)
const UPLOAD_DIR = "/home/z/my-project/upload";
const OWNER_FILE = path.join(UPLOAD_DIR, "headcorner.txt");
const HOME = "/home/z/my-project";
const STATE_DIR = `${HOME}/sovereign/money`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const HISTORY_FILE = `${STATE_DIR}/history.json`;

// ── חוזה התשובה (BE↔FE) ──────────────────────────────────────────────

export interface MoneyMark {
  steemUsd: number | null;
  sbdUsd: number | null;
  trxUsd: number | null;
  parity: number | null; // SBD per STEEM
  sources: Record<string, string>;
}

export interface BookLevel {
  price: number; // SBD per STEEM
  sbd: number;
  steem: number;
}

export interface OpenAsk {
  orderid: number;
  amount: number; // STEEM
  receive: number; // SBD
  price: number; // SBD per STEEM
  created: string;
  expiration: string;
  /** bps מהפאריטה החיה (שלילי = מתחת לרצפה — פקודה מיושנת שהמוביל אמור לגרור) */
  vsParityBps: number | null;
  sbdIfFilled: number;
  usdIfFilled: number | null;
}

// הצעת קנייה פתוחה שלנו — צד ה-SBD של המיקרו-גריד (R97)
export interface OpenBid {
  orderid: number;
  sbd: number; // כמה SBD מוצע
  steem: number; // כמה STEEM מתקבל
  price: number; // SBD per STEEM
  created: string;
  expiration: string;
  vsParityBps: number | null;
  usdIfFilled: number | null;
}

export interface FillReceipt {
  at: string;
  side: "sold-steem" | "bought-steem";
  paid: string;
  received: string;
  price: number | null;
}

export interface LadderLevel {
  level: 1 | 2 | 3;
  premiumBps: number;
  price: number | null;
}

export interface Opportunity {
  id: string;
  title: string;
  state: "HUNTING" | "ARMED" | "BLOCKED" | "FLOWING";
  detail: string;
  number: string | null;
}

export interface MoverReceipt {
  at: string;
  kind: "REPRICE" | "DEPLOY" | "FUEL-IN" | "ARM-BUY";
  reason: string;
  parity: number | null;
  cancelled: Array<{ orderid: number; txid: string | null }>;
  placed: Array<{ orderid: number; sell: number; receive: number; price: number; txid: string | null; confirmedBy?: string }>;
  /** אימות-סוף מהשרשרת — השופט: מה באמת פתוח שם אחרי הפעולה */
  verify?: { ordersNow: number; deployedNow: number; bidsNow?: number } | null;
  error?: string;
}

export interface DaemonState {
  alive: boolean;
  bootedAt: string | null;
  beats: number | null;
  lastDecision: { at: string; kind: string; detail: string } | null;
  lastActionAt: string | null;
  actionsToday: number | null;
  nextEligibleAt: string | null;
  history: MoverReceipt[];
  fetchedVia: "http" | "file" | "down";
}

export interface MoneySense {
  ok: boolean;
  at: string;
  account: string;
  marks: MoneyMark;
  balances: { steem: number | null; sbd: number | null };
  book: {
    bids: BookLevel[];
    asks: BookLevel[];
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spreadBps: number | null;
  };
  orders: OpenAsk[];
  ourBids: OpenBid[];
  deployedSteem: number;
  idleSteem: number;
  ladder: LadderLevel[];
  powerdown: {
    active: boolean | null;
    weeklySteem: number | null;
    nextPayment: string | null;
    paymentsLeft: number | null;
    totalRemainingSteem: number | null;
  };
  fills: FillReceipt[];
  sbdArming: { balance: number; needed: number; commitable: number; state: "ARMED" | "WAIT" };
  redemption: {
    outboxTrx: number | null;
    custodyTrx: number | null;
    sendThresholdTrx: number;
    verdict: "WAIT" | "GO" | "UNKNOWN";
    detail: string;
  };
  diagnosis: {
    enteredSteem: number;
    whereItSits: { inOrders: number; liquid: number; sbd: number };
    staleHours: number | null;
    note: string;
  };
  opportunities: Opportunity[];
  daemon: DaemonState;
  doctrine: string[];
  down: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

// ── רשת עם timeout (חסר-מפתחות) ─────────────────────────────────────

async function jget(url: string, timeoutMs = 9000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "the-weave-money-mover/1.0" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function steemRpc(method: string, params: unknown[]): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch("https://api.steemit.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = await res.json();
    if (j?.error) throw new Error(String(j.error.message ?? "rpc-error"));
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

// ── מדידות חיות ─────────────────────────────────────────────────────

async function steemSide(): Promise<{ a: any; openOrders: any[]; book: any }> {
  const [accts, openOrders, book] = await Promise.all([
    steemRpc("condenser_api.get_accounts", [[ACCOUNT]]),
    steemRpc("condenser_api.get_open_orders", [ACCOUNT]),
    steemRpc("condenser_api.get_order_book", [10]),
  ]);
  const a = accts?.[0];
  if (!a) throw new Error("account-empty");
  return { a, openOrders: openOrders ?? [], book };
}

async function fillsSide(): Promise<FillReceipt[]> {
  const hist = await steemRpc("condenser_api.get_account_history", [ACCOUNT, -1, 100]);
  const out: FillReceipt[] = [];
  for (const [, rec] of hist as Array<[number, any]>) {
    const [type, data] = rec.op;
    if (type !== "fill_order") continue;
    const weAreCurrent = data?.current_owner === ACCOUNT;
    const weAreOpen = data?.open_owner === ACCOUNT;
    if (!weAreCurrent && !weAreOpen) continue;
    const paid = weAreCurrent ? String(data.current_pays ?? "") : String(data.open_pays ?? "");
    const received = weAreCurrent ? String(data.open_pays ?? "") : String(data.current_pays ?? "");
    const paidN = parseFloat(paid) || 0;
    const recvN = parseFloat(received) || 0;
    let price: number | null = null;
    if (paid.endsWith("STEEM") && received.endsWith("SBD") && paidN > 0) {
      price = Math.round((recvN / paidN) * 1e6) / 1e6;
    } else if (paid.endsWith("SBD") && received.endsWith("STEEM") && recvN > 0) {
      price = Math.round((paidN / recvN) * 1e6) / 1e6;
    }
    out.push({ at: (rec.timestamp ?? "") + "Z", side: paid.endsWith("SBD") ? "bought-steem" : "sold-steem", paid, received, price });
  }
  return out.reverse().slice(0, 12);
}

async function marksSide(): Promise<MoneyMark> {
  const sources: Record<string, string> = {};
  let steemUsd: number | null = null;
  let sbdUsd: number | null = null;
  let trxUsd: number | null = null;
  try {
    const j = await jget("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", 8000);
    steemUsd = Number(j.price);
    sources.steem = "binance:STEEMUSDT";
  } catch {
    /* נפילה למטה */
  }
  try {
    const j = await jget("https://api.coingecko.com/api/v3/simple/price?ids=steem-dollars,tron&vs_currencies=usd", 9000);
    if (typeof j?.["steem-dollars"]?.usd === "number") {
      sbdUsd = j["steem-dollars"].usd;
      sources.sbd = "coingecko:steem-dollars";
    }
    if (typeof j?.tron?.usd === "number") {
      trxUsd = j.tron.usd;
      sources.trx = "coingecko:tron";
    }
  } catch {
    /* נפילה למטה */
  }
  if (sbdUsd == null || trxUsd == null) {
    // נפילה-כנה: money.json של הקונסולה (צופה נתיב-הכסף)
    try {
      const m = await jget("https://roshpinacare-sys.github.io/Console/dex/money.json", 8000);
      if (sbdUsd == null && typeof m?.marks?.sbdUsd === "number") {
        sbdUsd = m.marks.sbdUsd;
        sources.sbd = `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z`;
      }
      if (trxUsd == null && typeof m?.marks?.trxUsd === "number") {
        trxUsd = m.marks.trxUsd;
        sources.trx = `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z`;
      }
    } catch {
      /* בלי שער */
    }
  }
  const parity = steemUsd != null && sbdUsd != null && sbdUsd > 0 ? steemUsd / sbdUsd : null;
  return { steemUsd, sbdUsd, trxUsd, parity, sources };
}

async function tronSide(): Promise<{ outbox: number | null; custody: number | null }> {
  const out = { outbox: null as number | null, custody: null as number | null };
  const addrs: Array<[keyof typeof out, string]> = [
    ["outbox", "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn"],
    ["custody", "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy"],
  ];
  for (const [k, address] of addrs) {
    try {
      const j = await jget(`https://apilist.tronscanapi.com/api/account?address=${address}`, 8000);
      out[k] = Number(j?.balance ?? 0) / 1e6;
    } catch {
      /* down בכנות */
    }
  }
  return out;
}

// ── מצב המוביל (הדיבון) — קריאה כנה ─────────────────────────────────

function readHistory(): MoverReceipt[] {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as MoverReceipt[];
  } catch {
    return [];
  }
}

async function daemonSide(): Promise<DaemonState> {
  // א. HTTP חי (2.5 שנ׳) — אם המוביל למעלה
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch("http://localhost:3034/", { signal: ctrl.signal, cache: "no-store" });
      if (res.ok) {
        const j: any = await res.json();
        return {
          alive: true,
          bootedAt: j.bootedAt ?? null,
          beats: j.beats ?? null,
          lastDecision: j.lastDecision ?? null,
          lastActionAt: j.lastActionAt ?? null,
          actionsToday: j.actionsToday ?? null,
          nextEligibleAt: j.nextEligibleAt ?? null,
          history: Array.isArray(j.history) ? j.history : [],
          fetchedVia: "http",
        };
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    /* נפילה לקובץ */
  }
  // ב. הקובץ — המוביל כותב state.json בכל פעימה
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      alive: false,
      bootedAt: j.bootedAt ?? null,
      beats: j.beats ?? null,
      lastDecision: j.lastDecision ?? null,
      lastActionAt: j.lastActionAt ?? null,
      actionsToday: j.actionsToday ?? null,
      nextEligibleAt: j.nextEligibleAt ?? null,
      history: readHistory().slice(-10).reverse(),
      fetchedVia: "file",
    };
  } catch {
    return {
      alive: false,
      bootedAt: null,
      beats: null,
      lastDecision: null,
      lastActionAt: null,
      actionsToday: null,
      nextEligibleAt: null,
      history: [],
      fetchedVia: "down",
    };
  }
}

// ── הרכבת ה-sense ────────────────────────────────────────────────────

const SWR_KEY = "money:sense";
const SWR_TTL_MS = 45_000;

export async function GET() {
  const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, sense);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}

async function sense(): Promise<MoneySense> {
  const down: string[] = [];

  const [steemRes, fills, marks, tron, daemon] = await Promise.all([
    steemSide().catch((e) => {
      down.push(`steem: ${String(e.message).slice(0, 50)}`);
      return null;
    }),
    fillsSide().catch((e) => {
      down.push(`fills: ${String(e.message).slice(0, 50)}`);
      return [] as FillReceipt[];
    }),
    marksSide().catch(() => null),
    tronSide().catch(() => ({ outbox: null as number | null, custody: null as number | null })),
    daemonSide(),
  ]);

  const parity = marks?.parity ?? null;
  const a = steemRes?.a;
  const balances = {
    steem: a ? parseFloat(a.balance) : null,
    sbd: a ? parseFloat(a.sbd_balance) : null,
  };

  // פקודות פתוחות שלנו — הפרדת צדדים (R97): base=STEEM → מכירה; base=SBD → קנייה.
  // עד R97 היו רק מכירות; מעתה סולם-הקנייה חי — ולכן כל מנה נספרת בנכס שלה.
  const allOpen = (steemRes?.openOrders ?? []) as any[];
  const sellOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"));
  const bidOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("SBD"));
  const orders: OpenAsk[] = sellOpen.map((o: any) => {
    const amount = Number(o.for_sale) / 1000;
    const baseN = parseFloat(String(o.sell_price?.base ?? "")) || 0;
    const quoteN = parseFloat(String(o.sell_price?.quote ?? "")) || 0;
    const price = baseN > 0 ? quoteN / baseN : 0;
    const receive = Math.round(amount * price * 1000) / 1000;
    return {
      orderid: o.orderid,
      amount,
      receive,
      price: Math.round(price * 1e6) / 1e6,
      created: String(o.created ?? ""),
      expiration: String(o.expiration ?? ""),
      vsParityBps: parity != null && price > 0 ? Math.round((price / parity - 1) * 10_000) : null,
      sbdIfFilled: receive,
      usdIfFilled: marks?.sbdUsd != null ? Math.round(receive * marks.sbdUsd * 1000) / 1000 : null,
    };
  });
  // הצעות הקנייה שלנו — מוצגות בנפרד מסולם המכירה (R97)
  const ourBids: OpenBid[] = bidOpen.map((o: any) => {
    const bidBaseN = parseFloat(String(o.sell_price?.base ?? "")) || 0; // SBD שאנחנו מציעים
    const bidQuoteN = parseFloat(String(o.sell_price?.quote ?? "")) || 0; // STEEM שנקבל
    const bidPrice = bidQuoteN > 0 ? bidBaseN / bidQuoteN : 0; // SBD per STEEM
    return {
      orderid: o.orderid,
      sbd: Math.round(bidBaseN * 1000) / 1000,
      steem: Math.round(bidQuoteN * 1000) / 1000,
      price: Math.round(bidPrice * 1e6) / 1e6,
      created: String(o.created ?? ""),
      expiration: String(o.expiration ?? ""),
      vsParityBps: parity != null && bidPrice > 0 ? Math.round((bidPrice / parity - 1) * 10_000) : null,
      usdIfFilled: marks?.sbdUsd != null ? Math.round(bidBaseN * marks.sbdUsd * 1000) / 1000 : null,
    };
  });

  const deployedSteem = Math.round(orders.reduce((s, o) => s + o.amount, 0) * 1000) / 1000;
  const idleSteem = balances.steem != null ? Math.round(balances.steem * 1000) / 1000 : 0;

  // ספר הפקודות
  const bids: BookLevel[] = (steemRes?.book?.bids ?? []).map((b: any) => ({
    price: Number(b.real_price),
    sbd: Number(b.sbd) / 1000,
    steem: Number(b.steem) / 1000,
  }));
  const asks: BookLevel[] = (steemRes?.book?.asks ?? []).map((x: any) => ({
    price: Number(x.real_price),
    sbd: Number(x.sbd) / 1000,
    steem: Number(x.steem) / 1000,
  }));
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps =
    bestBid != null && bestAsk != null && bestBid > 0 ? Math.round(((bestAsk - bestBid) / bestBid) * 10_000) : null;

  // פאוורדאון — מדידה חיה מלאה (חשבון + props גלובליים)
  const powerdown = {
    active: null as boolean | null,
    weeklySteem: null as number | null,
    nextPayment: null as string | null,
    paymentsLeft: null as number | null,
    totalRemainingSteem: null as number | null,
  };
  if (a) {
    const rate = parseFloat(a.vesting_withdraw_rate ?? "0");
    const toWithdraw = Number(a.to_withdraw ?? 0) / 1e6;
    const next = a.next_vesting_withdrawal ? a.next_vesting_withdrawal + "Z" : null;
    powerdown.active = toWithdraw > 0 && next != null && new Date(next).getTime() > Date.now();
    powerdown.nextPayment = next;
    try {
      const g = await steemRpc("condenser_api.get_dynamic_global_properties", []);
      const fund = parseFloat(g.total_vesting_fund_steem);
      const shares = parseFloat(g.total_vesting_shares);
      const perVest = shares > 0 ? fund / shares : 0;
      powerdown.weeklySteem = Math.round(rate * perVest * 1000) / 1000;
      powerdown.paymentsLeft = rate > 0 ? Math.min(13, Math.ceil(toWithdraw / rate)) : 0;
      powerdown.totalRemainingSteem = Math.round(toWithdraw * perVest * 1000) / 1000;
    } catch {
      down.push("vesting-props: down");
    }
  }

  // חימוש SBD — צד הקנייה של הגריד
  const sbdArming = {
    balance: balances.sbd ?? 0,
    needed: 0.15,
    commitable: Math.round((balances.sbd ?? 0) * 0.9 * 1000) / 1000,
    state: (balances.sbd ?? 0) * 0.9 >= 0.15 ? ("ARMED" as const) : ("WAIT" as const),
  };

  // פדיון TRON
  const redemption = {
    outboxTrx: tron.outbox,
    custodyTrx: tron.custody,
    sendThresholdTrx: 1.05,
    verdict: ((): "WAIT" | "GO" | "UNKNOWN" => {
      if (tron.outbox == null) return "UNKNOWN";
      return tron.outbox >= 1.05 ? "GO" : "WAIT";
    })(),
    detail:
      tron.outbox == null
        ? "trongrid לא ענה — נמדד בכנות כלא-ידוע"
        : tron.outbox >= 1.05
          ? `הסף עבר (${tron.outbox.toFixed(6)} TRX ≥ 1.05) — שער השידור פתוח`
          : `ממתין: ${tron.outbox.toFixed(3)} TRX מתוך 1.05 TRX (חסר ${(1.05 - tron.outbox).toFixed(3)})`,
  };

  // אבחנת הכסף שנכנס — התשובה לשאלת המפעיל
  const oldestOrder = orders.reduce<string | null>(
    (oldest, o) => (!oldest || o.created < oldest ? o.created : oldest),
    null,
  );
  const staleHours =
    oldestOrder != null ? Math.round((Date.now() - new Date(oldestOrder + "Z").getTime()) / 3_600_000) : null;
  const diagnosis = {
    enteredSteem: Math.round((deployedSteem + idleSteem) * 1000) / 1000,
    whereItSits: { inOrders: deployedSteem, liquid: idleSteem, sbd: balances.sbd ?? 0 },
    staleHours,
    note:
      orders.length === 0 && idleSteem > 1
        ? "כל הדלק נזיל — הסולם ריק; המוביל אמור להציב אותו במחזור הקרוב"
        : orders.length > 0 && idleSteem > 1
          ? `הסולם פועל אך ${idleSteem.toFixed(3)} STEEM נזילים ממתינים לפריסה`
          : orders.length > 0
            ? `הדלק פרוס בסולם · גיל הפקודה הוותיקה ${staleHours ?? "?"} שעות`
            : "אין פקודות פתוחות",
  };

  // הזדמנויות חיות — ציד מתמשך, לא המתנה סבילה
  const opportunities: Opportunity[] = [];
  if (parity != null && bestBid != null) {
    const distBps = Math.round((parity / bestBid - 1) * 10_000);
    opportunities.push({
      id: "ladder-fill",
      title: "מלכודת הפאריטה — הסולם ממתין בקו",
      state: distBps <= 0 ? "FLOWING" : distBps <= 300 ? "ARMED" : "HUNTING",
      detail:
        distBps <= 0
          ? `הביד חצה את הפאריטה — רמה-1 מתמלאת עכשיו (${bestBid.toFixed(4)} ≥ ${parity.toFixed(4)})`
          : `הביד החי ${bestBid.toFixed(4)} רחוק ${distBps}bps מהקו (${parity.toFixed(4)}). הסולם צד: הוא אינו זז מהקו — השוק חייב לשלם ערך-חוץ כדי לגעת בכסף. כל ביד שיחצה נתפס מיד`,
      number: `${distBps}bps`,
    });
  }
  opportunities.push({
    id: "sbd-arming",
    title: "חימוש צד-הקנייה (SBD)",
    state: sbdArming.state === "ARMED" ? "ARMED" : "BLOCKED",
    detail:
      sbdArming.state === "ARMED"
        ? "מלאי ה-SBD חמוש — סולם הקנייה מתחת לפאריטה יוצב במילוי הבא"
        : "מילוי הסולם יזרים SBD; כשהקופה תעבור 0.15 — צד-הקנייה מתחת-לפאריטה יחומש (כל קנייה מתחת לקו = עודף נמדד). השער הזה נפתח רק ממילוי אמיתי — לא ממכירה מתחת לערך",
    number: `${sbdArming.commitable.toFixed(3)}/${sbdArming.needed}`,
  });
  if (powerdown.nextPayment) {
    const hours = Math.max(0, Math.round((new Date(powerdown.nextPayment).getTime() - Date.now()) / 3_600_000));
    opportunities.push({
      id: "fuel-in",
      title: "נחיתת דלק הבאה (פאוורדאון)",
      state: hours <= 2 ? "ARMED" : "HUNTING",
      detail: `תשלום של ~${powerdown.weeklySteem ?? "?"} STEEM צפוי ב-${powerdown.nextPayment.slice(0, 16).replace("T", " ")}Z — המוביל פורש אותו בסולם בתוך מחזור אחד מהנחיתה (חוק 4)`,
      number: `${hours}ש׳`,
    });
  }
  opportunities.push({
    id: "tron-redemption",
    title: "שער הפדיון (TRON)",
    state: redemption.verdict === "GO" ? "FLOWING" : "BLOCKED",
    detail: redemption.detail + " · המשמרת מגבהת את ה-WTRX ואינה נגעת",
    number: redemption.outboxTrx != null ? `${redemption.outboxTrx.toFixed(3)}/1.05 TRX` : null,
  });
  if (spreadBps != null) {
    opportunities.push({
      id: "spread",
      title: "רוחב השוק הפנימי",
      state: spreadBps <= 150 ? "ARMED" : "HUNTING",
      detail: `ביד ${bestBid?.toFixed(4)} / אסק ${bestAsk?.toFixed(4)} — ספרד ${spreadBps}bps. ספרד צר מגדיל סיכוי שביד יחצה את הקו`,
      number: `${spreadBps}bps`,
    });
  }

  const ladder: LadderLevel[] = [0, 100, 200].map((premiumBps, i) => ({
    level: (i + 1) as 1 | 2 | 3,
    premiumBps,
    price: parity != null ? Math.round(parity * (1 + premiumBps / 10_000) * 1e6) / 1e6 : null,
  }));

  return {
    ok: down.length === 0,
    at: new Date().toISOString(),
    account: ACCOUNT,
    marks: {
      steemUsd: marks?.steemUsd ?? null,
      sbdUsd: marks?.sbdUsd ?? null,
      trxUsd: marks?.trxUsd ?? null,
      parity,
      sources: marks?.sources ?? {},
    },
    balances,
    book: { bids, asks, bestBid, bestAsk, mid, spreadBps },
    orders,
    ourBids,
    deployedSteem,
    idleSteem,
    ladder,
    powerdown,
    fills,
    sbdArming,
    redemption,
    diagnosis,
    opportunities,
    daemon,
    doctrine: [
      "רצפת-פאריטה קשיחה: שום מכירה מתחת לערך-ה-USD החיצוני של STEEM — נאכפת בקוד; בלי שער חי אין פעולה (סירוב-כנה).",
      "הסולם צד את השוק, לא להפך: שלוש רמות על קו הפאריטה ומעליו; השוק משלם את הערך החיצוני או שהכסף נשאר שלנו.",
      "דינמיות = מעקב, לא המתנה: הפאריטה נמדדת כל מחזור; זזה >50bps — הסולם נגרר אליה; נחיתת דלק — מוצבת בתוך דקה.",
      "כל פעולה עם קבלה: txid לכל cancel ולכל create; הספר הפתוח של השרשרת הוא השופט.",
      "המפתח בזיכרון-ההרצה בלבד, מאומת ביט-מול-ביט מול הרשות החיה — ואף פעם לא נכתב.",
      "שער-העסקאות (R97): אוטונומיה מלאה מתחת ל-$100 — מעליו, שום פעולה לא רצה בלי אישור המפעיל; ה-USD נמדד חי בזמן ההחלטה.",
    ],
    down: down.length ? down : undefined,
  };
}

// ── POST — העורק: reprice אוטונומי ──────────────────────────────────

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function readOwnerKey(): { account: string; password: string } | null {
  try {
    const raw = fs.readFileSync(OWNER_FILE, "utf8").trim();
    const [account, password] = raw.split(/\r?\n/).map((x) => x.trim());
    if (!account || !password) return null;
    return { account, password };
  } catch {
    return null;
  }
}

function appendReceipt(receipt: MoverReceipt): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const history = readHistory();
    // עדכון-במקום: persist נקודתי אחרי כל פעולה אסור שייצור כפילויות —
    // קבלה חיה אחת לכל פעולה, עם מזהה הריצה (at). קריאה חוזרת על אותה
    // קבלה מעדכנת את השורה האחרונה במקום לדחוף חדשה.
    const lastIdx = history.length - 1;
    if (lastIdx >= 0 && history[lastIdx].at === receipt.at) {
      history[lastIdx] = receipt;
    } else {
      history.push(receipt);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-200), null, 2) + "\n");
    let state: any = {};
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
      /* קובץ חדש */
    }
    state.lastReceipt = receipt;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  } catch {
    /* הקבלה החיה היא השרשרת — כשל כתיבה אינו עוצר תשובה */
  }
}

const ceil3 = (x: number) => Math.ceil(x * 1000) / 1000;

export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return bad("גוף הבקשה אינו JSON");
  }
  // R97: reprice (סולם המכירה) · arm-buy (סולם הקנייה — המיקרו-גריד נעשה דו-צדדי)
  const action = payload?.action === "arm-buy" ? "arm-buy" : payload?.action === "reprice" ? "reprice" : null;
  if (!action) {
    return bad("פעולה לא מוכרת — נתמכות: reprice · arm-buy");
  }
  const reason = typeof payload.reason === "string" ? payload.reason.slice(0, 200) : "manual";

  // המפתח: בזיכרון-ההרצה בלבד
  const ownerKey = readOwnerKey();
  if (!ownerKey) {
    return bad("מפתח-האב אינו בסנדבוקס — העורק חסום בכנות. העלה את הסיסמה (upload) או הפעל מהענן.", 409, { code: "NO-KEY" });
  }

  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  const steem = nodeRequire("steem");
  steem.api.setOptions({ url: "https://api.steemit.com" });

  // תיקון R94 (נתפס חי ב-dev.log כ-unhandledRejection ×6): steem-js מחזיר
  // promise פנימי גם במצב-callback — דחייתו (אותה שגיאת-RPC שכבר מטופלת
  // ב-callback שלנו) נותרת ללא מטפל ומפיצה unhandledRejection. ה-callback
  // הוא מקור-האמת — מה שמוחזר מהקריאה נבלע במפורש.
  const quiet = (ret: unknown): void => {
    if (ret && typeof (ret as { catch?: unknown }).catch === "function") {
      (ret as Promise<unknown>).catch(() => {});
    }
  };

  // מדידה חיה טרייה — לא מהמטמון: הפעולה מחליטה על סולם עכשיו
  const [accts, openOrders, marks] = await Promise.all([
    new Promise<any[]>((resolve, reject) =>
      quiet(
        steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
          err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
        ),
      ),
    ),
    new Promise<any[]>((resolve, reject) =>
      quiet(
        steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
          err ? reject(err) : resolve(res ?? []),
        ),
      ),
    ),
    marksSide(),
  ]).catch((e) => {
    throw Object.assign(new Error(`מדידה חיה נכשלה: ${String(e.message).slice(0, 120)}`), { statusCode: 502 });
  });

  // דוקטרינת R75: המפתח מכריז את החותם — אימות ביט-מול-ביט לפני כל שידור
  const wif = steem.auth.toWif(ownerKey.account, ownerKey.password, "active");
  const liveActive = accts?.[0]?.active?.key_auths?.[0]?.[0];
  const derivedPub = steem.auth.wifToPublic(wif);
  if (!liveActive || derivedPub !== liveActive) {
    return bad("המפתח שנגזר אינו תואם את רשות-ה-active החיה — שום דבר לא שודר. זו סירוב-כנה.", 409, { code: "KEY-MISMATCH" });
  }

  // חוק 1: בלי פאריטה חיה — אין פעולה (אין שער, אין מסחר)
  const parity = marks.parity;
  if (parity == null || parity <= 0) {
    return bad("הפאריטה לא נמדדה חי (STEEM/SBD) — הרצפה אינה ניתנת לאכיפה, לכן שום פקודה לא הוצבה. סירוב-כנה.", 409, { code: "NO-PARITY" });
  }

  const account = accts[0];

  // R97 — הפרדת צדדים בספר הפתוח: base=STEEM → מכירה; base=SBD → קנייה.
  // עד R97 היו רק מכירות ולכן סכום for_sale היה תמיד STEEM; מעתה כל מנה
  // נספרת בנכס שלה — אחרת דלק המכירה היה מונה SBD כ-STEEM (באג מבני מונע).
  const allOpen = openOrders as any[];
  const sellOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"));
  const bidOpen = allOpen.filter((o) => String(o.sell_price?.base ?? "").trim().endsWith("SBD"));

  // R97 — שער-העסקאות: מפעיל שהוציא את הפעולה = השער עצמו; הדיבון אוטונומי
  // רק מתחת לסף (הוראת המפעיל: "רק במקרים של עסקאות באמת גדולות $100 ומעלה")
  const session = operatorFromRequest(req);
  const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";

  const liquid = parseFloat(account.balance);
  const inOrders = sellOpen.reduce((s, o) => s + Number(o.for_sale) / 1000, 0); // מכירות בלבד (R97)
  const totalFuel = Math.round((liquid + inOrders) * 1000) / 1000;
  const sbdLiquid = parseFloat(account.sbd_balance);
  const sbdCommitable = Math.floor(sbdLiquid * 0.9 * 1000) / 1000; // 0.9 — אותו פקטור-מחויבות כמו sbdArming
  const premiums = [0, 100, 200]; // סולם המכירה: parity, +1%, +2% (חוק 2)
  const perLevel = Math.floor(totalFuel * 1000 / 3) / 1000;
  const perBid = Math.floor(sbdCommitable * 1000 / 3) / 1000;
  const BID_OFFSETS_BPS = [100, 200, 300]; // סולם הקנייה: ‎-1%/-2%/-3% מתחת לקו (O1)

  // בדיקות-חוץ לפי פעולה — לפני השער, כדי שלא לייצר רעש בספר ההכרעות
  if (action === "reprice" && totalFuel < 0.004) {
    return bad(`אין דלק לפריסה (נזיל ${liquid.toFixed(3)} + בפקודות ${inOrders.toFixed(3)}) — אין פעולה`, 409, { code: "NO-FUEL" });
  }
  if (action === "reprice" && perLevel < 0.001) {
    return bad("הדלק קטן מרמה אחת — אין פעולה", 409, { code: "TOO-SMALL" });
  }
  if (action === "arm-buy" && sbdCommitable < 0.15) {
    return bad(`אין SBD חמוש לסולם קנייה (${sbdCommitable.toFixed(3)} < 0.15) — החימוש נפתח רק ממילוי אמיתי`, 409, { code: "NO-SBD" });
  }
  if (action === "arm-buy" && perBid < 0.05) {
    return bad("רמת קנייה קטנה מ-0.05 SBD — אין פעולה", 409, { code: "TOO-SMALL" });
  }

  // ── שער-העסקאות (R97): הערכת-USD חיה בזמן ההחלטה, לפני כל נגיעה בכסף ──
  const gateUsd =
    action === "arm-buy"
      ? marks.sbdUsd != null && marks.sbdUsd > 0
        ? Math.round(sbdCommitable * marks.sbdUsd * 100) / 100
        : null
      : marks.steemUsd != null && marks.steemUsd > 0
        ? Math.round(totalFuel * marks.steemUsd * 100) / 100
        : null;
  const gate = await evaluateGate({
    source: "money-mover",
    action,
    title:
      action === "arm-buy"
        ? `arm-buy — סולם קנייה מתחת לפאריטה · ${sbdCommitable} SBD`
        : `reprice — סולם 3 רמות מעל הפאריטה · ${totalFuel} STEEM`,
    payload:
      action === "arm-buy"
        ? { sbdCommitable, parity, offsetsBps: BID_OFFSETS_BPS, reason }
        : { liquid, inOrders, totalFuel, parity, premiums, reason },
    usdValue: gateUsd,
    usdBasis:
      gateUsd != null
        ? action === "arm-buy"
          ? `${sbdCommitable} SBD × $${marks.sbdUsd} (${marks.sources.sbd ?? "sbd-mark"})`
          : `${totalFuel} STEEM × $${marks.steemUsd} (${marks.sources.steem ?? "steem-mark"})`
        : "usd-mark לא נמדד חי",
    issuedBy,
    reason,
  });
  if (gate.verdict === "REFUSED") {
    return bad("USD לא נמדד חי — שער-העסקאות מסרב בכנות: אין הערכת-ערך, אין פעולה (אין שער, אין מסחר)", 409, { code: "NO-USD-MARK" });
  }
  if (gate.verdict === "QUEUED") {
    return NextResponse.json(
      {
        ok: false,
        code: "GATE-QUEUED",
        gateId: gate.id,
        usdValue: gate.usdValue,
        threshold: gate.threshold,
        error: "GATE-QUEUED",
        he: `הפעולה (${gate.usdValue?.toFixed(2)}$) מעל סף האוטונומיה $${gate.threshold} — הועברה לתור אישור המפעיל בשער העסקאות. שום כסף לא זז.`,
      },
      { status: 403 },
    );
  }

  const expiration = new Date(Date.now() + 27 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "");
  const receipt: MoverReceipt = {
    at: new Date().toISOString(),
    kind: action === "arm-buy" ? "ARM-BUY" : inOrders === 0 ? "FUEL-IN" : "REPRICE",
    reason,
    parity,
    cancelled: [],
    placed: [],
  };
  const errors: string[] = [];
  const noteError = (msg: string) => {
    errors.push(msg);
    receipt.error = errors.slice(-3).join(" | ");
  };

  const broadcastOp = <T,>(fn: (cb: (err: Error | null, res: T) => void) => unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      // לקח-הריצות (נמדד 00:43–00:50Z): שידור מתקבל בשרשרת ב-~7-9 שנ׳
      // אך אישור ה-callback של steem-js חוזר אחרי 20-30 שנ׳. תקרת-זמן
      // לכל שידור: 45 שנ׳ — והשופט הסופי הוא השרשרת עצמה (ה-verify
      // בסוף הקבלה מודד מה באמת פתוח שם, לא מה שהאישורים אמרו).
      const timer = setTimeout(() => reject(new Error("broadcast-timeout-45s")), 45_000);
      quiet(
        fn((err, res) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve(res);
        }),
      );
    });

  // לקח-הריצה-הראשונה (נמדד 00:38–00:40Z): קבלה שנכתבת רק בסוף מתאפסת אם
  // ה-handler נקטע. מעתה — הקבלה מתעדכנת בקובץ אחרי כל פעולה בודדת:
  // גם אם העולם ייפול באמצע, מה שקרה על השרשרת מתועד.
  const persist = () => appendReceipt(receipt);

  try {
    if (action === "arm-buy") {
      // ═ ARM-BUY — צד הקנייה של המיקרו-גריד (R97 · הזדמנות O1) ═══════
      // סולם שלוש רמות מתחת לפאריטה (‎-1%/-2%/-3%): כל קנייה מתחת לקו היא
      // עודף נמדד מול ערך-חוץ. הגג נאכף בקוד: לעולם לא קונים מעל פאריטה.
      // שוק פנימי שנסחר מתחת לקו ימלא את ההצעות מיד — במחיר העומד,
      // לא במחיר ההצעה; השרשרת היא השופטת.
      const bidCancelResults = await Promise.allSettled(
        bidOpen.map((o) =>
          broadcastOp<any>((cb) => steem.broadcast.limitOrderCancel(wif, ownerKey.account, o.orderid, cb))
            .then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
        ),
      );
      bidOpen.forEach((o, i) => {
        const r = bidCancelResults[i];
        if (r.status === "fulfilled") {
          receipt.cancelled.push(r.value);
        } else {
          receipt.cancelled.push({ orderid: o.orderid, txid: null });
          noteError(`cancel-bid ${o.orderid}: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 100)}`);
        }
      });
      persist();

      // המתנה שהביטולים ייעלמו מהספר (לקח R94 — ביטול ששודר ≠ ביטול שנכלל)
      const bidCancelledIds = new Set(bidOpen.map((o) => Number(o.orderid)));
      if (bidCancelledIds.size > 0) {
        for (let poll = 0; poll < 4; poll++) {
          try {
            const os = await new Promise<any[]>((resolve, reject) =>
              quiet(
                steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                  err ? reject(err) : resolve(res ?? []),
                ),
              ),
            );
            const stillThere = os.some((o: any) => bidCancelledIds.has(Number(o.orderid)));
            if (!stillThere) break;
          } catch {
            /* סקר שנכשל לא עוצר — השופט הסופי הוא ה-verify בסוף */
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      // הצבת סולם הקנייה — orderid ברווח 9X (מכירות = 01/02/03)
      const orderDay = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      for (let i = 0; i < BID_OFFSETS_BPS.length; i++) {
        const price = parity * (1 - BID_OFFSETS_BPS[i] / 10_000);
        const sbd = perBid;
        const steemOut = Math.floor((sbd / price) * 1000) / 1000; // עיגול-מטה: אף פעם לא מעל המחיר
        const effPrice = steemOut > 0 ? sbd / steemOut : 0;
        if (effPrice >= parity) {
          noteError(`bid ${i + 1}: מחיר יעיל ${effPrice.toFixed(6)} אינו מתחת לפאריטה — לא הוצב (חוק הגג)`);
          continue;
        }
        const orderid = Number(`${orderDay}9${i + 1}`);
        try {
          const res = await broadcastOp<any>((cb) =>
            steem.broadcast.limitOrderCreate(
              wif,
              ownerKey.account,
              orderid,
              `${sbd.toFixed(3)} SBD`,
              `${steemOut.toFixed(3)} STEEM`,
              false,
              expiration,
              [],
              cb,
            ),
          );
          receipt.placed.push({ orderid, sell: sbd, receive: steemOut, price: Math.round(effPrice * 1e6) / 1e6, txid: res?.id ?? null });
        } catch (e) {
          // לקח R87: timeout ≠ כישלון — השרשרת היא השופטת. סקר לפי orderid.
          let landed = false;
          for (let poll = 0; poll < 3 && !landed; poll++) {
            await new Promise((r) => setTimeout(r, 8000));
            try {
              const os = await new Promise<any[]>((resolve, reject) =>
                quiet(
                  steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                    err ? reject(err) : resolve(res ?? []),
                  ),
                ),
              );
              const found = os.find((o: any) => Number(o.orderid) === orderid);
              if (found) {
                landed = true;
                receipt.placed.push({ orderid, sell: sbd, receive: steemOut, price: Math.round(effPrice * 1e6) / 1e6, txid: null, confirmedBy: "chain-read" });
              }
            } catch {
              /* סקר שנכשל לא מזיז כלום — השופט הסופי הוא ה-verify בסוף */
            }
          }
          if (!landed) noteError(`place bid ${i + 1}: ${String((e as Error).message).slice(0, 100)}`);
        }
        persist();
        await new Promise((r) => setTimeout(r, 400)); // ריווח בין שידורים — נחמד לצומת
      }

      // אימות-סוף מהשרשרת — השופט
      let bidVerify: { ordersNow: number; deployedNow: number; bidsNow?: number } | null = null;
      try {
        const after = await new Promise<any[]>((resolve, reject) =>
          quiet(
            steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
              err ? reject(err) : resolve(res ?? []),
            ),
          ),
        );
        const sells = after.filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"));
        const bids = after.filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("SBD"));
        bidVerify = {
          ordersNow: after.length,
          deployedNow: Math.round(sells.reduce((s: number, o: any) => s + Number(o.for_sale) / 1000, 0) * 1000) / 1000,
          bidsNow: bids.length,
        };
      } catch {
        /* אימות הוא שכבת-עדות — כשלו אינו מזים את הקבלה */
      }
      receipt.verify = bidVerify ?? undefined;
      persist();
      swrInvalidate(SWR_KEY);
      await settleGate(
        gate.id,
        "EXECUTED",
        issuedBy === "operator" ? "operator" : "policy:autonomous",
        { placed: receipt.placed.length, cancelled: receipt.cancelled.length, verify: bidVerify, gateUsd },
      );
      const bidsOk = (bidVerify?.bidsNow ?? 0) > 0;
      return NextResponse.json({
        ok: bidsOk || receipt.placed.length > 0,
        receipt,
        verify: bidVerify,
        he: bidsOk
          ? `סולם הקנייה חי בשרשרת (נמדד): ${bidVerify?.bidsNow} הצעות · ${sbdCommitable} SBD מחויבות מתחת לקו ${parity.toFixed(4)} · בוטלו ${receipt.cancelled.length}`
          : `הוצבו ${receipt.placed.length} הצעות קנייה · בוטלו ${receipt.cancelled.length} · אימות שרשרת לא נקרא`,
      });
    }

    // ═ REPRICE — סולם המכירה (R81; R97: ביטול מכירות בלבד — הקניות לא נפגעות) ═
    // א. ביטול פקודות המכירה הקיימות — במקביל (עצמאיות; הכסף חוזר לנזיל)
    const cancelResults = await Promise.allSettled(
      sellOpen.map((o) =>
        broadcastOp<any>((cb) => steem.broadcast.limitOrderCancel(wif, ownerKey.account, o.orderid, cb))
          .then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
      ),
    );
    sellOpen.forEach((o, i) => {
      const r = cancelResults[i];
      if (r.status === "fulfilled") {
        receipt.cancelled.push(r.value);
      } else {
        receipt.cancelled.push({ orderid: o.orderid, txid: null });
        noteError(`cancel ${o.orderid}: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 100)}`);
      }
    });
    persist();

    // תיקון R94 — שורש מחלקת "אין די כספים" שנמדדה ב-dev.log (6 דחיות):
    // ביטול ששודר אינו ביטול שנכלל בבלוק. השרשרת דוחה הצבה חדשה כל
    // עוד הכסף נעול בפקודות הישנות. תנאי-המתנה: ה-orderid שבוטלו
    // נעלמים מ-getOpenOrders (עד 4 סקרים × 5ש׳, קריאה בלבד) — ורק
    // אז מוצב הסולם. סקר שנכשל לא עוצר — הסקר הבא יגיד את האמת.
    const cancelledIds = new Set(sellOpen.map((o) => Number(o.orderid)));
    if (cancelledIds.size > 0) {
      for (let poll = 0; poll < 4; poll++) {
        try {
          const os = await new Promise<any[]>((resolve, reject) =>
            quiet(
              steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                err ? reject(err) : resolve(res ?? []),
              ),
            ),
          );
          const stillThere = os.some((o: any) => cancelledIds.has(Number(o.orderid)));
          if (!stillThere) break;
        } catch {
          /* סקר שנכשל לא עוצר — השופט הסופי הוא ה-verify בסוף */
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    // ב. הצבת הסולם החדש — רצפה נאכפת: כל מחיר ≥ פאריטה
    const orderDay = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    for (let i = 0; i < premiums.length; i++) {
      const price = parity * (1 + premiums[i] / 10_000);
      const sell = perLevel;
      const receive = ceil3(sell * price); // עיגול-מעלה: היחס לעולם לא יורד מהמחיר
      const effPrice = receive / sell;
      if (effPrice < parity * 0.999) {
        // חוק 1 — אם העיגול הוריד מתחת לקו (לא אמור לקרות), מוותרים על הצבה זו בכנות
        noteError(`level ${i + 1}: מחיר יעיל ${effPrice.toFixed(6)} מתחת לרצפה — לא הוצב`);
        continue;
      }
      const orderid = Number(`${orderDay}${String(i + 1).padStart(2, "0")}`);
      try {
        const res = await broadcastOp<any>((cb) =>
          steem.broadcast.limitOrderCreate(
            wif,
            ownerKey.account,
            orderid,
            `${sell.toFixed(3)} STEEM`,
            `${receive.toFixed(3)} SBD`,
            false,
            expiration,
            [],
            cb,
          ),
        );
        receipt.placed.push({ orderid, sell, receive, price: Math.round(effPrice * 1e6) / 1e6, txid: res?.id ?? null });
      } catch (e) {
        // R87: שידור שעבר את התקרה אינו בהכרח כישלון — השרשרת היא השופטת.
        // נמדד חי (03:47–03:49Z): הפקודות נוחתות על השרשרת תוך 15–45ש׳
        // בעוד ה-callback של steem-js מתעכב מעבר לתקרת-ה-45ש׳. לכן אחרי
        // timeout — סקר-שרשרת קצר לפי orderid: נחתה = מתועדת כהוצבה-ואומתה;
        // לא נמצאה אחרי 3 סקרים = שגיאה כנה כמקודם. הכסף לא משנה ידיים
        // בסקר — הוא קריאה בלבד, אותו מקור שה-verify בסוף כבר קורא.
        let landed = false;
        for (let poll = 0; poll < 3 && !landed; poll++) {
          await new Promise((r) => setTimeout(r, 8000));
          try {
            const os = await new Promise<any[]>((resolve, reject) =>
              quiet(
                steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
                  err ? reject(err) : resolve(res ?? []),
                ),
              ),
            );
            const found = os.find((o: any) => Number(o.orderid) === orderid);
            if (found) {
              landed = true;
              receipt.placed.push({
                orderid,
                sell,
                receive,
                price: Math.round(effPrice * 1e6) / 1e6,
                txid: null,
                confirmedBy: "chain-read",
              });
            }
          } catch {
            /* סקר שנכשל לא מזיז כלום — השופט הסופי הוא ה-verify בסוף */
          }
        }
        if (!landed) noteError(`place level ${i + 1}: ${String((e as Error).message).slice(0, 100)}`);
      }
      persist(); // קבלה אחרי כל הצבה — לא רק בסוף (לקח הריצה הראשונה)
      await new Promise((r) => setTimeout(r, 400)); // ריווח בין שידורים — נחמד לצומת
    }

    // אימות-סוף מהשרשרת — השופט. אישורי-שידור יכולים להתעכב מעבר לתקרה
    // בזמן שהשרשרת כבר קיבלה את הפקודה (נמדד) — לכן קריטריון ההצלחה
    // הוא מה שפתוח שם באמת, לא מונה האישורים.
    let verify: { ordersNow: number; deployedNow: number; bidsNow?: number } | null = null;
    try {
      const after = await new Promise<any[]>((resolve, reject) =>
        quiet(
          steem.api.getOpenOrders(ownerKey.account, (err: Error | null, res: any[]) =>
            err ? reject(err) : resolve(res ?? []),
          ),
        ),
      );
      // R97: deployedNow סופר מכירות בלבד (STEEM); הצעות הקנייה נספרות בנפרד
      const sells = after.filter((o: any) => String(o.sell_price?.base ?? "").trim().endsWith("STEEM"));
      verify = {
        ordersNow: after.length,
        deployedNow: Math.round(sells.reduce((s: number, o: any) => s + Number(o.for_sale) / 1000, 0) * 1000) / 1000,
        bidsNow: after.length - sells.length,
      };
    } catch {
      /* אימות הוא שכבת-עדות — כשלו אינו מזים את הקבלה */
    }
    receipt.verify = verify ?? undefined;
    persist();
    swrInvalidate(SWR_KEY);
    await settleGate(
      gate.id,
      "EXECUTED",
      issuedBy === "operator" ? "operator" : "policy:autonomous",
      { placed: receipt.placed.length, cancelled: receipt.cancelled.length, verify, gateUsd },
    );
    const chainOk = (verify?.deployedNow ?? 0) > 0;
    return NextResponse.json({
      ok: chainOk || receipt.placed.length > 0,
      receipt,
      verify,
      he: chainOk
        ? `הסולם חי בשרשרת (נמדד): ${verify?.ordersNow} פקודות / ${verify?.deployedNow} STEEM · פאריטה ${parity.toFixed(4)}–${(parity * 1.02).toFixed(4)} · בוטלו ${receipt.cancelled.length}`
        : `הוצבו ${receipt.placed.length} רמות · בוטלו ${receipt.cancelled.length} · אימוש שרשרת לא נקרא`,
    });
  } catch (e) {
    receipt.error = String((e as Error).message).slice(0, 300);
    appendReceipt(receipt);
    return bad(`הפעולה נכשלה בכנות: ${receipt.error.slice(0, 160)}`, 502, { code: "EXECUTE-FAILED", receipt });
  }
}
