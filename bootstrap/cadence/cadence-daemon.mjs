/**
 * cadence-daemon.mjs — הקרון-הריבוני של הצי (במקום crontab/דקות-Actions)
 * שעתי: בדקה :17 — פעימת-תחרות + קיפול-מצב לגיט (zip).
 * יומי: 04:23Z — תחיית-כספת-האתר מהשרשרת + קיפול.
 * אידמפוטנטי, נותק (setsid), כל-כשל נרשם וממשיך.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const LOG = "/home/z/fleet-tmp/logs/cadence.log";
const log = (m) => appendFileSync(LOG, `[${new Date().toISOString()}] [daemon] ${m}\n`);

function run(mode) {
  return new Promise((resolve) => {
    const p = spawn("/bin/bash", ["/home/z/revive/sovereign-cadence.sh", mode], { stdio: "ignore", detached: false });
    p.on("exit", (c) => { log(`cadence ${mode} exit=${c}`); resolve(); });
    p.on("error", (e) => { log(`cadence ${mode} spawn-err ${e.message}`); resolve(); });
  });
}

function msUntilNextHourMinute(minute) {
  const now = new Date();
  const t = new Date(now);
  t.setUTCMinutes(minute, 0, 0);
  if (t <= now) t.setUTCHours(t.getUTCHours() + 1);
  return t - now;
}

function msUntilDaily(h, m) {
  const now = new Date();
  const t = new Date(now);
  t.setUTCHours(h, m, 0, 0);
  if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t - now;
}

log("cadence-daemon booted (hourly :17 · daily 04:23Z)");
let lastDailyDay = "";

for (;;) {
  const h = msUntilNextHourMinute(17);
  const d = msUntilDaily(4, 23);
  if (d < h) {
    await new Promise((r) => setTimeout(r, d));
    const day = new Date().toISOString().slice(0, 10);
    if (day !== lastDailyDay) { lastDailyDay = day; await run("daily"); }
    else await new Promise((r) => setTimeout(r, 60_000));
  } else {
    await new Promise((r) => setTimeout(r, h));
    await run("hourly");
  }
}
