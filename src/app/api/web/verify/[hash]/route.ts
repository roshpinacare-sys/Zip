// ─────────────────────────────────────────────────────────────────────
// /api/web/verify/[hash] — מנוע ההוכחות: אימות חי מקיר-לקיר מול
// ה-RPC הציבורי של Steem, בלי מטמון ובלי אמון בריפו. כל צ׳אנק,
// כל חשיש, כולל עוגן האינדקס בהיסטוריית החשבון.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { verifyPackageOnChain, looksLikeSha256 } from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ hash: string }> }
) {
  const { hash } = await ctx.params;
  if (!looksLikeSha256(hash)) {
    return NextResponse.json(
      { ok: false, error: "נדרש חשיש sha256 בן 64 תווי-הקס" },
      { status: 400 }
    );
  }
  try {
    const report = await verifyPackageOnChain(hash);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "האימות נכשל" },
      { status: 502 }
    );
  }
}
