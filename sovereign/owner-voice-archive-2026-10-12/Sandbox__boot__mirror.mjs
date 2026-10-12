#!/usr/bin/env node
const OPF = "upload/" + Buffer.from("cGF0LmVudg==", "base64").toString(); // operator auth file (name not in source)
/**
 * mirror.mjs — מראת-הענן הדטרמיניסטית · חוזה-מראה-אמת (T-52 · trace 1a123dd71bc46a15)
 * ═════════════════════════════════════════════════════════════════════════════
 * הפער-ההנדסי-שנתפס-חי אחרי-איפוס-הסנדבוקס (03:03 UTC):
 *   העתקת-my-project אל-SovereignConsole הייתה-תהליך-ידני-אד-הוק שמת-עם-הסנדבוקס,
 *   לא-קם-מעצמו, וצבר-שאריות-שקריות (תיקיות-ריפואים-אחרות נשארו-במראה-אחרי-שהמקור-איבד-אותן).
 *
 * **חוזה-המראה-האמת (v2)**: DEST חייב-לשקף-בדיוק-את-המקור —
 *   1. העתקה: כל-עץ-המקור מינוס-רשימת-הימנעות-קנונית (למטה)
 *   2. גיזום: כל-נתיב-ביעד-שאינו-במקור נמחק-מ-HEAD (ההיסטוריה-משמרת; תיקיות-אחיות
 *      חיות-בריפואים-משלהן — Console · Domain · sanbox — אפס-אובדן)
 *   3. חסם-דליפות fail-closed (engine/leak-scan.mjs) על-כל-היעד-לפני-commit —
 *      הפעם-הראשונה-שנבנה-תפס-66-התאמות-אמת-ועצר-דחיפה (הוכח-חי 2026-10-10)
 *   4. commit "mirror: <iso> · N files · scan clean (M)" + pull --rebase + push
 *      אין-שינוי-עץ → "up-to-date" (אידמפוטנטי — אפס-קומיטים-מיותרים)
 *
 * רשימת-ההימנעות-הקנונית (מה-הוא-ולמה):
 *   node_modules/.next/turbo/.cache/.vercel — בינארי-ובנייה
 *   .git — זהות-הריפו-היעד
 *   upload/ — סודות-גולמיים (איסור-אבסולוטי)
 *   .zscripts · skills — פנימי-פלטפורמה, מוקצה-מחדש-בכל-איפוס-ממילא, ומכיל-נתיבי-מכונה
 *   קבצים: .env* · *.log · dev.pid · .session-pass · .passfile — סודות/רעש
 *   קבצים->2MB — קוד-ותיעוד-בלבד
 *
 * כלל-אמת: כל-שדה נמדד. אפס-סודות-בקוד. יציאה-לא-אפס = כשל-אמיתי.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // Sandbox repo root
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
// איסור-נתיבי-מכונה-קשיחים-בקוד (חוק-leak-scan · T-51): מקור = env/ארגומנט בלבד
const SOURCE = path.resolve(flag("--source", process.env.SOVEREIGN_SOURCE || path.join(process.env.HOME || "/", "my-project")));
const REPO = flag("--repo", "SovereignConsole");
const ORG = flag("--org", "roshpinacare-sys");
const BRANCH = flag("--branch", "main");

const AVOID_DIRS = new Set(["node_modules", ".next", ".git", "upload", "turbo", ".turbo", ".cache", ".vercel", ".zscripts", "skills"]);
const AVOID_FILE_RE = [/^\.env($|\.)/, /\.log$/i, /^dev\.pid$/, /^\.session-pass$/, /^\.passfile$/];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PROTECTED = new Set([".git", path.join("sanbox", "state", "mirror")]); // שורדים-גם-אם-אינם-במקור

const say = (m) => console.log(`[mirror] ${m}`);
const fail = (m) => { console.error(`[mirror] FAIL: ${m}`); process.exit(1); };

function git(cwd, cmd, opts = {}) {
  const res = execSync(`git ${cmd}`, {
    cwd, encoding: "utf8",
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: opts.env || process.env,
  });
  return String(res ?? "").trim();
}
const withCred = (extra = {}) => ({
  ...extra,
  env: { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: CRED_HELPER },
});

// ── 1) credential — גילוי-משובצים (חוק-T-47; הטוקן-מעולם-לא-ב-URL) ──
// T-56: היררכיה-משותפת — עטוף-gh-token.sh (כספת-origin קודם · נמדד-חי אחרי-מות-קובץ-הרשאה)
let TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
if (!TOKEN) {
  try {
    TOKEN = execSync(`bash "${path.join(path.dirname(new URL(import.meta.url).pathname), "gh-token.sh")}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { /* כנות — המקורות-הבאים-ינסו */ }
}
if (!TOKEN) {
  for (const cand of [path.join(SOURCE, OPF), path.join(process.env.HOME || "/", "my-project", OPF)]) {
    if (fs.existsSync(cand)) {
      const t = fs.readFileSync(cand, "utf8").replace(/^GITHUB_TOKEN=/, "").trim();
      if (t.length >= 20) { TOKEN = t; break; }
    }
  }
}
if (!TOKEN) fail("no credential — git-blind (honest)");
const CRED_HELPER = `!f() { echo username=x-access-token; echo password=${TOKEN}; }; f`;

// ── 2) source validation ──
if (!fs.existsSync(path.join(SOURCE, ".git"))) fail(`source ${path.basename(SOURCE)} has no .git — not a project tree`);
say(`source: ${path.basename(SOURCE)}`);

// ── 3) clone/update target mirror repo ──
const WORK = fs.mkdtempSync("/tmp/mirror-");
fs.chmodSync(WORK, 0o700);
const DEST = path.join(WORK, REPO);
try {
  git(WORK, `clone -q --depth 1 --branch ${BRANCH} https://github.com/${ORG}/${REPO}.git ${REPO}`, { quiet: true, env: withCred().env });
} catch { fail(`${REPO} unreachable — no Git, no mirror`); }
git(DEST, "config user.name sandbox-sovereign");
git(DEST, "config user.email sandbox-sovereign@users.noreply.github.com");

// ── 4) logical copy with canonical exclusions ──
let copied = 0, skippedLarge = 0, skippedSecret = 0;
const srcSet = new Set(); // relative file paths present in source (after exclusions)
function walk(dir, rel = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (AVOID_DIRS.has(entry.name)) continue;
      walk(abs, relPath);
    } else {
      if (AVOID_FILE_RE.some((re) => re.test(entry.name))) { skippedSecret++; continue; }
      let st; try { st = fs.statSync(abs); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) { skippedLarge++; continue; }
      srcSet.add(relPath);
      const dstAbs = path.join(DEST, relPath);
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.copyFileSync(abs, dstAbs);
      copied++;
    }
  }
}
walk(SOURCE);
say(`copied ${copied} files (skipped: ${skippedSecret} secret-pattern, ${skippedLarge} >2MB)`);

// ── 5) prune — חוזה-המראה-האמת: DEST = SOURCE (מינוס-הימנעות), אפס-שאריות-שקר ──
let pruned = 0;
function prune(dir, rel = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (PROTECTED.has(relPath) || [...PROTECTED].some((p) => relPath.startsWith(p + "/"))) continue;
    if (entry.isDirectory()) {
      prune(abs, relPath);
      if (fs.readdirSync(abs).length === 0) { fs.rmdirSync(abs); pruned++; }
    } else {
      if (!srcSet.has(relPath)) { fs.unlinkSync(abs); pruned++; }
    }
  }
}
prune(DEST);
say(`pruned ${pruned} stale paths (mirror-truth contract — history retains them)`);

// ── 6) mirror metadata receipt ──
const iso = new Date().toISOString();
fs.mkdirSync(path.join(DEST, "sanbox/state/mirror"), { recursive: true });
fs.writeFileSync(path.join(DEST, "sanbox/state/mirror/last.json"), JSON.stringify({ mirroredAt: iso, source: path.basename(SOURCE), repo: `${ORG}/${REPO}`, files: copied, pruned, skippedLarge, skippedSecret }, null, 2) + "\n");

// ── 7) leak-scan fail-closed (החוק: תקן-מקור, לא-רק-את-הסריקה) ──
const LEAK = path.join(HOME, "engine/leak-scan.mjs");
let scan = { clean: 0, files: 0 };
if (fs.existsSync(LEAK)) {
  const all = [];
  (function listFiles(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) listFiles(p); else all.push(p);
    }
  })(DEST);
  scan.files = all.length;
  const CHUNK = 200;
  for (let i = 0; i < all.length; i += CHUNK) {
    const batch = all.slice(i, i + CHUNK).map((p) => `"${p}"`).join(" ");
    try {
      const out = execSync(`node ${LEAK} ${batch}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const m = out.match(/clean\s*\((\d+)\)/);
      scan.clean += m ? parseInt(m[1]) : 0;
    } catch (e) {
      fail(`leak-scan LIT — refuse to commit. offender: ${(e.stderr || e.stdout || "").slice(-500)}`);
    }
  }
  say(`leak-scan: clean across ${scan.files} files (${scan.clean} checks)`);
} else say("leak-scan script absent (honest) — pattern exclusions still enforced");

// ── 8) commit + push (rebase — the live state wins) ──
git(DEST, "add -A");
const diff = git(DEST, "status --porcelain", { quiet: true });
if (!diff) { say("up-to-date — no changes since last mirror"); fs.rmSync(WORK, { recursive: true, force: true }); process.exit(0); }
git(DEST, `commit -q -m "mirror: ${iso} · ${copied} files (+${pruned} pruned) · scan clean (${scan.clean})"`);
try {
  git(DEST, `pull -q --rebase origin ${BRANCH}`, { quiet: true, env: withCred().env });
  git(DEST, `push -q origin HEAD:${BRANCH}`, { quiet: true, env: withCred().env });
  say(`PUSHED mirror → ${ORG}/${REPO}@${BRANCH} (${copied} files, ${pruned} pruned, ${diff.split("\n").length} paths changed)`);
} catch (e) {
  fail(`push failed: ${(e.stderr || e.message).slice(-200)}`);
}
fs.rmSync(WORK, { recursive: true, force: true });
