#!/usr/bin/env node
/**
 * profit-oracle — פעימת-רווחיות-עומדת יומית (STANDING DAILY PROFIT PULSE) · zai-14b · trace 1a12d502a99b7021
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * מצטרף ל-OWNER-WORD: "the autonomy itself checks profitability daily" — האוטונומיה בודקת-רווחיות
 * כל-יום. הקבלה לשער-הבית (ops/fresh-oracle, zai-12b): אותו-ארכיטקט — אפס-תלות, ESM, node>=18,
 * fail-open כן, union-receipt (prior נשמר מילה-במילה, runs מוגבל-12), סריקת-סודות לפני-כתיבה,
 * אימות-readback. אפס-מפתחות: קריאות-שרשרת ציבוריות בלבד + raw/Pages ציבורי. אין-חתימה, אין-STASIS.
 *
 * הבדיקות (3):
 *   V-WORTH           שווי-הצי חי: get_dynamic_global_properties (יחס-vests→SP) + get_accounts על
 *                     מניפסט-14-החשבונות (roster מדויק — מקור: ECONOMIC-PLAN-2026-10-11.md נספח-א'
 *                     קריאה #3 `get_accounts[14 fleet]`, ראה ROSTER למטה) + get_order_book(10) למחיר-אמצע.
 *                     own-SP = Σ vests×ratio · eff-SP = Σ (vests−del_out+recv)×ratio · נזיל = Σ STEEM+SBD.
 *                     אומת-מול-בסיס-zai-10d 19:54Z: own 4294.4 / eff 3556.0 — הנוסחאות משחזרות את הבסיס.
 *                     netWorthSbdEquiv = ownSp×mid + liquidSbd + liquidSteem×mid.
 *   V-GRID-EDGE       pnl-desk (Domain Pages, ציבורי): verdict + postLaw.edgePct + lifetime.realizedSbd.
 *                     חוק-השולחן: שוליים-שבועיים ≥ +1% = הגריד רשאי-להציב, אחרת מחזיק. הערך-עצמו הוא
 *                     נתון, לא פסק: ירוק = השולחן נמדד-ונקרא; כשל-רשת = UNKNOWN. חדר-אחד: הכרעת-
 *                     ההצבה שייכת ל-desk (market-exec governor) — האורקל מודד ומפרסם, לא מכריע.
 *   V-ZOMBIE-LADDER   סולם-הפקודות-הפתוחות של headcorner: `database_api.find_limit_orders
 *                     {"account":"headcorner"}` (השיטה שנבדקה-ועובדת — נספח-א' קריאה #15) → סכום
 *                     SBD/STEEM פתוח + ספירה + תת-סולם-זומבי (קניות @≤0.0995 SBD/STEEM — מתחת-למחיר,
 *                     לעולם לא יתמלאו כל-עוד המחיר מעליהן). מול-הריצה-הקודמת: יציב/נמלא → GREEN;
 *                     נעלם ללא-ראיה → AMBER (ביטול = פעולת-בעלים — דורש-בדיקה); ריצה-ראשונה/כשל → UNKNOWN.
 *
 * דלתא-רווחיות: netWorth מול-הריצה-הקודמת → PROFIT (> +0.5%) · FLAT (±0.5%) · LOSS (< −0.5%) · UNKNOWN.
 *
 * פסקים: GREEN / AMBER / RED / UNKNOWN — כנים. כשל-רשת לעולם לא "ירוק-מנוחש". אפס סודות בפלט
 * (scanner לפני-כתיבה, הפרה = אבוט). אין RED ב-v1: אין-כאן-עבירה-שאפשר לצרוח עליה — רק מדידה.
 *
 * שימוש:
 *   node ops/profit-oracle/oracle.mjs --selftest   # וקטורי-אפס-רשת (חייב הכל-ירוק)
 *   node ops/profit-oracle/oracle.mjs              # ריצה-חיה: כותב receipts/profit-oracle-latest.json + verdict.md
 *
 * אפס-תלות. node >= 18. ESM טהור.
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ══════════════════ חוקים-מספריים (המדידה מחייבת, לא הטענה) ══════════════════ */
export const LAWS = {
  RUNS_CAP: 12,                  // append-bounded: 12 ריצות אחרונות בלבד
  FETCH_TIMEOUT_MS: 15_000,
  ROSTER_SIZE: 14,               // מניפסט-14-החשבונות — פחות = UNKNOWN (כנות, לא מילוי)
  PROFIT_DELTA_PCT: 0.5,         // > +0.5% netWorth = PROFIT · < −0.5% = LOSS · אחרת FLAT
  ZOMBIE_MAX_SBD_PER_STEEM: 0.0995, // קניות מתחת-לזה = סולם-הזומבי (0.0985 נמדד 19:54Z) — לא יתמלאו
  ORDER_BOOK_DEPTH: 10,
  GRID_EDGE_LAW_PCT: 1.0,        // חוק-השולחן המצוטט: שוליים-שבועיים ≥ +1% = מותר-להציב (נתון, לא פסק)
  STEEM_RPC_PRIMARY: "https://api.steemit.com",
  STEEM_RPC_FALLBACK: "https://api.justyy.com", // גיבוי שנמדד בנספח-א' של ECONOMIC-PLAN
  PNL_DESK_URL: "https://roshpinacare-sys.github.io/Domain/dex/pnl-desk.json",
  LADDER_ACCOUNT: "headcorner",
};

/* מניפסט-14-החשבונות — הרשימה המדויקת כפי שנמדדה בקריאה #3 של נספח-א'
   (ECONOMIC-PLAN-2026-10-11.md · עבודה-מקומית econ10d/raw-measure.json · zai-10d 19:54Z):
   עוגן: headcorner · פוסטרים ×5: cashmachine, haran, israelnews, lsa, macrame ·
   מיקרו ×3: siq, tov, wic · wog, woq · חיילים-דור-חי ×3: hcsoldier4/5/6.
   hcsoldier1/2/3 מחוץ-למניפסט (LOST-NO-CUSTODY, מעוגן ב-ONE-ROSTER-2026-10-11.md + פסקי-r196/r200). */
export const ROSTER = [
  "headcorner",
  "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic",
  "wog", "woq",
  "hcsoldier4", "hcsoldier5", "hcsoldier6",
];

export const AGENT_ID = "profit-oracle v1 (zai-14b)";
export const RECEIPT_SCHEMA = "roshpinacare.profit-oracle/1";

/* נאי: nai @@000000021 = STEEM · @@000000013 = SBD (precision 3 לשניהם) */
export const NAI_STEEM = "@@000000021";
export const NAI_SBD = "@@000000013";

/* ══════════════════ עזרים ══════════════════ */
export function isoNow() {
  return new Date().toISOString();
}
export const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
export const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
export const r5 = (x) => (Number.isFinite(x) ? Math.round(x * 100000) / 100000 : null);

/** מנוע-HTTP נתין (injectable): מחזיר {status, body} או {status:0, error}. אף הדפסת-כותרות.
 *  תומך GET (Pages/raw) וגם POST (RPC): כל-האופציות עוברות, ה-headers ממוזגים סביב user-agent. */
export function defaultFetcher(url, opts = {}) {
  return fetch(url, {
    redirect: "follow",
    ...opts,
    headers: { "user-agent": "roshpinacare-profit-oracle/1 (keyless daily pulse)", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(LAWS.FETCH_TIMEOUT_MS),
  })
    .then(async (res) => ({ status: res.status, body: await res.text() }))
    .catch((e) => ({ status: 0, error: String((e && e.message) || e).slice(0, 120) }));
}

/** קריאת-RPC כנה: {ok:true,result} | {ok:false,error}. ללא-זריקות — כישלון = ערך. */
export async function rpcCall(fetcher, host, method, params) {
  let res;
  try {
    res = await fetcher(host, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
  if (!res || res.status !== 200 || res.error) {
    return { ok: false, error: `http ${res && res.status}${res && res.error ? ` (${res.error})` : ""}` };
  }
  let doc;
  try { doc = JSON.parse(res.body); }
  catch { return { ok: false, error: "גוף לא-JSON מהצומת" }; }
  if (doc.error) return { ok: false, error: String(doc.error.message || JSON.stringify(doc.error)).slice(0, 120) };
  if (doc.result === undefined) return { ok: false, error: "תשובה ללא result" };
  return { ok: true, result: doc.result };
}

/** עזר: כמות-נכס מ-string "123.456 SYM" → מספר (null כנה אם לא-קריא). */
export function assetNum(v) {
  if (typeof v !== "string") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** כמות-נכס-מובנית {amount, precision} → מספר יחידות. */
export function structuredNum(a) {
  if (!a || typeof a.amount !== "string" || !Number.isFinite(a.precision)) return null;
  const n = parseInt(a.amount, 10);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** a.precision;
}

/* ══════════════════ V-WORTH ══════════════════ */
/** חילוץ-מחיר-אמצע מספר-הזמנות — תומך צורה-מודרנית (real_price) וישנה (price). טהור. */
export function parseMidFromBook(book) {
  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;
  const best = (arr) => {
    for (const o of arr) {
      if (!o) continue;
      const p = typeof o.real_price === "string" ? parseFloat(o.real_price)
        : Number.isFinite(o.real_price) ? o.real_price
        : typeof o.price === "string" ? parseFloat(o.price)
        : Number.isFinite(o.price) ? o.price
        : null;
      if (Number.isFinite(p) && p > 0) return p;
    }
    return null;
  };
  const bid = best(book.bids);
  const ask = best(book.asks);
  if (bid == null || ask == null) return null;
  const mid = (bid + ask) / 2;
  return Number.isFinite(mid) && mid > 0 ? mid : null;
}

/** חישוב-שווי טהור מתשובות-צומת מלאות — הווקטורים-אופליין נבדקים כאן. */
export function computeWorth({ dgpo, accounts, orderBook }) {
  const tvf = assetNum(dgpo && dgpo.total_vesting_fund_steem);
  const tvs = assetNum(dgpo && dgpo.total_vesting_shares);
  if (tvf == null || tvs == null || tvs <= 0) {
    return { ok: false, reason: "dgpo-vesting-לא-קריא" };
  }
  const ratio = tvf / tvs; // SP לכל VESTS (שני-השדות באותן-יחידות)
  if (!Array.isArray(accounts) || accounts.length !== LAWS.ROSTER_SIZE) {
    return { ok: false, reason: `מניפסט-חלקי: ${Array.isArray(accounts) ? accounts.length : 0}/${LAWS.ROSTER_SIZE} חשבונות חזרו` };
  }
  let ownSp = 0, effSp = 0, liquidSteem = 0, liquidSbd = 0;
  for (const a of accounts) {
    const v = assetNum(a && a.vesting_shares);
    const d = assetNum(a && a.delegated_vesting_shares);
    const r = assetNum(a && a.received_vesting_shares);
    const st = assetNum(a && a.balance);
    const sb = assetNum(a && a.sbd_balance);
    if (v == null || d == null || r == null || st == null || sb == null) {
      return { ok: false, reason: `חשבון ${a && a.name || "?"} — שדה-שרשרת לא-קריא` };
    }
    ownSp += v * ratio;                 // הון-בבעלות (כולל-האצלות-שיוצאות — חוזרות תוך ≤5d)
    effSp += (v - d + r) * ratio;       // הון-בתוקף עכשיו
    liquidSteem += st;
    liquidSbd += sb;
  }
  const mid = parseMidFromBook(orderBook);
  const netWorthSbdEquiv = mid != null ? ownSp * mid + liquidSbd + liquidSteem * mid : null;
  return { ok: true, ratio, ownSp, effSp, liquidSteem, liquidSbd, mid, netWorthSbdEquiv };
}

function parseBest(arr) {
  for (const o of arr || []) {
    const p = o && typeof o.real_price === "string" ? parseFloat(o.real_price) : o && o.real_price;
    if (Number.isFinite(p) && p > 0) return p;
  }
  return NaN;
}

export async function checkWorth({ fetcher }) {
  const measuredAt = isoNow();
  const hosts = [LAWS.STEEM_RPC_PRIMARY, LAWS.STEEM_RPC_FALLBACK];
  const callWithFallback = async (method, params) => {
    let lastErr = null;
    for (const h of hosts) {
      const r = await rpcCall(fetcher, h, method, params);
      if (r.ok) return r;
      lastErr = r.error;
    }
    return { ok: false, error: lastErr || "כל-הצמתים כשלו" };
  };

  const dgpoRes = await callWithFallback("condenser_api.get_dynamic_global_properties", []);
  const accRes = await callWithFallback("condenser_api.get_accounts", [ROSTER]);
  const bookRes = await callWithFallback("condenser_api.get_order_book", [LAWS.ORDER_BOOK_DEPTH]);

  const ev = {
    rpc: { primary: LAWS.STEEM_RPC_PRIMARY, fallback: LAWS.STEEM_RPC_FALLBACK },
    dgpo: dgpoRes.ok, accounts: accRes.ok, orderBook: bookRes.ok,
  };
  const base = { id: "V-WORTH", measuredAt, evidence: ev };
  if (!dgpoRes.ok || !accRes.ok || !bookRes.ok) {
    const failed = !dgpoRes.ok ? "dgpo" : !accRes.ok ? "get_accounts" : "order_book";
    return { ...base, verdict: "UNKNOWN",
      evidence: { ...ev, error: failed === "dgpo" ? dgpoRes.error : failed === "get_accounts" ? accRes.error : bookRes.error },
      note: `כשל-RPC ב-${failed} — לא מנחשים שווי (fail-open, R5)` };
  }
  const w = computeWorth({ dgpo: dgpoRes.result, accounts: accRes.result, orderBook: bookRes.result });
  if (!w.ok) {
    return { ...base, verdict: "UNKNOWN", evidence: { ...ev, reason: w.reason },
      note: `צורה-שבורה: ${w.reason} — לא מנחשים שווי` };
  }
  const spreadBps = w.mid != null && Number.isFinite(parseBest(bookRes.result.asks)) && Number.isFinite(parseBest(bookRes.result.bids))
    ? ((parseBest(bookRes.result.asks) - parseBest(bookRes.result.bids)) / w.mid) * 10000
    : null;
  return {
    ...base, verdict: "GREEN",
    evidence: {
      ...ev,
      ratioSpPerVests: Number(w.ratio.toFixed(12)),
      ownSp: r1(w.ownSp), effSp: r1(w.effSp),
      liquidSteem: r3(w.liquidSteem), liquidSbd: r3(w.liquidSbd),
      mid: r5(w.mid), spreadBps: spreadBps != null && Number.isFinite(spreadBps) ? Number(spreadBps.toFixed(1)) : null,
      netWorthSbdEquiv: w.netWorthSbdEquiv != null ? r3(w.netWorthSbdEquiv) : null,
      roster: ROSTER.length,
    },
    note: `🟢 שווי-חי: own-SP ${r1(w.ownSp)} · eff-SP ${r1(w.effSp)} · נזיל ${r3(w.liquidSteem)} STEEM + ${r3(w.liquidSbd)} SBD · mid ${r5(w.mid)} → netWorth ${w.netWorthSbdEquiv != null ? r3(w.netWorthSbdEquiv) : "—"} SBD-equiv`,
  };
}

/* ══════════════════ V-GRID-EDGE ══════════════════ */
/** ניתוח-שולחן-pnl טהור — ירוק = נמדד-ונקרא; צורה-שבורה/כשל-רשת = UNKNOWN (הערך הוא נתון, לא פסק). */
export function parsePnlDesk(doc) {
  if (!doc || typeof doc !== "object") return { ok: false, reason: "לא-אובייקט" };
  const verdict = typeof doc.verdict === "string" ? doc.verdict : null;
  const edgePct = doc.postLaw && Number.isFinite(doc.postLaw.edgePct) ? doc.postLaw.edgePct : null;
  const realizedSbd = doc.lifetime && Number.isFinite(doc.lifetime.realizedSbd) ? doc.lifetime.realizedSbd : null;
  if (verdict == null || edgePct == null || realizedSbd == null) {
    return { ok: false, reason: `שדות-חסרים: verdict=${verdict != null} · postLaw.edgePct=${edgePct != null} · lifetime.realizedSbd=${realizedSbd != null}` };
  }
  return { ok: true, verdict, edgePct, realizedSbd, generatedAt: doc.generatedAt || null, law: doc.law || null };
}

export async function checkGridEdge({ fetcher }) {
  const measuredAt = isoNow();
  let res;
  try {
    res = await fetcher(LAWS.PNL_DESK_URL);
  } catch (e) {
    return { id: "V-GRID-EDGE", verdict: "UNKNOWN", measuredAt,
      evidence: { url: LAWS.PNL_DESK_URL, error: String((e && e.message) || e).slice(0, 120) },
      note: "כשל-רשת בשליפת pnl-desk — לא מנחשים שוליים" };
  }
  if (!res || res.status !== 200 || res.error) {
    return { id: "V-GRID-EDGE", verdict: "UNKNOWN", measuredAt,
      evidence: { url: LAWS.PNL_DESK_URL, http: res && res.status, error: (res && res.error) || null },
      note: `pnl-desk לא-נמדד: http ${res && res.status} — כשל-רשת שלנו, לא פסק על הגריד` };
  }
  let doc;
  try { doc = JSON.parse(res.body); }
  catch {
    return { id: "V-GRID-EDGE", verdict: "UNKNOWN", measuredAt,
      evidence: { url: LAWS.PNL_DESK_URL, http: 200 },
      note: "גוף לא-JSON — צורה-שבורה, לא מנחשים" };
  }
  const p = parsePnlDesk(doc);
  if (!p.ok) {
    return { id: "V-GRID-EDGE", verdict: "UNKNOWN", measuredAt,
      evidence: { url: LAWS.PNL_DESK_URL, http: 200, reason: p.reason },
      note: `צורה-שבורה: ${p.reason} — fail-open` };
  }
  return {
    id: "V-GRID-EDGE", verdict: "GREEN", measuredAt,
    evidence: { url: LAWS.PNL_DESK_URL, http: 200, verdict: p.verdict, postLawEdgePct: p.edgePct,
      lifetimeRealizedSbd: p.realizedSbd, generatedAt: p.generatedAt, deskLaw: p.law, edgeLawPct: LAWS.GRID_EDGE_LAW_PCT },
    note: `🟢 השולחן נמדד: verdict=${p.verdict} · postLaw.edgePct=${p.edgePct}% · lifetime.realizedSbd=${p.realizedSbd} SBD (חוק-השולחן: ≥+${LAWS.GRID_EDGE_LAW_PCT}% = מותר-להציב; ההכרעה ב-desk — חדר-אחד)`,
  };
}

/* ══════════════════ V-ZOMBIE-LADDER ══════════════════ */
/** סיכום-סולם טהור: סכום-SBD/STEEM פתוח + ספירה + תת-סולם-זומבי (קניות מתחת-לחוק). */
export function summarizeLadder(orders, zombieMax = LAWS.ZOMBIE_MAX_SBD_PER_STEEM) {
  if (!Array.isArray(orders)) return { ok: false };
  let openSbd = 0, openSteem = 0, zombieSbd = 0, zombieCount = 0;
  for (const o of orders) {
    const sp = o && o.sell_price;
    if (!sp || !sp.base || !sp.quote) return { ok: false };
    const base = structuredNum(sp.base);
    const quote = structuredNum(sp.quote);
    if (base == null || quote == null) return { ok: false };
    if (sp.base.nai === NAI_STEEM) {
      // מוכר STEEM תמורת SBD → הערך-הנעול שווה-ערך ל-SBD שיתקבל
      openSteem += base; openSbd += quote;
    } else if (sp.base.nai === NAI_SBD) {
      // קונה STEEM ב-SBD → SBD נעול = ה-base; מחיר-אפקטיבי = base/quote SBD ל-STEEM
      openSbd += base; openSteem += quote;
      const price = base / quote;
      if (Number.isFinite(price) && price <= zombieMax) { zombieSbd += base; zombieCount += 1; }
    } else {
      return { ok: false };
    }
  }
  return { ok: true, count: orders.length, openSbd, openSteem, zombieSbd, zombieCount };
}

/** פסק-סולם טהור מול-בסיס — וקטורי-גבול נבדקים ב-selftest. */
export function classifyLadder({ ladder, prior }) {
  if (!ladder || !ladder.ok) return { verdict: "UNKNOWN", note: "קריאת-פקודות לא-נמדדה — לא מנחשים" };
  const priorHas = !!(prior && (prior.ladderCount > 0 || (Number.isFinite(prior.ladderOpenSbd) && prior.ladderOpenSbd > 0)));
  if (!priorHas) {
    return { verdict: "UNKNOWN", note: "ריצה-ראשונה / אין-בסיס-קודם — הסולם נמדד, הדלתא תימדד מחר" };
  }
  const standing = ladder.count > 0 && ladder.openSbd > 0;
  if (standing) {
    return { verdict: "GREEN",
      note: `🟢 סולם-עומד: ${ladder.count} פקודות · ${r3(ladder.openSbd)} SBD פתוח (מהם זומבי ${r3(ladder.zombieSbd)} SBD @≤${LAWS.ZOMBIE_MAX_SBD_PER_STEEM}) — יציב או מתמלא` };
  }
  return { verdict: "AMBER",
    note: `🟠 הסולם נעלם (0 פקודות) מול-בסיס עומד — מילוי-טבעי או ביטול; ביטול = פעולת-בעלים (דורש-אימות get_account_history) — כנה, לא מושתק` };
}

export async function checkLadder({ fetcher, priorSummary }) {
  const measuredAt = isoNow();
  const hosts = [LAWS.STEEM_RPC_PRIMARY, LAWS.STEEM_RPC_FALLBACK];
  let lastErr = null, res = null;
  for (const h of hosts) {
    res = await rpcCall(fetcher, h, "database_api.find_limit_orders", { account: LAWS.LADDER_ACCOUNT });
    if (res.ok) break;
    lastErr = res.error;
  }
  if (!res || !res.ok) {
    return { id: "V-ZOMBIE-LADDER", verdict: "UNKNOWN", measuredAt,
      evidence: { method: "database_api.find_limit_orders", account: LAWS.LADDER_ACCOUNT, error: lastErr },
      note: "כשל-RPC בסריקת-הפקודות — לא מנחשים" };
  }
  const ladder = summarizeLadder(res.result && res.result.orders);
  if (!ladder.ok) {
    return { id: "V-ZOMBIE-LADDER", verdict: "UNKNOWN", measuredAt,
      evidence: { method: "database_api.find_limit_orders", account: LAWS.LADDER_ACCOUNT },
      note: "צורת-פקודה לא-קריאה — fail-open" };
  }
  const cls = classifyLadder({ ladder, prior: priorSummary });
  return {
    id: "V-ZOMBIE-LADDER", verdict: cls.verdict, measuredAt,
    evidence: {
      method: "database_api.find_limit_orders", account: LAWS.LADDER_ACCOUNT,
      count: ladder.count, openSbd: r3(ladder.openSbd), openSteem: r3(ladder.openSteem),
      zombieSbd: r3(ladder.zombieSbd), zombieCount: ladder.zombieCount,
      priorCount: priorSummary ? priorSummary.ladderCount ?? null : null,
      priorOpenSbd: priorSummary ? priorSummary.ladderOpenSbd ?? null : null,
    },
    note: cls.note,
  };
}

/* ══════════════════ דלתא-רווחיות (טהור) ══════════════════ */
export function classifyDelta(nowNetWorth, priorNetWorth, thresholdPct = LAWS.PROFIT_DELTA_PCT) {
  if (!Number.isFinite(nowNetWorth) || nowNetWorth == null || !Number.isFinite(priorNetWorth) || priorNetWorth == null || priorNetWorth <= 0) {
    return { deltaPct: null, verdict: "UNKNOWN", note: "אין-בסיס קודם / שווי לא-נמדד — UNKNOWN כן" };
  }
  const deltaPct = ((nowNetWorth - priorNetWorth) / priorNetWorth) * 100;
  const verdict = deltaPct > thresholdPct ? "PROFIT" : deltaPct < -thresholdPct ? "LOSS" : "FLAT";
  return { deltaPct: Number(deltaPct.toFixed(3)), verdict,
    note: `${verdict}: ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(3)}% מול-הריצה-הקודמת (חוק: > +${thresholdPct}% / < −${thresholdPct}%)` };
}

/* ══════════════════ ריצה-מלאה ══════════════════ */
export async function runAll({ nowMs = Date.now(), fetcher = defaultFetcher, trigger = "local", priorSummary = null } = {}) {
  const checks = [];
  checks.push(await checkWorth({ fetcher }));
  checks.push(await checkGridEdge({ fetcher }));
  checks.push(await checkLadder({ fetcher, priorSummary }));
  const summarize = { GREEN: 0, AMBER: 0, RED: 0, UNKNOWN: 0 };
  for (const c of checks) summarize[c.verdict] = (summarize[c.verdict] || 0) + 1;

  /* מספרים-כלכליים מתוך V-WORTH (מקור-האמת היחיד לשווי) */
  const worth = checks[0];
  const ev = worth.evidence || {};
  const netWorth = ev.netWorthSbdEquiv != null ? ev.netWorthSbdEquiv : null;
  const delta = classifyDelta(netWorth, priorSummary ? priorSummary.netWorthSbdEquiv : null);
  const grid = checks[1];
  const gev = grid.evidence || {};
  const ladder = checks[2];
  const lev = ladder.evidence || {};

  const summary = {
    GREEN: summarize.GREEN, AMBER: summarize.AMBER, RED: summarize.RED, UNKNOWN: summarize.UNKNOWN,
    ownSp: ev.ownSp ?? null,
    effSp: ev.effSp ?? null,
    liquidSteem: ev.liquidSteem ?? null,
    liquidSbd: ev.liquidSbd ?? null,
    mid: ev.mid ?? null,
    netWorthSbdEquiv: netWorth,
    deltaVsPriorPct: delta.deltaPct,
    gridVerdict: gev.verdict ?? null,
    gridEdgePct: gev.postLawEdgePct ?? null,
    ladderOpenSbd: lev.openSbd ?? null,
    ladderCount: lev.count ?? null,
    ladderZombieSbd: lev.zombieSbd ?? null,
    verdict: delta.verdict,
  };
  return { at: new Date(nowMs).toISOString(), trigger, checks, summary, deltaNote: delta.note };
}

/* ══════════════════ פנקס-מאוחד (union receipt) — append-bounded ══════════════════ */
export function unionAppend(existing, run, { cap = LAWS.RUNS_CAP, prior } = {}) {
  const doc = existing && typeof existing === "object" ? { ...existing } : {};
  doc.ok = true;
  doc.schema = doc.schema || RECEIPT_SCHEMA;
  doc.agent = doc.agent || AGENT_ID;
  doc.law = doc.law ||
    "keyless daily profitability pulse: V-WORTH (14-roster own/eff SP + liquid + order-book mid → netWorthSbdEquiv) · V-GRID-EDGE (pnl-desk verdict/edge/realized — value is data, desk decides) · V-ZOMBIE-LADDER (headcorner open orders vs prior: vanished = AMBER until fill/cancel verified); delta > +0.5% = PROFIT, ±0.5% = FLAT, < −0.5% = LOSS; network failure = UNKNOWN + reason, never guessed";
  doc.gate = doc.gate || "profit-oracle (zai-14b) — standing daily profit pulse; joins zai-12b's fresh-oracle house pattern; owner trace 1a12d502a99b7021 'the autonomy itself checks profitability daily'";
  /* prior — נקבע-פעם-אחת (הפנקס כפי-שעמד לפני-הכתיבה-המאוחדת-הראשונה = מדידת-הזרע), אחר-כך נשמר מילה-במילה לנצח. */
  if (doc.prior === undefined || doc.prior === null) {
    doc.prior = prior !== undefined ? prior : null;
  }
  const runs = Array.isArray(doc.runs) ? doc.runs.slice() : [];
  runs.push(run);
  doc.runs = runs.slice(-cap); /* append-bounded: 12 אחרונות */
  doc.updatedAt = run.at;
  doc.at = run.at;
  doc.summary = { ...run.summary }; /* מצב-עדכני = הריצה-האחרונה */
  return doc;
}

/* ══════════════════ סריקת-סודות (auditor לפני-כתיבה — הפרה = אבוט) ══════════════════ */
export function scanSecrets(text) {
  const findings = [];
  const push = (kind, idx) => findings.push({ kind, index: idx });
  /* WIF: לא-דחוס = 51 תווי-base58 המתחילים ב-5 · דחוס = 52 המתחילים K/L */
  const wif = /\b5[1-9A-HJ-NP-Za-km-z]{50}\b|\b[KL][1-9A-HJ-NP-Za-km-z]{51}\b/g;
  let m;
  while ((m = wif.exec(text))) { push("WIF-like-51char-base58", m.index); }
  /* טוקני-GitHub */
  const gh = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g;
  while ((m = gh.exec(text))) { push("github-token-pattern", m.index); }
  /* שדות-חומר-מפתות ב-JSON */
  const fields = /"(?:steem_?wif|active_?wif|posting_?wif|owner_?wif|memo_?wif|private_?key|password|secret_?key)"\s*:/gi;
  while ((m = fields.exec(text))) { push("secret-field-name", m.index); }
  return findings;
}

/* ══════════════════ verdict.md (עברית, מתחדש כל-ריצה) ══════════════════ */
export function renderVerdictMd(run) {
  const badge = { GREEN: "🟢", AMBER: "🟠", RED: "🔴", UNKNOWN: "⚪" };
  const short = (v) => String(v ?? "—").slice(0, 90).replace(/\|/g, "/");
  const s = run.summary;
  const verdictIcon = { PROFIT: "📈", FLAT: "➖", LOSS: "📉", UNKNOWN: "❔" }[s.verdict] || "❔";
  const rows = run.checks.map((c) => {
    let ev = "";
    if (c.id === "V-WORTH") ev = `own ${c.evidence.ownSp} · eff ${c.evidence.effSp} · mid ${c.evidence.mid} · netWorth ${c.evidence.netWorthSbdEquiv}`;
    else if (c.id === "V-GRID-EDGE") ev = `${c.evidence.verdict ?? "—"} · edge ${c.evidence.postLawEdgePct ?? "—"}% · realized ${c.evidence.lifetimeRealizedSbd ?? "—"} SBD`;
    else if (c.id === "V-ZOMBIE-LADDER") ev = `${c.evidence.count ?? "—"} פקודות · ${c.evidence.openSbd ?? "—"} SBD (זומבי ${c.evidence.zombieSbd ?? "—"} SBD ×${c.evidence.zombieCount ?? "—"})`;
    return `| ${badge[c.verdict] || "—"} ${c.id} | ${c.verdict} | ${short(ev)} | ${short(c.note)} |`;
  });
  return [
    "# profit-oracle — פסק-רווחיות-עדכני (פעימה-יומית, אפס-מפתחות)",
    "",
    `> נמדד: ${run.at} · מפעיל: ${run.trigger} · בדיקות: ${s.GREEN} ירוק · ${s.AMBER} כתום · ${s.RED} אדום · ${s.UNKNOWN} לא-ידוע`,
    "",
    `## ${verdictIcon} דלתא-רווחיות: ${s.verdict}`,
    "",
    `- netWorth (own-SP×mid + נזיל-SBD + נזיל-STEEM×mid): **${s.netWorthSbdEquiv ?? "—"} SBD-equiv**`,
    `- דלתא מול-הריצה-הקודמת: **${s.deltaVsPriorPct == null ? "—" : (s.deltaVsPriorPct >= 0 ? "+" : "") + s.deltaVsPriorPct + "%"}** (חוק: > +0.5% = PROFIT · ±0.5% = FLAT · < −0.5% = LOSS)`,
    `- own-SP **${s.ownSp ?? "—"}** · eff-SP **${s.effSp ?? "—"}** · נזיל **${s.liquidSteem ?? "—"} STEEM + ${s.liquidSbd ?? "—"} SBD** · mid **${s.mid ?? "—"}**`,
    `- גריד: verdict **${s.gridVerdict ?? "—"}** · postLaw.edgePct **${s.gridEdgePct ?? "—"}%** (חוק-השולחן: ≥+1% = מותר-להציב)`,
    `- סולם-פתוח: **${s.ladderOpenSbd ?? "—"} SBD** על **${s.ladderCount ?? "—"} פקודות** (תת-סולם-זומבי: ${s.ladderZombieSbd ?? "—"} SBD)`,
    "",
    "| בדיקה | פסק | ראיות | הערה |",
    "|---|---|---|---|",
    ...rows,
    "",
    "**חוקים:** אין ירוק בלי מדידה (R1) · כשל-רשת = UNKNOWN + סיבה (R5) · אפס-מפתחות, קריאות-ציבוריות בלבד · ההכרעה-על-ההצבה ב-pnl-desk (חדר-אחד) — האורקל מודד ומפרסם.",
    "",
    `_הקובץ נוצר אוטומטית — אל תערכו ידנית; הריצה-הבאה מחליפה אותו._`,
    "",
  ].join("\n");
}

/* ══════════════════ selftest — וקטורים, אפס-רשת ══════════════════ */
export async function selftest() {
  const vectors = [];
  const vec = (name, pass, detail = "") => vectors.push({ name, pass: !!pass, detail: String(detail).slice(0, 140) });

  /* ── מנוע-RPC מדומה: fixtures לפי-שיטה (14 חשבונות — כחוק-המניפסט) ── */
  const DGPO = { total_vesting_fund_steem: "1000000.000 STEEM", total_vesting_shares: "2000000.000 VESTS" };
  const ACC_A = { name: "acct-a", vesting_shares: "100.000000 VESTS", delegated_vesting_shares: "20.000000 VESTS",
    received_vesting_shares: "30.000000 VESTS", balance: "2.000 STEEM", sbd_balance: "3.000 SBD" };
  const ACC14 = Array.from({ length: LAWS.ROSTER_SIZE }, (_, i) => ({ ...ACC_A, name: `acct-${i}` }));
  const BOOK = { bids: [{ real_price: "0.10000000000000000", order_price: { base: "1.000 STEEM", quote: "0.100 SBD" } }],
    asks: [{ real_price: "0.10200000000000000", order_price: { base: "1.000 STEEM", quote: "0.102 SBD" } }] };
  /* 14 חשבונות: own-SP = Σ vests×ratio = 14×100×0.5 = 700 · eff-SP = Σ (vests−del+recv)×ratio = 14×55 = 770
     liq = 28 STEEM + 42 SBD · mid = (0.100+0.102)/2 = 0.101
     netWorth = 700×0.101 + 42 + 28×0.101 = 115.528 */
  const W = { ownSp: 700, effSp: 770, liquidSteem: 28, liquidSbd: 42, mid: 0.101, netWorthSbdEquiv: 115.528 };
  const PNL_OK = { format: "saos-pnl-desk/1", generatedAt: "2026-10-11T15:02:49.879Z",
    law: "weekly edge >= +1% or the grid holds",
    postLaw: { edgePct: -3 }, lifetime: { realizedSbd: -0.388666 }, verdict: "EDGE-NEGATIVE-GRID-HOLD" };

  const rpcFixture = (over = {}) => async (url, opts = {}) => {
    if (url === LAWS.PNL_DESK_URL) return { status: 200, body: JSON.stringify(PNL_OK) };
    if (url !== LAWS.STEEM_RPC_PRIMARY) return { status: 0, error: "fallback-not-in-mock" };
    let body = {};
    try { body = JSON.parse(opts.body); } catch { /* noop */ }
    const m = body.method || "";
    if (over[m]) return over[m]();
    if (m === "condenser_api.get_dynamic_global_properties") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: DGPO }) };
    if (m === "condenser_api.get_accounts") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: ACC14 }) };
    if (m === "condenser_api.get_order_book") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: BOOK }) };
    if (m === "database_api.find_limit_orders") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { orders: [] } }) };
    return { status: 404, body: "no route" };
  };

  /* ── 1: V-WORTH ריצה-מלאה מדומה → GREEN + מספרים-מדויקים ── */
  const worthOk = await checkWorth({ fetcher: rpcFixture() });
  vec("V-WORTH mock-success → GREEN + exact own/eff/liquid/mid/netWorth vector",
    worthOk.verdict === "GREEN"
      && worthOk.evidence.ownSp === W.ownSp && worthOk.evidence.effSp === W.effSp
      && worthOk.evidence.liquidSteem === W.liquidSteem && worthOk.evidence.liquidSbd === W.liquidSbd
      && Math.abs(worthOk.evidence.mid - W.mid) < 1e-12
      && Math.abs(worthOk.evidence.netWorthSbdEquiv - W.netWorthSbdEquiv) < 1e-9,
    `got ${JSON.stringify({ o: worthOk.evidence.ownSp, e: worthOk.evidence.effSp, m: worthOk.evidence.mid, n: worthOk.evidence.netWorthSbdEquiv })}`);

  /* ── 2: V-WORTH צורה-שבורה (שדה-שרשרת חסר) → UNKNOWN ── */
  const brokenFixture = rpcFixture({
    "condenser_api.get_accounts": () => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: [{ ...ACC_A, balance: undefined }] }) }),
  });
  const worthBroken = await checkWorth({ fetcher: brokenFixture });
  vec("V-WORTH shape-broken (account field missing) → UNKNOWN + reason",
    worthBroken.verdict === "UNKNOWN" && /לא-קריא|שבורה/.test(worthBroken.note), worthBroken.note);

  /* ── 3: V-WORTH מניפסט-חלקי (1/14 חזרו) → UNKNOWN ── */
  const partialFixture = rpcFixture({
    "condenser_api.get_accounts": () => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: [ACC_A] }) }),
  });
  const worthPartial = await checkWorth({ fetcher: partialFixture });
  vec("V-WORTH partial roster (1/14) → UNKNOWN (honest, no fill-in)",
    worthPartial.verdict === "UNKNOWN" && /מניפסט-חלקי|1\/14/.test(JSON.stringify(worthPartial.evidence) + worthPartial.note),
    worthPartial.note);

  /* ── 4: V-WORTH כשל-RPC → UNKNOWN ── */
  const deadFetcher = async () => ({ status: 0, error: "ECONNREFUSED-mock" });
  const worthDead = await checkWorth({ fetcher: deadFetcher });
  vec("V-WORTH RPC fail (both hosts) → UNKNOWN + reason recorded",
    worthDead.verdict === "UNKNOWN" && /ECONNREFUSED-mock|dgpo/.test(JSON.stringify(worthDead.evidence) + worthDead.note),
    worthDead.note);

  /* ── 5: parseMid — צורה-ישנה (price) + ספר-ריק → null (NaN-guard) ── */
  const midLegacy = parseMidFromBook({ bids: [{ price: "0.099" }], asks: [{ price: "0.101" }] });
  const midEmpty = parseMidFromBook({ bids: [], asks: [] });
  vec("mid: legacy price-shape parsed (0.100) · empty book → null (no NaN poison)",
    Math.abs(midLegacy - 0.1) < 1e-12 && midEmpty === null,
    `legacy=${midLegacy} empty=${midEmpty}`);

  /* ── 6..8: V-GRID-EDGE ok / צורה-שבורה / כשל-רשת ── */
  const gridOk = await checkGridEdge({ fetcher: rpcFixture() });
  vec("V-GRID-EDGE fetched+parsed → GREEN + verdict/edge/realized extracted (value is data, not verdict)",
    gridOk.verdict === "GREEN" && gridOk.evidence.verdict === "EDGE-NEGATIVE-GRID-HOLD"
      && gridOk.evidence.postLawEdgePct === -3 && gridOk.evidence.lifetimeRealizedSbd === -0.388666,
    gridOk.note);
  const gridBroken = await checkGridEdge({ fetcher: async () => ({ status: 200, body: JSON.stringify({ format: "saos-pnl-desk/1", verdict: "X" }) }) });
  vec("V-GRID-EDGE shape-broken (missing postLaw/lifetime) → UNKNOWN",
    gridBroken.verdict === "UNKNOWN", gridBroken.note);
  const gridDead = await checkGridEdge({ fetcher: deadFetcher });
  vec("V-GRID-EDGE fetch fail → UNKNOWN + reason",
    gridDead.verdict === "UNKNOWN" && /ECONNREFUSED-mock|לא-נמדד/.test(gridDead.note), gridDead.note);

  /* ── 9..12: V-ZOMBIE-LADDER עומד / נעלם / ריצה-ראשונה + מתמטיקת-זומבי ── */
  const ZOMBIE = { orders: [
    { sell_price: { base: { amount: "91195", nai: NAI_SBD, precision: 3 }, quote: { amount: "925834", nai: NAI_STEEM, precision: 3 } } },
  ] };
  const ladderStanding = classifyLadder({ ladder: summarizeLadder(ZOMBIE.orders), prior: { ladderCount: 5, ladderOpenSbd: 91.195 } });
  vec("V-ZOMBIE-LADDER standing (zombie @0.0985 recognized: 91.195 SBD base) → GREEN",
    ladderStanding.verdict === "GREEN" && /סולם-עומד/.test(ladderStanding.note), ladderStanding.note);
  const ladderVanished = classifyLadder({ ladder: summarizeLadder([]), prior: { ladderCount: 5, ladderOpenSbd: 91.195 } });
  vec("V-ZOMBIE-LADDER vanished vs standing prior → AMBER (fill or owner-cancel, honest)",
    ladderVanished.verdict === "AMBER" && /פעולת-בעלים/.test(ladderVanished.note), ladderVanished.note);
  const ladderFirst = classifyLadder({ ladder: summarizeLadder(ZOMBIE.orders), prior: null });
  vec("V-ZOMBIE-LADDER first run (no prior) → UNKNOWN (baseline starts today)",
    ladderFirst.verdict === "UNKNOWN", ladderFirst.note);
  const zSum = summarizeLadder(ZOMBIE.orders);
  vec("ladder math: SBD-base order 91.195 SBD @ 925.834 STEEM → price 0.098498 ≤ 0.0995 → zombie counted",
    zSum.ok && zSum.zombieCount === 1 && Math.abs(zSum.zombieSbd - 91.195) < 1e-9
      && Math.abs(zSum.openSbd - 91.195) < 1e-9 && Math.abs(zSum.openSteem - 925.834) < 1e-9,
    JSON.stringify(zSum));

  /* ── 13..16: דלתא-רווחיות PROFIT/FLAT/LOSS/UNKNOWN ── */
  const dP = classifyDelta(101.2, 100);
  const dF1 = classifyDelta(100.5, 100);
  const dF2 = classifyDelta(99.5, 100);
  const dL = classifyDelta(98, 100);
  const dU = classifyDelta(null, 100);
  vec("delta +1.2% → PROFIT (threshold > +0.5)",
    dP.verdict === "PROFIT" && Math.abs(dP.deltaPct - 1.2) < 1e-9, JSON.stringify(dP));
  vec("delta ±0.5 boundary → FLAT exactly at +0.5 and −0.5",
    dF1.verdict === "FLAT" && dF2.verdict === "FLAT", `${dF1.verdict}/${dF2.verdict}`);
  vec("delta −2.0% → LOSS",
    dL.verdict === "LOSS" && Math.abs(dL.deltaPct + 2) < 1e-9, JSON.stringify(dL));
  vec("delta null/invalid basis → UNKNOWN (no prior, never guessed)",
    dU.verdict === "UNKNOWN" && dU.deltaPct === null, JSON.stringify(dU));

  /* ── 17: runAll end-to-end offline (mock) — summary contract fields present
     netWorth 115.528 מול-בסיס 117 → דלתא −1.258% → LOSS · סולם ריק מול-בסיס עומד → AMBER ── */
  const runMock = await runAll({ nowMs: Date.parse("2026-10-12T05:29:00Z"), fetcher: rpcFixture(), trigger: "selftest", priorSummary: { netWorthSbdEquiv: 117, ladderCount: 1, ladderOpenSbd: 91.195 } });
  const need = ["GREEN", "AMBER", "RED", "UNKNOWN", "ownSp", "effSp", "liquidSteem", "liquidSbd", "mid",
    "netWorthSbdEquiv", "deltaVsPriorPct", "gridVerdict", "gridEdgePct", "ladderOpenSbd", "verdict"];
  const missing = need.filter((k) => !(k in runMock.summary));
  vec("runAll offline: 3 checks + contract summary fields (delta −1.258% → LOSS · ladder vanished → AMBER)",
    runMock.checks.length === 3 && missing.length === 0 && runMock.summary.verdict === "LOSS"
      && runMock.summary.GREEN === 2 && runMock.summary.AMBER === 1
      && Math.abs(runMock.summary.deltaVsPriorPct + 1.258) < 1e-9,
    `missing=${missing.join(",")} verdict=${runMock.summary.verdict} d=${runMock.summary.deltaVsPriorPct} G=${runMock.summary.GREEN} A=${runMock.summary.AMBER}`);

  /* ── 18: union — cap 12 + prior נקבע-פעם-אחת ונשמר מילה-במילה ── */
  const seed = { ok: true, at: "2026-10-11T23:00:00Z", agent: AGENT_ID, summary: { GREEN: 3 }, runs: [{ at: "2026-10-11T23:00:00Z", summary: { GREEN: 3 } }], prior: null };
  const mkRun = (i) => ({ at: `2026-10-12T00:${String(i % 60).padStart(2, "0")}:00Z`, trigger: "test", checks: [], summary: { GREEN: i } });
  /* ריצה-2 כמו ב-main: הפנקס-הקיים (prior==null) מתעד מילה-במילה; אחר-כך קפוא לנצח */
  const d1 = unionAppend(seed, mkRun(0), { prior: seed });
  let d2 = d1;
  for (let i = 1; i < 15; i++) d2 = unionAppend(d2, mkRun(i), {}); // עוד 14 ריצות — prior לא נוגע שוב
  vec("union: 15 runs → cap 12 (oldest dropped) · seed receipt pinned verbatim as prior once, never re-nested",
    d2.runs.length === 12 && d2.runs[0].at === "2026-10-12T00:03:00Z" && d2.runs[11].at === "2026-10-12T00:14:00Z"
      && JSON.stringify(d2.prior) === JSON.stringify(seed) && d2.summary.GREEN === 14 && d2.at === d2.runs[11].at,
    `len=${d2.runs.length} priorKept=${JSON.stringify(d2.prior) === JSON.stringify(seed)}`);

  /* ── 19: סריקת-סודות — תופסת חומר-מפתות, לא טועה על פלט-נקי ── */
  const fakeWif = "5H" + "p".repeat(49);
  const poisoned = JSON.stringify({ a: fakeWif, t: "ghp_" + "A".repeat(36), f: "github_pat_" + "B".repeat(22), d: { active_wif: "x" } });
  const found = scanSecrets(poisoned);
  const kinds = new Set(found.map((f) => f.kind));
  const clean = JSON.stringify({ id: "V-WORTH", ownSp: 4294.4, url: LAWS.PNL_DESK_URL, note: "שווי-חי" });
  const cleanFound = scanSecrets(clean);
  vec("secret scan catches WIF/5H + ghp_ + github_pat_ + secret-field; clean output passes (no false positive)",
    kinds.has("WIF-like-51char-base58") && kinds.has("github-token-pattern") && kinds.has("secret-field-name") && cleanFound.length === 0,
    `poisonedKinds=${[...kinds].join(",")} cleanFindings=${cleanFound.length}`);

  /* ── דיווח ── */
  const passed = vectors.filter((v) => v.pass).length;
  console.log(`selftest: ${passed}/${vectors.length} vectors green`);
  for (const v of vectors) {
    console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name}${v.pass ? "" : `  → ${v.detail}`}`);
  }
  return { passed, total: vectors.length, ok: passed === vectors.length };
}

/* ══════════════════ main ══════════════════ */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function main() {
  if (process.argv.includes("--selftest")) {
    const r = await selftest();
    process.exit(r.ok ? 0 : 1);
  }

  const root = repoRoot();
  const latestPath = path.join(root, "receipts", "profit-oracle-latest.json");

  /* קריאת-הפנקס-הקיים לפני-המדידה: בסיס-הדלתא = הריצה-האחרונה · prior-מתעד = הפנקס-כפי-שעמד */
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(latestPath, "utf8")); } catch { /* first write */ }
  const priorSummary = existing && Array.isArray(existing.runs) && existing.runs.length
    ? existing.runs[existing.runs.length - 1].summary || null
    : existing && existing.summary ? existing.summary : null;
  const priorPin = existing && (existing.prior == null) ? existing : undefined; // מתעד-פעם-אחת, אחר-כך קפוא

  const trigger = process.env.GITHUB_EVENT_NAME || "local";
  const run = await runAll({ trigger, priorSummary });

  const doc = unionAppend(existing, run, { prior: priorPin });
  const out = JSON.stringify(doc, null, 2) + "\n";

  /* auditor לפני-כתיבה (R1): פלט עם חומר-מפתות = אבוט, כלום לא נכתב */
  const findings = scanSecrets(out);
  if (findings.length) {
    console.error("HARD FAIL: secret-pattern audit found " + findings.length + " finding(s) in the serialized receipt — refusing to write (kinds: " + [...new Set(findings.map((f) => f.kind))].join(", ") + ")");
    process.exit(3);
  }

  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, out);
  const mdPath = path.join(root, "ops", "profit-oracle", "verdict.md");
  fs.writeFileSync(mdPath, renderVerdictMd(run));

  /* readback-אימות (charter VERIFY): מה שנכתב הוא מה שנמדד */
  try {
    const back = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    const last = back.runs[back.runs.length - 1];
    const backOk = back.at === run.at && JSON.stringify(last.summary) === JSON.stringify(run.summary)
      && back.runs.length <= LAWS.RUNS_CAP && scanSecrets(JSON.stringify(back)).length === 0;
    console.log(`readback: ${backOk ? "OK" : "MISMATCH"} (runs=${back.runs.length}, prior=${back.prior ? "kept verbatim" : "null"})`);
    if (!backOk) process.exit(4);
  } catch (e) {
    console.error("readback failed honestly:", String(e).slice(0, 100));
    process.exit(4);
  }

  const s = run.summary;
  console.log(`profit-oracle run ${run.at} (${trigger}): ${s.GREEN} GREEN · ${s.AMBER} AMBER · ${s.RED} RED · ${s.UNKNOWN} UNKNOWN`);
  for (const c of run.checks) console.log(`  ${c.verdict.padEnd(7)} ${c.id} — ${c.note}`);
  console.log(`  delta: ${run.deltaNote}`);
  console.log("written: receipts/profit-oracle-latest.json + ops/profit-oracle/verdict.md");
  /* פרסום-פסק-כנה (כולל LOSS/UNKNOWN) הוא הצלחת-השער; השער מדווח, לעולם לא רודף. */
}

main().catch((e) => { console.error("profit-oracle crashed:", String((e && e.stack) || e).slice(0, 400)); process.exit(1); });
