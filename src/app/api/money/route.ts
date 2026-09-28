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
  kind: "REPRICE" | "DEPLOY" | "FUEL-IN" | "ARM-BUY" | "STOCK-SBD";
  reason: string;
  parity: number | null;
  cancelled: Array<{ orderid: number; txid: string | null }>;
  placed: Array<{ orderid: number; sell: number; receive: number; price: number; txid: string | null; confirmedBy?: string }>;
  /** אימות-סוף מהשרשרת — השופט: מה באמת פתוח שם אחרי הפעולה */
  verify?:
    | { ordersNow: number; deployedNow: number; bidsNow?: number }
    | { sbdNow: number; gapClosed: boolean; premiumPaidBps: number | null }
    | null;
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
  keyPresent?: boolean; // r133 · D-021: בוליאן-נוכחות בלבד, אפס חשיפת-סוד
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
  valueFloor: {
    parity: number | null;
    asksBelowParity: number;
    steemBelowParity: number;
    worstBps: number;
    maxDriftLossSbd: number | null;
    maxDriftLossUsd: number | null;
    state: "HELD" | "DRIFT" | "UNMEASURED";
    noteHe: string;
  };
  ladder: LadderLevel[];
  powerdown: {
    active: boolean | null;
    weeklySteem: number | null;
    nextPayment: string | null;
    paymentsLeft: number | null;
    totalRemainingSteem: number | null;
  };
  fills: FillReceipt[];
  fillsWindow24h: number;
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
  /** נפל רק כשמשהו נפל בפועל — במחזור נקי השדה לא נשלח */
  down?: string[];
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

// ── רב-צמתיות (R106): מדידת-הפאריטה היא הרצפה לחוק-1 — צומת בודד שנחנק
// משאיר את הסולם עיוור (נמדד חי 00:53Z: REPRICE-FAIL "הפאריטה לא נמדדה
// חי" למשך מחזור שלם). מעתה כל קריאת-מדידה מנסה את רשימת-הצמתים
// בסדר, עד שאחת עונה. רשימת-הצמתים — מקור אחד לכל המערכת (graphene).
import { STEEM_RPC_NODES } from "@/lib/weave/graphene";

async function steemRpcOnce(node: string, method: string, params: unknown[], timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(node, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`http ${res.status} @ ${node}`);
    const j = await res.json();
    if (j?.error) throw new Error(String(j.error.message ?? "rpc-error") + ` @ ${node}`);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function steemRpc(method: string, params: unknown[]): Promise<any> {
  // סדר הניסיון: הצומת הרשמי ראשון; בכשל — המשך הרשימה. הקבלה כנה:
  // מקור-ההצלחה לא נרשם כטענה אלא נמדד בהנפקת השגיאה בלבד.
  let lastErr: unknown = null;
  for (let i = 0; i < STEEM_RPC_NODES.length; i++) {
    try {
      return await steemRpcOnce(STEEM_RPC_NODES[i], method, params, i === 0 ? 12_000 : 10_000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all-steem-nodes-down");
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

async function fillsSide(): Promise<{ recent: FillReceipt[]; window24h: number }> {
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
    out.reverse(); // חדשים לפני ישנים
    // R128 — ספירת חלון-24ש' מהסריקה המלאה (עד 100 פעולות אחרונות), לפני קיצוץ התצוגה.
    // רייל R103 (מילוי→SAOS→גלגול) נשען עיקרו על השדה הזה; עד כאן הדאימון קרא שדה שלא היה קיים בתשובה.
    const dayAgo = Date.now() - 86_400_000;
    const window24h = out.filter((f) => new Date(f.at).getTime() >= dayAgo).length;
    return { recent: out.slice(0, 12), window24h };
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

// sense מייצר את גוף ההמתנה בלבד — את שדות המטמון (cached/stale/…)
// מוסיף ה-GET מעל התוצאה; לכן ההבטחה כאן היא ה-Omit המדויק.
async function sense(): Promise<Omit<MoneySense, "cached" | "stale" | "cacheAgeSec" | "refreshing">> {
  const down: string[] = [];

  const [steemRes, fillsInfo, marks, tron, daemon] = await Promise.all([
    steemSide().catch((e) => {
      down.push(`steem: ${String(e.message).slice(0, 50)}`);
      return null;
    }),
    fillsSide().catch((e) => {
      down.push(`fills: ${String(e.message).slice(0, 50)}`);
      return { recent: [] as FillReceipt[], window24h: 0 };
    }),
    marksSide().catch((e) => {
      down.push(`marks: ${String(e.message).slice(0, 50)}`);
      return null;
    }),
    tronSide().catch((e) => {
      down.push(`tron: ${String(e.message).slice(0, 50)}`);
      return { outbox: null as number | null, custody: null as number | null };
    }),
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

  // r134 · רצפת-הערך — צבירת-אמת של דריפת-הרצפה: פקודות-מכירה שלנו שנשארו
  // מתחת לפאריטה החיצוני אחרי שהפאריטה זז (החוק נאכף בעת-הצבה; בלי מפתח
  // הגרירה מושהית-בכנות — LANE-BLOCKED D-021 — והחשיפה נמדדת ומוצגת).
  const belowParity = orders.filter((o) => o.vsParityBps != null && o.vsParityBps < 0);
  const maxDriftLossSbd =
    parity != null
      ? Math.round(belowParity.reduce((s, o) => s + o.amount * (parity - o.price), 0) * 10_000) / 10_000
      : null;
  const valueFloor = {
    parity: parity != null ? Math.round(parity * 1e6) / 1e6 : null,
    asksBelowParity: belowParity.length,
    steemBelowParity: Math.round(belowParity.reduce((s, o) => s + o.amount, 0) * 1000) / 1000,
    worstBps: belowParity.length > 0 ? Math.min(...belowParity.map((o) => o.vsParityBps as number)) : 0,
    maxDriftLossSbd,
    maxDriftLossUsd: maxDriftLossSbd != null && marks?.sbdUsd != null ? Math.round(maxDriftLossSbd * marks.sbdUsd * 10_000) / 10_000 : null,
    state: parity == null ? ("UNMEASURED" as const) : belowParity.length > 0 ? ("DRIFT" as const) : ("HELD" as const),
    noteHe:
      parity == null
        ? "אין פאריטה חיה — רצפת-הערך לא נמדדת כרגע (כנות, לא הנחה)"
        : belowParity.length > 0
          ? `דריפת-רצפה: ${belowParity.length} פקודות נשארו מתחת לפאריטה החיצוני אחרי שהוא זז — החוק ייאכף בגרירת-הסולם בחזרת-מפתח (X-1); עד אז החשיפה מדודה כאן`
          : "הרצפה מוחזקת: אף פקודת-מכירה שלנו לא מתחת לערך-החוץ",
  };

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
    // r133 · D-021: נוכחות-מפתח כבוליאני בלבד (בלי שום חשיפת-סוד) —
    // מאפשר למוביל-הסנדבוקס להבחין LANE-BLOCKED מול כישלון-אמת
    keyPresent: readOwnerKey() != null,
    book: { bids, asks, bestBid, bestAsk, mid, spreadBps },
    orders,
    ourBids,
    deployedSteem,
    idleSteem,
    valueFloor,
    ladder,
    powerdown,
    fills: fillsInfo.recent,
    fillsWindow24h: fillsInfo.window24h,
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

// r125a · חוק הראיה: הקבלה החיה היא השרשרת — כשל כתיבה אינו מפיל פעולת-
// שרשרת שכבר בוצעה (הקבלה היא ראיה, לא הפעולה). אבל הוא גם לא נבלע:
// התוצאה חוזרת לקורא ומתועדת בתשובה (receiptPersisted:false) — אובדן-
// הראיה מתועד בגלוי, הפעולה האמיתית מדווחת אמת.
function appendReceipt(receipt: MoverReceipt): boolean {
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
    return true;
  } catch {
    return false;
  }
}

const ceil3 = (x: number) => Math.ceil(x * 1000) / 1000;

// R101c - single-flight per process (same law as the HIVE leg).
let steemMoneyInFlight = false;

export async function POST(req: Request) {
  if (steemMoneyInFlight) {
    return bad("another money action is executing - single-flight per process", 409, { code: "IN-FLIGHT" });
  }
  steemMoneyInFlight = true;
  try {
    return await POST_core(req);
  } finally {
    steemMoneyInFlight = false;
  }
}

async function POST_core(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return bad("גוף הבקשה אינו JSON");
  }
  // R97: reprice (סולם המכירה) · arm-buy (סולם הקנייה) · stock-sbd (R101: מילוי מלאי חימוש)
  const action =
    payload?.action === "arm-buy"
      ? "arm-buy"
      : payload?.action === "reprice"
        ? "reprice"
        : payload?.action === "stock-sbd"
          ? "stock-sbd"
          : null;
  if (!action) {
    return bad("פעולה לא מוכרת — נתמכות: reprice · arm-buy · stock-sbd");
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
  // R111 — חוק הגיבוי: הסולם לא מוכר את הגיבוי של הזירה.
  // הזירה עוטפת STEEM ל-WSTEEM נגד ההון החי באותו חשבון (וכך גם הפקדות
  // חוץ שנזקפות כ-WSTEEM לחברים) — תביעת הזירה כולה (מאזני חברים +
  // רזרבות בבריכות) מנוכה מדלק הפריסה, אחרת מכירת סולם שוברת את הבטחת
  // ה-1:1 של העטיפה. נולד מהזרמה כוזבת שנמדדה חי (95.327 WSTEEM מהון
  // סולם עומד) — החוק מונע את הנזק הבא, לא רק את האחרון.
  const arenaClaimWsteem = await (async (): Promise<number | null> => {
    try {
      const { db } = await import("@/lib/db");
      const accts = await db.exchangeAccount.findMany();
      let claim = 0;
      for (const a of accts) {
        try {
          const bal = JSON.parse(a.balances ?? "{}");
          claim += Number(bal.WSTEEM ?? 0) || 0;
        } catch { /* ספר ישן */ }
      }
      const pools = await db.exchangePool.findMany({ where: { assetA: "WSTEEM" } });
      for (const pool of pools) claim += Number(pool.reserveA) || 0;
      return Math.max(0, Math.round(claim * 1000) / 1000);
    } catch (e) {
      // r124 · חוק: כישלון-קריאה בחישוב-כסף הוא סירוב, לא אפס. ספר-הזירה
      // שלא נקרא היה מחזיר 0 תביעות → דלק מלא → reprice מפריס גיבוי של
      // WSTEEM שנתבע (הבטחת 1:1 של R111 נשברת בשקט). אפס מזויף = שקר.
      void e;
      return null;
    }
  })();
  if (arenaClaimWsteem == null) {
    return bad("ספר הזירה לא נקרא — תביעות ה-WSTEEM לא נמדדו, לכן שום פריסה לא תחושב. סירוב-כנה (חוק r124: כישלון-קריאה אינו אפס).", 503, { code: "ARENA-LEDGER-UNREADABLE" });
  }
  const totalFuelRaw = Math.round((liquid + inOrders) * 1000) / 1000;
  const totalFuel = Math.round(Math.max(0, totalFuelRaw - arenaClaimWsteem) * 1000) / 1000;
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

  // ── R111 · stock-sbd: רכישת-מלאי לחימוש צד-הקנייה ────────────────────
  // תיקון-שורש חי (R111, נמדד 04:46): הפקודה מוכרת STEEM לקבלת SBD —
  // ביצוע taker מתבצע מול צד ה-בידים, לא ה-שאלות. התמחור הישן חישב
  // את כמות ה-STEEM ממחיר-השאלה (גבוה מהביד) → min_to_receive גבוה
  // מהצעת הקנייה הטובה → הזמנת fill_or_kill לא מתמלאת אף-פעם בשוק
  // עם ספרד חיובי ("Cancelling order because it was not filled") —
  // וכל ניסיון כושל שרף תקציב-פעולות וצינון והרעיב את פריסת הסולם
  // ואת רגל HIVE (לולאת-הרעב). מעתה: הליכת-ספר אמיתית מול הבידים,
  // פרימיית-עלות נמדדת מול קו-הזהות בכיוון הנכון (parity/bid - 1 —
  // כמה STEEM משלמים מעל ההוגן עבור SBD), ותקרה 200bps נאכפת כנה.
  //   · כמות: רק הפער לחימוש (0.15), לעולם לא מעבר
  //   · fill_or_kill: פקודת-מילוי-מיידי או-בטל — לא נשארת בספר
  //   · שארת-דלק מינימלית נשמרת תמיד (0.5 STEEM)
  const stockGap = Math.ceil((0.15 - sbdCommitable) * 1000) / 1000;
  let stockBid: number | null = null; // המחיר הבר-ביצוע (צד הבידים)
  let stockSteemSell = 0;
  if (action === "stock-sbd") {
    if (stockGap <= 0.005) {
      return bad(`החימוש כבר שלם (${sbdCommitable.toFixed(3)}/0.15) — אין מה למלא`, 409, { code: "ALREADY-ARMED" });
    }
    const book = await new Promise<any>((resolve, reject) =>
      quiet(
        steem.api.getOrderBook(10, (err: Error | null, res: any) =>
          err ? reject(err) : resolve(res),
        ),
      ),
    ).catch(() => null);
    // r124 · חוק: כישלון-קריאה אינו "עומק דק" — ספר שלא נקרא הוא לא-נמדד,
    // ולא טענה על תוכנו. קוד נפרד מ-BOOK-TOO-THIN (שקר הסיבה נתפס ב-r124-a).
    if (book == null) {
      return bad("ספר-הבידים לא נקרא (RPC לא ענה) — לא נמדד, לא פעולה. סירוב-כנה.", 502, { code: "NO-BOOK-READ" });
    }
    const bidRows: Array<{ real_price?: string | number; sbd?: string | number }> = book?.bids ?? [];
    // הליכת-ספר: כמה STEEM צריך למכור דרך הבידים כדי לקבל בדיוק את הפער
    let remainSbd = stockGap;
    let walkSteem = 0;
    let lastBid = 0;
    for (const b of bidRows) {
      const px = Number(b.real_price);
      const sbd = Number(b.sbd) / 1000;
      if (!(px > 0) || !(sbd > 0)) continue;
      const take = Math.min(remainSbd, sbd);
      walkSteem += take / px;
      remainSbd -= take;
      lastBid = px;
      if (remainSbd <= 0.0005) break;
    }
    if (remainSbd > 0.0005) {
      return bad(
        `עומק הבידים לא מכסה את הפער (${stockGap.toFixed(3)} SBD, חסר ${remainSbd.toFixed(3)}) — לא מנוורים את הספר. סירוב-כנה.`,
        409,
        { code: "BOOK-TOO-THIN", gap: stockGap, short: Math.round(remainSbd * 1000) / 1000 },
      );
    }
    stockBid = lastBid > 0 ? lastBid : Number(bidRows[0]?.real_price) || null;
    if (stockBid == null || !(stockBid > 0)) {
      return bad("הספר לא נקרא — אין מחיר-ביד בר-ביצוע, אין פעולה. סירוב-כנה.", 502, { code: "NO-BOOK" });
    }
    // פרימיית-העלות האמיתית: מכירת STEEM בביד b מול קו-הזהות parity
    // (שניהם SBD-per-STEEM): SBD אחד עולה 1/b STEEM מול הוגן 1/parity.
    // premium = parity/b - 1 — חיובי = משלמים מעל ההוגן.
    const premiumBps = Math.round((parity / stockBid - 1) * 10_000);
    if (premiumBps > 200) {
      return bad(
        `הביד הבר-ביצוע ${stockBid.toFixed(6)} רחוק ${premiumBps}bps מתחת לקו-הזהות ${parity.toFixed(6)} (תקרה 200bps) — קניית המלאי תשלם STEEM מעל ההוגן. סירוב-כנה: החימוש ייבנה ממילוי-פרימיה.`,
        409,
        { code: "PREMIUM-TOO-HIGH", bid: stockBid, parity, premiumBps },
      );
    }
    stockSteemSell = Math.ceil(walkSteem * 1000) / 1000;
    if (liquid < stockSteemSell + 0.5) {
      return bad(
        `דלק נזיל לא מספיק למילוי (${liquid.toFixed(3)} STEEM < ${stockSteemSell.toFixed(3)} + שארה 0.5) — המלאי ייבנה עם הפאוורדאון/מילוי הבא`,
        409,
        { code: "NO-FUEL", liquid, need: stockSteemSell },
      );
    }
  }

  // ── שער-העסקאות (R97): הערכת-USD חיה בזמן ההחלטה, לפני כל נגיעה בכסף ──
  const gateUsd =
    action === "arm-buy"
      ? marks.sbdUsd != null && marks.sbdUsd > 0
        ? Math.round(sbdCommitable * marks.sbdUsd * 100) / 100
        : null
      : action === "stock-sbd"
        ? marks.steemUsd != null && marks.steemUsd > 0
          ? Math.round(stockSteemSell * marks.steemUsd * 100) / 100
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
        : action === "stock-sbd"
          ? `stock-sbd — מילוי מלאי חימוש · ${stockSteemSell} STEEM → ${stockGap} SBD במחיר-שאלה`
          : `reprice — סולם 3 רמות מעל הפאריטה · ${totalFuel} STEEM`,
    payload:
      action === "arm-buy"
        ? { sbdCommitable, parity, offsetsBps: BID_OFFSETS_BPS, reason }
        : action === "stock-sbd"
          ? { gap: stockGap, bid: stockBid, steemSell: stockSteemSell, parity, premiumCapBps: 200, reason }
          : { liquid, inOrders, totalFuel, parity, premiums, reason },
    usdValue: gateUsd,
    usdBasis:
      gateUsd != null
        ? action === "arm-buy"
          ? `${sbdCommitable} SBD × $${marks.sbdUsd} (${marks.sources.sbd ?? "sbd-mark"})`
          : action === "stock-sbd"
            ? `${stockSteemSell} STEEM × $${marks.steemUsd} (${marks.sources.steem ?? "steem-mark"})`
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
    kind: action === "arm-buy" ? "ARM-BUY" : action === "stock-sbd" ? "STOCK-SBD" : inOrders === 0 ? "FUEL-IN" : "REPRICE",
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

  // לקח R98 (הוכח במעבדה מבודדת scripts/lab-broadcast-rejection.cjs + 80 מדידות
  // ב-dev.log): מצב-ה-callback של steem-js נכשל פעמיים — ההבטחה המוחזרת
  // היא undefined (אין מה לתפוס) ובדחיית-הכנה ה-callback אף לא מופעל.
  // הדפוס המוכח של קו-העוגן (graphene.ts, חי on-chain): broadcast.sendAsync —
  // ההבטחה היא מקור-האמת היחיד. תקרת-45ש' נשארת: שידור מתקבל בשרשרת
  // ב-~7-9 שנ׳ אך אישור steem-js מתעכב מעבר לזה — והשופט הסופי הוא
  // השרשרת (ה-verify בסוף הקבלה מודד מה באמת פתוח שם, לא מה שהאישורים אמרו).
  const broadcastOp = async <T,>(p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("broadcast-timeout-45s")), 45_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // לקח-הריצה-הראשונה (נמדד 00:38–00:40Z): קבלה שנכתבת רק בסוף מתאפסת אם
  // ה-handler נקטע. מעתה — הקבלה מתעדכנת בקובץ אחרי כל פעולה בודדת:
  // גם אם העולם ייפול באמצע, מה שקרה על השרשרת מתועד.
  // r125a: ה-persist האחרון קובע — מה שנמצא על הדיסק הוא הראיה; אם נפל,
  // התשובה מגלה זאת (receiptPersisted:false) ולא מסתירה את אובדן-הראיה.
  let receiptPersisted = true;
  const persist = () => {
    receiptPersisted = appendReceipt(receipt);
  };

  try {
    if (action === "arm-buy") {
      // ═ ARM-BUY — צד הקנייה של המיקרו-גריד (R97 · הזדמנות O1) ═══════
      // סולם שלוש רמות מתחת לפאריטה (‎-1%/-2%/-3%): כל קנייה מתחת לקו היא
      // עודף נמדד מול ערך-חוץ. הגג נאכף בקוד: לעולם לא קונים מעל פאריטה.
      // שוק פנימי שנסחר מתחת לקו ימלא את ההצעות מיד — במחיר העומד,
      // לא במחיר ההצעה; השרשרת היא השופטת.
      const bidCancelResults = await Promise.allSettled(
        bidOpen.map((o) =>
          broadcastOp<any>(
            steem.broadcast.sendAsync(
              { extensions: [], operations: [["limit_order_cancel", { owner: ownerKey.account, orderid: o.orderid }]] },
              [wif],
            ),
          ).then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
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
          const res = await broadcastOp<any>(
            steem.broadcast.sendAsync(
              {
                extensions: [],
                operations: [[
                  "limit_order_create",
                  {
                    owner: ownerKey.account,
                    orderid,
                    amount_to_sell: `${sbd.toFixed(3)} SBD`,
                    min_to_receive: `${steemOut.toFixed(3)} STEEM`,
                    fill_or_kill: false,
                    expiration,
                  },
                ]],
              },
              [wif],
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
        receiptPersisted,
        he: (bidsOk
          ? `סולם הקנייה חי בשרשרת (נמדד): ${bidVerify?.bidsNow} הצעות · ${sbdCommitable} SBD מחויבות מתחת לקו ${parity.toFixed(4)} · בוטלו ${receipt.cancelled.length}`
          : `הוצבו ${receipt.placed.length} הצעות קנייה · בוטלו ${receipt.cancelled.length} · אימות שרשרת לא נקרא`) + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
      });
    }

    // ═ STOCK-SBD — מילוי מלאי חימוש צד-הקנייה (R101 · שחרור החסימה המדודה) ═
    // פקודת fill_or_kill: מילוי-מיידי במחיר העומד או ביטול — לעולם לא נשארת
    // בספר כמייקר. הפרימייה ששולמה מעל קו-הזהות נמדדת ומתועדת בכנות:
    // זו עלות-לוגיסטיקה של חימוש, לא רווח-גריד.
    if (action === "stock-sbd") {
      const orderDayStock = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const orderid = Number(`${orderDayStock}7`); // 7 = stock (מכירות 01-03 · קניות 91-93)
      const iocExpiration = new Date(Date.now() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "");
      try {
        const res = await broadcastOp<any>(
          steem.broadcast.sendAsync(
            {
              extensions: [],
              operations: [[
                "limit_order_create",
                {
                  owner: ownerKey.account,
                  orderid,
                  amount_to_sell: `${stockSteemSell.toFixed(3)} STEEM`,
                  min_to_receive: `${stockGap.toFixed(3)} SBD`,
                  fill_or_kill: true,
                  expiration: iocExpiration,
                },
              ]],
            },
            [wif],
          ),
        );
        receipt.placed.push({ orderid, sell: stockSteemSell, receive: stockGap, price: stockBid ?? 0, txid: res?.id ?? null, confirmedBy: "fill-or-kill" });
      } catch (e) {
        noteError(`stock order: ${String((e as Error).message).slice(0, 120)}`);
      }
      persist();

      // אימות-סוף — השרשרת השופטת: מה באמת נצבר
      let stockVerify: { sbdNow: number; gapClosed: boolean; premiumPaidBps: number | null } | null = null;
      try {
        const after = await new Promise<any[]>((resolve, reject) =>
          quiet(
            steem.api.getAccounts([ownerKey.account], (err: Error | null, res: any[]) =>
              err || !res?.length ? reject(err ?? new Error("empty")) : resolve(res),
            ),
          ),
        );
        const sbdNow = Math.floor(parseFloat(after[0].sbd_balance) * 1000) / 1000;
        stockVerify = {
          sbdNow,
          gapClosed: sbdNow >= 0.15,
          premiumPaidBps: stockBid != null ? Math.round((parity / stockBid - 1) * 10_000) : null,
        };
      } catch {
        /* השרשרת תישאר השופט בקריאה הבאה */
      }
      receipt.verify = stockVerify;
      persist();
      swrInvalidate(SWR_KEY);
      await settleGate(
        gate.id,
        "EXECUTED",
        issuedBy === "operator" ? "operator" : "policy:autonomous",
        { placed: receipt.placed.length, stock: stockVerify, gateUsd },
      );
      return NextResponse.json({
        ok: receipt.placed.length > 0,
        receipt,
        verify: stockVerify,
        receiptPersisted,
        he: (stockVerify?.gapClosed
          ? `מלאי החימוש נסגר: ${stockVerify.sbdNow} SBD — סולם הקנייה יחומש במחזור הבא`
          : `פקודת המילוי שודרה (${receipt.placed.length}) · SBD נוכחי ${stockVerify?.sbdNow ?? "?"} — השרשרת השופטת`) + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
      });
    }

    // ═ REPRICE — סולם המכירה (R81; R97: ביטול מכירות בלבד — הקניות לא נפגעות) ═
    // א. ביטול פקודות המכירה הקיימות — במקביל (עצמאיות; הכסף חוזר לנזיל)
    const cancelResults = await Promise.allSettled(
      sellOpen.map((o) =>
        broadcastOp<any>(
          steem.broadcast.sendAsync(
            { extensions: [], operations: [["limit_order_cancel", { owner: ownerKey.account, orderid: o.orderid }]] },
            [wif],
          ),
        ).then((res) => ({ orderid: o.orderid, txid: res?.id ?? null })),
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
        const res = await broadcastOp<any>(
          steem.broadcast.sendAsync(
            {
              extensions: [],
              operations: [[
                "limit_order_create",
                {
                  owner: ownerKey.account,
                  orderid,
                  amount_to_sell: `${sell.toFixed(3)} STEEM`,
                  min_to_receive: `${receive.toFixed(3)} SBD`,
                  fill_or_kill: false,
                  expiration,
                },
              ]],
            },
            [wif],
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
      receiptPersisted,
      he: (chainOk
        ? `הסולם חי בשרשרת (נמדד): ${verify?.ordersNow} פקודות / ${verify?.deployedNow} STEEM · פאריטה ${parity.toFixed(4)}–${(parity * 1.02).toFixed(4)} · בוטלו ${receipt.cancelled.length}`
        : `הוצבו ${receipt.placed.length} רמות · בוטלו ${receipt.cancelled.length} · אימוש שרשרת לא נקרא`) + (receiptPersisted ? "" : " · אזהרה: כתיבת הקבלה לדיסק נכשלה — הראיה על השרשרת בלבד"),
    });
  } catch (e) {
    receipt.error = String((e as Error).message).slice(0, 300);
    const persisted = appendReceipt(receipt);
    return bad(`הפעולה נכשלה בכנות: ${receipt.error.slice(0, 160)}`, 502, { code: "EXECUTE-FAILED", receipt, receiptPersisted: persisted });
  }
}
