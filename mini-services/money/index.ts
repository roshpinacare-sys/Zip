// ═══════════════════════════════════════════════════════════════════════
// dex-guard — דואג-השרשרת (חוק-השרידות 2026-10-06 · זמני בשם market-maker)
// keeper מחיה את הסלוט הזה (restartDaemon, --hot) — והקוד הזה מקים את ה-DEX.
// ה-DEX (:3010) = לב-הבית: בלעדיו אין שרשרת, אין גשר-קצה, אין עיגון.
// נמדד: node/next נשחטים בידי ה-reaper; תהליכי-bun-טהורים שורדים —
// לכן ה-DEX רץ דרך bun-runtime (--bun) כילד של ניצול-קו זה.
// לאחר-התייצבות: הקוד-האמיתי של market-maker חוזר (git checkout) והדואג
// מגיע כ-mini-service עצמאי (dex-guard) במשפחת-ה-wrapper.
// ═══════════════════════════════════════════════════════════════════════
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const DEX = "/home/z/my-project/saos-dex";
const LOG = "/home/z/fleet-tmp/logs/dex-guard.log";

function log(msg: string): void {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 900).unref?.();
  });
}
async function dexOk(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:3010/saos-dex/api/dex/state", { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}
let busy = false;
async function ensureDex(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    if (await dexOk()) return;
    log("DEX down — reviving (bun-runtime, survivor lineage)");
    const out = fs.openSync(LOG, "a");
    // מצב-פרודקשן (2026-10-06): next start — הידרציה-מובטחת-דרך-הגשר
    // (Turbopack-dev-דרך-proxy נתקע-על-CONNECTING — נמדד). אותו-DB, אותה-שרשרת.
    const child = spawn("/usr/local/bin/bun", ["--bun", "node_modules/next/dist/bin/next", "start", "-p", "3010", "-H", "127.0.0.1"], {
      cwd: DEX,
      env: { ...process.env, DATABASE_URL: "file:/home/z/my-project/saos-dex/db/dex.db", NODE_ENV: "production" },
      stdio: ["ignore", out, out],
    });
    child.on("exit", (c) => log(`dex exited code=${c}`));
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (await dexOk()) {
        log(`DEX revived (~${(i + 1) * 3}s) — poking state-route for edge bind`);
        await fetch("http://127.0.0.1:3010/saos-dex/api/dex/state?v=0").catch(() => {});
        return;
      }
    }
    log("revive round failed (120s)");
  } catch (e) {
    log(`ensureDex threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    busy = false;
  }
}
log(`dex-guard up (in money slot) pid=${process.pid}`);
void ensureDex();
setInterval(() => { void ensureDex(); }, 30_000).unref?.();
setInterval(() => { /* heartbeat — בון-טהור חי */ }, 60_000).unref?.();
