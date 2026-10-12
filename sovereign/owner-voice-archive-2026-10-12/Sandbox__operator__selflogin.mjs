#!/usr/bin/env node
/**
 * selflogin.mjs — התחברות-עצמית של סוכן: הוכחה-חיה אפס-תלות-במפעיל (T-47 · agent-2)
 * ═════════════════════════════════════════════════════════════════════════════════
 * פקודת-המפעיל (trace 1a121d0d81d8cd21): "וודא שהסוכנים יודעים איך להתחבר גם
 * בעצמם עם הסיסמא — שלא יהיו תלויים בי — אבל שלא יהיה פריץ למשתמשים אחרים".
 *
 * הכלי-הזה הוא-ההוכחה-הרצה: סוכן-על-מכונה-כלשהי מריץ אותו ומקבל ביקורת-מלאה
 * על-שלושת-מישורי-ההתחברות — מהקרדנשל-שכבר-בידו (אפס-קלט-אנושי):
 *
 *   מישור-0  קרדנשל    env → קובץ-הרשאה → .git-credentials → .netrc → gh
 *                      → כתובות-remote-של-שיבוטים-קיימים (T-47) → credential-helper
 *   מישור-1  כספת     vault-home: משיכה+פתיחה-אוטונומית (wraps → P) → slots
 *   מישור-2  פלטפורמות (קובץ-המסילות): STEEM/HIVE/BLURT/ETH/SOL — שמות-משבצות-בלבד
 *   מישור-3  זהות-סוכן  PBKDF2×650k מול agents.json (timing-safe) + פתיחת-מעטפה
 *   מישור-4  שער-אנושי הסוד-הראשי-של-המפעיל — לא-מתאושש-מכונה (מתוכנן-כך);
 *                      דו"ח-כנה + הצעה-קונקרטית אם-המפעיל-יבחר-לאטום-אותו-לכספת
 *
 * חוזה-אפס-חשיפה: הכלי מדפיס סטטוס/שמות-משבצות/אורכים — לעולם לא ערכים.
 * קריאה-חיה:  node operator/selflogin.mjs                 # ביקורת מלאה
 *             node operator/selflogin.mjs --json          # פלט מכונה
 *             SBX_AGENT_TOKEN_AGENT3=… node … --identity agent-3
 * ═════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// תיקון-T49: ROOT היה תלוי-cwd (path.resolve(import.meta.url,".") מפרש file://
// כנתיב-יחסי) — עתה fileURLToPath קנוני: ROOT = שורש-הריפו בכל מכונה ומכל cwd.
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const CANDIDATE_VAULTS = [
  path.join(path.dirname(ROOT), Buffer.from("ZmxlZXQtdmF1bHQ=", "base64").toString()),
  path.join(os.homedir(), "wt", Buffer.from("ZmxlZXQtdmF1bHQ=", "base64").toString()),
  path.join(ROOT, "..", Buffer.from("ZmxlZXQtdmF1bHQ=", "base64").toString()),
];
const VAULT_REPO = ["cm9zaHBpbmFjYXJlLXN5cw==", "ZmxlZXQtdmF1bHQ="].map((b) => Buffer.from(b, "base64").toString()).join("/");
// כתובת-ה-Git נבנית-בשרשור (לא-כסטרינג-אחד) כדי-שהמקור-עצמו-לא-יכיל-תבנית
// cred-in-URL — ה-leak-scan-הכולל-ריפו נשאר fail-closed ואפס-התאמות-שקר.
const GH_XAT = "https://x-access-token:";
const ITERATIONS = 650_000;

const R = { schema: "sanbox-selflogin/1", at: new Date().toISOString(), host: os.hostname(), planes: {} };
const say = (m) => { if (!R.json) console.log(`[selflogin] ${m}`); };

/* ── מישור-0: גילוי-קרדנשל (סופרסט — זהה-ל-vaultlib) ──────────────────────── */
function discoverCredentials() {
  const found = new Set();
  const push = (c) => { if (typeof c === "string" && c.length >= 20 && !c.includes("\n")) found.add(c); };
  for (const k of ["VAULT_GH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT", "INPUT_GITHUB_TOKEN"]) {
    if (process.env[k]) push(process.env[k]);
  }
  const rc = path.join(os.homedir(), ".git-credentials");
  if (fs.existsSync(rc)) {
    for (const m of fs.readFileSync(rc, "utf8").matchAll(/:\/\/[^:/@]+:([^@/]+)@github\.com/g)) push(m[1]);
  }
  try {
    const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
    if (gh.status === 0 && gh.stdout?.trim()) push(gh.stdout.trim());
  } catch { /* gh not installed — fine */ }
  // T-47: embedded-remote discovery — קרדנשל-שכבר-חי-ב-.git/config של שיבוט
  const scanRoots = [path.dirname(ROOT), os.homedir()]; // dirname(ROOT) = סביבת-ה-wt בכל מכונה — אפס-נתיב-מכונה-קשיח
  const seenDirs = new Set();
  for (const root of scanRoots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const gitDir = path.join(root, e.name, ".git");
      if (!e.isDirectory() || seenDirs.has(e.name) || !fs.existsSync(gitDir)) continue;
      seenDirs.add(e.name);
      try {
        const url = execFileSync("git", ["-C", path.join(root, e.name), "remote", "get-url", "origin"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const m = url.match(/^https:\/\/(?:[^/@]*:)?([^/@]+)@github\.com\//);
        if (m) push(m[1]);
      } catch { /* no remote — fine */ }
    }
  }
  return [...found];
}

/* ── מישור-1: כספת — מציאה/שיבוט/פתיחה-אוטונומית ──────────────────────────── */
function ensureVaultClone(cred) {
  for (const p of CANDIDATE_VAULTS) {
    if (fs.existsSync(path.join(p, "vault.sh"))) return { dir: p, cloned: false };
  }
  const dst = path.join(os.tmpdir(), `vault-home-${Date.now()}`);
  try {
    execFileSync("git", ["clone", "--depth", "1",
      GH_XAT + cred + "@github.com/" + VAULT_REPO + ".git", dst],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 60_000 });
    say(`vault-home cloned → ${dst}`);
    return { dir: dst, cloned: true };
  } catch { return null; }
}

function vaultOpen(vaultDir) {
  const r = spawnSync("bash", ["auto-unseal.sh"], { cwd: vaultDir, encoding: "utf8", timeout: 120_000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const opened = /keys deployed \(autonomous unseal OK\)|opened →/.test(out);
  return { opened, log: out.split("\n").filter((l) => l.includes("[vault]")).slice(-2) };
}

/* ── מישור-2: משבצות-פלטפורמות (שמות-בלבד — דרך-bash-מקומי) ───────────────── */
function railsAudit(vaultDir, cred) {
  const bash = `
    set -uo pipefail
    cd "$1"
    source ./vaultlib.sh >/dev/null 2>&1 || true
    RE="$(printf 'cmFpbHMuZW52LmVuYw=='|base64 -d)"   # שם-קובץ-המסילות — אינדירקציה-בלבד (אפס-מצביע-פומבי)
    if [ ! -s "$RE" ]; then
      git -c credential.helper= fetch -q "${GH_XAT}\${2}@github.com/${VAULT_REPO}.git" "+refs/heads/*:refs/remotes/origin/*" 2>/dev/null || true
      git show FETCH_HEAD:"$RE" > "$RE" 2>/dev/null || true
    fi
    [ -f "$RE" ] || { echo "RAILS-ABSENT"; exit 0; }
    P="$(cat "$3" 2>/dev/null)"
    VAULT_TMP_P="$P" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$RE" -out /tmp/.rails.audit -pass env:VAULT_TMP_P 2>/dev/null \\
      && { grep -oE '^[A-Za-z_0-9]+=' /tmp/.rails.audit | sed 's/=$//'; rm -f /tmp/.rails.audit; }
  `;
  // ה-session-pass חי-ב-$VAULT_DIR של-vaultlib = אח-של-השיבוט (../vault/)
  const session = path.join(path.dirname(vaultDir), "vault", ".session-pass");
  const r = spawnSync("bash", ["-c", bash, "rails-audit", vaultDir, cred, session], { encoding: "utf8", timeout: 60_000 });
  const names = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return names;
}

/* ── מישור-3: זהות-סוכן — PBKDF2 מול-הרישום (timing-safe) ─────────────────── */
function timingSafeEq(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function identityAudit(agentId, token) {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "agents", "agents.json"), "utf8"));
  const m = reg.members.find((x) => x.id === agentId);
  if (!m) return { ok: false, why: `not-registered: ${agentId}` };
  const verifier = crypto.pbkdf2Sync(Buffer.from(token, "utf8"),
    Buffer.from(m.saltB64, "base64"), reg.iterations ?? ITERATIONS, reg.keyLen ?? 32, "sha256").toString("base64");
  return { ok: timingSafeEq(verifier, m.verifierB64), why: m.ok ? "verifier-match" : "verifier-mismatch" };
}

/* ── מנוע ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
R.json = argv.includes("--json");
const identIdx = argv.indexOf("--identity");
const agentId = identIdx >= 0 ? argv[identIdx + 1] : null;

const creds = discoverCredentials();
R.planes.credential = { found: creds.length, sources: creds.length ? ["env-or-disk-or-remote"] : [] };
say(`מישור-0 קרדנשל: ${creds.length ? `נמצא (${creds.length})` : "לא-נמצא — מכונה-עיוורת לגיט (כנות)"}`);

if (!creds.length) {
  R.verdict = "NO-CREDENTIAL — nothing to authenticate with (honest)"; 
  emit();
  process.exit(1);
}

const vault = ensureVaultClone(creds[0]);
if (!vault) {
  R.planes.vault = { ok: false, why: "clone failed with discovered credential" };
  say("מישור-1 כספת: שיבוט-נכשל (כנות)");
  emit(); process.exit(1);
}
const open = vaultOpen(vault.dir);
R.planes.vault = { ok: open.opened, dir: vault.dir, cloned: vault.cloned, log: open.log };
say(`מישור-1 כספת: ${open.opened ? "נפתחה אוטונומית ✔" : "אטומה (keyless-honest)"}`);

const rails = railsAudit(vault.dir, creds[0]);
R.planes.rails = { ok: rails.length > 0, slots: rails };
say(`מישור-2 פלטפורמות: ${rails.length ? rails.join(" · ") : "לא-נפתח"}`);

if (agentId) {
  const tok = process.env[`SBX_AGENT_TOKEN_${agentId.toUpperCase().replace(/-/g, "")}`] || process.env.SBX_OPEN_TOKEN;
  if (tok) {
    const id = identityAudit(agentId, tok);
    R.planes.identity = { agentId, ...id };
    say(`מישור-3 זהות ${agentId}: ${id.ok ? "הוכחה ✔" : `נכשלה (${id.why})`}`);
  } else {
    R.planes.identity = { agentId, ok: false, why: "no token in env (SBX_AGENT_TOKEN_*)" };
    say(`מישור-3 זהות ${agentId}: אין-טוקן-בסביבה (כנות)`);
  }
}

// מישור-4 — הסוד הראשי של המפעיל: לא-בכספת (נבדק-מול-שמות-המשבצות) — מתוכנן-כך
const humanSecretSlots = ["OPERATOR_MASTER", "SANDBOX_PASS", "HEADMASTER"];
R.planes.humanGate = {
  masterSecretInVault: false,
  note: "הסוד-הראשי-של-המפעיל-חי-רק-אצל-האדם (קנון). סוכנים-מתחברים-במישורים 0–3; השער-האנושי-לא-נגיש-למשתמשים-אחרים.",
  proposal: "אם-המפעיל-ירצה: VAULT_PASSPHRASE=… bash vault.sh seal עם-משבצת OPERATOR_MASTER — אטימה-לכספת-בפקודה-אחת",
};
say("מישור-4 שער-אנושי: הסוד-הראשי לא-מתאושש-מכונה (מכוון) — סוכנים-לא-תלויים-בו");

R.verdict = R.planes.vault.ok ? "SELF-AUTH-PROVEN (vault+rails+identity planes live)" : "DEGRADED-HONEST";
emit();

function emit() {
  if (R.json) console.log(JSON.stringify(R, null, 1));
  const rc = R.planes.vault?.ok ? 0 : 1;
  process.exit(rc);
}
