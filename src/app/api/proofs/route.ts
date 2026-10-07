import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────
// /api/proofs (R208P) — ספר-ההוכחות-הריבוני לקונסול
// מחזיר: הרישום המלא (הכרעה-אחרונה-ל-claimId מסומנת) · דוח-השער · ראש.
// קריאה-בלבד · ללא-סודות · קבצי-ספר בלבד.
// ─────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const registryPath = path.join(process.cwd(), "sovereign/proofs/proof-registry.jsonl");
    const gatePath = path.join(process.cwd(), "sovereign/proofs/gate-report.json");
    if (!fs.existsSync(registryPath)) {
      return NextResponse.json({ ok: true, entries: [], head: null, gate: null, message: "ספר-ההוכחות טרם נולד" });
    }
    const all = fs
      .readFileSync(registryPath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    // הכרעה-אחרונה-ל-claimId + סימון-עקיפות
    const latestSeq = new Map<string, number>();
    for (const e of all) latestSeq.set(String(e.claimId), Number(e.seq));
    const entries = all
      .map((e) => ({ ...e, isLatest: latestSeq.get(String(e.claimId)) === Number(e.seq) }))
      .filter((e) => e.isLatest)
      .reverse(); // החדש-ראשון
    const head = all.length ? String(all[all.length - 1]!.entryHash) : null;
    const gate = fs.existsSync(gatePath) ? JSON.parse(fs.readFileSync(gatePath, "utf8")) : null;
    // מאכף-החוק העומד (R209) — מצבו החי מוצמד לתשובה (קריאה-בלבד)
    const lawPath = path.join(process.cwd(), "sovereign/proofs/proof-law-state.json");
    const law = fs.existsSync(lawPath) ? JSON.parse(fs.readFileSync(lawPath, "utf8")) : null;
    // Task 6-b · גיל-אמת: הדמון :3052 פועם כל 5 דק' וכותב את קובץ-המצב.
    // גיל הקובץ מול השעון החי = האמת על "המאכף-העומד" — התצוגה מחויבת להציג אותו.
    const lawAgeMs = fs.existsSync(lawPath)
      ? Math.max(0, Date.now() - fs.statSync(lawPath).mtimeMs)
      : null;
    return NextResponse.json({ ok: true, head, totalEntries: all.length, entries, gate, law, lawAgeMs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
