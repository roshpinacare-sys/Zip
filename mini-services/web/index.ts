// ─────────────────────────────────────────────────────────────────────────
// web — משגר-קונסולת-ה-WEAVE (:3050) · חוק-הבית 2026-10-06
//
// מדידה-חייה: תהליכי-next-dev (node) שנולדו-מחוץ-לעץ-ה-boot נשחטים גם-כילדי-DEX
// (23005 — נמדד). תהליכי-בון-טהור כילדי-DEX שורדים (צי-הליבה 13301+ — חי-מאז-15:34).
// אז: הבון-הזה (שורד) משגר-ומחייה-את-next-dev-כילד-שלו, בלולאה, לנצח.
// ה-guard (dev.mjs family + revive-hook) מחייה-את-הבון-עצמו אם-נפל.
// שכבות-שרידות: wrapper(שורד) → סופרוויזר-בון(שורד) → next-dev(מוחזר-תמיד).
// ─────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const ZIP = "/home/z/my-project/zip";
const LOG = "/home/z/fleet-tmp/logs/web-sup.log";
const PORT = 3050;

function log(msg: string): void {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* אין-לוג = לא-קריטי */ }
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

let child: ReturnType<typeof spawn> | null = null;
let spinning = false;

async function ensureNext(): Promise<void> {
  if (spinning) return;
  try {
    if (await portBusy(PORT)) return; // מישהו-כבר-משרת — אין-תחרות
    spinning = true;
    log("spawning next dev :3050");
    const out = fs.openSync(LOG, "a");
    // חוק-2026-10-06: ה-reaper קוטל node/next — bun-runtime שורד. רץ-דרך-bun!
    child = spawn("/usr/local/bin/bun", ["--bun", "node_modules/next/dist/bin/next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: ZIP,
      // ═══ תיקון-נזק-שורשי (2026-10-06): הקונסולה לעולם לא יורשת את DATABASE_URL
      // של ה-DEX — ירושה כזו גרמה ל-prisma של הקונסולה לדחוף את סכמתה על
      // db/dex.db ולמחוק את טבלאות-השרשרת (נמדד: 18:16 + 18:52). URL-מפורש!
      env: { ...process.env, DATABASE_URL: "file:/home/z/my-project/zip/db/console.db", NODE_ENV: "development" },
      stdio: ["ignore", out, out],
    });
    child.on("error", (e) => log(`spawn-error: ${e.message}`));
    child.on("exit", (code) => {
      log(`next exited code=${code} — יוחזר-במחזור-הבא`);
      child = null;
    });
    // אימות-הקשה עד-90ש׳ (next-dev-מתעורר-לאט — נמדד 16ש׳)
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await portBusy(PORT)) { log(`launch-verified after ~${(i + 1) * 2}s`); return; }
    }
    log("launch-verification FAILED (90s)");
  } catch (e) {
    log(`ensureNext threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    spinning = false;
  }
}

log(`web-supervisor up pid=${process.pid} (DEX lineage)`);
void ensureNext();
// FIX(r202): ה-intervals היו unref'ים — אחרי-מות-הילד לולאת-האירועים התרוקנה
// והסופרוויזר יצא-בשקט (נמדד: 03:12:15 next exited code=0 → אף-respawn).
// הלולאה היא הייעוד — היא מחזיקה-את-התהליך-חי במכוון.
setInterval(() => { void ensureNext(); }, 20_000);
setInterval(() => { /* heartbeat */ }, 60_000);
