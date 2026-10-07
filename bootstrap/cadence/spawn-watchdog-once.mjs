// spawn-watchdog-once.mjs — השגרת-השומר-הריבוני לפי חוק-ההשגרה (2026-10-06):
// תהליכי-bash (nohup/setsid/disown) נקצרים-בסוף-הבקשה — ילדי-Bun.spawn
// המנותקים-לקבוצה-עצמאית שורדים. זו-התבנית-הקנונית.
import fs from "node:fs";

const SCRIPT = "/home/z/my-project/zip/bootstrap/sovereign-watchdog.mjs";
const LOG = "/home/z/fleet-tmp/logs/watchdog-boot.log";
fs.mkdirSync("/home/z/fleet-tmp/logs", { recursive: true });
const out = fs.openSync(LOG, "a");
const child = Bun.spawn({
  cmd: ["/usr/local/bin/bun", SCRIPT],
  cwd: "/home/z/my-project/zip/bootstrap",
  env: process.env,
  stdout: out,
  stderr: out,
  stdin: "ignore",
});
console.log(`spawned sovereign-watchdog detached pid=${child.pid}`);
process.exit(0);
