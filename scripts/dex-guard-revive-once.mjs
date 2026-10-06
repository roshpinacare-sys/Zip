// dex-guard-revive-once.mjs — החייאה-חד-פעמית של דואג-השרשרת (:3051)
// תבנית-ההישרדות (מ-proven web-revive-once.mjs): בדיקת-TCP → אם-למטה: Bun.spawn
// detached · stdout/stderr → קובץ (לעולם לא pipe — הלקח-מ-web-revive) · exit(0) מיד.
import net from "node:net";
import fs from "node:fs";

const PORT = 3051;
const DIR = "/home/z/my-project/zip/mini-services/dex-guard";
const LOG = "/home/z/fleet-tmp/logs/dex-guard.log";

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 900).unref?.();
  });
}

const up = await portBusy(PORT);
console.log(`dex-guard :${PORT} busy=${up}`);
if (up) process.exit(0);

fs.mkdirSync("/home/z/fleet-tmp/logs", { recursive: true });
const out = fs.openSync(LOG, "a");
const child = Bun.spawn({
  cmd: ["/usr/local/bin/bun", "--hot", "index.ts"],
  cwd: DIR,
  stdout: out,
  stderr: out,
  stdin: "ignore",
});
console.log(`spawned dex-guard detached pid=${child.pid} cwd=${DIR} → ${LOG}`);
process.exit(0);
