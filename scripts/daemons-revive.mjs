#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// DAEMONS-REVIVE — החזרת הצי לחיים בפקודה אחת (R84).
//
// האמת: הדיבונים חיים בסשן הסנדבוקס הארעי בלבד. כשסשן מת — הצי מת
// איתו, ובלי עין הכסף חוזר לשבת על מחיר אתמול ("גרוע מאוד").
//
// החוק שנקבע ב-R84: כל סשן חדש מרים את הצי בפקודה אחת:
//
//     bun run scripts/daemons-revive.mjs
//
// הסקריפט אידמפוטנטי לחלוטין — אפשר להריץ כמה פעמים שרוצים:
//   · דיבון שעונה כבר — לא נוגעים בו (אין כפילויות לעולם).
//   · דיבון שמת — פורט ריק — מוקם מחדש.
//   · דיבון נעול — פורט תפוס בלי מענה — מנוקה ואז מוקם.
//   · בסוף: בדיקת-בריאות של כל הצי ודוח כנה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import net from "node:net";

const HOME = "/home/z/my-project";

const DAEMONS = [
  { name: "pulse", port: 3033, dir: `${HOME}/mini-services/pulse` },
  { name: "money", port: 3034, dir: `${HOME}/mini-services/money` },
  { name: "hunter", port: 3035, dir: `${HOME}/mini-services/hunter` },
  { name: "keeper", port: 3036, dir: `${HOME}/mini-services/keeper` },
  { name: "student", port: 3037, dir: `${HOME}/mini-services/student` },
];

function httpOk(port, timeoutMs = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal, cache: "no-store" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => clearTimeout(t));
}

function tcpAlive(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

function pidsOnPort(port) {
  try {
    const out = Bun.spawnSync(["ss", "-tlnp", `sport = :${port}`], {
      stdout: "pipe",
      stderr: "pipe",
    }).stdout.toString();
    return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))].filter(
      (p) => Number.isFinite(p) && p > 0,
    );
  } catch {
    return [];
  }
}

async function killPort(port) {
  const pids = pidsOnPort(port);
  if (pids.length === 0) return;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1200));
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 400));
}

function spawnDaemon(d) {
  const logDir = `${HOME}/sovereign/keeper/logs`;
  fs.mkdirSync(logDir, { recursive: true });
  const fd = fs.openSync(`${logDir}/${d.name}-revive.log`, "a");
  // R90 fix: 'bun' is not always in PATH of the dev-server child env —
  // process.execPath is the absolute bun binary that is running right now.
  const proc = Bun.spawn({
    cmd: [process.execPath, "--hot", "index.ts"],
    cwd: d.dir,
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
  });
  return proc.pid;
}

async function main() {
  console.log("── DAEMONS-REVIVE · החזרת הצי לחיים ──");
  const started = [];
  const kept = [];
  const wedged = [];

  for (const d of DAEMONS) {
    if (await httpOk(d.port)) {
      kept.push(d.name);
      console.log(`  ✓ ${d.name} (:${d.port}) כבר חי — לא נוגעים`);
      continue;
    }
    if (await tcpAlive(d.port)) {
      console.log(`  ⚠ ${d.name} (:${d.port}) נעול (פורט תפוס, אין מענה) — מנקה`);
      await killPort(d.port);
      wedged.push(d.name);
    }
    const pid = spawnDaemon(d);
    started.push(d.name);
    console.log(`  ↑ ${d.name} (:${d.port}) הוקם (pid ${pid})`);
  }

  // זמן עלייה — עד 20 שנ' סה"כ
  const deadline = Date.now() + 20_000;
  const pending = new Set(started);
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    for (const name of [...pending]) {
      const d = DAEMONS.find((x) => x.name === name);
      if (d && (await httpOk(d.port, 2000))) pending.delete(name);
    }
  }

  console.log("── דוח בריאות הצי ──");
  let allUp = true;
  for (const d of DAEMONS) {
    const up = await httpOk(d.port, 2000);
    if (!up) allUp = false;
    console.log(`  ${up ? "✓" : "✗"} ${d.name} (:${d.port}) ${up ? "UP" : "DOWN"}`);
  }
  console.log(
    allUp
      ? `── הצי שלם: ${DAEMONS.length}/${DAEMONS.length} דיבונים חיים · השומר על הצי מעכשיו ──`
      : "── אזהרה כנה: לא כל הצי עלה — ראה שורות ✗ למעלה ──",
  );
  process.exit(allUp ? 0 : 1);
}

await main();
