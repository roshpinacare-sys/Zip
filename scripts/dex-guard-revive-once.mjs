// DEX-GUARD-REVIVE-ONCE — הקמת dex-guard העצמאי בהקמה-מנותקת אחת (חוק-Bun.spawn)
import net from "node:net";
import fs from "node:fs";
const PORT = 3051;
const DIR = "/home/z/my-project/zip/mini-services/dex-guard";
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
if (alive) { console.log(`dex-guard: :${PORT} עונה — אין התערבות`); process.exit(0); }
const logDir = "/home/z/my-project/sovereign/keeper/logs";
fs.mkdirSync(logDir, { recursive: true });
const out = fs.openSync(`${logDir}/dex-guard-spawn.log`, "a");
const child = Bun.spawn({ cmd: ["/usr/local/bin/bun", "--hot", "index.ts"], cwd: DIR, stdin: "ignore", stdout: out, stderr: out });
console.log(`dex-guard: הוקם (pid ${child.pid}) — דואג :3010 + בריאות :${PORT}`);
process.exit(0);
