#!/usr/bin/env node
/**
 * cloud-echo.mjs — ההד-השורד-מכונות (T-53 · trace 1a12430c9840b1bd)
 * ═════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה: מדינת-הצי-שחיה-רק-על-דיסק-מקומי מתה-עם-המכונה. השרשרת-חיה-ב-Git,
 * אבל-פעימה-חיה-צריכה-בית-שני-שאינו-GitHub-ואינו-הסנדבוקס. Supabase-Postgres
 * הוא-אותו-בית: טבלת-fleet_state-צוברת-פעימות-חתומות-sha256 — כל-תחייה-וכל-טיק
 * יכולים-לשאול-את-הענן: "מה-היה-הרגע-האחרון-שהצי-הוכיח-את-עצמו?"
 *
 * מה-הוא-עושה:
 *   1. מדידת-הפרויקט (Management-API → ref) — אפס-הנחה
 *   2. טבלת-fleet_state (idempotent CREATE-IF-NOT-EXISTS)
 *   3. מטען-אמת: state/network-state.json (חוזה-sanbox-state/1 — אפס-סודות-מעצמו)
 *      + head-git · סיכום-key-probe-הממוסך · מראת-gitlab-הממוסכת · מניין-תחיות
 *   4. sha256-של-המטען-הקנוני → INSERT → SELECT-count → אימות-עצמי
 *   5. קבלה: receipts/cloud-echo.jsonl (tail-256, ממוסך)
 *
 * סוד: אפס. הטוקן-בסביבת-התהליך-בלבד · הפלט-ממוסך · הטבלה-מכילה-מדידות-בלבד.
 * יציאה: 0 = פעימה-נוסחה-ואומתה · 1 = כשל-כנה (fail-closed).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R_DIR = path.join(ROOT, "receipts");
const ECHO_LOG = path.join(R_DIR, "cloud-echo.jsonl");
const TAIL = 256;
const MG = "https://api.supabase.com/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = process.env.SUPABASE_TOKEN || "";
if (!TOKEN) {
  console.log("[cloud-echo] no SUPABASE_TOKEN in environment (honest) — open the vault keys first");
  process.exit(1);
}
const H = () => ({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });

const is2xx = (s) => s >= 200 && s < 300;

/** curl-יחידה — הטוקן-דרך-stdin-בלבד (אותו-חוק-gitlab-mirror) */
function curlOnce(method, p, body = null) {
  const cfg = [`header = "Authorization: Bearer ${TOKEN}"`, `request = ${method}`, `url = "${MG}${p}"`];
  if (body) cfg.push(`data = ${JSON.stringify(JSON.stringify(body))}`, 'header = "Content-Type: application/json"');
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

/** עקשנות-עורקים (אותה-הדוקטרינה-שנמדדה-מול-GitLab — אפס-ניחוש) */
async function call(method, p, body = null) {
  try {
    const res = await fetch(`${MG}${p}`, {
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
  for (let k = 0; k < 7; k++) {
    if (k) await sleep(700 + k * 250);
    last = curlOnce(method, p, body);
    if (is2xx(last.status)) return last;
  }
  return last;
}

/** SQL-מנוהל — חוזר-שורות או-שגיאה-כנה */
async function sql(query) {
  const r = await call("POST", `/projects/${REF}/database/query`, { query });
  if (!is2xx(r.status)) {
    const msg = typeof r.body?.message === "string" ? r.body.message : typeof r.body === "string" ? r.body.slice(0, 160) : `http-${r.status}`;
    throw new Error(`query failed: ${String(msg).slice(0, 180)}`);
  }
  return r.body;
}

// ── 1) הפרויקט (מדידה — אפס-הנחה) ──────────────────────────────────────────
const pr = await call("GET", "/projects");
if (!is2xx(pr.status) || !Array.isArray(pr.body) || pr.body.length === 0) {
  console.log(`[cloud-echo] project probe failed http=${pr.status} (honest)`);
  process.exit(1);
}
const REF = process.env.SUPABASE_REF || pr.body[0].id;
console.log(`[cloud-echo] project ref: ${REF} (measured)`);

// ── 2) הטבלה (idempotent) ────────────────────────────────────────────────────
await sql(`create table if not exists fleet_state (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  payload jsonb not null,
  sha256 text not null
)`);

// ── 3) מטען-אמת (מדידות-בלבד — אפס-סודות) ───────────────────────────────────
const at = new Date().toISOString();
const payload = { schema: "fleet-echo/1", at, kind: "heartbeat" };

try {
  const st = JSON.parse(fs.readFileSync(path.join(ROOT, "state", "network-state.json"), "utf8"));
  payload.state = {
    schema: st.schema ?? null,
    updatedAt: st.updatedAt ?? null,
    merkle: st.merkle ? String(st.merkle).slice(0, 16) : null,
    keeper: { tickCount: st.keeper?.tickCount ?? null, status: st.keeper?.status ?? null, lastTick: st.keeper?.lastTick ?? null },
    selftest: { passed: st.selftest?.passed ?? null, total: st.selftest?.total ?? null, status: st.selftest?.status ?? null },
  };
} catch {
  payload.state = null; // אין-מדינה-מקומית — כנה
}

const gitHead = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" });
payload.head = gitHead.status === 0 ? gitHead.stdout.trim() : null;

try {
  const lines = fs.readFileSync(path.join(R_DIR, "key-probe.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  payload.keys = (last.results || []).map((r) => ({ key: r.key, alive: !!r.alive, http: r.http }));
} catch {
  payload.keys = null; // אין-מדידה-קודמת — כנה
}

try {
  const lines = fs.readFileSync(path.join(R_DIR, "gitlab-mirror.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  payload.gitlab = (last.results || []).map((r) => ({ repo: r.repo, verified: !!r.verified, head: r.head12 || null }));
} catch {
  payload.gitlab = null;
}

let revivals = 0;
try {
  revivals = fs.readFileSync(path.join(R_DIR, "revivals.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
} catch {}
payload.revivals = revivals;

const canonical = JSON.stringify(payload, Object.keys(payload).sort()); // מפתחות-ראשיים-ממוינים
const sha = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");

// ── 4) INSERT → אימות-עצמי ──────────────────────────────────────────────────
const q = `insert into fleet_state (kind, payload, sha256) select 'heartbeat', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb, '${sha}' returning id, at`;
const ins = await sql(q);
const insertedId = Array.isArray(ins) && ins[0]?.id != null ? ins[0].id : null;
if (insertedId == null) {
  console.log("[cloud-echo] insert returned no id (honest failure)");
  process.exit(1);
}
const cnt = await sql("select count(*)::int as n from fleet_state");
const count = Array.isArray(cnt) && cnt[0]?.n != null ? cnt[0].n : null;

// ── 5) קבלה-ממוסכת ──────────────────────────────────────────────────────────
fs.mkdirSync(R_DIR, { recursive: true });
let lines = [];
try {
  lines = fs.readFileSync(ECHO_LOG, "utf8").trim().split("\n").filter(Boolean);
} catch {}
lines.push(JSON.stringify({ at, ref: REF, insertedId, count, sha256: sha.slice(0, 16), head: payload.head }));
fs.writeFileSync(ECHO_LOG, lines.slice(-TAIL).join("\n") + "\n");

console.log(`[cloud-echo] heartbeat id=${insertedId} · rows=${count} · sha256=${sha.slice(0, 16)} · head=${payload.head || "unmeasured"}`);
console.log("[cloud-echo] OFF-MACHINE STATE ALIVE");
