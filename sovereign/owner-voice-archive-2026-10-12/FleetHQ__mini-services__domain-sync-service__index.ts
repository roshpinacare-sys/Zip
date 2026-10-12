// DOMAIN-SYNC-SERVICE — the office memory rail, as a living service.
//
// WHY (measured, trace 1a12d7c8cf024cad): the foreman (agent-hq) writes the
// office books into the Domain clone, and domain-sync.sh commits+pushes them —
// but its bash `loop` mode gets reaped by the sandbox whenever its parent
// shell exits (died twice: plain nohup AND setsid). Every bun --hot mini
// service on this host survives (recruit/selfcheck/boot-verifier evidence).
// So the loop lives as bun.
//
// WHAT: every SYNC_INTERVAL ms, spawn `domain-sync.sh once` (idempotent,
// honesty-guarded: never commits conflict markers, resolve-to-living-copy).
// Single-instance via pidfile. Fails soft and retries next tick — the office
// keeps working even when the wire is gone; memory reaches git when it's back.

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const SCRIPT = join(HERE, "..", "agent-hq", "domain-sync.sh");
const PIDFILE = join(HERE, "domain-sync-service.pid");
const LOG = join(HERE, "domain-sync.log");
const DATA_DIR = process.env.AGENT_HQ_DATA_DIR || "/home/z/estate/Domain";
const INTERVAL_MS = Number(process.env.DOMAIN_SYNC_INTERVAL || 600) * 1000;

function log(msg: string) {
  // console.log only — the service runs with stdout redirected to the log
  // file; a second appendFileSync here duplicated every line.
  console.log(`[domain-sync-service ${new Date().toISOString()}] ${msg}`);
}

// single-instance law
if (existsSync(PIDFILE)) {
  try {
    const old = Number(readFileSync(PIDFILE, "utf8").trim());
    process.kill(old, 0);
    log(`already running (pid ${old}) — exiting`);
    process.exit(0);
  } catch {
    unlinkSync(PIDFILE); // stale pidfile
  }
}
writeFileSync(PIDFILE, String(process.pid));

if (!existsSync(SCRIPT)) {
  log(`FATAL: ${SCRIPT} missing`);
  process.exit(1);
}

let running = false;
function tick() {
  if (running) {
    log("previous tick still running — skipping (no overlap)");
    return;
  }
  running = true;
  const child = spawn("bash", [SCRIPT, "once"], {
    env: { ...process.env, AGENT_HQ_DATA_DIR: DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("close", (code) => {
    running = false;
    const tail = out.split("\n").filter(Boolean).slice(-3).join(" | ");
    log(code === 0 ? `tick ok: ${tail}` : `tick exit=${code}: ${tail}`);
  });
  child.on("error", (e) => {
    running = false;
    log(`tick spawn error: ${String(e).slice(0, 120)}`);
  });
}

log(`alive — pid ${process.pid}, every ${INTERVAL_MS / 1000}s, data: ${DATA_DIR}`);
tick();
setInterval(tick, INTERVAL_MS);

process.on("uncaughtException", (e) => {
  log(`uncaught: ${String(e).slice(0, 160)}`);
});
process.on("unhandledRejection", (e) => {
  log(`rejection: ${String(e).slice(0, 160)}`);
});
