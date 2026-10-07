// ─────────────────────────────────────────────────────────────────────
// WEAVE-ARBITRAGE · מודול-הביצוע (r210 · חיווט EDGE-MAP-20261007 טירה-1 סעיף 6)
//
// מנדט (משימה 7-a): לחבר את הגלאי למבצעים-הקיימים — בלי-להמציא ריילים.
//
//  · הזדמנות-פנימית בלבד: klass "book-vs-exchange" (book↔pool בתוך הזירה).
//    כל-הזדמנות עם רגל-CEX (cexReference:true) = תצפית-בלבד — חסום-קשיח
//    (שער-מפעיל: Binance אסור עד-הודעה). אף-קריאה לא יוצאת מכאן ל-CEX.
//  · רווח-נטו-חיובי אחרי-עמלות: הגלאי כבר כולל עמלות-סוואפ 30bps של הבריכות
//    (feeBps-חי מה-snapshot) + עמלות-ספר 75bps; המבצע מאמת-מחדש מול
//    רזרבות-חיות בעת-הביצוע (GET /api/exchange) וקובע minOut fail-closed.
//  · הרגליים נשלחות חיה אל http://127.0.0.1:3000/api/exchange:
//      רגל-בריכה (sell-A2B / buy-B2A) → action:"swap"
//      רגל-עטיפה "WSBD→USDS"          → action:"usds-mint"
//      רגל-עטיפה "USDS→WSBD"          → action:"usds-burn"
//  · רגל-ספר-Steem ("steem-internal"): ל-/api/exchange אין-פעולת-הצבת-פקודה
//    (swap/mint/burn בלבד — נמדד ב-route.ts) ול-/api/money אין-פעולת-פקודה
//    יחידה (סולמות מונעי-מוח בלבד, מאחורי-GATE-מפעיל). לכן רגל-הספר נרשמת
//    כנה כ-unwired. שרשרת-שבורה לא נורית חצי-שרשרת עיוורת: רגל-המשך שמקורה
//    ברגל-לא-חוברת מדולג בכנות (chain-broken) — חשיפה-כלואה בתקרת-$2.
//  · תקציב-ביטחון: סיכון-מקס $2 (2000µ) להזדמנות · 5 ביצועים-חיים/יום ·
//    צינון 10 דק' בין-ביצועים · dryRun:true ברירת-מחדל — רק ARB_EXEC_DRY=false
//    מצית ביצוע-חי (נבדק: אין-ARB_EXEC_DRY ב-.env או בסביבת-הדיבון → יבש).
//  · כל-ניסיון (יבש וחי) נרשם ל-arbitrage-exec.jsonl עם קבלות: על-רייל-הזירה
//    הקבלה היא seq+hash של אירוע-הספר (SIM-class — כנות: אין-txid-חוץ כאן).
// ─────────────────────────────────────────────────────────────────────

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { cpmmOut, type OppLeg, type Opportunity } from "./lib";

const EXCHANGE_API = process.env.ARB_EXCHANGE_API || "http://127.0.0.1:3000/api/exchange";
// יומן-הביצוע — אותו-תיק-מצב כמו state.json (ה-STATE-הקנון של השירות);
// ניתן-להטיה לבדיקות (selftest) דרך ARB_EXEC_LOG.
const EXEC_LOG =
  process.env.ARB_EXEC_LOG || "/home/z/my-project/mini-services/arbitrage/arbitrage-exec.jsonl";

// ── תקציב-ביטחון (מנדט 7-a) ──────────────────────────────────────────
export const EXEC_LIMITS = {
  maxRiskUsd: 2, // 2000µ — סיכון-מקסימלי להזדמנות
  maxPerDay: 5, // ביצועים-חיים ליום-UTC
  cooldownMin: 10, // צינון בין-ביצועים-חיים
  slippageGuard: 0.95, // minOut = מוצא-חי-מחושב × 0.95 — fail-closed
} as const;

// dryRun:true כברירת-מחדל. רק ARB_EXEC_DRY === "false" מצית חי.
const dryRunDefault = process.env.ARB_EXEC_DRY !== "false";

// ── טיפוסי-רישום ─────────────────────────────────────────────────────
export interface ExecLegRec {
  venue: string;
  side: string;
  rail: "swap" | "usds-mint" | "usds-burn" | "unwired";
  url: string;
  body: Record<string, unknown> | null;
  amountIn?: number;
  expectedOut?: number;
  minOut?: number;
  sent: boolean; // האם-נשלחה-קריאה-חיה (ב-dryRun: אף-רגל)
  ok?: boolean;
  httpStatus?: number;
  detail?: string;
  receipt?: { seq: number | null; hash: string | null } | null;
  ms?: number;
}

export interface ExecRecord {
  at: string;
  dryRun: boolean;
  oppId: string;
  klass: string;
  direction: string;
  sizeUsd: number;
  netBps: number;
  netUsd: number;
  status: "dry-run" | "executed" | "partial" | "failed" | "blocked";
  reason?: string;
  legs: ExecLegRec[];
  ms: number;
}

export interface ExecTotals {
  candidates: number; // הזדמנויות-פנימיות-חיוביות שהגיעו לשער-המבצע
  liveAttempts: number;
  dryRuns: number;
  executed: number; // כל-הרגליים-המחוברות נורו-והצליחו
  partial: number; // חלק-מהרגליים נורו (רגל-ספר לא-חוברת או כשל-המשך)
  failed: number; // נוסו-קריאות-חיות ונכשלו כולן
  blockedCex: number; // אירועי-חסימת-CEX (תצפית-בלבד — חסום-קשיח)
  blockedRail: number; // נחסמו: רגל-לא-חוברת/שרשרת-שבורה
  blockedBudget: number;
  blockedCooldown: number;
}

export interface ExecState {
  bootedAt: string;
  dryRun: boolean;
  day: string; // YYYY-MM-DD UTC
  executedToday: number;
  lastLiveAt: string | null;
  cooldownUntil: string | null;
  totals: ExecTotals;
  lastRecord: ExecRecord | null;
  lastBlock: { at: string; oppId: string; reason: string } | null;
  logFile: string;
  records: ExecRecord[]; // טבעת-זיכרון — 30 אחרונות
}

const G = globalThis as unknown as { __ARB_EXEC_STATE__?: ExecState };
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

function freshState(): ExecState {
  const st: ExecState = {
    bootedAt: new Date().toISOString(),
    dryRun: dryRunDefault,
    day: todayUtc(),
    executedToday: 0,
    lastLiveAt: null,
    cooldownUntil: null,
    totals: {
      candidates: 0, liveAttempts: 0, dryRuns: 0, executed: 0, partial: 0, failed: 0,
      blockedCex: 0, blockedRail: 0, blockedBudget: 0, blockedCooldown: 0,
    },
    lastRecord: null,
    lastBlock: null,
    logFile: EXEC_LOG,
    records: [],
  };
  recoverFromJournal(st);
  return st;
}

const state = (): ExecState => (G.__ARB_EXEC_STATE__ ??= freshState());

/** התאוששות-תקציב מהיומן (מקור-האמת): נספרים ניסיונות-חיים של היום + צינון. */
function recoverFromJournal(st: ExecState): void {
  try {
    if (!existsSync(EXEC_LOG)) return;
    const lines = readFileSync(EXEC_LOG, "utf8").split("\n").filter((l) => l.trim().startsWith("{"));
    const today = todayUtc();
    let lastLiveMs = 0;
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as ExecRecord;
        if (r.dryRun) continue;
        const atMs = Date.parse(r.at);
        if (!Number.isFinite(atMs)) continue;
        if (r.at.slice(0, 10) === today) st.executedToday += 1;
        if (atMs > lastLiveMs) lastLiveMs = atMs;
      } catch { /* שורה-פגומה — מדלגים בכנות */ }
    }
    if (lastLiveMs > 0) {
      st.lastLiveAt = new Date(lastLiveMs).toISOString();
      st.cooldownUntil = new Date(lastLiveMs + EXEC_LIMITS.cooldownMin * 60_000).toISOString();
    }
  } catch { /* יומן-לא-קריא — מתחילים-ספירה-חדשה בכנות */ }
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} [exec] ${msg}`);
}

function record(st: ExecState, rec: ExecRecord, opts?: { memoryOnly?: boolean }): void {
  // דה-דופ: רשומה-זהה (אותו-מועמד/סטטוס/גודל) תוך-5-דק' נשארת-בזיכרון בלבד —
  // סריקה-חוזרת-כל-60ש' לא תנפח את היומן.
  const prev = st.records[0];
  const dedup =
    prev && prev.oppId === rec.oppId && prev.status === rec.status && prev.dryRun === rec.dryRun &&
    Math.abs(prev.sizeUsd - rec.sizeUsd) < 1e-9 &&
    Date.parse(rec.at) - Date.parse(prev.at) < 5 * 60_000;
  st.lastRecord = rec;
  if (dedup) {
    st.records[0] = rec;
    return;
  }
  st.records.unshift(rec);
  if (st.records.length > 30) st.records.length = 30;
  if (opts?.memoryOnly) return;
  try {
    appendFileSync(EXEC_LOG, `${JSON.stringify(rec)}\n`);
  } catch (e) {
    log(`journal WRITE-FAILED: ${e instanceof Error ? e.message : e}`);
  }
}

function block(st: ExecState, opp: Opportunity, reason: string): void {
  st.lastBlock = { at: new Date().toISOString(), oppId: opp.id, reason };
}

const r9 = (x: number): number => Math.floor(x * 1e9) / 1e9;

// ── שער-הזירה — snapshot חי לאימות-מחדש בעת-ביצוע ────────────────────
interface Snap {
  ok?: boolean;
  pools?: Array<{ pair: string; reserveA: number; reserveB: number; feeBps: number }>;
  prices?: { sbd?: number | null; hbd?: number | null };
}

async function fetchSnapshot(): Promise<Snap | null> {
  try {
    const res = await fetch(EXCHANGE_API, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return (await res.json()) as Snap;
  } catch {
    return null;
  }
}

interface CallResult {
  sent: boolean;
  ok: boolean;
  httpStatus?: number;
  detail?: string;
  receipt?: ExecLegRec["receipt"];
  expectedOut?: number;
  ms: number;
}

/** קריאה-חיה אחת אל POST /api/exchange — הרייל היחיד המחובר מנדט-זה. */
async function callExchange(body: Record<string, unknown>): Promise<CallResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(EXCHANGE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; detail?: string; event?: { seq?: number; hash?: string }; quote?: { expectedOut?: number } }
      | null;
    const ok = res.ok && data?.ok === true;
    return {
      sent: true,
      ok,
      httpStatus: res.status,
      detail: data?.detail ?? (ok ? "ok" : `HTTP ${res.status}`),
      receipt: data?.event ? { seq: data.event.seq ?? null, hash: data.event.hash ?? null } : null,
      expectedOut: data?.quote?.expectedOut,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { sent: true, ok: false, detail: `FETCH-FAILED: ${e instanceof Error ? e.message : e}`, ms: Date.now() - t0 };
  }
}

// ── מיפוי-רגל → רייל (החוק: הכול דרך /api/exchange; מה שאינו-נתמך שם = unwired) ──
function railOf(leg: OppLeg): ExecLegRec["rail"] {
  if (leg.venue.startsWith("exchange:") && !leg.peg) return "swap";
  if (leg.peg && leg.side === "WSBD→USDS") return "usds-mint";
  if (leg.peg && leg.side === "USDS→WSBD") return "usds-burn";
  return "unwired"; // steem-internal (ספר-Steem) — אין-רייל-פקודה ב-/api/exchange
}

// ── מנוע-הביצוע ──────────────────────────────────────────────────────
/**
 * נקרא אחרי-כל-סריקה עם ההזדמנויות-הממוינות (netBps↓).
 * בוחר לכל-היותר מועמד-אחת (הטובה-ביותר), כבול לתקציב/צינון/dryRun.
 */
export async function arbExecTick(opps: Opportunity[]): Promise<void> {
  const st = state();
  for (const opp of opps) {
    if (!(opp.netUsd > 0)) continue; // אין-רווח-נטו — לא-מועמד
    if (opp.cexReference) {
      // חסום-קשיח (שער-מפעיל): רגל-CEX = תצפית-בלבד. אף-קריאה. נספר-ונשכח.
      st.totals.blockedCex += 1;
      continue;
    }
    if (opp.klass !== "book-vs-exchange") continue; // לא-פנימי — לא-מנדט
    st.totals.candidates += 1;
    await tryExecute(opp);
    return; // מועמד-אחד-לסריקה
  }
}

async function tryExecute(opp: Opportunity): Promise<void> {
  const st = state();
  const t0 = Date.now();
  const at = new Date().toISOString();

  // תקציב/צינון — חלים על-ביצוע-חי בלבד; ב-dryRun מתעדים-בלי-לצרוך.
  if (!st.dryRun) {
    if (st.day !== todayUtc()) {
      st.day = todayUtc();
      st.executedToday = 0;
    }
    if (st.executedToday >= EXEC_LIMITS.maxPerDay) {
      st.totals.blockedBudget += 1;
      block(st, opp, `budget: ${st.executedToday}/${EXEC_LIMITS.maxPerDay} ביצועי-היום נצרכו`);
      log(`blocked BUDGET ${opp.id} — ${st.executedToday}/${EXEC_LIMITS.maxPerDay}`);
      return;
    }
    const now = Date.now();
    if (st.cooldownUntil && now < Date.parse(st.cooldownUntil)) {
      st.totals.blockedCooldown += 1;
      block(st, opp, `cooldown עד ${st.cooldownUntil}`);
      log(`blocked COOLDOWN ${opp.id} — עד ${st.cooldownUntil}`);
      return;
    }
  }

  // L1 בעת-ביצוע: גודל-התקרה חייב להיות בר-ביצוע שנמדד (אחרת $2 לא היו ברות-מימוש)
  const capUsd = Math.min(opp.sizeUsd, EXEC_LIMITS.maxRiskUsd);
  if (opp.maxFeasibleUsd < EXEC_LIMITS.maxRiskUsd) {
    st.totals.blockedRail += 1;
    block(st, opp, `size-cap $${EXEC_LIMITS.maxRiskUsd} לא-נמדד בר-ביצוע (maxFeasible $${opp.maxFeasibleUsd})`);
    return;
  }

  // snapshot חי — רזרבות-ומחירים בעת-הביצוע (לא-האמון-מהגילוי)
  const snap = await fetchSnapshot();
  const sbdUsd = snap?.prices?.sbd ?? null;
  const poolLeg = opp.legs.find((l) => l.venue.startsWith("exchange:") && !l.peg);
  const livePool = snap?.pools?.find((p) => p.pair === poolLeg?.venue.slice("exchange:".length));
  if (!sbdUsd || !poolLeg || !livePool) {
    st.totals.blockedRail += 1;
    block(st, opp, `אין-snapshot-חי/בריכה (${sbdUsd ? "pool?" : "sbdUsd?"}) — מסרב לבצע עיוור`);
    return;
  }

  const scale = capUsd / opp.sizeUsd; // היחלצות-לתקרת-הסיכון
  const legsRec: ExecLegRec[] = [];
  let carry: number | null = null; // המוצא-החי-המצטבר (יחידות-הרגל-הבאה)
  let anySent = false;
  let anyOk = false;
  let chainBroken = false;

  for (const leg of opp.legs) {
    const rail = railOf(leg);
    const rec: ExecLegRec = {
      venue: leg.venue, side: leg.side, rail,
      url: rail === "unwired" ? "" : EXCHANGE_API,
      body: null, sent: false,
    };
    legsRec.push(rec);

    if (rail === "unwired") {
      chainBroken = true; // רגל-הספר: לא-חוברת (ראה-כותרת) — כנות
      rec.ok = false;
      rec.detail = "rail-not-wired: ל-/api/exchange אין פעולת-הצבת-פקודת-ספר (swap/mint/burn בלבד) — חיבור דרך /api/money דורש החלטת-מפעיל";
      continue;
    }
    if (chainBroken) {
      // שרשרת-שבורה: המקור של הרגל-הזאת מעולם לא נוצר — שליחה = חשיפה עיוורת
      rec.ok = false;
      rec.detail = "chain-broken: רגל-קודמת לא נורתה — לא נשלח";
      continue;
    }

    // כמות-הקלט: שרשרת-חיה כשיש-carry; אחרת הגודל-המוקף מהגילוי
    const amountIn = carry ?? r9((leg.amountIn ?? capUsd / sbdUsd) * scale);
    let body: Record<string, unknown>;
    let expectedOut: number;
    if (rail === "swap") {
      const inA = leg.side === "sell-A2B";
      expectedOut = cpmmOut(amountIn, inA ? livePool.reserveA : livePool.reserveB, inA ? livePool.reserveB : livePool.reserveA, livePool.feeBps);
      body = {
        action: "swap",
        pair: livePool.pair,
        side: inA ? "A2B" : "B2A",
        amountIn,
        minOut: r9(expectedOut * EXEC_LIMITS.slippageGuard), // fail-closed
        note: `arb-exec ${opp.id}`,
      };
    } else {
      expectedOut = amountIn; // peg 1:1 — חוק-הרזרבה
      body = {
        action: rail, // "usds-mint" (WSBD→USDS) | "usds-burn" (USDS→WSBD)
        stable: "WSBD",
        amount: amountIn,
        note: `arb-exec ${opp.id}`,
      };
    }
    rec.amountIn = amountIn;
    rec.expectedOut = r9(expectedOut);
    rec.minOut = body.minOut != null ? Number(body.minOut) : undefined;
    rec.body = body;

    if (st.dryRun) {
      rec.detail = "dry-run: לא נשלח — תכנון-הקריאה החיה מתועד";
      carry = r9(expectedOut);
      continue;
    }

    const r = await callExchange(body);
    rec.sent = r.sent;
    rec.ok = r.ok;
    rec.httpStatus = r.httpStatus;
    rec.detail = r.detail?.slice(0, 200);
    rec.receipt = r.receipt;
    rec.ms = r.ms;
    anySent = true;
    if (r.ok) {
      anyOk = true;
      // השרשרת נמשכת על-המוצא-האמיתי שחזר מהזירה (לא-על-הדמיה)
      carry = r.expectedOut ?? r9(expectedOut);
    } else {
      chainBroken = true; // כשל-רגל — אין-המשך עיוור
    }
  }

  const live = !st.dryRun;
  let status: ExecRecord["status"];
  let reason: string | undefined;
  if (!live) {
    status = "dry-run";
    st.totals.dryRuns += 1;
    reason = chainBroken ? "dry-run · חלק-מהשרשרת לא-חובר (ראה רגליים)" : undefined;
  } else if (!anySent) {
    status = "blocked";
    reason = "leg-not-wired: כל-השרשרת נחסמה — אף-קריאה לא נשלחה";
    st.totals.blockedRail += 1;
  } else if (anyOk && !legsRec.some((l) => l.rail !== "unwired" && l.sent && !l.ok)) {
    status = "executed";
    st.totals.executed += 1;
    if (chainBroken) reason = "רגל-הספר לא-חוברת — מלאי כלוא בתקרת-$2 (מבוקר)";
  } else if (anyOk) {
    status = "partial";
    st.totals.partial += 1;
    reason = "רגל-אחת-ומעלה נכשלו — חשיפה חלקית כלואה בתקרת-$2";
  } else {
    status = "failed";
    st.totals.failed += 1;
    reason = "כל-הקריאות-החיות נכשלו — אף-מלאי לא נוצר";
  }

  const rec: ExecRecord = {
    at, dryRun: !live, oppId: opp.id, klass: opp.klass, direction: opp.direction,
    sizeUsd: capUsd, netBps: opp.netBps, netUsd: opp.netUsd,
    status, reason, legs: legsRec, ms: Date.now() - t0,
  };

  if (live && !anySent) {
    // ניסיון-חי שנחסם-במלואו (אף-קריאה לא יצאה): לא צורך תקציב/צינון —
    // נרשם-בזיכרון-בלבד (lastRecord/lastBlock) כדי-שהיומן יישאר ספר-ביצועים.
    st.totals.blockedRail += 1;
    block(st, opp, reason ?? "blocked");
    record(st, rec, { memoryOnly: true });
    log(`LIVE-BLOCKED ${opp.id} — ${reason}`);
    return;
  }

  record(st, rec);

  if (live) {
    st.totals.liveAttempts += 1;
    st.executedToday += 1;
    st.lastLiveAt = at;
    st.cooldownUntil = new Date(Date.parse(at) + EXEC_LIMITS.cooldownMin * 60_000).toISOString();
    log(`LIVE ${status} ${opp.id} $${capUsd} netBps=${opp.netBps} → ${legsRec.filter((l) => l.sent).length} קריאות-חיות · ${reason ?? ""}`);
  } else {
    log(`DRY ${opp.id} $${capUsd} netBps=${opp.netBps} · תכנון-רגליים: ${legsRec.map((l) => l.rail).join("→")}`);
  }
}

// ── תצוגה-ציבורית (כנות-מלאה ב-/status וב-/exec) ─────────────────────
export function execPublic(): {
  dryRun: boolean;
  dryRunSource: string;
  limits: typeof EXEC_LIMITS;
  day: string;
  executedToday: number;
  lastLiveAt: string | null;
  cooldownUntil: string | null;
  totals: ExecTotals;
  lastRecord: ExecRecord | null;
  lastBlock: ExecState["lastBlock"];
  logFile: string;
  cexPolicy: string;
} {
  const st = state();
  return {
    dryRun: st.dryRun,
    dryRunSource: st.dryRun ? `ARB_EXEC_DRY != "false" → dryRun:true (ברירת-מחדל מנדט 7-a)` : `ARB_EXEC_DRY=false → ביצוע-חי מותר (כבול לתקציב/צינון)`,
    limits: EXEC_LIMITS,
    day: st.day,
    executedToday: st.executedToday,
    lastLiveAt: st.lastLiveAt,
    cooldownUntil: st.cooldownUntil,
    totals: st.totals,
    lastRecord: st.lastRecord,
    lastBlock: st.lastBlock,
    logFile: EXEC_LOG,
    cexPolicy: "רגלי-CEX: תצפית-בלבד — חסום-קשיח (שער-מפעיל: Binance אסור עד-הודעה); אף-קריאה לא יוצאת ל-CEX ממודול-זה",
  };
}

export function execRecords(n: number): ExecRecord[] {
  return state().records.slice(0, Math.max(0, Math.min(n, 30)));
}

export type ExecSnapshot = ReturnType<typeof execPublic>;
