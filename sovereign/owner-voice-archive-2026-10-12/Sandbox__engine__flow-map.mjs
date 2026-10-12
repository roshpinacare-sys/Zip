// ═══════════════════════════════════════════════════════════════════════════
// ARTERY-FLOW-MAP · מפת-הזרימה של האורגניזם — "הכל משתמש בהכל" מדוד.
// ───────────────────────────────────────────────────────────────────────────
// הוראת-בעלים (2026-10-11): "צריך להבין איך לשלב זרימה בין כל הדברים שיש
// לנו שהכל ישתמש בהכל באיזושהי צורה למקסם יעילות של הקיים שלא סתם נשרוף
// אלא לייעל הכל."
//
// הבעיה-שנמדדה: האורגניזם מייצר עשרות פידים/ספרים/קבלות אבל אין מפה מדודה
// של מי-מאכיל-מי. תוצאה: ספרים שנכתבים-ואף-אחד-לא-קורא (שריפה), צרכנים
// שהמפיק-שלהם-מת (רפאים — נמדד: p-office -> FleetHQ/digest.json = 404),
// וקצבי-הפקה שאף-אחד לא צולב מול קצבי-צריכה.
//
// התיקון: מדידה-דטרמיניסטית, אפס-סודות, אפס-כתיבה-חוץ-מ-Sandbox:
//   nodes   = כל-מפיק (repo,path) עם גיל-מדוד (commit אחרון לנתיב, API)
//   corpus  = כל-קובץ-צריכה ידוע (דף-Domain, סוכני-Domain, workflows-שני-הריפואים)
//   edges   = אזכור-קוד מדוד בין צרכן למפיק (regex מהקורפוס, אפס-ניחוש)
//   orphans = מפיקים-שאף-צרכן-לא-מאזכר (יעדי-זיקוק, flag לא fail)
//   ghosts  = צרכנים-שהמפיק-שלהם 404 (flag)
// כל-הקשוות עם ראיה: הקובץ-הצורך + מספר-שורה. כל-הגילאים מ-API-ציבורי.
// ═══════════════════════════════════════════════════════════════════════════
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const OWNER = "roshpinacare-sys";
const H = {
  Accept: "application/vnd.github+json",
  "User-Agent": "artery-flow-map",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};
const out = (...a) => console.log(...a);
const NOW = Date.now();

// ── מניפסט-המפיקים (maxAgeH = חוק-טריות-מוצהר-לכל-פיד) ──
const NODES = [
  { repo: `${OWNER}/Sandbox`, path: "receipts/wallet/verdict.json",    kind: "receipt", maxAgeH: 2,  feeds: "artery-wallet (hourly)" },
  { repo: `${OWNER}/Sandbox`, path: "receipts/fleet/verdict.json",     kind: "receipt", maxAgeH: 3,  feeds: "artery-fleet (2h)" },
  { repo: `${OWNER}/Sandbox`, path: "receipts/grid/verdict.json",      kind: "receipt", maxAgeH: 1,  feeds: "artery-grid (30min)" },
  { repo: `${OWNER}/Sandbox`, path: "receipts/latest.json",            kind: "pulse",   maxAgeH: 1,  feeds: "sovereign.yml (~15min)" },
  { repo: `${OWNER}/Sandbox`, path: "ops/lessons/ledger.md",           kind: "lesson",  maxAgeH: 26, feeds: "artery-scribe (daily)" },
  { repo: `${OWNER}/Sandbox`, path: "ops/flow/flow-map.json",          kind: "flowmap", maxAgeH: 4,  feeds: "artery-flow (3h)" },
  { repo: `${OWNER}/FleetHQ`, path: "receipts/office-ci/verdict.json", kind: "receipt", maxAgeH: 30, feeds: "office-ci (push)" },
  { repo: `${OWNER}/FleetHQ`, path: "office/state/office-state.json",  kind: "state",   maxAgeH: 3,  feeds: "office-heartbeat (2h)" },
  { repo: `${OWNER}/FleetHQ`, path: "digest.json",                     kind: "digest",  maxAgeH: 26, feeds: "unknown (404 measured 2026-10-11)" },
  { repo: `${OWNER}/Domain`,  path: "office/data.json",                kind: "book",    maxAgeH: 1,  feeds: "office-pulse (20min)" },
  { repo: `${OWNER}/Domain`,  path: "agents/office-live.json",         kind: "book",    maxAgeH: 3,  feeds: "office-artery (2h)" },
  { repo: `${OWNER}/Domain`,  path: "dex/office-feed.json",            kind: "book",    maxAgeH: 26, feeds: "office-feed (daily)" },
  { repo: `${OWNER}/Domain`,  path: "status.json",                     kind: "book",    maxAgeH: 30, feeds: "pages build" },
  // R31 (WO-unwired-adsmarket-marketing, trace 1a12d4daf2926fd5): the public
  // measured-view book of the PRIVATE marketing source repo — the arc's public
  // face. The source (roshpinacare-sys/Adsmarket) is private: raw 404s, so the
  // node measured here is the BOOK; the book itself carries the canonical
  // source pointers (one-room law — zero content duplication).
  { repo: `${OWNER}/Domain`,  path: "marketing/adsmarket.json",        kind: "book",    maxAgeH: 168, feeds: "adsmarket-panel (weekly Mon 05:41 UTC + dispatch)" },
];

// ספרי-dex: מתגלים-דינמית מה-API (אסור-להניח-רשימה-סטטית)
const DEX_MAX_AGE = { "watch.json": 26, "grid.json": 26, "world.json": 26 };

// ── קורפוס-הצריכה: קבצים-שנסרקים-לאזכורים (raw, לא-נגד-מגבלת-API) ──
const CORPUS = [
  { repo: `${OWNER}/Domain`,  path: "index.html",                         role: "page" },
  { repo: `${OWNER}/Domain`,  path: "agents/office-pulse.cjs",            role: "agent" },
  { repo: `${OWNER}/Domain`,  path: "agents/office-feed.mjs",             role: "agent" },
  { repo: `${OWNER}/Domain`,  path: "agents/office-artery.mjs",           role: "agent" },
  { repo: `${OWNER}/Sandbox`, path: "engine/scribe.mjs",                  role: "learner" },
  { repo: `${OWNER}/Sandbox`, path: ".github/workflows/artery-watch.yml", role: "watch" },
  { repo: `${OWNER}/Domain`,  path: "marketing/adsmarket.html",            role: "page" }, // R31: the panel page consuming the measured book
];

const rawText = async (repo, p) => {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/${p}`, { headers: { "User-Agent": "artery-flow" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`raw ${repo}/${p} -> ${r.status}`);
  return r.text();
};

// גיל-מדוד של נתיב: ה-commit האחרון-שנוגע-בו (מקור-אמת-הטריות)
async function lastCommit(repo, p) {
  const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(p)}&per_page=1`;
  const r = await fetch(url, { headers: H });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error(`commits ${repo}/${p} -> ${r.status}`);
  let arr = await r.json();
  // H-fix: producers can live on the pages branch (FleetHQ convention: office-pages) or the Pages deployment itself —
  // a 404 on main is NOT proof of death (the digest ghost was exactly this blind spot, measured live 2026-10-11).
  if (!arr.length) {
    try {
      const r2 = await fetch(`https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(p)}&sha=office-pages&per_page=1`, { headers: H });
      if (r2.ok) {
        const arr2 = await r2.json();
        if (arr2.length) arr = arr2;
      }
    } catch { /* honest fallback continues */ }
  }
  if (!arr.length) {
    try {
      const name = repo.split("/")[1];
      const r3 = await fetch(`https://${OWNER.toLowerCase()}.github.io/${name}/${p}`, { headers: { "User-Agent": "artery-flow" } });
      if (r3.ok) return { ageH: null, author: "pages-deployment", sha: "pages-live", at: null, pagesLive: true };
    } catch { /* honest missing */ }
  }
  if (!arr.length) return { missing: true };
  const c = arr[0];
  const at = Date.parse((c.commit && c.commit.committer && c.commit.committer.date) || c.commit.author.date);
  return { ageH: (NOW - at) / 3600000, author: (c.commit.author || {}).name || "unknown", sha: (c.sha || "").slice(0, 8), at: new Date(at).toISOString() };
}

// חילוץ-אזכורים מקוד: דפוסי-הפניית-פיד ידועים (ראיה-לשורה)
const PATTERNS = [
  { re: /dex\/([a-z0-9-]+\.json)/g,                      to: (m) => `${OWNER}/Domain:dex/${m[1]}` },
  { re: /roshpinacare-sys\.github\.io\/([A-Za-z0-9-]+)\/([A-Za-z0-9_\/.-]+\.(?:json|md))/g, to: (m) => `${OWNER}/${m[1]}:${m[2]}` },
  { re: /raw\.githubusercontent\.com\/roshpinacare-sys\/([A-Za-z0-9-]+)\/(?:[^\/\s'"]+)\/([A-Za-z0-9_\/.-]+\.(?:json|md))/g, to: (m) => `${OWNER}/${m[1]}:${m[2]}` },
  { re: /(?<![A-Za-z0-9_-])status\.json/g,                to: () => `${OWNER}/Domain:status.json` },
  { re: /(?<![A-Za-z0-9_-])digest\.json/g,                to: () => `${OWNER}/FleetHQ:digest.json` },
  { re: /office\/data\.json/g,                            to: () => `${OWNER}/Domain:office/data.json` },
  { re: /agents\/office-live\.json/g,                     to: () => `${OWNER}/Domain:agents/office-live.json` },
  { re: /office\/state\/office-state\.json/g,             to: () => `${OWNER}/FleetHQ:office/state/office-state.json` },
  { re: /receipts\/office-ci\/[a-z.]+/g,                  to: (m) => `${OWNER}/FleetHQ:${m[0]}` },
  { re: /ops\/lessons\/ledger\.md/g,                      to: () => `${OWNER}/Sandbox:ops/lessons/ledger.md` },
  { re: /ops\/flow\/flow-map\.json/g,                     to: () => `${OWNER}/Sandbox:ops/flow/flow-map.json` },
  { re: /receipts\/(wallet|fleet|grid)\/verdict\.json/g,  to: (m) => `${OWNER}/Sandbox:receipts/${m[1]}/verdict.json` },
  { re: /receipts\/latest\.json/g,                        to: () => `${OWNER}/Sandbox:receipts/latest.json` },
  // R31 (WO-unwired-adsmarket-marketing, trace 1a12d4daf2926fd5): the
  // adsmarket measured-view arc. The SOURCE repo is private (raw 404s), so any
  // file touching the private source or the public book lands on the book node
  // — the public face of the arc (one-room law: pointers, never prose).
  { re: /roshpinacare-sys\/Adsmarket/g,                   to: () => `${OWNER}/Domain:marketing/adsmarket.json` },
  { re: /(?<![A-Za-z0-9_-])adsmarket\.json/g,             to: () => `${OWNER}/Domain:marketing/adsmarket.json` },
];
function extractRefs(text) {
  const found = [];
  for (const { re, to } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) found.push({ key: to(m), line: text.slice(0, m.index).split("\n").length });
  }
  return found;
}

// ── 1) קורפוס ──
out("== corpus ==");
const corpusFiles = [];
for (const c of CORPUS) {
  let t = null;
  try { t = await rawText(c.repo, c.path); } catch { t = null; }
  corpusFiles.push({ ...c, refs: t ? extractRefs(t) : [] });
  out(`  ${t === null ? "MISSING" : "ok"} ${c.repo}/${c.path} refs=${corpusFiles[corpusFiles.length - 1].refs.length}`);
}
// workflows + agents של Domain — גילוי-דינמי
try {
  const addDir = async (repo, dir, role, exts, skip = []) => {
    const lr = await fetch(`https://api.github.com/repos/${repo}/contents/${dir}`, { headers: H });
    if (!lr.ok) return;
    const files = (await lr.json()).filter((f) => exts.some((e) => f.name.endsWith(e)) && !skip.includes(f.name));
    for (const f of files) {
      let t = null;
      try { t = await rawText(repo, `${dir}/${f.name}`); } catch { continue; }
      if (t === null) continue;
      corpusFiles.push({ repo, path: `${dir}/${f.name}`, role, refs: extractRefs(t) });
    }
  };
  await addDir(`${OWNER}/Domain`, ".github/workflows", "workflow", [".yml", ".yaml"]);
  await addDir(`${OWNER}/Domain`, "agents", "agent", [".mjs", ".cjs", ".js"], ["office-pulse.cjs", "office-feed.mjs", "office-artery.mjs"]);
  await addDir(`${OWNER}/Sandbox`, "engine", "engine", [".mjs"], ["flow-map.mjs"]);
} catch (e) { out(`  corpus-dynamic error: ${e.message}`); }
out(`  corpus total files: ${corpusFiles.length}`);

// ── 2) צמתים: מניפסט + גילאים-מדודים ──
out("== nodes ==");
const nodes = [];
for (const n of NODES) {
  const entry = { ...n, key: `${n.repo}:${n.path}` };
  // H-fix: ה-special-case-הישן-ל-digest.json הוסר — הוא-בדק-raw-root-בלבד (404) ופסל-מפיק-חי;
  // lastCommit-המתוקן מכסה main -> office-pages -> Pages-deployment (מדוד: אמת-חיים-אמיתית).
  try {
    const m = await lastCommit(n.repo, n.path);
    entry.missing = !!m.missing;
    entry.ageH = m.ageH ?? null;
    entry.author = m.author;
    entry.sha = m.sha;
    entry.at = m.at;
    if (m.pagesLive) entry.pagesLive = true;
  } catch (e) { entry.error = e.message.slice(0, 100); }
  nodes.push(entry);
  out(`  ${entry.key} ${entry.missing ? "MISSING" : `age=${entry.ageH == null ? "?" : entry.ageH.toFixed(1) + "h"} by=${entry.author || "?"}`}`);
}

// dex-ספרים: גילוי-דינמי + גיל-מדוד
try {
  const dr = await fetch(`https://api.github.com/repos/${OWNER}/Domain/contents/dex`, { headers: H });
  if (dr.ok) {
    const books = (await dr.json()).filter((f) => f.name.endsWith(".json"));
    for (const b of books) {
      const path = `dex/${b.name}`;
      if (nodes.some((n) => n.path === path)) continue;
      const m = await lastCommit(`${OWNER}/Domain`, path).catch((e) => ({ error: e.message }));
      nodes.push({ repo: `${OWNER}/Domain`, path, key: `${OWNER}/Domain:${path}`, kind: "book", maxAgeH: DEX_MAX_AGE[b.name] || 48, feeds: "discovered", missing: !!m.missing, ageH: m.ageH ?? null, author: m.author, sha: m.sha, at: m.at });
    }
  }
} catch (e) { out(`  dex-discovery error: ${e.message}`); }

// ── 3) קשתות: אזכור-קוד מדוד ──
out("== edges ==");
const edges = [];
const byKey = new Map(nodes.map((n) => [n.key, n]));
for (const cf of corpusFiles) {
  for (const ref of cf.refs) {
    const node = byKey.get(ref.key);
    if (!node) continue; // אזכור-ללא-צומת-מניפסט = רעש-קוד, לא-קשת
    edges.push({ from: `${cf.repo}/${cf.path} (${cf.role})`, to: ref.key, evidenceLine: ref.line, nodeAgeH: node.ageH, nodeMissing: !!node.missing });
  }
}
const seen = new Set();
const uniqEdges = edges.filter((e) => { const k = `${e.from}|${e.to}`; if (seen.has(k)) return false; seen.add(k); return true; });
for (const e of uniqEdges) out(`  ${e.from} -> ${e.to} (line ${e.evidenceLine})`);

// ── 3b) סטיית-תוכן-מול-קומיט (גילוי-תיאטרון: קומיט-חד-של-תוכן-ישן) ──
out("== content ages ==");
const CONTENT_FIELD = ["publishedAt", "capturedAt", "generatedAt", "at", "writtenAt"];
for (const n of nodes) {
  if (n.missing || n.kind === "lesson" || n.kind === "receipt") continue;
  try {
    const t = await rawText(n.repo, n.path);
    if (t === null) continue;
    let j = null;
    try { j = JSON.parse(t); } catch { continue; }
    const f = CONTENT_FIELD.find((k) => j && typeof j[k] === "string" && !Number.isNaN(Date.parse(j[k])));
    if (!f) continue;
    n.contentAt = j[f];
    n.contentAgeH = Math.round(((NOW - Date.parse(j[f])) / 3600000) * 100) / 100;
    if (n.ageH != null && n.contentAgeH - n.ageH > 12) n.contentDivergence = true;
    out(`  ${n.key} commit=${n.ageH?.toFixed(1)}h content=${n.contentAgeH?.toFixed(1)}h${n.contentDivergence ? " DIVERGENT" : ""}`);
  } catch { /* non-fatal */ }
}

// ── 4) זיקוק: אינטגרציה-אמיתית מול יתומים (טרנזיטיבי דרך-מזיני-דף) ──
const consumedKeys = new Set(uniqEdges.map((e) => e.to));
const consumersOf = (key) => uniqEdges.filter((e) => e.to === key).map((e) => ({ from: e.from, role: e.from.match(/\(([^)]+)\)$/)?.[1] || "?", file: e.from }));
// מעבר-1: צריכה-ישירה-של-הדף
for (const n of nodes) {
  const cons = consumersOf(n.key);
  n.consumers = cons.map((c) => c.from);
  n.pageConsumed = cons.some((c) => c.role === "page");
}
// מעבר-2: מזינים — סוכן-שהפלט-שלו-נצרך-על-ידי-הדף (נמדד, לא נאמד):
//   office-pulse.cjs קורא קבלות -> כותב office/data.json -> הדף צורך.
//   רשימה-דטרמיניסטית-בקוד: הרחבה = קומיט גלוי, לא שתיקה.
const FEEDER_FILES = new Set([
  "roshpinacare-sys/Domain/agents/office-pulse.cjs",
]);
for (const n of nodes) {
  if (n.pageConsumed) continue;
  n.pageConsumed = n.consumers.some((c) => FEEDER_FILES.has(c.replace(/ \([^)]+\)$/, "")));
}
for (const n of nodes) {
  n.integration = n.missing ? "GHOST-SOURCE" : n.kind === "flowmap" ? "SELF" : n.consumers.length === 0 ? "ORPHAN" : n.pageConsumed ? "INTEGRATED" : "PLANE-INTERNAL";
}
const orphans = nodes.filter((n) => n.integration === "ORPHAN");
const planeInternal = nodes.filter((n) => n.integration === "PLANE-INTERNAL");
const ghosts = uniqEdges.filter((e) => e.nodeMissing);
const stale = uniqEdges.filter((e) => e.nodeAgeH != null && e.nodeAgeH > (byKey.get(e.to)?.maxAgeH ?? 48));

// ── 5) פלטים כנים ──
const alerts = [];
for (const g of ghosts) alerts.push({ law: "law-ghost-consumer", severity: "flag", detail: `${g.to} referenced by ${g.from} but MISSING (404)` });
for (const s of stale) alerts.push({ law: "law-feed-fresh", severity: "flag", detail: `${s.to} age=${s.nodeAgeH?.toFixed(1)}h > ${byKey.get(s.to)?.maxAgeH}h (consumer: ${s.from})` });
for (const o of orphans) alerts.push({ law: "law-orphan-producer", severity: "flag", detail: `${o.key} produced (${o.feeds}) but no consumer found in corpus` });
for (const l of planeInternal) alerts.push({ law: "law-plane-internal", severity: "flag", detail: `${l.key} circulates only inside its producer plane — verify the organ's own output flows somewhere` });
for (const n of nodes) if (n.contentDivergence) alerts.push({ law: "law-content-divergence", severity: "flag", detail: `${n.key} commit-age=${n.ageH?.toFixed(1)}h but content-age=${n.contentAgeH?.toFixed(1)}h — fresh commits of stale content` });

const map = {
  generatedAt: new Date().toISOString(),
  owner: OWNER,
  corpusFiles: corpusFiles.map((c) => `${c.repo}/${c.path} [${c.role}]`),
  nodes: nodes.map(({ key, kind, path, repo, ageH, missing, author, sha, maxAgeH, feeds, contentAt, contentAgeH, contentDivergence, integration, pageConsumed, consumers }) => ({ key, kind, path, repo, ageH: ageH == null ? null : Math.round(ageH * 100) / 100, missing: !!missing, author: author || null, sha: sha || null, maxAgeH, feeds, contentAt: contentAt || null, contentAgeH: contentAgeH ?? null, contentDivergence: !!contentDivergence, integration, pageConsumed, consumers })),
  loopOnly: planeInternal.map((l) => l.key),
  edges: uniqEdges,
  orphans: orphans.map((o) => ({ key: o.key, feeds: o.feeds })),
  ghosts: ghosts.map((g) => ({ consumer: g.from, target: g.to })),
  stale: stale.map((s) => ({ consumer: s.from, target: s.to, ageH: Math.round(s.nodeAgeH * 10) / 10 })),
  summary: { nodes: nodes.length, edges: uniqEdges.length, orphans: orphans.length, planeInternal: planeInternal.length, ghosts: ghosts.length, stale: stale.length, integrated: nodes.filter((n) => n.integration === "INTEGRATED").length, flowDensity: nodes.length ? Math.round((uniqEdges.length / nodes.length) * 100) / 100 : 0 },
  alerts,
};

mkdirSync("ops/flow", { recursive: true });
writeFileSync("ops/flow/flow-map.json", JSON.stringify(map, null, 2) + "\n");

const mdRows = nodes
  .map((n) => `| \`${n.path}\` | ${n.repo.split("/")[1]} | ${n.kind} | ${n.missing ? "**MISSING**" : n.ageH == null ? "?" : `${n.ageH.toFixed(1)}h`} | <=${n.maxAgeH}h | ${n.feeds} | ${n.integration} |`)
  .join("\n");
const md = [
  "# FLOW MAP · מפת-הזרימה המדודה של האורגניזם",
  "",
  `נמדד: ${map.generatedAt}`,
  `צומת=${nodes.length} · קשת=${uniqEdges.length} · רפאים=${ghosts.length} · ישנים=${stale.length} · יתומים=${orphans.length} · פנים-מישורי=${planeInternal.length} · משולב-דף=${map.summary.integrated} · צפיפות-זרימה=${map.summary.flowDensity}`,
  "",
  "| פיד | ריפו | סוג | גיל | חוק-טריות | מי-מייצר | אינטגרציה |",
  "|---|---|---|---|---|---|---|",
  mdRows,
  "",
  "## רפאים (צרכן-חי על מפיק-מת) — flag",
  ...(ghosts.length ? ghosts.map((g) => `- ${g.from} -> \`${g.to}\``) : ["- none"]),
  "",
  "## ישנים-מעבר-חוק (flag)",
  ...(stale.length ? stale.map((s) => `- ${s.from} -> \`${s.to}\` age=${s.nodeAgeH?.toFixed(1)}h`) : ["- none"]),
  "",
  "## יתומים (מפיק-שאף-אחד-לא-קורא) — יעדי-זיקוק, flag",
  ...(orphans.length ? orphans.map((o) => `- \`${o.key}\` (${o.feeds})`) : ["- none"]),
  "",
  "## פנים-מישורי (מסתובב-רק-בתוך-האיבר-שמייצר-אותו) — flag",
  ...(planeInternal.length ? planeInternal.map((l) => `- \`${l.key}\` (${l.feeds})`) : ["- none"]),
  "",
  "## סטיית-תוכן-מול-קומיט (קומיט-חד-של-תוכן-ישן) — flag",
  ...(nodes.filter((n) => n.contentDivergence).length ? nodes.filter((n) => n.contentDivergence).map((n) => `- \`${n.key}\` commit=${n.ageH?.toFixed(1)}h content=${n.contentAgeH?.toFixed(1)}h`) : ["- none"]),
  "",
].join("\n");
writeFileSync("ops/flow/flow-map.md", md);

const receipt = {
  at: new Date().toISOString(),
  overall: "PASS",
  alerts,
  summary: map.summary,
  provenance: {
    runId: process.env.GITHUB_RUN_ID || null,
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    sha: process.env.GITHUB_SHA || null,
  },
};
writeFileSync("ops/flow/receipt.json", JSON.stringify(receipt, null, 2) + "\n");
appendFileSync("ops/flow/log.jsonl", JSON.stringify({ at: receipt.at, overall: receipt.overall, summary: map.summary, alerts: alerts.length }) + "\n");

out("== verdict ==");
out(`PASS · nodes=${nodes.length} edges=${uniqEdges.length} orphans=${orphans.length} ghosts=${ghosts.length} stale=${stale.length} alerts=${alerts.length}`);
process.exit(0);
