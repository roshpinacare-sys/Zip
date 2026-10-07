// ─────────────────────────────────────────────────────────────────────
// דגימת-מצב השרשרת — מדיניות live-first (Task 6-b · תיקון-שורש).
//
// נמדד בביקורת (5-b): חמישה משטחים הציגו את מראת-הענן (world.json מ-
// GitHub Pages, קפואה לשעות) כאילו הייתה "השרשרת הקנונית", בזמן שהשרשרת
// החיה פועמת בן-הדלת על 127.0.0.1:3010 (אותו פרוקסי ש-/api/saosnet כבר
// מוכיח). מעתה כל מי שצריך מצב-שרשרת מדגם חי קודם, ונופל למראה רק
// כשהדמון לא ענה — והתשובה תמיד חתומה במקורה ובגילה:
//   · source: "live-saosdex" — נמדד חי מהדמון המקומי ברגע הבקשה
//   · source: "mirror-stale" — עותק-ענן בלבד (השרשרת לא נענתה)
// ageMs נגזר מ-publishedAt של המסמך שנמסר. המסמך החי לא נושא
// publishedAt — חותמים עליו את רגע-המדידה האמיתי, כך שהגיל צומח
// עם השעון (ועם גיל-המטמון) ולעולם לא מציג "עכשיו" על נתון ישן.
// ─────────────────────────────────────────────────────────────────────

export const SAOSDEX_STATE_URL = "http://127.0.0.1:3010/saos-dex/api/dex/state";
export const WORLD_MIRROR_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/Console/main/dex/world.json";

export type DexSource = "live-saosdex" | "mirror-stale";

export interface DexStateDoc {
  ok?: boolean;
  publishedAt?: string;
  [k: string]: unknown;
}

export interface DexStateResult {
  source: DexSource;
  doc: DexStateDoc;
  /** גיל הנתון במילישניות — מ-publishedAt של המסמך שנמסר */
  ageMs: number | null;
  /** כשנפלנו למראה: סיבת-הנפילה הכנה של הדגימה החיה */
  error: string | null;
}

function ageOf(doc: DexStateDoc): number | null {
  const at = typeof doc?.publishedAt === "string" ? Date.parse(doc.publishedAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, Date.now() - at) : null;
}

async function jget(url: string, timeoutMs: number, ua?: string): Promise<DexStateDoc> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: ua
        ? { "User-Agent": ua, accept: "application/json" }
        : { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as DexStateDoc;
  } finally {
    clearTimeout(t);
  }
}

/** דגימה-חיה ראשונה (timeout קצר), מראת-הענן רק כנפילה. */
export async function fetchDexStateLiveFirst(
  liveTimeoutMs = 2_500,
): Promise<DexStateResult> {
  try {
    const doc = await jget(SAOSDEX_STATE_URL, liveTimeoutMs, "the-weave-live/1.0");
    if (doc?.ok === false) throw new Error("הדמון השיב ok=false");
    if (doc.publishedAt == null) doc.publishedAt = new Date().toISOString();
    return { source: "live-saosdex", doc, ageMs: ageOf(doc), error: null };
  } catch (liveErr) {
    const liveMsg = liveErr instanceof Error ? liveErr.message : "שגיאה";
    try {
      const doc = await jget(WORLD_MIRROR_URL, 12_000, "the-weave-live/1.0");
      return { source: "mirror-stale", doc, ageMs: ageOf(doc), error: liveMsg };
    } catch (mirrorErr) {
      // גם המראה לא ענתה — אין אמת למסור; הקורא יציג כישלון כנה.
      throw mirrorErr instanceof Error ? mirrorErr : new Error(String(mirrorErr));
    }
  }
}
