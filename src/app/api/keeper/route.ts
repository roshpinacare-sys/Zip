// ─────────────────────────────────────────────────────────────────────
// /api/keeper — שומר הדיבונים (R84 · THE KEEPER).
//
// האמת שיצרה את ה-API: שלושת הדיבונים (דופק · מוביל · צייד) חיים
// רק בסשן הסנדבוקס — דיבון שקרס היה מת בשקט, והכסף חוזר לשבת
// על מחיר אתמול. השומר (R84) הוא עין-הצי: סיור 30ש', בדיקת-חיים,
// החזרה לחיים בתוך חוקי-ברזל — ואף דיבון לא נהרג באמצע פעולת-כסף.
//
// ה-API מרכיב את התמונה ממדידות חיות בלבד:
//   · בדיקת-HTTP חיה של כל ארבעת הדיבונים (כולל השומר עצמו).
//   · מצב השומר (סיורים, הקמות, החלטות) — מהדיבון עצמו, או מקובץ
//     המצב אם הוא לא עונה (כנות: daemonDownHe).
//   · חוקי-הברזל ופקודת-ההחייאה לסשן הבא — מתועדים בקנון.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { swrGet, cacheHeader } from "@/lib/live/swr";

export const dynamic = "force-dynamic";

const HOME = "/home/z/my-project";
const KEEPER_STATE_FILE = `${HOME}/sovereign/keeper/state.json`;

// ── חוזה הנתונים ───────────────────────────────────────────────────

interface DaemonLive {
  name: string;
  port: number;
  roleHe: string;
  up: boolean;
  beats: number | null;
  bootedAt: string | null;
  patrolIntervalSec: number | null;
  acting: boolean | null;
  lastDecision: { at: string; kind: string; detail: string } | null;
}

interface KeeperPayload {
  ok: boolean;
  at: string;
  keeper: {
    up: boolean;
    beats: number | null;
    patrolIntervalSec: number | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
    history: Array<{ at: string; kind: string; detail: string }>;
    canon: { pushesToday: number; day: string; lastAt: string | null; lastOk: boolean | null; lastPath: string | null } | null;
  };
  fleet: Array<
    DaemonLive & {
      state: "UP" | "DOWN" | "BUSY" | "RESTARTING" | "GAVE-UP" | "UNKNOWN";
      since: string;
      restartsToday: number;
      lastRestartAt: string | null;
      lastHealthyAt: string | null;
      lastBeats: number | null;
    }
  >;
  laws: Array<{ id: string; title: string; detail: string }>;
  revival: {
    command: string;
    noteHe: string;
    canonPath: string | null;
  };
  honestGaps: string[];
}

// ── עזרים ───────────────────────────────────────────────────────────

async function jfetch<T>(url: string, timeoutMs: number): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface DaemonSense {
  ok?: boolean;
  alive?: boolean;
  service?: string;
  beats?: number;
  bootedAt?: string;
  patrolIntervalSec?: number;
  acting?: boolean;
  lastDecision?: { at: string; kind: string; detail: string } | null;
  history?: Array<{ at: string; kind: string; detail: string }>;
  fleet?: Array<{
    name: string;
    state: string;
    since: string;
    restartsToday: number;
    lastRestartAt: string | null;
    lastHealthyAt: string | null;
    lastBeats: number | null;
    roleHe?: string;
  }>;
  canon?: KeeperPayload["keeper"]["canon"];
}

interface KeeperStateFile {
  ok?: boolean;
  alive?: boolean;
  beats?: number;
  patrolIntervalSec?: number;
  lastDecision?: { at: string; kind: string; detail: string } | null;
  history?: Array<{ at: string; kind: string; detail: string }>;
  fleet?: Array<{
    name: string;
    state: string;
    since: string;
    restartsToday: number;
    lastRestartAt: string | null;
    lastHealthyAt: string | null;
    lastBeats: number | null;
  }>;
  canon?: KeeperPayload["keeper"]["canon"];
}

function readKeeperFile(): KeeperStateFile | null {
  try {
    return JSON.parse(readFileSync(KEEPER_STATE_FILE, "utf8")) as KeeperStateFile;
  } catch {
    return null;
  }
}

const ROLES: Record<string, string> = {
  pulse: "הדופק — השידור היומי לשרשרת",
  money: "מוביל הכסף — סולם הפאריטה על הקו",
  hunter: "הצייד — שער הדקות ולוח ההזדמנויות",
  keeper: "השומר — עין-הצי של הדיבונים",
};

const PORTS: Record<string, number> = { pulse: 3033, money: 3034, hunter: 3035, keeper: 3036 };

// ── ההרכבה ──────────────────────────────────────────────────────────

async function buildBoard(): Promise<KeeperPayload> {
  const at = new Date().toISOString();

  // ① בדיקות-חיים חיות של כל ארבעת הדיבונים
  const names = ["keeper", "pulse", "money", "hunter"] as const;
  const senses = await Promise.all(
    names.map((n) => jfetch<DaemonSense>(`http://127.0.0.1:${PORTS[n]}/`, 4000)),
  );
  const senseOf: Record<string, DaemonSense | null> = Object.fromEntries(
    names.map((n, i) => [n, senses[i]]),
  );

  const keeperSense = senseOf.keeper ?? null;
  const keeperFile = readKeeperFile();
  const keeperUp = Boolean(keeperSense?.alive || keeperSense?.ok);

  // ② טבלת הצי — מדידה חיה מוזגת עם ספירת-ההקמות של השומר
  const fleetFile = keeperFile?.fleet ?? [];
  const fleet: KeeperPayload["fleet"] = (["pulse", "money", "hunter"] as const).map((name) => {
    const sense = senseOf[name] ?? null;
    const fileEntry = fleetFile.find((f) => f.name === name);
    const up = Boolean(sense?.alive || sense?.ok);
    const fileState = fileEntry?.state;
    const state: KeeperPayload["fleet"][number]["state"] = up
      ? "UP"
      : fileState === "GAVE-UP" || fileState === "BUSY" || fileState === "RESTARTING"
        ? (fileState as KeeperPayload["fleet"][number]["state"])
        : fileState === "DOWN"
          ? "DOWN"
          : "UNKNOWN";
    return {
      name,
      port: PORTS[name],
      roleHe: ROLES[name],
      up,
      beats: typeof sense?.beats === "number" ? sense.beats : fileEntry?.lastBeats ?? null,
      bootedAt: sense?.bootedAt ?? null,
      patrolIntervalSec:
        typeof sense?.patrolIntervalSec === "number" ? sense.patrolIntervalSec : null,
      acting: typeof sense?.acting === "boolean" ? sense.acting : null,
      lastDecision: sense?.lastDecision ?? null,
      state,
      since: fileEntry?.since ?? at,
      restartsToday: fileEntry?.restartsToday ?? 0,
      lastRestartAt: fileEntry?.lastRestartAt ?? null,
      lastHealthyAt: fileEntry?.lastHealthyAt ?? null,
      lastBeats: fileEntry?.lastBeats ?? null,
    };
  });

  // ③ חוקי-הברזל של השומר
  const laws: KeeperPayload["laws"] = [
    {
      id: "acting",
      title: "חוק הפעולה — אף דיבון לא נהרג באמצע פעולת-כסף",
      detail:
        "אם מוביל הכסף מדווח acting=true (שידור ברגע השידור), השומר ממתין במצב BUSY — גם אם הדיבון לא עונה ל-HTTP. להרוג שידור חי זה סיכון כסף אמיתי.",
    },
    {
      id: "strikes",
      title: "חוק שלוש-הפסילות",
      detail: "דיבון מוקם מחדש רק אחרי 3 בדיקות כושלות רצופות (סיור כל 30 שנ'). הפסקה חד-פעמית לא נוגעת בו.",
    },
    {
      id: "cooldown",
      title: "חוק הצינון וזמן-האתחול",
      detail: "בין הקמה להקמה של אותו דיבון: 2 דקות מינימום; אחרי כל הקמה — 90 שנ' חסד לפני פסילה חדשה.",
    },
    {
      id: "budget",
      title: "חוק התקציב — GAVE-UP כנה",
      detail:
        "עד 12 הקמות לדיבון ביום-UTC. אחר כך השומר מפסיק ומדווח GAVE-UP בכנות — לא נלחמים בלולאת-מוות; הראייה נשמרת והמפעיל רואה.",
    },
    {
      id: "wedge",
      title: "חוק הנעילה — פורט תפוס בלי מענה",
      detail: "דיבון שהפורט שלו תפוס אך אינו עונה מנוקה (SIGTERM, ואז SIGKILL) לפני הקמה — אף פעם לא שני מאזינים על אותו פורט.",
    },
    {
      id: "canon",
      title: "קבלה לקנון — בלי מפתחות לעולם",
      detail:
        "כל אירוע משמעותי (RESTART · RECOVERED · GAVE-UP) נדחף לקנון Defi אחרי שער-הסודות. השומר עצמו לעולם לא נוגע במפתחות — הוא רק בודק HTTP ומקים תהליכים.",
    },
  ];

  return {
    ok: true,
    at,
    keeper: {
      up: keeperUp,
      beats: typeof keeperSense?.beats === "number" ? keeperSense.beats : keeperFile?.beats ?? null,
      patrolIntervalSec:
        typeof keeperSense?.patrolIntervalSec === "number"
          ? keeperSense.patrolIntervalSec
          : keeperFile?.patrolIntervalSec ?? null,
      lastDecision: keeperSense?.lastDecision ?? keeperFile?.lastDecision ?? null,
      history:
        keeperSense?.history ??
        (keeperFile as unknown as { history?: Array<{ at: string; kind: string; detail: string }> | undefined })?.history ??
        [],
      canon: keeperSense?.canon ?? keeperFile?.canon ?? null,
    },
    fleet,
    laws,
    revival: {
      command: "bun run scripts/daemons-revive.mjs",
      noteHe:
        "פקודה אחת אידמפוטנטית: משקימה כל דיבון שמת, מנקה נעילות-פורט, ולא נוגעת במי שכבר חי. כל סשן חדש מתחיל בה — הצי חוזר בשניות, לא בשעות.",
      canonPath: `reports/keeper-${at.slice(0, 10)}.md`,
    },
    honestGaps: [
      keeperUp
        ? "השומר חי בסשן הסנדבוקס — הוא מפקח על הצי בזמן אמת, אך קיומו עצמו תלוי בסשן."
        : "השומר אינו עונה כרגע — יש להרים את הצי בפקודה: bun run scripts/daemons-revive.mjs (כנות מלאה, לא מוסתר).",
      "ריבונות מעבר לסשן נשארת מותנית בשער-הדקות: כשהקנרית תצייץ, מנועי-הענן חוזרים לזרום — והצי יוכל לרוץ מהענן.",
    ],
  };
}

export async function GET() {
  const swr = await swrGet("keeper:board", 15_000, buildBoard);
  return NextResponse.json(
    { ...swr.value, cached: swr.meta.cached, stale: swr.meta.stale, cacheAgeSec: swr.meta.cacheAgeSec },
    {
      headers: {
        "X-SAOS-Cache": cacheHeader(swr.meta),
        "Cache-Control": "no-store",
      },
    },
  );
}
