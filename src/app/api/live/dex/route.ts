// ─────────────────────────────────────────────────────────────────────
// /api/live/dex — מצב הבורסה הריבונית.
//
// Task 6-b · live-first: דגימה חיה מ-127.0.0.1:3010 קודם (timeout 2.5ש'),
// מראת-הענן (world.json) רק כנפילה — והתשובה חתומה source + ageMs:
//   · "live-saosdex" — חי מהשרשרת ברגע המדידה
//   · "mirror-stale" — עותק-ענן קפוא (הדמון לא ענה; sourceError הסיבה)
//
// לקח-R53 (נמדד): SWR נשמר — עותק ישן מוגש מיד עם רענון-רקע
// single-flight; 502 רק בקור-אמיתי ללא שום מקור.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { swrGet, cacheHeader } from "@/lib/live/swr";
import { fetchDexStateLiveFirst, type DexStateDoc, type DexSource } from "@/lib/live/dex-state";

export const dynamic = "force-dynamic";

const SWR_KEY = "api:live-dex";
const SWR_TTL_MS = 30_000;

interface ComposedBody extends DexStateDoc {
  source: DexSource;
  /** גיל הנתון במילישניות — נגזר מ-publishedAt בזמן-ההרכבה */
  ageMs: number;
  /** כשהמקור mirror-stale: סיבת-כישלון הדגימה החיה */
  sourceError: string | null;
}

export async function GET() {
  try {
    const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeBody);
    return new NextResponse(JSON.stringify({ ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing }), {
      headers: {
        "Content-Type": "application/json",
        // המקור-האמיתי של הגוף + מצב-המטמון כשורה נפרדת (נמדד ב-curl -sD)
        "X-Live-Source": value.source,
        "X-SAOS-Cache": cacheHeader(meta),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `השרשרת החיה ומראת-הענן לא נענו: ${err.message}`
            : "השרשרת החיה ומראת-הענן לא נענו",
      },
      { status: 502 },
    );
  }
}

async function composeBody(): Promise<ComposedBody> {
  const r = await fetchDexStateLiveFirst();
  return {
    ...r.doc,
    source: r.source,
    ageMs: r.ageMs ?? 0,
    sourceError: r.source === "mirror-stale" ? r.error : null,
  };
}
