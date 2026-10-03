// fleet-manifests-audit.mjs — r164
// Declared-vs-actual audit of the fleet manifest of record
// (sovereign/fleet/fleet.yaml, modeled on ax.io/v1alpha1).
// Evidence: probes each declared port/healthPath, maps listeners to pids,
// reads per-process RSS from /proc, scans 3000-3060 for undeclared listeners
// (manifest drift), writes sovereign/fleet/audit-latest.json.
// Exit code: 0 = no violations against declared phases; 1 = violations.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseAllDocuments } from "yaml";
import { execSync } from "node:child_process";

const ROOT = "/home/z/my-project";
const MANIFEST = `${ROOT}/sovereign/fleet/fleet.yaml`;
const OUT = `${ROOT}/sovereign/fleet/audit-latest.json`;

const docs = parseAllDocuments(readFileSync(MANIFEST, "utf8"))
  .map((d) => d.toJSON())
  .filter(Boolean);
const declared = docs.filter((d) => d.kind === "FleetService");

// --- listeners: map port -> {pid, rssMB} -------------------------------------
let listeners = new Map(); // port -> {pid, rssMB}
try {
  const ss = execSync("ss -ltnp", { encoding: "utf8" });
  const pidByPort = new Map();
  for (const line of ss.split("\n")) {
    const pm = line.match(/:(\d{4,5})\b/);
    const pidm = line.match(/pid=(\d+)/);
    if (pm && pidm) pidByPort.set(Number(pm[1]), Number(pidm[1]));
  }
  for (const [port, pid] of pidByPort) {
    let rssMB = null;
    try {
      const st = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = st.match(/VmRSS:\s+(\d+) kB/);
      if (m) rssMB = Math.round(Number(m[1]) / 1024);
    } catch { /* process vanished */ }
    listeners.set(port, { pid, rssMB });
  }
} catch (e) {
  console.error("ss scan failed:", e.message);
}

// --- probe health -------------------------------------------------------------
async function probe(port, path) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3500);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ac.signal });
    clearTimeout(t);
    return res.ok ? "alive" : `http-${res.status}`;
  } catch {
    return "dead";
  }
}

const rows = [];
for (const svc of declared) {
  const { port, healthPath = "/health" } = svc.spec;
  const declaredLimit = svc.spec.resources?.limits?.memoryMB ?? null;
  const actual = listeners.get(port) || null;
  const state = await probe(port, healthPath);
  const rssMB = actual?.rssMB ?? null;
  let verdict;
  if (svc.metadata.name === "decision-brain") {
    verdict = state === "alive" ? "ok-suspended-idle" : "dead";
  } else if (svc.spec.phase === "Running") {
    verdict = state === "alive" ? "ok" : "VIOLATION-declared-running-but-dead";
  } else {
    verdict = state === "alive" ? "ok" : `ok-${String(svc.spec.phase).toLowerCase()}`;
  }
  const overLimit = rssMB != null && declaredLimit != null && rssMB > declaredLimit;
  rows.push({
    name: svc.metadata.name,
    port,
    declaredPhase: svc.spec.phase,
    declaredMemoryLimitMB: declaredLimit,
    actualHealth: state,
    pid: actual?.pid ?? null,
    rssMB,
    memoryVerdict: overLimit ? "VIOLATION-over-limit" : "within-or-unknown",
    suspendPolicy: svc.spec.suspendPolicy ?? null,
    verdict,
  });
}

// --- undeclared listeners in the fleet port band (manifest drift) -------------
const declaredPorts = new Set(declared.map((d) => d.spec.port));
const undeclared = [...listeners.keys()]
  .filter((p) => p >= 3000 && p <= 3060 && !declaredPorts.has(p))
  .map((p) => ({ port: p, pid: listeners.get(p).pid, rssMB: listeners.get(p).rssMB }));

const violations = rows.filter((r) => r.verdict.startsWith("VIOLATION") || r.memoryVerdict.startsWith("VIOLATION"));
const report = {
  schema: "fleet-audit-v1",
  auditedAt: new Date().toISOString(),
  declaredServices: rows.length,
  alive: rows.filter((r) => String(r.actualHealth).startsWith("alive") || r.actualHealth.startsWith("http-2")).length,
  violations: violations.length,
  undeclaredListeners: undeclared,
  services: rows,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  auditedAt: report.auditedAt,
  declared: report.declaredServices,
  alive: report.alive,
  violations: report.violations,
  undeclaredListeners: undeclared.length,
}, null, 1));
for (const r of rows) {
  console.log(`${r.verdict.padEnd(38)} ${String(r.name).padEnd(16)} :${r.port} phase=${r.declaredPhase} health=${r.actualHealth} rss=${r.rssMB ?? "?"}MB limit=${r.declaredMemoryLimitMB ?? "?"}MB`);
}
if (undeclared.length) console.log("UNDECLARED LISTENERS:", JSON.stringify(undeclared));
process.exit(violations.length ? 1 : 0);
