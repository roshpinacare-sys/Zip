// ─────────────────────────────────────────────────────────────────────
// /api/web/c/[hash]/[[...path]] — שער ההגשה v2: השרשרת הציבורית כדיסק.
//
// כל ביט שיוצא מכאן נקרא מה-RPC הציבורי (סריקה-עמוקה) או מהמחסן
// הריבוני — ומאומת ב-sha256 מול החותם שעל השרשרת. השער אינו
// מחזיק אמת משלו: הוא חלון אל השרשרת. זו ההגדרה המדויקת של
// "האמת היא האימות של השרת על הרשת".
//
// R51: כתובות-תוכן = אמת-נצחית ⇒ ETag חזק + 304 + CORS פתוח
// (התוכן ציבורי ובלתי-משתנה — כל אתר בעולם רשאי להטמיע), רישום
// קבצי-חבילה (?list=1), וניפוי-מקור בכותרות.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { servePackageFile, fetchPackageBytes, listPackageFiles } from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

/** כותרות-אמת משותפות לכל תשובות-ההגשה */
function truthHeaders(etag: string, extra?: Record<string, string>): Record<string, string> {
  return {
    // התוכן ציבורי ובלתי-משתנה — כתובת-תוכן פתוחה לכל מקור
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Expose-Headers": "ETag, X-SAOS-Web-Source, X-SAOS-Web-Manifest, X-SAOS-Web-Chain-Chars",
    "Cache-Control": "public, max-age=86400, immutable",
    ETag: etag,
    ...extra,
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ hash: string; path?: string[] }> }
) {
  const { hash, path: inner } = await ctx.params;
  const innerPath = (inner || []).join("/");
  const meta = req.nextUrl.searchParams.get("meta");
  const raw = req.nextUrl.searchParams.get("raw");
  const list = req.nextUrl.searchParams.get("list");

  // ETag חזק: כתובת-תוכן = החשיש עצמו; קובץ-פנימי מוסיף את נתיבו
  const etag = `"${hash.slice(0, 16)}${innerPath ? ":" + innerPath : ""}"`;
  const inm = req.headers.get("if-none-match");
  if (inm && inm === etag) {
    // הלקוח כבר מחזיק את האמת הזו בדיוק — אין טעם לשלוח אותה שוב
    return new NextResponse(null, { status: 304, headers: truthHeaders(etag) });
  }

  try {
    if (raw === "1") {
      // הורדת החבילה כולה — הבייטים המאומתים-חותם בשלמותם
      const all = await fetchPackageBytes(hash);
      return new NextResponse(new Uint8Array(all.bytes), {
        status: 200,
        headers: truthHeaders(etag, {
          "Content-Type": all.manifest.mime,
          "Content-Length": String(all.bytes.length),
          "Content-Disposition": `attachment; filename="${all.manifest.name.replace(/[^\w.-]+/g, "_")}"`,
          "X-SAOS-Web-Source": all.source === "chain" ? "steem-chain" : "repo-sealed",
          "X-SAOS-Web-Manifest": hash,
          "X-SAOS-Web-Chain-Chars": `${all.chainChars}/${all.b64len}`,
        }),
      });
    }
    if (list === "1") {
      // רישום הקבצים בחבילה — דפדוף התוכן
      const listing = await listPackageFiles(hash);
      return NextResponse.json(
        { ok: true, hash, ...listing },
        { headers: truthHeaders(etag) }
      );
    }
    const pkg = await servePackageFile(hash, innerPath);
    if (meta === "1") {
      return NextResponse.json(
        {
          ok: true,
          manifest: pkg.manifest,
          resolvedPath: pkg.resolvedPath,
          mime: pkg.mime,
          bytes: pkg.bytes.length,
          source: pkg.source,
        },
        { headers: truthHeaders(etag) }
      );
    }
    return new NextResponse(new Uint8Array(pkg.bytes), {
      status: 200,
      headers: truthHeaders(etag, {
        "Content-Type": pkg.mime,
        "Content-Length": String(pkg.bytes.length),
        "X-SAOS-Web-Source": pkg.source === "chain" ? "steem-chain" : "repo-sealed",
        "X-SAOS-Web-Manifest": pkg.manifest.sha256,
        "X-SAOS-Web-Chain-Chars": `${pkg.source === "chain" ? "full" : "sealed"}`,
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שליפה מהשרשרת נכשלה", hash, path: innerPath },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}

/** תחקיר-קדם (preflight) להטמעה חוצת-מקורות */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Max-Age": "86400",
    },
  });
}
