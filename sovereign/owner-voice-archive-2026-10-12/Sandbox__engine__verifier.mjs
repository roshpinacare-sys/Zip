#!/usr/bin/env node
/**
 * verifier.mjs — עורק-האמת (zai-verifier · טריטוריה: ops/agents/zai-verifier + state/verifier)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * הבעיה-שנמדדה-חי: סוכנים מקבילים "מאשרים-הכל-תקין" — והבעלים מגלה שדברים לא עובדים.
 * הפתרון: בקר-אמת עצמאי שמוכיח בראיות-חיצוניות (RPC ציבורי · GitHub API · סריקת-עץ מקומית)
 * מה-עובד, מה-מת, ואם-יש בנייה-אמיתית (לא רק דופק-מצב). אפס-מפתחות-חתימה; קריאה-בלבד.
 *
 * בדיקות (כל-בדיקה = כלל-אובייקטיבי מ-config.json — לא דעת-סוכן):
 *   A. sbx.wf-<name>   — בריאות-עורקי-הסנדבוקס: גיל-ההצלחה-האחרונה מול-משבצת-הצפוי (stale/red).
 *   B. dev.rate        — קצב-בנייה-אמת: commits-24h לכל-ריפו-נצפה, מסווגים code/churn/docs
 *                        (דופק-בלי-בנייה = DEGRADED; זו-השאלה של-הבעלים: "אין התפתחות אמיתית").
 *   C. steem.fleet     — אמת-על-השרשרת: SP/VP/פוסט-אחרון/הצבעה-אחרונה לכל-הצי (RPC ציבורי, keyless).
 *   D. blurt.alive     — האם-לופ-הבלורט חי (נמדד: מת-מ-2026-10-04) או RPC בלתי-נגיש מהרץ.
 *   E. rot.hygiene     — ריקבון-מצבות: שורת-מצבה-פגומה (תא `undefined`/`[object Object]` במקום-hash)
 *                        — תיעוד-עצמי אינו מצבה (חוק-הזיהוי-המדויק ב-scanRot למטה).
 *
 * פלטים (כולם בטריטוריה-שלי בלבד — אף-קובץ-של-אחר אינו-נכתב):
 *   state/verifier/verdict-latest.json      — קבלת-הראש (מנוע/פאנל קוראים)
 *   state/verifier/history.jsonl            — פנקס-מרקל append-only (tail-512; דפוס-federation)
 *   ops/agents/zai-verifier/REPORT.md       — דוח-אמת-מלא בעברית + דלתא-מול-הריצה-הקודמת
 *   ops/agents/zai-verifier/TASKS.md        — מאגר-משימות-חי (append-only; OPEN/CLOSED לפי-מצב-הכללים)
 *   status/truth.html                       — עמוד-האמת-הציבורי (8: נאפה-מהמדידה בכל-ריצה; אפס-JS;
 *                                             Pages מעלה-אותו-אוטומטית — שכבה-3 של-התוכנית)
 *
 * מצערת: --guard-minutes (ברירת-מחדל 22) — קבלה-טרייה-מדי → VERIFIER-SUPPRESSED, אפס-כתיבה,
 * אות ticked=0 (הרצה-מדולגת-אינה-מולידה-יורשת; דפוס-T-42). --force עוקף (אימות-בלבד).
 * אמת-עצמית: node engine/verifier.mjs --verify-ledger → הליכת-מרקל, exit 0 אם-שלמה.
 * איסור: אפס-סודות · אפס-נתיבי-מכונה · אפס-המצאה — כל-טענה נמדדת או מסומנת UNMEASURED/UNREACHABLE.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/* ── דרגות-אמת: סדר-קבוע; overall = הדרגה-הגבוהה-שנצרתה ── */
const LEVELS = { OK: 0, NOTICE: 1, DEGRADED: 2, FAIL: 3 };
const maxLevel = (xs) => xs.reduce((a, b) => (LEVELS[b] > LEVELS[a] ? b : a), "OK");

/* ── config: ולידציה-כנה — מבנה-רע = זריקה, לא-ניחוש ── */
export function loadConfig(raw) {
  let c;
  try { c = JSON.parse(raw); } catch (e) { throw new Error("config: not valid JSON — " + e.message); }
  if (c?.schema !== "verifier-config/1") throw new Error('config: schema must be "verifier-config/1"');
  if (typeof c?.owner !== "string" || !c.owner) throw new Error("config: owner required");
  if (!Array.isArray(c?.monitor?.repos) || c.monitor.repos.length === 0) throw new Error("config: monitor.repos[] required");
  if (!Array.isArray(c?.sandbox?.coreWorkflows) || c.sandbox.coreWorkflows.length === 0) throw new Error("config: sandbox.coreWorkflows[] required");
  if (!Array.isArray(c?.steem?.accounts) || !Array.isArray(c?.steem?.rpc) || !c.steem.rpc.length) throw new Error("config: steem.accounts[] + steem.rpc[] required");
  return c;
}

/* ── GitHub API — הטוקן-עובר-ל-header-בלבד; הודעות-שגיאה-מעולם-לא-מצטטות-אותו ── */
async function gh(cfg, p) {
  const url = `https://api.github.com${p}`;
  const headers = { accept: "application/vnd.github+json", "user-agent": "sandbox-verifier/1" };
  const tok = cfg.tokens.gh || cfg.tokens.fed;
  if (tok) headers.authorization = `Bearer ${tok}`;
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new Error(`api ${p} → network failure: ${String(e?.cause?.message ?? e.message).slice(0, 80)}`); }
  if (r.status === 404) return null;
  if (!r.ok) {
    const rem = r.headers.get("x-ratelimit-remaining");
    throw new Error(`api ${p} → HTTP ${r.status}${rem != null ? ` (rate remaining: ${rem})` : ""}`);
  }
  return r.json();
}

/* ── RPC-ציבורי (JSON-RPC 2.0, batch) — keyless; כל-קריאה = timeout + ניסיון-שני ── */
export async function rpcBatch(host, calls) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params ?? [] }));
  const doOnce = async () => {
    const r = await fetch(host, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "sandbox-verifier/1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await doOnce(); } catch (e) { lastErr = e; }
  }
  throw new Error(`rpc ${host} unreachable: ${String(lastErr?.message ?? lastErr).slice(0, 80)}`);
}

/* ── עזרי-זמן: טימסטמפ-שרשרת-חסר-אזור-זמן = UTC ── */
function ageHours(iso, nowMs) {
  if (!iso) return null;
  let t = Date.parse(iso);
  if (!Number.isFinite(t)) t = Date.parse(iso + "Z");
  if (!Number.isFinite(t)) return null;
  if (t <= 0) return null; // epoch = מעולם-לא
  return Math.round(((nowMs - t) / 3600000) * 10) / 10;
}

/* ── A. בריאות-עורקי-הסנדבוקס (שאילתה-פר-workflow — לקח-חי: דגימה-גלובלית-שטחית הפלילה-עורק-שעתי) ── */
export async function checkSandboxWorkflows(cfg, _runs) {
  const checks = [];
  const core = cfg.sandbox.coreWorkflows;
  const now = Date.now();
  for (const wf of core) {
    const expect = cfg.sandbox.maxGapMinutes ?? 120;
    const per = (cfg.sandbox.wfMaxGapMinutes?.[wf.name] ?? expect) * 60000;
    let done = [], tried = 0;
    try {
      const j = await gh(cfg, `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.sandboxRepo ?? "Sandbox")}/actions/workflows/${encodeURIComponent(wf.file)}/runs?per_page=8`);
      // ריצת-cancelled = מיזוג-עיצוב (concurrency "אפס-סערת-הרצות") — ניטרלית: לא-הצלחה,
      // לא-כישלון, ולכן-לא-צורכת-מחלון-החיות. בלי-זה, דופק-push-כפול-מנפח-את-החלון
      // ומדרג-עורק-חי-ככוזב-FAIL (נמדד-חי 15:14 2026-10-11; הצלחה-אמתית-עמדה-במקום).
      done = (j?.workflow_runs ?? []).filter((r) => r.conclusion && r.conclusion !== "cancelled");
      tried = done.length;
    } catch (e) {
      checks.push({ id: `sbx.wf-${wf.name}`, level: "NOTICE", why: "runs unreadable: " + String(e.message).slice(0, 100), evidence: null });
      continue;
    }
    const lastSuccess = done.find((r) => r.conclusion === "success");
    const lastAny = done[0] ?? null;
    const redRecent = done.filter((r) => ["failure", "startup_failure", "timed_out"].includes(r.conclusion)).length;
    const ageMs = lastSuccess?.created_at ? now - Date.parse(lastSuccess.created_at) : null;
    let level = "OK", why = "success recent";
    if (!lastSuccess) { level = "FAIL"; why = `no success in last ${tried} runs of ${wf.file}`; }
    else if (ageMs != null && ageMs > per * 4) { level = "FAIL"; why = `last success ${Math.round(ageMs / 60000)}min ago > 4x slot`; }
    else if (ageMs != null && ageMs > per) { level = "DEGRADED"; why = `last success ${Math.round(ageMs / 60000)}min ago > slot`; }
    else if (lastAny && lastAny.conclusion !== "success" && redRecent > 0) { level = "NOTICE"; why = `latest completed=${lastAny.conclusion}`; }
    checks.push({ id: `sbx.wf-${wf.name}`, level, why, evidence: lastSuccess ? { at: lastSuccess.created_at, url: lastSuccess.html_url } : null });
  }
  return checks;
}

/* ── B. סיווג-commits: code/churn/docs (הכלל-מתועד-ב-README של-הטריטוריה) ── */
const CHURN_DIR_RE = /^(state|receipts|federation|network|status|ops|console\/state)\//;
const CODE_EXT_RE = /\.(mjs|cjs|js|ts|tsx|jsx|py|sh|html|css|scss|sql|prisma|ya?ml|toml)$/;
const CODE_NAME_RE = /(^|\/)(package\.json|package-lock\.json|tsconfig\.json|Dockerfile|docker-compose\.ya?ml)$/;
export function classifyCommit(files) {
  let code = 0, churn = 0, docs = 0;
  for (const f of files) {
    const p = f.filename ?? "";
    if (p.endsWith(".jsonl") || CHURN_DIR_RE.test(p)) churn++;
    else if (CODE_EXT_RE.test(p) || CODE_NAME_RE.test(p)) code++;
    else if (/\.md$/i.test(p)) docs++;
    else if (p.endsWith(".json")) churn++;
    else code++;
  }
  if (code > 0) return "code";
  if (churn > 0) return "churn";
  if (docs > 0) return "docs";
  return "other";
}

/* ── B. קצב-בנייה-אמת לכל-האחוזה (תקציב-קריאות קבוע — לעולם-לא-בלי-גבול) ── */
export async function measureDevRate(cfg, windowHours) {
  const since = new Date(Date.now() - windowHours * 3600000).toISOString();
  const repos = [];
  let budget = cfg.rules?.fileBudget ?? 42;
  let totalCommits = 0, codeCommits = 0, classified = 0, budgetExhausted = false;
  for (const name of cfg.monitor.repos) {
    const meta = await gh(cfg, `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(name)}`).catch(() => null);
    const commits = await gh(cfg, `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(name)}/commits?since=${since}&per_page=100`).catch(() => null);
    if (commits === null && meta === null) { repos.push({ name, status: "UNVERIFIED-PRIVATE-OR-GONE" }); continue; }
    const list = Array.isArray(commits) ? commits : [];
    const rec = { name, visibility: meta?.private ? "private" : "public", pushedAt: meta?.pushed_at ?? null, commits24h: list.length, redWorkflowEcho: null };
    if (commits === null && meta !== null) rec.status = "UNMEASURED (api error)";
    else totalCommits += list.length;
    if (list.length > 0 && budget > 0) {
      let cls = { code: 0, churn: 0, docs: 0, other: 0 };
      for (const c of list.slice(0, 12)) {
        if (budget <= 0) break;
        budget--;
        const det = await gh(cfg, `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(name)}/commits/${c.sha}`).catch(() => null);
        if (!det) continue;
        cls[classifyCommit(det.files ?? [])]++;
      }
      const sum = cls.code + cls.churn + cls.docs + cls.other;
      if (sum > 0) {
        rec.codeShare = Math.round((cls.code / sum) * 100);
        rec.sampleSize = sum;
        codeCommits += cls.code; classified += sum;
      } else rec.codeShare = "UNMEASURED (budget)";
      if (budget <= 0) budgetExhausted = true;
    } else if (list.length > 0) { rec.codeShare = "UNMEASURED (budget)"; budgetExhausted = true; }
    else rec.codeShare = null;
    repos.push(rec);
  }
  const rate = classified > 0 ? Math.round((codeCommits / classified) * 100) : null;
  return { windowHours, repos, totalCommits, codeRatePercent: rate, classified, budgetExhausted };
}

/* ── C. אמת-על-השרשרת: Steem (SP/VP/פעילות) ── */
export function computeFleet(accounts, dgpo) {
  const spPerVest = parseFloat(dgpo.total_vesting_fund_steem) / parseFloat(dgpo.total_vesting_shares);
  const now = Date.now();
  return accounts.map((a) => {
    if (!a) return { account: "?", exists: false };
    const vests = parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares) + parseFloat(a.received_vesting_shares);
    const vpRaw = typeof a.voting_power === "number" ? a.voting_power : null;
    const postIso = a.last_root_post ?? a.last_post ?? a.last_post_time ?? null;
    return {
      account: a.name,
      exists: true,
      sp: Math.round(vests * spPerVest),
      vpPercent: vpRaw == null ? null : vpRaw <= 100 ? vpRaw : Math.round(vpRaw / 100),
      lastPostAgeHours: ageHours(postIso, now),
      lastVoteAgeHours: ageHours(a.last_vote_time, now),
    };
  });
}
export async function probeSteem(cfg) {
  const host = cfg.steem.rpc[0];
  const res = await rpcBatch(host, [
    { method: "condenser_api.get_accounts", params: [cfg.steem.accounts] },
    { method: "condenser_api.get_dynamic_global_properties" },
  ]);
  const accounts = res?.[0]?.result ?? null;
  const dgpo = res?.[1]?.result ?? null;
  if (!Array.isArray(accounts) || !dgpo?.total_vesting_fund_steem) throw new Error("steem rpc: malformed response");
  const fleet = computeFleet(accounts, dgpo);
  const now = Date.now();
  const postAges = fleet.filter((f) => f.exists && f.lastPostAgeHours != null).map((f) => f.lastPostAgeHours);
  const treasury = fleet.find((f) => f.account === cfg.steem.treasury) ?? null;
  return { host, fleet, treasury, fleetNewestPostHours: postAges.length ? Math.min(...postAges) : null, probedAt: new Date(now).toISOString() };
}

/* ── RPC-יחיד (אובייקט-בודד — לקח-חי: blurt.blog דוחה batch ב-"Not a valid json request"; beblurt מפנה-308 אליו) ── */
export async function rpcSingle(host, method, params = []) {
  const doOnce = async () => {
    const r = await fetch(host, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "sandbox-verifier/1" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await doOnce();
      if (j?.error) throw new Error(String(j.error.message ?? "rpc error").slice(0, 80));
      return j?.result ?? null;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`rpc ${host} unreachable: ${String(lastErr?.message ?? lastErr).slice(0, 80)}`);
}

/* ── D. Blurt — חי/מת/בלתי-נגיש (כנות-מלאה לכל-מצב) ── */
export async function probeBlurt(cfg) {
  const errs = [];
  for (const host of cfg.blurt.rpc) {
    try {
      const accounts = await rpcSingle(host, "condenser_api.get_accounts", [cfg.blurt.accounts]);
      if (!Array.isArray(accounts) || accounts.length === 0) { errs.push(`${host}: empty`); continue; }
      const now = Date.now();
      const fleet = accounts.map((a) => ({ account: a.name, lastPostAgeHours: ageHours(a.last_root_post ?? a.last_post ?? a.last_post_time ?? null, now), lastVoteAgeHours: ageHours(a.last_vote_time, now) }));
      const postAges = fleet.filter((f) => f.lastPostAgeHours != null).map((f) => f.lastPostAgeHours);
      return { host, reachable: true, fleet, fleetNewestPostHours: postAges.length ? Math.min(...postAges) : null, probedAt: new Date(now).toISOString() };
    } catch (e) { errs.push(`${host}: ${String(e.message).slice(0, 60)}`); }
  }
  return { reachable: false, errors: errs, probedAt: new Date().toISOString() };
}

/* ── E. ריקבון-מצבות — סריקת-עץ-מקומית (אפס-קריאות-רשת) ──
 * חוק-הזיהוי-המדויק (תיקון-דיופליקציה 7-d): מצבה-רקובה = שורת-טבלה שמכילה את סימון-המצבה
 * `sha256 העותק שהיה כאן` ושאחד-מהתאים שלה הוא הליטרל `undefined` / `[object Object]`
 * (ג'נרטור-המצבות כתב ליטרל במקום-hash של-64-hex).
 * מה-שאינו-מספיק-עוד: הופעת-המחרוזת "sha256: undefined" אי-שם-בקובץ. ה-README/REPORT/TASKS
 * של-המאמת עצמו מתעדים-את-הבעיה בטקסט-שלהם, והכלל-הישן (regex על כל-הקובץ) הדליק את
 * בית-הסורק על-עצמו בכל-ריצה — דיופליקציה-עצמית-קבועה. לכן:
 *   (א) בדיקה שורה-בשורה ולא הקובץ-כולו כטקסט-אחד;
 *   (ב) שורות-בתוך-גדר-קוד (```/~~~) = תיעוד-לדוגמה — נמדלות;
 *   (ג) טריטוריית-המאמת ops/agents/zai-verifier — נשמטת-כולה: בית-הסורק דן-במצבות מטבע-הדבר.
 * אימות: --scan-rot (הרצה-יבשה, אפס-רשת ואפס-כתיבה) · opts.root להזרקת-fixture בבדיקות.
 */
const ROT_SKIP_PREFIXES = ["ops/agents/zai-verifier/"];
const ROT_FENCE = /^\s*(```|~~~)/;
function isCorruptedTombstoneLine(line) {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false; // מצבות: שורות-טבלה בלבד — פרוזה/ראיות-אינן-מצבה
  if (!line.includes("sha256") || !line.includes("העותק שהיה כאן")) return false; // סימון-המצבה הקנוני
  const cells = t.slice(1, -1).split("|").map((c) => c.trim());
  return cells.some((c) => c === "undefined" || c === "[object Object]"); // התא-הפגום: ליטרל במקום-hash
}
export function scanRot(cfg, opts = {}) {
  const roots = ["ops", "federation", "state", "receipts", "docs", "console", "network", "status"];
  const baseDir = opts.root ?? ROOT;
  const hits = [];
  let scanned = 0;
  for (const dir of roots) {
    const base = path.join(baseDir, dir);
    if (!existsSync(base)) continue;
    let files = [];
    try { files = execSync(`git ls-files -- '${dir}'`, { cwd: baseDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean); } catch { continue; }
    for (const rel of files) {
      if (ROT_SKIP_PREFIXES.some((pre) => rel === pre || rel.startsWith(pre))) continue;
      const p = path.join(baseDir, rel);
      try {
        const sz = statSync(p).size;
        if (sz > 900000) continue;
        const txt = readFileSync(p, "utf8");
        scanned++;
        let inFence = false;
        for (const line of txt.split("\n")) {
          if (ROT_FENCE.test(line)) { inFence = !inFence; continue; }
          if (!inFence && isCorruptedTombstoneLine(line)) { hits.push(rel); break; }
        }
      } catch { /* בינארי/לא-קיים */ }
      if (hits.length >= 25) break;
    }
    if (hits.length >= 25) break;
  }
  return { scanned, hits, capped: hits.length >= 25 };
}

/* ── כללים → דרגות (הכל-מ-config — אפס-דעה-אישית) ── */
function applyRules(cfg, { sbx, dev, steem, blurt, rot }) {
  const checks = [...sbx];
  const r = cfg.rules ?? {};
  if (dev.totalCommits >= (r.lowDevMinCommits ?? 15) && typeof dev.codeRatePercent === "number") {
    if (dev.codeRatePercent < (r.lowDevPercent ?? 10))
      checks.push({ id: "dev.rate", level: "DEGRADED", why: `heartbeat-without-building: codeShare ${dev.codeRatePercent}% < ${r.lowDevPercent ?? 10}% over ${dev.totalCommits} commits/24h`, evidence: { windowHours: dev.windowHours } });
    else if (dev.codeRatePercent >= (r.buildingPercent ?? 25))
      checks.push({ id: "dev.rate", level: "OK", why: `building: codeShare ${dev.codeRatePercent}% over ${dev.totalCommits} commits/24h`, evidence: { windowHours: dev.windowHours } });
    else checks.push({ id: "dev.rate", level: "NOTICE", why: `mixed activity: codeShare ${dev.codeRatePercent}%`, evidence: { windowHours: dev.windowHours } });
  } else checks.push({ id: "dev.rate", level: "NOTICE", why: `sample: ${dev.totalCommits} commits/24h, codeShare UNMEASURED or small`, evidence: { classified: dev.classified } });

  const newest = steem?.fleetNewestPostHours ?? null;
  if (newest == null) checks.push({ id: "steem.fleet", level: "DEGRADED", why: "no fleet post timestamp measurable (all never-posted or rpc partial)" });
  else if (newest > (r.steemFailDays ?? 7) * 24) checks.push({ id: "steem.fleet", level: "FAIL", why: `fleet silent ${Math.round(newest)}h > ${(r.steemFailDays ?? 7) * 24}h`, evidence: { newestPostHours: newest } });
  else if (newest > (r.steemDegradedHours ?? 48)) checks.push({ id: "steem.fleet", level: "DEGRADED", why: `fleet silent ${newest}h (policy: 2-3 posts/week/account)`, evidence: { newestPostHours: newest } });
  else checks.push({ id: "steem.fleet", level: "OK", why: `fleet posted ${newest}h ago`, evidence: { newestPostHours: newest } });

  const t = steem?.treasury;
  if (t && typeof t.sp === "number" && t.sp < (r.treasuryMinSp ?? 3000))
    checks.push({ id: "steem.treasury", level: "DEGRADED", why: `treasury ${t.account} at ${t.sp} SP < ${r.treasuryMinSp ?? 3000} (recovery-plan §3)`, evidence: { sp: t.sp } });
  else checks.push({ id: "steem.treasury", level: t ? "OK" : "NOTICE", why: t ? `treasury ${t.account} at ${t.sp} SP` : "treasury account absent" });

  if (!blurt.reachable) checks.push({ id: "blurt.alive", level: "NOTICE", why: `blurt RPC unreachable from runner (${blurt.errors?.length ?? 0} hosts tried) — UNREACHABLE, לא "מת" עד-שיימד`, evidence: { hosts: cfg.blurt.rpc } });
  else {
    const bNewest = blurt.fleetNewestPostHours;
    if (bNewest == null) checks.push({ id: "blurt.alive", level: "FAIL", why: "blurt fleet never posted" });
    else if (bNewest > (r.blurtDeadDays ?? 7) * 24) checks.push({ id: "blurt.alive", level: "FAIL", why: `blurt fleet silent ${Math.round(bNewest)}h > ${(r.blurtDeadDays ?? 7) * 24}h — loop dead until proven otherwise`, evidence: { newestPostHours: bNewest } });
    else if (bNewest > 48) checks.push({ id: "blurt.alive", level: "DEGRADED", why: `blurt fleet silent ${bNewest}h`, evidence: { newestPostHours: bNewest } });
    else checks.push({ id: "blurt.alive", level: "OK", why: `blurt fleet posted ${bNewest}h ago`, evidence: { newestPostHours: bNewest } });
  }

  if (rot.hits.length > 0) checks.push({ id: "rot.hygiene", level: "DEGRADED", why: `tombstone rot: ${rot.hits.length} file(s) with corrupted sha256 pointers`, evidence: { sample: rot.hits.slice(0, 5) } });
  else checks.push({ id: "rot.hygiene", level: "OK", why: `no tombstone rot in ${rot.scanned} files scanned` });
  return checks;
}

/* ── משימות-חי: OPEN/CLOSED — append-only עם-דידופליקציה ── */
function ruleToTask(id) {
  if (id === "blurt.alive") return { tid: "V-BLURT-REVIVE", action: "החייאת-לופ-בלורט דרך gated blurt-connector (תנאי: P0 מפתחות-חדשים; workflow_dispatch בלבד + reviewer)" };
  if (id === "steem.fleet") return { tid: "V-GRID-REVIVE", action: "החייאת-מסלול-פרסום-הצי לפי-מדיניות §4 (2-3 פוסטים/שבוע/חשבון, ייחודיות, גילוי-נאות)" };
  if (id === "steem.treasury") return { tid: "V-TREASURY-BALANCE", action: "איזון-אוצר לפי §3: לשמר ≥3,000 SP אצל-האוצר; top-up חשבונות-פעילים ל-100 SP" };
  if (id.startsWith("sbx.wf-")) return { tid: `V-LOOP-${id.replace("sbx.wf-", "").toUpperCase()}`, action: "עורק-סנדבוקס סטלה/אדום — בדיקת-שורש + רה-הצתה (workflow_dispatch / תיקון-ה-workflow)" };
  if (id === "dev.rate") return { tid: "V-DEV-FOCUS", action: "דופק-בלי-בנייה: להפנות-משאב-סוכנים מטביעות-מצב לבניית-מוצר/תיקונים אמתיים" };
  if (id === "rot.hygiene") return { tid: "V-ROT-HYGIENE", action: "ניקוי-מצבות-מקולקלות (sha256: undefined) + תיקון-מנוע-הדידופליקציה שיוצר-אותן" };
  return null;
}
export function updateTasks(existingText, checks, nowIso) {
  const open = new Map();
  for (const line of (existingText ?? "").split("\n")) {
    const m = line.match(/^-\s\[(OPEN|CLOSED[^\]]*)\]\s(V-[A-Z0-9-]+)/);
    if (m) open.set(m[2], m[1] === "OPEN");
  }
  const fired = [];
  for (const c of checks) {
    const t = ruleToTask(c.id);
    if (t && LEVELS[c.level] >= LEVELS.DEGRADED) fired.push({ ...t, level: c.level, why: c.why });
  }
  const add = [];
  for (const f of fired) if (open.get(f.tid) !== true) add.push(`- [OPEN] ${f.tid} (${f.level} @ ${nowIso}): ${f.action} | ראיה: ${String(f.why).slice(0, 160)}`);
  const close = [];
  for (const [tid, isOpen] of open) {
    if (!isOpen) continue;
    const stillFired = fired.some((f) => f.tid === tid);
    if (!stillFired) close.push(`- [CLOSED ${nowIso}] ${tid} — הכלל-כבר-לא-נצרת (ראה-דוח-הריצה-הנוכחית)`);
  }
  return { add, close };
}

/* ── פנקס-מרקל — דפוס-verbatim מ-federation/fleet-yield (תאימות-קנון) ── */
export function readLastLine(p) {
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1] : null;
}
function buildChained(ledgerPath, payload) {
  const prev = readLastLine(ledgerPath);
  const prevChain = prev ? (() => { try { return JSON.parse(prev)?.chain?.cur ?? null; } catch { return null; } })() : null;
  const cur = sha256(JSON.stringify({ ...payload, prevChain }));
  return { ...payload, prevChain, chain: { prev: prevChain, cur } };
}
export function verifyLedger(lines) {
  const out = { count: 0, unbroken: true, head: null, brokeAt: null, reason: null };
  let prev = null;
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch {
      return { ...out, unbroken: false, brokeAt: out.count, reason: "unparseable line" };
    }
    const { chain, prevChain, ...body } = rec;
    const expect = chain ? sha256(JSON.stringify({ ...body, prevChain: chain.prev ?? null })) : null;
    const prevCur = prev ? prev.chain.cur : null;
    if (!chain || chain.prev !== prevCur || chain.cur !== expect) {
      return { count: out.count, unbroken: false, head: prevCur, brokeAt: out.count, reason: !chain ? "missing chain" : chain.prev !== prevCur ? "prev-link mismatch" : "cur-hash mismatch" };
    }
    prev = rec;
    out.count++;
  }
  out.head = prev ? prev.chain.cur : null;
  return out;
}

/* ── redact — יישור-קו-עם-federation (שמות-עבריים→כינויים-בטוחים) ── */
/* [zai-15c] 2026-10-12: += אוצר-הצי — יישור-קו עם ה-scrub של המפעיל (1bb4eff, mandate trace
   1a12d7cad62cbc29: "operator handle neutralized") — הסורק נאפה-מחדש בכל-ריצה; בלי-המיפוי
   הזה כל-ריצה-מחדשת הייתה מחזירה את-השם-שה-scrub נטרל (מרוץ-אמת-מול-חסימה). */
const REDACT = [[/בית-הכספת/g, "vault-home"], [/roshpinacare-sys\/steem/g, "engine-home"], [/@headcorner/g, "אוצר-הצי"]];
export const redact = (s) => REDACT.reduce((a, [re, to]) => String(a).replace(re, to), s);

/* ── דוח-עברית ── */
function fmtCheck(c) { return `| \`${c.id}\` | **${c.level}** | ${String(c.why).replace(/\|/g, "/")} |`; }
function renderReport(v, cfg, prev) {
  const { checks, overall, dev, steem, blurt, rot, tookMs, at, authMode } = v;
  const sentence =
    overall === "OK" ? "הכל-עובד — ומאומת בראיות, לא בטענות." :
    overall === "NOTICE" ? "המערכת חיה; יש נקודות-תשומת-לב (ראה טבלה)." :
    overall === "DEGRADED" ? "המערכת חיה אך לא בריאה-כולה: יש עורקים/לולאות שאינם מתפקדים — עם ראיות." :
    "יש-דברים-שבורים-ממש — זה הדוח-הכן, בלי-קישוטים.";
  const delta = [];
  if (prev?.checks) {
    const prevMap = new Map(prev.checks.map((c) => [c.id, c.level]));
    for (const c of checks) {
      const p = prevMap.get(c.id);
      if (p && p !== c.level) delta.push(`- ${LEVELS[c.level] > LEVELS[p] ? "↘ התדרדר" : "↗ השתפר"}: \`${c.id}\` ${p} → **${c.level}**`);
    }
    for (const [id, p] of prevMap) if (!checks.some((c) => c.id === id)) delta.push(`- הוסר-מהבדיקה: \`${id}\` (היה ${p})`);
    for (const c of checks) if (!prevMap.has(c.id)) delta.push(`- בדיקה-חדשה: \`${c.id}\` = **${c.level}**`);
  }
  const fleetRows = (steem?.fleet ?? []).map((f) =>
    `| @${f.account} | ${f.exists ? f.sp : "—"} | ${f.vpPercent ?? "—"}% | ${f.lastPostAgeHours == null ? "מעולם-לא" : f.lastPostAgeHours + "h"} | ${f.lastVoteAgeHours == null ? "—" : f.lastVoteAgeHours + "h"} |`).join("\n");
  const devRows = dev.repos.map((r) =>
    `| ${r.name} | ${r.visibility ?? "?"} | ${r.commits24h === 100 ? "100+" : r.commits24h ?? 0} | ${typeof r.codeShare === "number" ? r.codeShare + "%" : (r.codeShare ?? "—")} | ${r.status ?? "ok"} |`).join("\n");
  const openTasks = [];
  for (const c of checks) { const t = ruleToTask(c.id); if (t && LEVELS[c.level] >= LEVELS.DEGRADED) openTasks.push(`- **${t.tid}** — ${t.action}`); }
  return [
    `# דוח-אמת (verifier) · ${at}`,
    ``,
    `**overall: ${overall}** · auth: ${authMode} · took: ${tookMs}ms · כללים: config.json (אפס-דעה-אישית)`,
    ``,
    `> ${sentence}`,
    ``,
    `## 1. בריאות-עורקי-הסנדבוקס`,
    `| בדיקה | דרגה | ראיה |`, `|---|---|---|`,
    ...checks.filter((c) => c.id.startsWith("sbx.")).map(fmtCheck),
    ``,
    `## 2. קצב-בנייה-אמת (24h · code = infra/engine/src/scripts, churn = state/receipts/ops)`,
    `| ריפו | נראות | commits-24h | code-חלק | הערה |`, `|---|---|---|---|---|`,
    devRows || `| — | — | 0 | — | אין-נתונים |`,
    ``,
    `**מדד-מסכם:** codeShare = ${dev.codeRatePercent == null ? "UNMEASURED" : dev.codeRatePercent + "%"} (${dev.classified} commits מסווגים מתוך ${dev.totalCommits})`,
    ...checks.filter((c) => c.id === "dev.rate").map((c) => `> שיפוט: \`${c.id}\` = **${c.level}** — ${c.why}`),
    ``,
    `## 3. אמת-על-השרשרת · Steem (${steem?.host ?? "UNREACHABLE"})`,
    `| חשבון | SP אפקטיבי | VP% | פוסט-אחרון | הצבעה-אחרונה |`, `|---|---|---|---|---|`,
    fleetRows || `| — | RPC לא-הגיב | — | — | — |`,
    ``,
    ...checks.filter((c) => c.id.startsWith("steem.")).map((c) => `> \`${c.id}\` = **${c.level}** — ${c.why}`),
    ``,
    `## 4. Blurt (${blurt?.reachable ? blurt.host : "UNREACHABLE"})`,
    blurt?.reachable
      ? `פוסט-צי-הכי-חדש: ${blurt.fleetNewestPostHours == null ? "מעולם-לא" : blurt.fleetNewestPostHours + "h"} · נמדד ${blurt.probedAt}`
      : `RPC בלתי-נגיש מהרץ: ${(blurt?.errors ?? []).join(" · ")}`,
    ...checks.filter((c) => c.id === "blurt.alive").map((c) => `> \`${c.id}\` = **${c.level}** — ${c.why}`),
    ``,
    `## 5. שלמות-עץ (ריקבון-מצבות)`,
    `נסרקו ${rot.scanned} קבצים; פגומים: ${rot.hits.length}${rot.hits.length ? ` · דוגמאות: ${rot.hits.slice(0, 5).join(", ")}` : ""}`,
    ``,
    `## 6. דלתא-מול-הריצה-הקודמת`,
    delta.length ? delta.join("\n") : "- ריצה-ראשונה או אפס-שינויים-בדירוגים",
    ``,
    `## 7. משימות-שנצרתו-עכשיו`,
    openTasks.length ? openTasks.join("\n") : "- אף-כלל-DEGRADED/FAIL לא חדש",
    ``,
    `## 8. שיטה-וראיות`,
    `- GitHub API: repos/commits/actions של ${cfg.owner} (read-only)`,
    `- RPC ציבורי keyless: ${cfg.steem.rpc[0]}${blurt?.reachable ? ` · ${blurt.host}` : ""}`,
    `- פנקס: state/verifier/history.jsonl (מרקל) · אימות-עצמי: node engine/verifier.mjs --verify-ledger`,
    `- קוד-הבדיקה: engine/verifier.mjs · כללים: ops/agents/zai-verifier/config.json`,
    `- עמוד-האמת-הציבורי: status/truth.html (נאפה-בכל-ריצה; Pages-מעלה-אותו ל-roshpinacare-sys.github.io/Sandbox/status/truth.html)`,
    ``,
  ].join("\n");
}

/* ── עמוד-האמת-הציבורי (8): HTML-סטטי-מהנתונים-שנמדדו-ממש-בריצה-זו. אפס-JS, אפס-fetch, אפס-סודות. ── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VERDICT_COLOR = { OK: "#3fb972", NOTICE: "#d29922", DEGRADED: "#e3811f", FAIL: "#e5534b" };
function renderTruthPage(v, cfg) {
  const { checks, overall, dev, steem, blurt, rot, at, tookMs, authMode, chain } = v;
  const lvlColor = (l) => VERDICT_COLOR[l] ?? "#8b98a5";
  const badge = (l) => `<span class="badge" style="color:${lvlColor(l)};border-color:${lvlColor(l)}">${esc(l)}</span>`;
  const arteryRows = checks.filter((c) => c.id.startsWith("sbx.")).map((c) =>
    `<tr><td class="mono">${esc(c.id)}</td><td>${badge(c.level)}</td><td class="why">${esc(c.why)}</td></tr>`).join("\n");
  const repos = [...(dev?.repos ?? [])].sort((a, b) => (b.commits24h ?? 0) - (a.commits24h ?? 0)).slice(0, 8);
  const devRows = repos.map((r) =>
    `<tr><td>${esc(r.name)}</td><td class="mono">${r.commits24h === 100 ? "100+" : esc(r.commits24h ?? 0)}</td><td>${esc(typeof r.codeShare === "number" ? r.codeShare + "%" : (r.codeShare ?? "—"))}</td><td class="why">${esc(r.status ?? "ok")}</td></tr>`).join("\n");
  const codePct = dev?.codeRatePercent ?? 0;
  const fleetRows = (steem?.fleet ?? []).filter((f) => f.exists).slice(0, 12).map((f) =>
    `<tr><td>@${esc(f.account)}</td><td class="mono">${esc(f.sp)}</td><td class="mono">${esc(f.vpPercent ?? "—")}%</td><td class="mono">${f.lastPostAgeHours == null ? "מעולם-לא" : esc(f.lastPostAgeHours) + "h"}</td></tr>`).join("\n");
  const taskRows = checks.filter((c) => LEVELS[c.level] >= LEVELS.DEGRADED && ruleToTask(c.id)).map((c) => {
    const t = ruleToTask(c.id);
    return `<li><span class="mono task-id">${esc(t.tid)}</span> ${esc(t.action)} <span class="why">· ראיה: ${esc(c.why)}</span></li>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="description" content="עורק-האמת הציבורי — נאפה מהמדידה בענן, שחזורי, אפס-טענות. כל-ערך כאן נמדד בריצת-verifier אמתית.">
<title>עורק-האמת · אמת-מדודה-ציבורית</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#0b0f14;color:#e6edf3;font:15px/1.65 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;padding:24px 16px 48px}
.wrap{max-width:960px;margin:0 auto}
.hero{border:1px solid #1f2933;background:#12181f;border-radius:14px;padding:24px;margin-bottom:16px}
.hero h1{font-size:24px;font-weight:700;letter-spacing:-.02em}
.tagline{color:#8b98a5;margin-top:6px}
.overall-line{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:14px}
.verdict{font-size:18px;font-weight:800;padding:4px 14px;border-radius:999px;border:2px solid}
.chip{color:#8b98a5;font-size:13px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;direction:ltr;unicode-bidi:embed}
section{border:1px solid #1f2933;background:#12181f;border-radius:14px;padding:20px;margin-bottom:16px}
h2{font-size:16px;font-weight:700;margin-bottom:12px;color:#e6edf3}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{color:#8b98a5;text-align:right;font-weight:600;padding:6px 8px;border-bottom:1px solid #1f2933;font-size:12px}
td{padding:7px 8px;border-bottom:1px solid #182028;vertical-align:top}
tr:last-child td{border-bottom:none}
.why{color:#8b98a5;font-size:12.5px}
.badge{font-size:11px;font-weight:800;border:1px solid;border-radius:999px;padding:1px 9px;white-space:nowrap}
.bar{height:10px;background:#182028;border-radius:999px;overflow:hidden;margin-top:8px}
.bar>span{display:block;height:100%;background:#3fb972;border-radius:999px}
.task-id{color:#d29922;font-weight:700}
ul.tasks{list-style:none;padding:0}
ul.tasks li{padding:7px 0;border-bottom:1px solid #182028}
ul.tasks li:last-child{border-bottom:none}
.code{background:#0d1319;border:1px solid #1f2933;border-radius:8px;padding:10px 12px;margin:8px 0;overflow-x:auto}
footer{color:#8b98a5;font-size:12.5px;text-align:center;margin-top:24px;line-height:2}
a{color:#3fb972;text-decoration:none}
a:hover{text-decoration:underline}
.tbl-scroll{overflow-x:auto}
@media(max-width:640px){body{padding:14px 10px 32px}.hero{padding:18px}.hero h1{font-size:20px}section{padding:14px}}
</style>
</head>
<body>
<div class="wrap">
<header class="hero">
  <h1>עורק-האמת · אמת-מדודה-ציבורית</h1>
  <p class="tagline">העמוד-הזה נאפה אוטומטית בענן מהמדידה-של-ריצת-verifier אמתית. אין-JS, אין-fetch, אין-טענות — רק-מה-שנמדד. שחזורי-ע"י-כל-צד-שלישי.</p>
  <div class="overall-line">
    <span class="verdict" style="color:${lvlColor(overall)};border-color:${lvlColor(overall)}">${esc(overall)}</span>
    <span class="chip">נמדד: <span class="mono">${esc(at)}</span></span>
    <span class="chip">משך-מדידה: <span class="mono">${esc(tookMs)}ms</span></span>
    <span class="chip">auth: <span class="mono">${esc(authMode)}</span></span>
    <span class="chip">ראש-פנקס-מרקל: <span class="mono">${esc(chain?.cur?.slice(0, 16) ?? "—")}…</span></span>
  </div>
</header>

<section>
  <h2>קצב-בנייה-אמת · 24h</h2>
  <div class="overall-line"><span class="chip">codeShare = <strong style="color:#3fb972">${esc(dev?.codeRatePercent ?? "UNMEASURED")}%</strong> · ${esc(dev?.classified ?? 0)}-קומיטים-מסווגים-מתוך-${esc(dev?.totalCommits ?? 0)}</span></div>
  <div class="bar"><span style="width:${Math.min(100, Number(codePct) || 0)}%"></span></div>
  <div class="tbl-scroll" style="margin-top:14px">
  <table><thead><tr><th>ריפו</th><th>commits-24h</th><th>code-חלק</th><th>הערה</th></tr></thead><tbody>
  ${devRows || `<tr><td colspan="4" class="why">אין-נתונים-בריצה-זו</td></tr>`}
  </tbody></table></div>
</section>

<section>
  <h2>בריאות-עורקי-הסנדבוקס</h2>
  <div class="tbl-scroll">
  <table><thead><tr><th>בדיקה</th><th>דרגה</th><th>ראיה</th></tr></thead><tbody>
  ${arteryRows || `<tr><td colspan="3" class="why">אין-בדיקות-עורק-בריצה-זו</td></tr>`}
  </tbody></table></div>
</section>

<section>
  <h2>אמת-על-השרשרת · Steem (${esc(steem?.host ?? "UNREACHABLE")})</h2>
  <p class="why" style="margin-bottom:10px">RPC ציבורי keyless · אוצר: ${steem?.treasury ? `@${esc(steem.treasury.account)} · ${esc(steem.treasury.sp)}-SP` : "—"} · פוסן-צי-החדש-ביותר: ${steem?.fleetNewestPostHours == null ? "מעולם-לא" : esc(steem.fleetNewestPostHours) + "h"}</p>
  <div class="tbl-scroll">
  <table><thead><tr><th>חשבון</th><th>SP-אפקטיבי</th><th>VP%</th><th>פוסט-אחרון</th></tr></thead><tbody>
  ${fleetRows || `<tr><td colspan="4" class="why">RPC לא-הגיב-בריצה-זו</td></tr>`}
  </tbody></table></div>
</section>

<section>
  <h2>Blurt</h2>
  ${blurt?.reachable
    ? `<p>RPC: <span class="mono">${esc(blurt.host)}</span> · פוסן-הצי-החדש-ביותר: <span class="mono">${blurt.fleetNewestPostHours == null ? "מעולם-לא" : esc(blurt.fleetNewestPostHours) + "h"}</span></p>`
    : `<p class="why">RPC בלתי-נגיש-מהרץ: ${esc((blurt?.errors ?? []).join(" · "))}</p>`}
</section>

<section>
  <h2>משימות-פתוחות (נפתחות-ונסגרות-אוטומטית-לפי-כללים)</h2>
  ${taskRows ? `<ul class="tasks">\n${taskRows}\n</ul>` : `<p class="why">אף-כלל-לא-נצרת-בריצה-זו</p>`}
  <p class="why" style="margin-top:10px">ריקבון-מצבות: נסרקו ${esc(rot?.scanned ?? 0)}-קבצים · פגומים: ${esc(rot?.hits?.length ?? 0)}</p>
</section>

<section>
  <h2>אימות-עצמאי — אל-תאמינו-לעמוד-הזה. בדקו-אותו:</h2>
  <div class="code mono"># הדוח-המלא (נוצר-באותה-ריצה):
curl -s https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/ops/agents/zai-verifier/REPORT.md

# פנקס-המרקל — שלמות-צ'יין-עצמית:
curl -s https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/state/verifier/history.jsonl | tail -3

# קוד-המדידה-עצמו (פתוח, אפס-מפתחות-חתימה):
curl -s https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/engine/verifier.mjs</div>
  <p class="why">הפנקס: append-only + חיבור-מרקל (כל-רשומה חותמת את קודמתה). אימות: <span class="mono">node engine/verifier.mjs --verify-ledger</span></p>
</section>

<footer>
  נוצר-אוטומטית בידי <a href="https://github.com/roshpinacare-sys/Sandbox/blob/main/engine/verifier.mjs">engine/verifier.mjs</a> · ריצה-זו: <span class="mono">${esc(at)}</span> · ${esc(tookMs)}ms · auth ${esc(authMode)}
  <br>כל-ערך-כאן-נמדד. מה-שלא-נמדד — לא-מוצג. כל-טענה-מפורכת-בריצה-הבאה.
</footer>
</div>
</body>
</html>\n`;
}

/* ── אות-ל-workflow ── */
function signalOutput(kv) { try { if (process.env.GITHUB_OUTPUT) fs_appendGhOutput(kv); } catch {} }
function fs_appendGhOutput(kv) { appendFileSync(process.env.GITHUB_OUTPUT, kv); }

/* ═══════════════ main ═══════════════ */
async function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const FORCE = argv.includes("--force");
  const LOCAL = argv.includes("--local");

  if (argv.includes("--verify-ledger")) {
    const p = opt("ledger", "state/verifier/history.jsonl");
    const lines = existsSync(p) ? readFileSync(p, "utf8").split("\n") : [];
    const res = verifyLedger(lines);
    console.log(JSON.stringify({ ledger: p, ...res }));
    process.exit(res.unbroken ? 0 : 1);
  }

  /* הרצה-יבשה לסריקת-הריקבון-בלבד — אפס-רשת, אפס-כתיבה (7-d: אימות-אנטי-דיופליקציה) */
  if (argv.includes("--scan-rot")) {
    const dryCfg = loadConfig(readFileSync(path.join(ROOT, "ops/agents/zai-verifier/config.json"), "utf8"));
    const res = scanRot(dryCfg);
    console.log(JSON.stringify({ dryRun: true, zeroWrites: true, zeroNetwork: true, ...res }));
    return;
  }

  const cfg = loadConfig(readFileSync(path.join(ROOT, "ops/agents/zai-verifier/config.json"), "utf8"));
  cfg.tokens = { gh: process.env.GH_TOKEN ?? "", fed: process.env.FED_TOKEN ?? "" };
  cfg.authMode = cfg.tokens.fed ? "token(fed)" : cfg.tokens.gh ? "token(gh)" : "anonymous";

  const ledgerPath = path.join(ROOT, "state/verifier/history.jsonl");
  const latestPath = path.join(ROOT, "state/verifier/verdict-latest.json");
  const reportPath = path.join(ROOT, "ops/agents/zai-verifier/REPORT.md");
  const tasksPath = path.join(ROOT, "ops/agents/zai-verifier/TASKS.md");

  /* מצערת: קבלה-טרייה → דיכוי-שקט (אפס-כתיבת-פנקס; עמוד-האמת נאפה-מחדש-מהקבלה-הקיימת — אידמפוטנטי) */
  if (!FORCE && !LOCAL) {
    const last = readLastLine(ledgerPath);
    const at = last ? (() => { try { return JSON.parse(last)?.at; } catch { return null; } })() : null;
    if (at) {
      const ageMin = (Date.now() - Date.parse(at)) / 60000;
      if (ageMin >= 0 && ageMin < Number(opt("guard-minutes", 22))) {
        /* עמוד-האמת-צריך-להתקיים-תמיד — נאפה-מהקבלה-הקיימת; אפס-שינוי-אם-גם-התבנית-לא-זזה */
        try {
          const lastReceipt = JSON.parse(readFileSync(latestPath, "utf8"));
          mkdirSync(path.join(ROOT, "status"), { recursive: true });
          writeFileSync(path.join(ROOT, "status", "truth.html"), redact(renderTruthPage(lastReceipt, cfg)));
        } catch {}
        console.log(JSON.stringify({ verdict: "VERIFIER-SUPPRESSED", ageMinutes: Math.round(ageMin), note: "receipt fresh — ledger zero-writes; truth page re-baked idempotently" }));
        signalOutput("ticked=0\n");
        return;
      }
    }
  }

  const t0 = Date.now();
  const at = new Date().toISOString();
  const prev = (() => { try { return JSON.parse(readFileSync(latestPath, "utf8")); } catch { return null; } })();

  /* הבדיקות — כל-אחת מבודדת: כישלון-בדיקה = בדיקה-אדומה, לא-קריסת-כלל */
  let sbx = [], dev = null, steem = null, blurt = null, rot = { scanned: 0, hits: [], capped: false };
  const soft = [];
  try {
    sbx = await checkSandboxWorkflows(cfg, null);
  } catch (e) { sbx = [{ id: "sbx.self", level: "FAIL", why: "sandbox actions unreadable: " + String(e.message).slice(0, 120), evidence: null }]; }
  try { dev = await measureDevRate(cfg, 24); } catch (e) { dev = { windowHours: 24, repos: [], totalCommits: 0, codeRatePercent: null, classified: 0, budgetExhausted: false }; soft.push("dev-rate partial: " + String(e.message).slice(0, 80)); }
  try { steem = await probeSteem(cfg); } catch (e) { steem = null; soft.push("steem probe failed: " + String(e.message).slice(0, 80)); }
  try { blurt = await probeBlurt(cfg); } catch (e) { blurt = { reachable: false, errors: [String(e.message).slice(0, 80)], probedAt: at }; }
  try { rot = scanRot(cfg); } catch (e) { soft.push("rot scan partial: " + String(e.message).slice(0, 80)); }

  if (!steem) {
    sbx.push({ id: "steem.rpc", level: "FAIL", why: "steem RPC unreachable/malformed from runner — אין-אמת-על-השרשרת בריצה-זו" });
    steem = { host: cfg.steem.rpc[0], fleet: [], treasury: null, fleetNewestPostHours: null, probedAt: at };
  }

  const checks = applyRules(cfg, { sbx, dev, steem, blurt, rot });
  const overall = maxLevel(checks.map((c) => c.level));
  const tookMs = Date.now() - t0;

  /* פלטים — הכל-בטריטוריה-שלי */
  mkdirSync(path.join(ROOT, "state/verifier"), { recursive: true });
  const payload = {
    schema: "verifier/1", at, overall,
    authMode: cfg.authMode,
    counts: { checks: checks.length, degraded: checks.filter((c) => c.level === "DEGRADED").length, fail: checks.filter((c) => c.level === "FAIL").length },
    levels: Object.fromEntries(checks.map((c) => [c.id, c.level])),
    checks,
    dev: { totalCommits: dev.totalCommits, codeRatePercent: dev.codeRatePercent, classified: dev.classified, repos: dev.repos },
    steem: { host: steem.host, treasury: steem.treasury, fleetNewestPostHours: steem.fleetNewestPostHours, fleet: steem.fleet },
    blurt: { reachable: blurt.reachable, host: blurt.host ?? null, fleetNewestPostHours: blurt.fleetNewestPostHours ?? null, errors: blurt.errors ?? [], probedAt: blurt.probedAt ?? null },
    rot: { scanned: rot.scanned, hits: rot.hits },
    soft,
    tookMs,
  };
  const receipt = buildChained(ledgerPath, payload);

  /* טאיל-512 לפנקס (דפוס-sovereign-tick) */
  appendFileSync(ledgerPath, redact(JSON.stringify(receipt)) + "\n");
  try {
    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean);
    if (lines.length > 512) writeFileSync(ledgerPath, lines.slice(lines.length - 512).join("\n") + "\n");
  } catch {}

  writeFileSync(latestPath, redact(JSON.stringify(receipt, null, 1)) + "\n");
  writeFileSync(reportPath, redact(renderReport(receipt, cfg, prev)));
  /* עמוד-האמת-הציבורי — נאפה-מאותם-נתונים-מדודים (8) */
  try {
    mkdirSync(path.join(ROOT, "status"), { recursive: true });
    writeFileSync(path.join(ROOT, "status", "truth.html"), redact(renderTruthPage(receipt, cfg)));
  } catch (e) { soft.push("truth-page emit failed: " + String(e?.message ?? e).slice(0, 80)); }

  /* משימות-חי (append-only) */
  let taskLines = [];
  try { taskLines = updateTasks(existsSync(tasksPath) ? readFileSync(tasksPath, "utf8") : "", checks, at); } catch {}
  if (taskLines.add.length || taskLines.close.length) {
    const header = existsSync(tasksPath) ? "" : `# TASKS · מאגר-משימות-חי של-עורק-האמת · append-only\n# נפתח-אוטומטית כשכלל נצרת (DEGRADED/FAIL) · נסגר-אוטומטית כשהכלל כבר-לא-נצרת\n`;
    appendFileSync(tasksPath, header + [...taskLines.add, ...taskLines.close].join("\n") + "\n");
  }

  console.log(JSON.stringify({ verdict: overall, counts: payload.counts, codeShare: dev.codeRatePercent, chain: receipt.chain?.cur?.slice(0, 12), tookMs }));
  signalOutput("ticked=1\n");
}

/* הרצה-ישירה-בלבד — selftest מייבא-פונקציות ואף-פעם-לא-מריץ-main */
try {
  const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  if (isMain) main().catch((e) => { console.error("FATAL " + String(e?.message ?? e).slice(0, 300)); if (e?.stack) console.error(String(e.stack).split("\n").slice(1, 6).join("\n")); process.exit(1); });
} catch { /* ייבוא-כמודול */ }
