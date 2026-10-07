#!/usr/bin/env bun
// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN-REVIVE — בוטסטראפ-ריבוני אחד שמוגדר-בגיט ומקים-את-הצי-כולו
// על-מכונה-ריקה (Task 7-b · הוראת-המפעיל "הכל-על-הגיט-ועל-הרשת").
//
//   bun bootstrap/sovereign-revive.mjs            ← בוטסטראפ מלא
//   bun bootstrap/sovereign-revive.mjs --check    ← מדידה-בלבד: אפס-השגרה,
//                                                   אפס-הרג, אפס-התקנה. דוח-כנה.
//
// שלבים: ריפו (5 קלונים) ← תלות (bun install) ← סודות (.env — אף-סוד-לא-בגיט)
//        ← השגרה (חוק-detached-spawn: Bun.spawn + מפריד + יומן-קובץ)
//        ← בריאות (TCP + GET, retry, טבלת UP/DOWN כנה).
//
// אידמפוטנטי: ריצה-חוזרת לא-שוברת — שירות-חי לא-נוגעים בו; קלון-קיים לא-נשפט;
//             node_modules/בנייה נעשים רק-אם-חסרים.
// סודות: PAT-ומפתחות-חיים-רק-ב-env או בקבצים-gitignored. אף-סוד-לא-קשיח-בקוד,
//        לא-נדפס, לא-נרשם-ביומן. אימות-גיט: ~/.git-credentials (chmod 600).
// השגרה: לפי חוק-2026-10-06 (מחיקות #3–#5): תהליכי-bash/setsid נקצרים בסוף-הבקשה;
//        רק ילדי-Bun.spawn שניתקו ליומן-קובץ שורדים. דוגמאות-חיות שהתבנית-מהן:
//        scripts/web-revive-once.mjs · scripts/daemons-revive.mjs · revive/spawn-dex-guard-once.mjs
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// ─── פרמטרים (env-בלבד — אף-סוד-קשיח) ───────────────────────────────────────
const MP = process.env.BOOTSTRAP_MYPROJECT ?? "/home/z/my-project"; // עץ-העבודה
const H = process.env.BOOTSTRAP_HOME ?? "/home/z"; // קלוני-התאומים (Console/Domain/steem)
const LOG_DIR = process.env.FLEET_LOG_DIR ?? "/home/z/fleet-tmp/logs";
const LOG_FILE = path.join(LOG_DIR, "bootstrap.log");
const CHECK = process.argv.includes("--check");
const ORG = process.env.BOOTSTRAP_ORG ?? "roshpinacare-sys";

const bunBin =
  typeof Bun !== "undefined" && process.execPath.includes("bun")
    ? process.execPath
    : "/usr/local/bin/bun";

// ─── יומן (הסקריפט כותב-לקובץ-בעצמו — לעולם-לא-pipe-של-המפעיל) ──────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFd = fs.openSync(LOG_FILE, "a");
function log(msg = "") {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try {
    fs.writeSync(logFd, line + "\n");
  } catch {}
}
const t0 = Date.now();

// ─── עזרי-רשת ────────────────────────────────────────────────────────────────
function tcpAlive(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

async function httpOk(port, paths = ["/health", "/"], timeoutMs = 2500) {
  // חוק-r202 (נמדד-חי): /health קודם, / כנפילה — שירותים-שמחזירים-404-בשורש
  // (market-maker · llm-bridge · content-factory) אינם-"נעולים". 200-בלבד-נחשב-חי.
  for (const p of paths) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: ctl.signal, cache: "no-store" });
      if (r.ok) return true;
    } catch {}
    finally {
      clearTimeout(t);
    }
  }
  return false;
}

function pidsOnPort(port) {
  try {
    const out = Bun.spawnSync(["ss", "-tlnp", `sport = :${port}`], {
      stdout: "pipe",
      stderr: "pipe",
    }).stdout.toString();
    return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))].filter(
      (p) => Number.isFinite(p) && p > 0,
    );
  } catch {
    return [];
  }
}

async function killPort(port) {
  // מנוקה רק-פורט-נעול (TCP-חי-בלי-HTTP) — לעולם-לא-שירות-עונה (חוק-אל-תהרוג-חיים)
  const pids = pidsOnPort(port);
  if (!pids.length) return;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1200));
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 400));
}

function pidCwd(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "?";
  }
}

// ─── עזרי-תהליך ──────────────────────────────────────────────────────────────
// runStep: תהליך-מסונכרן-של-שלב-תשתית (קלון/התקנה/בנייה) — פלט→יומן, tail-למסוף.
async function runStep(name, cmd, { cwd, env, timeoutMs = 600_000 } = {}) {
  log(`  ↻ ${name}: ${cmd.join(" ")}${cwd ? `  (cwd=${cwd})` : ""}`);
  const stepLog = path.join(LOG_DIR, `bootstrap-${name}.log`);
  const fd = fs.openSync(stepLog, "a");
  fs.writeSync(fd, `\n==== ${new Date().toISOString()} · ${name} · ${cmd.join(" ")} ====\n`);
  const child = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
  });
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {}
  }, timeoutMs);
  const code = await child.exited;
  clearTimeout(timer);
  fs.closeSync(fd);
  let tail = "";
  try {
    tail = fs
      .readFileSync(stepLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-3)
      .join(" | ")
      .slice(0, 300);
  } catch {}
  log(`  ${code === 0 ? "✓" : "✗"} ${name} → code=${code}${tail ? ` · ${tail}` : ""}`);
  return code === 0;
}

// spawnDetached: חוק-ההשגרה (התבנית-הקנונית שנמדדה-חי): stdin:ignore ·
// stdout/stderr→קובץ · האב יכול-למות — הילד-שורד (קבוצת-תהליך-עצמאית).
function spawnDetached(name, cmd, { cwd, env = {} } = {}) {
  const logFile = path.join(LOG_DIR, `${name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  fs.writeSync(fd, `\n==== spawn ${new Date().toISOString()} · ${cmd.join(" ")} · cwd=${cwd} ====\n`);
  const child = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
  });
  log(`  ↑ ${name} הושגר detached pid=${child.pid} → ${logFile}`);
  return child.pid;
}

// ─── שלב-ריפו ────────────────────────────────────────────────────────────────
const REPOS = [
  { name: "Zip", dir: `${MP}/zip` },
  { name: "saos-dex", dir: `${MP}/saos-dex` },
  { name: "Console", dir: `${H}/Console` },
  { name: "Domain", dir: `${H}/Domain` },
  { name: "steem", dir: `${H}/steem` },
].map((r) => ({ ...r, url: `https://github.com/${ORG}/${r.name}.git` }));

// PAT — env קודם, ואז קבצי-pat.env המדודים (שלושת-המקומות-החיים; KEY=VALUE או-טוקן-גולמי).
// מפתחות-מקובלים-בקובץ: PAT · ZIP_PAT · WEAVE_OPS_PAT · GITHUB_TOKEN (המבנה-שנכתב-חי
// ע"י revive-on-pat.sh). ערכים-לעולם-לא-נדפסים.
function resolvePat() {
  const envNames = ["GIT_TOKEN", "SAOS_GIT_PAT", "BOOTSTRAP_PAT"];
  for (const n of envNames) {
    const v = process.env[n];
    if (v && v.trim().length > 20) return { token: v.trim(), source: `env:${n}` };
  }
  const files = [`${MP}/upload/pat.env`, `${H}/revive/pat.env`, `${MP}/zip/upload/pat.env`];
  const validKeys = ["PAT", "ZIP_PAT", "WEAVE_OPS_PAT", "GITHUB_TOKEN"];
  for (const f of files) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      for (const line of txt.split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.+)\s*$/);
        if (m && validKeys.includes(m[1]) && m[2].trim().length > 20)
          return { token: m[2].trim(), source: f };
      }
      const raw = txt.trim();
      if (raw && !raw.includes("=") && raw.length > 20) return { token: raw, source: f };
    } catch {}
  }
  return null;
}

function gitHead(dir) {
  try {
    return fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
}

function shortHead(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref:") ? head.slice(5).trim() : null;
    const sha = fs
      .readFileSync(path.join(dir, ".git", ref ?? "HEAD"), "utf8")
      .trim()
      .slice(0, 7);
    return `${(ref ?? "").replace("refs/heads/", "")}@${sha}`;
  } catch {
    return gitHead(dir)?.slice(0, 20) ?? "?";
  }
}

async function phaseRepos() {
  log("── שלב 1 · ריפו — 5 קלונים מ-github.com/" + ORG + " ──");
  const results = [];
  for (const r of REPOS) {
    const exists = fs.existsSync(path.join(r.dir, ".git"));
    if (exists) {
      log(`  ✓ ${r.name}: קיים (${r.dir} · ${shortHead(r.dir)}) — לא-נוגעים`);
      results.push({ ...r, status: "PRESENT" });
      continue;
    }
    if (CHECK) {
      log(`  ✗ ${r.name}: חסר (${r.dir}) — ייקלון-בריצה-מלאה`);
      results.push({ ...r, status: "MISSING" });
      continue;
    }
    const pat = resolvePat();
    if (!pat) {
      log(
        `  ⛔ ${r.name}: אין-PAT (env: GIT_TOKEN/SAOS_GIT_PAT/BOOTSTRAP_PAT או pat.env) — fail-closed`,
      );
      results.push({ ...r, status: "NO-PAT" });
      continue;
    }
    log(`  ↻ ${r.name}: קלון (מקור-PAT: ${pat.source} · ערך-לא-נדפס)`);
    // אימות-גיט דרך credential-store (התבנית-המנוסה של revive-on-pat.sh) —
    // הטוקן-לא-עובר-בשורת-פקודה (אין-דליפה-ל-process-list).
    const credLine = `https://x-access-token:${pat.token}@github.com\n`;
    try {
      const credPath = path.join(os.homedir(), ".git-credentials");
      let existing = "";
      try {
        existing = fs.readFileSync(credPath, "utf8");
      } catch {}
      if (!existing.includes("x-access-token:") || !existing.includes("@github.com")) {
        fs.writeFileSync(credPath, existing + credLine, { mode: 0o600 });
      }
      fs.chmodSync(credPath, 0o600);
      await runStep("git-credential-helper", ["git", "config", "--global", "credential.helper", "store"]);
      const ok = await runStep(`clone-${r.name}`, ["git", "clone", "--quiet", r.url, r.dir], {
        timeoutMs: 600_000,
      });
      if (ok) {
        // הרימוט-נשאר-נקי (בלי-טוקן-מוטמע) — אימות-דרך-ה-store
        results.push({ ...r, status: "CLONED" });
        log(`  ✓ ${r.name}: משובט → ${r.dir}`);
      } else results.push({ ...r, status: "CLONE-FAIL" });
    } catch (e) {
      log(`  ✗ ${r.name}: שגיאת-קלון: ${e instanceof Error ? e.message : String(e)}`);
      results.push({ ...r, status: "CLONE-FAIL" });
    }
  }
  return results;
}

// ─── שלב-תלות ────────────────────────────────────────────────────────────────
async function phaseDeps() {
  log("── שלב 2 · תלות — bun install בכל-ריפו-שצריך ──");
  const targets = [
    { name: "zip", dir: `${MP}/zip` },
    { name: "saos-dex", dir: `${MP}/saos-dex` },
    { name: "my-project (שער-:3000)", dir: MP },
  ];
  const results = [];
  for (const t of targets) {
    const hasPkg = fs.existsSync(path.join(t.dir, "package.json"));
    const hasModules = fs.existsSync(path.join(t.dir, "node_modules"));
    if (!hasPkg) {
      log(`  ⚠ ${t.name}: אין-package.json — מדלג (לא-ריפו-תלוי)`);
      results.push({ ...t, status: "NO-PKG" });
      continue;
    }
    if (hasModules) {
      log(`  ✓ ${t.name}: node_modules קיים — לא-נוגעים`);
      results.push({ ...t, status: "PRESENT" });
      continue;
    }
    if (CHECK) {
      log(`  ✗ ${t.name}: חסר-node_modules — יותקן-בריצה-מלאה`);
      results.push({ ...t, status: "MISSING" });
      continue;
    }
    const ok = await runStep(`bun-install-${t.name.split(" ")[0]}`, [bunBin, "install"], {
      cwd: t.dir,
      timeoutMs: 900_000,
    });
    results.push({ ...t, status: ok ? "INSTALLED" : "INSTALL-FAIL" });
  }
  return results;
}

// ─── שלב-סודות ───────────────────────────────────────────────────────────────
// מקור-האמת: $MP/saos-dex/.env (ה-WIFs-הוכחו-4/4-מול-השרשראות — worklog;
// BLURT=STEEM-active הוכח ב-scripts/blurt-key-derive-prove.mjs).
// הסקריפט: קורא-.env-קיים · או-בונה-אותו-מ-ENV-בלבד · אף-סוד-לא-נכתב-לגיט.
const ENV_KEYS = [
  "DATABASE_URL",
  "SAOS_RELAY_AGENT_ACCOUNT",
  "HIVE_ANCHOR_ACCOUNT",
  "DEX_OPERATOR_TOKEN",
  "SAOS_RELAY_SIGNING_SESSION_UNLOCKED",
  "STEEM_ACTIVE_WIF",
  "STEEM_POSTING_WIF",
  "HIVE_ACTIVE_WIF",
  "HIVE_POSTING_WIF",
  "BLURT_ACTIVE_WIF",
];
const WIF_KEYS = ENV_KEYS.filter((k) => k.endsWith("_WIF"));

function parseEnvFile(f) {
  const out = {};
  try {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)\s*$/);
      if (m && m[2] && !line.trim().startsWith("#")) out[m[1]] = m[2].trim();
    }
  } catch {}
  return out;
}

function phaseSecrets() {
  log("── שלב 3 · סודות — מקור-האמת: saos-dex/.env (אף-סוד-לא-לגיט) ──");
  const envPath = `${MP}/saos-dex/.env`;
  let env = parseEnvFile(envPath);
  let status = "PRESENT";
  if (!fs.existsSync(envPath) || WIF_KEYS.every((k) => !env[k])) {
    // בנייה-מ-ENV-בלבד (הוראת-מקור-האמת). חסרים-נרשמים-בשמות-בלבד.
    const lines = [];
    for (const k of ENV_KEYS) {
      if (env[k]) continue;
      const v = process.env[k];
      if (v) lines.push(`${k}=${v}`);
      else if (k === "DATABASE_URL") lines.push(`${k}=file:../db/dex.db`);
      else if (k === "SAOS_RELAY_AGENT_ACCOUNT" || k === "HIVE_ANCHOR_ACCOUNT")
        lines.push(`${k}=headcorner`); // זהות-פומבית-קנונית (לא-סוד)
      else if (k === "DEX_OPERATOR_TOKEN" && !CHECK)
        lines.push(`${k}=${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`);
      else if (k === "SAOS_RELAY_SIGNING_SESSION_UNLOCKED") lines.push(`${k}=1`);
    }
    if (lines.length && !CHECK) {
      fs.mkdirSync(path.dirname(envPath), { recursive: true });
      const body =
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .concat(lines)
          .join("\n") + "\n";
      fs.writeFileSync(envPath, body, { mode: 0o600 });
      env = parseEnvFile(envPath);
      status = "WRITTEN-FROM-ENV";
      log(`  ↑ .env נכתב (${envPath} · chmod 600 · מקור: ENV/ברירות-קנוניות)`);
    } else if (CHECK) {
      status = "MISSING";
    }
  }
  const missing = ENV_KEYS.filter((k) => !env[k]);
  const wifs = WIF_KEYS.map((k) => `${k}:${env[k] ? "present" : "MISSING"}`).join(" · ");
  log(`  ${status === "MISSING" ? "✗" : "✓"} .env ${status} — WIFs: ${wifs}`);
  if (missing.length) log(`  ⚠ חסרים (שמות-בלבד): ${missing.join(", ")}`);
  // הוכחת-גיט: .env-חייב-להיות-gitignored בשני-העצים — אימות-חי-בכל-ריצה
  const checkIgnore = (repo, rel) => {
    try {
      const r = Bun.spawnSync(["git", "-C", repo, "check-ignore", "-q", rel], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  };
  const ignoredDex = checkIgnore(`${MP}/saos-dex`, ".env");
  const ignoredZipPat = checkIgnore(`${MP}/zip`, "upload/pat.env");
  log(`  ${ignoredDex ? "✓" : "✗"} gitignore: saos-dex/.env ${ignoredDex ? "מוגן" : "לא-מוגן!"} · zip/upload/pat.env ${ignoredZipPat ? "מוגן" : "לא-מוגן!"}`);
  return { env, missing, status, ignoredDex, ignoredZipPat };
}

// ─── שלב-השגרה ───────────────────────────────────────────────────────────────
// טבלת-הצי המלאה (פורטים-המדודים; דיבוני-bun: --hot index.ts כמו daemons-revive).
// core = הרשימה-שהוטלה-בהוראת-המפעיל (Task 7-b) · ext = שאר-הסגל-ש-keeper-מפקח-עליו.
const FLEET = [
  { name: "pulse", port: 3033, dir: "pulse", core: true },
  { name: "money-mover", port: 3034, dir: "money", core: true },
  { name: "hunter", port: 3035, dir: "hunter", core: true },
  { name: "keeper", port: 3036, dir: "keeper", core: true },
  { name: "student", port: 3037, dir: "student", core: false },
  { name: "fleet-verify", port: 3038, dir: "fleet-verify", core: false },
  { name: "weblift", port: 3039, dir: "weblift", core: false },
  { name: "curation", port: 3040, dir: "curation", core: true },
  { name: "kpi", port: 3041, dir: "kpi", core: false },
  { name: "governance", port: 3042, dir: "governance", core: false },
  { name: "treasury-audit", port: 3043, dir: "treasury-audit", core: false },
  { name: "scout-market", port: 3044, dir: "scout-market", core: false },
  { name: "business", port: 3045, dir: "business", core: false },
  { name: "content-factory", port: 3046, dir: "content-factory", core: false },
  { name: "llm-bridge", port: 3048, dir: "llm-bridge", core: false },
  { name: "market-maker", port: 3049, dir: "market-maker", core: true },
  { name: "web-console", port: 3050, dir: "web", core: false }, // סופרוויזר-הקונסולה — תבנית web-revive-once
  { name: "dex-grid", port: 3051, dir: "dex-grid", core: true },
  { name: "proof-law", port: 3052, dir: "proof-law", core: true },
  { name: "arbitrage", port: 3053, dir: "arbitrage", core: true }, // FIX(r202-fix2): 3053 — לא-3050
];

function ensureSymlinks() {
  // סימלינקים-קנוניים (mini-services→zip; scripts→zip/scripts) — keeper-ומכונות-אחרות-קוראות-אותם
  const msDir = `${MP}/mini-services`;
  fs.mkdirSync(msDir, { recursive: true });
  let n = 0;
  for (const d of fs.readdirSync(`${MP}/zip/mini-services`)) {
    if (d === "node_modules") continue;
    const src = `${MP}/zip/mini-services/${d}`;
    const dst = `${msDir}/${d}`;
    if (fs.statSync(src).isDirectory() && !fs.existsSync(dst)) {
      fs.symlinkSync(src, dst);
      n++;
    }
  }
  if (!fs.existsSync(`${MP}/scripts`)) fs.symlinkSync(`${MP}/zip/scripts`, `${MP}/scripts`);
  return n;
}

async function spawnFleetDaemon(svc) {
  const cwd = `${MP}/zip/mini-services/${svc.dir}`;
  if (!fs.existsSync(path.join(cwd, "index.ts"))) {
    log(`  ⛔ ${svc.name}: index.ts-נעדר-ב-${cwd} — חוסם-בכנות`);
    return "NO-SOURCE";
  }
  spawnDetached(svc.name, [bunBin, "--hot", "index.ts"], { cwd });
  return "SPAWNED";
}

async function ensureService(svc) {
  // אידמפוטנטיות: עונה-HTTP → לא-נוגעים · TCP-בלי-HTTP (נעול) → ניקוי-והשגרה · מת → השגרה
  // --check: מדווח-בלבד — אפס-הרג-ואפס-השגרה (חוק-אל-תהרוג-שירותים-חיים)
  if (await httpOk(svc.port, ["/health", "/"])) return "ALREADY-UP";
  if (await tcpAlive(svc.port)) {
    const pids = pidsOnPort(svc.port);
    log(`  ⚠ ${svc.name} (:${svc.port}) נעול (TCP-בלי-HTTP · pid=${pids.join(",")} · cwd=${pids.map(pidCwd).join(",")})`);
    if (CHECK) return "WEDGED";
    await killPort(svc.port);
    return spawnFleetDaemon(svc);
  }
  if (CHECK) {
    log(`  ✗ ${svc.name} (:${svc.port}) לא-עונה — יושגר-בריצה-מלאה`);
    return "DOWN";
  }
  return spawnFleetDaemon(svc);
}

async function phaseConsole() {
  log("── שלב 4 · השגרה · קונסולה :3000 ──");
  const health = await httpOk(3000, ["/api/health", "/"], 3000);
  if (health) {
    const pids = pidsOnPort(3000);
    log(`  ✓ :3000 כבר חי — לא-נוגעים (${pids.map(pidCwd).join(",") || "?"})`);
    return "ALREADY-UP";
  }
  if (await tcpAlive(3000)) {
    log(`  ⚠ :3000 TCP-בלי-HTTP (cwd=${pidsOnPort(3000).map(pidCwd).join(",")}) — ב-${CHECK ? "check" : "full"}-mode${CHECK ? ": מדווח-בלבד" : ": מנקה (אינו-עונה = אינו-שירות-חי)"}`);
    if (!CHECK) await killPort(3000);
    else return "WEDGED";
  }
  if (CHECK) {
    log("  ✗ :3000 לא-עונה — יוקם-בריצה-מלאה (src-sync מ-zip ← bun run dev)");
    return "DOWN";
  }
  if (fs.existsSync(`${MP}/package.json`) && fs.existsSync(`${MP}/zip/src`)) {
    // המתכון-המנוסה (revive-on-pat.sh שלב ה+ · לקח-מחיקה-#3): בלי-סנכרון-src
    // /api/money-מת-404-וכל-שרשרת-הכסף-מתה-בכנות.
    log("  ↻ סנכרון-src מ-zip (api/lib/components/hooks/types/prisma/console-modules)");
    fs.cpSync(`${MP}/zip/src/app/api`, `${MP}/src/app/api`, { recursive: true, force: true });
    fs.cpSync(`${MP}/zip/src/lib`, `${MP}/src/lib`, { recursive: true, force: true });
    fs.cpSync(`${MP}/zip/src/types`, `${MP}/src/types`, { recursive: true, force: true });
    fs.cpSync(`${MP}/zip/src/hooks`, `${MP}/src/hooks`, { recursive: true, force: true });
    fs.cpSync(`${MP}/zip/src/components/weave`, `${MP}/src/components/weave`, { recursive: true, force: true });
    for (const f of ["page.tsx", "layout.tsx", "globals.css"])
      try {
        fs.copyFileSync(`${MP}/zip/src/app/${f}`, `${MP}/src/app/${f}`);
      } catch {}
    try {
      fs.copyFileSync(`${MP}/zip/src/instrumentation.ts`, `${MP}/src/instrumentation.ts`);
    } catch {}
    fs.mkdirSync(`${MP}/prisma`, { recursive: true });
    fs.copyFileSync(`${MP}/zip/prisma/schema.prisma`, `${MP}/prisma/schema.prisma`);
    fs.mkdirSync(`${MP}/console`, { recursive: true });
    for (const f of ["gate-crypto.js", "saos-live.js", "acid-engine.js"])
      try {
        fs.copyFileSync(`${MP}/zip/console/${f}`, `${MP}/console/${f}`);
      } catch {}
    // מיזוג-תלות zip→שורש (כמו-שלב-ה+ — בלי-זה-blurtjs/ethers/steem-חסרים)
    try {
      const z = JSON.parse(fs.readFileSync(`${MP}/zip/package.json`, "utf8"));
      const c = JSON.parse(fs.readFileSync(`${MP}/package.json`, "utf8"));
      let changed = false;
      for (const sec of ["dependencies", "devDependencies"])
        for (const [k, v] of Object.entries(z[sec] ?? {}))
          if (!c[sec]?.[k]) {
            c[sec] = c[sec] ?? {};
            c[sec][k] = v;
            changed = true;
          }
      if (changed) fs.writeFileSync(`${MP}/package.json`, JSON.stringify(c, null, 2));
    } catch {}
    await runStep("root-bun-install", [bunBin, "install"], { cwd: MP, timeoutMs: 900_000 });
    await runStep("root-db-push", [bunBin, "run", "db:push"], { cwd: MP, timeoutMs: 300_000 });
    spawnDetached("console-3000", [bunBin, "run", "dev"], { cwd: MP });
    return "SPAWNED";
  }
  // אין-פיגומי-שורש (מכונה-ריקה-בלי-סנדבוקס-בסיס) — הקונסולה-עולה-מעץ-zip-עצמו (ריבונות-מלאה)
  log("  ⚠ אין-פיגומי-my-project — עולה-מעץ-zip-ישירות (next dev :3000 מ-zip)");
  spawnDetached("console-3000-zip", [bunBin, "--bun", "node_modules/next/dist/bin/next", "dev", "-p", "3000"], {
    cwd: `${MP}/zip`,
  });
  return "SPAWNED-FROM-ZIP";
}

function phaseSovereignState() {
  // שחזור-מצב-סוברן no-clobber — רישומים-שהמנועים-קוראים (לא-דורס-חד-מחיים).
  // לקח-ריצה-חיה (Task 7-b): proofs-נעדר-היה-משאיר-את-proof-law-חי-אך-פסקי-פעימה-ENOENT.
  log("── שלב 4 · מצב-סוברן no-clobber מ-zip (businesses/economy/governance/money/revenue/proofs) ──");
  if (CHECK) {
    const missing = ["businesses", "economy", "governance", "money", "revenue", "proofs"].filter(
      (d) => !fs.existsSync(`${MP}/sovereign/${d}`) && fs.existsSync(`${MP}/zip/sovereign/${d}`),
    );
    log(`  ${missing.length ? "✗ חסרים-יישוחזרו-בריצה-מלאה: " + missing.join(",") : "✓ מלא"}`);
    return missing.length ? "INCOMPLETE" : "COMPLETE";
  }
  const restored = [];
  for (const d of ["businesses", "economy", "governance", "money", "revenue", "proofs"])
    try {
      if (!fs.existsSync(`${MP}/zip/sovereign/${d}`)) continue;
      fs.cpSync(`${MP}/zip/sovereign/${d}`, `${MP}/sovereign/${d}`, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      restored.push(d);
    } catch {}
  log(`  ✓ no-clobber הושלם (${restored.length} עצים-נבדקו)`);
  return "RESTORED";
}

async function phaseDex() {
  log("── שלב 4 · השגרה · DEX :3010 + dex-guard :3054 ──");
  const out = { dex: "ALREADY-UP", guard: "ALREADY-UP" };
  if (await httpOk(3010, ["/saos-dex/api/dex/state"], 3000)) {
    log("  ✓ DEX :3010 כבר חי — לא-נוגעים");
  } else if (CHECK) {
    out.dex = "DOWN";
    log(`  ✗ DEX :3010 לא-עונה — יוקם-בריצה-מלאה (build-אם-חסר ← bun --bun next start)`);
  } else {
    const dexDir = `${MP}/saos-dex`;
    const dbDir = `${dexDir}/db`;
    fs.mkdirSync(dbDir, { recursive: true });
    if (!fs.existsSync(`${dexDir}/.next/BUILD_ID`)) {
      log("  ↻ אין-בנייה-פרודקשן — בונה (prisma generate + next build; דקות-אחדות)");
      await runStep("dex-prisma-generate", [bunBin, "run", "db:generate"], { cwd: dexDir, timeoutMs: 600_000 });
      await runStep(
        "dex-next-build",
        [bunBin, "--bun", "node_modules/next/dist/bin/next", "build"],
        { cwd: dexDir, env: { DATABASE_URL: `file:${dbDir}/dex.db` }, timeoutMs: 1_200_000 },
      );
    }
    spawnDetached("dex-3010", [bunBin, "--bun", "node_modules/next/dist/bin/next", "start", "-p", "3010", "-H", "127.0.0.1"], {
      cwd: dexDir,
      env: {
        DATABASE_URL: `file:${dbDir}/dex.db`,
        NODE_ENV: "production",
        BUN_JSC_forceRamSize: "536870912", // לקח-oom-2×: תקרת-JSC-512MB
      },
    });
    out.dex = "SPAWNED";
  }
  // dex-guard — השומר-הנצחי של-השרשרת (HEALTH_PORT=3054 — FIX-port-war-3051)
  if (await httpOk(3054, ["/"], 2000)) {
    log("  ✓ dex-guard :3054 כבר חי — לא-נוגעים");
  } else if (CHECK) {
    out.guard = "DOWN";
    log("  ✗ dex-guard :3054 לא-עונה — יושגר-בריצה-מלאה");
  } else {
    const gdir = `${MP}/zip/mini-services/dex-guard`;
    if (fs.existsSync(`${gdir}/index.ts`)) {
      spawnDetached("dex-guard", [bunBin, "--hot", "index.ts"], { cwd: gdir, env: { HEALTH_PORT: "3054" } });
      out.guard = "SPAWNED";
    } else {
      out.guard = "NO-SOURCE";
      log(`  ⛔ dex-guard: index.ts-נעדר-ב-${gdir}`);
    }
  }
  return out;
}

async function phaseFleet() {
  log("── שלב 4 · השגרה · דיבוני-הצי (detached-spawn) ──");
  if (!CHECK) {
    const n = ensureSymlinks();
    if (n) log(`  ↻ סימלינקים-חדשים: ${n} (${MP}/mini-services → עץ-zip)`);
  }
  const results = {};
  for (const svc of FLEET) {
    results[svc.name] = await ensureService(svc);
  }
  return results;
}

async function phaseDecisionBrain() {
  // decision-brain :3047 — python server.py (מנוע-laya · r200: DORMANT-UNPROVISIONED-עד-אספקה).
  // בדיקה-חיה: נדרש-python-עם-מודול-laya. מועמדים: venv-הקנוני ← python-מפורש-מ-env ← python3.
  // אספקה-מכוונת-בלבד (חוק-r200): BOOTSTRAP_DECISION_BRAIN=provision — מתקין-venv+laya ואז-משגר.
  log("── שלב 4 · השגרה · decision-brain :3047 (python) ──");
  const bdir = `${MP}/zip/mini-services/decision-brain`;
  if (await httpOk(3047, ["/health"], 2000)) {
    log("  ✓ :3047 כבר חי — לא-נוגעים");
    return "ALREADY-UP";
  }
  if (!fs.existsSync(`${bdir}/server.py`)) {
    log(`  ⛔ server.py-נעדר-ב-${bdir} (הקלון-המלא-של-Zip-חסר?) — חוסם-בכנות`);
    return "NO-SOURCE";
  }
  const candidates = [
    process.env.DECISION_BRAIN_PYTHON,
    `${H}/laya-eval/venv/bin/python`,
    "python3",
    "/usr/bin/python3",
  ].filter(Boolean);
  let python = null;
  for (const py of candidates) {
    try {
      const r = Bun.spawnSync([py, "-c", "import laya"], { stdout: "ignore", stderr: "pipe" });
      if (r.exitCode === 0) {
        python = py;
        break;
      }
    } catch {}
  }
  if (python) {
    if (CHECK) {
      log(`  ✓ python-עם-laya-נמצא (${python}) — יושגר-בריצה-מלאה`);
      return "READY";
    }
    spawnDetached("decision-brain", [python, "-u", "server.py"], {
      cwd: bdir,
      env: { HF_HUB_CACHE: `${H}/laya-eval/hf-cache`, OMP_NUM_THREADS: "2" },
    });
    return "SPAWNED";
  }
  if (process.env.BOOTSTRAP_DECISION_BRAIN === "provision" && !CHECK) {
    log("  ↻ BOOTSTRAP_DECISION_BRAIN=provision — מאספק-venv+laya (uv)");
    const venv = `${H}/laya-eval/venv`;
    const okV = await runStep("brain-uv-venv", ["uv", "venv", venv], { timeoutMs: 300_000 });
    const okP = okV
      ? await runStep(
          "brain-uv-install",
          ["uv", "pip", "install", "--python", `${venv}/bin/python`, "laya"],
          { timeoutMs: 900_000 },
        )
      : false;
    if (okP) {
      spawnDetached("decision-brain", [`${venv}/bin/python`, "-u", "server.py"], {
        cwd: bdir,
        env: { HF_HUB_CACHE: `${H}/laya-eval/hf-cache`, OMP_NUM_THREADS: "2" },
      });
      return "SPAWNED";
    }
    log("  ⛔ אספקה-נכשלה (ראה bootstrap-brain-*.log) — נשאר-חסום-בכנות");
    return "BLOCKED-PROVISION-FAIL";
  }
  // חסימה-כנה-עם-התרופה-המדויקת (נמדד-חי: אין-laya-בשום-פייתון-במכונה)
  log("  ⛔ decision-brain חסום-בכנות: אין-python-עם-מודול-laya");
  log(`     חסר: ${H}/laya-eval/venv (אבד-עם-הסנדבוקס · נמדד) + מודול-laya בכל-python-זמין`);
  log(`     תרופה: uv venv ${H}/laya-eval/venv && uv pip install --python ${H}/laya-eval/venv/bin/python laya`);
  log("     (מאגר-~644MB-יורד-בהחלטת-ה-decide-הראשונה · ~2GB-RAM-בזמן-תהי · או-ריצה-מלאה-עם BOOTSTRAP_DECISION_BRAIN=provision)");
  return "BLOCKED-NO-LAYA";
}

// ─── שלב-בריאות ──────────────────────────────────────────────────────────────
async function measureService(name, port, paths = ["/health", "/"]) {
  const up = await httpOk(port, paths, 2500);
  if (up) return { name, port, tcp: true, http: true, status: "UP" };
  const tcp = await tcpAlive(port, 1500);
  return { name, port, tcp, http: false, status: tcp ? "WEDGED" : "DOWN" };
}

async function phaseHealth(spawnedNames) {
  log("── שלב 5 · בריאות — מדידה-חיה (TCP + GET · retry) ──");
  const checks = [
    { name: "console", port: 3000, paths: ["/api/health", "/"], core: true },
    { name: "dex", port: 3010, paths: ["/saos-dex/api/dex/state"], core: true },
    ...FLEET.map((f) => ({ name: f.name, port: f.port, paths: ["/health", "/"], core: f.core })),
    { name: "decision-brain", port: 3047, paths: ["/health"], core: true },
    { name: "dex-guard", port: 3054, paths: ["/"], core: true },
  ];
  // retry-סביר: full-mode — עד-20×5ש' למושגרים; check — שתי-מדידות-בהפרש-2ש' (כנות)
  const rounds = CHECK ? 2 : 20;
  const gap = CHECK ? 2000 : 5000;
  let results = [];
  for (let i = 0; i < rounds; i++) {
    results = [];
    for (const c of checks) results.push(await measureService(c.name, c.port, c.paths));
    const down = results.filter((r) => r.status !== "UP");
    if (!down.length) break;
    if (i === rounds - 1) break;
    if (!CHECK) {
      const still = down.filter((r) => spawnedNames.has(r.name)).map((r) => r.name);
      if (!still.length) break; // מה-שלא-הושגר-על-ידינו — לא-נמתין-לו-מעבר
    }
    await new Promise((r) => setTimeout(r, gap));
  }
  const width = 16;
  log("  ┌──────────────────┬──────┬─────┬──────┬─────────┐");
  log("  │ שירות            │ פורט │ TCP │ HTTP │ מצב     │");
  log("  ├──────────────────┼──────┼─────┼──────┼─────────┤");
  for (const r of results) {
    const nm = r.name.padEnd(width).slice(0, width);
    log(
      `  │ ${nm} │ ${String(r.port).padEnd(4)} │ ${(r.tcp ? "✓" : "✗").padEnd(3)} │ ${(r.http ? "200" : "—").padEnd(4)} │ ${r.status.padEnd(7)} │`,
    );
  }
  log("  └──────────────────┴──────┴─────┴──────┴─────────┘");
  return results;
}

async function phaseTruth(results) {
  // עדויות-חיות-נוספות (כנות — נכשל-גם-הוא-מדווח)
  const extras = {};
  try {
    const r = await fetch("http://127.0.0.1:3010/saos-dex/api/dex/metrics", { signal: AbortSignal.timeout(3000) });
    const t = await r.text();
    extras.dexHeight = t.match(/^saos_height (\d+)/m)?.[1] ?? null;
    extras.dexDbOk = t.match(/^saos_db_ok (\d)/m)?.[1] ?? null;
  } catch {}
  try {
    const r = await fetch("http://127.0.0.1:3035/", { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    extras.canaryRepo = j?.canary?.repo ?? j?.config?.canaryRepo ?? j?.canaryRepo ?? j["canary.repo"] ?? null;
  } catch {}
  log(
    `  עדויות: saos_height=${extras.dexHeight ?? "לא-נמדד"} · db_ok=${extras.dexDbOk ?? "?"} · canary.repo=${extras.canaryRepo ?? "לא-נמדד"}`,
  );
  return extras;
}

// ─── ראשי ────────────────────────────────────────────────────────────────────
async function main() {
  log("════════════════════════════════════════════════════════");
  log(`SOVEREIGN-REVIVE · mode=${CHECK ? "CHECK-ONLY (מדווח-בלבד — אפס-השגרה/הרג/התקנה)" : "FULL"} · log=${LOG_FILE}`);
  log(`עץ-עבודה: ${MP} · בית: ${H}`);

  const repos = await phaseRepos();
  const deps = await phaseDeps();
  const secrets = phaseSecrets();

  const consoleStatus = await phaseConsole();
  const sovereignState = phaseSovereignState();
  const dexStatus = await phaseDex();
  const fleetStatus = await phaseFleet();
  const brainStatus = await phaseDecisionBrain();

  const spawnedNames = new Set();
  if (consoleStatus === "SPAWNED" || consoleStatus === "SPAWNED-FROM-ZIP") spawnedNames.add("console");
  if (dexStatus.dex === "SPAWNED") spawnedNames.add("dex");
  if (dexStatus.guard === "SPAWNED") spawnedNames.add("dex-guard");
  for (const [name, st] of Object.entries(fleetStatus)) if (st === "SPAWNED") spawnedNames.add(name);
  if (brainStatus === "SPAWNED") spawnedNames.add("decision-brain");

  const results = await phaseHealth(spawnedNames);
  const extras = await phaseTruth(results);

  // סיכום-כנה
  const up = results.filter((r) => r.status === "UP");
  const down = results.filter((r) => r.status === "DOWN");
  const wedged = results.filter((r) => r.status === "WEDGED");
  const coreDown = results.filter((r) => r.core && r.status !== "UP").map((r) => r.name);
  log("────────────────────────────────────────────────────────");
  log(`סיכום כנה: UP ${up.length}/${results.length} · DOWN ${down.length} · WEDGED ${wedged.length}`);
  if (down.length) log(`  DOWN: ${down.map((d) => `${d.name}(:${d.port})`).join(", ")}`);
  if (wedged.length) log(`  WEDGED (TCP-בלי-HTTP): ${wedged.map((d) => `${d.name}(:${d.port})`).join(", ")}`);
  log(`  ריפו: ${repos.map((r) => `${r.name}=${r.status}`).join(" · ")}`);
  log(`  תלות: ${deps.map((d) => `${d.name}=${d.status}`).join(" · ")}`);
  log(`  סודות: .env=${secrets.status} · חסרים=${secrets.missing.length ? secrets.missing.join(",") : "אפס"} · gitignore=${secrets.ignoredDex ? "דקס-מוגן" : "דקס-חשוף!"}/${secrets.ignoredZipPat ? "pat-מוגן" : "pat-חשוף!"}`);
  log(`  קונסולה: ${consoleStatus} · DEX: ${dexStatus.dex} · dex-guard: ${dexStatus.guard} · decision-brain: ${brainStatus} · סוברן-מצב: ${sovereignState}`);
  log(`  זמן-ריצה: ${Math.round((Date.now() - t0) / 1000)}s`);
  log("  נותר-ידני (fail-closed-מכוון): חימוש-מנועים ב-POST-מפעיל בלבד (חוק-הדיבונים) · pat.rar/סיסמת-כספת — אצל-המפעיל");
  log("════════════════════════════════════════════════════════");
  if (CHECK) {
    log("mode=CHECK-ONLY → exit 0 (דוח-בלבד; ראה DOWN/WEDGED-למעלה-לאמת-המלאה)");
    process.exit(0);
  }
  process.exit(coreDown.length === 0 ? 0 : 1);
}

main().catch((e) => {
  log(`⛔ bootstrap קרס: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(2);
});
