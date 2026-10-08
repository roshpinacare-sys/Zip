import { NextResponse } from "next/server";
import fs from "node:fs";
import net from "node:net";
import { execSync } from "node:child_process";

export const dynamic = "force-dynamic";

// GET /api/watchdog — מצב-השומר-הריבוני (ליבת-האוטונומיה · Task 11)
// קורא את ledger-המצב של sovereign-watchdog.mjs (counters-ריפוי + סבב-אחרון)
// ובודק-חיות: השומר-עצמו · cadence · פורטים-מרכזיים. כנות-מלאה — אפס-קישוט.

function procAlive(pattern: string): boolean {
  try {
    const out = execSync(`pgrep -f "${pattern}"`, { encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function tcpAlive(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

export async function GET() {
  const stateFile = "/home/z/fleet-tmp/logs/watchdog-state.json";
  const logFile = "/home/z/fleet-tmp/logs/watchdog.log";
  let state: Record<string, unknown> | null = null;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {}

  let logTail: string[] = [];
  try {
    logTail = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-12);
  } catch {}

  const procs: Record<string, { ok: boolean; detail: string }> = {
    watchdog: { ok: procAlive("sovereign-watchdog.mjs"), detail: "השומר-הריבוני (self-healing כל 5 דקות)" },
    cadence: { ok: procAlive("cadence-daemon.mjs"), detail: "הקצב-הריבוני (שעתי :17 · יומי 04:23Z)" },
  };
  const ports: Record<string, boolean> = {
    console: await tcpAlive(3000),
    dex: await tcpAlive(3010),
    decisionBrain: await tcpAlive(3047),
    fleetSample: await tcpAlive(3033),
  };

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    law: "הוראת-המפעיל: 'הכל מנוהל על-ידי האוטונומיה — וודא שזה נשאר חי בלי תלות בסנדבוקס'",
    kernel: {
      watchdogAlive: procs.watchdog.ok,
      cadenceAlive: procs.cadence.ok,
      intervalMin: 5,
      coverage: "21 דיבוני-צי + dex + קונסולה + cadence — מת/נעול → השגרה-אוטונומית",
    },
    state,
    procs,
    ports,
    logTail,
  });
}
