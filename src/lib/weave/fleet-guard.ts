// ─────────────────────────────────────────────────────────────────────
// FLEET-GUARD · שומר-הצי בתוך שרת-הרשת (D-016 · הפעלה-עצמית כפולה)
//
// הפער שנסגר כאן: keeper מסייר על הדיבונים ומחייה את השרת, אבל אם
// keeper עצמו מת — אין מי שיקים אותו עד שמפעיל יריץ daemons-revive
// ביד. החוק החדש: השרת עצמו מסייר כל 60ש' ומקים דיבון מת, כולל keeper.
// keeper מחייה את השרת · השרת מחייה את keeper. מוות-שקט אינו אפשרות.
//
// חוקי-ברזל (תואמי keeper, נלמדו בכאב):
//   · צינון 3 דק' בין הקמות לאותו דיבון
//   · חלון-גלילי: 4 הקמות לכל דיבון בכל 6 שעות — ספירלות נאסרו
//   · זמן-חסד 3 דק' לדיבון שהוקם (בוט שעוד לא עלה אינו "מת")
//   · כל הקמה נרשמת ב-ChainRun (chain="fleet", firedBy="fleet-guard")
//   · מצב חי נשמר ל-sovereign/keeper/fleet-guard-state.json
//   · לולאה-יחידה ב-globalThis (לקח R80)
//
// האמת: זהו הגנה-בעומק מאחורי keeper, לא תחליף. keeper נשאר הסמכות
// (סיור 30ש', חוקי-זומבי, קבלות לקנון); fleet-guard נכנס לפעולה רק
// כשמדידת-ה-HTTP שלו מראה מוות — ומתעד כל הכרעה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { db } from "@/lib/db";

const HOME = "/home/z/my-project";
const LOG_DIR = `${HOME}/sovereign/keeper/logs`;
const STATE_FILE = `${HOME}/sovereign/keeper/fleet-guard-state.json`;
const CYCLE_INTERVAL_MS = 60_000;
const HTTP_TIMEOUT_MS = 2_500;
const COOLDOWN_MS = 3 * 60_000;
const ROLLING_WINDOW_MS = 6 * 3_600_000;
const ROLLING_WINDOW_CAP = 4;
const BOOT_GRACE_MS = 3 * 60_000;

const DAEMONS = [
  { name: "pulse", port: 3033, dir: `${HOME}/mini-services/pulse` },
  { name: "money", port: 3034, dir: `${HOME}/mini-services/money` },
  { name: "hunter", port: 3035, dir: `${HOME}/mini-services/hunter` },
  { name: "keeper", port: 3036, dir: `${HOME}/mini-services/keeper` },
  { name: "student", port: 3037, dir: `${HOME}/mini-services/student` },
  { name: "fleet-verify", port: 3038, dir: `${HOME}/mini-services/fleet-verify` },
  { name: "weblift", port: 3039, dir: `${HOME}/mini-services/weblift` },
  { name: "curation", port: 3040, dir: `${HOME}/mini-services/curation` },
  { name: "kpi", port: 3041, dir: `${HOME}/mini-services/kpi` },
  { name: "governance", port: 3042, dir: `${HOME}/mini-services/governance` },
];

interface FleetGuardState {
  service: "fleet-guard";
  bootedAt: string;
  cycles: number;
  lastCycleAt: string | null;
  lastVerdict: string | null;
  revivesLog: Array<{ at: string; name: string; ok: boolean; detail: string }>;
}

// שומר-מצב גלובלי — חוק הלולאה-היחידה (R80)
interface GuardGlobal {
  __weaveFleetGuard?: {
    timer: ReturnType<typeof setInterval> | null;
    state: FleetGuardState;
    started: boolean;
  };
}

const g = globalThis as typeof globalThis & GuardGlobal;

function utcIso(): string {
  return new Date().toISOString();
}

function readState(): FleetGuardState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as FleetGuardState;
    if (raw && raw.service === "fleet-guard") return raw;
  } catch {}
  return {
    service: "fleet-guard",
    bootedAt: utcIso(),
    cycles: 0,
    lastCycleAt: null,
    lastVerdict: null,
    revivesLog: [],
  };
}

function writeState(s: FleetGuardState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

function appendLog(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(`${LOG_DIR}/fleet-guard.log`, `${utcIso()} ${line}\n`);
  } catch {}
}

async function httpOk(port: number): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal, cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function pidsOnPort(port: number): number[] {
  try {
    const out = spawnSync("ss", ["-tlnp", `sport = :${port}`], { encoding: "utf8" });
    return [
      ...new Set([...(out.stdout ?? "").matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))),
    ].filter((p) => Number.isFinite(p) && p > 0);
  } catch {
    return [];
  }
}

async function clearPort(port: number): Promise<void> {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1_200));
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 400));
}

function resolveBun(): string {
  const candidates = ["/usr/local/bin/bun", "/usr/bin/bun", "/home/z/.bun/bin/bun"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return "bun";
}

function spawnDaemon(d: (typeof DAEMONS)[number]): number | null {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fd = fs.openSync(`${LOG_DIR}/${d.name}-fleet-guard.log`, "a");
    const child = spawn(resolveBun(), ["--hot", "index.ts"], {
      cwd: d.dir,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

async function recordChainRun(step: string, ok: boolean, detail: string): Promise<void> {
  try {
    await db.chainRun.create({
      data: { chain: "fleet", step, firedBy: "fleet-guard", ok, detail },
    });
  } catch (e) {
    appendLog(`chainRun-write-failed step=${step} err=${e instanceof Error ? e.message : "?"}`);
  }
}

async function cycle(): Promise<void> {
  const st = g.__weaveFleetGuard;
  if (!st) return;
  st.state.cycles += 1;
  st.state.lastCycleAt = utcIso();

  const now = Date.now();
  let dead: string[] = [];
  for (const d of DAEMONS) {
    if (!(await httpOk(d.port))) dead.push(`${d.name}:${d.port}`);
  }

  if (dead.length === 0) {
    st.state.lastVerdict = "FLEET-INTACT";
    writeState(st.state);
    return;
  }

  st.state.lastVerdict = `DEAD:${dead.join(",")}`;
  appendLog(`patrol dead=[${dead.join(" ")}]`);

  for (const key of dead) {
    const name = key.split(":")[0];
    const d = DAEMONS.find((x) => x.name === name);
    if (!d) continue;

    const lastRevive = [...st.state.revivesLog].reverse().find((r) => r.name === d.name);
    if (lastRevive && now - new Date(lastRevive.at).getTime() < COOLDOWN_MS) {
      appendLog(`skip ${d.name} cooldown (${Math.round((now - new Date(lastRevive.at).getTime()) / 1000)}s)`);
      continue;
    }
    const window = st.state.revivesLog.filter(
      (r) => r.name === d.name && now - new Date(r.at).getTime() < ROLLING_WINDOW_MS,
    );
    if (window.length >= ROLLING_WINDOW_CAP) {
      appendLog(`skip ${d.name} rolling-window full (${window.length}/${ROLLING_WINDOW_CAP} in 6h)`);
      continue;
    }

    // פורט תפוס בלי מענה → ניקוי לפני הקמה (אותו חוק של daemons-revive)
    const graceOk = lastRevive && now - new Date(lastRevive.at).getTime() < BOOT_GRACE_MS;
    if (!graceOk) {
      const pids = pidsOnPort(d.port);
      if (pids.length > 0) await clearPort(d.port);
      const pid = spawnDaemon(d);
      const ok = pid != null;
      const detail = ok
        ? `fleet-guard הקים את ${d.name} (:${d.port}) pid=${pid}`
        : `fleet-guard נכשל בהקמת ${d.name}`;
      appendLog(ok ? `revive ${d.name} pid=${pid}` : `revive-failed ${d.name}`);
      st.state.revivesLog.push({ at: utcIso(), name: d.name, ok, detail });
      await recordChainRun(`auto-revive:${d.name}`, ok, detail);
    }
  }

  writeState(st.state);
}

export function startFleetGuard(): void {
  if (g.__weaveFleetGuard?.started) return;
  const state = readState();
  // שרת חדש = מופע חדש של שומר-השרת; bootedAt מרענן, ההיסטוריה נשמרת
  state.bootedAt = utcIso();
  g.__weaveFleetGuard = { timer: null, state, started: true };
  appendLog(`fleet-guard started (daemon-revival authority in-server)`);
  // הסיור הראשון אחרי 45ש' — נותן לשרת להתייצב, ולא נכנס בין עליות של dev-revive
  setTimeout(() => {
    void cycle();
    g.__weaveFleetGuard!.timer = setInterval(() => void cycle(), CYCLE_INTERVAL_MS);
  }, 45_000);
}
