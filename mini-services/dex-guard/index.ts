// ═══════════════════════════════════════════════════════════════════════
// dex-guard — דואג-השרשרת (r210 · העצמאות: Task 10 הוראת-הבעלים "כסף-אמיתי")
// עד-היום ישב-בסלוט-money ובסלוט-mm (זמני). עתה: שירות-עצמאי עם פורט-בריאות
// 3051 — keeper מפקח-עליו-ישירות, והסלוטים חוזרים לבעליהם האמיתיים
// (money-mover :3034 · market-maker :3049).
// ═══════════════════════════════════════════════════════════════════════
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const DEX = "/home/z/my-project/saos-dex";
const LOG = "/home/z/fleet-tmp/logs/dex-guard.log";
const HEALTH_PORT = 3051;

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
let revives = 0;
async function ensureDex(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    if (await dexOk()) return;
    log("DEX down — reviving (bun-runtime, survivor lineage)");
    revives++;
    const out = fs.openSync(LOG, "a");
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
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};
const G = globalThis as unknown as { __DEXGUARD_SRV__?: unknown };
if (!G.__DEXGUARD_SRV__) {
  G.__DEXGUARD_SRV__ = Bun.serve({
    port: HEALTH_PORT,
    hostname: "127.0.0.1",
    fetch() {
      return Response.json({ ok: true, alive: true, service: "dex-guard", guarding: ":3010", revives, now: new Date().toISOString() });
    },
  });
}
log(`dex-guard up (own service :${HEALTH_PORT}) pid=${process.pid}`);
void ensureDex();
setInterval(() => { void ensureDex(); }, 30_000).unref?.();
