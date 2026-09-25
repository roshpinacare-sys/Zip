// ─────────────────────────────────────────────────────────────────────
// MONEY-MOVER — מוביל הכסף · דיבון סולם-הפאריטה (R81, rebuilt R90)
//
// החוזה: המוח הפיננסי חי ב-/api/money (Next.js) — הדיבון הוא לב-פעימה
// בלבד: מודד כל 60ש', מפעיל REPRICE כשהקו זז, וכותב את המצב לספרים.
//
// R97: טריגר שלישי — ARM-BUY: SBD חמוש (≥0.15 מחויב) → סולם קנייה
// מתחת לפאריטה (המיקרו-גריד נעשה דו-צדדי · הזדמנות O1). כל פעולה
// עוברת את שער-העסקאות ב-/api/money: מתחת ל-$100 — אוטונומיה;
// מעל — GATE-QUEUED, כלום לא זז עד אישור המפעיל (הוראת המפעיל).
//
// R101: רגל HIVE חוזרת לקנון — המנוע שנבנה ב-R99 אבד לארעיות-הסנדבוקס
// (הפקודות חיות על השרשרת; הקוד לא הועלה לגיט). הדיבון מעתה מנהל שתי
// רגליים: STEEM (הסולם הגדול) + HIVE (המיקרו-גריד הצמוד) — אותו
// צינון, אותו תקציב, אותו שער-$100. חוק-החוט ב-hive-wire.
//
// R103: שני ריילים חדשים למעגל הכלכלה החיה:
//   · reward-pay — מילויי-גריד אמיתיים (עבודה) ← SAOS למאזן הזירה
//     של הסוכן (מטבע) ← ניתן להחלפה ב-USDS בבריכה (נזילות).
//     סגירת המעגל עבודה→מטבע→נזילות — הוראת המפעיל.
//   · liquidity-stream — גל-דלק (פאוורדאון שבועי ~475 STEEM) ←
//     20% ממנו הופך לעומק בריכות הזירה לפני פריסת הסולם.
//
// חוקי-ברזל (מהקנון):
//   · טריגרים: סטיית-פאריטה >50bps מהמדרגה · נזיל ≥1 STEEM
//   · צינון 30 דק' בין פעולות · תקציב 12 פעולות/יום
//   · acting=true בזמן פעולה — השומר לעולם לא הורג באמצע (חוק הפעולה)
//   · כנות: מדידה שנכשלה נרשמת ככישלון — אין "נניח שבסדר"
//   · הקנון מקבל קבלה אחרי כל פעולה, אחרי שער-סודות
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/money/state.json`;
const HISTORY_FILE = `${HOME}/sovereign/money/history.json`;
const PORT = 3034;
const CHECK_INTERVAL_SEC = 60;
const API = "http://127.0.0.1:3000/api/money";
const HIVE_API = "http://127.0.0.1:3000/api/money/hive";
const EXCHANGE_API = "http://127.0.0.1:3000/api/exchange";
const POLICY = {
  triggers: { parityDriftBps: 50, floorBps: -50, idleTriggerSteem: 1 },
  cooldownMin: 30,
  actionsBudgetPerDay: 12,
  armBuy: { minSbd: 0.15, offsetsBps: [100, 200, 300] }, // R97 — צד הקנייה של המיקרו-גריד
  hive: { driftBps: 50 },
  stockSbd: { premiumCapBps: 200, keepSteem: 0.5 }, // R101b - arming-inventory stock (bounded taker) // R101 — סטיית רגל-HIVE מהסולם
  rewards: { saosPerFill: 2, member: "money-mover" }, // R103 — עבודה→מטבע→נזילות
  liquidityStream: { waveSteem: 200, share: 0.2 }, // R103 — גל-פאוורדאון → 20% עומק בריכות
  truthSource: "api.steemit.com · get_open_orders/get_accounts (via /api/money) + api.hive.blog (via /api/money/hive)",
};

type Decision = { at: string; kind: string; detail: string };

type MoneyState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  checkIntervalSec: number;
  policy: typeof POLICY;
  lastActionAt: string | null;
  actionsToday: number;
  actionDay: string;
  acting: boolean;
  lastDecision: Decision | null;
  fillsSeen?: number; // R103 — סימן-מים לתגמול מילויים חדשים
  lastDepositScanAt?: string | null; // R105 — סריקת הפקדות אחרונה (כל 5 דק')
  lastPoolGuardAt?: string | null;
  lastFleetSweepAt?: string | null; // R108 — סריקת גלגול-צי (כל 5 דק') // R108 — איזון-בריכות אחרון (כל 10 דק')
  lastStreamDay?: string; // R103 — הזרמת-נזילות אחת לכל היום ביותר
  lastTotalSteem?: number; // R111 — חתימת הון-כולל לטריגר הגל (נזיל+פרוס)
  fleetSeen?: { keeperRestartAt?: string; pulseDay?: string; studentDay?: string }; // R108 — סימני-מים לגוב-הצי
  canonLast: { at: string; ok: boolean; path: string } | null;
  history?: Array<Record<string, unknown>>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readState(): MoneyState {
  const base: MoneyState = {
    service: "money-mover",
    version: "1.9.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    checkIntervalSec: CHECK_INTERVAL_SEC,
    policy: POLICY,
    lastActionAt: null,
    actionsToday: 0,
    actionDay: utcDay(),
    acting: false,
    lastDecision: null,
    canonLast: null,
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    // המשכיות אמיתית: מונים, תקציבים וצינון שורדים restart/hot-reload (לקח R84)
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastActionAt: prev.lastActionAt ?? null,
      actionsToday: prev.actionDay === utcDay() ? (prev.actionsToday ?? 0) : 0,
      actionDay: prev.actionDay === utcDay() ? prev.actionDay : utcDay(),
      acting: false, // אתחול: תהליך חדש — אין פעולה בטיסה. אם פעולה קודמת נתקעה mid-flight, היא הסתיימה עם מות התהליך.
      lastDecision: prev.lastDecision ?? null,
      canonLast: prev.canonLast ?? null,
      // R108 — שידור-סימני-מים ברילוד: ללא השורות האלה, כל טעינה-חמה של מודול מאפסרת את המאידות של תשלום — והתקרות שערו את הנזק (נתפס חי: שומר שולם 3×2 ברילודים; פרצו-גבול עצרו בדיוק). מתעתה: מי שוחור לצין מי שולח — גם אחרי restart.
      fillsSeen: prev.fillsSeen ?? 0,
      lastDepositScanAt: prev.lastDepositScanAt ?? null,
      lastStreamDay: prev.lastStreamDay ?? null,
      lastTotalSteem: prev.lastTotalSteem ?? null,
      fleetSeen: prev.fleetSeen ?? {},
      lastPoolGuardAt: prev.lastPoolGuardAt ?? null,
      lastFleetSweepAt: prev.lastFleetSweepAt ?? null,
    };
  } catch (e: any) {
    // כנות (R123): state קיים אך בלתי-קריא אינו נבלע בשקט — האיתחול נרשם
    // כהחלטה גלויה. קובץ שאינו קיים = עלייה ראשונה כנה. (הלקח נולד חי
    // ב-R112: איתחול מקובץ-קונפליקט איפס את המצב בשקט.)
    if (fs.existsSync(STATE_FILE)) {
      return {
        ...base,
        lastDecision: {
          at: new Date().toISOString(),
          kind: "STATE-RESET",
          detail: `קובץ-המצב קיים אך לא נקרא (${String(e?.message ?? e).slice(0, 80)}) — אותחל מצב חדש בכנות; אין prevTotal = אין גל-שקר, ותקרות השרת שומרות על הכסף`,
        },
      };
    }
    return base;
  }
}

// R124 — ציר-עולם למצב הדיבון (דפוס weblift): bun --hot מעריך את המודול מחדש
// בכל עריכה; קריאה-מחדש מהדיסק בכל דור גרמה ל-last-writer-wins בין דורות
// — דור שנטען מקובץ קפוא שכתב את lastActionAt של הדור החי והפר את הצינון
// (נמדד חי: שתי פעולות REPRICE במרווח 44 שניות מול מדיניות 30 דק').
// החוק: אובייקט-מצב אחד לכל חיי התהליך; דור חם יורש את האובייקט החי
// מציר-העולם, ורק עלייה קרה (תהליך חדש) קוראת מהדיסק.
const G_MONEY = globalThis as unknown as { __MONEY_STATE__?: MoneyState };
let state: MoneyState = G_MONEY.__MONEY_STATE__ ?? readState();
G_MONEY.__MONEY_STATE__ = state;

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/money`, { recursive: true });
  // R107b — חוק הכתיבה-האטומית (כמו בשומר): .tmp ואז rename — רגע-מוות
  // באמצע כתיבה לא משאיר ליורש קובץ-מצב חצוי (הלקח נלמד חי בכסף עצמו).
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function appendHistory(entry: Record<string, unknown>, cap = 60) {
  try {
    let h: Array<Record<string, unknown>> = [];
    try {
      h = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      if (!Array.isArray(h)) h = [];
    } catch {}
    h.push({ at: new Date().toISOString(), ...entry });
    // R107b — אטומי גם כאן: היסטוריית-הקבלות היא ראיה; כתיבה חצויה לא
    // תאפס אותה בשקט בקריאה הבאה.
    const tmp = `${HISTORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(h.slice(-cap), null, 2));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (e) {
    // R123 — כנות: כישלון כתיבת-דיסק נרשם ביומן, לא נבלע בשקט (כמו ב-weblift)
    console.error(`[money-mover] appendHistory נכשל — קבלה לא נשמרה לדיסק: ${String((e as Error)?.message ?? e)}`);
  }
}

// ── שער-סודות לקנון: שום מפתח לא עובר ─────────────────────────────
function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) {
    return { ok: false, reason: "base58-wif-shape" };
  }
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) {
    return { ok: false, reason: "github-token-shape" };
  }
  if (/(pat|token|wif|password)\s*[:=]\s*\S{16,}/i.test(text)) {
    return { ok: false, reason: "secret-assignment-shape" };
  }
  return { ok: true };
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

// R112 — law of the bounded wait (caught live 06:14): canonPush fetches
// were the ONLY un-timeouted network calls in the daemon. A hung GitHub
// connection (no RST, no FIN) froze the whole tick: `ticking` stayed true
// forever, every later beat no-op'd at the guard, and the daemon died
// silently at beats=813 while its HTTP server kept answering. The keeper
// saw ZOMBIE but its daily restart budget was already burned (12/12 by
// 03:26) — so nothing revived it. Two laws born from this:
//   (1) every fetch in every daemon carries a deadline (this fix);
//   (2) a wedged tick costs one cycle, not the daemon (watchdog below).
async function canonPush(path: string, content: string): Promise<boolean> {
  const gate = secretsGate(content);
  if (!gate.ok) {
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (BLOCKED: ${gate.reason})` };
    return false;
  }
  const pat = readPat();
  if (!pat) {
    // כנות: כישלון נרשם — לא משאירים canonLast ישן {ok:true} מהצלחה קודמת
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (NO-PAT)` };
    return false;
  }
  const url = `https://api.github.com/repos/roshpinacare-sys/Defi/contents/${path}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "money-mover-daemon",
  };
  try {
    let sha: string | undefined;
    const cur = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (cur.ok) {
      const j = await cur.json();
      sha = j.sha;
    }
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `money-mover: reprice receipt ${new Date().toISOString()}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const ok = res.ok;
    state.canonLast = { at: new Date().toISOString(), ok, path };
    return ok;
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path };
    return false;
  }
}

// ── החלטה ───────────────────────────────────────────────────────────
async function decide(meas: any): Promise<{ act: boolean; reason: string; action?: "reprice" | "arm-buy" | "stock-sbd" | "arena-stream" }> {
  const now = new Date();
  // day roll
  if (state.actionDay !== utcDay(now)) {
    state.actionDay = utcDay(now);
    state.actionsToday = 0;
  }
  // צינון
  if (state.lastActionAt) {
    const sinceMin = (now.getTime() - new Date(state.lastActionAt).getTime()) / 60_000;
    if (sinceMin < POLICY.cooldownMin) {
      return { act: false, reason: `WAIT-COOLDOWN · עוד ${Math.ceil(POLICY.cooldownMin - sinceMin)} דק'` };
    }
  }
  // תקציב
  if (state.actionsToday >= POLICY.actionsBudgetPerDay) {
    return { act: false, reason: "WAIT-BUDGET · 12/12 פעולות היום — התקציב נאכל" };
  }
  // R103 — LIQUIDITY-STREAM: גל-דלק (חתימת פאוורדאון: נזיל ≥ 200 STEEM
  // בבת אחת) ← 20% ממנו הופך לעומק בבריכות הזירה לפני שהסולם פורש
  // את השאר. הזרמה אחת ליום בלבד — חוק התקציב.
  // R111 - law of the total-capital signature: liquid>=200 alone is NOT a
  // wave. Measured live 04:15: standing ladder capital re-appeared liquid
  // after order churn and masqueraded as a powerdown wave -> false wrap of
  // 95.327 WSTEEM from ladder capital. A true wave is a rise in the TOTAL
  // capital (liquid + deployed in orders) above the previous beat's total.
  // Cancels and re-deploys never change the total and cannot fire it.
  const idleNow = Number(meas?.idleSteem ?? 0);
  const totalSteemNow = Math.round((idleNow + Number(meas?.deployedSteem ?? 0)) * 1000) / 1000;
  const measCredible =
    !!meas && typeof meas === "object" && typeof meas?.idleSteem === "number" && totalSteemNow > 0;
  const prevTotal = state.lastTotalSteem ?? null;
  if (measCredible) state.lastTotalSteem = totalSteemNow; // wave = rise vs previous picture
  const today = utcDay();
  const waveDelta = prevTotal != null ? Math.round((totalSteemNow - prevTotal) * 1000) / 1000 : 0;
  if (
    measCredible &&
    waveDelta >= POLICY.liquidityStream.waveSteem &&
    idleNow >= POLICY.liquidityStream.waveSteem &&
    state.lastStreamDay !== today
  ) {
    return {
      act: true,
      action: "arena-stream",
      reason: `גל דלק אמיתי: ההון-הכולל עלה ${waveDelta.toFixed(3)} STEEM מעל המדידה הקודמת (${totalSteemNow.toFixed(3)} סך · נזיל ${idleNow.toFixed(0)}) — ${Math.round(POLICY.liquidityStream.share * 100)}% הופכים לעומק בבריכות הזירה לפני פריסת הסולם`,
    };
  }
  // R101b - STOCK-SBD (before the idle trigger - order is the deal):
  // if the arming inventory is short and idle fuel can close the gap,
  // close it at the ask first; only then spread the rest into the ladder.
  // R111 - pre-check law (born from a live starvation loop): the fire is
  // checked against the executable bid from the measurement itself BEFORE
  // burning action-budget and cooldown on it. True cost premium:
  // parity/bid - 1 (how many STEEM above fair one SBD costs when executing
  // into bids). Above the cap the decision honestly falls through (ladder
  // deploy, HIVE leg) instead of looping on a guaranteed refusal.
  const armStock = meas?.sbdArming;
  const parityStock = Number(meas?.marks?.parity);
  const bidPxStock = Number(meas?.book?.bids?.[0]?.price);
  const premiumBpsStock =
    Number.isFinite(parityStock) && parityStock > 0 && Number.isFinite(bidPxStock) && bidPxStock > 0
      ? Math.round((parityStock / bidPxStock - 1) * 10_000)
      : null;
  if (
    armStock?.state === "WAIT" &&
    Number.isFinite(parityStock) &&
    parityStock > 0 &&
    premiumBpsStock != null &&
    premiumBpsStock <= POLICY.stockSbd.premiumCapBps
  ) {
    const gapStock = Math.max(0, Number(armStock.needed ?? 0.15) - Number(armStock.commitable ?? 0));
    const steemNeedStock = (gapStock / parityStock) * 1.5 + POLICY.stockSbd.keepSteem;
    if (gapStock > 0.005 && Number(meas?.idleSteem ?? 0) >= steemNeedStock) {
      return {
        act: true,
        action: "stock-sbd",
        reason: `SBD arming gap ${Number(armStock.commitable).toFixed(3)}/${armStock.needed} - executable bid ${bidPxStock.toFixed(6)} within cap (premium ${premiumBpsStock}bps <= ${POLICY.stockSbd.premiumCapBps}) - closing at the bid (bounded stock)`,
      };
    }
  }
  // טריגר: נזיל
  const idle = Number(meas?.idleSteem ?? 0);
  if (idle >= POLICY.triggers.idleTriggerSteem) {
    return { act: true, reason: `נזיל ${idle.toFixed(3)} STEEM יושב מחוץ לסולם — נפרס לעבודה (חוק 2)` };
  }
  // טריגר: סטיית פאריטה מהמדרגה שהוצבה בפועל (R93).
  // לקח-הבאג החי (נמדד 00:19Z): ה-ladder מה-API הוא הסולם *המומלץ* —
  // מחושב מהפאריטה עצמה, ולכן השוואת פאריטה מול ladder[1] היא השוואת
  // הפאריטה אל עצמה: drift=0 תמידי, והטריגר היה קוד-מת במשך 20 שעות
  // בזמן שהקו זז +240bps. האמת היא הפקודות הפתוחות על השרשרת
  // (get_open_orders): המדרגה התחתונה — הראשונה להיפגע — היא הבסיס.
  const parity = Number(meas?.marks?.parity);
  const placedPrices: number[] = (Array.isArray(meas?.orders) ? meas.orders : [])
    .map((o: { price?: number | string }) => Number(o?.price))
    .filter((p: number) => Number.isFinite(p) && p > 0);
  if (typeof parity === "number" && parity > 0 && placedPrices.length > 0) {
    const base = Math.min(...placedPrices); // המדרגה התחתונה — הראשונה למכירה
    const driftBps = Math.round(((parity - base) / base) * 10_000);
    if (Math.abs(driftBps) > POLICY.triggers.parityDriftBps) {
      return {
        act: true,
        reason: `הפאריטה זזה ${driftBps > 0 ? "+" : ""}${driftBps}bps מעל הסולם שהוצב (${base.toFixed(6)} → קו ${parity.toFixed(6)}) — הסולם נגרר אליה (חוק 3)`,
      };
    }
  }
  // טריגר R97 — ARM-BUY: SBD חמוש → סולם קנייה מתחת לפאריטה (O1).
  // הגריד נעשה דו-צדדי: המכירות מעל הקו צדות ערך; הקניות מתחתיו
  // תופסות את הפער הפנימי המדוד (VALUE-TRAP ההפוך). החימוש נפתח
  // רק ממילוי אמיתי — לא ממכירה מתחת לערך.
  const arm = meas?.sbdArming;
  if (arm?.state === "ARMED" && Number(arm?.commitable ?? 0) >= POLICY.armBuy.minSbd) {
    return {
      act: true,
      action: "arm-buy",
      reason: `SBD חמוש ${Number(arm.commitable).toFixed(3)} — סולם קנייה מתחת לפאריטה (מיקרו-גריד דו-צדדי · O1)`,
    };
  }
  // שקט כנה
  return { act: false, reason: "הסולם על הקו — אין פעולה נדרשת" };
}

// ── רגל HIVE (R101): מדידה, החלטה, פעולה — אותם חוקים ────────────────

async function measureHive(): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${HIVE_API}`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function decideHive(hive: any): Promise<{ act: boolean; reason: string }> {
  if (!hive || typeof hive !== "object") return { act: false, reason: "HIVE לא נמדדה — לא מתיירים על נתוני-רפא" };
  const drift = Number(hive?.maxDriftBps);
  const orders = Array.isArray(hive?.orders) ? hive.orders.length : 0;
  const hiveBal = Number(hive?.balances?.hive ?? 0);
  const hbdBal = Number(hive?.balances?.hbd ?? 0);
  // טריגר 1: דלק יושב מחוץ לסולם
  if (orders === 0 && (hiveBal >= 0.02 || hbdBal >= 0.001)) {
    return {
      act: true,
      reason: `רגל HIVE: דלק יושב מחוץ לסולם (${hiveBal.toFixed(3)} HIVE / ${hbdBal.toFixed(3)} HBD) — נפרס לעבודה`,
    };
  }
  // טריגר 2: סטיית הפקודות מהקו (אותו סף-50bps של STEEM)
  if (orders > 0 && Number.isFinite(drift) && Math.abs(drift) > POLICY.hive.driftBps) {
    return {
      act: true,
      reason: `רגל HIVE: הקו זז ${drift > 0 ? "+" : ""}${drift}bps מהסולם — הסולם נגרר אליו`,
    };
  }
  return { act: false, reason: `רגל HIVE על הקו (${orders} פקודות · drift ${Number.isFinite(drift) ? drift : "?"}bps) — אין פעולה` };
}

async function measure(): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${API}?fresh=1`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function act(
  reason: string,
  action: "reprice" | "arm-buy" | "stock-sbd" | "arena-stream" = "reprice",
  target: "steem" | "hive" = "steem",
): Promise<boolean> {
  state.acting = true;
  actStartedAt = Date.now();
  // R93 — חוק הירי-היחיד חוצה-הפעלות: הצינון נספר מתחילת הפעולה, לא
  // מסופה. נולד מתקרית חיה (00:34:52Z): restart של הדיבון באמצע act()
  // איפס את הדגלים הזכרוניים (acting/ticking) — וההרצה החדשה לא ראתה
  // פעולה בטיסה כי lastActionAt עודכן רק בסוף. התוצאה: שני POSTs
  // back-to-back (00:34:29 + 00:34:54). מעתה: lastActionAt נכתב בהתחלה —
  // restart באמצע פעולה נתקל בצינון כנה במקום בירי כפול.
  state.lastActionAt = new Date().toISOString();
  state.lastDecision = { at: state.lastActionAt, kind: "ACTING", detail: reason };
  saveState();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180_000); // פעולת-כסף: חלון רחב (3 דק'), שידור Steem איטי
  let result: Record<string, unknown> = {};
  try {
    if (action === "arena-stream") {
      // R103 — ההזרמה הולכת לזירת-המסחר, לא למוח הכסף
      const res = await fetch(EXCHANGE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "liquidity-stream", share: POLICY.liquidityStream.share }),
        signal: ctl.signal,
      });
      result = (await res.json()) as Record<string, unknown>;
    } else {
    const res = await fetch(target === "hive" ? HIVE_API : API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
      signal: ctl.signal,
    });
    result = (await res.json()) as Record<string, unknown>;
    }
  } catch (e: any) {
    result = { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
  state.actionsToday += 1;
  const finishedAt = new Date().toISOString();
  state.acting = false;
  // R93 — תיקון קבלה: ה-API מחזיר {ok, receipt:{placed,cancelled,...}, verify}
  // ולא placed ברמה העליונה. הקבלה תעדוק את האמת מעכשיו (לקח R87 —
  // "הוצבו 0" שקרי — הפעם בצד הדיבון).
  const r = (result as any) ?? {};
  // כנות (תיקון ביקורת): יום-ההזרמה נרשם רק כשההזרמה באמת הצליחה —
  // כישלון שרף יום שלם בשקט והגל לא נורה שוב לעולם.
  if (action === "arena-stream" && r.ok) state.lastStreamDay = utcDay();
  // נרמול קבלה: STEEM מחזיר מערכים; HIVE (R101) מחזיר מונים — אחת לכל צורה
  const normList = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "number" ? Array.from({ length: v }) : []);
  const placed: unknown[] = normList(r.placed).length
    ? normList(r.placed)
    : normList(r.receipt?.placed);
  const cancelled: unknown[] = normList(r.cancelled).length
    ? normList(r.cancelled)
    : normList(r.receipt?.cancelled);
  const parityAt = r.parity ?? r.receipt?.parity ?? null;
  // R97: קבלה מבחינה סוג-פעולה; GATE-QUEUED היא הכרעה, לא כישלון —
  // הפעולה מעל סף האוטונומיה וממתינה למפעיל בשער-העסקאות.
  const actionKind = r.ok
    ? String(r.receipt?.kind ?? r.kind ?? (action === "arm-buy" ? "ARM-BUY" : action === "arena-stream" ? "ARENA-STREAM" : target === "hive" ? "HIVE-REPRICE" : "REPRICE"))
    : r.code === "GATE-QUEUED"
      ? "GATE-QUEUED"
      : action === "arm-buy"
        ? "ARM-BUY-FAIL"
        : action === "arena-stream"
          ? "ARENA-STREAM-FAIL"
          : target === "hive"
            ? "HIVE-REPRICE-FAIL"
            : "REPRICE-FAIL";
  state.lastDecision = {
    at: finishedAt,
    kind: actionKind,
    detail: r.ok
      ? `הוצבו ${placed.length} · בוטלו ${cancelled.length} · ${reason}`
      : r.code === "GATE-QUEUED"
        ? `הפעולה (${typeof r.usdValue === "number" ? r.usdValue.toFixed(2) : "?"}$) ≥ סף $${r.threshold} — ממתינה לאישור המפעיל בשער העסקאות. שום כסף לא זז.`
        : `כישלון כנה: ${String(r.error ?? r.receipt?.error ?? "לא ידוע").slice(0, 120)}`,
  };
  saveState();
  appendHistory({
    kind: state.lastDecision.kind,
    reason,
    parity: parityAt,
    placed: placed.length, // counts only - no fake arrays (R101c receipt-honesty fix)
    cancelled: cancelled.length,
    error: r.error ?? r.receipt?.error ?? null,
  });
  // קבלה לקנון אחרי כל פעולה (שער-סודות בפנים)
  const receipt = [
    `# קבלת מוביל-הכסף · ${finishedAt}`,
    "",
    `- **סיבה**: ${reason}`,
    `- **תוצאה**: ${state.lastDecision.kind} · הוצבו ${placed.length} · בוטלו ${cancelled.length}`,
    `- **פאריטה בזמן הפעולה**: ${parityAt ?? "לא נמדד"}`,
    `- **פעולות היום**: ${state.actionsToday}/${POLICY.actionsBudgetPerDay}`,
    `- **כנות**: ${r.error ?? r.receipt?.error ? `שגיאה: ${String(r.error ?? r.receipt?.error).slice(0, 200)}` : "אין"}`,
    "",
    `_מופק אוטונומית על-ידי money-mover v${state.version} (R101 · HIVE leg + stock-sbd + vault)._`,
  ].join("\n");
  await canonPush(`reports/money-${utcDay()}.md`, receipt);
  return !!r.ok; // אמת-הפעולה עולה לקורא (גם ל-/act) — לא "הוזנק" בלבד
}

let ticking = false;
// R112 — tick watchdog (the live-freeze law): the interval itself watches
// the guard it lives behind. A tick stuck longer than TICK_MAX_MS is
// force-released with an honest history note — the hung await is orphaned
// (if it ever wakes it can still mutate state; every fetch is deadline-
// bounded, so the exposure window is time-bounded, not power-removed).
// Caught live: money froze at beats=813 for 20+ minutes while HTTP kept
// answering.
let tickStartedAt = 0;
let actStartedAt = 0;
const TICK_MAX_MS = 5 * 60_000;
const ACTING_MAX_MS = 10 * 60_000;
async function tick() {
  if (ticking || state.acting) return; // לולאה-יחידה (לקח R80)
  ticking = true;
  tickStartedAt = Date.now();
  try {
    state.beats += 1;
    const meas = await measure();
    // שער שלמות-מדידה (R90): balances.steem === null → RPC נכשל → אין אמת, אין פעולה.
    // לעולם לא מפרשים "לא נמדד" כ"0 נזיל" — כסף לא זז על נתוני-רפא.
    if (!meas || meas?.balances?.steem == null) {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "HONEST-FAIL",
        detail: "מדידה חיה נכשלה — לא מתיירים, לא פועלים על נתוני אתמול",
      };
      saveState();
      return;
    }
    // R103 — רייל התגמול: מילויים חדשים בחלון = עבודה אמיתית = SAOS לזירה.
    // הספירה היא סימן-מים עולה: ירידת החלון לא מתגמלת פעמיים.
    try {
      const fillsNow = Number(meas?.fills?.window24h);
      if (Number.isFinite(fillsNow)) {
        const seen = state.fillsSeen ?? 0;
        if (fillsNow > seen) {
          const newFills = fillsNow - seen;
          state.fillsSeen = fillsNow;
          const rew = await fetch(EXCHANGE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "reward-pay",
              member: POLICY.rewards.member,
              amount: Math.max(1, newFills * POLICY.rewards.saosPerFill),
              note: `grid-fills ×${newFills} (window 24h) — עבודה→מטבע→נזילות`,
            }),
            signal: AbortSignal.timeout(30_000),
          }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
          if (rew?.ok) {
            appendHistory({ kind: "SAOS-REWARD", reason: `מילויים ×${newFills}`, saos: newFills * POLICY.rewards.saosPerFill });
            // R107 — שרשרת הגלגול: תגמול שולם ← הגלגול נורה מעצמו.
            // דבר גורר דבר: מילוי ← תגמול ← המרה ל-USDS ← עומק-LP ←
            // עמלות מנפחות מניות. השומרים (צינון/תקציב) במנוע-השרשרת.
            try {
              const comp = await fetch(EXCHANGE_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "agent-compound", member: POLICY.rewards.member, note: "grid-fill domino" }),
                signal: AbortSignal.timeout(45_000),
              }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
              if (comp?.ok) {
                appendHistory({ kind: "CHAIN-COMPOUND", reason: String(comp.detail ?? "").slice(0, 140) });
              } else if (comp) {
                appendHistory({ kind: "CHAIN-COMPOUND-FAIL", reason: String(comp.error ?? "לא צוין").slice(0, 120) });
              }
            } catch { /* הגלגול לעולם לא מפיל את המדידה */ }
          } else {
            // R123 — כנות: תגמול על עבודה מוכחת שנכשל — נרשם, לא נבלע
            appendHistory({ kind: "SAOS-REWARD-FAIL", reason: `מילויים ×${newFills}`, error: String(rew?.error ?? "הקריאה לא נענתה").slice(0, 120) });
          }
        } else if (fillsNow < seen) {
          state.fillsSeen = fillsNow; // החלון התנקה — סימן-המים בעקבות האמת
        }
      }
    } catch { /* התגמול לעולם לא מפיל את המדידה */ }
    // R105 — סריקת דלת-ההפקדות בפעימה (חוק חיים):
    // עד R105 הסריקה הייתה ידנית בלבד — הפקדות המתינו בזמן שהמנוע חי.
    // עכשיו: כל 5 דקות פותחות המפוגה — חמש רשתות, שוקדפות נזקפות מהרגע שהכסף נוגע לשרשרת.
    try {
      const lastScan = state.lastDepositScanAt ? new Date(state.lastDepositScanAt).getTime() : 0;
      if (Date.now() - lastScan >= 5 * 60_000) {
        state.lastDepositScanAt = new Date().toISOString();
        const dep = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deposit-scan" }),
          signal: AbortSignal.timeout(45_000),
        }).then((x) => x.json() as Promise<{ ok?: boolean; credited?: number; detail?: string }>).catch(() => null);
        if (dep?.credited && dep.credited > 0) {
          appendHistory({ kind: "DEPOSIT-CREDIT", reason: dep.detail ?? `${dep.credited} deposits credited`, placed: dep.credited });
        }
      }
    } catch { /* הסריקה לעולם לא מפילה את המדידה */ }
    // R108 — גוב-הצי: עבודה מוכחת מקבצי-המצב של הדיבונים ← SAOS ← זירה.
    // הזיהוי באמת-מקומית (קריאת המצב, לא טענת-רשת) והתקרות נאכפות בשרת
    // (REWARD_DAILY_CAPS). שלושה סוגי-עבודה נספרים: החיית-דיבון (שומר)
    // · שידור-שרשרת יומי (דופק) · סיור-בחינות רציף (תלמיד — פעם ביום,
    // התדירות היא העבודה). אחר-כך גלגול-צי ואיזון-בריכות.
    try {
      const readJson = (p: string): any | null => {
        try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
      };
      const wm = state.fleetSeen ?? {};
      // (א) שומר — החייה מוכחת בהיסטוריה שלו
      const ks = readJson(`${HOME}/sovereign/keeper/state.json`);
      if (ks && Array.isArray(ks.history)) {
        const restarts = (ks.history as Array<{ at: string; kind: string; detail: string }>)
          .filter((h) => h.kind === "RESTART")
          .sort((a, b) => a.at.localeCompare(b.at));
        const last = restarts[restarts.length - 1];
        if (last && last.at !== wm.keeperRestartAt) {
          const isNew = !wm.keeperRestartAt || last.at > wm.keeperRestartAt;
          if (isNew) {
            wm.keeperRestartAt = last.at;
            state.fleetSeen = wm;
            const rew = await fetch(EXCHANGE_API, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reward-pay", member: "keeper", amount: 2, note: `החיית דיבון מוכחת: ${last.detail.slice(0, 80)}` }),
              signal: AbortSignal.timeout(30_000),
            }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
            if (rew?.ok) appendHistory({ kind: "FLEET-PAY", reason: `keeper: ${last.detail.slice(0, 100)}`, saos: 2 });
          }
        }
      }
      // (ב) דופק — שידור-שרשרת יומי מוכח
      const ps = readJson(`${HOME}/sovereign/pulse/state.json`);
      if (ps?.lastPublishUtcDay && ps.lastPublishUtcDay !== wm.pulseDay) {
        wm.pulseDay = ps.lastPublishUtcDay;
        state.fleetSeen = wm;
        const rew = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reward-pay", member: "pulse", amount: 2, note: `שידור יומי לשרשרת ${ps.lastPublishUtcDay}` }),
          signal: AbortSignal.timeout(30_000),
        }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
        if (rew?.ok) appendHistory({ kind: "FLEET-PAY", reason: `pulse: שידור ${ps.lastPublishUtcDay}`, saos: 2 });
      }
      // (ג) תלמיד — סיור-בחינות רציף (פעם ביום — התדירות היא העבודה)
      const ss = readJson(`${HOME}/sovereign/student/state.json`);
      if (ss?.lastExamAt) {
        const examDay = String(ss.lastExamAt).slice(0, 10);
        const fresh = Date.now() - new Date(ss.lastExamAt).getTime() < 2 * 3600_000; // בחינה בשעתיים האחרונות = סיור חי
        if (fresh && examDay !== wm.studentDay) {
          wm.studentDay = examDay;
          state.fleetSeen = wm;
          const rew = await fetch(EXCHANGE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reward-pay", member: "student", amount: 1, note: `סיור-בחינות רציף ${examDay}` }),
            signal: AbortSignal.timeout(30_000),
          }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
          if (rew?.ok) appendHistory({ kind: "FLEET-PAY", reason: `student: סיור ${examDay}`, saos: 1 });
        }
      }
      // (ד) גלגול-צי — כל 5 דקות (סריקת המאזנים כבדה; חלונות במים במקומץ)
      const lastSweep = state.lastFleetSweepAt ? new Date(state.lastFleetSweepAt).getTime() : 0;
      if (Date.now() - lastSweep < 5 * 60_000) { state.fleetSeen = wm; } else {
      state.lastFleetSweepAt = new Date().toISOString();
      const fleetBal = await fetch(EXCHANGE_API, { signal: AbortSignal.timeout(20_000) })
        .then((x) => x.json() as Promise<{ members?: Array<{ member: string; balances: Record<string, number> }> }>).catch(() => null);
      const compoundable = (fleetBal?.members ?? []).filter(
        (m) => !["treasury", "reserve", "operator"].includes(m.member) && (m.balances?.SAOS ?? 0) >= 4,
      );
      if (compoundable.length > 0) {
        const fc = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "fleet-compound" }),
          signal: AbortSignal.timeout(60_000),
        }).then((x) => x.json() as Promise<Record<string, unknown>>).catch(() => null);
        if (fc?.ok) appendHistory({ kind: "FLEET-COMPOUND", reason: String(fc.detail ?? "").slice(0, 120) });
      }
      } // סוף שער הגלגול-צי
      // (ה) איזון-בריכות — סטיות נמדדות ונסגרות (R108) — כל 10 דק'
      const lastGuard = state.lastPoolGuardAt ? new Date(state.lastPoolGuardAt).getTime() : 0;
      if (Date.now() - lastGuard >= 10 * 60_000) {
        state.lastPoolGuardAt = new Date().toISOString();
        const pg = await fetch(EXCHANGE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pool-guard" }),
          signal: AbortSignal.timeout(45_000),
        }).then((x) => x.json() as Promise<{ ok?: boolean; detail?: string }>).catch(() => null);
        if (pg?.ok && pg.detail) appendHistory({ kind: "POOL-GUARD", reason: String(pg.detail).slice(0, 120) });
      }
      state.fleetSeen = wm;
    } catch { /* גוב-הצי לעולם לא מפיל את המדידה */ }

    const d = await decide(meas);
    const now = new Date();
    if (d.act) {
      await act(d.reason, d.action ?? "reprice");
    } else {
      // R101c — חוק-הברזל לשתי הרגליים: צינון + תקציב חלים גם על HIVE.
      // (נלמד מתקרית חיה: ללא השערות האלה הרגל שרפה 28 פעולות ביום —
      // כל פעימה עם סטייה>50bps שידרה מחדש. אותם חוקים, אותו מוח.)
      const sinceMin = state.lastActionAt
        ? (now.getTime() - new Date(state.lastActionAt).getTime()) / 60_000
        : null;
      const cooldownBlock =
        sinceMin != null && sinceMin < POLICY.cooldownMin
          ? `WAIT-COOLDOWN · עוד ${Math.ceil(POLICY.cooldownMin - sinceMin)} דק'`
          : null;
      const budgetBlock =
        state.actionsToday >= POLICY.actionsBudgetPerDay
          ? `WAIT-BUDGET · ${state.actionsToday}/${POLICY.actionsBudgetPerDay} פעולות היום — התקציב נאכל`
          : null;
      if (cooldownBlock ?? budgetBlock) {
        state.lastDecision = {
          at: new Date().toISOString(),
          kind: (cooldownBlock ?? budgetBlock ?? "").split(" ·")[0],
          detail: `${d.reason} · ${cooldownBlock ?? budgetBlock}`,
        };
        saveState();
      } else {
        // R101 — רגל HIVE: נבדקת רק כשאין פעות-STEEM בפעימה זו (צינון-יחידה).
        // אותם חוקים: צינון, תקציב, שער-$100 — במוח שלה (api/money/hive).
        const hive = await measureHive();
        const dh = await decideHive(hive);
        if (dh.act) {
          await act(dh.reason, "reprice", "hive");
        } else {
          state.lastDecision = {
            at: new Date().toISOString(),
            kind: d.reason.startsWith("WAIT") ? d.reason.split(" ·")[0] : "HOLD",
            detail: `${d.reason} · ${dh.reason}`,
          };
          saveState();
        }
      }
    }
  } catch (e: any) {
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) };
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות (השומר קורא את זה כל 30ש') ─────────────────────────
// R124 — שרת-היחיד חוצה-דורות (חוק weblift מ-r123): bun --hot שמעריך את
// המודול מחדש נתקל ב-EADDRINUSE מול השרת של הדור הקודם וההערכה נעצרת
// לפני שהטיימר חומש. שרת אחד לכל חיי התהליך; ה-handler קורא את המצב החי
// מציר-העולם (G_MONEY.__MONEY_STATE__) — זהה לאובייקט של הדור החי.
const G_MONEY_SRV = globalThis as unknown as { __MONEY_SERVER__?: unknown };
if (G_MONEY_SRV.__MONEY_SERVER__) {
  // שרת חי מדור קודם — ממשיך להגיש; המצב שלו הוא אובייקט ציר-העולם.
} else {
  G_MONEY_SRV.__MONEY_SERVER__ = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // R123 — פקודות-כסף (/act) נשלחות מ-localhost בלבד — לא נחשפות לרשת החוץ
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
    }
    if (url.pathname === "/act" && req.method === "POST") {
      // פקודת-מפעיל ידנית (דרך שער המפעיל) — אותן פעולות, אותם חוקים
      if (state.acting) return Response.json({ ok: false, error: "already-acting" }, { status: 409 });
      const body = await req.json().catch(() => ({}));
      const target = body?.target === "hive" ? "hive" : "steem";
      const actOk = await act(
        String(body?.reason ?? "manual operator command").slice(0, 200),
        body?.action === "arm-buy" ? "arm-buy" : body?.action === "stock-sbd" ? "stock-sbd" : body?.action === "arena-stream" ? "arena-stream" : "reprice",
        target,
      );
      // אמת ברמת ה-HTTP: ok משקף את תוצאת הפעולה עצמה (לא "הוזנק בהצלחה")
      // — ההחלטה המלאה והכנה ב-lastDecision המצורף.
      return Response.json({ ok: actOk, lastDecision: state.lastDecision });
    }
    return new Response("not found", { status: 404 });
  },
  });
}

saveState();
console.log(`[money-mover] חי על פורט ${PORT} · beats=${state.beats} · actionsToday=${state.actionsToday} · R112 bounded-wait + watchdog`);
tick();
// R111 — law of the single timer (R109 lesson, applied to money):
// bun --hot re-evaluates the module but does NOT clear the old interval —
// two live closures then double-fire acts (measured live 05:16: old decide()
// fired stock-sbd with the pre-R111 reason while the new code was already
// deployed). The singleton guard captures the previous timer and clears it.
const G = globalThis as unknown as { __MONEY_TIMER__?: ReturnType<typeof setInterval> };
if (G.__MONEY_TIMER__) clearInterval(G.__MONEY_TIMER__);
G.__MONEY_TIMER__ = setInterval(() => {
  // R112 — שומר-הפעימה: הפעימה התלויה עולה במחיר מחזור אחד, לא במחיר הדיבון
  const nowMs = Date.now();
  if (ticking && tickStartedAt && nowMs - tickStartedAt > TICK_MAX_MS) {
    ticking = false;
    appendHistory({ kind: "WATCHDOG-RELEASE", reason: `tick נעול >${Math.round(TICK_MAX_MS / 60000)} דק' — הנעילה שוחררה; ה-await התלוי יתום: אם יתעורר, יכולת-הכתיבה שלו לא נשללה (כל ה-fetches deadline-bound — חלון הסיכון חסום-זמן בלבד)` });
    saveState();
  }
  if (state.acting && actStartedAt && nowMs - actStartedAt > ACTING_MAX_MS) {
    state.acting = false;
    state.lastDecision = { at: new Date().toISOString(), kind: "WATCHDOG-ACTING-RELEASE", detail: `acting נעול >${Math.round(ACTING_MAX_MS / 60000)} דק' — שוחרר בכוח בכנות; חוקי הצינון והתקציב עודם שומרים על הכסף` };
    saveState();
  }
  tick();
}, CHECK_INTERVAL_SEC * 1000);
