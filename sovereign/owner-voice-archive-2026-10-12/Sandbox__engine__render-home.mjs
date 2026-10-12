#!/usr/bin/env node
/**
 * render-home.mjs — מרפא-הבית-השני (T-54 · trace 1a124659eb347631)
 * ═════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה: בית-שני-שאף-אחד-לא-בודק = דומם. Render-מחובר-ל-GitHub (autoDeploy:
 * commit) — כל-push-מפריס-אוטומטית. התפקיד-כאן: למדוד-את-החיים, לגלות-התיישנות,
 * ולהעיר-את-הבית-כשהוא-נופל-או-מפגר-אחרי-הראש:
 *
 *   1. גילוי-עצמי: GET /v1/services → חיפוש-sovereign-cockpit (אפס-קידוד-ידני)
 *   2. מדידת-URL-החי (serviceDetails.url) → 200 = בריא
 *   3. בדיקת-התיישנות: קומיט-הפריסה-האחרונה מול-ראש-Sandbox-המקומי
 *   4. התיישן/מת → POST deploys → poll-עד-live → מדידה-חוזרת
 *   5. קבלה: receipts/render-home.jsonl (tail-256, ממוסך)
 *
 * שיעור-אמת-חי-שנטמע: PATCH-ל-publishPath-דורש-צורת-serviceDetails (rootDir
 * בשורש-בלבד) — מתועד-ב-SOVEREIGNTY-§7.4.
 * סוד: אפס. הטוקן-בסביבת-התהליך · פלט-ממוסך.
 * יציאה: 0 = בריא (או-הוחיה-בהצלחה) · 1 = כשל-כנה (fail-closed).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R_DIR = path.join(ROOT, "receipts");
const HOME_LOG = path.join(R_DIR, "render-home.jsonl");
const TAIL = 256;
const API = "https://api.render.com/v1";
const NAME = process.env.RENDER_SERVICE || "sovereign-cockpit";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = process.env.RENDER_TOKEN || "";
if (!TOKEN) {
  console.log("[render-home] no RENDER_TOKEN in environment (honest) — open the vault keys first");
  process.exit(1);
}
const H = () => ({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
const is2xx = (s) => s >= 200 && s < 300;

/** curl-יחידה — הטוקן-דרך-stdin-בלבד (חוק-העורקים — נמדד-חי-מול-GitLab) */
function curlOnce(method, p, body = null) {
  const cfg = [`header = "Authorization: Bearer ${TOKEN}"`, `request = ${method}`, `url = "${API}${p}"`];
  if (body) cfg.push(`data = ${JSON.stringify(JSON.stringify(body)).slice(1, -1).replace(/"/g, '\\"')}`, 'header = "Content-Type: application/json"');
  const r = spawnSync("curl", ["-sS", "--max-time", "25", "-w", "\n%{http_code}", "-K", "-"], {
    input: cfg.join("\n") + "\n",
    encoding: "utf8",
    timeout: 30000,
  });
  const out = (r.stdout || "").trim();
  const m = out.match(/(\d{3})$/);
  const http = m ? parseInt(m[1], 10) : 0;
  const jsonPart = m ? out.slice(0, m.index).trim() : out;
  let j = null;
  try { j = JSON.parse(jsonPart); } catch {}
  return { status: http, body: j };
}

/** API-ריבוני: fetch → curl-עיקש ×5 */
async function call(method, p, body = null) {
  try {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: H(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    let j = null;
    try { j = await res.json(); } catch {}
    if (is2xx(res.status)) return { status: res.status, body: j };
  } catch {
    // נופלים-לעורק-curl
  }
  let last = { status: 0, body: null };
  for (let k = 0; k < 5; k++) {
    if (k) await sleep(700 + k * 250);
    last = curlOnce(method, p, body);
    if (is2xx(last.status)) return last;
  }
  return last;
}

async function measureUrl(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    return res.status;
  } catch {
    const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "20", url], { encoding: "utf8" });
    return parseInt(probe.stdout?.trim() || "0", 10);
  }
}

// ── 1) גילוי-עצמי ───────────────────────────────────────────────────────────
const t0 = Date.now();
const list = await call("GET", "/services?limit=20");
if (!is2xx(list.status) || !Array.isArray(list.body)) {
  console.log(`[render-home] services probe failed http=${list.status} (honest)`);
  process.exit(1);
}
const svc = (list.body || []).map((s) => s.service || s).find((s) => s.name === NAME);
if (!svc) {
  console.log(`[render-home] service "${NAME}" not found among ${list.body.length} services (honest)`);
  process.exit(1);
}
const SID = svc.id;
const HOME_URL = svc.serviceDetails?.url || null;
console.log(`[render-home] service ${NAME} (${SID.slice(-8)}) · url=${HOME_URL || "unmeasured"}`);
if (!HOME_URL) {
  console.log("[render-home] no url in serviceDetails (honest failure)");
  process.exit(1);
}

// ── 1.5) חוק-נגד-סטייה (T-54-חי): repo-ב-Render-אינו-ניתן-ל-PATCH (400-נמדד) —
// אם-הבית-הוסט-למאגר-אחר, הריפוי-היחיד-הוא-יצירה-מחדש. נמדד-חי: אח-הסיט-את-השירות
// ל-sovereign-beacon (פרטי — בלי-GitHub-App-אין-שיבוט) והבניין-נפל. המרפא-משחזר-לבד.
const originUrl = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || "";
const expectedRepo = originUrl.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
const svcRepo = (svc.repo || "").replace(/\.git$/, "");
if (expectedRepo && svcRepo && svcRepo !== expectedRepo) {
  console.log(`[render-home] CONFIG DRIFT: repo=${svcRepo} ≠ expected=${expectedRepo} — recreating the home…`);
  const head12Local = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || null;
  const del = await call("DELETE", `/services/${SID}`);
  if (!is2xx(del.status) && del.status !== 204) {
    console.log(`[render-home] delete failed http=${del.status} (honest)`);
    process.exit(1);
  }
  await sleep(3000);
  const created = await call("POST", "/services", {
    type: "static_site",
    name: NAME,
    ownerId: svc.ownerId,
    repo: expectedRepo,
    branch: "main",
    rootDir: "docs",
    serviceDetails: { publishPath: "." },
    autoDeploy: "yes",
  });
  const nid = created.body?.id;
  if (!nid) {
    console.log(`[render-home] recreate failed http=${created.status} (honest)`);
    process.exit(1);
  }
  let lst = "unknown";
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const d = await call("GET", `/services/${nid}/deploys/${created.body?.deployId || ""}`);
    lst = d.body?.status || "unknown";
    if (["live", "build_failed", "deactivated", "canceled"].includes(lst)) break;
  }
  const fresh = await call("GET", `/services/${nid}`);
  const nurl = fresh.body?.serviceDetails?.url || null;
  const nhttp = nurl ? await measureUrl(nurl) : 0;
  console.log(`[render-home] recreated → ${lst} · ${nurl} · http=${nhttp}`);
  fs.mkdirSync(R_DIR, { recursive: true });
  let dlines = [];
  try { dlines = fs.readFileSync(HOME_LOG, "utf8").trim().split("\n").filter(Boolean); } catch {}
  dlines.push(JSON.stringify({ at: new Date().toISOString(), service: nid.slice(-8), url: nurl, http: nhttp, healthy: nhttp === 200, stale: false, action: "config-drift-recreated", head: head12Local, deployCommit: null, failedRecent: 0, ms: Date.now() - t0 }));
  fs.writeFileSync(HOME_LOG, dlines.slice(-TAIL).join("\n") + "\n");
  process.exit(nhttp === 200 ? 0 : 1);
}

// ── 2) מדידת-חיים ───────────────────────────────────────────────────────────
const headFull = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || null;
const head12 = headFull ? headFull.slice(0, 12) : null;
// אמת-המקור-של-Render = origin/main (לא-הראש-המקומי — האחים-דוחפים-במקביל)
const remoteFull = spawnSync("git", ["ls-remote", "origin", "refs/heads/main"], { cwd: ROOT, encoding: "utf8", timeout: 30000 }).stdout?.trim().split(/\s+/)[0] || null;
const remote12 = remoteFull ? remoteFull.slice(0, 12) : null;
let http = await measureUrl(HOME_URL);
let healthy = http === 200;

// ── 3) בדיקת-התיישנות ───────────────────────────────────────────────────────
let stale = false, lastCommit = null, depStatus = "unmeasured", failedAttempts = 0;
const deps = await call("GET", `/services/${SID}/deploys?limit=5`);
const depList = Array.isArray(deps.body) ? deps.body.map((d) => d.deploy || d) : [];
const dep0 = depList.find((d) => d.status === "live") || null; // הדיפלוי-החי-החדש-ביותר (ניסיון-כושל-של-קומיט-שנעלם-בריבייס ≠ התיישנות)
for (const d of depList) if (d.status === "build_failed") failedAttempts += 1;
if (dep0) {
  depStatus = dep0.status;
  lastCommit = dep0.commit?.id?.slice(0, 12) || null;
  stale = !!remoteFull && !!lastCommit && !remoteFull.startsWith(dep0.commit?.id || "");
} else {
  stale = true; // אין-דיפלוי-חי-בכלל = הבית-שכוב
}
console.log(`[render-home] url http=${http} · newest-live=${depStatus} · deploy-commit=${lastCommit || "?"} · origin-main=${remote12 || "?"} · failed-recent=${failedAttempts} · local-head=${head12 || "?"} · stale=${stale}`);

// ── 3.5) אמת-תוכן (T-55b · נמדד-חי): API-אומר-live ≠ CDN-מגיש-אמת.
// המדידה-היחידה-הכנה: הבייטים-המוגשים-מול-האמת-ב-raw.githubusercontent
// (node-מותר-שם — 200-נמדד; הדפדפן-חסום, זה-בדיוק-מה-שמצדיק-את-בדיקת-התוכן-כאן).
let contentStale = false;
try {
  const svc = await call("GET", `/services/${SID}`);
  const mRepo = /github\.com\/([^/]+\/[^/.]+)/.exec(svc.body?.repo || "");
  if (mRepo) {
    const cb = Date.now();
    // שני-קבצים: app.js (הלוגיקה) + index.html (השער-לקבצים — 90baeec-לימד: תג-ה-script-המטמון-שלו-הוא-שער-האמת)
    const [servedJs, truthJs, servedHtml, truthHtml] = await Promise.all([
      fetch(`${HOME_URL}/cockpit/app.js?cb=${cb}`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null),
      fetch(`https://raw.githubusercontent.com/${mRepo[1]}/main/docs/app.js`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null),
      fetch(`${HOME_URL}/cockpit/index.html?cb=${cb + 1}`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null),
      fetch(`https://raw.githubusercontent.com/${mRepo[1]}/main/docs/index.html`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null),
    ]);
    if (servedJs && truthJs) contentStale = contentStale || sha256(servedJs) !== sha256(truthJs);
    if (servedHtml && truthHtml) contentStale = contentStale || sha256(servedHtml) !== sha256(truthHtml);
  }
} catch {}
if (contentStale) {
  stale = true;
  console.log("[render-home] content-lag measured (API-live ≠ served bytes) — treating as stale");
}

// ── 4) החיה-עצמית (נפל או-התיישן → פריסה) ─────────────────────────────────
let action = healthy && !stale ? "none" : null;
if (!healthy || stale) {
  const why = !healthy ? `dead(http=${http})` : `stale(${lastCommit}≠${head12})`;
  console.log(`[render-home] waking the second home: ${why} — triggering deploy…`);
  const trig = await call("POST", `/services/${SID}/deploys`, {});
  const depId = trig.body?.id || null;
  if (!depId) {
    console.log(`[render-home] deploy trigger failed http=${trig.status} (honest)`);
    action = "trigger-failed";
  } else {
    action = "redeployed";
    let st = "unknown";
    for (let i = 0; i < 30; i++) {
      await sleep(5000);
      const d = await call("GET", `/services/${SID}/deploys/${depId}`);
      st = d.body?.status || "unknown";
      if (st === "live" || st === "build_failed" || st === "deactivated" || st === "canceled") break;
    }
    // מדידה-עיקשת: הבית-מתחיל-מחדש-אחרי-פריסה → cold-start-לא-הוא-מוות
    for (let m = 0; m < 4; m++) {
      if (m) await sleep(5000);
      http = await measureUrl(HOME_URL);
      if (http === 200) break;
    }
    healthy = http === 200;
    console.log(`[render-home] redeploy ${depId.slice(-8)} → ${st} · url http=${http} · healthy=${healthy}`);
    if (st === "build_failed") action = "build-failed";
  }
}

// ── 5) קבלה-ממוסכת ─────────────────────────────────────────────────────────
fs.mkdirSync(R_DIR, { recursive: true });
let lines = [];
try {
  lines = fs.readFileSync(HOME_LOG, "utf8").trim().split("\n").filter(Boolean);
} catch {}
lines.push(JSON.stringify({ at: new Date().toISOString(), service: SID.slice(-8), url: HOME_URL, http, healthy, stale, contentStale, action, head: head12, deployCommit: lastCommit, failedRecent: failedAttempts, ms: Date.now() - t0 }));
fs.writeFileSync(HOME_LOG, lines.slice(-TAIL).join("\n") + "\n");

if (healthy && !stale) console.log("[render-home] SECOND HOME ALIVE");
process.exit(healthy && action !== "trigger-failed" && action !== "build-failed" ? 0 : 1);
