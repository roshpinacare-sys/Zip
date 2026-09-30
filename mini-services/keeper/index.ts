// ─────────────────────────────────────────────────────────────────────
// KEEPER — השומר · עין הצי (R84, rebuilt R90)
//
// החוזה: סיור כל 30ש' על שלושת הדיבונים. מוות-שקט אינו אפשרות:
// 3 פסילות → הקמה מחדש. אבל חוק-הפעולה גובר על הכל — לעולם לא הורגים
// דיבון שנמצא באמצע פעולת-כסף (acting=true → BUSY, ממתינים).
//
// R113 — שומר שרת-הרשת: הסריקה האוטונומית תפסה חי את השרת (:3000)
// מת מ-OOM (הקרנל הרג next-server ב-1.9GB RSS) בלי שאף שומר יקים
// אותו — הדלת של כל הרשת. מעתה הסיור בודק גם את /api/health: שתי
// פסילות רצופות → dev-revive (מנותק, בלי לחסום את הסיור) · צינון 3 דק'
// · תקרה גלילית 4 ב-6ש' (אותו חוק-צי). השרת הוא חלק מהצי שהמשתמש רואה.
//
// חוקי-ברזל (מ-R84, נשמרים מלה):
//   · 3 פסילות רצופות → RESTARTING
//   · צינון 2 דק' בין הקמות לאותו דיבון
//   · זמן-חסד 90 דק' מההקמה (בוט שעוד לא עלה אינו "מת")
//   · תקציב 12 הקמות/יום/דיבון ואז GAVE-UP כנה
//   · חוק הפעולה: acting=true → BUSY, לא הורגים
//   · ניקוי נעילות-פורט: SIGTERM→SIGKILL לפני הקמה
//   · קבלות RESTART/RECOVERED/GAVE-UP לקנון אחרי שער-סודות (8/יום)
//   · לולאה-יחידה ב-globalThis (לקח R80)
//   · R91 — חוק הזומבי: HTTP שעונה אך פעימות קפואות = מת. נולד מתקרית
//     חיה: bun --hot הקפיא את הטיימרים של כל הצי — כולם "UP" בסיור
//     בזמן שאף אחד לא תיקתק. מעתה: פעימות שלא התקדמו מעבר ל-3× מחזור
//     הדיבון + חסד = פסילת-זומבי → אותן 3 פסילות ואותה הקמה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו במפעל-האימות)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
  spawnSync: (cmd: string[], opts?: { cwd?: string; stdout?: string; stderr?: string }) => { exitCode?: number; stdout?: Buffer | null; stderr?: Buffer | null };
  spawn: (opts: { cmd: string[]; cwd?: string; stdin?: string; stdout?: number; stderr?: number }) => unknown;
};

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/keeper/state.json`;
const PORT = 3036;
const PATROL_INTERVAL_SEC = 30;
const FAIL_THRESHOLD = 3;
const RESTART_COOLDOWN_MS = 2 * 60 * 1000;
const BOOT_GRACE_MS = 90 * 60 * 1000; // 90 דק' — כמסמך-החוזה למעלה (תיקון ביקורת: היה בטעות 90 שניות בלבד)
const DAILY_RESTART_BUDGET = 12;
// R112 — חוק החלון-הגלילי (נולד ממוות חי): השומר ראה ZOMBIE אמיתי ב-06:14
// אבל תקציב ה-12 של אותו יום נשרף עד 03:26 (ספירלת R110 לפני שחוקי-היילוד
// והפעימה נחקקו) — והדיבון נשאר מת עד חצות. החוק הקשיח היחיד מעתה: 4
// הקמות לכל דיבון בכל חלון-6ש' נע + צינון 2 דק' בין הקמות. המונה היומי
// נשאר לתצפית בלבד — ספירלות נאסרו מבנית (חוק היילוד R110 + המתנה-הכבולה
// R112), ומונה שרוף מעידן-קודם לא ירעיב החייאה ל-18 שעות כשהחלון החי
// ריק. GAVE-UP הוא "הסגר עד שהחלון נפתח", לא "מת עד חצות".
const ROLLING_WINDOW_MS = 6 * 3_600_000;
const ROLLING_WINDOW_CAP = 4;
const CANON_BUDGET_PER_DAY = 8;
// r135 — חוקי ערוץ-הדחיפה (אותו דוקטרינה של D-021: נעול אינו פעולה,
// אין שריפת-תקציב על כישלון מובטח, התעוררות מיידית כשהדרך פתוחה):
const PUSH_HOME = "/home/z/my-project";
const PUSH_BUDGET_PER_DAY = 12;
const PUSH_COOLDOWN_OK_MS = 30 * 60 * 1000; // 30 דק' בין דחיפות-הצלחה
const PUSH_BACKOFF_BASE_MS = 30 * 60 * 1000; // backoff = base × 2^failStreak (תקרה 4ש')
const PUSH_BACKOFF_CAP_MS = 4 * 60 * 60 * 1000;
// R113 — שומר שרת-הרשת
const WEB_PORT = 3000;
const WEB_FAIL_THRESHOLD = 2; // שתי בדיקות שכנות (~60ש') לפני החייאה
const WEB_REVIVE_COOLDOWN_MS = 3 * 60 * 1000;
const WEB_ROLLING_WINDOW_MS = 6 * 3_600_000;
const WEB_ROLLING_WINDOW_CAP = 4;

type FleetEntry = {
  name: string;
  port: number;
  roleHe: string;
  roleEn: string;
  state: "UP" | "DOWN" | "RESTARTING" | "GAVE-UP" | "BUSY";
  since: string;
  lastCheckAt: string | null;
  lastHealthyAt: string | null;
  consecutiveFails: number;
  lastRestartAt: string | null;
  restartsToday: number;
  restartDay: string;
  lastBeats: number | null;
  bootedAtSeen: string | null;
  acting: boolean;
  // R91 — חוק הזומבי
  intervalSec: number; // מחזור הפעימה המוצהר של הדיבון
  beatsStalePatrols: number; // כמה סיורים ברצף בלי התקדמות פעימות
  restartsLog?: string[]; // R112 — חלון-גלילי: חותמות-זמן של ההקמות האחרונות
};

type KeeperState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  patrolIntervalSec: number;
  alive: boolean;
  patrolling: boolean;
  lastDecision: { at: string; kind: string; detail: string } | null;
  fleet: FleetEntry[];
  history: Array<{ at: string; kind: string; detail: string }>;
  canonLast: { at: string; ok: boolean; path: string } | null;
  canonToday: number;
  canonDay: string;
  // R113 — שומר שרת-הרשת: חלון גלילי להחייאות (כמו חוק-הצי)
  web: {
    lastCheckAt: string | null;
    lastHealthyAt: string | null;
    consecutiveFails: number;
    lastReviveAt: string | null;
    revivesToday: number;
    reviveDay: string;
    revivesLog: string[];
  };
  // r135 — ערוץ-הדחיפה של הבית (Zip): נולד מהשתיקה של 2026-09-29.
  // הצי רץ ורושם מקומית, קומיטים נתקעו בלי דוחף, והעולם ראה "אין התקדמות".
  push: {
    lastPushAt: string | null;
    lastResult: { at: string; ok: boolean; detail: string } | null;
    today: number;
    day: string;
    lastAhead: number;
    failStreak: number;
    nextAllowedAt: string | null;
  };
};

type WebGuard = KeeperState["web"];

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function freshFleet(): FleetEntry[] {
  const defs: Array<[string, number, string, string, number]> = [
    ["pulse", 3033, "הדופק — השידור היומי לשרשרת", "The pulse — daily chain broadcast", 30],
    ["money", 3034, "מוביל הכסף — סולם הפאריטה על הקו", "The money mover — parity ladder", 60],
    ["hunter", 3035, "הצייד — שער הדקות ולוח ההזדמנויות", "The hunter — minute-gate & opportunities", 600],
    ["student", 3037, "התלמיד — בחינה עצמית, כיסוי ולמידה", "The student — self-exam, coverage & learning", 600],
    ["fleet-verify", 3038, "מפעל האימות המקומי — תשעת המאמתים חוזרים לחיים", "The local verification plant — nine verifiers reborn", 120],
    ["weblift", 3039, "מעלה התוכן — המשך הגירת רשת-האחסון אל השרשרת", "The web lifter — storage-network migration to the chain", 2700],
    ["curation", 3040, "דיבון האוצרות — כוח-ההצבעה הבטל הופך הכנסה", "The curation daemon — idle voting power becomes income", 900],
    ["kpi", 3041, "מפקיד ה-KPI — הספר היומי הנמדד של משימת $1,000 (Z-9)", "The KPI scribe — the measured daily ledger of the $1,000 mission (Z-9)", 60],
  ];
  return defs.map(([name, port, roleHe, roleEn, intervalSec]) => ({
    name,
    port,
    roleHe,
    roleEn,
    state: "DOWN" as const,
    since: new Date().toISOString(),
    lastCheckAt: null,
    lastHealthyAt: null,
    consecutiveFails: 0,
    lastRestartAt: null,
    restartsToday: 0,
    restartDay: utcDay(),
    lastBeats: null,
    bootedAtSeen: null,
    acting: false,
    intervalSec,
    beatsStalePatrols: 0,
  }));
}

function freshPush(): KeeperState["push"] {
  const now = new Date().toISOString();
  return {
    lastPushAt: null,
    lastResult: null,
    today: 0,
    day: utcDay(),
    lastAhead: 0,
    failStreak: 0,
    nextAllowedAt: null,
  };
}

function freshWeb(): WebGuard {
  return {
    lastCheckAt: null,
    lastHealthyAt: null,
    consecutiveFails: 0,
    lastReviveAt: null,
    revivesToday: 0,
    reviveDay: utcDay(),
    revivesLog: [],
  };
}

function readState(): KeeperState {
  const base: KeeperState = {
    service: "keeper",
    version: "1.3.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    patrolIntervalSec: PATROL_INTERVAL_SEC,
    alive: true,
    patrolling: false,
    lastDecision: null,
    fleet: freshFleet(),
    history: [],
    canonLast: null,
    canonToday: 0,
    canonDay: utcDay(),
    web: freshWeb(),
    push: freshPush(),
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const fleet = Array.isArray(prev.fleet)
      ? base.fleet.map((f) => {
          const p = prev.fleet.find((x: FleetEntry) => x.name === f.name);
          if (!p) return f;
          const sameDay = p.restartDay === utcDay();
          // R103 — תיקון השורש (נמדד חי: money מת 2.5 שעות עם FAIL-458 בזמן
          // שהשומר ספר ולא הקים): GAVE-UP היה נצחי — שרד אתחולי-keeper
          // וחסם כל הקמה לנצח. החוק המתוקן: אתחול-keeper או יום חדש
          // מאפסים את GAVE-UP ל-DOWN (חסד של מחזור אחד); מונה התקציב
          // של היום נשמר — דיבון שבאמת שבור יחזור ל-GAVE-UP אחרי
          // 3 פסילות בלבד. כך החסד כנה והתקציב אמיתי.
          const freshState = p.state === "GAVE-UP" ? "DOWN" : (p.state ?? "DOWN");
          return {
            ...f,
            state: freshState,
            since: p.since ?? f.since,
            lastCheckAt: p.lastCheckAt ?? null,
            lastHealthyAt: p.lastHealthyAt ?? null,
            consecutiveFails: 0, // אתחול: הספירה מתחילה מחדש בכל סשן — המדידה טרייה
            lastRestartAt: p.lastRestartAt ?? null,
            restartsToday: sameDay ? (p.restartsToday ?? 0) : 0,
            restartDay: sameDay ? p.restartDay : utcDay(),
            lastBeats: p.lastBeats ?? null,
            bootedAtSeen: p.bootedAtSeen ?? null,
            acting: false,
            restartsLog: Array.isArray(p.restartsLog) ? p.restartsLog : [],
          };
        })
      : base.fleet;
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastDecision: prev.lastDecision ?? null,
      fleet,
      history: Array.isArray(prev.history) ? prev.history.slice(-60) : [],
      canonLast: prev.canonLast ?? null,
      canonToday: prev.canonDay === utcDay() ? (prev.canonToday ?? 0) : 0,
      canonDay: prev.canonDay === utcDay() ? prev.canonDay : utcDay(),
      // R113 — שומר שרת-הרשת: נשיאת חלון-גלילי בין אתחולים; הספירה מתאפסת (מדידה טרייה)
      web: {
        ...freshWeb(),
        lastHealthyAt: prev.web?.lastHealthyAt ?? null,
        lastReviveAt: prev.web?.lastReviveAt ?? null,
        revivesToday: prev.web?.reviveDay === utcDay() ? (prev.web?.revivesToday ?? 0) : 0,
        reviveDay: prev.web?.reviveDay === utcDay() ? prev.web.reviveDay : utcDay(),
        revivesLog: Array.isArray(prev.web?.revivesLog) ? prev.web.revivesLog : [],
      },
      // r135 — ערוץ-הדחיפה: נשיאת מצב בין אתחולים (יום חדש מאפס תקציב)
      push: {
        ...freshPush(),
        lastPushAt: prev.push?.lastPushAt ?? null,
        lastResult: prev.push?.lastResult ?? null,
        today: prev.push?.day === utcDay() ? (prev.push?.today ?? 0) : 0,
        day: prev.push?.day === utcDay() ? prev.push.day : utcDay(),
        lastAhead: typeof prev.push?.lastAhead === "number" ? prev.push.lastAhead : 0,
        failStreak: typeof prev.push?.failStreak === "number" ? prev.push.failStreak : 0,
        nextAllowedAt: prev.push?.nextAllowedAt ?? null,
      },
    };
  } catch {
    return base;
  }
}

// R124 — ציר-עולם למצב הדיבון (דפוס weblift/fleet-verify): דור-חם יורש את
// אובייקט-המצב החי; קריאה-מדיסק בכל דור חשפה את המצב לשכתוב-מדור-קפוא.
const G_KEEPER = globalThis as unknown as { __KEEPER_STATE__?: KeeperState };
let state: KeeperState = G_KEEPER.__KEEPER_STATE__ ?? readState();
G_KEEPER.__KEEPER_STATE__ = state;

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/keeper`, { recursive: true });
  // חוק R107b: כתיבה-אטומית — .tmp ואז rename. רגע-מוות באמצע כתיבה
  // לא ישאיר ליורש קובץ-מצב חצוי (הלקח שנלמד חי בכסף, עכשיו חוק גם כאן).
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function record(kind: string, detail: string, canon = false) {
  const at = new Date().toISOString();
  state.lastDecision = { at, kind, detail };
  state.history = [...state.history, { at, kind, detail }].slice(-60);
  if (canon) {
    pendingCanon.push({ at, kind, detail });
    // R123 — תקרת-זיכרון כנה: בלי PAT הקבלות נשמרות לניסיון חוזר — אבל
    // לנצח זה דליפת-זיכרון. 200 הקבלות אחרונות נשמרות; הישנות נזרקות
    // בכנות (הן מוחזקות גם ב-history של המצב, חתומות ביומן השומר).
    if (pendingCanon.length > 200) pendingCanon.splice(0, pendingCanon.length - 200);
  }
}

// ── שער-סודות + קנון ───────────────────────────────────────────────
const pendingCanon: Array<{ at: string; kind: string; detail: string }> = [];

function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) return { ok: false, reason: "base58-wif-shape" };
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) return { ok: false, reason: "github-token-shape" };
  return { ok: true };
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

async function flushCanon() {
  if (!pendingCanon.length) return;
  if (state.canonDay !== utcDay()) {
    state.canonDay = utcDay();
    state.canonToday = 0;
  }
  if (state.canonToday >= CANON_BUDGET_PER_DAY) return; // תקציב 8/יום — כנות
  const path = `reports/keeper-${utcDay()}.md`;
  const pat = readPat();
  if (!pat) {
    // כנות: הכישלון נרשם — canonLast לא נשאר ישן {ok:true} מהצלחה
    // קודמת. הקבלות נשמרות בזיכרון ויידחפו כשה-PAT יחזור (אין מחיקה שקטה).
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (NO-PAT)` };
    return;
  }
  const body = [
    `# יומן השומר · ${utcDay()}`,
    "",
    ...pendingCanon.map((e) => `- \`${e.at}\` **${e.kind}** — ${e.detail}`),
    "",
    `_מופק אוטונומית על-ידי keeper v${state.version} (R90 rebuild). תקציב קנון: ${state.canonToday}/${CANON_BUDGET_PER_DAY}._`,
  ].join("\n");
  const gate = secretsGate(body);
  if (!gate.ok) {
    // תוכן שנחסם בשער-הסודות לא יעבור לעולם — נזרק בכנות (רשום ב-canonLast),
    // כדי שפריט בלתי-פרסומי אחד לא יחסום את כל הקבלות שאחריו לנצח.
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (BLOCKED: ${gate.reason})` };
    pendingCanon.length = 0;
    return;
  }
  const url = `https://api.github.com/repos/roshpinacare-sys/Defi/contents/${path}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "keeper-daemon",
  };
  try {
    let sha: string | undefined;
    // R112 — law of the bounded wait: no fetch without a deadline
    const cur = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (cur.ok) sha = (await cur.json()).sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `keeper: fleet supervision receipt ${new Date().toISOString()}`,
        content: Buffer.from(body, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    state.canonLast = { at: new Date().toISOString(), ok: res.ok, path };
    if (res.ok) {
      state.canonToday += 1;
      pendingCanon.length = 0; // הצלחה — הקבלות עלו לקנון
    }
    // כישלון דחיפה — הקבלות נשמרות לניסיון חוזר בסיור הבא (לא נזרקות בשקט)
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (FETCH-ERROR)` };
    // חריגת רשת — הקבלות נשמרות לניסיון חוזר
  }
}

// ── בדיקת-חיים של דיבון ────────────────────────────────────────────
async function probe(port: number): Promise<{ ok: boolean; body?: any }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return { ok: false };
    const j = await res.json().catch(() => null);
    return { ok: !!j?.ok, body: j };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

// ── הקמה מחדש: ניקוי פורט → bun run dev ──────────────────────────
function pidsOnPort(port: number): number[] {
  try {
    const out = Bun.spawnSync(["ss", "-tlnp", `sport = :${port}`], { stdout: "pipe", stderr: "pipe" }).stdout?.toString() ?? "";
    return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])).filter((p) => p > 0);
  } catch {
    return [];
  }
}

// R112 — החלון-הגלילי: כמה הקמות נעשו לדיבון זה ב-6 השעות האחרונות.
// הרשימה מתקצרת בכל קריאה — החלון נע, הזיכרון מוגבל לחוק שלו.
function recentRestarts(d: FleetEntry): number {
  const cut = Date.now() - ROLLING_WINDOW_MS;
  const log = (d.restartsLog ?? []).filter((t) => Date.parse(t) > cut);
  d.restartsLog = log;
  return log.length;
}

function restartDaemon(d: FleetEntry): boolean {
  // חוק היילוד (R110, נתפס חי): רשימת-ההרג נתפסת לפני ההקמה —
  // ה-SIGKILL המושהה חייב לפגוע רק בזקן שסירב למות, לעולם לא ב"מי
  // שעל הפורט עכשיו": 1.5ש' אחרי ההקמה שם עומד היילוד עצמו. מרוץ-ההרגה
  // הקודם רצח כל הקמה חדשה תוך שניות (fleet-verify: 8 רציחות ברצף,
  // כל "החייאה" הרגה את בנה — ספירלת מוות שנראתה כמו דיבון גוסס).
  const doomed = pidsOnPort(d.port);
  for (const pid of doomed) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  if (doomed.length > 0) {
    setTimeout(() => {
      // רק ה-PI שנתפסו לפני ההקמה — הזקנים שסירבו למות
      for (const pid of doomed) {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }, 1500).unref?.();
  }
  // הקמה — process.execPath (הבאג של R90: 'bun' לא תמיד ב-PATH; עכשיו אבסולוטי)
  const dir = `${HOME}/mini-services/${d.name}`;
  if (!fs.existsSync(`${dir}/index.ts`)) return false;
  const logDir = `${HOME}/sovereign/keeper/logs`;
  fs.mkdirSync(logDir, { recursive: true });
  const fd = fs.openSync(`${logDir}/${d.name}-daemon.log`, "a");
  try {
    Bun.spawn({
      cmd: [process.execPath, "--hot", "index.ts"],
      cwd: dir,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
    return true;
  } catch {
    return false;
  }
}

// R113 — שומר שרת-הרשת: כמה החייאות בחלון-ה-6ש' הגולש
function webRevivesRecent(): number {
  const cut = Date.now() - WEB_ROLLING_WINDOW_MS;
  state.web.revivesLog = state.web.revivesLog.filter((t) => Date.parse(t) > cut);
  return state.web.revivesLog.length;
}

// R113 — החיית שרת-הרשת: dev-revive מנותק מהסיור (הסקריפט עצמו אידמפוטנטי,
// ממתין עד 60ש' ומסיים; השרת שהוא מקים הוא יתום-PPID1 עצמאי — לקח R100).
function reviveWeb(): boolean {
  try {
    const logDir = `${HOME}/sovereign/keeper/logs`;
    fs.mkdirSync(logDir, { recursive: true });
    const fd = fs.openSync(`${logDir}/web-revive.log`, "a");
    Bun.spawn({
      cmd: [process.execPath, "scripts/dev-revive.mjs"],
      cwd: HOME,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
    return true;
  } catch {
    return false;
  }
}

// R113 — סיור שרת-הרשת: הדלת של כל הרשת מקבלת שומר משלה
async function patrolWeb(parts: string[]): Promise<void> {
  const now = new Date();
  state.web.lastCheckAt = now.toISOString();
  let ok = false;
  try {
    const res = await fetch(`http://127.0.0.1:${WEB_PORT}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (ok) {
    const wasDown = state.web.consecutiveFails > 0;
    state.web.consecutiveFails = 0;
    state.web.lastHealthyAt = now.toISOString();
    if (wasDown) {
      record("WEB-UP", `שרת הרשת (:${WEB_PORT}) חזר לענות — הדלת חיה`, false);
    }
    parts.push("web:UP");
    return;
  }
  state.web.consecutiveFails += 1;
  const failsNow = state.web.consecutiveFails;
  parts.push(`web:DOWN-${failsNow}`);
  if (failsNow < WEB_FAIL_THRESHOLD) return; // פסילה בודדת — ממתינים לסיור הבא
  const sinceReviveMs = state.web.lastReviveAt ? now.getTime() - Date.parse(state.web.lastReviveAt) : Infinity;
  if (sinceReviveMs < WEB_REVIVE_COOLDOWN_MS) return; // צינון — ההחייאה הקודמת עוד עולה
  if (webRevivesRecent() >= WEB_ROLLING_WINDOW_CAP) {
    record("WEB-HOLD", `שרת-הרשת (:${WEB_PORT}) בהסגר-חלון-ההחייאות (${webRevivesRecent()}/${WEB_ROLLING_WINDOW_CAP} ב-6ש' נע) — כנות, לא ספירלה`, true);
    return;
  }
  if (state.web.reviveDay !== utcDay()) {
    state.web.reviveDay = utcDay();
    state.web.revivesToday = 0;
  }
  const started = reviveWeb();
  state.web.revivesToday += 1;
  state.web.lastReviveAt = now.toISOString();
  state.web.revivesLog.push(now.toISOString());
  state.web.consecutiveFails = 0; // הספירה מתחדשת — הסיורים הבאים ימדדו את התוצאה
  record(
    started ? "WEB-REVIVE" : "WEB-REVIVE-FAIL",
    `שרת-הרשת (:${WEB_PORT}): ${started ? `dev-revive שוגר (${failsNow} פסילות רצופות · חלון ${webRevivesRecent()}/${WEB_ROLLING_WINDOW_CAP})` : "שיגור dev-revive נכשל"}`,
    true,
  );
}

// ── ערוץ-הדחיפה של הבית (r135) ────────────────────────────────────
// הלקח החי של 2026-09-29: הצי רץ, מדיד ורושם — אבל קומיטים מקומיים
// נשארו תקועים בלי דוחף (חיווט-האישורים אבד במיחזור-סנדבוקס), והעולם
// ראה שתיקה. מעתה השומר גם דוחף, בחוקים הקשוחים של הצי:
//   · אפס פעולה על כישלון מובטח (D-021): אין מפתח/אין קדימה → רישום
//     כנה + backoff, לא שריפת-תקציב.
//   · תקציב 12 דחיפות/יום · צינון 30 דק' בין הצלחות · backoff כפול עד 4ש'.
//   · pull --rebase לפני push (העוגנים חיים ב-origin ולעולם לא נדרוס);
//     סכסוך = abort כנה + backoff ארוך, אף דריסה.
//   · האישורים חיים רק ב-upload/ (מחוץ לגיט) — לעולם לא בלוג או בקבלה.
function gitRun(args: string[], timeoutMs = 45_000): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["git", ...args], { cwd: PUSH_HOME, stdout: "pipe", stderr: "pipe" });
  const out = `${r.stdout?.toString() ?? ""}${r.stderr?.toString() ?? ""}`.trim();
  return { ok: r.exitCode === 0, out: out.slice(0, 300) };
}

async function pushLane(parts: string[]): Promise<void> {
  const now = new Date();
  const p = state.push;
  if (p.day !== utcDay()) {
    p.day = utcDay();
    p.today = 0;
  }
  // מדידת-קדימה מקומית בלבד (אפס תלות-רשת)
  const ahead = gitRun(["rev-list", "--count", "origin/main..HEAD"]);
  p.lastAhead = ahead.ok ? parseInt(ahead.out, 10) || 0 : p.lastAhead;

  if (p.nextAllowedAt && now.getTime() < Date.parse(p.nextAllowedAt)) return;
  if (p.today >= PUSH_BUDGET_PER_DAY) return; // תקציב — כנות, לא התעלמות
  if (p.lastPushAt && now.getTime() - Date.parse(p.lastPushAt) < PUSH_COOLDOWN_OK_MS && p.lastAhead === 0) return;
  if (p.lastAhead === 0) return; // אין קדימה — אין פעולה (לא שורפים צינון)

  const bumpBackoff = (ok: boolean, detail: string) => {
    p.lastResult = { at: now.toISOString(), ok, detail };
    if (ok) {
      p.failStreak = 0;
      p.nextAllowedAt = null;
      p.today += 1;
      p.lastPushAt = now.toISOString();
    } else {
      p.failStreak += 1;
      const ms = Math.min(PUSH_BACKOFF_BASE_MS * 2 ** Math.min(p.failStreak - 1, 4), PUSH_BACKOFF_CAP_MS);
      p.nextAllowedAt = new Date(now.getTime() + ms).toISOString();
    }
  };

  // שער-אישורים: ה-helper קורא את ה-PAT מ-upload/ בעת-הריצה; בלי קובץ — אין ניסיון (D-021)
  const pat = readPat();
  if (!pat) {
    bumpBackoff(false, "NO-PAT — ערוץ-הדחיפה סגור (האישורים חיים ב-upload/ מחוץ לגיט)");
    parts.push(`push:BLOCKED`);
    return;
  }

  const fetchR = gitRun(["fetch", "origin", "main"]);
  if (!fetchR.ok) {
    bumpBackoff(false, `FETCH-FAIL: ${fetchR.out.slice(0, 120)}`);
    parts.push(`push:FETCH-FAIL`);
    return;
  }
  // ספירה-מחדש אחרי-fetch: אולי העוגנים כבר כללו את המצב שלנו
  const ahead2 = gitRun(["rev-list", "--count", "origin/main..HEAD"]);
  const nAhead = ahead2.ok ? parseInt(ahead2.out, 10) || 0 : p.lastAhead;
  if (nAhead === 0) {
    p.lastAhead = 0;
    return;
  }
  const behind2 = gitRun(["rev-list", "--count", "HEAD..origin/main"]);
  const nBehind = behind2.ok ? parseInt(behind2.out, 10) || 0 : 0;
  if (nBehind > 0) {
    // עץ-מלוכלך חוסם rebase — הדיבונים כותבי-מצב כל הזמן. סחרור-מצב קודם
    // (הדפוס הקנוני של הבית), ואז rebase. כשל = abort כנה + backoff.
    const dirty = gitRun(["status", "--porcelain", "--", "sovereign/"]);
    if (dirty.ok && dirty.out.length > 0) {
      gitRun(["add", "sovereign/"]);
      const churn = gitRun(["commit", "-m", `[daemon-state] keeper: fleet state refresh (${utcDay()})`]);
      if (!churn.ok) {
        bumpBackoff(false, `CHURN-COMMIT-FAIL: ${churn.out.slice(0, 120)}`);
        parts.push(`push:CHURN-FAIL`);
        return;
      }
    }
    const rebase = gitRun(["pull", "--rebase", "origin", "main"]);
    if (!rebase.ok) {
      gitRun(["rebase", "--abort"]); // כנות: לא משאירים מצב-ביניים
      bumpBackoff(false, `REBASE-CONFLICT — abort כנה, backoff ${Math.round(Math.min(PUSH_BACKOFF_BASE_MS * 2 ** Math.min(p.failStreak, 4), PUSH_BACKOFF_CAP_MS) / 60000)} דק'`);
      parts.push(`push:REBASE-CONFLICT`);
      record("PUSH-FAIL", `ערוץ-הדחיפה: rebase נגד origin/main נתקל בסכסוך — בוטל בכנות, אף דריסה (backoff)`, true);
      return;
    }
  }
  const push = gitRun(["push", "origin", "main"]);
  bumpBackoff(push.ok, push.ok ? `נדחף ל-origin/main (${nAhead} קומיטים)` : `PUSH-FAIL: ${push.out.slice(0, 120)}`);
  if (push.ok) {
    record("PUSH", `ערוץ-הדחיפה: ${nAhead} קומיטים מקומיים ירדו ל-origin/main — הבית מדבר שוב`, true);
    parts.push(`push:PUSHED-${nAhead}`);
  } else {
    record("PUSH-FAIL", `ערוץ-הדחיפה: דחיפה נכשלה בכנות — הקבלות נשמרות, backoff (אין מחיקה שקטה)`, true);
    parts.push(`push:FAIL`);
  }
}

// ── הסיור ───────────────────────────────────────────────────────────
async function patrol() {
  const now = new Date();
  const parts: string[] = [];
  for (const d of state.fleet) {
    const r = await probe(d.port);
    d.lastCheckAt = now.toISOString();

    // חוק הפעולה: דיבון שפועל באמצע פעולת-כסף — BUSY, לא פסילה, לא הרג
    d.acting = !!r.body?.acting;
    if (r.ok && d.acting) {
      d.state = "BUSY";
      d.consecutiveFails = 0;
      d.lastHealthyAt = now.toISOString();
      d.lastBeats = r.body?.beats ?? d.lastBeats;
      d.bootedAtSeen = r.body?.bootedAt ?? d.bootedAtSeen;
      d.beatsStalePatrols = 0; // בפעולה — הפעימות ממתינות כדין
      parts.push(`${d.name}:BUSY`);
      continue;
    }

    if (r.ok) {
      const wasDown = d.state !== "UP";
      // R91 — חוק הזומבי: האם הפעימות התקדמו מאז הסיור הקודם?
      const beatsNow = typeof r.body?.beats === "number" ? (r.body.beats as number) : null;
      const bootChanged = !!r.body?.bootedAt && r.body.bootedAt !== d.bootedAtSeen;
      if (beatsNow === null || beatsNow > (d.lastBeats ?? -1) || bootChanged) {
        d.beatsStalePatrols = 0; // חי — הפעימות מתקדמות (או אתחול חדש)
      } else {
        d.beatsStalePatrols += 1;
        // תקרה מכובדת: 3× מחזור הדיבון + חסד, ביחידות סיור (30ש')
        const allowedStale = Math.ceil((d.intervalSec + 120) / PATROL_INTERVAL_SEC) + 1;
        if (d.beatsStalePatrols > allowedStale) {
          // זומבי — HTTP עונה אך הטיימר קפוא (לקח bun --hot החי)
          d.state = "DOWN";
          d.consecutiveFails += 1;
          parts.push(`${d.name}:ZOMBIE-${d.consecutiveFails}`);
          if (d.consecutiveFails >= FAIL_THRESHOLD) {
            const sinceRestartMs = d.lastRestartAt ? now.getTime() - Date.parse(d.lastRestartAt) : Infinity;
            if (d.restartDay !== utcDay()) {
              d.restartDay = utcDay();
              d.restartsToday = 0;
            }
            if (recentRestarts(d) < ROLLING_WINDOW_CAP && sinceRestartMs >= RESTART_COOLDOWN_MS) {
              d.state = "RESTARTING";
              const okR = restartDaemon(d);
              d.restartsToday += 1;
              (d.restartsLog ??= []).push(now.toISOString());
              d.lastRestartAt = now.toISOString();
              d.consecutiveFails = 0;
              d.beatsStalePatrols = 0;
              d.since = now.toISOString();
              record(okR ? "RESTART" : "RESTART-FAIL", `${d.name} (${d.port}): ${okR ? "הוקם — זומבי: פעימות קפואות (hot-reload)" : "ההקמה נכשלה — זומבי"}`, true);
            }
          }
          continue;
        }
      }
      d.state = "UP";
      d.consecutiveFails = 0;
      d.lastHealthyAt = now.toISOString();
      d.lastBeats = beatsNow ?? d.lastBeats;
      d.bootedAtSeen = r.body?.bootedAt ?? d.bootedAtSeen;
      if (wasDown && d.since < state.bootedAt) {
        // UNKNOWN→UP בסיור הראשון אינו "החזרה לחיים" — לא מתעדים (לקח R84)
        d.since = now.toISOString();
      }
      parts.push(`${d.name}:UP`);
      continue;
    }

    // פסילה
    d.consecutiveFails += 1;
    parts.push(`${d.name}:FAIL-${d.consecutiveFails}`);
    // R112 — GAVE-UP הוא הסגר עד שהחלון נפתח, לא מוות עד חצות:
    // ברגע שבגלישת-ה-6ש' יש מקום — הדיבון חוזר לפיקוח מלא.
    if (d.state === "GAVE-UP") {
      if (recentRestarts(d) >= ROLLING_WINDOW_CAP) continue; // החלון עוד מלא — הסגר כנה
      d.state = "DOWN";
      record("QUARANTINE-END", `${d.name} (${d.port}): חלון-ההחייאות הגלילי נפתח — חוזר לפיקוח מלא`, false);
      continue; // הסיור הבא מעריך מחדש
    }

    if (d.consecutiveFails < FAIL_THRESHOLD) {
      d.state = "DOWN";
      continue;
    }

    // 3 פסילות — בדיקת חוקי-הצינון, החסד והתקציב
    const sinceBootMs = d.bootedAtSeen ? now.getTime() - Date.parse(d.bootedAtSeen) : Infinity;
    const sinceRestartMs = d.lastRestartAt ? now.getTime() - Date.parse(d.lastRestartAt) : Infinity;
    if (sinceBootMs < BOOT_GRACE_MS) {
      d.state = "DOWN";
      continue; // זמן-חסד: בוט שרק עלה אינו "מת"
    }
    if (d.restartDay !== utcDay()) {
      d.restartDay = utcDay();
      d.restartsToday = 0;
    }
    // 2026-09-29 (r139): תקציב-ההקמות היומי נאכף — היה מוגדר (DAILY_RESTART_BUDGET)
    // אך לעולם לא נבדק במסלול-הפסילה הראשי; kpi רשם 192 הקמות ביום על דיבון בריא
    // (שורש-השורש היה probe חסר-`ok` ב-kpi — תוקן שם) — שתי ההגנות עכשיו בקוד.
    if (d.restartsToday >= DAILY_RESTART_BUDGET) {
      d.state = "GAVE-UP";
      record("GAVE-UP", `${d.name} (${d.port}): תקציב-ההקמות היומי אזל (${d.restartsToday}/${DAILY_RESTART_BUDGET}) — הסגר עד חצות-UTC; הפגם הוא בקוד, לא בהקמה`, true);
      continue;
    }
    if (recentRestarts(d) >= ROLLING_WINDOW_CAP) {
      d.state = "GAVE-UP";
      record("GAVE-UP", `${d.name} (${d.port}): חלון-ההחייאות הגלילי מלא (${recentRestarts(d)}/${ROLLING_WINDOW_CAP} ב-6ש' · יומי ${d.restartsToday} לתצפית) — הסגר עד שהחלון נפתח`, true);
      continue;
    }
    if (sinceRestartMs < RESTART_COOLDOWN_MS) {
      d.state = "DOWN";
      continue; // צינון בין הקמות
    }

    // RESTARTING — עם חוק-הפעולה בפנים (acting כבר נבדק למעלה; כאן רק חיזוק)
    d.state = "RESTARTING";
    const reason =
      d.consecutiveFails === FAIL_THRESHOLD ? `${FAIL_THRESHOLD} פסילות רצופות` : "פורט ריק (מת)";
    const ok = restartDaemon(d);
    // 2026-09-29 (r139): רישום-החלון הגלילי במסלול-הפסילה הראשי — היה נרשם
    // רק בענף-הזומבי, ולכן recentRestarts החזיר אפס כאן והחלון לא נסגר לעולם.
    (d.restartsLog ??= []).push(now.toISOString());
    d.restartsToday += 1;
    d.lastRestartAt = now.toISOString();
    d.consecutiveFails = 0;
    d.since = now.toISOString();
    record(ok ? "RESTART" : "RESTART-FAIL", `${d.name} (${d.port}): ${ok ? `הוקם — ${reason}` : `ההקמה נכשלה — ${reason}`}`, true);
  }
  await patrolWeb(parts);
  await pushLane(parts);
  // R113 — אמת מלאה במילה: "סיור תקין" רק כשגם שרת-הרשת עונה
  const allUp = state.fleet.every((d) => d.state === "UP" || d.state === "BUSY") && state.web.consecutiveFails === 0;
  if (state.history.length === 0 || state.history[state.history.length - 1].detail !== parts.join(" · ")) {
    record("PATROL", allUp ? `סיור תקין — ${parts.map((p) => p.replace(/:(FAIL|BUSY)-?\d*/, (m) => (m.includes("BUSY") ? m : "DOWN"))).join(" · ")}` : `התערבות — ${parts.join(" · ")}`, false);
  }
}

// ── r140 · מפקד-ההחזאה (revival sweep) ─────────────────────────────
// זרימות-הענן שמתו בחנקת-המכסה (D-025/R106 — steps:0, מוות ב-2ש') חוזרות
// מעצמן: אחת ליום-UTC השומר שולח workflow_dispatch לכל זרימה-דורמת ידועה,
// מודד את פסקי-הדין מה-API, ורושם אותם בכנות בקובץ-מצב. אפס תלות
// במפעיל: כשהמכסה נפתחת (חידוש-חיוב 01/10) הצי קם לבד, ועד אז כל
// ניסיון נרשם כמה שהוא — הצלחה או כישלון מדוד.
// תקציב: סריקה אחת/יום · 13 שיגורים · אפס סודות בקובץ-המצב.

const REVIVAL_WORKFLOWS: Array<{ repo: string; wf: string }> = [
  { repo: "Zip", wf: "weave-heart.yml" },
  { repo: "Zip", wf: "weave-anchor-lines.yml" },
  { repo: "Zip", wf: "weave-ecosystem.yml" },
  { repo: "Zip", wf: "web-publish.yml" },
  { repo: "Zip", wf: "web-probe.yml" },
  { repo: "Zip", wf: "web-probe2.yml" },
  { repo: "Zip", wf: "weave-brain-restore.yml" },
  { repo: "Domain", wf: "bootstrap-pages.yml" },
  { repo: "Domain", wf: "key-verify.yml" },
  { repo: "Domain", wf: "seal-adopt.yml" },
  { repo: "steem", wf: "cloud-heart.yml" },
  { repo: "saos-dex", wf: "dex-beat.yml" },
  { repo: "Console", wf: "key-verify.yml" },
];
const REVIVAL_STATE = `${HOME}/sovereign/keeper/revival-sweep.json`;
const REVIVAL_WAIT_MS = 90_000;

interface RevivalResult {
  repo: string;
  wf: string;
  dispatched: boolean;
  status?: string;
  conclusion?: string | null;
  at?: string;
}

function readRevivalState(): { day: string | null; results: RevivalResult[] } {
  try {
    return JSON.parse(fs.readFileSync(REVIVAL_STATE, "utf8"));
  } catch {
    return { day: null, results: [] };
  }
}

async function revivalSweep(): Promise<void> {
  const st = readRevivalState();
  const day = utcDay();
  if (st.day === day) return; // תקציב: סריקה אחת ליום-UTC
  const pat = readPat();
  if (!pat) {
    record("REVIVAL-SKIP", "אין PAT — הסריקה היומית מדולגת בכנות, תחזור מחר");
    st.day = day;
    fs.writeFileSync(REVIVAL_STATE, JSON.stringify(st, null, 2));
    return;
  }
  record("REVIVAL-SWEEP", `פתיחת סריקת-החזאה יומית — ${REVIVAL_WORKFLOWS.length} זרימות-יעד`, false);
  const results: RevivalResult[] = [];
  for (const { repo, wf } of REVIVAL_WORKFLOWS) {
    let dispatched = false;
    try {
      const r = await fetch(`https://api.github.com/repos/roshpinacare-sys/${repo}/actions/workflows/${wf}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "keeper-revival" },
        body: JSON.stringify({ ref: "main" }),
      });
      dispatched = r.status === 204;
    } catch {
      dispatched = false;
    }
    results.push({ repo, wf, dispatched });
  }
  // המתנה מדודה ואז קריאת פסקי-הדין — אמת, לא הנחה
  await new Promise((r) => setTimeout(r, REVIVAL_WAIT_MS));
  for (const res of results) {
    if (!res.dispatched) continue;
    try {
      const r = await fetch(
        `https://api.github.com/repos/roshpinacare-sys/${res.repo}/actions/workflows/${res.wf}/runs?per_page=1`,
        { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "keeper-revival" } },
      );
      const j: any = await r.json();
      const run = j?.workflow_runs?.[0];
      if (run) {
        res.status = run.status;
        res.conclusion = run.conclusion ?? null;
        res.at = run.created_at;
      }
    } catch {
      /* כנות: לא נקרא — נישאר בלי פסק-דין */
    }
  }
  const woke = results.filter((x) => x.conclusion === "success").length;
  const ran = results.filter((x) => x.status === "completed").length;
  fs.writeFileSync(REVIVAL_STATE, JSON.stringify({ day, at: new Date().toISOString(), results }, null, 2));
  record(
    "REVIVAL",
    `סריקת-החזאה: ${results.filter((x) => x.dispatched).length}/${REVIVAL_WORKFLOWS.length} שוגרו · ${ran} הסתיימו · ${woke} קמו (פסקי-דין מלאים ב-sovereign/keeper/revival-sweep.json)`,
    false,
  );
}

// לולאה-יחידה (לקח R80)
const g = globalThis as { __keeperLoop?: boolean };
if (!g.__keeperLoop) {
  g.__keeperLoop = true;
  const loop = async () => {
    if (state.patrolling) return;
    state.patrolling = true;
    try {
      state.beats += 1;
      await patrol();
      await flushCanon();
      await revivalSweep();
    } catch (e: any) {
      record("ERROR", String(e?.message ?? e).slice(0, 160));
    } finally {
      state.patrolling = false;
      saveState();
    }
  };
  Bun.serve({
    port: PORT,
    hostname: "127.0.0.1", // R123 — השומר נצרך מ-localhost בלבד (API/מפעיל מקומי)
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
      }
      return new Response("not found", { status: 404 });
    },
  });
  saveState();
  console.log(`[keeper] חי על פורט ${PORT} · beats=${state.beats} · צי: ${state.fleet.map((f) => f.name).join(",")}`);
  loop();
  setInterval(loop, PATROL_INTERVAL_SEC * 1000);
}
