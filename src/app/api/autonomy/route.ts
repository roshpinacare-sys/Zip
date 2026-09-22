// ─────────────────────────────────────────────────────────────────────
// /api/autonomy — מצב הדופק (R80 · PULSE).
//
// הדופק הוא mini-service עצמאי (mini-services/pulse · פורט 3033)
// שמחליט מתי לשדר לשרשרת — בלי אדם בלולאה. ה-API הזה הוא העדה
// הכנה של האפליקציה: הוא קורא את מצב הדופק מ-localhost:3033
// (צד-שרת בלבד — הדפדפן לא נוגע לפורט), ממזג עם הקבלות מה-DB,
// ומדווח בכנות אם הדופק לא נמדד (השירות כבוי/הסנדבוקס התאפס).
//
// דוקטרינה: שום סטטוס מומצא. דופק שלא ענה תוך 2.5 שניות מדווח
// כלא-נמדד — לא כ"כנראה בסדר", לא כטעות, אלא בדיוק מה שקרה.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { swrGet, cacheHeader } from "@/lib/live/swr";

const PULSE_URL = process.env.PULSE_URL || "http://localhost:3033";

interface PulseStatus {
  ok: boolean;
  service: string;
  version: string;
  alive: boolean;
  bootedAt: string;
  uptimeSec: number;
  beats: number;
  checkIntervalSec: number;
  policy: {
    maxPerUtcDay: number;
    rotation: string[];
    attemptsBudget: number;
    truthSource: string;
  };
  lastPublishUtcDay: string | null;
  nextDueAt: string | null;
  msToNext: number | null;
  attemptsToday: number;
  broadcasting: boolean;
  lastDecision: { at: string; kind: string; detail: string };
  canonLast: { at: string; ok: boolean; path: string; error?: string } | null;
  history: Array<{
    at: string;
    utcDay: string;
    draftId: string;
    kind: string;
    title: string;
    permlink: string;
    txid: string | null;
    url: string;
    attempt: number;
    canon: { pushed: boolean; path: string; error?: string } | null;
  }>;
}

async function fetchPulse(): Promise<PulseStatus | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(`${PULSE_URL}/`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PulseStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function composeState() {
  const [pulse, tasks] = await Promise.all([
    fetchPulse(),
    db.publishTask.findMany({ orderBy: { queuedAt: "desc" }, take: 40 }),
  ]);

  const receipts = tasks
    .filter((t) => t.status === "PUBLISHED")
    .map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      lang: t.lang,
      permlink: t.permlink,
      txid: t.txid,
      url: t.url,
      publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
      by: "agent",
    }));

  return {
    ok: true,
    at: new Date().toISOString(),
    daemon: pulse, // null = לא נמדד, בכנות
    daemonDown: pulse == null,
    daemonDownHe:
      pulse == null
        ? "הדופק לא נמדד בסנדבוקס הזה — השירות (mini-services/pulse · פורט 3033) אינו זמין כרגע. זו מדידה, לא כישלון מוסתר: הקנון והשרשרת הם האמת."
        : null,
    receipts,
    policy: pulse?.policy ?? {
      maxPerUtcDay: 1,
      rotation: ["draft-truth-he", "draft-liquidity-he", "draft-truth-en"],
      attemptsBudget: 3,
      truthSource: "api.steemit.com · last_root_post",
    },
    doctrine: [
      "הדופק מחליט מתי — הקול (R79) מחליט איך — המפתח לא נמצא באף אחד מהם.",
      "מקסימום פוסט אחד ליום-UTC: ריבונות פירושה משמעות, לא רעש.",
      "מקור האמת למועד הפרסום האחרון הוא השרשרת (last_root_post) — לא שום קובץ מקומי.",
      "תקציב 3 ניסיונות ליום: כישלון כנה נספר, לא מוסתר, ולא מנוסה עד אינסוף.",
    ],
  };
}

export async function GET() {
  const { value, meta } = await swrGet("autonomy:state", 15_000, composeState);
  return NextResponse.json(
    { ...value, cached: meta.cached, stale: meta.stale, cacheAgeSec: meta.cacheAgeSec, refreshing: meta.refreshing },
    { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
  );
}
