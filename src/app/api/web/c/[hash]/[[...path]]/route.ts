// ─────────────────────────────────────────────────────────────────────
// /api/web/c/[hash]/[[...path]] — שער ההגשה: השרשרת הציבורית כדיסק.
//
// כל ביט שיוצא מכאן נקרא מה-RPC הציבורי של Steem (get_content),
// מאומת ב-sha256 מול המניפסט, ורק אז מוגש. השער אינו מחזיק עותק
// של התוכן — הוא חלון אל השרשרת. זו ההגדרה המדויקת של
// "האמת היא האימות של השרת על הרשת".
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { servePackageFile } from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ hash: string; path?: string[] }> }
) {
  const { hash, path: inner } = await ctx.params;
  const innerPath = (inner || []).join("/");
  const meta = req.nextUrl.searchParams.get("meta");

  try {
    const served = await servePackageFile(hash, innerPath);
    if (meta === "1") {
      return NextResponse.json({
        ok: true,
        manifest: served.manifest,
        resolvedPath: served.resolvedPath,
        mime: served.mime,
        bytes: served.bytes.length,
      });
    }
    return new NextResponse(new Uint8Array(served.bytes), {
      status: 200,
      headers: {
        "Content-Type": served.mime,
        "Content-Length": String(served.bytes.length),
        // כתובת-תוכן = בלתי-משתנה — מטמון לתמיד בטוח
        "Cache-Control": "public, max-age=86400, immutable",
        "X-SAOS-Web-Source": "steem-chain",
        "X-SAOS-Web-Manifest": served.manifest.sha256,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שליפה מהשרשרת נכשלה", hash, path: innerPath },
      { status: 404 }
    );
  }
}
