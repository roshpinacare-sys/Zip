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
// FIX(port-war-3051 · 2026-10-07): dex-grid גם יושב על 3051 (EADDRINUSE נמדד) —
// אותו-פתרון-משפחה של arbitrage r202-fix2: ברירת-מחדל קנונית 3051, אך ניתן-ל-override
// ב-env (HEALTH_PORT=3054) כדי-ששני-השירותים יחיו-יחד בלי-מלחמת-פורטים.
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 3051);

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
    // FIX(reaper-lineage · 2026-10-07): dex-guard עצמו חייב להיות-מושגר דרך
    // Bun.spawn-detached (חוק-2026-10-06 — תהליכי-bash/setsid נקצרים בסוף-הבקשה;
    // 4 מיתות נמדדו). הבן כאן: `bun --bun next start` — ההשקה-המוכחת (pid 2255
    // שרד 8 דק' כשהאב-שלו הושגר-קנונית). פורט/מארח בפקודה עצמה.
    const child = spawn("/usr/local/bin/bun", ["--bun", "node_modules/next/dist/bin/next", "start", "-p", "3010", "-H", "127.0.0.1"], {
      cwd: DEX,
      // FIX(oom-2×· 2026-10-07): תקרת-JSC-512MB — מצב-השרשרת כולו = snapshot של 250KB;
      // בלי-תקרה התהליך ניפח ל-1.9GB-RSS והקרנל OOM-kill (pid 2648 · pid 3290 — dmesg).
      env: { ...process.env, DATABASE_URL: "file:/home/z/my-project/saos-dex/db/dex.db", NODE_ENV: "production", BUN_JSC_forceRamSize: "536870912" },
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
