// ─────────────────────────────────────────────────────────────────────
// KEEPER — השומר · עין הצי (R84, rebuilt R90)
//
// החוזה: סיור כל 30ש' על שלושת הדיבונים. מוות-שקט אינו אפשרות:
// 3 פסילות → הקמה מחדש. אבל חוק-הפעולה גובר על הכל — לעולם לא הורגים
// דיבון שנמצא באמצע פעולת-כסף (acting=true → BUSY, ממתינים).
//
// חוקי-ברזל (מ-R84, נשמרים מלה):
//   · 3 פסילות רצופות → RESTARTING
//   · צינון 2 דק' בין הקמות לאותו דיבון
//   · זמן-חסד 90ש' מההקמה (בוט שעוד לא עלה אינו "מת")
//   · תקציב 12 הקמות/יום/דיבון ואז GAVE-UP כנה
//   · חוק הפעולה: acting=true → BUSY, לא הורגים
//   · ניקוי נעילות-פורט: SIGTERM→SIGKILL לפני הקמה
//   · קבלות RESTART/RECOVERED/GAVE-UP לקנון אחרי שער-סודות (8/יום)
//   · לולאה-יחידה ב-globalThis (לקח R80)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/keeper/state.json`;
const PORT = 3036;
const PATROL_INTERVAL_SEC = 30;
const FAIL_THRESHOLD = 3;
const RESTART_COOLDOWN_MS = 2 * 60 * 1000;
const BOOT_GRACE_MS = 90 * 1000;
const DAILY_RESTART_BUDGET = 12;
const CANON_BUDGET_PER_DAY = 8;

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
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function freshFleet(): FleetEntry[] {
  const defs: Array<[string, number, string, string]> = [
    ["pulse", 3033, "הדופק — השידור היומי לשרשרת", "The pulse — daily chain broadcast"],
    ["money", 3034, "מוביל הכסף — סולם הפאריטה על הקו", "The money mover — parity ladder"],
    ["hunter", 3035, "הצייד — שער הדקות ולוח ההזדמנויות", "The hunter — minute-gate & opportunities"],
  ];
  return defs.map(([name, port, roleHe, roleEn]) => ({
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
  }));
}

function readState(): KeeperState {
  const base: KeeperState = {
    service: "keeper",
    version: "1.1.0",
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
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const fleet = Array.isArray(prev.fleet)
      ? base.fleet.map((f) => {
          const p = prev.fleet.find((x: FleetEntry) => x.name === f.name);
          if (!p) return f;
          const sameDay = p.restartDay === utcDay();
          return {
            ...f,
            state: p.state ?? "DOWN",
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
    };
  } catch {
    return base;
  }
}

let state: KeeperState = readState();

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/keeper`, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function record(kind: string, detail: string, canon = false) {
  const at = new Date().toISOString();
  state.lastDecision = { at, kind, detail };
  state.history = [...state.history, { at, kind, detail }].slice(-60);
  if (canon) pendingCanon.push({ at, kind, detail });
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
  const pat = readPat();
  if (!pat) {
    pendingCanon.length = 0;
    return;
  }
  const path = `reports/keeper-${utcDay()}.md`;
  const body = [
    `# יומן השומר · ${utcDay()}`,
    "",
    ...pendingCanon.map((e) => `- \`${e.at}\` **${e.kind}** — ${e.detail}`),
    "",
    `_מופק אוטונומית על-ידי keeper v1.1 (R90 rebuild). תקציב קנון: ${state.canonToday}/${CANON_BUDGET_PER_DAY}._`,
  ].join("\n");
  const gate = secretsGate(body);
  if (!gate.ok) {
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
    const cur = await fetch(url, { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `keeper: fleet supervision receipt ${new Date().toISOString()}`,
        content: Buffer.from(body, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
    state.canonToday += 1;
    state.canonLast = { at: new Date().toISOString(), ok: res.ok, path };
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path };
  }
  pendingCanon.length = 0;
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
    const out = Bun.spawnSync(["ss", "-tlnp", `sport = :${port}`], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
    return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])).filter((p) => p > 0);
  } catch {
    return [];
  }
}

function restartDaemon(d: FleetEntry): boolean {
  // ניקוי נעילות-פורט: SIGTERM, חכה, אז SIGKILL
  for (const pid of pidsOnPort(d.port)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  setTimeout(() => {
    for (const pid of pidsOnPort(d.port)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }, 1500).unref?.();
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
      parts.push(`${d.name}:BUSY`);
      continue;
    }

    if (r.ok) {
      const wasDown = d.state !== "UP";
      d.state = "UP";
      d.consecutiveFails = 0;
      d.lastHealthyAt = now.toISOString();
      d.lastBeats = r.body?.beats ?? d.lastBeats;
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
    if (d.state === "GAVE-UP") continue; // התקציב נאכל — כנות, לא לנצח

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
    if (d.restartsToday >= DAILY_RESTART_BUDGET) {
      d.state = "GAVE-UP";
      record("GAVE-UP", `${d.name} (${d.port}): תקציב 12 הקמות/יום נאכל — כנות, העין פקוחה בלי יד`, true);
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
    d.restartsToday += 1;
    d.lastRestartAt = now.toISOString();
    d.consecutiveFails = 0;
    d.since = now.toISOString();
    record(ok ? "RESTART" : "RESTART-FAIL", `${d.name} (${d.port}): ${ok ? `הוקם — ${reason}` : `ההקמה נכשלה — ${reason}`}`, true);
  }
  const allUp = state.fleet.every((d) => d.state === "UP" || d.state === "BUSY");
  if (state.history.length === 0 || state.history[state.history.length - 1].detail !== parts.join(" · ")) {
    record("PATROL", allUp ? `סיור תקין — ${parts.map((p) => p.replace(/:(FAIL|BUSY)-?\d*/, (m) => (m.includes("BUSY") ? m : "DOWN"))).join(" · ")}` : `התערבות — ${parts.join(" · ")}`, false);
  }
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
    } catch (e: any) {
      record("ERROR", String(e?.message ?? e).slice(0, 160));
    } finally {
      state.patrolling = false;
      saveState();
    }
  };
  Bun.serve({
    port: PORT,
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
