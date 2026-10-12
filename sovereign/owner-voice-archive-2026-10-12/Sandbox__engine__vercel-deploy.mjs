#!/usr/bin/env node
/**
 * vercel-deploy.mjs — בית-חי-שני-לקוקפיט (T-54 · trace 1a124659eb347631)
 * ═════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה: הקוקפיט-חי-ב-GitHub-Pages — בית-אחד. GitHub-נופל → המפעיל-נשאר
 * בלי-שער. Vercel-הוא-הבית-השני: אותו-קוד, אותו-ciphertext-ציבורי, דומיין-עצמאי.
 * השלישות: Pages + vercel.app + localhost:3000 — אפס-רגל-יחידה.
 *
 * מה-הוא-עושה:
 *   1. מארוז-את-docs/ (6-קבצים, ~120K) — base64-inline, אפס-בנייה (סטטי-טהור)
 *   2. idempotent: ראש-Sandbox-זהה-לפריסה-המאומתת-הקודמת → דילוג-כנה
 *   3. POST /v13/deployments (framework=null → סטטי) → poll עד READY (≤2-דק')
 *   4. גילוי-דומיין: deployment.alias (העדפת-הדומיין-היציב) → מדידת-200
 *   5. קבלה: receipts/vercel-deploy.jsonl (tail-256, ממוסך)
 *
 * סוד: אפס. הטוקן-בסביבת-התהליך · התוכן-ציבורי-כבר-היום (Pages) — אפס-חשיפה-חדשה.
 * CSP-נוסע-עם-ה-HTML (meta) — זהה-בשני-הבתים.
 * יציאה: 0 = חי-ומאומת (או-דילוג-כנה) · 1 = כשל-כנה (fail-closed).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R_DIR = path.join(ROOT, "receipts");
const DEPLOY_LOG = path.join(R_DIR, "vercel-deploy.jsonl");
const TAIL = 256;
const API = "https://api.vercel.com";
const PROJECT = process.env.VERCEL_PROJECT || "sovereign-cockpit";
const DOCSDIR = process.env.COCKPIT_DOCS || path.join(ROOT, "docs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = process.env.VERCEL_TOKEN || "";
if (!TOKEN) {
  console.log("[vercel-deploy] no VERCEL_TOKEN in environment (honest) — open the vault keys first");
  process.exit(1);
}
if (!fs.existsSync(path.join(DOCSDIR, "index.html"))) {
  console.log(`[vercel-deploy] no cockpit at ${DOCSDIR}/index.html (honest)`);
  process.exit(1);
}

const is2xx = (s) => s >= 200 && s < 300;

/** curl-יחידה — הטוקן-דרך-stdin-בלבד (חוק-העורקים). גוף-גדול → רק-fetch (כנה). */
function curlOnce(method, p, body = null) {
  if (body && JSON.stringify(body).length > 4096) return { status: 0, body: null };
  const cfg = [`header = "Authorization: Bearer ${TOKEN}"`, `request = ${method}`, `url = "${API}${p}"`];
  if (body) cfg.push(`data = ${JSON.stringify(JSON.stringify(body)).slice(1, -1).replace(/"/g, '\\"')}`, 'header = "Content-Type: application/json"');
  const r = spawnSync("curl", ["-sS", "--max-time", "30", "-w", "\n%{http_code}", "-K", "-"], {
    input: cfg.join("\n") + "\n",
    encoding: "utf8",
    timeout: 40000,
  });
  const out = (r.stdout || "").trim();
  const m = out.match(/(\d{3})$/);
  const http = m ? parseInt(m[1], 10) : 0;
  const jsonPart = m ? out.slice(0, m.index).trim() : out;
  let j = null;
  try { j = JSON.parse(jsonPart); } catch {}
  return { status: http, body: j };
}

/** API-ריבוני: fetch-ראשון → curl-עיקש (×5) — אותו-חוק-עורקים-שנמדד */
async function call(method, p, body = null) {
  try {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    let j = null;
    try { j = await res.json(); } catch {}
    if (is2xx(res.status)) return { status: res.status, body: j };
    const msg = j?.error?.message || j?.message || "";
    if (res.status >= 400 && res.status < 500 && res.status !== 403 && res.status !== 429) {
      return { status: res.status, body: j, msg }; // שגיאת-לקוח-אמיתית — לא-לנסות-שוב
    }
  } catch {
    // נופלים-לעורק-curl
  }
  let last = { status: 0, body: null };
  for (let k = 0; k < 5; k++) {
    if (k) await sleep(800 + k * 300);
    last = curlOnce(method, p, body);
    if (is2xx(last.status)) return last;
  }
  return last;
}

// ── 1) אריזת-הקוקפיט ────────────────────────────────────────────────────────
const files = [];
for (const e of fs.readdirSync(DOCSDIR, { withFileTypes: true })) {
  if (e.isDirectory()) {
    // vendor/ — שטוח-מספיק לקוקפיט הזה
    const vdir = path.join(DOCSDIR, e.name);
    for (const v of fs.readdirSync(vdir, { withFileTypes: true })) {
      if (v.isFile()) files.push(path.join(e.name, v.name));
    }
  } else if (e.isFile()) {
    files.push(e.name);
  }
}
if (files.length === 0) {
  console.log("[vercel-deploy] empty bundle (honest failure)");
  process.exit(1);
}
const payload = [];
let bytes = 0;
for (const rel of files) {
  const buf = fs.readFileSync(path.join(DOCSDIR, rel));
  bytes += buf.length;
  payload.push({ file: rel, data: buf.toString("base64"), encoding: "base64" });
}
console.log(`[vercel-deploy] bundle: ${payload.length} files · ${(bytes / 1024).toFixed(1)}KB`);

// ── 2) idempotency — ראש-זהה-לפריסה-מאומתת → דילוג ─────────────────────────
const head12 = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || null;
let lastVerified = null;
try {
  const lines = fs.readFileSync(DEPLOY_LOG, "utf8").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const rec = JSON.parse(l);
      if (rec.verified && rec.head) lastVerified = rec.head;
    } catch {}
  }
} catch {}
if (head12 && lastVerified === head12) {
  console.log(`[vercel-deploy] head ${head12} already deployed+verified — skip (honest)`);
  process.exit(0);
}

// ── 3) פריסה ────────────────────────────────────────────────────────────────
const t0 = Date.now();
const dep = await call("POST", "/v13/deployments", {
  name: PROJECT,
  target: "production",
  files: payload,
  projectSettings: { framework: null },
});
const depId = dep.body?.id || dep.body?.deploymentId || null;
if (dep.status === 409 || (dep.body?.error?.code === "DEPLOYMENT_NOT_FOUND" && false)) {
  // 409 = deployment-קיים-זהה — נחשב-הצלחה-כנה
}
if (!depId) {
  const errCode = dep.body?.error?.code || dep.msg || `http-${dep.status}`;
  console.log(`[vercel-deploy] create failed: ${String(errCode).slice(0, 160)} (honest)`);
  process.exit(1);
}
console.log(`[vercel-deploy] created ${depId.slice(-8)} — polling…`);

// ── 4) poll עד-READY ────────────────────────────────────────────────────────
let state = null, alias = null, depUrl = dep.body?.url || null;
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const st = await call("GET", `/v13/deployments/${depId}`);
  state = st.body?.readyState || st.body?.status || "unknown";
  alias = Array.isArray(st.body?.alias) && st.body.alias.length ? st.body.alias : alias;
  depUrl = st.body?.url || depUrl;
  if (state === "READY" || state === "ERROR" || state === "CANCELED") break;
}
if (state !== "READY") {
  console.log(`[vercel-deploy] deployment ended state=${state} (honest)`);
  process.exit(1);
}
const stable = (alias || []).find((a) => !/-[a-z0-9]{6,}\.vercel\.app$/.test(a)) || alias?.[0] || depUrl;
const url = `https://${stable || depUrl}`;

// ── 5) מדידת-החיים ─────────────────────────────────────────────────────────
let verified = false, http = 0;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "follow" });
  http = res.status;
  verified = res.ok;
} catch {
  const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "20", url], { encoding: "utf8" });
  http = parseInt(probe.stdout?.trim() || "0", 10);
  verified = http === 200;
}
const ms = Date.now() - t0;
console.log(`[vercel-deploy] ${state} · ${url} · http=${http} · verified=${verified} · ${(ms / 1000).toFixed(1)}s`);

// ── 6) קבלה-ממוסכת ─────────────────────────────────────────────────────────
fs.mkdirSync(R_DIR, { recursive: true });
let lines = [];
try {
  lines = fs.readFileSync(DEPLOY_LOG, "utf8").trim().split("\n").filter(Boolean);
} catch {}
lines.push(JSON.stringify({ at: new Date().toISOString(), head: head12, id: depId.slice(-12), url, http, verified, files: payload.length, bytes, ms }));
fs.writeFileSync(DEPLOY_LOG, lines.slice(-TAIL).join("\n") + "\n");

process.exit(verified ? 0 : 1);
