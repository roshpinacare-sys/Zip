#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// WEB-REVIVE-ONCE — הקמת סופרוויזר-הקונסולה (:3050) בהקמה-מנותקת אחת.
// חוק-2026-10-06: תהליכים מבקשת-bash נקצרים בסופה; ילדי-Bun.spawn
// (כמו ילדי keeper/daemons-revive) שורדים. הסקריפט הזה הוא הדרך
// הקנונית להקים את mini-services/web מבלי-למות-עמו.
// אידמפוטנטי: אם פורט 3050 עונה — לא נוגעים.
// ─────────────────────────────────────────────────────────────────────
import net from "node:net";

const PORT = 3050;
const DIR = "/home/z/my-project/mini-services/web";

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

const alive = await tcpAlive(PORT);
if (alive) {
  console.log(`web: :${PORT} עונה — אין התערבות`);
  process.exit(0);
}
// חוק-Task 9: הילד חייב לכתוב לקובץ — לא לירוש pipe של המפעיל,
// אחרת הוא מחזיק-אותו-פתוח והמפעיל-נתלה (נמדד: timeout-120ש').
import fs from "node:fs";
const logDir = "/home/z/my-project/sovereign/keeper/logs";
fs.mkdirSync(logDir, { recursive: true });
const out = fs.openSync(`${logDir}/web-sup-spawn.log`, "a");
const child = Bun.spawn({
  cmd: ["/usr/local/bin/bun", "--hot", "index.ts"],
  cwd: DIR,
  stdin: "ignore",
  stdout: out,
  stderr: out,
});
console.log(`web: סופרוויזר הוקם (pid ${child.pid}) — יקים next-dev :${PORT} כילד-שלו`);
process.exit(0);
