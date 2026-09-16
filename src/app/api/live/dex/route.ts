// ─────────────────────────────────────────────────────────────────────
// /api/live/dex — טרמינל הדקס מהענן (world.json המפורסם על-ידי dex-beat).
// אותה צורת-API כמו הדמון המקומי — החלפת מקור שקופה לתצוגה.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

const WORLD_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/Console/main/dex/world.json";

let cached: { at: number; body: string } | null = null;

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < 30_000) {
    return new NextResponse(cached.body, {
      headers: { "Content-Type": "application/json", "X-Live-Source": "cache" },
    });
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(WORLD_URL, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": "the-weave-live/1.0" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    cached = { at: now, body };
    return new NextResponse(body, {
      headers: { "Content-Type": "application/json", "X-Live-Source": "cloud" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `מראת הדקס בענן לא נענתה: ${err.message}`
            : "מראת הדקס בענן לא נענתה",
      },
      { status: 502 }
    );
  }
}
