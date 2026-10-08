// ─────────────────────────────────────────────────────────────────────────────
// /api/fee-meter — מנוע הוכחת-הרווח-העצמי (Task 18).
//
// GET  — מדידה חיה (קריאה-בלבד): הכנסה-היום מול עלות-24ש', מסילות, פסיקה,
//        הריצה האחרונה וההיסטוריה. אפס תופעות-לוואי.
// POST — מדידה + רישום hash-chained בספר (sovereign/fee-meter/).
//        אפס כסף-חיצוני — הרישום הוא כתיבת-מדידה בלבד.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { runFeeMeter, latestFeeMeterRun, feeMeterHistory } from "@/lib/weave/fee-meter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const at = new Date().toISOString();
  try {
    const [live, latest] = [await runFeeMeter({ execute: false }), latestFeeMeterRun()];
    return NextResponse.json({
      ok: true, at,
      doctrine:
        "ריבונות שאינה מתקיימת כלכלית היא סיסמה — המונה מודד הכנסה מול עלות לכל מסילה בכנות (אין מספר מומצא): " +
        "טרנספרים-החוצה = עלות-כסף-אמיתית · RC = תקציב-רגנרציה (0$) · קו-ה-ZERO = גז 0x0 (0$). " +
        "LOSS ⇒ תור-המפעיל (חוק-פיצול-המטבע); PROFIT ⇒ הרווח-העצמי הוכח.",
      live, latest, history: feeMeterHistory(8),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `מונה-העמלות נכשל: ${String((e as Error)?.message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}

export async function POST() {
  const at = new Date().toISOString();
  try {
    const run = await runFeeMeter({ execute: true });
    return NextResponse.json({ ok: true, at, run });
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `רישום מונה נכשל: ${String((e as Error)?.message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}
