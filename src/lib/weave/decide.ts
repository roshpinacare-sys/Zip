// ─────────────────────────────────────────────────────────────────────────────
// THE WEAVE · decide() — המוח המבצע של האוטונומיה (Task 17 · דבר-המפעיל
// "תמשיך ודחוף" על הקו-הנקי לאחר חוק-ההחזקה).
//
// הרעיון: בצי יש כבר כל-שולחן — הכנסה (R127), מלגות (Task 12), שוק-אמת
// (Task 14/15), שומר (Task 11), שער-כסף (TxGate), חוק-עצימה (r197).
// מה שהיה חסר: **מוח-אחד שמריץ את כולם בכל שעה** — אוסף מועמדויות,
// בודק חוק, מבצע מה שמותר (אידמפוטנטי · אפס-כסף-חיצוני), תור את
// שנחסם, ומשאיר רישום-שרשרת. אף-החלטה לא נשארת לא-מוחלטת.
//
// חוקי-ברזל:
//   · fail-closed — GATE.json קרוע/PAUSED ⇒ מתכנן ולא מבצע.
//   · חוק-פיצול-המטבע: פעולה פנימית-בטוחה מבוצעת; כסף-חיצוני ⇒ QUEUE (TxGate).
//   · אידמפוטנציה — כל פעולה בטוחה להרצה-חוזרת (יום/שבוע).
//   · כנות — כל הכרעה נרשמת גם כשהיא "כלום קרה" (NOOP היא תוצאה).
//   · רישום hash-chained — prevHash/entryHash (אותה משמעת של הספר).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { readGate } from "@/lib/autonomy-law";
import { composeIncome, writeIncomeDay } from "@/lib/weave/income";
import { scholarshipPay } from "@/lib/weave/sovereign-scholarship";
import { runFeeMeter, type FeeMeterRun } from "@/lib/weave/fee-meter";
import { zeroReadiness } from "@/lib/weave/zero";
import { heartbeatLiveness, type HeartbeatLiveness } from "@/lib/weave/heartbeat";

const MP = "/home/z/my-project";
const ZIP = `${MP}/zip`;
const DECIDE_DIR = `${MP}/sovereign/decide`;
const RUNS_FILE = `${DECIDE_DIR}/decide-runs.jsonl`;
const WATCHDOG_STATE = "/home/z/fleet-tmp/logs/watchdog-state.json";
const WEB_PUBLISH = `${ZIP}/scripts/web-publish.ts`;
const HELD_MANIFEST = `${ZIP}/sovereign/web/manifests/23b9c550d7c0d691e5e36e86c6bb32251d5bf321a4f96f0f418da7031291f14b.json`;

export type DecideVerdict = "EXECUTED" | "EXECUTED-NOOP" | "QUEUE" | "DEFER" | "ALERT";

export interface DecideLine {
  id: string;
  kind: string;
  verdict: DecideVerdict;
  detailHe: string;
}

export interface DecideRun {
  seq: number;
  prevHash: string;
  entryHash: string;
  at: string;
  gate: string;
  execute: boolean;
  verdicts: DecideLine[];
  noteHe: string;
}

// ── כלים ─────────────────────────────────────────────────────────────────────

function readJsonl(file: string): Array<Record<string, unknown>> {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function canonicalHash(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── אספני-המועמדויות (קריאה-בלבד) ────────────────────────────────────────────

function candidateIncomeGap(report: Awaited<ReturnType<typeof composeIncome>> | null): DecideLine {
  if (!report?.ok) return { id: "income-gap", kind: "law", verdict: "DEFER", detailHe: "אין-ספר-הכנסה — לא שופטים בלי-מדידה" };
  const today = report.totals?.usdToday;
  const target = report.gap?.targetUsdPerDay ?? 0;
  if (today == null) {
    return { id: "income-gap", kind: "law", verdict: "DEFER", detailHe: "usdToday=null — אין-מדידת-היום; לא ממציאים אפס" };
  }
  if (target <= 0) return { id: "income-gap", kind: "law", verdict: "DEFER", detailHe: "אין-יעד מוגדר" };
  if (today >= target * 0.5) {
    return { id: "income-gap", kind: "law", verdict: "EXECUTED-NOOP", detailHe: `היום $${today.toFixed(2)} מתוך יעד $${target}/יום — מעל 50% מהיעד, אין-הסלמה` };
  }
  const fmtUsd = (n: number): string => `$${Math.abs(n) < 0.005 ? "0.00" : n.toFixed(2)}`;
  return {
    id: "income-gap",
    kind: "law",
    verdict: "QUEUE",
    detailHe: `פער-משימה: ${fmtUsd(today)} מתוך $${target}/יום (<50%) — הסלמה למפעיל: הזרמת-הון חיצוני מעל סף-השער (חוק-פיצול-המטבע: כסף-חיצוני=GATED)`,
  };
}

function candidateHeldLane(): DecideLine {
  // חוק-ההחזקה (הוראת-מפעיל 2026-10-08): צינור-המזל קפוא. decide() מאמת
  // בכל שעה ששני-השערים על-מקומם: דגל-המניפסט + שער-הקוד. אם-נפל
  // שער — QUEUE התראה למפעיל (לעולם לא משחררים לבד — זו בדיוק הנקודה).
  const manifest = readJson(HELD_MANIFEST);
  const manifestHeld = manifest?.held === true;
  let codeGate = false;
  try {
    codeGate = fs.readFileSync(WEB_PUBLISH, "utf8").includes("HELD_PACKAGES");
  } catch { /* קריאה-נכשלה = שער-לא-נמדד */ }
  if (manifestHeld && codeGate) {
    return { id: "held-lane", kind: "compliance", verdict: "EXECUTED-NOOP", detailHe: "חוק-ההחזקה על-מקומו: דגל-מניפסט ✓ · שער-קוד (HELD_PACKAGES) ✓ — אפס-פעולה" };
  }
  return {
    id: "held-lane",
    kind: "compliance",
    verdict: "QUEUE",
    detailHe: `התראת-החזקה: דגל-מניפסט=${manifestHeld ? "✓" : "✗"} · שער-קוד=${codeGate ? "✓" : "✗"} — נדרשת-התערבות; האוטונומיה לא משחררת ולא מתקנת שער-החזקה לבד`,
  };
}

function candidateFeeMeter(run: FeeMeterRun | null): DecideLine {
  // Task 18 — מונה-העמלות: הוכחת-הרווח-העצמי. PROFIT/BREAKEVEN ⇒ אין-פעולה
  // (הכלכלה מתקיימת); LOSS ⇒ תור-מפעיל (חוק-פיצול-המטבע); אין-מדידה ⇒ נדחה-כנות.
  if (!run) {
    return { id: "fee-meter", kind: "economy", verdict: "DEFER", detailHe: "מונה-העמלות לא נמדד — לא שופטים בלי מדידה" };
  }
  const fmt = (n: number | null): string => (n == null ? "?" : `$${n.toFixed(4)}`);
  if (run.verdict === "PROFIT") {
    return { id: "fee-meter", kind: "economy", verdict: "EXECUTED-NOOP", detailHe: `${run.noteHe}` };
  }
  if (run.verdict === "BREAKEVEN") {
    return { id: "fee-meter", kind: "economy", verdict: "EXECUTED-NOOP", detailHe: `${run.noteHe}` };
  }
  if (run.verdict === "LOSS") {
    const lanes = run.lanes.filter((l) => l.costUsd != null && l.costUsd > 0).map((l) => l.id);
    return {
      id: "fee-meter", kind: "economy", verdict: "QUEUE",
      detailHe: `${run.noteHe}${lanes.length ? ` · מסילות-עלות-חיוביות: ${lanes.join(", ")}` : " · ההפסד אינו מסילה-בודדת — ההכנסה טרם-יבול"}`,
    };
  }
  return { id: "fee-meter", kind: "economy", verdict: "DEFER", detailHe: run.noteHe };
}

function candidateZeroRail(zr: Awaited<ReturnType<typeof zeroReadiness>> | null): DecideLine {
  // Task 18 — קו-ZERO במוח: כל שעה מדידה חיה של התכונה-הריבונית (gasPrice=0).
  // אם-הרשת תשנה כלל — ALERT (שינוי-תכונה, לא כשל-רשת). אם-הרשת לא נגישה —
  // DEFER כנה. אפס-המצאה.
  if (!zr) {
    return { id: "zero-rail", kind: "fleet", verdict: "DEFER", detailHe: "קו-ZERO לא נמדד — כשל-רשת (כנות, לא אפס-מומצא)" };
  }
  if (zr.ok && zr.zeroGasConfirmed) {
    return { id: "zero-rail", kind: "fleet", verdict: "EXECUTED-NOOP", detailHe: `שער-האפס פתוח (מדוד): gasPrice 0 בבלוק ${zr.blockNumber} · ${zr.endpoint}` };
  }
  if (zr.ok && !zr.zeroGasConfirmed) {
    return { id: "zero-rail", kind: "fleet", verdict: "ALERT", detailHe: `${zr.verdict}` };
  }
  return { id: "zero-rail", kind: "fleet", verdict: "DEFER", detailHe: `${zr.verdict}` };
}

function candidateHeartbeat(lv: HeartbeatLiveness | null): DecideLine {
  // Task 18 — מסילת-הלב במוח: הפורנזיקה גילתה שהעוגנים מורעבים-גז מאז
  // 2026-09-12. מעכשיו כל שעה: מדידה חיה מהמייננט. STARVED/STALE ⇒ QUEUE
  // (חוק-פיצול-המטבע: הזרמת-גז = כסף-חיצוני = רק-המפעיל). ALIVE ⇒ רישום.
  if (!lv || !lv.ok) {
    return { id: "heartbeat", kind: "fleet", verdict: "DEFER", detailHe: lv?.noteHe ?? "סורק-הלב לא נמדד" };
  }
  if (lv.verdict === "ALIVE") {
    return { id: "heartbeat", kind: "fleet", verdict: "EXECUTED-NOOP", detailHe: lv.noteHe };
  }
  if (lv.verdict === "STARVED" || lv.verdict === "STALE") {
    return { id: "heartbeat", kind: "fleet", verdict: "QUEUE", detailHe: `${lv.noteHe} · זהות ${lv.identityCensored} · בסל h${lv.baselineHeight}` };
  }
  return { id: "heartbeat", kind: "fleet", verdict: "DEFER", detailHe: lv.noteHe };
}

function candidateWatchdog(): DecideLine {
  const st = readJson(WATCHDOG_STATE) as { revives?: Record<string, number>; lastRound?: string } | null;
  if (!st) return { id: "watchdog", kind: "fleet", verdict: "DEFER", detailHe: "מצב-השומר לא נקרא" };
  const revives = Object.entries(st.revives ?? {});
  const total = revives.reduce((s, [, n]) => s + Number(n), 0);
  return {
    id: "watchdog",
    kind: "fleet",
    verdict: "EXECUTED-NOOP",
    detailHe: `השומר חי (סבב ${String(st.lastRound ?? "?").slice(11, 16)}Z) · ${total} ריפויים מאז-הקמה (${revives.map(([k, n]) => `${k}:${n}`).join(" · ") || "אפס"}) — הריפוי-כבר-מנוהל-ע"י-השומר עצמו; decide מאמת ורושם`,
  };
}

// ── הריצה ────────────────────────────────────────────────────────────────────

export async function runDecide(opts: { execute?: boolean } = {}): Promise<DecideRun> {
  const execute = opts.execute === true;
  const at = new Date().toISOString();
  const verdicts: DecideLine[] = [];

  // 0) חוק-העצימה — fail-closed
  const gate = readGate();
  const gateOpen = gate.mode === "ACTIVE";

  // 1) מדידת-הכנסה פעם-אחת (משמשת שני מועמדים)
  let incomeReport: Awaited<ReturnType<typeof composeIncome>> | null = null;
  try {
    incomeReport = await composeIncome();
  } catch (e) {
    verdicts.push({ id: "income-scan", kind: "income", verdict: "DEFER", detailHe: `מנוע-ההכנסה נכשל: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
  }

  // 2) מועמדות-רישום-הכנסה (פעולה-בטוחה: כתיבת-קנון יומי, אידמפוטנטי)
  if (incomeReport?.ok) {
    if (execute && gateOpen) {
      try {
        const { file, created } = writeIncomeDay(incomeReport);
        verdicts.push({ id: "income-record", kind: "income", verdict: created ? "EXECUTED" : "EXECUTED-NOOP", detailHe: created ? `רשומת-היום נכתבה (${path.basename(file)})` : "רשומת-היום כבר קיימת — אידמפוטנטי, אפס-כתיבה" });
      } catch (e) {
        verdicts.push({ id: "income-record", kind: "income", verdict: "DEFER", detailHe: `כתיבת-קנון נכשלה: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
      }
    } else {
      verdicts.push({ id: "income-record", kind: "income", verdict: "DEFER", detailHe: execute ? `השער ${gate.mode} — מתוכנן ולא מבוצע (fail-closed)` : "תוכנית-יבשה (dry-run) — לא מבצעים" });
    }
  }

  // 3) מועמדות-מלגה (פעולה-בטוחה: SAOS פנימי, אידמפוטנטי-שבועי, תקרות-בשרת)
  if (execute && gateOpen) {
    try {
      const s = await scholarshipPay();
      verdicts.push({
        id: "scholarship-pay",
        kind: "treasury",
        verdict: s.ok ? (s.detail.includes("כבר שולמה") ? "EXECUTED-NOOP" : "EXECUTED") : "DEFER",
        detailHe: s.detail,
      });
    } catch (e) {
      verdicts.push({ id: "scholarship-pay", kind: "treasury", verdict: "DEFER", detailHe: `מנוע-המלגות נכשל: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
    }
  } else {
    verdicts.push({ id: "scholarship-pay", kind: "treasury", verdict: "DEFER", detailHe: execute ? `השער ${gate.mode} — מתוכנן ולא מבוצע` : "תוכנית-יבשה (dry-run)" });
  }

  // 3.5) מונה-העמלות (Task 18) — הוכחת-הרווח-העצמי: מדידה אחת, משמשת פסיקה + ספר
  let feeRun: FeeMeterRun | null = null;
  try {
    feeRun = await runFeeMeter({ execute, income: incomeReport });
  } catch (e) {
    verdicts.push({ id: "fee-meter", kind: "economy", verdict: "DEFER", detailHe: `מונה-העמלות נכשל: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
  }

  // 3.7) מסילות-פיזיקה — קו-ZERO + לב-המייננט (מדידה אחת לכל אחד, fail-soft:
  //      כשל-רשת לא מפיל את ההכרעות — נרשם כנה)
  let zeroStatus: Awaited<ReturnType<typeof zeroReadiness>> | null = null;
  try {
    zeroStatus = await zeroReadiness();
  } catch (e) {
    zeroStatus = null;
    verdicts.push({ id: "zero-rail", kind: "fleet", verdict: "DEFER", detailHe: `קריאת-ZERO נכשלה: ${String((e as Error)?.message ?? e).slice(0, 100)}` });
  }
  let hb: HeartbeatLiveness | null = null;
  try {
    hb = await heartbeatLiveness();
  } catch (e) {
    hb = null;
    verdicts.push({ id: "heartbeat", kind: "fleet", verdict: "DEFER", detailHe: `סריקת-הלב נכשלה: ${String((e as Error)?.message ?? e).slice(0, 100)}` });
  }

  // 4) מועמדויות-חוק וראייה
  verdicts.push(candidateIncomeGap(incomeReport));
  verdicts.push(candidateHeldLane());
  verdicts.push(candidateWatchdog());
  if (feeRun) verdicts.push(candidateFeeMeter(feeRun));
  verdicts.push(candidateZeroRail(zeroStatus));
  verdicts.push(candidateHeartbeat(hb));

  // 5) רישום hash-chained
  const prev = readJsonl(RUNS_FILE);
  const prevHash = prev.length ? String(prev[prev.length - 1].entryHash ?? "") : "GENESIS";
  const seq = prev.length + 1;
  const base = { seq, prevHash, at, gate: gate.mode, execute, verdicts };
  const entryHash = canonicalHash(base);
  const run: DecideRun = { ...base, entryHash, noteHe: "" };
  run.noteHe = buildNote(run);

  if (execute) {
    try {
      fs.mkdirSync(DECIDE_DIR, { recursive: true });
      fs.appendFileSync(RUNS_FILE, JSON.stringify(run) + "\n");
    } catch { /* כשל-דיסק לא מפיל את ההכרעות — מדווח בתשובה */ }
  }
  return run;
}

function buildNote(run: DecideRun): string {
  const executed = run.verdicts.filter((v) => v.verdict === "EXECUTED").length;
  const noop = run.verdicts.filter((v) => v.verdict === "EXECUTED-NOOP").length;
  const queued = run.verdicts.filter((v) => v.verdict === "QUEUE").length;
  const deferred = run.verdicts.filter((v) => v.verdict === "DEFER").length;
  const alerts = run.verdicts.filter((v) => v.verdict === "ALERT").length;
  if (!run.execute) return `תוכנית-יבשה: ${executed + noop} יבוצעו · ${queued} לתור-המפעיל · ${deferred} נדחים (השער ${run.gate})`;
  if (alerts) return `ריצה עם התראות (${alerts}) — נדרש עין-מפעיל`;
  return `בוצע: ${executed} · NOOP: ${noop} · תור: ${queued} · נדחה: ${deferred} — השער ${run.gate}`;
}

export function latestDecideRun(): DecideRun | null {
  const runs = readJsonl(RUNS_FILE);
  return runs.length ? (runs[runs.length - 1] as unknown as DecideRun) : null;
}

export function decideHistory(n = 8): DecideRun[] {
  return readJsonl(RUNS_FILE).slice(-n) as unknown as DecideRun[];
}
