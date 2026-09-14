// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market API — GET /api/weave/market
//
// ספר השוק במלואו (replay דטרמיניסטי + אימות שרשרת וחתימות),
// לוח ההון לכל סוכן, ומועמדי ההכרעה — מדידה חיה של כל מטרה
// פתוחה בלי לסלק (הסליקה פעולה מפורשת, לא תופעת לוואי של GET).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";
import { computeBook, measureTarget, STARTING_POINTS, type MarketTarget } from "@/lib/weave/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const book = await computeBook();

    // מועמדי ההכרעה — מדידה חיה, קריאה בלבד
    const open = book.listings.filter((l) => l.status === "OPEN");
    const resolvable = await Promise.all(
      open.map(async (l) => {
        const m = await measureTarget(l.target as MarketTarget);
        const expired = Date.parse(l.byDate) <= Date.now();
        return {
          marketSeq: l.marketSeq,
          title: l.title,
          measured: m,
          expired,
          action: m.resolved ? "SETTLE" : expired ? "REFUND" : "HOLD",
        };
      })
    );

    // הקשר לפתיחת שווקים חדשים — מה שהרשת יכולה למדוד כרגע
    const [planStages, lastCp, anchorCount, attestationCount] = await Promise.all([
      db.planStage.findMany({ where: { state: { not: "DONE" } }, orderBy: { sortOrder: "asc" } }),
      db.checkpoint.findFirst({ orderBy: { index: "desc" } }),
      db.attestation.count({ where: { claimType: "ANCHOR" } }),
      db.attestation.count(),
    ]);

    return NextResponse.json({
      ok: true,
      market: {
        doctrine:
          "הסחורה: הכרעה עתידית של טענות מדידות · השופט: המדידה של הרשת עצמה (PlanStage/Checkpoint/Attestation) · ההון: נקודות אמת — מוניטין מוצהר, אפס כסף · הסליקה נכנסת לספר ⇒ checkpoint ⇒ עיגון ב-$0",
        startingPoints: STARTING_POINTS,
        book: {
          events: book.events,
          headHash: book.headHash,
          chainValid: book.chainValid,
          firstBreak: book.firstBreak,
          sigOk: book.sigOk,
          verdict: book.chainValid
            ? `ספר השוק תקין: ${book.events} אירועים, שרשרת תקינה, ${book.sigOk}/${book.events} חתימות`
            : `ספר השוק שבור (firstBreak=${book.firstBreak ?? "?"}) — השוק נעול`,
        },
        listings: book.listings,
        agents: book.agents,
        resolvable,
        openContext: {
          planStages: planStages.map((s) => ({ code: s.code, title: s.title, state: s.state })),
          checkpointMax: lastCp?.index ?? 0,
          anchorCount,
          attestationCount,
        },
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
