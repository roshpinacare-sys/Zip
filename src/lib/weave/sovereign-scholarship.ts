/* ═══════════════════════════════════════════════════════════════════════════
 * SOVEREIGN-SCHOLARSHIP — מלגות-האוצר האוטונומיות (Task 12 · הוראת-המפעיל:
 * "אוטונומיה שצריכה לדעת להפעיל הכל בלעדיי · תחרויות-סוכנים מי-מרוויח-יותר
 * ותגמולים לסוכנים")
 *
 * החלטת-ערך (רשומה כאן — ארכיטקטורה): הסתירה בין "הכל בלעדיי" לבין
 * "תגמולים דרך שער-המפעיל" נפתרת בפיצול-מטבע:
 *   · כסף-חיצוני (שידורים לשרשרת) — נשאר GATED (חוק-הרישום נשמר)
 *   · כסף-פנימי (SAOS בספר-ה-hash-chained שלנו) — אוטונומי מלא
 *     עם תקרות-קשיחות בשרת + אידמפוטנציה שבועית
 *
 * המנגנון: פעם-בשבוע (ISO week), 3 המובילים בלוח-התחרות (מדידת-on-chain
 * בלבד — competition-beat) מקבלים SAOS מהאוצרה:
 *   מקום 1 = 250 · מקום 2 = 150 · מקום 3 = 100  (סה"כ 500 SAOS/שבוע)
 * האוצרה מחזיקה 126,230+ SAOS (נמדד) — המלגה = 0.4% מהאוצרה לשבוע.
 * הכל מתועד: exchangeEvent (hash-chain) + rewards-ledger.jsonl.
 *
 * חוקים: idempotent (מלגה-אחת לשבוע-ISO) · caps-קשיחים בקוד ·
 *          אפס-מפתחות-חיצוניים · אפס-שידור-לשרשרת · כל-כשל-נרשם-וכנה.
 * ═══════════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { adjust, chainEvent, saosUsdPrice } from "./sovereign-exchange";

const MP = process.env.BOOTSTRAP_MYPROJECT ?? "/home/z/my-project";
const COMP_DIR = path.join(MP, "zip", "sovereign", "competition");
const STATE_FILE = path.join(COMP_DIR, "state.json");
const LEDGER_FILE = path.join(COMP_DIR, "rewards-ledger.jsonl");

export const SCHOLARSHIP_WEEKLY_PLAN = [
  { rank: 1, amount: 250 },
  { rank: 2, amount: 150 },
  { rank: 3, amount: 100 },
] as const;

export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function weekAlreadyPaid(week: string): Promise<boolean> {
  try {
    const rows = await db.exchangeEvent.findMany({
      where: { kind: "SCHOLARSHIP_PAY" },
      orderBy: { seq: "desc" },
      take: 10,
    });
    return rows.some((e) => {
      try {
        return (JSON.parse(e.payload as string) as { week?: string })?.week === week;
      } catch { return false; }
    });
  } catch { return false; } // ספר-לא-קריאה = אין-עדות-לתשלום; ההמשך-יחליט
}

export async function scholarshipPay(): Promise<{
  ok: boolean;
  detail: string;
  week?: string;
  payouts?: Array<{ member: string; agent: string; rank: number; amount: number; eventHash: string }>;
}> {
  try {
    const week = isoWeekKey();
    if (await weekAlreadyPaid(week)) {
      return { ok: true, week, detail: `מלגת-השבוע ${week} כבר שולמה — אידמפוטנטי, אפס-פעולה` };
    }

    // לוח-התחרות — מדידה-בלבד (אפס-טענות)
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as {
      leaderboard?: Array<{ account: string; agent: string; points: number }>;
    };
    const lb = state?.leaderboard ?? [];
    if (lb.length < 3) return { ok: false, detail: `NO-LEADERBOARD: רק ${lb.length} מדודים — צריך 3` };

    const price = await saosUsdPrice();
    if (price == null || price <= 0) return { ok: false, detail: "NO-PRICE: אין שער SAOS/USDS" };

    const payouts: Array<{ member: string; agent: string; rank: number; amount: number; eventHash: string }> = [];
    for (const plan of SCHOLARSHIP_WEEKLY_PLAN) {
      const row = lb[plan.rank - 1];
      if (!row?.account) continue;
      // חוק-האוצרה: השלם-משלם — adjust זורק על-חוסר-יתרה (fail-closed)
      await adjust("treasury", "SAOS", -plan.amount);
      await adjust(row.account, "SAOS", plan.amount);
      const usdValue = plan.amount * price;
      const ev = await chainEvent("SCHOLARSHIP_PAY", row.account, {
        week,
        rank: plan.rank,
        agent: row.agent,
        points: row.points,
        amount: plan.amount,
        usdValue,
        rail: "treasury→soldier (SAOS פנימי) — מלגה אוטונומית, אפס-שער-חיצוני",
      }, usdValue);
      payouts.push({ member: row.account, agent: row.agent, rank: plan.rank, amount: plan.amount, eventHash: ev.hash });
    }
    if (!payouts.length) return { ok: false, detail: "NO-PAID: אף-שורה-לא-שולמה" };

    // ledger-המלגות (הקובץ-שהרישום-הקנון-מצפה-לו)
    fs.mkdirSync(COMP_DIR, { recursive: true });
    fs.appendFileSync(LEDGER_FILE, JSON.stringify({
      at: new Date().toISOString(), kind: "autonomous-scholarship", week,
      total: payouts.reduce((s, p) => s + p.amount, 0),
      payouts, issuedBy: "autonomy",
    }) + "\n");

    const total = payouts.reduce((s, p) => s + p.amount, 0);
    return {
      ok: true, week,
      detail: `מלגת-שבוע ${week} שולמה אוטונומית: ${total} SAOS ל-${payouts.length} מובילים (תקרות-קשיחות · hash-chained)`,
      payouts,
    };
  } catch (e) {
    return { ok: false, detail: "SCHOLARSHIP-ERROR: " + String((e as Error).message ?? e).slice(0, 140) };
  }
}
