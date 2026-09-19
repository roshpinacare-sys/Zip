// ─────────────────────────────────────────────────────────────────────
// /api/web/c/[hash]/[[...path]] — שער ההגשה: השרשרת הציבורית כדיסק.
//
// כל ביט שיוצא מכאן נקרא מה-RPC הציבורי של Steem (get_content),
// מאומת ב-sha256 מול המניפסט, ורק אז מוגש. השער אינו מחזיק עותק
// של התוכן — הוא חלון אל השרשרת. זו ההגדרה המדויקת של
// "האמת היא האימות של השרת על הרשת".
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { servePackageFile, fetchPackageBytes } from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ hash: string; path?: string[] }> }
) {
  const { hash, path: inner } = await ctx.params;
  const innerPath = (inner || []).join("/");
  const meta = req.nextUrl.searchParams.get("meta");
  const raw = req.nextUrl.searchParams.get("raw");

  try {
    if (raw === "1") {
      // הורדת החבילה כולה — הבייטים המאומתים-חותם בשלמותם
      const all = await fetchPackageBytes(hash);
      return new NextResponse(new Uint8Array(all.bytes), {
        status: 200,
        headers: {
          "Content-Type": all.manifest.mime,
          "Content-Length": String(all.bytes.length),
          "Content-Disposition": `attachment; filename="${all.manifest.name.replace(/[^\w.-]+/g, "_")}"`,
          "Cache-Control": "public, max-age=86400, immutable",
          "X-SAOS-Web-Source": all.source === "chain" ? "steem-chain" : "repo-sealed",
          "X-SAOS-Web-Manifest": hash,
        },
      });
    }
    const pkg = await servePackageFile(hash, innerPath);
    if (meta === "1") {
      return NextResponse.json({
        ok: true,
        manifest: pkg.manifest,
        resolvedPath: pkg.resolvedPath,
        mime: pkg.mime,
        bytes: pkg.bytes.length,
        source: pkg.source,
      });
    }
    return new NextResponse(new Uint8Array(pkg.bytes), {
      status: 200,
      headers: {
        "Content-Type": pkg.mime,
        "Content-Length": String(pkg.bytes.length),
        // כתובת-תוכן = בלתי-משתנה — מטמון בטוח
        "Cache-Control": "public, max-age=86400, immutable",
        "X-SAOS-Web-Source": pkg.source === "chain" ? "steem-chain" : "repo-sealed",
        "X-SAOS-Web-Manifest": pkg.manifest.sha256,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שליפה מהשרשרת נכשלה", hash, path: innerPath },
      { status: 404 }
    );
  }
}
