// ═══════════════════════════════════════════════════════════════════════
// מנוע ההכנסה — R127 · המשימה: $1,000 ליום שניתנים להמרה
// ═══════════════════════════════════════════════════════════════════════
// נולד מהוראת המפעיל (27/09): "המשימה של הסוכנים האוטונומיה והריבונות
// הוא לייצר 1000$ תקני שאפשר להמיר, כל יום... ואם לא יכולים — מה חסר
// לה ועד לתוצאה."
//
// חוקי המודול (יורשים את דוקטרינת הכנות של הקנון):
//   1. אין הכנסה בלי מדידה — כל מקור נמדד מהשרשרת/ה-DB החי, או מסומן
//      null בכנות ("לא נמדד"). אף מספר לא מומצא.
//   2. המרה לדולר רק בשער חי — אין שער, אין סכום (חוק r125).
//   3. הון שנכנס ≠ הכנסה — powerdown והפקדות חוץ נרשמים כהון-נכנס
//      בנפרד, לעולם לא נספרים כהכנסה.
//   4. הפער מדווח כמו שהוא — גם כשהוא פי 500,000. המספר הכנה
//      הוא הבסיס לתיקון.
// ═══════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { composeGridPnl, type PnlFill } from "./grid-pnl";

const STEEM_RPC = "https://api.steemit.com";
const ACCOUNT = "headcorner";
/** החשבונות של הרשת — העברות ביניהן אינן הכנסה חיצונית */
const NETWORK_ACCOUNTS = new Set([
  "headcorner", "cashmachine", "haran", "lsa", "macrame", "saos",
]);
/** חלון המדידה: 32 יום אחורה מכסה את ה-30 האחרונים גם בקצוות */
const WINDOW_DAYS = 32;
const MAX_PAGES = 25;
export const MISSION_TARGET_USD_PER_DAY = 1000;

export interface IncomeSource {
  id: string;
  nameHe: string;
  /** USD בחלון — null = לא נמדד בכנות (חוק: אין שער/אין קריאה ⇒ אין מספר) */
  usdToday: number | null;
  usd7d: number | null;
  usd30d: number | null;
  eventsToday: number;
  events7d: number;
  events30d: number;
  evidenceHe: string;
}

export interface CapitalInflow {
  /** הון שנכנס (לא הכנסה!): powerdown + הפקדות חוץ */
  steemPowerdownToday: number;
  steemPowerdown7d: number;
  steemPowerdown30d: number;
  externalInUsdToday: number | null;
  externalInUsd7d: number | null;
  externalInUsd30d: number | null;
  noteHe: string;
}

export interface IncomeGap {
  targetUsdPerDay: number;
  actualUsdPerDay30d: number | null;
  ratio: number | null;
  /** כמה הון דרוש בהנחת תשואה יומית נתונה כדי להגיע ליעד */
  capitalNeeded: Array<{ edgePctPerDay: number; capitalUsd: number | null }>;
  workingCapitalUsd: number | null;
  missingHe: string[];
}

export interface IncomeReport {
  at: string;
  ok: boolean;
  account: string;
  sources: IncomeSource[];
  capitalInflow: CapitalInflow;
  totals: { usdToday: number | null; usd7d: number | null; usd30d: number | null };
  gap: IncomeGap;
  down: string[];
}

// ── רשת בסיסית ─────────────────────────────────────────────────────────

async function jpost<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) throw new Error(String(j.error.message ?? "rpc-error"));
    return j.result as T;
  } finally {
    clearTimeout(t);
  }
}

function parseAmount(s: string | undefined | null): number {
  const m = String(s ?? "").trim().match(/^([\d.]+)\s+\S+$/);
  return m ? parseFloat(m[1]) || 0 : 0;
}

// ── סריקת היסטוריה (חוק הגילוי R104: -1,N יכול לחזור ריק מצומת-רפא) ────

interface HistOp {
  idx: number;
  at: string;
  type: string;
  value: Record<string, unknown>;
}

async function scanHistory(): Promise<{ ops: HistOp[]; pages: number; stopReason: string }> {
  const floor = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 19);
  const ops: HistOp[] = [];
  let pages = 0;
  let start = -1;
  let stopReason = "max-pages";
  // R127b — חוק הרפליקה-הרפא גם באמצע-סריקה: עמוד ריק אינו בהכרח סוף-היסטוריה
  // (נמדד חי: מדידה אחת ראתה תגמולים, רעותה לא). שני ניסיונות-חוזרים לפני הכרעה.
  let emptyRetries = 0;
  while (pages < MAX_PAGES) {
    let hist: Array<[number, any]> | null = await jpost<Array<[number, any]>>(
      "condenser_api.get_account_history", [ACCOUNT, start, 100],
    ).catch(() => null);
    if ((!hist || !hist.length) && start === -1) {
      // חוק הגילוי R104: -1,N ריק מצומת-רפא — בדיקה-כפולה קטנה
      hist = await jpost<Array<[number, any]>>(
        "condenser_api.get_account_history", [ACCOUNT, -1, 3],
      ).catch(() => null);
      if (!hist || !hist.length) { stopReason = "history-unreadable"; break; }
      const maxIdx = hist[hist.length - 1][0];
      if (maxIdx > 0) start = maxIdx;
      continue;
    }
    if (!hist || !hist.length) {
      emptyRetries += 1;
      if (emptyRetries <= 2) continue; // רפליקה-רפא: נסה שוב את אותו עמוד
      stopReason = "end-of-history";
      break;
    }
    emptyRetries = 0;
    pages += 1;
    let minIdx = Infinity;
    let oldest = "";
    for (const [idx, rec] of hist) {
      minIdx = Math.min(minIdx, idx);
      const op = rec?.op;
      if (Array.isArray(op) && op.length === 2) {
        const [type, value] = op as [string, Record<string, unknown>];
        ops.push({ idx, at: String(rec.timestamp ?? ""), type, value: value ?? {} });
      }
    }
    const first = hist[0]?.[1];
    oldest = String((first as any)?.timestamp ?? "");
    if (oldest && oldest < floor) { stopReason = "floor-reached"; break; }
    if (minIdx <= 0) { stopReason = "index-zero"; break; }
    start = minIdx - 1;
  }
  return { ops, pages, stopReason };
}

// ── מדידות ──────────────────────────────────────────────────────────────

interface Marks { steemUsd: number | null; sbdUsd: number | null; perVestSteem: number | null; marksAgeHe: string }

async function liveMarks(): Promise<Marks> {
  let steemUsd: number | null = null;
  let sbdUsd: number | null = null;
  let marksAgeHe = "";
  // 1) המראה החיה של הכסף — מקורות מרובים מסודרים כבר (חוק R105) + גיל-מקור
  try {
    const res = await fetch("http://127.0.0.1:3000/api/money", {
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const j = await res.json();
      const m = j?.marks ?? {};
      if (Number.isFinite(Number(m.steemUsd)) && Number(m.steemUsd) > 0) steemUsd = Number(m.steemUsd);
      if (Number.isFinite(Number(m.sbdUsd)) && Number(m.sbdUsd) > 0) sbdUsd = Number(m.sbdUsd);
      const src = String(m?.sources?.sbd ?? "");
      if (src) marksAgeHe = `שערים מהמראה החיה (${src.slice(0, 60)})`;
    }
  } catch { /* המראה לא ענתה — ממשיכים למקורות ישירים */ }
  // 2) בינאנס ישיר (נפילה חד-פעמית של מקור אינה מאפסת מדידה — חוק R105)
  if (steemUsd == null) {
    const bin = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", {
      cache: "no-store", signal: AbortSignal.timeout(8000),
    }).then((r) => r.json()).then((j) => Number(j?.price)).catch(() => null);
    if (bin && Number.isFinite(bin) && bin > 0) steemUsd = bin;
  }
  if (sbdUsd == null) {
    const tick = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SBDUSDT", {
      cache: "no-store", signal: AbortSignal.timeout(8000),
    }).then((r) => r.json()).then((j) => Number(j?.price)).catch(() => null);
    if (tick && Number.isFinite(tick) && tick > 0) sbdUsd = tick;
  }
  // 3) perVest להמרת תגמולי SP/VESTS
  let perVestSteem: number | null = null;
  const dyn = await jpost<any>("condenser_api.get_dynamic_global_properties", []).catch(() => null);
  if (dyn) {
    const fund = parseAmount(dyn.total_vesting_fund_steem);
    const shares = parseAmount(dyn.total_vesting_shares);
    if (fund > 0 && shares > 0) perVestSteem = fund / shares;
  }
  return { steemUsd, sbdUsd, perVestSteem, marksAgeHe };
}

// ── הרכבת הדוח ─────────────────────────────────────────────────────────

function dayKey(iso: string): string { return iso.slice(0, 10); }
function withinDays(iso: string, days: number, now: number): boolean {
  const t = Date.parse(iso.endsWith("Z") ? iso : iso + "Z");
  return Number.isFinite(t) && t >= now - days * 86_400_000;
}

export async function composeIncome(): Promise<IncomeReport> {
  const down: string[] = [];
  const now = Date.now();
  const today = dayKey(new Date(now).toISOString());

  const [{ ops, pages, stopReason }, marks] = await Promise.all([
    scanHistory(),
    liveMarks(),
  ]);
  if (!ops.length) down.push(`סריקת ההיסטוריה: ${stopReason} — אפס אירועים נקראו`);

  // ── תגמולי מחבר (author_reward) ואוצרות (curation_reward) ──
  let authorSbd = 0, authorSteem = 0, authorVests = 0, authorN = 0;
  let curVests = 0, curN = 0;
  const authorWin = { today: { usd: 0, n: 0 }, d7: { usd: 0, n: 0 }, d30: { usd: 0, n: 0 } };
  const curWin = { today: { usd: 0, n: 0 }, d7: { usd: 0, n: 0 }, d30: { usd: 0, n: 0 } };
  for (const op of ops) {
    if (op.type === "author_reward") {
      const sbd = parseAmount(String(op.value.sbd_payout ?? ""));
      const steem = parseAmount(String(op.value.steem_payout ?? ""));
      const vests = parseAmount(String(op.value.vesting_payout ?? ""));
      const usd =
        (marks.sbdUsd != null ? sbd * marks.sbdUsd : 0) +
        (marks.steemUsd != null ? steem * marks.steemUsd : 0) +
        (marks.steemUsd != null && marks.perVestSteem != null ? vests * marks.perVestSteem * marks.steemUsd : 0);
      const convertible = marks.sbdUsd != null && marks.steemUsd != null;
      authorSbd += sbd; authorSteem += steem; authorVests += vests; authorN += 1;
      if (dayKey(op.at) === today) { authorWin.today.usd += convertible ? usd : 0; authorWin.today.n += 1; }
      if (withinDays(op.at, 7, now)) { authorWin.d7.usd += convertible ? usd : 0; authorWin.d7.n += 1; }
      if (withinDays(op.at, 30, now)) { authorWin.d30.usd += convertible ? usd : 0; authorWin.d30.n += 1; }
    } else if (op.type === "curation_reward") {
      const vests = parseAmount(String(op.value.reward ?? ""));
      const usd = marks.steemUsd != null && marks.perVestSteem != null ? vests * marks.perVestSteem * marks.steemUsd : 0;
      const convertible = marks.steemUsd != null && marks.perVestSteem != null;
      curVests += vests; curN += 1;
      if (dayKey(op.at) === today) { curWin.today.usd += convertible ? usd : 0; curWin.today.n += 1; }
      if (withinDays(op.at, 7, now)) { curWin.d7.usd += convertible ? usd : 0; curWin.d7.n += 1; }
      if (withinDays(op.at, 30, now)) { curWin.d30.usd += convertible ? usd : 0; curWin.d30.n += 1; }
    }
  }
  const markNull = marks.sbdUsd == null || marks.steemUsd == null;

  // ── מסחר: לכידת סבבים (FIFO) ממילויים אמיתיים ──
  // R127-כנות: הסריקה שלעיל חסומה ב-25 עמודים (~20 יום בקצב הפעולות הנוכחי)
  // ולכן לא מגיעה לקניות ההיסטוריות — מקור האמת למילויים הוא הסריקה
  // המצ'פקאת של grid-pnl (עמידה, אינקרמנטלית, מכסה "אי-פעם").
  const pnl = await composeGridPnl().catch((e) => {
    down.push(`סריקת המילויים נכשלה: ${String((e as Error).message).slice(0, 80)}`);
    return null;
  });
  const fills: PnlFill[] = (pnl?.fills ?? []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  // סבבים FIFO — ההכנסה נסגרת רק במכירה שסוגרת קנייה
  const queue: Array<{ steem: number; price: number; at: string }> = [];
  const tripsClosed: Array<{ closedAt: string; capturedSbd: number }> = [];
  for (const f of fills) {
    if (f.price == null) continue;
    if (f.side === "bought-steem") queue.push({ steem: f.steem, price: f.price, at: f.at });
    else {
      let remain = f.steem;
      while (remain > 1e-9 && queue.length) {
        const head = queue[0];
        const take = Math.min(remain, head.steem);
        tripsClosed.push({ closedAt: f.at, capturedSbd: (f.price - head.price) * take });
        head.steem -= take; remain -= take;
        if (head.steem <= 1e-9) queue.shift();
      }
    }
  }
  const tradeWin = { today: 0, d7: 0, d30: 0 };
  for (const t of tripsClosed) {
    if (dayKey(t.closedAt) === today) tradeWin.today += t.capturedSbd;
    if (withinDays(t.closedAt, 7, now)) tradeWin.d7 += t.capturedSbd;
    if (withinDays(t.closedAt, 30, now)) tradeWin.d30 += t.capturedSbd;
  }
  const tradeToUsd = (sbd: number) =>
    marks.sbdUsd != null ? Math.round(sbd * marks.sbdUsd * 1e4) / 1e4 : null;

  // ── עמלות DEX (אירועי FEE + SWAP בספר הזירה המגובה) ──
  let dexUsd30: number | null = null; let dexSwaps30 = 0;
  let dexUsdToday: number | null = 0; let dexUsd7: number | null = 0;
  try {
    const { db } = await import("@/lib/db");
    const since30 = new Date(now - 30 * 86_400_000);
    const since7 = new Date(now - 7 * 86_400_000);
    const todayStart = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
    // עמלות = אירועי FEE מתועדים; נפח = SWAPs (לתצוגה בלבד)
    const [feeToday, fee7, fee30, swaps30] = await Promise.all([
      db.exchangeEvent.aggregate({ _sum: { usdValue: true }, where: { kind: "FEE", createdAt: { gte: todayStart } } }),
      db.exchangeEvent.aggregate({ _sum: { usdValue: true }, where: { kind: "FEE", createdAt: { gte: since7 } } }),
      db.exchangeEvent.aggregate({ _sum: { usdValue: true }, where: { kind: "FEE", createdAt: { gte: since30 } } }),
      db.exchangeEvent.count({ where: { kind: "SWAP", createdAt: { gte: since30 } } }),
    ]);
    dexSwaps30 = swaps30;
    dexUsdToday = feeToday._sum.usdValue != null ? feeToday._sum.usdValue : 0;
    dexUsd7 = fee7._sum.usdValue != null ? fee7._sum.usdValue : 0;
    dexUsd30 = fee30._sum.usdValue != null ? fee30._sum.usdValue : 0;
  } catch {
    down.push("ספר הזירה לא נקרא — עמלות DEX לא נמדדו");
    dexUsd30 = null; dexUsdToday = null; dexUsd7 = null;
  }

  // ── הון נכנס (לא הכנסה) ──
  let pdToday = 0, pd7 = 0, pd30 = 0;
  let extInTodaySbd = 0, extIn7Sbd = 0, extIn30Sbd = 0;
  let extInTodaySteem = 0, extIn7Steem = 0, extIn30Steem = 0;
  let extN = 0;
  for (const op of ops) {
    if (op.type === "fill_vesting_withdraw") {
      const steem = parseAmount(String(op.value.deposited ?? ""));
      if (dayKey(op.at) === today) pdToday += steem;
      if (withinDays(op.at, 7, now)) pd7 += steem;
      if (withinDays(op.at, 30, now)) pd30 += steem;
    } else if (op.type === "transfer") {
      const v = op.value as Record<string, string>;
      const from = String(v.from ?? "");
      if (String(v.to ?? "") === ACCOUNT && !NETWORK_ACCOUNTS.has(from)) {
        const amt = parseAmount(v.amount);
        const asset = String(v.amount ?? "").trim().split(/\s+/)[1] ?? "";
        extN += 1;
        if (asset === "SBD") {
          if (dayKey(op.at) === today) extInTodaySbd += amt;
          if (withinDays(op.at, 7, now)) extIn7Sbd += amt;
          if (withinDays(op.at, 30, now)) extIn30Sbd += amt;
        } else if (asset === "STEEM") {
          if (dayKey(op.at) === today) extInTodaySteem += amt;
          if (withinDays(op.at, 7, now)) extIn7Steem += amt;
          if (withinDays(op.at, 30, now)) extIn30Steem += amt;
        }
      }
    }
  }
  const extUsd = (sbd: number, steem: number) =>
    marks.sbdUsd != null && marks.steemUsd != null ? sbd * marks.sbdUsd + steem * marks.steemUsd : null;

  // ── סיכום מקורות ──
  const r2 = (n: number | null) => (n == null ? null : Math.round(n * 1e4) / 1e4);
  const sources: IncomeSource[] = [
    {
      id: "author-rewards",
      nameHe: "תגמולי פרסום (Steem)",
      usdToday: markNull ? null : r2(authorWin.today.usd)!,
      usd7d: markNull ? null : r2(authorWin.d7.usd)!,
      usd30d: markNull ? null : r2(authorWin.d30.usd)!,
      eventsToday: authorWin.today.n, events7d: authorWin.d7.n, events30d: authorWin.d30.n,
      evidenceHe: authorN
        ? `${authorN} תגמולים בחלון הסריקה (${authorSbd.toFixed(3)} SBD · ${authorSteem.toFixed(3)} STEEM · ${Math.round(authorVests)} VESTS)`
        : "אפס תגמולי מחבר בחלון — הפוסטים מפורסמים אך אין מצביעים (נמדד מהשרשרת)",
    },
    {
      id: "curation-rewards",
      nameHe: "תגמולי אוצרות (SP)",
      usdToday: marks.steemUsd == null || marks.perVestSteem == null ? null : r2(curWin.today.usd)!,
      usd7d: marks.steemUsd == null || marks.perVestSteem == null ? null : r2(curWin.d7.usd)!,
      usd30d: marks.steemUsd == null || marks.perVestSteem == null ? null : r2(curWin.d30.usd)!,
      eventsToday: curWin.today.n, events7d: curWin.d7.n, events30d: curWin.d30.n,
      evidenceHe: curN
        ? `${curN} תגמולים (${Math.round(curVests)} VESTS)`
        : "אפס תגמולי אוצרות — כוח-הצבעה יושב בטל (נמדד מהשרשרת)",
    },
    {
      id: "grid-trading",
      nameHe: "מסחר סולם (לכידת סבבים)",
      usdToday: tradeToUsd(tradeWin.today),
      usd7d: tradeToUsd(tradeWin.d7),
      usd30d: tradeToUsd(tradeWin.d30),
      eventsToday: tripsClosed.filter((t) => dayKey(t.closedAt) === today).length,
      events7d: tripsClosed.filter((t) => withinDays(t.closedAt, 7, now)).length,
      events30d: tripsClosed.filter((t) => withinDays(t.closedAt, 30, now)).length,
      evidenceHe: `${tripsClosed.length} סבבים נסגרו אי-פעם (FIFO ממילויים אמיתיים על השרשרת)`,
    },
    {
      id: "dex-fees",
      nameHe: "עמלות זירה (DEX)",
      usdToday: dexUsd30 == null ? null : dexUsdToday,
      usd7d: dexUsd30 == null ? null : dexUsd7,
      usd30d: dexUsd30,
      eventsToday: 0, events7d: 0, events30d: dexSwaps30,
      evidenceHe: dexUsd30 == null
        ? "ספר הזירה לא נקרא"
        : dexSwaps30 === 0 ? "אפס החלפות בזירה ב-30 יום — אין משתמשים חיצוניים (נמדד מה-DB)" : `${dexSwaps30} החלפות`,
    },
  ];

  const sumW = (w: "today" | "d7" | "d30") => {
    let s = 0, anyNull = false;
    for (const src of sources) {
      const v = w === "today" ? src.usdToday : w === "d7" ? src.usd7d : src.usd30d;
      if (v == null) anyNull = true; else s += v;
    }
    return anyNull ? null : r2(s);
  };

  // ── הון עובד (לחישוב הפער) — מהמראה החיה של האוצר ──
  let workingCapitalUsd: number | null = null;
  try {
    const res = await fetch("http://127.0.0.1:3000/api/treasury", {
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const j = await res.json();
      const u = j?.usd;
      if (u && typeof u.total === "number") workingCapitalUsd = Math.round(u.total * 100) / 100;
    }
  } catch { down.push("האוצר לא נקרא — הון-עבודה לא נמדד"); }

  const actual30 = sumW("d30");
  const perDay30 = actual30 != null ? actual30 / 30 : null;
  const gap: IncomeGap = {
    targetUsdPerDay: MISSION_TARGET_USD_PER_DAY,
    actualUsdPerDay30d: perDay30 != null ? r2(perDay30) : null,
    ratio: perDay30 && perDay30 > 0 ? Math.round(MISSION_TARGET_USD_PER_DAY / perDay30) : null,
    capitalNeeded: [0.005, 0.01, 0.02].map((edge) => ({
      edgePctPerDay: Math.round(edge * 10000) / 100,
      capitalUsd: Math.round(MISSION_TARGET_USD_PER_DAY / edge),
    })),
    workingCapitalUsd,
    missingHe: [],
  };
  if (perDay30 != null && perDay30 < MISSION_TARGET_USD_PER_DAY) {
    gap.missingHe.push(
      workingCapitalUsd != null
        ? `הון-עבודה נוכחי ${workingCapitalUsd}$ מייצר ~${perDay30.toFixed(4)}$/יום. בהנחת תשואה יומית אופטימיסטית של 2% נדרשים ~${Math.round(MISSION_TARGET_USD_PER_DAY / 0.02).toLocaleString("en-US")}$ הון עובד — פער הון שרק המפעיל יכול לסגור (הזרמה/גיוס).`
        : "ההון לא נמדד — לא ניתן לחשב את פער ההון בכנות.",
    );
    gap.missingHe.push("משתמשים חיצוניים: הזירה, הצ'רטרים והשירותים חיים אך עם אפס לקוחות — מנוע הכנסה משירותים דורש ערוץ מכירה/תנועה חיצונית שאינה קיימת.",
    );
    gap.missingHe.push("מקורות סרק שהופעלו היום: כוח-הצבעה (SP) וצד הקנייה של הגריד — מופעלים בסבב זה (R127).");
  }

  return {
    at: new Date().toISOString(),
    ok: down.length === 0,
    account: ACCOUNT,
    sources,
    capitalInflow: {
      steemPowerdownToday: Math.round(pdToday * 1000) / 1000,
      steemPowerdown7d: Math.round(pd7 * 1000) / 1000,
      steemPowerdown30d: Math.round(pd30 * 1000) / 1000,
      externalInUsdToday: extUsd(extInTodaySbd, extInTodaySteem),
      externalInUsd7d: extUsd(extIn7Sbd, extIn7Steem),
      externalInUsd30d: extUsd(extIn30Sbd, extIn30Steem),
      noteHe: "הון שנכנס אינו הכנסה: powerdown הוא המרת SP לנוזלי; הפקדות חוץ נספרות בנפרד. " +
        (extN ? `${extN} העברות חוץ נכנסו בחלון.` : "אפס העברות חוץ נכנסו בחלון."),
    },
    totals: { usdToday: sumW("today"), usd7d: sumW("d7"), usd30d: actual30 },
    gap,
    down: [...down, `סריקה: ${pages} עמודים · ${ops.length} אירועים · עצירה: ${stopReason}`],
  };
}

// ── רשומה יומית לקנון (מופקת ע"י הדופק או ידנית) ───────────────────────

export function incomeDayFilePath(dateIso: string): string {
  return path.join(process.cwd(), "sovereign", "income", `daily-${dateIso}.json`);
}

export function writeIncomeDay(report: IncomeReport): { file: string; created: boolean } {
  const date = dayKey(report.at);
  const file = incomeDayFilePath(date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const created = !fs.existsSync(file);
  const body = {
    format: "income-day-v1",
    date,
    generatedAt: report.at,
    totals: report.totals,
    sources: report.sources.map((s) => ({
      id: s.id, nameHe: s.nameHe, usdToday: s.usdToday, usd7d: s.usd7d, usd30d: s.usd30d,
      events30d: s.events30d, evidenceHe: s.evidenceHe,
    })),
    capitalInflow: report.capitalInflow,
    // R127b (לקח אימות-דפדפן): ה-gap המלא נשמר — אחרת כל טעינה מציגה
    // "לא נמדד" עד לחיצה ידנית על מדידה-חיה, והרשומה היומית מאבדת
    // את זיכרון המשימה (הפער, היעד, מה-חסר).
    gap: report.gap,
    scan: report.down,
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return { file, created };
}
