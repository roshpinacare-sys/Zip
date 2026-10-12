#!/usr/bin/env node
/**
 * key-probe.mjs — מודד-חיות-המפתחות של-הריבונות (T-52b · trace 1a12416dcba85e31)
 * ═════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה: מפתח-שלא-נמדד = מפתח-שמניחים-שהוא-חי. אנחנו-לא-מניחים.
 *
 * מה-הוא-עושה: לכל-אחד-מ-4-עורקי-התשתית (GitLab · Supabase · Vercel · Render)
 *   · קריאת-זהות-חיה מול-API-האמת
 *   · מדידה: HTTP · זהות-ממוסכת · latency-ms
 *   · קבלה-ממוסכת (אפס-ערכים!) אל receipts/key-probe.jsonl (tail-256, append-only)
 *
 * מקור-המפתחות: משתני-סביבה בלבד (GITLAB_TOKEN · SUPABASE_TOKEN · VERCEL_TOKEN ·
 * RENDER_TOKEN) — הקורא-מקור-את-קובץ-כספת של-הכספת ואז-מריץ; הסקריפט-עצמו-אפס-סודות.
 *
 * יציאה: 0 = כל-הנבדקים-חיים · 1 = מת-אחד-לפחות או-אפס-מפתחות-בסביבה (fail-closed).
 * כלל-אמת: הפלט-מעולם-לא-מכיל-ערך-מפתח — רק-נוכחות, זהות-ממוסכת, וזמן-תגובה.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R_DIR = path.join(ROOT, "receipts");
const PROBE_LOG = path.join(R_DIR, "key-probe.jsonl");
const TAIL = 256;

const PROBES = [
  {
    name: "gitlab",
    env: "GITLAB_TOKEN",
    // T-57 (measured live): הטוקן-מוקף-פרויקטים — /user מחזיר-403 בזמן-שהמראה-עצמה
    // מאומתת 3/3 verified. המדידה-חייבת-למדוד-יכולת-אמת: רשימת-פרויקטים-חברים.
    url: "https://gitlab.com/api/v4/projects?membership=true&per_page=1",
    headers: (t) => ({ "PRIVATE-TOKEN": t }),
    identity: (j) => (Array.isArray(j) ? `projects-accessible:${j.length >= 1 ? "yes" : "none"}` : null),
  },
  {
    name: "supabase",
    env: "SUPABASE_TOKEN",
    url: "https://api.supabase.com/v1/projects",
    headers: (t) => ({ Authorization: `Bearer ${t}` }),
    identity: (j) => (Array.isArray(j) ? `projects:${j.length}` : null),
  },
  {
    name: "vercel",
    env: "VERCEL_TOKEN",
    url: "https://api.vercel.com/v2/user",
    headers: (t) => ({ Authorization: `Bearer ${t}` }),
    identity: (j) => (j?.user?.username ? `user:${j.user.username}` : null),
  },
  {
    name: "render",
    env: "RENDER_TOKEN",
    url: "https://api.render.com/v1/owners?limit=5",
    headers: (t) => ({ Authorization: `Bearer ${t}` }),
    identity: (j) => (Array.isArray(j) && j[0]?.owner?.name ? `ws:${j[0].owner.name}` : null),
  },
];

const present = PROBES.filter((p) => !!process.env[p.env]);
if (present.length === 0) {
  console.log("[key-probe] no tokens in environment (honest) — open the vault keys first (see boot/revive.sh step 6.5)");
  process.exit(1);
}

const results = [];
for (const p of present) {
  const t0 = Date.now();
  try {
    const res = await fetch(p.url, { headers: p.headers(process.env[p.env]), signal: AbortSignal.timeout(12000) });
    const ms = Date.now() - t0;
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const id = res.ok ? p.identity(body) : null;
    results.push({ key: p.name, alive: res.ok && !!id, http: res.status, identity: id || "rejected", ms });
  } catch (e) {
    results.push({ key: p.name, alive: false, http: 0, identity: `error:${String(e?.cause?.code || e?.name || "unknown").slice(0, 30)}`, ms: Date.now() - t0 });
  }
}

// receipt — masked, append-only
fs.mkdirSync(R_DIR, { recursive: true });
const receipt = { probedAt: new Date().toISOString(), results };
try {
  const lines = fs.existsSync(PROBE_LOG) ? fs.readFileSync(PROBE_LOG, "utf8").trim().split("\n") : [];
  lines.push(JSON.stringify(receipt));
  fs.writeFileSync(PROBE_LOG, lines.slice(-TAIL).join("\n") + "\n");
} catch { /* receipt is best-effort; measurement itself already printed */ }

console.log("[key-probe] liveness (masked):");
for (const r of results) {
  console.log(`  ${r.key.padEnd(9)} ${r.alive ? "ALIVE" : "DEAD "} · http=${r.http} · ${r.identity} · ${r.ms}ms`);
}
const dead = results.filter((r) => !r.alive);
console.log(`[key-probe] ${results.length - dead.length}/${results.length} alive`);
process.exit(dead.length ? 1 : 0);
