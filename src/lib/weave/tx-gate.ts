// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · TX-GATE — שער-העסקאות (R97).
//
// הוראת המפעיל: "מערכת אוטונומית לא צריכה שער מפעיל רק במקרים של
// עסקאות באמת גדולות 100$ ומעלה."
//
// החוק — כל פעולת-כסף מוערכת ב-USD חי בזמן ההחלטה:
//   · מתחת לסך $100 → אוטונומיה מלאה (ALLOWED) — הרשת פועלת לבד.
//   · $100 ומעלה   → תור אישור למפעיל (QUEUED) — כלום לא זז בלי החלטתו.
//   · אין מדידת-USD חיה → REFUSED — אין שער, אין מסחר (הרצפה נשארת).
//   · מפעיל שמוציא פעולה בעצמו (סשן-מפעיל) → ALLOWED — המפעיל הוא השער.
//
// כל הכרעה נשמרת עם קבלה — האמת במדידה, לא בזיכרון.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";

/** הסף היחיד — כתוב פעם אחת, נאכף בכל מקום (הוראת המפעיל) */
export const GATE_THRESHOLD_USD = 100;

export type GateVerdict = "ALLOWED" | "QUEUED" | "REFUSED";

export interface GateInput {
  source: string; // money-mover | liquidity | exchange | ...
  action: string; // reprice | arm-buy | swap | bridge | ...
  title: string;
  payload: Record<string, unknown>;
  /** הערכת-USD חיה; null = לא נמדד — ואז מסורבים בכנות */
  usdValue: number | null;
  usdBasis: string;
  issuedBy: "operator" | "daemon";
  reason: string;
}

export interface GateDecision {
  verdict: GateVerdict;
  id: string;
  threshold: number;
  usdValue: number | null;
}

export async function evaluateGate(input: GateInput): Promise<GateDecision> {
  const base = {
    source: input.source.slice(0, 60),
    action: input.action.slice(0, 60),
    title: input.title.slice(0, 200),
    payload: JSON.stringify(input.payload),
    usdBasis: input.usdBasis.slice(0, 250),
    reason: input.reason.slice(0, 250),
  };

  // שער שלמות-מדידה: לעולם לא מפרשים "לא נמדד" כ"קטן מהסף" —
  // אותו חוק כמו רצפת-הפאריטה: אין שער, אין מסחר.
  if (input.usdValue == null || !Number.isFinite(input.usdValue) || input.usdValue < 0) {
    const r = await db.txGate.create({
      data: {
        ...base,
        usdValue: 0,
        verdict: "REFUSED",
        decidedBy: "policy:no-usd-mark",
        reason: "USD לא נמדד חי — השער אינו יכול להעריך, לכן שום דבר לא זז (אין שער, אין מסחר)",
        decidedAt: new Date(),
      },
    });
    return { verdict: "REFUSED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: null };
  }

  // המפעיל שהוציא את הפעולה בעצמו — המפעיל הוא השער
  if (input.issuedBy === "operator") {
    const r = await db.txGate.create({
      data: {
        ...base,
        usdValue: input.usdValue,
        verdict: "ALLOWED",
        decidedBy: "operator",
        decidedAt: new Date(),
      },
    });
    return { verdict: "ALLOWED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue };
  }

  // מתחת לסף — אוטונומיה מלאה. זו ברירת-המחדל של הרשת.
  if (input.usdValue < GATE_THRESHOLD_USD) {
    const r = await db.txGate.create({
      data: {
        ...base,
        usdValue: input.usdValue,
        verdict: "ALLOWED",
        decidedBy: `policy:<${GATE_THRESHOLD_USD}`,
        reason: `${input.usdValue.toFixed(2)}$ < ${GATE_THRESHOLD_USD}$ — אוטונומיה מלאה, הפעולה רצה בלי שער`,
        decidedAt: new Date(),
      },
    });
    return { verdict: "ALLOWED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue };
  }

  // מהסף ומעלה — תור אישור המפעיל. שום דבר לא זז עד החלטתו.
  const r = await db.txGate.create({
    data: {
      ...base,
      usdValue: input.usdValue,
      verdict: "QUEUED",
      decidedBy: "policy:operator-gate",
      reason: `הפעולה ${input.usdValue.toFixed(2)}$ ≥ ${GATE_THRESHOLD_USD}$ — הועברה לתור אישור המפעיל`,
    },
  });
  return { verdict: "QUEUED", id: r.id, threshold: GATE_THRESHOLD_USD, usdValue: input.usdValue };
}

export async function settleGate(
  id: string,
  state: "EXECUTED" | "APPROVED" | "REJECTED",
  by: string,
  receipt?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.txGate.update({
      where: { id },
      data: {
        verdict: state,
        decidedBy: by.slice(0, 120),
        decidedAt: new Date(),
        ...(receipt ? { receipt: JSON.stringify(receipt) } : {}),
      },
    });
  } catch {
    /* כשל עדכון-עדות אינו עוצר תשובה — הקבלה החיה היא השרשרת */
  }
}

/** אישור/דחייה של פעולה בתור — רק המפעיל (הסשן נבדק ב-API) */
export async function decideQueued(
  id: string,
  decision: "approve" | "reject",
  by: string,
): Promise<{ ok: true; record: Record<string, unknown> } | { ok: false; code: string; verdict?: string }> {
  const rec = await db.txGate.findUnique({ where: { id } });
  if (!rec) return { ok: false, code: "NOT-FOUND" };
  if (rec.verdict !== "QUEUED") return { ok: false, code: "NOT-QUEUED", verdict: rec.verdict };
  await settleGate(id, decision === "approve" ? "APPROVED" : "REJECTED", by);
  return { ok: true, record: { ...rec, verdict: decision === "approve" ? "APPROVED" : "REJECTED" } };
}

/** תמונת-השער ל-UI: התור, ההיסטוריה האחרונה, והמונים */
export async function gateSnapshot() {
  const [queue, recent, allowed, queued, refused, executed, rejected] = await Promise.all([
    db.txGate.findMany({ where: { verdict: "QUEUED" }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.txGate.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    db.txGate.count({ where: { verdict: { in: ["ALLOWED", "EXECUTED"] } } }),
    db.txGate.count({ where: { verdict: "QUEUED" } }),
    db.txGate.count({ where: { verdict: "REFUSED" } }),
    db.txGate.count({ where: { verdict: "EXECUTED" } }),
    db.txGate.count({ where: { verdict: "REJECTED" } }),
  ]);
  return {
    threshold: GATE_THRESHOLD_USD,
    queue,
    recent,
    stats: { allowed, queued, refused, executed, rejected },
  };
}
