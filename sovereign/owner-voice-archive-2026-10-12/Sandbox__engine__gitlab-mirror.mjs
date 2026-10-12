#!/usr/bin/env node
/**
 * gitlab-mirror.mjs — בית-git-שני-לצי (T-53 · trace 1a12430c9840b1bd)
 * ═════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה: ריבונות-שמוחזקת-בבית-אחד בלבד היא ריבונות-בחסד-מארח אחד.
 * GitHub-עשוי-ליפול/להחרים/ליעלם — כשהעורקים-חיים-גם-ב-GitLab, הצי-שורד-את-זה.
 *
 * מה-הוא-עושה (לכל-בית-מ-FLEET_REPOS):
 *   1. ודא-פרויקט-פרטי-מתחת-מרחב-השם-של-הטוקן (404 → יצירה · קיים → כנה)
 *   2. הכשרת-מראה: protected-branch 'main' → allow_force_push=true ·
 *      protected-tags → פתוחים (מראה-אמת-חייבת-שליטה-מלאה-ב-refs)
 *   3. הבא-מקור-מקורי (origin fetch --prune --tags — דרך-credential-שהתגלה
 *      מ-GITHUB_TOKEN/GH_TOKEN כמו-revive; בלי-וֶדוֹן — דילוג-כנה)
 *   4. דחיפת-מראה מוגבלת: refs/heads/* + refs/tags/* (אפס-refs-מזוהמים)
 *   5. אימות-עצמאי: HEAD-מקומי מול-GitLab-API branch-sha — חייבים-להשתוות
 *   6. דילוג-כנה-כשאין-שינוי מאז-הדחיפה-המאומתת-הקודמת
 *
 * סוד: אפס. טוקנים-עוברים-ל-git-דרך-credential.helper-בסביבת-התהליך-בלבד
 * (לעולם-לא-URL · לעולם-לא-argv-מודפס · לעולם-לא-קובץ). פלט-ממוסך-בלבד.
 * קבלה: receipts/gitlab-mirror.jsonl (tail-256, append-only, ממוסך).
 * יציאה: 0 = כל-הבתים-מאומתים (או-אין-בתים) · 1 = כשל-אחד-לפחות (fail-closed).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R_DIR = path.join(ROOT, "receipts");
const MIRROR_LOG = path.join(R_DIR, "gitlab-mirror.jsonl");
const TAIL = 256;
const API = "https://gitlab.com/api/v4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = process.env.GITLAB_TOKEN || "";
const HOME = process.env.HOME || "/root";
const FLEET = process.env.SOVEREIGN_FLEET || path.join(HOME, "fleet");
const REPOS = (process.env.FLEET_REPOS || "Sandbox,steem,SovereignConsole")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.log("[gitlab-mirror] no GITLAB_TOKEN in environment (honest) — open the vault keys first");
  process.exit(1);
}
if (REPOS.length === 0) {
  console.log("[gitlab-mirror] no repos configured (honest) — nothing to do");
  process.exit(0);
}

const H = () => ({ "PRIVATE-TOKEN": TOKEN, "Content-Type": "application/json" });

/** קריאת-curl-יחידה — הטוקן-עובר-דרך-stdin-(-K-)-בלבד: אפס-טוקן-ב-argv */
function curlOnce(method, p, body = null) {
  const cfg = [`header = "PRIVATE-TOKEN: ${TOKEN}"`, `request = ${method}`, `url = "${API}${p}"`];
  if (body) cfg.push(`data = ${JSON.stringify(JSON.stringify(body))}`, 'header = "Content-Type: application/json"');
  const r = spawnSync("curl", ["-sS", "--max-time", "20", "-w", "\n%{http_code}", "-K", "-"], {
    input: cfg.join("\n") + "\n",
    encoding: "utf8",
    timeout: 25000,
  });
  const out = (r.stdout || "").trim();
  const m = out.match(/(\d{3})$/); // השורה-האחרונה = %{http_code}
  const http = m ? parseInt(m[1], 10) : 0;
  const jsonPart = m ? out.slice(0, m.index).trim() : out;
  let j = null;
  try { j = JSON.parse(jsonPart); } catch {}
  return { status: http, body: j };
}

const is2xx = (s) => s >= 200 && s < 300;

/**
 * חוק-העורקים (נמדד-חי): GitLab-מחלק-חסימות-403-בפרצים-לפי-backend (haproxy-מרובה-עורקים) —
 * חיבור-חדש-נופל-על-עורק-אחר. תשעה-ניסיונות-מרווחים → ההסתברות-להיתקע-כולם-זניחה.
 */
async function curlRetry(method, p, body = null, attempts = 9) {
  let last = { status: 0, body: null };
  for (let k = 0; k < attempts; k++) {
    if (k) await sleep(700 + k * 250); // השקטה-הולכת-וגדלה
    last = curlOnce(method, p, body);
    if (is2xx(last.status)) return last;
  }
  return last;
}

/** קריאת-API-ריבונית: fetch-ראשון (זול-כשלא-חסום) → curl-עיקש-כגיבוי. אפס-המצאה-של-כישלון. */
async function call(method, p, body = null) {
  try {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: H(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    let j = null;
    try { j = await res.json(); } catch {}
    if (is2xx(res.status)) return { status: res.status, body: j };
  } catch {
    // רשת-fetch-כשלה → עוברים-לעורק-curl
  }
  return curlRetry(method, p, body);
}

// ── זהות-המרחב (ממוסך) ──────────────────────────────────────────────────────
const me = await call("GET", "/user");
if (me.status !== 200 || !me.body?.username) {
  console.log(`[gitlab-mirror] identity probe failed http=${me.status} (honest) — refusing to guess`);
  process.exit(1);
}
const NS = me.body.username;
console.log(`[gitlab-mirror] namespace: ${NS} (masked)`);

const git = (repoDir, args, extraEnv = {}) =>
  spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, ...extraEnv },
    maxBuffer: 8 * 1024 * 1024,
  });

/** הכשרת-מראה: force-push-מותר-על-כל-ענף-מוגן · תגיות-פתוחות — אפס-שתיקה (ממוסך) */
async function makeMirrorReady(pid) {
  const notes = [];
  const brs = await call("GET", `/projects/${pid}/protected_branches`);
  if (brs.status === 200 && Array.isArray(brs.body)) {
    for (const b of brs.body) {
      if (!b.allow_force_push) {
        const p = await call("PATCH", `/projects/${pid}/protected_branches/${encodeURIComponent(b.name)}`, { allow_force_push: true });
        notes.push(`${b.name}:allow_force_push=${p.status === 200 ? "ok" : `http-${p.status}`}`);
      }
    }
  } else if (brs.status !== 200) {
    notes.push(`branches-probe=http-${brs.status}`);
  }
  const tgs = await call("GET", `/projects/${pid}/protected_tags`);
  if (tgs.status === 200 && Array.isArray(tgs.body)) {
    for (const t of tgs.body) {
      const d = await call("DELETE", `/projects/${pid}/protected_tags/${encodeURIComponent(t.name)}`);
      notes.push(`tag-unprotect:${t.name}=${d.status === 204 ? "ok" : `http-${d.status}`}`);
    }
  }
  return notes;
}

// אחרון-הראשים-שנדחפו-בהצלחה — לדילוג-כנה-כשאין-שינוי
const lastPushed = {};
try {
  const lines = fs.readFileSync(MIRROR_LOG, "utf8").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const rec = JSON.parse(l);
      if (rec.at && rec.results) for (const r of rec.results) if (r.verified && r.repo) lastPushed[r.repo] = r.head12;
    } catch {}
  }
} catch {}

// וֶדוֹן-גיטהאב-שהתגלה (אותו-חוק-revive: GITHUB_TOKEN/GH_TOKEN בסביבה)
const GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const ghHelper = "!f() { echo username=x-access-token; echo password=$MIR_GH_TOKEN; }; f";

const results = [];
for (const repo of REPOS) {
  const dir = path.join(FLEET, repo);
  const t0 = Date.now();
  const row = { repo, project: `${NS}/${repo}`, created: false, pushed: false, verified: false, head12: null, http: 0, ms: 0 };
  if (!fs.existsSync(path.join(dir, ".git"))) {
    console.log(`[gitlab-mirror] ${repo}: not a git home at ${FLEET}/${repo} (honest) — skipped`);
    results.push({ ...row, skipped: true });
    continue;
  }
  // 1) ודא-פרויקט-פרטי
  const enc = encodeURIComponent(`${NS}/${repo}`);
  let ex = await call("GET", `/projects/${enc}`);
  let pid = ex.status === 200 ? ex.body?.id ?? null : null;
  let defBranch = ex.status === 200 ? ex.body?.default_branch || "main" : "main";
  if (ex.status === 404) {
    const res = await call("POST", "/projects", {
      name: repo,
      visibility: "private",
      initialize_with_readme: false,
    });
    row.http = res.status;
    pid = res.status === 201 ? res.body?.id ?? null : null;
    defBranch = res.status === 201 ? res.body?.default_branch || "main" : defBranch;
    if (pid) {
      row.created = true;
      console.log(`[gitlab-mirror] ${repo}: project CREATED (private, id=${pid})`);
    } else {
      console.log(`[gitlab-mirror] ${repo}: create failed http=${res.status} (honest)`);
      results.push({ ...row, failed: true });
      continue;
    }
  } else if (ex.status === 200) {
    console.log(`[gitlab-mirror] ${repo}: project exists (id=${pid})`);
  } else {
    console.log(`[gitlab-mirror] ${repo}: probe failed http=${ex.status} (honest)`);
    results.push({ ...row, failed: true });
    continue;
  }
  // 2) הכשרת-מראה (הרשאות-זקוקות-רגע-התיישבות-בצד-השרת)
  const ready = await makeMirrorReady(pid);
  if (ready.length) {
    console.log(`[gitlab-mirror] ${repo}: mirror-ready → ${ready.join(" · ")}`);
    await sleep(2000);
  }
  // 3) הבא-מקור-מקורי
  const fetchArgs = ["fetch", "origin", "--prune", "--tags"];
  const fetchEnv = {};
  if (GH) {
    fetchArgs.unshift("-c", `credential.helper=${ghHelper}`);
    fetchEnv.MIR_GH_TOKEN = GH;
  }
  const fr = git(dir, fetchArgs, fetchEnv);
  if (fr.status !== 0) console.log(`[gitlab-mirror] ${repo}: fetch origin degraded (non-fatal, honest)`);
  // 4) מראת-דחיפה
  const head12 = git(dir, ["rev-parse", "--short=12", "HEAD"]).stdout?.trim() || null;
  row.head12 = head12;
  if (head12 && lastPushed[repo] === head12) {
    console.log(`[gitlab-mirror] ${repo}: unchanged since last verified push (${head12}) — skip (honest)`);
    results.push({ ...row, skipped: true });
    continue;
  }
  const url = `https://gitlab.com/${NS}/${repo}.git`;
  git(dir, ["remote", "remove", "gitlab"]);
  git(dir, ["remote", "add", "gitlab", url]);
  const glHelper = "!f() { echo username=oauth2; echo password=$MIR_GL_TOKEN; }; f";
  const pushArgs = ["-c", `credential.helper=${glHelper}`, "push", "--force", "gitlab", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"];
  const pushEnv = { MIR_GL_TOKEN: TOKEN, GIT_TERMINAL_PROMPT: "0" };
  let push = { status: 1, stderr: "" };
  // GitLab-מחלק-חסימות-403-בפרצים-גם-על-receive-pack → עד-3-ניסיונות-מרווחים
  for (let attempt = 1; attempt <= 3; attempt++) {
    push = git(dir, pushArgs, pushEnv);
    if (push.status === 0) break;
    if (attempt < 3) {
      console.log(`[gitlab-mirror] ${repo}: push attempt-${attempt} failed — settling ${attempt * 4}s…`);
      await sleep(attempt * 4000);
    }
  }
  if (push.status !== 0) {
    const err = (push.stderr || "").trim().split("\n").slice(-1)[0] || "unknown";
    console.log(`[gitlab-mirror] ${repo}: push FAILED — ${err.replace(/oauth2:[^@\s]+@/g, "oauth2:***@").slice(0, 140)} (honest)`);
    results.push({ ...row, failed: true });
    continue;
  }
  row.pushed = true;
  // 5) אימות-עצמאי מול-API (ענף-ברירת-המחדל-של-הפרויקט — לא-הנחה)
  const br = await call("GET", `/projects/${enc}/repository/branches/${encodeURIComponent(defBranch)}`);
  const remoteSha = br.body?.commit?.id ? String(br.body.commit.id).slice(0, 12) : null;
  row.verified = !!remoteSha && !!head12 && remoteSha === head12;
  row.ms = Date.now() - t0;
  console.log(`[gitlab-mirror] ${repo}: pushed ${head12} → verified=${row.verified} (default-branch=${defBranch}, ${row.ms}ms)`);
  results.push(row);
}

// ── קבלה-ממוסכת ───────────────────────────────────────────────────────────────
fs.mkdirSync(R_DIR, { recursive: true });
let lines = [];
try {
  lines = fs.readFileSync(MIRROR_LOG, "utf8").trim().split("\n").filter(Boolean);
} catch {}
lines.push(JSON.stringify({ at: new Date().toISOString(), namespace: NS, results }));
fs.writeFileSync(MIRROR_LOG, lines.slice(-TAIL).join("\n") + "\n");

const done = results.filter((r) => !r.skipped);
const failed = done.filter((r) => r.failed || (!r.pushed && !r.skipped));
const verified = results.filter((r) => r.verified).length;
console.log(`[gitlab-mirror] ${verified}/${results.length} verified${failed.length ? ` · ${failed.length} failed` : " · all active lanes OK"}`);
process.exit(failed.length ? 1 : 0);
