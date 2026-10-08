#!/usr/bin/env bun
// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN-WATCHDOG — השומר-הריבוני (Task 11 · הוראת-המפעיל:
// "וודא שזה נשאר חי — הכל מנוהל על-ידי האוטונומיה, בלעדיי")
//
// כל 5 דקות:
//   · 21 איברי-הצי (טבלת-צי אחת עם הריבייב; kind: bun|python|dex-guard)
//   · dex :3010 (next start) · הקונסולה :3000 (next dev)
//   · cadence-daemon (pgrep → השגרה מהעותק-שבגיט)
//
// חוקים: אף-שירות-עונה-לא-נוגעים-בו · אף-סוד-לא-נדפס · כל-כשל-נרשם-וממשיך ·
//         idempotent (ריצה-כפולה-בטוחה) · gitsafety-ב-spawn של dex-guard.
//
// Usage:
//   bun bootstrap/sovereign-watchdog.mjs           ← לולאה-נצחית (via spawn-watchdog-once)
//   bun bootstrap/sovereign-watchdog.mjs --once    ← סבב-אחד (מדווח-בלבד, אפס-השגרה)
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLEET, CONSOLE, SPECIAL } from "./fleet-table.mjs";

const MP = process.env.BOOTSTRAP_MYPROJECT ?? "/home/z/my-project";
const H = process.env.BOOTSTRAP_HOME ?? "/home/z";
const LOG_DIR = process.env.FLEET_LOG_DIR ?? "/home/z/fleet-tmp/logs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ONCE = process.argv.includes("--once");
const INTERVAL_MS = 5 * 60_000;

const bunBin =
  typeof Bun !== "undefined" && process.execPath.includes("bun")
    ? process.execPath
    : "/usr/local/bin/bun";

fs.mkdirSync(LOG_DIR, { recursive: true });
const logFd = fs.openSync(path.join(LOG_DIR, "watchdog.log"), "a");
function log(msg = "") {
  const line = `[${new Date().toISOString()}] [watchdog] ${msg}`;
  try { fs.writeSync(logFd, line + "\n"); } catch {}
  if (ONCE) console.log(msg);
}

// ─── ledger-מצב (counters מצטברים — כנות-ארוכת-טווח) ────────────────────────
const STATE_FILE = path.join(LOG_DIR, "watchdog-state.json");
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { revives: {}, since: new Date().toISOString() }; }
}
function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {} }

// ─── עזרי-רשת (זהים-לריבייב) ────────────────────────────────────────────────
function tcpAlive(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

async function httpOk(port, paths = ["/health", "/"], timeoutMs = 2500) {
  for (const p of paths) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: ctl.signal, cache: "no-store" });
      if (r.ok) return true;
    } catch {} finally { clearTimeout(t); }
  }
  return false;
}

function pidsOnPort(port) {
  try {
    const out = Bun.spawnSync(["ss", "-tlnp", `sport = :${port}`], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
    return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))].filter((p) => Number.isFinite(p) && p > 0);
  } catch { return []; }
}

async function killPort(port) {
  // חוק-ריבייב: ניקוי רק-פורט-נעול (TCP-בלי-HTTP) — לעולם-לא-שירות-עונה
  const pids = pidsOnPort(port);
  if (!pids.length) return;
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
  await new Promise((r) => setTimeout(r, 1200));
  for (const pid of pidsOnPort(port)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  await new Promise((r) => setTimeout(r, 400));
}

// ─── השגרה (תבנית-detached-spawn הקנונית) ───────────────────────────────────
function spawnDetached(name, cmd, { cwd, env = {} } = {}) {
  const logFile = path.join(LOG_DIR, `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  fs.writeSync(fd, `\n==== watchdog-spawn ${new Date().toISOString()} · ${cmd.join(" ")} · cwd=${cwd} ====\n`);
  const child = Bun.spawn({ cmd, cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: fd, stderr: fd });
  log(`  ↑ ${name} הושגר pid=${child.pid} → ${logFile}`);
  return child.pid;
}

function pythonBin() {
  for (const p of ["/home/z/.venv/bin/python3", "/usr/bin/python3"]) if (fs.existsSync(p)) return p;
  return "python3";
}

// ─── ריפוי-איבר-צי (kind: bun|python|dex-guard) ─────────────────────────────
async function reviveDaemon(svc, state) {
  if (svc.kind === "python") {
    const cwd = `${MP}/mini-services/${svc.dir}`;
    if (!fs.existsSync(path.join(cwd, "server.py"))) return "NO-SOURCE";
    spawnDetached(svc.name, [pythonBin(), "-u", "server.py"], { cwd });
    state.revives[svc.name] = (state.revives[svc.name] ?? 0) + 1;
    return "REVIVED";
  }
  if (svc.kind === "dex-guard") {
    const cwd = `${MP}/zip/mini-services/${svc.dir}`;
    if (!fs.existsSync(path.join(cwd, "index.ts"))) return "NO-SOURCE";
    spawnDetached(svc.name, [bunBin, "index.ts"], {
      cwd,
      env: { HEALTH_PORT: String(svc.port), PATH: `${MP}/zip/bootstrap/bin:${process.env.PATH ?? ""}` },
    });
    state.revives[svc.name] = (state.revives[svc.name] ?? 0) + 1;
    return "REVIVED";
  }
  const cwd = `${MP}/zip/mini-services/${svc.dir}`;
  if (!fs.existsSync(path.join(cwd, "index.ts"))) return "NO-SOURCE";
  spawnDetached(svc.name, [bunBin, "--hot", "index.ts"], { cwd });
  state.revives[svc.name] = (state.revives[svc.name] ?? 0) + 1;
  return "REVIVED";
}

// ─── ריפוי-קונסולה (דוקטרינת-הקצה: :3000 = גשר-התצוגה בתוך תהליך-ה-DEX) ──
// נמדד (Task 12-אודיט): :3000 אינו next-dev של my-project — הוא preview-bridge
// שנקשר בתוך תהליך ה-DEX החי (saos-dex/src/lib/dex/preview-bridge.ts) ומנתב
// /saos-dex→3010 · rest→3050. השגרת bun-run-dev של my-project על :3000 הייתה
// מצלילה את הגשר. הריפוי הנכון: לחתור ל-/api/revive של ה-DEX (וו-ההחיה הרשמי
// שמשגר משושלת-ההישרדות), ואם ה-DEX מת — השגרת-DEX טרייה שמקשרת-מחדש את
// הגשר-על-:3000 כשהפורט-פנוי.
async function reviveConsole(state) {
  if (await httpOk(SPECIAL.dex.port, SPECIAL.dex.paths)) {
    // ה-DEX חי — לחיצה-על-הוו-הרשמי שלו (משגר-משושלת-ההישרדות)
    try {
      const r = await fetch(`http://127.0.0.1:${SPECIAL.dex.port}/api/revive`, { signal: AbortSignal.timeout(8000) });
      log(`  ↑ dex /api/revive → HTTP ${r.status}`);
    } catch (e) { log(`  ⚠ dex /api/revive נכשל: ${String(e?.message ?? e).slice(0, 80)}`); }
    state.revives["edge-console"] = (state.revives["edge-console"] ?? 0) + 1;
    return "REVIVED-VIA-DEX-HOOK";
  }
  // DEX מת — השגרה טרייה: הוא מקשר גם :3010 וגם את הגשר-על-:3000 (אם-פנוי)
  spawnDetached("dex-3010", [bunBin, "--bun", "node_modules/next/dist/bin/next", "start", "-p", "3010", "-H", "127.0.0.1"], { cwd: `${MP}/saos-dex` });
  state.revives["edge-dex"] = (state.revives["edge-dex"] ?? 0) + 1;
  return "REVIVED-FRESH-DEX";
}

// ─── cadence (pgrep → השגרה מהעותק-שבגיט) ──────────────────────────────────
function procAlive(pattern) {
  try {
    const out = Bun.spawnSync(["pgrep", "-f", pattern], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
    return out.trim().length > 0;
  } catch { return false; }
}

function reviveCadence(state) {
  // מקור-אמת = הגיט; /home/z/revive הוא בית-הריצה (מסונכרן ממנו בכל-השגרה)
  const gitCopy = path.join(HERE, "cadence", "cadence-daemon.mjs");
  const runHome = path.join(H, "revive", "cadence-daemon.mjs");
  fs.mkdirSync(path.dirname(runHome), { recursive: true });
  try { fs.copyFileSync(gitCopy, runHome); fs.chmodSync(runHome, 0o755); } catch {}
  spawnDetached("cadence-daemon", [bunBin, runHome], { cwd: H });
  state.revives["cadence-daemon"] = (state.revives["cadence-daemon"] ?? 0) + 1;
  return "REVIVED";
}

// ─── סבב-שומר-אחד ────────────────────────────────────────────────────────────
async function round() {
  const state = loadState();
  const actions = [];
  for (const svc of FLEET) {
    if (await httpOk(svc.port, ["/health", "/"])) continue;
    if (await tcpAlive(svc.port)) {
      log(`⚠ ${svc.name} (:${svc.port}) נעול — מנקה-ומשגר`);
      if (!ONCE) await killPort(svc.port);
      actions.push(`${svc.name}:WEDGED`);
    } else {
      log(`✗ ${svc.name} (:${svc.port}) מת — משגר-מחדש`);
    }
    if (!ONCE) actions.push(`${svc.name}:${await reviveDaemon(svc, state)}`);
    else actions.push(`${svc.name}:WOULD-REVIVE`);
  }
  // dex (:3010) — התהליך-הזה מארח-גם-את-גשר-:3000 — אסור-להרוג-פורט-נעול!
  if (!(await httpOk(SPECIAL.dex.port, SPECIAL.dex.paths))) {
    if (await tcpAlive(SPECIAL.dex.port)) {
      log(`⚠ dex :3010 נעול (TCP-בלי-HTTP) — לא-נוגעים: התהליך מארח-את-גשר-:3000; מדווח-בכנות`);
      actions.push("dex:WEDGED-COHOST");
    } else {
      const buildId = `${MP}/saos-dex/.next/BUILD_ID`;
      if (!fs.existsSync(buildId)) {
        log(`✗ dex :3010 מת ו-.next/BUILD_ID חסר — BUILD-MISSING (הריבייב-המלא-יבנה)`);
        actions.push("dex:BUILD-MISSING");
      } else {
        log(`✗ dex :3010 מת — משגר next start`);
        if (!ONCE) {
          spawnDetached("dex-3010", [bunBin, "--bun", "node_modules/next/dist/bin/next", "start", "-p", "3010", "-H", "127.0.0.1"], { cwd: `${MP}/saos-dex` });
          state.revives["dex"] = (state.revives["dex"] ?? 0) + 1;
          actions.push("dex:REVIVED");
        } else actions.push("dex:WOULD-REVIVE");
      }
    }
  }
  // קונסולה (:3000) — הגשר מארח-בתוך-ה-DEX: אסור-להרוג-פורט-נעול-כאן!
  if (!(await httpOk(CONSOLE.port, ["/api/health", "/"]))) {
    if (await tcpAlive(CONSOLE.port)) log(`⚠ קונסולה :3000 נעולה (TCP-בלי-HTTP) — לא-נוגעים (גשר-מארח-דקס); מדווח-בכנות`);
    else log(`✗ קונסולה :3000 מתה — ריפוי-לפי-דוקטרינת-הקצה`);
    if (!ONCE) { const how = await reviveConsole(state); actions.push(`console:${how}`); }
    else actions.push("console:WOULD-REVIVE");
  }
  // cadence-daemon
  if (!procAlive("cadence-daemon.mjs")) {
    log(`✗ cadence-daemon מת — משגר-מחדש (מהגיט)`);
    if (!ONCE) { reviveCadence(state); actions.push("cadence:REVIVED"); }
    else actions.push("cadence:WOULD-REVIVE");
  }
  state.lastRound = new Date().toISOString();
  state.lastActions = actions;
  saveState(state);
  log(actions.length ? `סבב-הסתיים: ${actions.join(" · ")}` : "סבב-נקי — הצי 100% חי");
  return actions;
}

log(ONCE ? "ריצת-בדיקה (--once)" : "השומר-הריבוני חי — כל 5 דקות");
if (ONCE) {
  await round();
} else {
  for (;;) {
    try { await round(); } catch (e) { log(`round-err: ${e?.message ?? e}`); }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
