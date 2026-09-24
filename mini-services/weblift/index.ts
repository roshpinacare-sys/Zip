// ─────────────────────────────────────────────────────────────────────
// WEBLIFT — מעלה התוכן (R120).
//
// הרקע (חוק הסנדבוקס-הנופל, שכבה 5): רשת-האחסון הריבונית אבדה מהדיסק
// בנפילת סשן; שוחזרה מהיסטוריית הגיט — אבל הבטחת "התוכן על השרשרת"
// לא התקיימה מעולם (0 צ׳אנקים). שורש הכשל נתפס ותוקן (R120: באג
// עטיפת-הצ׳אנק באומדן ה-RC שמנע פרסום גם במנה מלאה), והצ׳אנק הראשון
// עלה בפועל. ההגירה נמשכת בקצב ה-RC האמיתי (כ-470M/יום).
//
// הדיבון הזה הוא לב-הפעימה של ההמשכיות: כל 45 דקות הוא מזניק את
// הראנר (כספת → שופט-שרשרת → סוכן web-publish). הסוכן עצמו
// idempotent ו-RC-gated — כשאין מנה הוא מדלג בכנות. כשהדואר ריק
// והכול שלם — הדיבון נח בשקט. אפס סודות כאן: ה-WIF חי בזיכרון
// תהליך-הבן של הראנר בלבד.
//
// חוקי-ברזל:
//   · הרצה אחת בכל פעם — אין מקביליות (הסוכן כבר נאמן, אבל סדר הוא סדר)
//   · תוצאה נרשמת בכנות — גם דילוג-RC הוא תוצאה לגיטימית, לא שגיאה
//   · פסק-זמן קשיח 6 דקות — תהליך-בן תקוע נהרג ומתועד
// ─────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import * as fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/weblift/state.json`;
const RUNNER = `${HOME}/scripts/weblift-run.ts`;
const PORT = 3039;

const POLICY = {
  liftIntervalSec: 45 * 60,
  runTimeoutMs: 6 * 60_000,
  historyTailLen: 40,
  truthSource: "scripts/weblift-run.ts → vault → chain-judge → web-publish (Steem)",
};

type Decision = { at: string; kind: string; detail: string };

type LastRun = {
  at: string;
  exitCode: number | null;
  killedByTimeout: boolean;
  summary: string | null;
  tail: string[];
};

type WebliftState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  intervalSec: number;
  alive: boolean;
  lifting: boolean;
  lastLiftAt: string | null;
  nextDueAt: string;
  lastRun: LastRun | null;
  lastDecision: Decision | null;
  historyTail: Array<Record<string, unknown>>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function freshState(): WebliftState {
  const now = new Date();
  return {
    service: "weblift",
    version: "1.0.0",
    bootedAt: now.toISOString(),
    beats: 0,
    intervalSec: POLICY.liftIntervalSec,
    alive: true,
    lifting: false,
    lastLiftAt: null,
    nextDueAt: new Date(now.getTime() + 60_000).toISOString(),
    lastRun: null,
    lastDecision: null,
    historyTail: [],
  };
}

function loadState(): WebliftState {
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as WebliftState;
    if (prev && prev.service === "weblift") {
      return {
        ...freshState(),
        bootedAt: prev.bootedAt,
        beats: prev.beats ?? 0,
        lastLiftAt: prev.lastLiftAt ?? null,
        lastRun: prev.lastRun ?? null,
        historyTail: Array.isArray(prev.historyTail) ? prev.historyTail : [],
      };
    }
  } catch {
    /* קובץ חסר/שבור — מצב חדש */
  }
  return freshState();
}

let state: WebliftState = loadState();

function saveState(): void {
  try {
    fs.mkdirSync(`${HOME}/sovereign/weblift`, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  } catch {
    /* דיסק — לא קריטי לפעימה */
  }
}

function decide(kind: string, detail: string): void {
  state.lastDecision = { at: new Date().toISOString(), kind, detail };
}

/** מפיק שורת-סיכום מפלט הסוכן — השורה החיה של מצב השרשרת */
function summarize(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /רצף \d+ צ׳אנקים · תווים (\d+)\/(\d+)/.exec(lines[i]);
    if (m) return `רצף קונטיגואלי · תווים ${m[1]}/${m[2]} על השרשרת`;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/אפס משימות ממתינות/.test(lines[i])) return "אפס משימות — ההגירה שלמה";
    if (/אין דואר נכנס/.test(lines[i])) return "אין דואר נכנס";
  }
  return null;
}

async function runLift(): Promise<void> {
  if (state.lifting) return;
  state.lifting = true;
  const tail: string[] = [];
  decide("LIFT", "מזניק את הראנר (כספת → שופט → סוכן)");
  saveState();
  try {
    const child = spawn("node", [RUNNER], {
      cwd: HOME,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let killedByTimeout = false;
    const killer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGKILL");
    }, POLICY.runTimeoutMs);
    const onLine = (buf: Buffer) => {
      for (const ln of buf.toString("utf8").split(/\r?\n/)) {
        if (!ln.trim()) continue;
        tail.push(ln.replace(/[A-Za-z0-9]{50,}/g, (h) => h.slice(0, 16) + "…"));
        if (tail.length > 120) tail.shift();
      }
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    const exitCode: number | null = await new Promise((resolve) => {
      child.on("close", (c) => resolve(c));
      child.on("error", () => resolve(1));
    });
    clearTimeout(killer);
    const run: LastRun = {
      at: new Date().toISOString(),
      exitCode,
      killedByTimeout,
      summary: summarize(tail),
      tail: tail.slice(-25),
    };
    state.lastRun = run;
    state.lastLiftAt = run.at;
    state.historyTail.push(run);
    if (state.historyTail.length > POLICY.historyTailLen) state.historyTail.shift();
    decide(
      exitCode === 0 ? "LIFT-DONE" : "LIFT-FAIL",
      run.summary ?? `יציאה ${exitCode}${killedByTimeout ? " (פסק-זמן)" : ""}`
    );
  } catch (e) {
    decide("LIFT-ERROR", String((e as Error).message ?? e).slice(0, 160));
  } finally {
    state.lifting = false;
    state.nextDueAt = new Date(Date.now() + POLICY.liftIntervalSec * 1000).toISOString();
    saveState();
  }
}

function serve(): void {
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && (url.pathname === "/lift" || url.pathname === "/")) {
        if (state.lifting) {
          return Response.json({ ok: false, error: "הרמה כבר רצה" }, { status: 409 });
        }
        void runLift();
        return Response.json({ ok: true, detail: "הרמה הוזנקה" });
      }
      const st = { ok: true, ...state, policy: POLICY, day: utcDay() };
      return Response.json(st);
    },
  });
}

function beat(): void {
  state.beats++;
  const due = !state.lifting && new Date(state.nextDueAt).getTime() <= Date.now();
  if (due) void runLift();
  saveState();
}

serve();
setInterval(beat, 30_000);
state.bootedAt = state.bootedAt || new Date().toISOString();
saveState();
console.log(`[weblift] חי על ${PORT} · קצב ${POLICY.liftIntervalSec / 60} דקות · הראנר: scripts/weblift-run.ts`);
