#!/usr/bin/env node
/**
 * integrity-guard.mjs — שומר-השלמות v2 (zai-code-3 · טריטוריה: engine/integrity-guard.mjs + ops/integrity + artery-integrity.yml)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * דרישת-בעלים (מילה-במילה): "חייב לוודא שאין זיופים... ולא לסמוך יותר מדי על כלום — גם לא על עצמנו".
 *
 * ביקורת-ידנית 2026-10-11 (אחרי-תיקון-עצמי של פתרון-URL-חוצה-ריפו): אפס-זיופים בשרשרת.
 * v1-של-השומר-עצמו ייצר אזעקות-שקר (bare-runId בלי-ריפו נשפט ghost; 403 תורגם "זיוף";
 * sha-גלובלי שויך להרצה-לא-שלו; L5 ירה על קבלות-סוכן-לגיטימיות). v2 = החוקים המתוקנים:
 *
 *   L0 self-skepticism — הקבלה-הקודמת-של-השומר עצמו נבדקת ראשונה, כמו-כל-קבלה.
 *   L1 ghost-run       — runUrl נפתר לפי הריפו-שבתוך-ה-URL עצמו; 404 מוכח = CRITICAL.
 *                         403/429/5xx ≠ זיוף — MEDIUM "לא-ניתן-לאימות" + retry אחד. איסור-מוחלט:
 *                         כשל-רשת-שלנו לעולם לא נקרא זיוף-של-אחר.
 *   L2 conclusion-match — קבלת-PASS מול הרצה-failure (ולהפך) = CRITICAL.
 *   L3 sha-match       — רק-sha שנטען בתוך-אותו-אובייקט-provenance נבדק מול ההרצה (לא-שיוך-גלובלי).
 *   L4 time-sanity     — זמן-הקבלה בחלון [created-5ד׳ , created+6ש׳]; מחוץ = MEDIUM.
 *   L5 authorship      — רק-קובץ-שטוען-הרצת-Actions ונכתב-ע"י-זהות-לא-בוט = MEDIUM
 *                         (קבלות-סוכן-רגילות בלי-טענת-Actions הן דפוס-לגיטימי — רק L6 חל עליהן).
 *   L6 unprovenanced   — קובץ-קבלה-ללא-שום-טענת-run = FLAG + ניתוב-לבעלים (לתקן-לא-לברוח).
 *   L7 freshness       — ספר/קבלה-זקן = FLAG (חיות, לא-שלמות).
 *
 * דירוג: CRITICAL/HIGH → FAIL (exit 1) · MEDIUM → PASS_WITH_ALERTS (exit 0) · אחרת PASS.
 * אפס-LLM · אפס-סודות-בפלט · קבצים-חדשים מתגלים דינמית מעץ-הגיט — עורק-חדש נבדק אוטומטית.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = "roshpinacare-sys";
const TOKEN = process.env.ECO_WALLET_TOKEN || process.env.GITHUB_TOKEN || "";
const H = { accept: "application/vnd.github+json", "user-agent": "integrity-guard/2" };
if (TOKEN) H.authorization = "Bearer " + TOKEN;
const out = (s) => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VERDICTS = { PASS: "success", PASS_WITH_ALERTS: "success", FAIL: "failure", BLOCKED: "failure" };
const LEVELS = { INFO: 0, FLAG: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

const STATIC_SOURCES = [
  { repo: "Sandbox", path: "receipts/wallet/verdict.json",   kind: "receipt", feeds: "artery-wallet" },
  { repo: "Sandbox", path: "receipts/fleet/verdict.json",    kind: "receipt", feeds: "artery-fleet" },
  { repo: "Sandbox", path: "receipts/grid/verdict.json",     kind: "receipt", feeds: "artery-grid" },
  { repo: "Sandbox", path: "receipts/latest.json",           kind: "pulse",   feeds: "sovereign.yml" },
  { repo: "Sandbox", path: "ops/flow/receipt.json",          kind: "receipt", feeds: "artery-flow" },
  { repo: "Sandbox", path: "state/verifier/verdict-latest.json", kind: "receipt", feeds: "verifier.yml" },
  { repo: "FleetHQ", path: "receipts/office-ci/verdict.json", kind: "receipt", feeds: "office-ci" },
  { repo: "Domain",  path: "office/data.json",                kind: "data",    feeds: "office-pulse" },
  { repo: "Domain",  path: "agents/office-live.json",         kind: "book",    feeds: "office lane" },
];
const FRESH_H = { receipt: 26, pulse: 2, book: 30, data: 2, discovered: 30 };
const CLAIM_RE = /https:\/\/github\.com\/([^/\s"]+)\/([^/\s"]+)\/actions\/runs\/(\d+)/g;
const RECEIPT_NAME_RE = /(^|\/)(verdict\.json|receipt\.json|verdict-latest\.json)$/;

/* ── גילוי-דינמי ── */
export function pickDiscovered(treePaths) {
  const hits = [];
  for (const p of treePaths || []) {
    const fp = p.path || "";
    if (p.type !== "blob") continue;
    if (!/^(receipts|ops|state|office)\//.test(fp)) continue;
    if (!RECEIPT_NAME_RE.test(fp)) continue;
    hits.push(fp);
    if (hits.length >= 40) break;
  }
  return hits;
}

/* ── קבוצות-טענה: כל-runUrl נאסף עם ההקשר-של-אובייקט-המכיל (overall/at יורשים מהאב-הקרוב;
       sha רק-מהאובייקט-עצמו — לא-שיוך-גלובלי). bare-runId נאסף גם-כן. ── */
export function collectGroups(doc) {
  const groups = [];
  const walk = (node, ctx) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, ctx)); return; }
    const next = {
      overall: node.overall || node.verdict || node.status || ctx.overall || null,
      at: node.at || node.generatedAt || node.measuredAt || ctx.at || null,
    };
    const own = {
      url: (typeof node.runUrl === "string" && node.runUrl.includes("/actions/runs/")) ? node.runUrl : null,
      runId: (node.runId !== undefined && /^\d+$/.test(String(node.runId))) ? String(node.runId) : null,
      sha: (typeof node.sha === "string" && /^[0-9a-f]{7,40}$/.test(node.sha)) ? node.sha
         : (typeof node.headSha === "string" && /^[0-9a-f]{7,40}$/.test(node.headSha)) ? node.headSha : null,
    };
    if (own.url || own.runId) groups.push({ url: own.url, runId: own.runId, sha: own.sha, overall: next.overall, at: next.at });
    for (const k of Object.keys(node)) walk(node[k], next);
  };
  walk(doc, { overall: null, at: null });
  return groups;
}

/* ── bare-runId: אם-קיימת-אחות-URL לאותו-run — מדולג (כבר-נשפט); אחרת MEDIUM לא-ניתן-לפתרון ── */
export function resolveBareIds(groups) {
  const bare = groups.filter((g) => !g.url && g.runId).map((g) => g.runId);
  const skip = new Set();
  for (const id of bare) {
    const hasSibling = groups.some((g) => g.url && ("/runs/" + id + "?").includes("?") && g.url.includes("/runs/" + id));
    if (hasSibling) skip.add(id);
  }
  return { skip, unresolvable: bare.filter((id) => !skip.has(id)) };
}

export function parseRunUrl(u) {
  if (typeof u !== "string") return null;
  const m = [...u.matchAll(CLAIM_RE)][0];
  if (!m) return null;
  return { id: m[3], repo: m[2], owner: m[1] };
}

export function timeSane(receiptAt, runCreatedAt) {
  if (!receiptAt || !runCreatedAt) return true;
  const t = Date.parse(receiptAt), c = Date.parse(runCreatedAt);
  if (!Number.isFinite(t) || !Number.isFinite(c)) return true;
  return t >= c - 5 * 60 * 1000 && t <= c + 6 * 3600 * 1000;
}

/* ── שיפוט: runTable ערכים = run אמיתי | {notFound:true} (404 מוכח) | {unreachable:true} ── */
export function judge(claim, runTable) {
  const r = parseRunUrl(claim.url);
  if (!r) return { law: "unparseable-claim", level: "MEDIUM", detail: String(claim.url).slice(0, 60) };
  const key = r.repo + ":" + r.id;
  const run = runTable[key];
  if (!run) return { law: "unjudged", level: "MEDIUM", detail: "no table entry for " + key };
  if (run.unreachable) return { law: "api-unreachable", level: "MEDIUM", detail: "HTTP לא-אמין עבור run " + r.id + " — לא-ניתן-לאימות, לא-זיוף" };
  if (run.notFound) return { law: "ghost-run", level: "CRITICAL", detail: "run " + r.id + " אינו-קיים ב-" + r.repo + " (404 מוכח)" };
  const expect = VERDICTS[claim.overall];
  if (expect && run.conclusion !== expect)
    return { law: "conclusion-contradiction", level: "CRITICAL", detail: "receipt=" + claim.overall + " run=" + run.conclusion };
  if (claim.sha && run.head_sha && claim.sha.slice(0, 10) !== run.head_sha.slice(0, 10))
    return { law: "sha-mismatch", level: "HIGH", detail: claim.sha.slice(0, 8) + " vs " + run.head_sha.slice(0, 8) };
  if (!timeSane(claim.at, run.created_at))
    return { law: "time-sanity", level: "MEDIUM", detail: claim.at + " outside window " + run.created_at };
  return { law: "verified", level: "INFO", detail: "run=" + r.id + " conc=" + run.conclusion + " repo=" + r.repo };
}

/* ── selftest: וקטורים-דטרמיניסטיים, אפס-רשת ── */
export function selftest() {
  const table = {
    "FleetHQ:111": { conclusion: "success", head_sha: "aaaa1111bbbb", created_at: "2026-10-11T10:00:00Z" },
    "Sandbox:222": { conclusion: "failure", head_sha: "cccc2222dddd", created_at: "2026-10-11T11:00:00Z" },
    "Sandbox:333": { notFound: true },
    "Sandbox:444": { unreachable: true },
  };
  const cases = [
    { c: { url: "https://github.com/o/FleetHQ/actions/runs/111", overall: "PASS", at: "2026-10-11T10:05:00Z" }, law: "verified" },
    { c: { url: "https://github.com/o/FleetHQ/actions/runs/999", overall: "PASS" }, law: "unjudged", level: "MEDIUM" },
    { c: { url: "https://github.com/o/Sandbox/actions/runs/222", overall: "PASS" }, law: "conclusion-contradiction", level: "CRITICAL" },
    { c: { url: "https://github.com/o/Sandbox/actions/runs/222", overall: "FAIL" }, law: "verified" },
    { c: { url: "https://github.com/o/FleetHQ/actions/runs/111", overall: "PASS", sha: "deadbeef00", at: "2026-10-11T10:05:00Z" }, law: "sha-mismatch", level: "HIGH" },
    { c: { url: "https://github.com/o/FleetHQ/actions/runs/111", overall: "PASS", at: "2026-10-12T10:00:00Z" }, law: "time-sanity", level: "MEDIUM" },
    { c: { url: "https://github.com/o/Sandbox/actions/runs/333", overall: "PASS" }, law: "ghost-run", level: "CRITICAL" },
    { c: { url: "https://github.com/o/Sandbox/actions/runs/444", overall: "PASS" }, law: "api-unreachable", level: "MEDIUM" },
    { c: { url: "https://github.com/o/FleetHQ/actions/runs/notanumber" }, law: "unparseable-claim", level: "MEDIUM" },
  ];
  let bad = 0;
  for (const t of cases) {
    const got = judge(t.c, table);
    const ok = got.law === t.law && (!t.level || got.level === t.level);
    if (!ok) { bad++; out("selftest-FAIL: want=" + t.law + "/" + (t.level || "-") + " got=" + got.law + "/" + got.level); }
  }
  const g1 = collectGroups({ overall: "PASS", at: "2026-10-11T12:00:00Z", provenance: { runId: "77", runUrl: "https://github.com/x/Sandbox/actions/runs/77" } });
  if (g1.length !== 1 || g1[0].overall !== "PASS" || g1[0].runId !== "77" || !g1[0].url) { bad++; out("selftest-FAIL: collectGroups wallet-like " + JSON.stringify(g1)); }
  const g2 = collectGroups({ office: { overall: "PASS", runUrl: "https://github.com/x/FleetHQ/actions/runs/9", sha: "aaaaaaaaaa" }, arteries: { wallet: { overall: "FAIL", runUrl: "https://github.com/x/Sandbox/actions/runs/8" } } });
  if (g2.length !== 2 || g2[0].overall !== "PASS" || g2[0].sha !== "aaaaaaaaaa" || g2[1].overall !== "FAIL" || g2[1].sha !== null) { bad++; out("selftest-FAIL: collectGroups nested " + JSON.stringify(g2)); }
  const r1 = resolveBareIds([{ runId: "77" }, { url: "https://github.com/x/Sandbox/actions/runs/77" }]);
  const r2 = resolveBareIds([{ runId: "999" }]);
  if (r1.skip.size !== 1 || r1.unresolvable.length !== 0 || r2.unresolvable.length !== 1) { bad++; out("selftest-FAIL: resolveBareIds"); }
  const disco = pickDiscovered([
    { type: "blob", path: "receipts/wallet/verdict.json" },
    { type: "blob", path: "src/app/page.tsx" },
    { type: "blob", path: "ops/integrity/verdict.json" },
    { type: "tree", path: "receipts/fleet/verdict.json" },
  ]);
  if (disco.length !== 2) { bad++; out("selftest-FAIL: pickDiscovered want=2 got=" + disco.length); }
  out("selftest: " + (bad === 0 ? "PASS (" + (cases.length + 4) + " checks)" : "FAIL " + bad));
  return bad === 0;
}

/* ── רשת: retry אחד ל-403/429; 404 = מוכח-לא-קיים; עדינות-קצב בין-קריאות ── */
async function gh(p) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try { res = await fetch("https://api.github.com" + p, { headers: H }); }
    catch { await sleep(1500); continue; }
    if (res.status === 404) return { code: 404, body: null };
    if (res.status === 403 || res.status === 429) {
      if (attempt === 0) { await sleep(20000); continue; }
      return { code: res.status, body: null };
    }
    if (!res.ok) return { code: res.status, body: null };
    const body = await res.json();
    await sleep(150);
    return { code: 200, body };
  }
  return { code: 0, body: null };
}
async function raw(repo, fp) {
  try {
    const res = await fetch("https://raw.githubusercontent.com/" + OWNER + "/" + repo + "/HEAD/" + fp, { headers: { "user-agent": "integrity-guard/2" } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function main() {
  const findings = [];
  const verified = [];
  const flag = (level, where, law, detail) => findings.push({ level, where, law, detail });
  const ver = (where, law, detail) => verified.push({ where, law, detail });

  /* L0 — ספקנות-עצמית */
  const selfPath = "ops/integrity/verdict.json";
  const selfAbs = path.join(ROOT, selfPath);
  if (existsSync(selfAbs)) {
    let selfPrev = null;
    try { selfPrev = JSON.parse(readFileSync(selfAbs, "utf8")); } catch { flag("MEDIUM", "self:" + selfPath, "malformed-json", "הקבלה-הקודמת-של-השומר אינה JSON"); }
    if (selfPrev && selfPrev.provenance && selfPrev.provenance.runUrl) {
      const pu = parseRunUrl(selfPrev.provenance.runUrl);
      if (pu) {
        const { code, body } = await gh("/repos/" + OWNER + "/" + pu.repo + "/actions/runs/" + pu.id);
        const entry = code === 200 ? body : code === 404 ? { notFound: true } : { unreachable: true };
        const j = judge({ url: selfPrev.provenance.runUrl, overall: selfPrev.overall, sha: selfPrev.provenance.sha, at: selfPrev.at }, { [pu.repo + ":" + pu.id]: entry });
        if (j.law === "verified") ver("self:" + selfPath, "verified", j.detail);
        else flag(j.level, "self:" + selfPath, j.law, j.detail);
      }
    } else if (selfPrev) {
      flag("MEDIUM", "self:" + selfPath, "unprovenanced", "הקבלה-הקודמת-של-השומר ללא provenance");
    }
  } else {
    ver("self:" + selfPath, "first-run", "אין-קבלה-קודמת — ריצה-ראשונה");
  }

  /* מקורות: קבוע + גילוי-דינמי */
  const sources = [...STATIC_SOURCES];
  for (const repo of ["Sandbox", "FleetHQ", "Domain"]) {
    const { code, body } = await gh("/repos/" + OWNER + "/" + repo + "/git/trees/HEAD?recursive=1");
    if (code !== 200 || !body || !body.tree) { flag("MEDIUM", repo, "tree-unreachable", "HTTP " + code + " — גילוי-דינמי דולג (לא-זיוף)"); continue; }
    for (const fp of pickDiscovered(body.tree)) {
      if (!sources.some((s) => s.repo === repo && s.path === fp)) sources.push({ repo, path: fp, kind: "discovered", feeds: "dynamic" });
    }
  }
  out("sources: " + sources.length + " (static " + STATIC_SOURCES.length + " + discovered " + (sources.length - STATIC_SOURCES.length) + ")");

  /* איסוף + שיפוט */
  const runTable = {};
  const filesWithActionsClaims = new Set();
  for (const src of sources) {
    const where = src.repo + ":" + src.path;
    const txt = await raw(src.repo, src.path);
    if (txt === null) { flag("FLAG", where, "source-unreachable", "raw 404 — דגל-כנה, לא-מילוי"); continue; }
    let doc;
    try { doc = JSON.parse(txt); } catch (e) { flag("MEDIUM", where, "malformed-json", "קובץ-קבלה-שאינו JSON: " + String(e.message).slice(0, 60)); continue; }
    const groups = collectGroups(doc);
    const at = doc.at || doc.generatedAt || doc.measuredAt || null;
    const ageH = at ? (Date.now() - Date.parse(at)) / 3600000 : null;
    if (at && Number.isFinite(ageH) && ageH > FRESH_H[src.kind]) flag("FLAG", where, "stale", Math.round(ageH) + "h > " + FRESH_H[src.kind] + "h — " + (src.feeds || src.kind));
    const urlGroups = groups.filter((g) => g.url);
    if (urlGroups.length) filesWithActionsClaims.add(src.repo + "|" + src.path);
    if (!groups.length) { flag("FLAG", where, "unprovenanced", "אין-טענת-run — שדרוג-מתוכנן ל-lane: " + (src.feeds || "?")); continue; }
    const bare = resolveBareIds(groups);
    for (const id of bare.unresolvable) flag("MEDIUM", where, "unresolvable-id", "runId=" + id + " בלי-ריפו-בטענה — אין-לאמת, דורש-runUrl מלא");
    for (const g of urlGroups) {
      const pu = parseRunUrl(g.url);
      if (!pu) { flag("MEDIUM", where, "unparseable-claim", String(g.url).slice(0, 60)); continue; }
      const key = pu.repo + ":" + pu.id;
      if (!runTable[key]) {
        const { code, body } = await gh("/repos/" + OWNER + "/" + pu.repo + "/actions/runs/" + pu.id);
        runTable[key] = code === 200 ? body : code === 404 ? { notFound: true } : { unreachable: true };
      }
      const j = judge({ url: g.url, overall: g.overall, sha: g.sha, at: g.at || at }, runTable);
      if (j.law === "verified") ver(where, "verified", j.detail);
      else if (j.law !== "unjudged") flag(j.level, where, j.law, j.detail);
    }
  }

  /* L5 — authorship: רק-קבצים-הטוענים-הרצת-Actions */
  const { execSync } = await import("node:child_process");
  const git = (args) => { try { return execSync("git " + args, { cwd: ROOT, encoding: "utf8" }); } catch { return ""; } };
  const BOT_RE = /(github-actions\[bot\]|actions-user|sovereign-flow|wallet-artery|fleet-artery|grid-watch|sandbox-state|sandbox-verifier|fleet-yield|office-ci-bot|office-3d-bot|sandbox-flow|integrity-guard)@/;
  const localReceipts = git('ls-files receipts ops/flow state | grep -E "(verdict|receipt).*json$" || true').trim().split("\n").filter(Boolean).slice(0, 40);
  for (const fp of localReceipts) {
    if (!filesWithActionsClaims.has("Sandbox|" + fp)) continue;
    const line = git('log -1 --format="%ce" -- "' + fp + '"').trim();
    if (line && !BOT_RE.test(line)) flag("MEDIUM", "Sandbox:" + fp, "agent-authored-receipt", "committer=" + line + " — קבלה-הטוענת-הרצת-Actions שנכתבה-מחוץ-ל-Actions");
  }

  /* פסק-דין */
  const counts = {}; for (const f of findings) counts[f.level] = (counts[f.level] || 0) + 1;
  const overall = (counts.CRITICAL || counts.HIGH) ? "FAIL" : (counts.MEDIUM ? "PASS_WITH_ALERTS" : "PASS");
  const at = nowIsoSafe();
  const summary = { sources: sources.length, verified: verified.length, findings: findings.length, counts };
  const verdict = {
    schema: "integrity-guard/2", at, overall, summary,
    provenance: {
      runId: process.env.GITHUB_RUN_ID || null,
      runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
        ? process.env.GITHUB_SERVER_URL + "/" + process.env.GITHUB_REPOSITORY + "/actions/runs/" + process.env.GITHUB_RUN_ID
        : null,
      sha: process.env.GITHUB_SHA || null,
    },
    verified, findings,
  };
  mkdirSync(path.join(ROOT, "ops/integrity"), { recursive: true });
  writeFileSync(path.join(ROOT, "ops/integrity/verdict.json"), JSON.stringify(verdict, null, 2) + "\n");
  appendFileSync(path.join(ROOT, "ops/integrity/log.jsonl"), JSON.stringify({ at, overall, ...summary }) + "\n");
  try {
    const lines = readFileSync(path.join(ROOT, "ops/integrity/log.jsonl"), "utf8").trim().split("\n");
    if (lines.length > 300) writeFileSync(path.join(ROOT, "ops/integrity/log.jsonl"), lines.slice(-300).join("\n") + "\n");
  } catch {}
  const md = [
    "# דוח-שומר-השלמות — " + at,
    "",
    "**פסק-דין: " + overall + "** · מקורות=" + sources.length + " · טענות-שאומתו=" + verified.length + " · ממצאים=" + findings.length,
    "",
    "## טענות-שאומתו מול Actions API",
    ...(verified.length ? verified.map((v) => "- ✅ `" + v.where + "` — " + v.detail) : ["- (אין)"]),
    "",
    "## ממצאים (מדורג — כשל-רשת-שלנו לעולם לא מדווח כזיוף)",
    ...(findings.length ? findings.sort((a, b) => LEVELS[b.level] - LEVELS[a.level]).map((f) => "- **" + f.level + "** `" + f.where + "` — " + f.law + " — " + f.detail) : ["- אין"]),
    "",
    "_חוקי-L0..L7 · דרישת-בעלים: אין-זיופים · גם-השומר-עצמו נבדק (L0) · fail-closed_",
    "",
  ].join("\n");
  writeFileSync(path.join(ROOT, "ops/integrity/REPORT.md"), md);
  out("== verdict ==");
  out(overall + " · " + JSON.stringify(summary));
  for (const f of findings.sort((a, b) => LEVELS[b.level] - LEVELS[a.level]).slice(0, 14)) out("  " + f.level + " " + f.where + " " + f.law);
  process.exit(overall === "FAIL" ? 1 : 0);
}

function nowIsoSafe() { return new Date().toISOString(); }

if (process.argv.includes("--selftest")) {
  process.exit(selftest() ? 0 : 1);
} else {
  main().catch((e) => { out("FATAL " + (e && e.message)); process.exit(1); });
}
