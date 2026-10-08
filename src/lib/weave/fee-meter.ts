// ─────────────────────────────────────────────────────────────────────────────
// THE WEAVE · fee-meter — מנוע הוכחת-הרווח-העצמי (Task 18 · דבר-המפעיל
// "תמשיך מעולה יותר עמוק בנוסף אחרי שתסיים טוב יותר ודחוף").
//
// הרעיון: ריבונות שאינה מתקיימת כלכלית היא סיסמה. ה-fee-meter הוא ההוכחה:
// בכל שעה הוא מודד **הכנסה מול עלות** לכל מסילה, גוזר ניקוד-נטו, ומזין את
// הפסיקה ל-decide() — המוח. מעכשיו האוטונומיה יודעת אם היא מרוויחה —
// מדידה, לא טענה.
//
// מסילות-עלות (כולן נמדדות חי; אין מספר מומצא):
//   · external-spend — טרנספרים-החוצה מהאוצר (STEEM/SBD) ב-24ש' → USD
//     בשערי-האמת של הספר (liveMarks). זו העלות-הכספית היחידה האמיתית.
//   · steem-rc / hive-rc — רוחב-הפס של השרשרות הגרפניות. עלות-USD = 0
//     (RC הוא תקציב-רגנרציה, לא כסף) — אך בריאותו נמדדת: אחוז-מנה חי.
//   · zero-gas — שער-האפס על Z Chain 9369: eth_gasPrice נמדד חי.
//     0x0 ⇒ עלות 0.000000$ (התכונה-הריבונית עצמה). אם הרשת תחליף כלל —
//     נדווח כנה "unpriced" ולא אפס מומצא.
//
// פסיקות: PROFIT · BREAKEVEN · LOSS · UNMEASURED (אין מדידה ⇒ אין שיפוט).
// LOSS ⇒ QUEUE ב-decide (חוק-פיצול-המטבע: כסף-חיצוני = רק המפעיל).
// רישום: hash-chained (אותה משמעת של decide-runs והספר).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { createHash } from "node:crypto";

import { hiveRcGate, steemRcGate } from "@/lib/weave/graphene";
import { zeroReadiness } from "@/lib/weave/zero";
import { composeIncome, liveMarks, type IncomeReport } from "@/lib/weave/income";

const MP = "/home/z/my-project";
const ACCOUNT = "headcorner";
const STEEM_RPC = "https://api.steemit.com";
const RUNS_FILE = `${MP}/sovereign/fee-meter/fee-meter-runs.jsonl`;
const SCAN_WINDOW_MS = 24 * 3_600_000; // 24 שעות מתגלגלות
const MAX_PAGES = 6;
/** סף-מהותיות: ניואנסי-עיגול/FIFO מתחת-לזה = מסגרת-רעש, לא הפסד-מסילה.
 *  בלי-זה כל -$0.0047 היה מציף את תור-המפעיל ב-QUEUE שעתי — רעש, לא אות. */
const MATERIALITY_USD = 0.05;

export type FeeVerdict = "PROFIT" | "BREAKEVEN" | "LOSS" | "UNMEASURED";

export interface FeeLane {
  id: string;
  nameHe: string;
  costUsd: number | null;
  incomeUsd: number | null;
  healthHe: string;
  ok: boolean;
}

export interface FeeMeterRun {
  seq: number;
  prevHash: string;
  entryHash: string;
  at: string;
  execute: boolean;
  verdict: FeeVerdict;
  incomeUsdToday: number | null;
  spendUsd24h: number;
  netUsd24h: number | null;
  lanes: FeeLane[];
  noteHe: string;
}

// ── כלים ─────────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function canonicalHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

interface ChainOp {
  at: string;
  type: string;
  value: Record<string, unknown>;
}

async function rpcRead<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
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

// ── מדידות-עלות ──────────────────────────────────────────────────────────────

/** ההוצאה-הכספית האמיתית: טרנספרים-החוצה מהאוצר ב-24ש' (סריקה קלה מהזנב). */
async function measureExternalSpend24h(): Promise<{ steem: number; sbd: number; ops: number; scanNote: string }> {
  let steem = 0;
  let sbd = 0;
  let ops = 0;
  const since = Date.now() - SCAN_WINDOW_MS;
  let start: number | -1 = -1;
  let pages = 0;
  let reachedFloor = false;
  let lastErr = "";
  while (pages < MAX_PAGES && !reachedFloor) {
    let hist: Array<[number, { timestamp: string; op: [string, Record<string, unknown>] }]> | null = null;
    try {
      hist = await rpcRead("condenser_api.get_account_history", [ACCOUNT, start, 200]);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      break;
    }
    if (!hist || !hist.length) break;
    pages += 1;
    let minTs = Infinity;
    for (const [, rec] of hist) {
      const t = Date.parse(`${rec?.timestamp ?? ""}Z`);
      if (Number.isFinite(t)) minTs = Math.min(minTs, t);
      if (t < since) reachedFloor = true; // הגענו אל מעבר לחלון — מספיק
      const op = rec?.op;
      if (!Array.isArray(op) || op[0] !== "transfer") continue;
      const v = op[1] as Record<string, string>;
      if (String(v.from ?? "") !== ACCOUNT) continue;
      if (!(t >= since && Number.isFinite(t))) continue;
      const amt = parseAmount(v.amount);
      const asset = String(v.amount ?? "").trim().split(/\s+/)[1] ?? "";
      if (asset === "STEEM") steem += amt;
      else if (asset === "SBD") sbd += amt;
      else continue;
      ops += 1;
    }
    const oldestIdx = hist[0]?.[0];
    if (oldestIdx == null || oldestIdx <= 0) reachedFloor = true;
    else start = Math.max(0, oldestIdx - 1);
    if (Number.isFinite(minTs) && minTs >= since && oldestIdx != null && oldestIdx <= 0) break;
  }
  const scanNote = pages === 0 ? `ההיסטוריה לא נקראה (${lastErr.slice(0, 60) || "ריק"}) — הוצאה לא נמדדה`
    : `${pages} עמודים נסרקו מהזנב${reachedFloor ? " · כוסה מלוא-החלון" : " · החלון לא כוסה עד-תום (כנות: ייתכן חסר)"}`;
  return { steem, sbd, ops, scanNote };
}

// ── מטמון ההכנסה (הסריקה כבדה — 60ש' מטמון לקריאות-API) ────────────────────
let incomeCache: { at: number; report: IncomeReport } | null = null;
const INCOME_CACHE_MS = 60_000;

async function incomeReportCached(): Promise<IncomeReport> {
  if (incomeCache && Date.now() - incomeCache.at < INCOME_CACHE_MS) return incomeCache.report;
  const report = await composeIncome();
  incomeCache = { at: Date.now(), report };
  return report;
}

export function invalidateIncomeCache(): void {
  incomeCache = null;
}

// ── הריצה ────────────────────────────────────────────────────────────────────

export async function runFeeMeter(opts: {
  execute?: boolean;
  income?: IncomeReport | null; // כש-decide קורא — הדוח כבר ביד; לא סורקים פעמיים
} = {}): Promise<FeeMeterRun> {
  const execute = opts.execute === true;
  const at = new Date().toISOString();
  const nowMs = Date.now();

  // 0) הכנסה — מהפרמטר או מהמטמון
  let income: IncomeReport | null = null;
  try {
    income = opts.income ?? (await incomeReportCached());
  } catch { /* כנות: נמשיך עם UNMEASURED */ }

  const incomeToday = income?.ok ? income.totals.usdToday : null;
  const incomeSources = new Map<string, { usd: number | null; nameHe: string }>();
  if (income?.ok) {
    for (const s of income.sources) {
      incomeSources.set(s.id, { usd: s.usdToday, nameHe: s.nameHe });
    }
  }

  // 1) העלות-הכספית: טרנספרים-החוצה ב-24ש' → USD בשערי-האמת
  let spendUsd: number | null = null;
  let spendNote = "";
  try {
    const [spend, marks] = await Promise.all([measureExternalSpend24h(), liveMarks()]);
    const priceable = marks.steemUsd != null || marks.sbdUsd != null;
    if (spend.ops === 0) {
      spendUsd = 0;
      spendNote = `אפס טרנספרים-החוצה מ${ACCOUNT} ב-24ש' (${spend.scanNote}) — עלות-כסף-חיצונית 0.00$`;
    } else if (priceable) {
      const st = marks.steemUsd ?? 0;
      const sb = marks.sbdUsd ?? 0;
      spendUsd = round4(spend.steem * st + spend.sbd * sb);
      spendNote = `${spend.ops} טרנספרים-החוצה (${spend.steem.toFixed(3)} STEEM · ${spend.sbd.toFixed(3)} SBD) → ${spendUsd?.toFixed(4)}$ בשערי-האמת (${marks.marksAgeHe}) · ${spend.scanNote}`;
    } else {
      spendUsd = null;
      spendNote = `${spend.ops} טרנספרים אך אין שער — ההוצאה לא מומרת (אין מספר מומצא)`;
    }
  } catch (e) {
    spendNote = `מדידת-הוצאה נכשלה: ${String((e as Error)?.message ?? e).slice(0, 80)}`;
  }

  // 2) בריאות-מסילות (עלות-USD = 0 קנונית; הבריאות נמדדת)
  const lanes: FeeLane[] = [];

  // 2a) רוחב-הפס גרפני — RC של האוצר בשתי השרשרות (floor=0 = מדידה טהורה)
  for (const [id, nameHe, gate] of [
    ["steem-rc", "רוחב-פס STEEM (RC)", () => steemRcGate(ACCOUNT, 0)],
    ["hive-rc", "רוחב-פס HIVE (RC)", () => hiveRcGate(ACCOUNT, 0)],
  ] as const) {
    try {
      const r = await gate();
      const pct = r.max > 0 ? Math.round((r.mana / r.max) * 1000) / 10 : null;
      lanes.push({
        id, nameHe,
        costUsd: r.max > 0 ? 0 : null,
        incomeUsd: incomeSources.get(id === "steem-rc" ? "author-rewards" : "curation-rewards")?.usd ?? null,
        ok: r.ok && r.max > 0,
        healthHe: r.max > 0
          ? `מנה חיה ${pct}% (${r.mana.toExponential(2)} / ${r.max.toExponential(2)}) — תקציב-רגנרציה, לא כסף: עלות 0.00$`
          : `לא נמדד: ${r.reason ?? "rc-unreadable"} — אין מספר מומצא`,
      });
    } catch (e) {
      lanes.push({ id, nameHe, costUsd: null, incomeUsd: null, ok: false, healthHe: `נכשל: ${String((e as Error)?.message ?? e).slice(0, 60)}` });
    }
  }

  // 2b) קו-ה-ZERO — שער-האפס נמדד חי (התכונה הריבונית)
  try {
    const z = await zeroReadiness();
    const zeroGas = z.zeroGasConfirmed;
    lanes.push({
      id: "zero-gas",
      nameHe: "גז Z Chain 9369 (קו-ה-ZERO)",
      costUsd: zeroGas ? 0 : null,
      incomeUsd: null,
      ok: z.ok && zeroGas,
      healthHe: zeroGas
        ? `gasPrice מדוד 0x0 (block ${z.blockNumber ?? "?"}) — עוגני-האמת בעלות 0.000000$ (התכונה-הריבונית חיה)`
        : `לא נמדד/שער-האפס לא אושר: ${z.verdict ?? z.error ?? "zero-unreadable"} — לא מכריזים עלות מומצאת`,
    });
  } catch (e) {
    lanes.push({ id: "zero-gas", nameHe: "גז Z Chain 9369 (קו-ה-ZERO)", costUsd: null, incomeUsd: null, ok: false, healthHe: `RPC לא ענה: ${String((e as Error)?.message ?? e).slice(0, 60)}` });
  }

  // 2c) מסילות-הכנסה שאין להן עלות-שרשרת משלהן (מסחר/זירה — תשתית-עצמית)
  for (const sid of ["grid-trading", "dex-fees"]) {
    const src = incomeSources.get(sid);
    if (src) {
      lanes.push({
        id: sid, nameHe: src.nameHe,
        costUsd: 0,
        incomeUsd: src.usd,
        ok: src.usd != null,
        healthHe: `תשתית-ריבונית-עצמית (אפס ספק חיצוני) — עלות תפעול 0.00$ · הכנסת-המסילה ${src.usd == null ? "לא נמדדה" : `${src.usd.toFixed(4)}$ היום`}`,
      });
    }
  }

  // 3) הפסיקה
  const spendForNet = spendUsd ?? 0; // הוצאה לא-ניתנת-לתמחור נדירה — הפסיקה נשפטת על מה שנמדד
  let verdict: FeeVerdict;
  let netUsd: number | null = null;
  if (incomeToday == null) {
    verdict = "UNMEASURED";
  } else {
    netUsd = round4(incomeToday - spendForNet);
    if (netUsd > MATERIALITY_USD) verdict = "PROFIT";
    else if (netUsd < -MATERIALITY_USD) verdict = "LOSS";
    else verdict = "BREAKEVEN";
  }

  const fmt = (n: number | null): string => (n == null ? "?" : `$${n.toFixed(4)}`);
  const noteHe =
    verdict === "UNMEASURED"
      ? `אין מדידת-הכנסה (${income?.ok === false || !income ? "ספר-ההכנסה לא נקרא" : "usdToday=null"}) — המונה לא שופט בלי מספר; העלות נמדדה: ${fmt(spendUsd)}`
      : verdict === "PROFIT"
        ? `הרווח-העצמי הוכח היום: הכנסה ${fmt(incomeToday)} − עלות ${fmt(spendUsd)} = ${fmt(netUsd)} נטו/24ש' — הצי מתקיים מעצמו (מדידה, לא טענה)`
        : verdict === "BREAKEVEN"
          ? `איזון: הכנסה ${fmt(incomeToday)} ≈ עלות ${fmt(spendUsd)} = ${fmt(netUsd)} נטו/24ש' — בתוך מסגרת-הרעש (±$${MATERIALITY_USD.toFixed(2)}); ההכנסה טרם-יבול אך העלות-אפס`
          : `הפסד מדוד: הכנסה ${fmt(incomeToday)} − עלות ${fmt(spendUsd)} = ${fmt(netUsd)} נטו/24ש' — הסלמה למפעיל (חוק-פיצול-המטבע)`;

  // 4) רישום hash-chained
  const prev = readJsonl(RUNS_FILE);
  const prevHash = prev.length ? String(prev[prev.length - 1].entryHash ?? "") : "GENESIS";
  const seq = prev.length + 1;
  const base = { seq, prevHash, at, execute, verdict, incomeUsdToday: incomeToday, spendUsd24h: spendUsd, netUsd24h: netUsd, lanes };
  const entryHash = canonicalHash(base);
  const run: FeeMeterRun = { ...base, entryHash, noteHe };

  if (execute) {
    try {
      fs.mkdirSync(`${MP}/sovereign/fee-meter`, { recursive: true });
      fs.appendFileSync(RUNS_FILE, JSON.stringify(run) + "\n");
    } catch { /* כשל-דיסק לא מפיל את המדידה */ }
  }
  return run;
}

export function latestFeeMeterRun(): FeeMeterRun | null {
  const runs = readJsonl(RUNS_FILE);
  return runs.length ? (runs[runs.length - 1] as unknown as FeeMeterRun) : null;
}

export function feeMeterHistory(n = 8): FeeMeterRun[] {
  return readJsonl(RUNS_FILE).slice(-n) as unknown as FeeMeterRun[];
}

/** גיל הריצה האחרונה בדקות — להשוואת-חיות ב-decide. */
export function feeMeterAgeMin(): number | null {
  const last = latestFeeMeterRun();
  if (!last?.at) return null;
  const t = Date.parse(last.at);
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60_000) : null;
}
