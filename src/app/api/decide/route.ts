// ─────────────────────────────────────────────────────────────────────────────
// /api/decide — המוח המבצע של האוטונומיה (Task 17).
//
// GET  — התוכנית היבשה עכשיו (מה decide היה מחליט בלי לבצע) + הריצה האחרונה
//        + מצב שער-העצימה. קריאה-בלבד — אפס תופעות-לוואי.
// POST — ריצה אמיתית: אוסף ⇒ חוק ⇒ מבצע (פעולות-בטוחות בלבד, אידמפוטנטיות,
//        אפס-כסף-חיצוני) ⇒ רישום hash-chained. השער PAUSED/THINKING = מתכנן
//        ולא מבצע (fail-closed — חוק r197).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { runDecide, latestDecideRun, decideHistory } from "@/lib/weave/decide";
import { readGate } from "@/lib/autonomy-law";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const at = new Date().toISOString();
  try {
    const [plan, latest] = [await runDecide({ execute: false }), latestDecideRun()];
    return NextResponse.json({ ok: true, at, gate: readGate(), plan, latest, history: decideHistory(8) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `decide נכשל: ${String((e as Error)?.message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}

export async function POST() {
  const at = new Date().toISOString();
  try {
    const run = await runDecide({ execute: true });
    return NextResponse.json({ ok: true, at, gate: readGate(), run });
  } catch (e) {
    return NextResponse.json(
      { ok: false, at, error: `ריצת decide נכשלה: ${String((e as Error)?.message ?? e).slice(0, 160)}` },
      { status: 500 },
    );
  }
}
