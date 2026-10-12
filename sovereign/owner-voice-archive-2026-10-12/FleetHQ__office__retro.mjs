#!/usr/bin/env node
// retro.mjs — מחזור-השיפור-העצמי של המשרד (office self-improvement loop)
// Lane: zai-11d · owner mandate trace 1a12c9d6f5df1b95 (חקר / זיקוק / תכנון / ביצוע)
// Deed lane: zai-13c · owner mandate trace 1a12d186d2f8b86d ("make everything smarter,
//   self-training, self-checking") — the office's FIRST self-proposal executed:
//   E1 spread-regime (PROPOSALS/2026-10-11-research-e1-spread-regime.md,
//   executableBy: next-retro = this cycle) is now `builtin-e1-spread-regime`
//   (read-only/verify/doc-only) + the research layer now consumes the fleet's
//   declared work (Sandbox ops/office/work-orders.json, open-P1s → WO- items).
// Profit lane: zai-14c · owner mandate trace 1a12d502a99b7021 ("ודא-רווחיות") —
//   the office LEARNS PROFITABILITY: research layer consumes Sandbox
//   receipts/profit-oracle-latest.json (zai-14b's daily oracle) DEFENSIVELY
//   (any fetch/parse/shape failure → honest unavailable, zero invented data);
//   LOSS / delta < -0.5% → one doc-only SAFE backlog item `profit-guard-loss`.
//   Research-layer wiring only — NO new BUILTIN (one-per-cycle law; E1 was this cycle's).
//
// Zero deps. Node >= 18. Plain node (workflows run node, not bun).
//
// STAGE 1 חקר   — fetch the FLEET BUS (Zip sovereign/bus-registry.json, raw.githubusercontent
//                 live when reachable — anonymous first, token optional — embedded fallback
//                 snapshot otherwise), every registered feed (10s timeout, honest
//                 unknown/red per feed), Zip sovereign/GATE-STATUS.json (private — may
//                 404 anonymous → honest unknown), and FleetHQ's own digest.json (Pages).
// STAGE 2 זיקוק — distill the snapshot into normalized action items:
//                 {id, source, title, riskClass, value, effort, ownerWordRequired, proposal?}
//                 riskClass law: SAFE (regenerate/verify/doc-only, no network writes,
//                 no state mutation) / MACHINE-PREP (prepare artifacts for the owner,
//                 no execution) / OWNER-WORD (money/signing/STASIS/keys — never auto-executed).
// STAGE 3 תכנון — rank (SAFE first, then value/effort desc, then id asc — deterministic);
//                 top item → full proposal in office/PROPOSALS/<UTC-date>-<slug>.md.
// STAGE 4 ביצוע — auto-execute ONLY the SAFE built-ins of this round:
//                 (a) refresh office/BACKLOG.md + office/RETRO-LATEST.md + office/retro-state.json
//                 (b) --verify-bus health table (stage 1 itself) embedded everywhere.
//                 Anything else SAFE discovered is queued executableBy: next-retro —
//                 the loop grows its own safe repertoire one built-in per round, honestly.
//
// IRON LAWS (fail-closed):
//   * retro NEVER broadcasts, NEVER signs, NEVER touches money/keys/STASIS.
//   * Its only side-effects are its own lane files (office/*, office/dist/*).
//   * Zero secrets in any produced artifact — a fail-closed scanner refuses to write
//     anything matching token/pubkey patterns (7-b tiers A/B).
//   * Gate details are referenced by id/title only (sanitized) — never summaries.
//   * Honest verdicts: unknown stays unknown; a red feed is printed red.
//
// Usage:
//   node office/retro.mjs                 # full 4-stage live run
//   node office/retro.mjs --verify-bus    # stage 1 only — bus health table (+ --json)
//   node office/retro.mjs --selftest      # offline fixture vectors, zero network
//   node office/retro.mjs --json          # machine snapshot on stdout (with live run)

import { writeFileSync, mkdirSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (f) => args.includes(f);
const REPO = resolve(argOf('--root', resolve(HERE, '..')));

const PROTOCOL = 'SAOS-OFFICE-RETRO/1';
const LANE = 'office-retro (zai-11d · E1-deed zai-13c)';
const OWNER_MANDATE = 'trace 1a12c9d6f5df1b95 — חקר/זיקוק/תכנון/ביצוע';
const LAWS = [
  'retro לא משדר, לא חותם, לא נוגע בכסף/מפתחות/STASIS',
  'תופעות-לוואי: קבצי-המסילה שלו בלבד (office/*)',
  'אפס-סודות בכל-פלט (סורק fail-closed לפני כתיבה)',
  'שמות-ריפואים-פרטיים ממוסכים private-NN (7-b) — כולל שערים',
  'שערי-בעלים מוזכרים לפי id/כותרת מוקטנת בלבד',
  'כנות: לא-ידוע נשאר לא-ידוע; פיד אדום מודפס אדום',
];

// ─────────────────────────────────────────────── utilities
const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const toMs = (t) => {
  if (t == null) return null;
  if (typeof t === 'number') return t;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
};
const pad2 = (n) => String(n).padStart(2, '0');
const fmtUTC = (t) => {
  const ms = toMs(t);
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
};
const utcDate = (t) => {
  const ms = toMs(t ?? Date.now());
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
const slugify = (s) =>
  String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

// secret scanner (fail-closed) — 7-b: nothing token/key-shaped ever reaches disk
const SECRET_PATTERNS = [
  [/ghp_[A-Za-z0-9]{16,}/, 'github PAT (ghp_)'],
  [/github_pat_[A-Za-z0-9_]{16,}/, 'github fine-grained PAT'],
  [/gh_[A-Za-z0-9_]{16,}/, 'github token (gh_)'],
  [/STM[0-9a-zA-Z]{30,}/, 'steem public key'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, 'uuid-shaped credential'],
];
function scanSecrets(text) {
  const hits = [];
  for (const [re, label] of SECRET_PATTERNS) {
    const m = String(text).match(re);
    if (m) hits.push({ label, sample: `${m[0].slice(0, 6)}…` });
  }
  return hits;
}

// gate titles are referenced by id + a sanitized short title only (never summaries,
// never keys, never ownerActionSummary — 7-b)
function sanitizeGateTitle(title) {
  let t = String(title == null ? '' : title);
  t = t.replace(/STM[0-9a-zA-Z]{20,}/g, '[מפתח-מוסתר]');
  t = t.split('—')[0].split(':')[0]; // keep the leading handle only
  return clip(t, 80);
}

// 7-b mask law — private repo names NEVER appear in any produced artifact.
// Visibility measured live via GitHub API @ 2026-10-11: 9 public (Console, Domain,
// FleetHQ, Sandbox, TruthRail, saos-agents, saos-runtime, sovereign-beacon,
// sovereign-lighthouse) / 17 private. Masks are deterministic private-NN by sorted
// order — same convention as office-window/fleet-digest.mjs (10-a).
// NOTE: repo 'steem' is private but the Steem CHAIN is public — the word "steem" in
// verdicts/ids (e.g. gate-01's STEEM_ACTIVE_WIF, "ARMED-STABLE steem") is the chain,
// not the repo; masking it would falsify public facts. Repo-steem references are
// kept out of artifacts by gate-title sanitization instead (documented decision).
const PRIVATE_REPOS = ['Adsmarket', 'Defi', 'Project-files', 'Saosmartwallet', 'Sdk', 'SovereignConsole', 'Zip', 'anchor-baseline', 'roshpina', 'sanbox', 'saos-control-center', 'saos-dex', 'saos-jummper', 'saos-sovereign-foundry', 'saos-sovereign-platform', 'vault-home'];
const PRIVATE_MASK = new Map();
{
  const sorted = [...PRIVATE_REPOS].sort();
  sorted.forEach((n, i) => {
    PRIVATE_MASK.set(n, `private-${i + 1}`);
    const low = n.toLowerCase();
    if (low !== n) PRIVATE_MASK.set(low, `private-${i + 1}`); // camel-case names appear lowercased in gate ids
    if (n === 'Zip') PRIVATE_MASK.set('zip', `private-${i + 1}`); // enum variant ('live-zip')
  });
}
function redactPrivateNames(t) {
  let s = String(t == null ? '' : t);
  for (const [name, mask] of PRIVATE_MASK) {
    s = s.replace(new RegExp(`\\b${name}\\b`, 'g'), mask);
  }
  return s;
}
function assertNoPrivateNames(files) {
  const bad = [];
  for (const [name, content] of Object.entries(files)) {
    for (const repo of PRIVATE_REPOS) {
      if (new RegExp(`\\b${repo}\\b`).test(content)) bad.push(`${name}: שם-ריפו-פרטי '${repo}'`);
    }
  }
  if (bad.length) throw new Error(`fail-closed: שמות-פרטיים בפלטים — כתיבה נמנעת:\n${bad.join('\n')}`);
}

// ─────────────────────────────────────────────── fetch layer (honest degradation)
const UA = 'roshpinacare-office-retro/1 (read-only; honest-unknown law)';
async function fetchText(url, { timeoutMs = 10000, token, accept } = {}) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'user-agent': UA };
    if (accept) headers.accept = accept;
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, ms: Date.now() - t0 };
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String((e && e.message) || e);
    return { ok: false, status: 0, text: '', ms: Date.now() - t0, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
function tryJson(text) {
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ─────────────────────────────────────────────── registry (live Zip raw → embedded fallback)
const REGISTRY_URL = 'https://raw.githubusercontent.com/roshpinacare-sys/Zip/main/sovereign/bus-registry.json';
const GATES_URL = 'https://raw.githubusercontent.com/roshpinacare-sys/Zip/main/sovereign/GATE-STATUS.json';
const DIGEST_URL = 'https://roshpinacare-sys.github.io/FleetHQ/digest.json';
// zai-13c deed — the fleet's declared work + the spread-regime law
const WORK_ORDERS_URL = 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/ops/office/work-orders.json';
const E1_GRID_URL = 'https://roshpinacare-sys.github.io/Domain/dex/grid.json'; // the same feed the bus measures (domain-dex-grid)
const E1_REGIME_BPS = 93.5; // spread-regime law — baseline research E1 2026-10-11 (ECONOMIC-PLAN §2.2, steemBps)
const E1_STALE_HOURS = 24;  // source older than this → honest STALE verdict, never a fake live one
// zai-14c — the office learns profitability (defensive consumption of zai-14b's daily oracle;
// 14b may not have landed yet — any failure is honest unavailable, never invented data)
const PROFIT_ORACLE_URL = 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/receipts/profit-oracle-latest.json';
const PROFIT_GUARD_DELTA_FLOOR = -0.5; // delta < -0.5% → doc-only loss note (task law, LOSS-verdict fires regardless)

// Embedded fallback snapshot of bus-registry.json (schema roshpinacare.fleet-bus-registry/1,
// measured live by zai-11c @ 2026-10-11T20:35Z — 16/16 URLs verified 200 that day).
// Used ONLY when the live registry is unreachable (Zip is private; anonymous raw 404s).
// The fallback marks itself honestly everywhere it is rendered.
const REGISTRY_FALLBACK = {
  schema: 'roshpinacare.fleet-bus-registry/1',
  generatedAt: '2026-10-11T20:35:00Z',
  snapshotOf: 'sovereign/bus-registry.json @ 686e0d00 (zai-11c, מקור-פרטי — השם אינו נמנה, 7-b)',
  feeds: [
    { id: 'fleethq-digest', url: 'https://roshpinacare-sys.github.io/FleetHQ/digest.json', cadence: 'daily 06:17 UTC', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 },
    { id: 'domain-dex-grid', url: 'https://roshpinacare-sys.github.io/Domain/dex/grid.json', cadence: 'daily 03:26 UTC (twin-triggered)', tier: 'B', freshnessField: 'publishedAt', stalenessWarningHours: 24 },
    { id: 'domain-dex-world', url: 'https://roshpinacare-sys.github.io/Domain/dex/world.json', cadence: 'daily 12:50 UTC', tier: 'B', freshnessField: 'publishedAt', stalenessWarningHours: 24 },
    { id: 'domain-dex-deposits', url: 'https://roshpinacare-sys.github.io/Domain/dex/deposits.json', cadence: 'every 2h', tier: 'B', freshnessField: 'updatedAt', stalenessWarningHours: 24 },
    { id: 'domain-office-feed', url: 'https://roshpinacare-sys.github.io/Domain/dex/office-feed.json', cadence: 'daily 03:41 UTC', tier: 'A', freshnessField: 'publishedAt', stalenessWarningHours: 24 },
    { id: 'domain-office-data', url: 'https://roshpinacare-sys.github.io/Domain/office/data.json', cadence: 'every 20 minutes', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 },
    { id: 'domain-grid-truth', url: 'https://roshpinacare-sys.github.io/Domain/agents/grid-truth.json', cadence: 'hourly at :19', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 },
    { id: 'sandbox-probe-hive', url: 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/probes/hive/{utc-date}.json', cadence: 'daily 05:41 UTC', tier: 'A', freshnessField: 'at', stalenessWarningHours: 24, resolve: { placeholder: '{utc-date}', offsetsDays: [0, 1] } },
    { id: 'sandbox-probe-blurt', url: 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/probes/blurt/{utc-date}.json', cadence: 'daily 05:41 UTC', tier: 'A', freshnessField: 'at', stalenessWarningHours: 24, resolve: { placeholder: '{utc-date}', offsetsDays: [0, 1] } },
    { id: 'sandbox-research-findings', url: 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/research/findings-{utc-date}.json', cadence: 'weekly (Monday 05:23 UTC)', tier: 'A', freshnessField: 'at', stalenessWarningHours: 192, resolve: { placeholder: '{utc-date}', offsetsDays: [0, 1, 2, 3, 4, 5, 6, 7, 8] } },
    { id: 'sandbox-flow-map', url: 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/ops/flow/flow-map.json', cadence: 'every 3 hours', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 },
    { id: 'sandbox-lessons-ledger', url: 'https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/ops/lessons/ledger.md', cadence: 'daily', tier: 'A', freshnessField: "last '## scribe' ISO timestamp", stalenessWarningHours: 24 },
    { id: 'domain-status', url: 'https://roshpinacare-sys.github.io/Domain/status.json', cadence: 'pages-build driven', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 },
    { id: 'console-dex-grid', url: 'https://roshpinacare-sys.github.io/Console/dex/grid.json', cadence: 'console writers (irregular)', tier: 'B', freshnessField: 'publishedAt|updatedAt|at|generatedAt', stalenessWarningHours: 24 },
    { id: 'console-dex-world', url: 'https://roshpinacare-sys.github.io/Console/dex/world.json', cadence: 'console writers (irregular)', tier: 'B', freshnessField: 'publishedAt|updatedAt|at|generatedAt', stalenessWarningHours: 24 },
    { id: 'console-mirror-status', url: 'https://raw.githubusercontent.com/roshpinacare-sys/SovereignConsole/main/agent/status.json', cadence: 'dispatch-only (private repo)', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 192, privateRaw: true },
  ],
};

async function fetchRegistry(token) {
  // anonymous first (public raws suffice by design), token only as graceful retry
  let r = await fetchText(REGISTRY_URL, { timeoutMs: 10000 });
  if (!r.ok && token) r = await fetchText(REGISTRY_URL, { timeoutMs: 10000, token });
  if (r.ok) {
    const p = tryJson(r.text);
    if (p.ok && p.json && p.json.schema === 'roshpinacare.fleet-bus-registry/1' && Array.isArray(p.json.feeds) && p.json.feeds.length > 0) {
      return { registry: p.json, source: 'live-zip', note: redactPrivateNames(`registry חי מ-Zip raw (${r.status}, ${r.ms}ms)`) };
    }
    return { registry: REGISTRY_FALLBACK, source: 'fallback-embedded', note: `registry חי הגיע אך לא תקין (${p.ok ? 'shape/schema' : p.error}) — יורד ל-snapshot מוטמע` };
  }
  const why = redactPrivateNames(r.status === 404 || r.status === 403 ? `HTTP ${r.status} (Zip פרטי${token ? ' — גם עם-token נדחה' : ' — אין-token בסביבה'})` : (r.error || `HTTP ${r.status}`));
  return { registry: REGISTRY_FALLBACK, source: 'fallback-embedded', note: `registry לא-נגיש: ${why} — משתמש ב-snapshot מוטמע (11-c @ ${REGISTRY_FALLBACK.generatedAt})` };
}

// ─────────────────────────────────────────────── STAGE 1 חקר — measure every registered feed
function freshnessFrom(content, feed) {
  const field = feed.freshnessField || '';
  if (field.includes('scribe')) {
    // markdown ledger: last ISO timestamp in the text (spec: "last '## scribe' ISO timestamp")
    const all = String(content).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z/g);
    return all && all.length ? all[all.length - 1] : null;
  }
  const candidates = field.includes('|') ? field.split('|') : [field];
  if (content && typeof content === 'object') {
    for (const c of candidates) {
      const v = content[c.trim()];
      if (v != null && (typeof v === 'string' || typeof v === 'number')) return v;
    }
  }
  return null;
}

// private-raw detection: registry entries mark it either as boolean `privateRaw: true`
// (embedded fallback) or `exposure: "private-raw"` (live Zip registry, 11-c schema)
function isPrivateRaw(feed) {
  return feed.privateRaw === true || feed.privateRaw === 'private-raw' || feed.exposure === 'private-raw';
}
function displayUrl(feed) {
  return isPrivateRaw(feed) ? 'private-raw (token-gated — לא-מוצג)' : feed.url;
}

async function measureFeed(feed, nowMs, token) {
  const base = {
    id: feed.id,
    url: displayUrl(feed),
    tier: feed.tier || '?',
    cadence: feed.cadence || 'unknown',
    sw: feed.stalenessWarningHours ?? 24,
    privateRaw: isPrivateRaw(feed),
  };
  // date-resolved feeds: try offsets newest-first until one answers 200
  const res = feed.resolve;
  const attempts = [];
  if (res && res.placeholder && Array.isArray(res.offsetsDays)) {
    for (const off of [...res.offsetsDays].sort((a, b) => a - b)) {
      const d = new Date(nowMs - off * 86400000);
      const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      const url = feed.url.replace(res.placeholder, date);
      const r = await fetchText(url, { timeoutMs: 10000, token: base.privateRaw ? token : undefined });
      attempts.push({ date, status: r.status, ok: r.ok });
      if (!r.ok) continue;
      const p = tryJson(r.text);
      if (!p.ok) {
        return { ...base, status: 'red', httpStatus: r.status, ageHours: null, freshness: null, reason: `JSON תקול: ${clip(p.error, 60)}`, resolvedDate: date, privateRaw: base.privateRaw };
      }
      const fresh = freshnessFrom(p.json, feed);
      return finalizeFresh(base, fresh, r.status, date, nowMs);
    }
    return { ...base, status: 'red', httpStatus: attempts.length ? attempts[attempts.length - 1].status : 0, ageHours: null, freshness: null, reason: `לא-נמצא ב-${attempts.length} תאריכים אחרונים (${attempts.map((a) => a.date).join(', ')})`, resolvedDate: null, privateRaw: base.privateRaw };
  }
  const token2 = isPrivateRaw(feed) ? token : undefined;
  const r = await fetchText(feed.url, { timeoutMs: 10000, token: token2 });
  if (!r.ok) {
    // 7-b honesty nuance: private-raw that answers 404/403 is "cannot judge" (grey),
    // not "public producer broken" (red) — red stays reserved for public producers.
    if (isPrivateRaw(feed) && (r.status === 404 || r.status === 403)) {
      return { ...base, status: 'grey', httpStatus: r.status, ageHours: null, freshness: null, reason: token ? 'private-raw — ה-token בסביבה אינו-מוסמך לריפו זה (לא-ידוע, כנה)' : 'private-raw ללא-token — לא-ידוע (כנה)', privateRaw: base.privateRaw };
    }
    if (isPrivateRaw(feed) && !token) {
      return { ...base, status: 'grey', httpStatus: r.status, ageHours: null, freshness: null, reason: 'private-raw ללא-token — לא-ידוע (כנה)', privateRaw: base.privateRaw };
    }
    return { ...base, status: 'red', httpStatus: r.status, ageHours: null, freshness: null, reason: r.error ? `רשת: ${clip(r.error, 60)}` : `HTTP ${r.status}`, privateRaw: base.privateRaw };
  }
  if (feed.id === 'sandbox-lessons-ledger' || /\.md$/i.test(feed.url)) {
    const fresh = freshnessFrom(r.text, feed);
    return finalizeFresh(base, fresh, r.status, null, nowMs);
  }
  const p = tryJson(r.text);
  if (!p.ok) {
    return { ...base, status: 'red', httpStatus: r.status, ageHours: null, freshness: null, reason: `JSON תקול: ${clip(p.error, 60)}`, privateRaw: base.privateRaw };
  }
  const fresh = freshnessFrom(p.json, feed);
  return finalizeFresh(base, fresh, r.status, null, nowMs);
}
function finalizeFresh(base, fresh, httpStatus, resolvedDate, nowMs) {
  const ms = toMs(fresh);
  if (ms == null) {
    return { ...base, status: 'grey', httpStatus, ageHours: null, freshness: null, reason: '200 אך אין-מציין-טריות מזוהה — לא-ידוע', resolvedDate: resolvedDate || null };
  }
  const ageHours = Math.max(0, (nowMs - ms) / 3600000);
  const status = ageHours <= base.sw ? 'green' : 'amber';
  return { ...base, status, httpStatus, ageHours: Math.round(ageHours * 10) / 10, freshness: fresh, reason: status === 'green' ? `עודכן לפני ${Math.round(ageHours)}h` : `מיושן: ${Math.round(ageHours)}h מעל החוק (${base.sw}h)`, resolvedDate: resolvedDate || null };
}

async function measureBus(registry, nowMs, token, { only = null } = {}) {
  const feeds = [];
  for (const f of registry.feeds) {
    if (only && !only.includes(f.id)) continue;
    feeds.push(await measureFeed(f, nowMs, token));
  }
  const counts = { green: 0, amber: 0, red: 0, grey: 0 };
  for (const f of feeds) counts[f.status] = (counts[f.status] || 0) + 1;
  return { at: new Date(nowMs).toISOString(), feeds, counts, registrySource: registry.__source || null };
}

// ─────────────────────────────────────────────── research findings / gates / digest
async function fetchFindings(registry, token, nowMs) {
  const feed = (registry.feeds || []).find((f) => f.id === 'sandbox-research-findings');
  if (!feed) return { found: false, note: 'אין-feed מחקר ברישום — לא-ידוע' };
  const res = feed.resolve || { placeholder: '{utc-date}', offsetsDays: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  const tried = [];
  for (const off of [...res.offsetsDays].sort((a, b) => a - b)) {
    const d = new Date(nowMs - off * 86400000);
    const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const url = feed.url.replace(res.placeholder, date);
    const r = await fetchText(url, { timeoutMs: 10000, token });
    tried.push(date);
    if (!r.ok) continue;
    const p = tryJson(r.text);
    if (!p.ok) return { found: false, date, note: `JSON תקול ב-${date}: ${clip(p.error, 60)}` };
    const j = p.json;
    if (j.schema !== 'saos.research.findings/1' || !Array.isArray(j.experiments)) {
      return { found: false, date, note: `schema לא-מוכר (${j.schema || 'חסר'}) ב-${date}` };
    }
    return {
      found: true,
      date,
      at: j.at || null,
      lane: j.lane || null,
      experiments: j.experiments.map((e) => ({
        id: e.id || '?',
        name: e.name || '?',
        // 7-b: feed text is public but may name private repos (e.g. ledgers) — mask here
        verdict: e.verdict ? redactPrivateNames(e.verdict) : null,
        ok: e.ok == null ? null : !!e.ok,
        next: e.next ? redactPrivateNames(e.next) : null,
      })),
      triedDates: tried,
    };
  }
  return { found: false, note: `לא-נמצא קובץ-ממצאים מ-${tried.length} הימים האחרונים (${tried.join(', ')})`, triedDates: tried };
}

async function fetchGates(token) {
  let r = await fetchText(GATES_URL, { timeoutMs: 10000 });
  if (!r.ok && token) r = await fetchText(GATES_URL, { timeoutMs: 10000, token });
  if (!r.ok) {
    const why = r.status ? `HTTP ${r.status}` : clip(r.error || '', 60);
    return { source: 'unavailable', note: redactPrivateNames(`GATE-STATUS לא-נגיש (${why}) — מצבי-השערים לא-ידועים כעת (מקור-פרטי; כנה, לא-מדומה)`), gates: null };
  }
  const p = tryJson(r.text);
  if (!p.ok || !p.json || p.json.protocol !== 'SAOS-OWNER-GATE-STATUS/1' || !Array.isArray(p.json.gates)) {
    return { source: 'unavailable', note: 'GATE-STATUS הגיע אך לא-תקין — לא-ידוע (כנה)', gates: null };
  }
  return {
    source: 'live-zip',
    note: `GATE-STATUS חי (${r.status}, generatedAt ${p.json.generatedAt || 'unknown'})`,
    generatedAt: p.json.generatedAt || null,
    // id + sanitized short title ONLY — never ownerActionSummary, never keys, and
    // private repo names masked (7-b)
    gates: p.json.gates.map((g) => ({ id: redactPrivateNames(g.id || '?'), state: g.state || 'UNKNOWN', title: sanitizeGateTitle(redactPrivateNames(g.title)) })),
  };
}

async function fetchDigest() {
  const r = await fetchText(DIGEST_URL, { timeoutMs: 10000 });
  if (!r.ok) return { source: 'unavailable', note: `digest.json לא-נגיש מה-Pages (${r.status || clip(r.error || '', 40)})`, generatedAt: null };
  const p = tryJson(r.text);
  if (!p.ok) return { source: 'pages', note: 'digest.json הגיע אך JSON תקול', generatedAt: null };
  const j = p.json;
  const ms = toMs(j.generatedAt);
  const ageHours = ms == null ? null : Math.round(((Date.now() - ms) / 3600000) * 10) / 10;
  return {
    source: 'pages',
    note: `digest.json חי (${r.status})`,
    generatedAt: j.generatedAt || null,
    ageHours,
    reposSeen: j.fleet && j.fleet.reposSeen != null ? j.fleet.reposSeen : null,
    degradedEarly: !!(j.fleet && j.fleet.degradedEarly),
    gridVerdict: (j.grid && j.grid.verdict) || null,
    hiveVerdict: (j.grid && j.grid.hive && j.grid.hive.verdict) || null,
    errors: Array.isArray(j.errors) ? j.errors.length : null,
  };
}

// ─── zai-13c: work-orders (the fleet's declared work) + E1 spread-regime verdict ───
const WO_RESOLVED_STATES = ['resolved', 'done', 'closed', 'completed', 'complete'];
const isWoResolved = (s) => WO_RESOLVED_STATES.includes(String(s || '').toLowerCase());
// 13-a/13-b add `status` fields in parallel; a missing status counts as OPEN (honest default).
function workOrderCounts(orders) {
  const list = Array.isArray(orders) ? orders : [];
  let open = 0, resolved = 0, openP1 = 0;
  for (const o of list) {
    if (isWoResolved(o.status)) resolved++;
    else { open++; if (String(o.priority).toUpperCase() === 'P1') openP1++; }
  }
  return { total: list.length, open, resolved, openP1 };
}

async function fetchWorkOrders(token) {
  // anonymous first (Sandbox raw is public by design), token only as graceful retry
  let r = await fetchText(WORK_ORDERS_URL, { timeoutMs: 10000 });
  if (!r.ok && token) r = await fetchText(WORK_ORDERS_URL, { timeoutMs: 10000, token });
  if (!r.ok) {
    const why = r.status ? `HTTP ${r.status}` : clip(r.error || '', 60);
    return { source: 'unavailable', note: `work-orders לא-נגיש (${why}) — הצווים-המוצהרים של הצי לא-ידועים כעת (כנה, לא-מדומה)`, orders: null, counts: null };
  }
  const p = tryJson(r.text);
  if (!p.ok || !Array.isArray(p.json)) {
    return { source: 'unavailable', note: `work-orders הגיע אך לא-תקין (${p.ok ? 'shape: לא-מערך' : clip(p.error, 60)}) — לא-ידוע (כנה)`, orders: null, counts: null };
  }
  const counts = workOrderCounts(p.json);
  return { source: 'live-sandbox-raw', note: `work-orders חי (${r.status}, ${r.ms}ms) — ${counts.open} פתוחים · ${counts.resolved} נפתרו · P1 פתוחים: ${counts.openP1}`, orders: p.json, counts };
}

// E1 deed (zai-13c): verify the spread regime against the 93.5 bps law.
// PURE function — drilled in selftest with fixtures; the live run only feeds it.
// value < 93.5 → tightened (PASS) · > → loosened (HOLD) · source stale >24h → honest STALE.
function spreadVerdict(payload, nowMs, { httpStatus = null, error = null } = {}) {
  const UNKNOWN = (why) => ({ builtin: 'builtin-e1-spread-regime', verdict: 'UNKNOWN', direction: null, value: null, deltaBps: null, ageHours: null, publishedAt: null, block: `SPREAD-REGIME: לא-ידוע — ${why} (כנה, לא-מדומה)` });
  if (payload == null) return UNKNOWN(`grid.json לא-נגיש (${error || (httpStatus ? `HTTP ${httpStatus}` : 'סיבה-לא-ידועה')})`);
  const ms = toMs(payload.publishedAt || null);
  if (ms == null) return UNKNOWN('grid.json הגיע אך אין-מציין-טריות (publishedAt)');
  const value = payload.book && typeof payload.book.spreadBps === 'number' && Number.isFinite(payload.book.spreadBps) ? payload.book.spreadBps : null;
  if (value == null) return UNKNOWN('grid.json בלי book.spreadBps מספרי (רגל-STEEM)');
  const ageHours = Math.max(0, Math.round(((nowMs - ms) / 3600000) * 10) / 10);
  const delta = Math.round((value - E1_REGIME_BPS) * 100) / 100;
  const deltaTxt = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
  const base = { builtin: 'builtin-e1-spread-regime', value, deltaBps: delta, ageHours, publishedAt: payload.publishedAt };
  if (ageHours > E1_STALE_HOURS) {
    return { ...base, verdict: 'STALE', direction: null, source: 'live-pages-stale', block: `SPREAD-REGIME: value=${value}bps · delta=${deltaTxt} vs ${E1_REGIME_BPS} · מקור-מיושן ${ageHours}h (מעל החוק ${E1_STALE_HOURS}h) — אין-פסק-חי (כנה); הערך מוצג לרפרנט בלבד` };
  }
  const direction = value < E1_REGIME_BPS ? 'tightened' : value > E1_REGIME_BPS ? 'loosened' : 'flat';
  const verdict = direction === 'tightened' ? 'PASS' : 'HOLD';
  const he = direction === 'tightened' ? 'הפיזור הצטמצם — נזילות-צד-הגריד משתפרת' : direction === 'loosened' ? 'הפיזור התרחב — לעקוב בלבד (verify/doc-only)' : 'הפיזור שטוח מול החוק';
  return { ...base, verdict, direction, source: 'live-pages', block: `SPREAD-REGIME: value=${value}bps · delta=${deltaTxt} vs ${E1_REGIME_BPS} · מקור-בן-${ageHours}h · ${verdict} (${direction}) — ${he}` };
}

async function fetchE1Verdict(nowMs) {
  const r = await fetchText(E1_GRID_URL, { timeoutMs: 10000 });
  if (!r.ok) return spreadVerdict(null, nowMs, { httpStatus: r.status, error: r.error || null });
  const p = tryJson(r.text);
  if (!p.ok) return spreadVerdict(null, nowMs, { error: `JSON תקול: ${clip(p.error, 50)}` });
  return spreadVerdict(p.json, nowMs, { httpStatus: r.status });
}

// ─── zai-14c: profit-oracle consumption (the office learns profitability) ───
// DEFENSIVE by law: 14b's receipt may not exist yet — ANY fetch/parse/shape failure
// → {unavailable:true, reason} honest note, ZERO invented data. Pure parse is drilled
// in selftest with fixtures; fetchProfitOracle is the only network touch.
const profitNum = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
function parseProfitOracle(res) {
  if (!res || !res.ok) {
    const why = res ? (res.error ? `רשת: ${clip(res.error, 60)}` : `HTTP ${res.status}`) : 'no-response';
    return { unavailable: true, source: 'unavailable', note: `profit-oracle לא-נגיש (${why}) — כנה, לא-מדומה (14b עשוי שלא להיות באוויר עדיין)` };
  }
  const p = tryJson(res.text);
  if (!p.ok) return { unavailable: true, source: 'unavailable', note: `profit-oracle הגיע אך JSON תקול (${clip(p.error, 60)}) — כנה` };
  const j = p.json;
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return { unavailable: true, source: 'unavailable', note: 'profit-oracle לא-אובייקט — צורה לא-מוכרת, כנה' };
  }
  // defensive field probe: top-level FIRST, then the union-receipt `summary` block
  // (the house receipt pattern — 14b carries the fields inside summary, measured live 2026-10-11)
  const s = j.summary && typeof j.summary === 'object' && !Array.isArray(j.summary) ? j.summary : {};
  const netWorthSbdEquiv = profitNum(j.netWorthSbdEquiv ?? j.netWorthSbd ?? s.netWorthSbdEquiv ?? j.netWorth);
  const deltaVsPriorPct = profitNum(j.deltaVsPriorPct ?? j.deltaPct ?? s.deltaVsPriorPct ?? j.deltaVsPrior);
  const verdictRaw = j.verdict ?? s.verdict;
  const verdict = typeof verdictRaw === 'string' && ['PROFIT', 'FLAT', 'LOSS'].includes(verdictRaw.trim().toUpperCase()) ? verdictRaw.trim().toUpperCase() : null;
  const gridVerdict = (typeof j.gridVerdict === 'string' && j.gridVerdict.trim()) || (typeof s.gridVerdict === 'string' && s.gridVerdict.trim()) || (j.grid && typeof j.grid.verdict === 'string' && j.grid.verdict.trim()) || null;
  const at = (typeof j.at === 'string' && j.at) || (typeof j.generatedAt === 'string' && j.generatedAt) || (typeof s.at === 'string' && s.at) || null;
  if (netWorthSbdEquiv == null && deltaVsPriorPct == null && !verdict && !gridVerdict && !at) {
    return { unavailable: true, source: 'unavailable', note: 'profit-oracle הגיע אך אף-שדה-מוכר לא נמצא (netWorthSbdEquiv/deltaVsPriorPct/verdict/gridVerdict/at) — צורה לא-מוכרת, כנה' };
  }
  return {
    unavailable: false, source: 'live-sandbox-raw',
    note: `profit-oracle חי (${res.status}${at ? `, at ${fmtUTC(at)}` : ''}) — המשרד לומד-רווחיות`,
    netWorthSbdEquiv, deltaVsPriorPct, verdict, gridVerdict, at,
  };
}
async function fetchProfitOracle(token) {
  // anonymous first (Sandbox raw is public by design), token only as graceful retry
  let r = await fetchText(PROFIT_ORACLE_URL, { timeoutMs: 10000 });
  if (!r.ok && token) r = await fetchText(PROFIT_ORACLE_URL, { timeoutMs: 10000, token });
  return parseProfitOracle(r);
}
// guard law (zai-14c): verdict==LOSS OR delta < -0.5% → ONE doc-only SAFE backlog item.
// doc-only: "publish honest loss note in retro" — never an execution, never an owner-word.
function distillProfit(po) {
  if (!po || po.unavailable) return []; // defensive: unavailable → zero invented items
  const fire = po.verdict === 'LOSS' || (typeof po.deltaVsPriorPct === 'number' && po.deltaVsPriorPct < PROFIT_GUARD_DELTA_FLOOR);
  if (!fire) return [];
  const fields = `verdict=${po.verdict || 'לא-ידוע'} · delta=${po.deltaVsPriorPct == null ? 'לא-ידוע' : `${po.deltaVsPriorPct > 0 ? '+' : ''}${po.deltaVsPriorPct}%`} · netWorth=${po.netWorthSbdEquiv == null ? 'לא-ידוע' : `${po.netWorthSbdEquiv} SBD-equiv`}`;
  return [{
    id: 'profit-guard-loss',
    source: 'profit-oracle-latest.json (Sandbox raw)',
    title: clip(redactPrivateNames(`פרסום-הערת-הפסד כנה ב-retro (doc-only) — profit-oracle: ${fields}`), 140),
    riskClass: 'SAFE', value: 8, effort: 1, ownerWordRequired: false,
    status: 'OPEN', executableBy: 'next-retro',
    detail: {
      verdict: po.verdict || null, deltaVsPriorPct: po.deltaVsPriorPct ?? null, netWorthSbdEquiv: po.netWorthSbdEquiv ?? null, at: po.at || null,
      guard: `verdict==LOSS או delta < ${PROFIT_GUARD_DELTA_FLOOR}% → doc-only: פרסום-הערת-הפסד כנה ב-retro`,
    },
  }];
}
function profitSummary(po) {
  if (!po) return 'לא-נמדד במחזור זה (כנה)';
  if (po.unavailable) return `לא-זמין — ${po.note}`;
  const parts = [];
  if (po.verdict) parts.push(`verdict=${po.verdict}`);
  if (po.deltaVsPriorPct != null) parts.push(`delta=${po.deltaVsPriorPct > 0 ? '+' : ''}${po.deltaVsPriorPct}% מול-המדידה-הקודמת`);
  if (po.netWorthSbdEquiv != null) parts.push(`שווי-נקי=${po.netWorthSbdEquiv} SBD-equiv`);
  if (po.gridVerdict) parts.push(`grid=${po.gridVerdict}`);
  if (po.at) parts.push(`at=${fmtUTC(po.at)}`);
  return parts.length ? parts.join(' · ') : 'הגיע אך בלי שדות-מוכרים — כנה';
}

// ─────────────────────────────────────────────── STAGE 2 זיקוק — findings → normalized items
const RISK_RANK = { SAFE: 0, 'MACHINE-PREP': 1, 'OWNER-WORD': 2 };
const RISK_HE = { SAFE: 'בטוח', 'MACHINE-PREP': 'הכנה-מכונה', 'OWNER-WORD': 'דבר-בעלים' };

function distillResearch(findings) {
  const items = [];
  if (!findings || !findings.found) {
    items.push({
      id: 'research-feed-unavailable',
      source: 'sandbox-research-findings',
      title: `רכבת-המחקר לא-נמדדה: ${(findings && findings.note) || 'לא-ידוע'} — לבדוק את הפיד השבועי`,
      riskClass: 'SAFE', value: 3, effort: 1, ownerWordRequired: false, status: 'OPEN', executableBy: 'next-retro',
    });
    return items;
  }
  for (const e of findings.experiments) {
    const text = `${e.verdict || ''} ${e.next || ''}`;
    const ownerWord = /(owner[ -]?word|owner[ -]?gate|דבר-בעלים|delegation top-up)/i.test(text);
    const prep = /(draft|prepare|plan|טיוטה|הכנת|escalate)/i.test(text);
    const riskClass = ownerWord ? 'OWNER-WORD' : prep ? 'MACHINE-PREP' : 'SAFE';
    items.push({
      id: `research-${slugify(`${e.id}-${e.name}`)}`,
      source: `research/${findings.date} (${e.id} ${e.name})`,
      title: `${e.id} ${e.name} — ${clip(e.verdict || 'ללא-פסק', 100)}`,
      riskClass,
      value: e.ok === false ? 6 : 4,
      effort: 2,
      ownerWordRequired: ownerWord,
      status: 'OPEN',
      executableBy: riskClass === 'SAFE' ? 'next-retro' : riskClass === 'MACHINE-PREP' ? 'owner-after-prep' : 'owner-only',
      detail: { ok: e.ok, next: e.next },
    });
  }
  return items;
}

function distillBus(bus) {
  const items = [];
  for (const f of bus.feeds) {
    if (f.status === 'green' || f.status === 'grey') continue;
    items.push({
      id: `bus-${f.id}`,
      source: `bus-registry (${f.tier})`,
      title: f.status === 'red' ? `פיד אדום: ${f.id} — ${f.reason}` : `פיד מיושן: ${f.id} — ${f.reason}`,
      riskClass: 'MACHINE-PREP',
      value: f.status === 'red' ? 7 : 4,
      effort: 1,
      ownerWordRequired: false,
      status: 'OPEN',
      executableBy: 'next-retro',
      detail: { ageHours: f.ageHours, httpStatus: f.httpStatus },
    });
  }
  return items;
}

function distillGates(gates) {
  const items = [];
  if (!gates || !gates.gates) return items;
  gates.gates.forEach((g, idx) => {
    // deterministic value: playbook order = owner-value order (gate-01 highest)
    // 7-b: id/title redacted here too — distill is a mask boundary, not just fetch
    const gid = redactPrivateNames(g.id || '?');
    const gtitle = clip(sanitizeGateTitle(redactPrivateNames(g.title)), 110);
    const value = Math.max(3, 10 - idx * 0.5);
    if (g.state === 'WAITING-OWNER') {
      items.push({
        id: gid, source: 'GATE-STATUS', title: gtitle,
        riskClass: 'OWNER-WORD', value, effort: 1, ownerWordRequired: true,
        proposal: { kind: 'gate', ref: `sovereign/GATE-STATUS.json#${gid}` },
        status: 'OPEN', executableBy: 'owner-only',
      });
    } else if (g.state === 'MACHINE-READY') {
      items.push({
        id: gid, source: 'GATE-STATUS', title: gtitle,
        riskClass: 'MACHINE-PREP', value, effort: 2, ownerWordRequired: true,
        proposal: { kind: 'gate', ref: `sovereign/GATE-STATUS.json#${gid}` },
        status: 'OPEN', executableBy: 'owner-after-prep',
      });
    }
    // other states (DISSOLVED / RELEASED / closed) → already resolved; not action items
  });
  return items;
}

// zai-13c: the fleet's declared work — open P1s surface as WO- items.
// Class law: infrastructure fixes with clear acceptance = MACHINE-PREP, unless the
// text itself declares an owner-word (same regex as the research distiller).
function distillWorkOrders(wo) {
  const items = [];
  if (!wo || !Array.isArray(wo.orders)) return items; // honest-fail: unavailable → zero invented items
  for (const o of wo.orders) {
    const oid = String(o.id || '').trim();
    if (!oid || isWoResolved(o.status)) continue;
    if (String(o.priority).toUpperCase() !== 'P1') continue; // P2/P3 live in the counts, not the queue
    const id = /^WO-/i.test(oid) ? oid : `WO-${slugify(oid)}`;
    // 7-b: distill is a mask boundary — the public file may still name private repos
    const title = clip(redactPrivateNames(o.title || id), 110);
    const why = o.why ? clip(redactPrivateNames(o.why), 160) : null;
    const acceptance = o.acceptance ? clip(redactPrivateNames(o.acceptance), 160) : null;
    const ownerWord = /(owner[ -]?word|owner[ -]?gate|דבר-בעלים|delegation top-up)/i.test(`${title} ${why || ''} ${acceptance || ''}`);
    items.push({
      id,
      source: 'work-orders.json (Sandbox raw)',
      title,
      riskClass: ownerWord ? 'OWNER-WORD' : 'MACHINE-PREP',
      value: 7, effort: 2,
      ownerWordRequired: ownerWord,
      status: 'OPEN',
      executableBy: ownerWord ? 'owner-only' : 'owner-after-prep',
      detail: { area: redactPrivateNames(o.area || null), priority: o.priority || null, why, acceptance },
    });
  }
  return items;
}

function distill(snapshot) {
  const items = [
    ...distillResearch(snapshot.findings),
    ...distillBus(snapshot.bus),
    ...distillGates(snapshot.gates),
    ...distillWorkOrders(snapshot.workOrders),
    ...distillProfit(snapshot.profit), // zai-14c — the office learns profitability
  ];
  // dedupe by id (last wins) — deterministic
  const byId = new Map();
  for (const it of items) byId.set(it.id, it);
  // deed-linkage (zai-13c): a research item that a BUILTINS entry `covers` is marked
  // EXECUTED honestly — it ran as a built-in this very cycle and is never re-proposed.
  for (const b of BUILTINS) {
    if (!b.covers) continue;
    const it = byId.get(b.covers);
    if (it && it.status === 'OPEN') {
      it.status = 'EXECUTED';
      it.executableBy = b.id;
      it.detail = { ...(it.detail || {}), executedByBuiltin: b.id, proposalRef: b.proposalRef || null };
      if (snapshot.e1 && snapshot.e1.block) it.detail.verdict = snapshot.e1.block;
    }
  }
  return [...byId.values()];
}

// ─────────────────────────────────────────────── STAGE 3 תכנון — rank + proposal
function rank(items) {
  return [...items].sort((a, b) =>
    ((RISK_RANK[a.riskClass] ?? 9) - (RISK_RANK[b.riskClass] ?? 9)) ||
    (b.value / Math.max(1, b.effort)) - (a.value / Math.max(1, a.effort)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// the ONLY things retro ever executes — SAFE built-ins of this round
const BUILTINS = [
  { id: 'builtin-refresh-lane', title: 'רענון קבצי-המסילה: BACKLOG + RETRO-LATEST + retro-state (SAFE: כתיבה למסילה-שלו בלבד)', riskClass: 'SAFE' },
  { id: 'builtin-verify-bus', title: 'אימות-אוטובוס: מדידת כל-הפידים הרשומים + טבלת-בריאות מוטמעת (SAFE: קריאה-בלבד)', riskClass: 'SAFE' },
  // zai-13c deed — the office's FIRST self-proposal turned into a built-in
  // (PROPOSALS/2026-10-11-research-e1-spread-regime.md · executableBy: next-retro = this cycle).
  // The growth law's one new built-in for this round. Read-only/verify/doc-only, forever.
  { id: 'builtin-e1-spread-regime', title: 'אימות-משטר-הפיזור (E1): grid.json חי מול חוק-93.5bps — פסק-כנה לתיק (SAFE: קריאה-בלבד)', riskClass: 'SAFE', covers: 'research-e1-spread-regime', proposalRef: 'PROPOSALS/2026-10-11-research-e1-spread-regime.md' },
];

// execution boundary — the selftest drills this: nothing that is not a SAFE built-in
// can ever appear in the executed list, no matter how it is ranked.
function executePlan(rankedItems) {
  const executed = BUILTINS.map((b) => ({ ...b, ownerWordRequired: false }));
  for (const it of rankedItems) {
    if (it.riskClass === 'SAFE' && !it.builtin) {
      // queued for the next round's repertoire — one built-in per round, honest growth
      // (never executed here; recorded as executableBy: next-retro)
      continue;
    }
    // MACHINE-PREP / OWNER-WORD: never executed. The law IS this continue.
    continue;
  }
  return executed;
}

function buildProposal(topItem, snapshot, nowMs) {
  const date = utcDate(nowMs);
  const file = `${date}-${slugify(topItem.id)}.md`;
  const bus = snapshot.bus;
  const gates = snapshot.gates;
  const dig = snapshot.digest;
  const findings = snapshot.findings;
  const L = [];
  L.push(`# הצעה: ${topItem.title}`);
  L.push('');
  L.push(`- **מזהה**: \`${topItem.id}\` · **מחלקת-סיכון**: ${topItem.riskClass} (${RISK_HE[topItem.riskClass]}) · **דבר-בעלים**: ${topItem.ownerWordRequired ? 'כן 🔒' : 'לא'}`);
  L.push(`- **מקור**: ${topItem.source} · **ערך/מאמץ**: ${topItem.value}/${topItem.effort}`);
  L.push(`- **נוצר**: ${fmtUTC(nowMs)} על-ידי office/retro.mjs (${LANE}) · ${PROTOCOL}`);
  L.push('');
  L.push('## הקשר נמדד (מה-חקר)');
  L.push('');
  L.push(`- אוטובוס: ${bus.counts.green} green · ${bus.counts.amber} amber · ${bus.counts.red} red · ${bus.counts.grey} grey — מקור-רישום: ${snapshot.registry.source} (${clip(snapshot.registry.note, 90)})`);
  const rel = bus.feeds.filter((f) => f.status !== 'green').map((f) => `  - ${f.id}: ${f.status} — ${f.reason}`).join('\n');
  if (rel) L.push(rel); else L.push('  - כל-הפידים ירוקים במדידה זו');
  if (findings && findings.found) {
    L.push(`- מחקר (${findings.date}): ${findings.experiments.map((e) => `${e.id}${e.ok === false ? '❌' : e.ok ? '✅' : '⏳'}`).join(' ')}`);
  } else {
    L.push(`- מחקר: לא-נמדד — ${(findings && findings.note) || 'לא-ידוע'}`);
  }
  L.push(`- שערים: ${gates && gates.gates ? gates.gates.map((g) => `${g.id}=${g.state}`).join(', ') : (gates && gates.note) || 'לא-ידוע'}`);
  L.push(`- דיג'סט: ${dig && dig.generatedAt ? `חי מ-${fmtUTC(dig.generatedAt)}` : (dig && dig.note) || 'לא-ידוע'}`);
  L.push('');
  L.push('## תוכנית (צעדים)');
  L.push('');
  if (topItem.riskClass === 'OWNER-WORD') {
    L.push('1. זהו פריט דבר-בעלים — המכונה אינה מבצעת אותו ולעולם לא תבצע (חוק-המחזור).');
    L.push(`2. ההכנה המכונית מוגבלת ל: הצבעה על תיעוד הטקס ב-${topItem.proposal ? topItem.proposal.ref : 'sovereign/GATE-STATUS.json'} והצגתו בחלון.`);
    L.push('3. ההכרעה והביצוע — דבר-בעלים בלבד, בטקס המוכן (ראה OWNER-GATE-PLAYBOOK במסילת-הריבונות הפרטיה).');
  } else if (topItem.riskClass === 'MACHINE-PREP') {
    L.push('1. המכונה מכינה את הארטיפקטים (מסמך/בדיקות/רשימת-צעדים) — לא מבצעת שינוי-מצב.');
    L.push('2. הביצוע עצמו ממתין להכרעת-בעלים או למחזור הבא עם built-in מאושר.');
    L.push('3. עדכון ה-BACKLOG במחזור הבא עם תוצאת-ההכנה.');
  } else {
    L.push('1. ביצוע במחזור הבא כ-built-in מאושר (`executableBy: next-retro`) — מחזור זה אינו מבצע אותו (חוק: built-in אחד חדש לכל-מחזור).');
    L.push('2. הפעולה מוגדרת read-only/verify/doc-only בלבד.');
    L.push('3. הטמעה ב-`BUILTINS` של retro.mjs במחזור הבא עם וקטור-בדיקה.');
  }
  L.push('');
  L.push('## פקודות-אימות (חסרות-סודות)');
  L.push('');
  L.push('```bash');
  L.push('node office/retro.mjs --selftest          # חוקי-המחזור ירוקים');
  L.push('node office/retro.mjs --verify-bus        # בריאות-האוטובוס בשידור-חי');
  L.push('node office/retro.mjs                     # מחזור מלא — תיק-עבודות מחדש');
  L.push('```');
  L.push('');
  L.push('## Rollback');
  L.push('');
  L.push('- קבצי-המסילה (BACKLOG/RETRO-LATEST/retro-state) נכתבים additive לכל-מחזור — שחזור = ריצה חוזרת או `git revert` על קבלת-המחזור.');
  L.push('- אין-שינוי-מצב חוץ-מסילתי כלל — אין מה להחזיר מחוץ ל-office/.');
  L.push('');
  if (topItem.ownerWordRequired) {
    L.push('## גבול דבר-בעלים 🔒');
    L.push('');
    L.push('- הביצוע האמיתי דורש הכרעת-בעלים (כסף/חתימה/מפתחות/STASIS). המכונה מכינה בלבד ומציגה את השער בחלון — לעולם לא מרימה אותו.');
    L.push('');
  }
  L.push('---');
  L.push(`*מחזור-השיפור-העצמי של המשרד · ${OWNER_MANDATE} · נוצר אוטומטית, כנה בכל-שדה.*`);
  return { file, md: L.join('\n') + '\n' };
}

// ─────────────────────────────────────────────── rendering (Hebrew-first lane files)
function itemsTable(ranked, { limit = null } = {}) {
  const rows = (limit ? ranked.slice(0, limit) : ranked).map((it, i) =>
    `| ${i + 1} | \`${it.id}\` | ${clip(it.source, 34)} | ${clip(it.title, 88)} | ${it.riskClass === 'OWNER-WORD' ? '🔒 ' : ''}${it.riskClass} | ${it.value} | ${it.effort} | ${it.ownerWordRequired ? 'כן' : '—'} | \`${it.executableBy}\` |`);
  return ['| # | id | מקור | כותרת | מחלקת-סיכון | ערך | מאמץ | דבר-בעלים | executableBy |',
    '|---|----|------|-------|-------------|-----|------|-----------|--------------|', ...rows].join('\n');
}

function buildBacklog({ snapshot, ranked, executed, proposal, nowMs }) {
  const bus = snapshot.bus;
  const g = snapshot.gates;
  const risks = { SAFE: 0, 'MACHINE-PREP': 0, 'OWNER-WORD': 0 };
  for (const it of ranked) risks[it.riskClass] = (risks[it.riskClass] || 0) + 1;
  const waiting = g && g.gates ? g.gates.filter((x) => x.state === 'WAITING-OWNER').length : null;
  const L = [];
  L.push('# תיק-העבודות של המשרד (BACKLOG)');
  L.push('');
  L.push(`> מחזור-השיפור-העצמי · office/retro.mjs · ${PROTOCOL} · ${fmtUTC(nowMs)} · ${OWNER_MANDATE}`);
  L.push('');
  L.push('## סיכום נמדד');
  L.push('');
  L.push(`- **אוטובוס**: ${bus.counts.green} green · ${bus.counts.amber} amber · ${bus.counts.red} red · ${bus.counts.grey} grey (רישום: ${snapshot.registry.source})`);
  L.push(`- **שערי-בעלים**: ${waiting != null ? `${waiting} WAITING-OWNER` : 'לא-ידוע (מקור-השערים פרטי/לא-נגיש — כנה)'}`);
  L.push(`- **מחקר**: ${snapshot.findings && snapshot.findings.found ? `הממצאים מ-${snapshot.findings.date} — ${snapshot.findings.experiments.length} ניסויים` : 'לא-נמדד (כנה)'}`);
  L.push(`- **E1 spread-regime (built-in)**: ${snapshot.e1 ? snapshot.e1.block : 'לא-נמדד (כנה)'}`);
  L.push(`- **צווי-עבודה (work-orders)**: ${snapshot.workOrders && snapshot.workOrders.counts ? `${snapshot.workOrders.counts.open} פתוחים · ${snapshot.workOrders.counts.resolved} נפתרו · P1 פתוחים: ${snapshot.workOrders.counts.openP1}` : 'לא-ידוע (כנה)'}`);
  L.push(`- **רווחיות (profit-oracle)**: ${profitSummary(snapshot.profit)}${distillProfit(snapshot.profit).length ? ' · 🔔 פריט `profit-guard-loss` נפתח (doc-only)' : ''}`);
  L.push(`- **פריטים**: ${ranked.length} (SAFE ${risks.SAFE || 0} · MACHINE-PREP ${risks['MACHINE-PREP'] || 0} · OWNER-WORD ${risks['OWNER-WORD'] || 0})`);
  L.push('');
  L.push('## בוצע במחזור זה (SAFE built-ins בלבד — חוק)');
  L.push('');
  L.push('| id | כותרת | מחלקת-סיכון |');
  L.push('|----|-------|-------------|');
  for (const e of executed) L.push(`| \`${e.id}\` | ${e.title} | ${e.riskClass} |`);
  L.push('');
  L.push('> כל-שאר הפריטים אינם מבוצעים — SAFE מתורגש כ-`executableBy: next-retro` (הרפרטואר-הבטוח צומח built-in אחד לכל-מחזור); MACHINE-PREP מוכן לבעלים; OWNER-WORD לעולם לא מבוצע-מכונה.');
  L.push('');
  L.push('## תור מדורג');
  L.push('');
  L.push(itemsTable(ranked));
  L.push('');
  if (proposal) {
    L.push('## הצעה ראשית של המחזור');
    L.push('');
    L.push(`- **קובץ**: [PROPOSALS/${proposal.file}](PROPOSALS/${proposal.file}) — עבור הפריט המדורג ראשון.`);
  } else {
    L.push('## הצעה ראשית של המחזור');
    L.push('');
    L.push('- אין פריטים בתור — כנה.');
  }
  L.push('');
  L.push('## גבולות (חוקי-המחזור)');
  L.push('');
  for (const law of LAWS) L.push(`- ${law}`);
  L.push('');
  L.push('---');
  L.push(`*נוצר אוטומטית על-ידי המשרד · ${PROTOCOL} · אפס-סודות (סרוק fail-closed) · ISO ${new Date(nowMs).toISOString()}*`);
  return L.join('\n') + '\n';
}

function buildRetroLatest({ snapshot, ranked, executed, proposal, proposalItem, nowMs }) {
  const bus = snapshot.bus;
  const dig = snapshot.digest;
  const g = snapshot.gates;
  const F = snapshot.findings;
  const L = [];
  L.push('# מחזור-השיפור-העצמי — המהדורה האחרונה (RETRO-LATEST)');
  L.push('');
  L.push(`> ${fmtUTC(nowMs)} · ${LANE} · ${PROTOCOL} · ארבעה-שלבים: חקר → זיקוק → תכנון → ביצוע`);
  L.push('');
  L.push('## 1 · חקר (מה נמדד)');
  L.push('');
  L.push(`- **רישום-האוטובוס**: ${snapshot.registry.source} — ${clip(snapshot.registry.note, 140)}`);
  L.push(`- **הדיג'סט שלנו**: ${dig && dig.generatedAt ? `חי · generatedAt ${fmtUTC(dig.generatedAt)} (${dig.ageHours}h)` : (dig && dig.note) || 'לא-ידוע'}${dig && dig.reposSeen != null ? ` · repos ${dig.reposSeen}` : ''}${dig && dig.gridVerdict ? ` · grid: ${dig.gridVerdict}` : ''}${dig && dig.hiveVerdict ? ` · hive: ${dig.hiveVerdict}` : ''}`);
  L.push(`- **צווי-עבודה (work-orders)**: ${snapshot.workOrders && snapshot.workOrders.counts ? `${snapshot.workOrders.counts.open} פתוחים · ${snapshot.workOrders.counts.resolved} נפתרו · P1 פתוחים: ${snapshot.workOrders.counts.openP1} (${snapshot.workOrders.source})` : (snapshot.workOrders && snapshot.workOrders.note) || 'לא-ידוע (כנה)'}`);
  L.push(`- **רווחיות (profit-oracle, zai-14c — המשרד לומד-רווחיות)**: ${profitSummary(snapshot.profit)}${distillProfit(snapshot.profit).length ? ' · 🔔 `profit-guard-loss` (SAFE, doc-only)' : ''}`);
  if (F && F.found) {
    L.push(`- **ממצאי-המחקר** (findings-${F.date}, ${F.lane || 'research lane'}):`);
    L.push('');
    L.push('| ניסוי | שם | פסק | ok | צעד-הבא |');
    L.push('|-------|----|-----|----|---------|');
    for (const e of F.experiments) {
      L.push(`| ${e.id} | ${e.name} | ${clip(e.verdict || '—', 90)} | ${e.ok === false ? '❌' : e.ok ? '✅' : '⏳'} | ${clip(e.next || '—', 70)} |`);
    }
  } else {
    L.push(`- **ממצאי-המחקר**: לא-נמדדו — ${(F && F.note) || 'לא-ידוע'} (כנה)`);
  }
  L.push('');
  L.push('### בריאות האוטובוס (verify-bus מוטמע)');
  L.push('');
  L.push('| id | מצב | גיל(שע׳) | HTTP | טריות | סיבה |');
  L.push('|----|-----|----------|------|-------|------|');
  for (const f of bus.feeds) {
    L.push(`| ${f.id} | ${f.status === 'green' ? '🟢' : f.status === 'amber' ? '🟡' : f.status === 'red' ? '🔴' : '⚪️'} ${f.status} | ${f.ageHours ?? '—'} | ${f.httpStatus ?? '—'} | ${f.freshness ? clip(String(f.freshness), 24) : '—'} | ${clip(f.reason || '—', 80)} |`);
  }
  L.push('');
  L.push(`ספירה: ${bus.counts.green} green · ${bus.counts.amber} amber · ${bus.counts.red} red · ${bus.counts.grey} grey`);
  L.push('');
  L.push('### E1 spread-regime — ההצעה-העצמית הראשונה הפכה מעשה (builtin-e1-spread-regime · zai-13c)');
  L.push('');
  L.push('```');
  L.push(snapshot.e1 ? snapshot.e1.block : 'SPREAD-REGIME: לא-נמדד במחזור זה (כנה)');
  L.push('```');
  L.push('');
  L.push(`- חוק-המשטר: spread < ${E1_REGIME_BPS}bps = tightened (PASS) · > = loosened (HOLD) · מקור מיושן >${E1_STALE_HOURS}h = STALE כנה במקום פסק-חי. הרגל-הנמדדת: book.spreadBps (STEEM) מ-dex/grid.json — אותו-פיד שהאוטובוס מודד. read-only/verify/doc-only בלבד · ההצעה שהפכה מעשה: PROPOSALS/2026-10-11-research-e1-spread-regime.md`);
  L.push('');
  L.push('### מצבי-השערים');
  L.push('');
  if (g && g.gates) {
    L.push('| שער | מצב | כותרת (מוקטנת) |');
    L.push('|-----|-----|-----------------|');
    for (const x of g.gates) L.push(`| \`${x.id}\` | ${x.state} | ${clip(x.title, 70)} |`);
    L.push('');
    L.push(`*מקור: ${g.note}. פרטי-השערים מוזכרים לפי id/כותרת-מוקטנת בלבד — לעולם לא סיכומי-בעלים או מפתחות (7-b).*`);
  } else {
    L.push(`- לא-ידוע — ${(g && g.note) || 'מקור-השערים לא-נגיש'} (כנה, לא-מדומה)`);
  }
  L.push('');
  L.push('## 2 · זיקוק (ממצאים → פריטים)');
  L.push('');
  L.push(itemsTable(ranked));
  L.push('');
  L.push('## 3 · תכנון (ההצעה הראשית)');
  L.push('');
  const pi = proposalItem || ranked[0] || null;
  if (proposal && pi) L.push(`- הפריט המדורג ראשון הלא-מבוצע: \`${pi.id}\` (${pi.riskClass}) → הצעה מלאה: [PROPOSALS/${proposal.file}](PROPOSALS/${proposal.file})`);
  else L.push('- אין פריטים — כנה');
  L.push('');
  L.push('## 4 · ביצוע (SAFE בלבד)');
  L.push('');
  L.push('| id | כותרת | מחלקת-סיכון |');
  L.push('|----|-------|-------------|');
  for (const e of executed) L.push(`| \`${e.id}\` | ${e.title} | ${e.riskClass} |`);
  L.push('');
  L.push('חוק: המחזור **לעולם** לא מבצע MACHINE-PREP/OWNER-WORD, לא משדר, לא חותם, לא נוגע בכסף/מפתחות/STASIS. תופעות-הלוואי שלו — קבצי-המסילה שלו בלבד.');
  L.push('');
  L.push('---');
  L.push(`*${OWNER_MANDATE} · המשרד מתאמן לחשוב, בלוח-זמנים, לנצח · ISO ${new Date(nowMs).toISOString()}*`);
  return L.join('\n') + '\n';
}

function buildState({ snapshot, ranked, executed, proposal, proposalItem, nowMs }) {
  return {
    protocol: PROTOCOL,
    lane: LANE,
    ownerMandate: OWNER_MANDATE,
    generatedAt: new Date(nowMs).toISOString(),
    laws: LAWS,
    registry: { source: snapshot.registry.source, note: snapshot.registry.note, feedCount: snapshot.registry.registry.feeds.length, fallbackSnapshotOf: snapshot.registry.source === 'fallback-embedded' ? REGISTRY_FALLBACK.snapshotOf : null },
    digest: snapshot.digest,
    findings: snapshot.findings && snapshot.findings.found
      ? { found: true, date: snapshot.findings.date, at: snapshot.findings.at, experiments: snapshot.findings.experiments.map((e) => ({ id: e.id, name: e.name, ok: e.ok })) }
      : { found: false, note: (snapshot.findings && snapshot.findings.note) || 'unknown' },
    bus: { at: snapshot.bus.at, counts: snapshot.bus.counts, feeds: snapshot.bus.feeds.map((f) => ({ id: f.id, status: f.status, ageHours: f.ageHours, httpStatus: f.httpStatus })) },
    e1: snapshot.e1 || null,
    profit: snapshot.profit ? {
      unavailable: !!snapshot.profit.unavailable,
      source: snapshot.profit.source || null, note: snapshot.profit.note || null,
      netWorthSbdEquiv: snapshot.profit.netWorthSbdEquiv ?? null,
      deltaVsPriorPct: snapshot.profit.deltaVsPriorPct ?? null,
      verdict: snapshot.profit.verdict || null,
      gridVerdict: snapshot.profit.gridVerdict || null,
      at: snapshot.profit.at || null,
    } : null,
    workOrders: snapshot.workOrders ? { source: snapshot.workOrders.source, note: snapshot.workOrders.note, counts: snapshot.workOrders.counts } : null,
    gates: snapshot.gates && snapshot.gates.gates
      ? { source: snapshot.gates.source, generatedAt: snapshot.gates.generatedAt || null, gates: snapshot.gates.gates.map((x) => ({ id: x.id, state: x.state })) }
      : { source: 'unavailable', note: (snapshot.gates && snapshot.gates.note) || 'unknown' },
    items: ranked,
    executed,
    proposal: proposal ? { file: proposal.file, item: (proposalItem || ranked[0] || null) ? (proposalItem || ranked[0]).id : null } : null,
  };
}

// ─────────────────────────────────────────────── retro/index.html (zero-JS RTL Hebrew dark)
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function renderIndex({ snapshot, ranked, executed, proposal, proposalItem, nowMs }) {
  const bus = snapshot.bus;
  const g = snapshot.gates;
  const F = snapshot.findings;
  const dig = snapshot.digest;
  const chip = (cls, txt) => `<span class="chip ${cls}">${esc(txt)}</span>`;
  const feedRow = (f) => {
    const cls = f.status === 'green' ? 'ok' : f.status === 'amber' ? 'warn' : f.status === 'red' ? 'bad' : 'neutral';
    return `<tr><td>${esc(f.id)}</td><td>${chip(cls, f.status)}</td><td>${f.ageHours != null ? esc(String(f.ageHours)) + 'h' : '—'}</td><td>${esc(clip(f.reason || '—', 70))}</td></tr>`;
  };
  const itemRow = (it, i) => {
    const cls = it.riskClass === 'SAFE' ? 'ok' : it.riskClass === 'MACHINE-PREP' ? 'violet' : 'bad';
    return `<tr><td>${i + 1}</td><td><code>${esc(it.id)}</code></td><td>${esc(clip(it.title, 80))}</td><td>${chip(cls, it.riskClass)}</td><td>${it.ownerWordRequired ? '🔒 כן' : '—'}</td><td>${esc(it.executableBy)}</td></tr>`;
  };
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>מחזור-השיפור-העצמי של המשרד — FleetHQ</title>
<style>
:root{
  --bg:#0b0f14; --surface:#10161d; --card:#131a22; --border:#22303f;
  --text:#e8eef5; --muted:#93a4b4; --ok:#3fb950; --warn:#d29922; --bad:#f85149;
  --info:#58a6ff; --violet:#bc8cff; --accent:#2dd4bf;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--text);
  font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans Hebrew",sans-serif;
  line-height:1.65; -webkit-text-size-adjust:100%;
}
a{color:var(--info); text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1060px; margin-inline:auto; padding:20px 16px 48px}
header.hero{
  background:linear-gradient(180deg,#101a24 0%,var(--bg) 100%);
  border-bottom:1px solid var(--border); padding:40px 16px 26px; text-align:center;
}
.hero h1{margin:0 0 10px; font-size:clamp(1.55rem,5vw,2.4rem); letter-spacing:.01em}
.hero h1 .accent{color:var(--accent)}
.hero p.sub{margin:0 auto 14px; max-width:720px; color:var(--muted); font-size:clamp(.95rem,2.6vw,1.08rem)}
.hero .chips{display:flex; flex-wrap:wrap; gap:8px; justify-content:center}
.chip{display:inline-block; padding:2px 10px; border-radius:999px; font-size:.78rem; font-weight:600; border:1px solid transparent; white-space:nowrap}
.chip.ok{background:rgba(63,185,80,.14); color:var(--ok); border-color:rgba(63,185,80,.4)}
.chip.warn{background:rgba(210,153,34,.14); color:var(--warn); border-color:rgba(210,153,34,.4)}
.chip.bad{background:rgba(248,81,73,.14); color:var(--bad); border-color:rgba(248,81,73,.4)}
.chip.info{background:rgba(88,166,255,.14); color:var(--info); border-color:rgba(88,166,255,.4)}
.chip.violet{background:rgba(188,140,255,.14); color:var(--violet); border-color:rgba(188,140,255,.4)}
.chip.neutral{background:rgba(147,164,180,.12); color:var(--muted); border-color:rgba(147,164,180,.35)}
.chip.accent{background:rgba(45,212,191,.12); color:var(--accent); border-color:rgba(45,212,191,.4)}
section{margin-top:34px}
.sec-head{display:flex; align-items:center; gap:12px; margin:0 0 14px}
.sec-num{flex:none; width:34px; height:34px; display:grid; place-items:center; border-radius:9px;
  background:rgba(45,212,191,.12); color:var(--accent); border:1px solid rgba(45,212,191,.35); font-weight:700}
.sec-head h2{margin:0; font-size:clamp(1.2rem,3.6vw,1.5rem)}
.sec-head .en{color:var(--muted); font-weight:400; font-size:.85rem; margin-inline-start:8px}
.card{background:var(--card); border:1px solid var(--border); border-radius:14px; padding:16px 18px;
  box-shadow:0 1px 0 rgba(255,255,255,.02) inset; min-width:0; max-width:100%}
html,body{overflow-x:clip}
.grid2>*{min-width:0}
.tablewrap{overflow-x:auto; -webkit-overflow-scrolling:touch; max-width:100%}
table{width:100%; border-collapse:collapse; font-size:.86rem}
th,td{padding:7px 9px; border-bottom:1px solid var(--border); text-align:right; vertical-align:top}
th{color:var(--muted); font-weight:600; white-space:nowrap}
tr:last-child td{border-bottom:none}
code{background:rgba(88,166,255,.09); color:var(--info); padding:1px 6px; border-radius:6px; font-size:.82rem; direction:ltr; unicode-bidi:embed}
.pfoot{margin-top:12px; color:var(--muted); font-size:.8rem}
footer{margin-top:44px; border-top:1px solid var(--border); padding-top:16px; color:var(--muted); font-size:.82rem; text-align:center}
.law{color:var(--muted); font-size:.86rem; margin:6px 0}
.law b{color:var(--text)}
@media(min-width:760px){ .grid2{display:grid; gap:14px; grid-template-columns:1fr 1fr} }
</style>
</head>
<body>
<header class="hero">
  <h1>מחזור-השיפור-העצמי <span class="accent">של המשרד</span></h1>
  <p class="sub">חקר → זיקוק → תכנון → ביצוע — המשרד צורך את-האינטליגנציה של הצי (ממצאי-מחקר · בריאות-האוטובוס · הדיג'סט · שערי-הבעלים), מזקק תיק-עבודות מדורג, מתכנן את-הראש-ומבצע רק את-מה שבטוח-הוכח. מה שנוגע בכסף/חתימה/STASIS — דבר-בעלים בלבד, לנצח.</p>
  <div class="chips">
    ${chip('accent', `${fmtUTC(nowMs)}`)}
    ${chip('ok', `אוטובוס: ${bus.counts.green} ירוק`)}
    ${bus.counts.amber ? chip('warn', `${bus.counts.amber} מיושן`) : ''}
    ${bus.counts.red ? chip('bad', `${bus.counts.red} אדום`) : ''}
    ${bus.counts.grey ? chip('neutral', `${bus.counts.grey} לא-ידוע`) : ''}
    ${chip('violet', `תור: ${ranked.length} פריטים`)}
    ${snapshot.workOrders && snapshot.workOrders.counts ? chip('info', `צווים: ${snapshot.workOrders.counts.open} פתוחים · P1: ${snapshot.workOrders.counts.openP1}`) : ''}
    ${snapshot.profit && !snapshot.profit.unavailable ? chip(snapshot.profit.verdict === 'PROFIT' ? 'ok' : snapshot.profit.verdict === 'LOSS' ? 'bad' : 'info', `רווחיות: ${snapshot.profit.verdict || 'נמדד'}`) : chip('neutral', 'רווחיות: לא-זמין עדיין (כנה)')}
    ${g && g.gates ? chip('bad', `${g.gates.filter((x) => x.state === 'WAITING-OWNER').length} שערים ממתינים-לבעלים`) : chip('neutral', 'שערים: לא-ידוע')}
  </div>
</header>
<div class="wrap">

<section>
  <div class="sec-head"><div class="sec-num">1</div><h2>חקר <span class="en">— הפידים כפי-שנמדדו, עכשיו</span></h2></div>
  <div class="card">
    <div class="tablewrap"><table>
      <tr><th>פיד</th><th>מצב</th><th>גיל</th><th>הערה כנה</th></tr>
      ${bus.feeds.map(feedRow).join('\n      ')}
    </table></div>
    <p class="pfoot">מקור-הרישום: ${esc(snapshot.registry.source)} — ${esc(clip(snapshot.registry.note, 130))} · מדידה ${esc(fmtUTC(bus.at))}</p>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card">
      <b>ממצאי-המחקר</b>
      ${F && F.found ? `<div class="tablewrap"><table style="margin-top:8px">
        <tr><th>ניסוי</th><th>פסק</th><th>ok</th></tr>
        ${F.experiments.map((e) => `<tr><td><code>${esc(e.id)} ${esc(e.name)}</code></td><td>${esc(clip(e.verdict || '—', 80))}</td><td>${e.ok === false ? '❌' : e.ok ? '✅' : '⏳'}</td></tr>`).join('\n        ')}
      </table></div>
      <p class="pfoot">findings-${esc(F.date)} · רכבת-המחקר השבועית (Sandbox)</p>` : `<p class="law">לא-נמדד — ${esc((F && F.note) || 'לא-ידוע')} (כנה)</p>`}
    </div>
    <div class="card">
      <b>הדיג'סט של המשרד עצמו</b>
      <p class="law">${dig && dig.generatedAt ? `חי · נוצר ${esc(fmtUTC(dig.generatedAt))} (${esc(String(dig.ageHours))}h)` : esc((dig && dig.note) || 'לא-ידוע')}</p>
      ${dig && dig.reposSeen != null ? `<p class="law">ריפואים-נמדדו: ${esc(String(dig.reposSeen))}${dig.gridVerdict ? ` · grid: ${esc(dig.gridVerdict)}` : ''}${dig.hiveVerdict ? ` · hive: ${esc(dig.hiveVerdict)}` : ''}</p>` : ''}
      <b>שערי-הבעלים</b>
      ${g && g.gates ? `<div class="tablewrap"><table style="margin-top:8px">
        <tr><th>שער</th><th>מצב</th></tr>
        ${g.gates.map((x) => `<tr><td>${esc(clip(x.title, 44))}</td><td>${x.state === 'WAITING-OWNER' ? chip('bad', x.state) : x.state === 'MACHINE-READY' ? chip('violet', x.state) : chip('neutral', x.state)}</td></tr>`).join('\n        ')}
      </table></div>
      <p class="pfoot">לפי id/כותרת-מוקטנת בלבד — בלי-סיכומים ובלי-מפתחות (7-b)</p>` : `<p class="law">${esc((g && g.note) || 'לא-ידוע')} (כנה)</p>`}
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <b>E1 spread-regime — ההצעה-העצמית הראשונה הפכה מעשה (built-in פעיל)</b>
    <p class="law"><code>${esc(snapshot.e1 ? snapshot.e1.block : 'SPREAD-REGIME: לא-נמדד (כנה)')}</code></p>
    <p class="pfoot">חוק: &lt;${E1_REGIME_BPS}bps = tightened/PASS · &gt; = loosened/HOLD · מקור מיושן &gt;${E1_STALE_HOURS}h = STALE כנה · read-only/verify/doc-only · deed zai-13c (trace 1a12d186d2f8b86d)</p>
    ${snapshot.workOrders && snapshot.workOrders.counts ? `<p class="law"><b>צווי-עבודה שהמשרד רואה:</b> ${esc(String(snapshot.workOrders.counts.open))} פתוחים · ${esc(String(snapshot.workOrders.counts.resolved))} נפתרו · P1 פתוחים: ${esc(String(snapshot.workOrders.counts.openP1))} — מקור: work-orders.json (Sandbox raw)</p>` : `<p class="law">צווי-עבודה: ${esc((snapshot.workOrders && snapshot.workOrders.note) || 'לא-ידוע (כנה)')}</p>`}
  </div>
  <div class="card" style="margin-top:14px">
    <b>רווחיות — profit-oracle (המשרד לומד-רווחיות · zai-14c)</b>
    ${(() => { const po = snapshot.profit; if (!po || po.unavailable) return `<p class="law">${esc(profitSummary(po))}</p>`; const cls = po.verdict === 'PROFIT' ? 'ok' : po.verdict === 'LOSS' ? 'bad' : 'info'; return `<p class="law">${chip(cls, po.verdict || 'נמדד')} <code>${esc(profitSummary(po))}</code></p>`; })()}
    ${distillProfit(snapshot.profit).length ? `<p class="law">🔔 <b>profit-guard-loss</b> נפתח בתור (SAFE · doc-only): פרסום-הערת-הפסד כנה ב-retro — verdict LOSS או delta &lt; ${esc(String(PROFIT_GUARD_DELTA_FLOOR))}%</p>` : ''}
    <p class="pfoot">מקור: profit-oracle-latest.json (Sandbox raw) · צריכה-מגוננת: כשל/צורה-לא-מוכרת = "לא-זמין" כנה, אפס-נתונים-מומצאים · חוק-השומר: LOSS / delta &lt; ${esc(String(PROFIT_GUARD_DELTA_FLOOR))}% → פריט doc-only אחד (research-layer wiring בלבד — בלי built-in חדש, חוק-אחד-למחזור)</p>
  </div>
</section>

<section>
  <div class="sec-head"><div class="sec-num">2</div><h2>זיקוק <span class="en">— התור המדורג (SAFE קודם · value/effort)</span></h2></div>
  <div class="card">
    <div class="tablewrap"><table>
      <tr><th>#</th><th>id</th><th>כותרת</th><th>מחלקת-סיכון</th><th>דבר-בעלים</th><th>executableBy</th></tr>
      ${ranked.map(itemRow).join('\n      ')}
    </table></div>
    <p class="pfoot">SAFE = רענון/אימות/תיעוד בלבד · MACHINE-PREP = הכנת-ארטיפקטים לבעלים · OWNER-WORD = כסף/חתימה/מפתחות/STASIS — לעולם לא מבוצע-מכונה.</p>
  </div>
</section>

<section>
  <div class="sec-head"><div class="sec-num">3</div><h2>תכנון <span class="en">— ההצעה הראשית של המחזור</span></h2></div>
  <div class="card">
    ${(() => { const pi = proposalItem || ranked[0] || null; return proposal && pi ? `<p><b>${esc(clip(pi.title, 100))}</b></p>
    <p class="law">הצעה מלאה (הקשר · תוכנית · פקודות-אימות · rollback · גבול-דבר-בעלים): <a href="PROPOSALS-latest.md">PROPOSALS/${esc(proposal.file)}</a></p>
    <p class="law">מקור: <code>${esc(pi.id)}</code> · מחלקה: ${chip(pi.riskClass === 'SAFE' ? 'ok' : pi.riskClass === 'MACHINE-PREP' ? 'violet' : 'bad', pi.riskClass)}</p>` : '<p class="law">אין פריטים בתור — כנה.</p>'; })()}
  </div>
</section>

<section>
  <div class="sec-head"><div class="sec-num">4</div><h2>ביצוע <span class="en">— רק SAFE built-ins, אף-פעם לא יותר</span></h2></div>
  <div class="card">
    <div class="tablewrap"><table>
      <tr><th>id</th><th>פעולה</th></tr>
      ${executed.map((e) => `<tr><td><code>${esc(e.id)}</code></td><td>${esc(e.title)}</td></tr>`).join('\n      ')}
    </table></div>
    <p class="law"><b>חוק-המחזור:</b> לא משדר · לא חותם · לא כסף · לא מפתחות · לא STASIS · תופעות-הלוואי שלו — קבצי-המסילה שלו בלבד. פריטי-SAFE חדשים מתורגשים כ-<code>executableBy: next-retro</code> — הרפרטואר-הבטוח צומח built-in אחד לכל-מחזור, בכנות.</p>
  </div>
</section>

<footer>
  נוצר אוטומטית על-ידי המשרד · ${esc(LANE)} · ${esc(PROTOCOL)} · ${esc(OWNER_MANDATE)} · ISO ${esc(new Date(nowMs).toISOString())} ·
  <a href="../index.html">החלון היומי</a> · <a href="BACKLOG.md">BACKLOG</a> · <a href="RETRO-LATEST.md">RETRO-LATEST</a> · <a href="../digest.json">digest.json</a>
</footer>
</div>
</body>
</html>
`;
}

// ─────────────────────────────────────────────── fail-closed write layer
function assertNoSecrets(files) {
  const bad = [];
  for (const [name, content] of Object.entries(files)) {
    for (const hit of scanSecrets(content)) bad.push(`${name}: ${hit.label} (${hit.sample})`);
  }
  if (bad.length) {
    throw new Error(`fail-closed: זוהה-חומר-אסור בפלטים — כתיבה נמנעת:\n${bad.join('\n')}`);
  }
}
function writeLane(files) {
  assertNoSecrets(files);
  assertNoPrivateNames(files);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

// ─────────────────────────────────────────────── STAGE 4 — run
async function runLive() {
  const nowMs = Date.now();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  console.log(`retro: מחזור-שיפור-עצמי ${PROTOCOL} @ ${fmtUTC(nowMs)}`);

  // STAGE 1 חקר
  const reg = await fetchRegistry(token);
  reg.registry.__source = reg.source;
  const bus = await measureBus(reg.registry, nowMs, token);
  const findings = await fetchFindings(reg.registry, token, nowMs);
  const gates = await fetchGates(token);
  const digest = await fetchDigest();
  const workOrders = await fetchWorkOrders(token);
  const e1 = await fetchE1Verdict(nowMs);
  const profit = await fetchProfitOracle(token); // zai-14c — defensive; 14b may not have landed yet
  const snapshot = {
    at: new Date(nowMs).toISOString(),
    registry: { source: reg.source, note: reg.note, registry: reg.registry },
    bus, findings, gates, digest, workOrders, e1, profit,
  };
  console.log(`חקר: registry=${reg.source} · bus ${bus.counts.green}G/${bus.counts.amber}A/${bus.counts.red}R/${bus.counts.grey}U · findings=${findings.found ? findings.date : 'לא-נמדד'} · gates=${gates.gates ? gates.gates.length + ' ממופים' : 'לא-ידוע'} · digest=${digest.generatedAt ? fmtUTC(digest.generatedAt) : 'לא-ידוע'} · WO=${workOrders.counts ? `${workOrders.counts.open}פתוחים/${workOrders.counts.resolved}נפתרו/P1:${workOrders.counts.openP1}` : 'לא-ידוע'} · E1=${e1.verdict} · profit=${profit.unavailable ? `לא-זמין (כנה)` : (profit.verdict || 'שדות-נמדדו')}${profit.unavailable ? '' : ` delta=${profit.deltaVsPriorPct == null ? '?' : profit.deltaVsPriorPct + '%'}`}`);

  // STAGE 2 זיקוק
  const ranked = rank(distill(snapshot));
  const risks = { SAFE: 0, 'MACHINE-PREP': 0, 'OWNER-WORD': 0 };
  for (const it of ranked) risks[it.riskClass] = (risks[it.riskClass] || 0) + 1;
  console.log(`זיקוק: ${ranked.length} פריטים — SAFE ${risks.SAFE || 0} · MACHINE-PREP ${risks['MACHINE-PREP'] || 0} · OWNER-WORD ${risks['OWNER-WORD'] || 0}`);

  // STAGE 3 תכנון — the proposal goes to the top NON-executed item: an item a built-in
  // just executed this cycle is marked EXECUTED (deed law) and is never re-proposed.
  const proposalItem = ranked.find((it) => it.status !== 'EXECUTED') || null;
  const proposal = proposalItem ? buildProposal(proposalItem, snapshot, nowMs) : null;
  if (proposal) console.log(`תכנון: הצעה ראשית ← ${proposalItem.id} (${proposalItem.riskClass}) → PROPOSALS/${proposal.file}`);

  // STAGE 4 ביצוע (SAFE built-ins only — the law, drilled in selftest)
  const executed = executePlan(ranked);
  console.log(`ביצוע: ${executed.length} built-ins (${executed.map((e) => e.id).join(', ')})`);

  const ctx = { snapshot, ranked, executed, proposal, proposalItem, nowMs };
  const files = {
    [join(REPO, 'office', 'BACKLOG.md')]: buildBacklog(ctx),
    [join(REPO, 'office', 'RETRO-LATEST.md')]: buildRetroLatest(ctx),
    [join(REPO, 'office', 'retro-state.json')]: JSON.stringify(buildState(ctx), null, 2) + '\n',
    [join(REPO, 'office', 'dist', 'index.html')]: renderIndex(ctx),
  };
  if (proposal) files[join(REPO, 'office', 'PROPOSALS', proposal.file)] = proposal.md;
  writeLane(files);
  for (const p of Object.keys(files)) console.log(`כתיבה: ${p.replace(REPO + '/', '')}`);
  console.log('retro: המחזור הושלם — המשרד מתאמן.');
  return ctx;
}

async function runVerifyBus({ json = false } = {}) {
  const nowMs = Date.now();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const reg = await fetchRegistry(token);
  reg.registry.__source = reg.source;
  const bus = await measureBus(reg.registry, nowMs, token);
  if (json) {
    console.log(JSON.stringify({ protocol: PROTOCOL, mode: 'verify-bus', at: bus.at, registrySource: reg.source, counts: bus.counts, feeds: bus.feeds }, null, 2));
  } else {
    console.log(`verify-bus @ ${fmtUTC(nowMs)} · registry=${reg.source}`);
    for (const f of bus.feeds) {
      console.log(`${f.status === 'green' ? '🟢' : f.status === 'amber' ? '🟡' : f.status === 'red' ? '🔴' : '⚪️'} ${f.status.padEnd(5)} ${f.id.padEnd(26)} ${f.ageHours != null ? String(f.ageHours).padStart(6) + 'h' : '     —'} ${f.reason || ''}`);
    }
    console.log(`ספירה: ${bus.counts.green} green · ${bus.counts.amber} amber · ${bus.counts.red} red · ${bus.counts.grey} grey`);
  }
  return bus.counts.red > 0 ? 1 : 0;
}

// ─────────────────────────────────────────────── selftest (offline fixtures, zero network)
function selftest() {
  const results = [];
  const vec = (name, fn) => {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, err: String((e && e.message) || e) });
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assert failed'); };

  const mkItem = (id, riskClass, value, effort) => ({ id, source: 't', title: id, riskClass, value, effort, ownerWordRequired: riskClass === 'OWNER-WORD', status: 'OPEN', executableBy: 't' });

  // V1 — ranking determinism
  vec('ranking determinism (3 runs identical)', () => {
    const items = [mkItem('b', 'OWNER-WORD', 10, 1), mkItem('a', 'SAFE', 2, 5), mkItem('c', 'MACHINE-PREP', 8, 2)];
    const r1 = JSON.stringify(rank(items)), r2 = JSON.stringify(rank([...items].reverse())), r3 = JSON.stringify(rank(items));
    assert(r1 === r2 && r2 === r3, 'rank not deterministic');
  });

  // V2 — SAFE first even against high-value OWNER-WORD
  vec('SAFE-first law in ranking', () => {
    const ranked = rank([mkItem('owner-high', 'OWNER-WORD', 10, 1), mkItem('safe-low', 'SAFE', 1, 5)]);
    assert(ranked[0].id === 'safe-low', 'SAFE must rank first');
  });

  // V3 — value/effort ordering + id tie-break
  vec('value/effort desc + id tie-break', () => {
    const ranked = rank([mkItem('zeta', 'SAFE', 4, 2), mkItem('alpha', 'SAFE', 8, 2), mkItem('mid', 'SAFE', 4, 2)]);
    assert(ranked.map((r) => r.id).join(',') === 'alpha,mid,zeta', `unexpected order: ${ranked.map((r) => r.id).join(',')}`);
  });

  // V4 — IRON LAW: executed contains ONLY SAFE built-ins, regardless of ranking
  vec('risk-class law: OWNER-WORD can never be executed', () => {
    const ranked = rank([mkItem('owner-top', 'OWNER-WORD', 99, 1), mkItem('prep', 'MACHINE-PREP', 50, 1), mkItem('safe-thing', 'SAFE', 9, 1)]);
    const executed = executePlan(ranked);
    assert(executed.every((e) => e.riskClass === 'SAFE'), 'non-SAFE executed!');
    assert(executed.every((e) => e.id.startsWith('builtin-')), 'executed non-builtin!');
    assert(!executed.some((e) => e.id === 'owner-top' || e.id === 'prep' || e.id === 'safe-thing'), 'backlog item leaked into execution');
  });

  // V5 — MACHINE-PREP never executed either
  vec('risk-class law: MACHINE-PREP never executed', () => {
    const executed = executePlan(rank([mkItem('prep-top', 'MACHINE-PREP', 99, 1)]));
    assert(!executed.some((e) => e.id === 'prep-top'), 'MACHINE-PREP executed');
  });

  // V6 — graceful degradation: dead feeds, dead registry, dead gates → honest snapshot + artifacts
  vec('graceful degradation: all feeds dead → honest artifacts still written', () => {
    const nowMs = Date.now();
    const deadRegistry = { schema: 'roshpinacare.fleet-bus-registry/1', generatedAt: 't', feeds: [
      { id: 'dead-a', url: 'http://127.0.0.1:1/a.json', cadence: 'd', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 },
    ] };
    const snapshot = {
      at: new Date(nowMs).toISOString(),
      registry: { source: 'fallback-embedded', note: 'degraded (fixture)', registry: deadRegistry },
      bus: { at: new Date(nowMs).toISOString(), counts: { green: 0, amber: 0, red: 1, grey: 0 }, feeds: [{ id: 'dead-a', status: 'red', httpStatus: 0, ageHours: null, freshness: null, reason: 'רשת: fixture', url: 'masked', tier: 'A', cadence: 'd', sw: 24, privateRaw: false }] },
      findings: { found: false, note: 'fixture: לא-נמצא' },
      gates: { source: 'unavailable', note: 'fixture: לא-נגיש', gates: null },
      digest: { source: 'unavailable', note: 'fixture: לא-נגיש', generatedAt: null },
    };
    const ranked = rank(distill(snapshot));
    assert(ranked.length >= 2, `expected ≥2 items from dead snapshot, got ${ranked.length}`);
    assert(ranked.some((i) => i.id === 'research-feed-unavailable'), 'research-unavailable item missing');
    assert(ranked.some((i) => i.id === 'bus-dead-a' && i.riskClass === 'MACHINE-PREP'), 'dead feed item missing');
    const executed = executePlan(ranked);
    const ctx = { snapshot, ranked, executed, proposal: buildProposal(ranked[0], snapshot, nowMs), nowMs };
    const dir = mkdtempSync(join(tmpdir(), 'retro-st-'));
    try {
      const files = {
        [join(dir, 'BACKLOG.md')]: buildBacklog(ctx),
        [join(dir, 'RETRO-LATEST.md')]: buildRetroLatest(ctx),
        [join(dir, 'retro-state.json')]: JSON.stringify(buildState(ctx), null, 2),
        [join(dir, 'index.html')]: renderIndex(ctx),
        [join(dir, 'PROPOSALS', ctx.proposal.file)]: ctx.proposal.md,
      };
      writeLane(files);
      for (const p of Object.keys(files)) assert(existsSync(p) && readFileSync(p, 'utf8').length > 50, `artifact missing: ${p}`);
      const md = readFileSync(join(dir, 'BACKLOG.md'), 'utf8');
      assert(md.includes('לא-נמדד') || md.includes('לא-ידוע'), 'honest-unknown markers missing');
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      assert(html.includes('לא-ידוע'), 'index lacks honest unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // V7 — artifact shape (state protocol + backlog sections)
  vec('artifact shape: state/backlog/retro structure', () => {
    const nowMs = Date.now();
    const snapshot = { at: 't', registry: { source: 'fallback-embedded', note: 'n', registry: { schema: 'x', feeds: [{ id: 'f', url: 'u', cadence: 'c', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 }] } }, bus: { at: 't', counts: { green: 1, amber: 0, red: 0, grey: 0 }, feeds: [] }, findings: { found: false, note: 'n' }, gates: { source: 'unavailable', note: 'n', gates: null }, digest: { source: 'unavailable', note: 'n', generatedAt: null } };
    const ranked = rank(distill(snapshot));
    const state = buildState({ snapshot, ranked, executed: executePlan(ranked), proposal: null, nowMs });
    assert(state.protocol === PROTOCOL && state.lane === LANE, 'state header wrong');
    assert(Array.isArray(state.items) && state.executed.length === BUILTINS.length, 'state items/executed wrong');
    const backlog = buildBacklog({ snapshot, ranked, executed: executePlan(ranked), proposal: null, nowMs });
    assert(backlog.includes('## סיכום נמדד') && backlog.includes('## תור מדורג') && backlog.includes('## בוצע במחזור זה'), 'backlog sections missing');
    assert(backlog.includes('SAFE built-ins'), 'built-in law line missing');
  });

  // V8 — gate-state normalization: WAITING-OWNER/MACHINE-READY/DISSOLVED
  vec('gate normalization: WAITING-OWNER→OWNER-WORD, MACHINE-READY→MACHINE-PREP, DISSOLVED→skipped', () => {
    const gates = { source: 'fixture', gates: [
      { id: 'g-wait', state: 'WAITING-OWNER', title: 'שער ממתין' },
      { id: 'g-ready', state: 'MACHINE-READY', title: 'שער מוכן' },
      { id: 'g-done', state: 'DISSOLVED', title: 'שער שנפתר' },
    ] };
    const items = distillGates(gates);
    const wait = items.find((i) => i.id === 'g-wait'), ready = items.find((i) => i.id === 'g-ready');
    assert(wait && wait.riskClass === 'OWNER-WORD' && wait.ownerWordRequired, 'WAITING-OWNER must map to OWNER-WORD');
    assert(ready && ready.riskClass === 'MACHINE-PREP', 'MACHINE-READY must map to MACHINE-PREP');
    assert(!items.some((i) => i.id === 'g-done'), 'DISSOLVED must not be an action item');
  });

  // V9 — staleness boundaries (green ≤ sw, amber > sw, grey when no freshness, red on failure)
  vec('staleness math: green/amber boundary + grey + red', () => {
    const nowMs = Date.now();
    const feed = { id: 't', url: 'u', cadence: 'c', tier: 'A', freshnessField: 'generatedAt', stalenessWarningHours: 24 };
    const base = { id: 't', url: 'u', tier: 'A', cadence: 'c', sw: 24, privateRaw: false };
    const g = finalizeFresh(base, new Date(nowMs - 23 * 3600000).toISOString(), 200, null, nowMs);
    const a = finalizeFresh(base, new Date(nowMs - 25 * 3600000).toISOString(), 200, null, nowMs);
    const grey = finalizeFresh(base, null, 200, null, nowMs);
    assert(g.status === 'green' && a.status === 'amber' && grey.status === 'grey', `boundary wrong: ${g.status}/${a.status}/${grey.status}`);
    const weekly = { ...base, sw: 192 };
    const wa = finalizeFresh(weekly, new Date(nowMs - 100 * 3600000).toISOString(), 200, null, nowMs);
    assert(wa.status === 'green', 'weekly cadence must allow 100h');
  });

  // V10 — sanitize: pubkeys scrubbed, titles shortened, summaries never carried
  vec('sanitize: pubkey scrubbed from gate title, summaries never propagated', () => {
    const t = sanitizeGateTitle('STEEM_ACTIVE_WIF בכספת — מסילת-החתימה STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf ועוד פרטים — חלק שני');
    assert(!/STM[0-9a-zA-Z]{20,}/.test(t), 'pubkey leaked');
    assert(t.length <= 80, 'title not truncated');
    const g = { id: 'x', state: 'WAITING-OWNER', title: 'כותרת', ownerActionSummary: 'סוד-מפורט-מדי' };
    const item = distillGates({ source: 'f', gates: [g] })[0];
    assert(!JSON.stringify(item).includes('סוד-מפורט-מדי'), 'ownerActionSummary propagated');
  });

  // V11 — proposal filename = <UTC-date>-<slug>.md, deterministic
  vec('proposal filename law: <UTC-date>-<slug>.md', () => {
    const nowMs = Date.UTC(2026, 9, 15, 7, 43, 0);
    const p = buildProposal(mkItem('Gate 04 — Vault/Recovery!!', 'MACHINE-PREP', 9, 2), { bus: { counts: { green: 0, amber: 0, red: 0, grey: 0 }, feeds: [] }, gates: null, digest: { source: 'u', note: 'n', generatedAt: null }, findings: { found: false, note: 'n' }, registry: { source: 'fallback-embedded', note: 'n', registry: { feeds: [] } } }, nowMs);
    assert(p.file === '2026-10-15-gate-04-vault-recovery.md', `unexpected: ${p.file}`);
    assert(p.md.includes('Rollback') && p.md.includes('פקודות-אימות'), 'proposal sections missing');
  });

  // V12 — zero-secret scanner: fail-closed on token-shaped strings
  vec('zero-secret scan: fail-closed write layer', () => {
    const patGhp = 'ghp_' + 'a'.repeat(36); // assembled — the shape never appears literally in source
    assert(scanSecrets('clean text').length === 0, 'false positive on clean');
    assert(scanSecrets('token ' + patGhp).length === 1, 'missed ghp_ token shape');
    assert(scanSecrets('key STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf end').length === 1, 'missed pubkey');
    let threw = false;
    try { writeLane({ '/tmp/never-write-me-retro-test.txt': 'leak ' + patGhp }); } catch { threw = true; }
    assert(threw, 'writeLane must refuse secret-bearing content');
    assert(!existsSync('/tmp/never-write-me-retro-test.txt'), 'forbidden file was written');
  });

  // V13 — 7-b mask law: private repo names redacted deterministically
  vec('7-b mask law: private repo names → private-NN in titles, ids, notes', () => {
    const gates = { source: 'fixture', gates: [
      { id: 'gate-04-vault-home-recovery-meta', state: 'MACHINE-READY', title: 'vault-home vault-chain/recovery-meta.json — סיסמאות (תאום-steem זהה) — פרטים' },
      { id: 'gate-10-saosmartwallet-vault-db', state: 'WAITING-OWNER', title: 'Saosmartwallet vault-DB — הכרעה' },
    ] };
    const items = distillGates(gates);
    const all = JSON.stringify(items);
    for (const repo of PRIVATE_REPOS) assert(!new RegExp(`\\b${repo}\\b`).test(all), `private name leaked: ${repo}`);
    assert(items.some((i) => i.id.includes('private-')), 'mask not applied to ids');
    assert(redactPrivateNames('live-zip registry חי מ-Zip raw') === 'live-private-7 registry חי מ-private-7 raw', `unexpected: ${redactPrivateNames('live-zip registry חי מ-Zip raw')}`);
  });

  // V14 — 7-b mask law: writeLane refuses artifacts containing private names
  vec('7-b mask law: fail-closed write on private-name-bearing artifact', () => {
    let threw = false;
    try { writeLane({ '/tmp/never-write-me-retro-private.txt': 'gate of vault-home details' }); } catch { threw = true; }
    assert(threw, 'writeLane must refuse private-name-bearing content');
    assert(!existsSync('/tmp/never-write-me-retro-private.txt'), 'forbidden file was written');
  });

  // V15 — E1 deed (zai-13c): spread verdict math — tightened/loosened/stale/unknown
  vec('E1 spread verdict: 93.48→tightened/PASS · 94.1→loosened/HOLD · stale→honest STALE · dead→UNKNOWN', () => {
    const now = Date.now();
    const fresh = (bps) => ({ publishedAt: new Date(now - 2 * 3600000).toISOString(), book: { spreadBps: bps } });
    const t = spreadVerdict(fresh(93.48), now, {});
    assert(t.direction === 'tightened' && t.verdict === 'PASS', `93.48 must tighten: ${JSON.stringify(t)}`);
    assert(Math.abs(t.deltaBps - (-0.02)) < 1e-9, `delta wrong: ${t.deltaBps}`);
    assert(t.block.includes('SPREAD-REGIME'), 'verdict block missing');
    const l = spreadVerdict(fresh(94.1), now, {});
    assert(l.direction === 'loosened' && l.verdict === 'HOLD', `94.1 must loosen: ${JSON.stringify(l)}`);
    assert(l.block.includes('+0.60'), `loosened delta text wrong: ${l.block}`);
    const st = spreadVerdict({ publishedAt: new Date(now - 30 * 3600000).toISOString(), book: { spreadBps: 93.48 } }, now, {});
    assert(st.verdict === 'STALE' && st.direction === null, 'stale source must yield honest STALE, never a live verdict');
    assert(st.block.includes('מיושן') && st.block.includes('SPREAD-REGIME'), 'stale block must say so honestly');
    const u = spreadVerdict({ publishedAt: new Date(now - 2 * 3600000).toISOString() }, now, {});
    assert(u.verdict === 'UNKNOWN', 'missing book.spreadBps must be honest UNKNOWN');
    const n = spreadVerdict(null, now, { httpStatus: 404 });
    assert(n.verdict === 'UNKNOWN' && n.block.includes('לא-ידוע'), 'dead source must be honest UNKNOWN');
  });

  // V16 — zai-13c: work-orders distill — counts, missing-status=open, open-P1 surfacing, owner-word class
  vec('work-orders: 2 open + 1 resolved → counts; open P1s surface as WO- MACHINE-PREP; missing status = open', () => {
    const orders = [
      { id: 'WO-alpha', area: 'A', priority: 'P1', title: 'רפא ריצות אדומות', why: 'עורק-שקט', acceptance: 'ירוק מלא' },
      { id: 'WO-beta', area: 'B', priority: 'P2', title: 'משהו קטן', status: 'resolved' },
      { id: 'WO-gamma', area: 'C', priority: 'P1', title: 'פתיחת-מסילה', why: 'דבר-בעלים נדרש כאן', acceptance: 'טקס' },
      { id: 'delta', area: 'D', priority: 'P1', title: 'בלי קידומת' },
    ];
    const wo = { source: 'fixture', note: 'n', orders, counts: workOrderCounts(orders) };
    assert(wo.counts.open === 3 && wo.counts.resolved === 1 && wo.counts.openP1 === 3, `counts wrong: ${JSON.stringify(wo.counts)}`);
    const items = distillWorkOrders(wo);
    const a = items.find((i) => i.id === 'WO-alpha');
    assert(a && a.riskClass === 'MACHINE-PREP' && a.executableBy === 'owner-after-prep', 'open P1 infra fix must surface MACHINE-PREP');
    assert(!items.some((i) => i.id === 'WO-beta'), 'resolved order must not surface');
    const g = items.find((i) => i.id === 'WO-gamma');
    assert(g && g.riskClass === 'OWNER-WORD' && g.ownerWordRequired, 'owner-word text must classify OWNER-WORD');
    assert(items.some((i) => i.id === 'WO-delta'), 'missing WO- prefix must be normalized');
  });

  // V17 — work-orders + E1 honest-fail law: unavailable sources → zero invented items, honest unknown in artifacts
  vec('honest-fail: work-orders unavailable → no items/no fake counts; E1 dead → honest UNKNOWN in backlog', () => {
    assert(distillWorkOrders({ source: 'unavailable', note: 'HTTP 404', orders: null, counts: null }).length === 0, 'unavailable must yield zero items');
    const nowMs = Date.now();
    const snapshot = { at: 't', registry: { source: 'fallback-embedded', note: 'n', registry: { schema: 'x', feeds: [] } }, bus: { at: 't', counts: { green: 0, amber: 0, red: 0, grey: 0 }, feeds: [] }, findings: { found: false, note: 'n' }, gates: { source: 'unavailable', note: 'n', gates: null }, digest: { source: 'unavailable', note: 'n', generatedAt: null }, workOrders: { source: 'unavailable', note: 'HTTP 404 (כנה)', orders: null, counts: null }, e1: spreadVerdict(null, nowMs, { httpStatus: 404 }) };
    const backlog = buildBacklog({ snapshot, ranked: rank(distill(snapshot)), executed: executePlan([]), proposal: null, nowMs });
    assert(backlog.includes('לא-ידוע (כנה)'), 'WO line must be honest-unknown');
    assert(backlog.includes('SPREAD-REGIME: לא-ידוע'), 'E1 line must be honest-unknown');
  });

  // V18 — deed-linkage law (zai-13c): the covered research item is marked EXECUTED, never re-proposed
  vec('deed-linkage: covered E1 item → EXECUTED by builtin + verdict metadata + proposal skips it', () => {
    const nowMs = Date.now();
    const findings = { found: true, date: '2026-10-11', at: 't', lane: 't', experiments: [
      { id: 'E1', name: 'spread-regime', verdict: 'spread tightened (93.48 < 93.5 bps)', ok: true, next: 'track weekly' },
      { id: 'E2', name: 'feed-divergence', verdict: 'healthy band', ok: true, next: 'escalate if >300 repeats' },
    ] };
    const snapshot = { at: new Date(nowMs).toISOString(), registry: { source: 'fallback-embedded', note: 'n', registry: { schema: 'x', feeds: [] } }, bus: { at: 't', counts: { green: 0, amber: 0, red: 0, grey: 0 }, feeds: [] }, findings, gates: { source: 'unavailable', note: 'n', gates: null }, digest: { source: 'unavailable', note: 'n', generatedAt: null }, workOrders: null, e1: spreadVerdict({ publishedAt: new Date(nowMs - 3600000).toISOString(), book: { spreadBps: 93.48 } }, nowMs, {}) };
    const ranked = rank(distill(snapshot));
    const e1 = ranked.find((i) => i.id === 'research-e1-spread-regime');
    assert(e1 && e1.status === 'EXECUTED' && e1.executableBy === 'builtin-e1-spread-regime', `E1 item must be marked EXECUTED: ${JSON.stringify(e1)}`);
    assert(e1.detail && e1.detail.verdict && e1.detail.verdict.includes('SPREAD-REGIME'), 'E1 item must carry the verdict metadata');
    const proposalItem = ranked.find((it) => it.status !== 'EXECUTED') || null;
    assert(proposalItem && proposalItem.id !== 'research-e1-spread-regime', 'executed item must never be re-proposed');
    assert(ranked.some((i) => i.id === 'research-e2-feed-divergence'), 'other research items still surface');
  });

  // V19 — zai-14c profit-oracle DEFENSIVE paths: bad JSON / dead source / unrecognized shape → honest unavailable, zero invented items
  vec('profit-oracle defensive: bad JSON → unavailable · 404 → unavailable · no-known-shape → unavailable · zero invented items', () => {
    const bad = parseProfitOracle({ ok: true, status: 200, text: '{not-json-at-all', error: null });
    assert(bad.unavailable === true && /JSON תקול/.test(bad.note), `bad JSON must be honest unavailable: ${JSON.stringify(bad)}`);
    const dead = parseProfitOracle({ ok: false, status: 404, text: '404: Not Found', error: null });
    assert(dead.unavailable === true && /HTTP 404/.test(dead.note), `404 must be honest unavailable: ${JSON.stringify(dead)}`);
    const netErr = parseProfitOracle({ ok: false, status: 0, text: '', error: 'ECONNREFUSED-mock' });
    assert(netErr.unavailable === true && /ECONNREFUSED-mock/.test(netErr.note), 'network failure must be honest unavailable with reason');
    const shape = parseProfitOracle({ ok: true, status: 200, text: JSON.stringify({ hello: 'world', version: 3 }), error: null });
    assert(shape.unavailable === true && /צורה לא-מוכרת/.test(shape.note), `unrecognized shape must be honest unavailable: ${JSON.stringify(shape)}`);
    assert(distillProfit(bad).length === 0 && distillProfit(dead).length === 0 && distillProfit(shape).length === 0 && distillProfit(null).length === 0 && distillProfit({ unavailable: true }).length === 0,
      'unavailable/missing profit must yield zero invented items');
  });

  // V20 — zai-14c good fixture → fields extracted + surfaced in backlog/retro/state/index
  vec('profit-oracle good fixture: fields extracted (netWorth/delta/verdict/grid/at) + surfaced in BACKLOG/RETRO/state/index', () => {
    const po = parseProfitOracle({ ok: true, status: 200, text: JSON.stringify({ schema: 'sandbox/profit-oracle/1', at: '2026-10-12T05:29:00Z', netWorthSbdEquiv: 1234.5, deltaVsPriorPct: 0.42, verdict: 'PROFIT', gridVerdict: 'EDGE-POSITIVE' }), error: null });
    assert(po.unavailable === false, 'good fixture must parse as available');
    assert(po.netWorthSbdEquiv === 1234.5 && po.deltaVsPriorPct === 0.42 && po.verdict === 'PROFIT' && po.gridVerdict === 'EDGE-POSITIVE' && po.at === '2026-10-12T05:29:00Z', `fields wrong: ${JSON.stringify(po)}`);
    // 14b's real live shape (union-receipt): fields nested inside `summary`, verdict UNKNOWN (honest null here)
    const poNested = parseProfitOracle({ ok: true, status: 200, text: JSON.stringify({ at: '2026-10-11T23:50:30.041Z', summary: { netWorthSbdEquiv: 455.32, deltaVsPriorPct: null, gridVerdict: 'EDGE-NEGATIVE-GRID-HOLD', verdict: 'UNKNOWN' } }), error: null });
    assert(poNested.unavailable === false && poNested.netWorthSbdEquiv === 455.32 && poNested.gridVerdict === 'EDGE-NEGATIVE-GRID-HOLD' && poNested.verdict === null && poNested.deltaVsPriorPct === null && poNested.at === '2026-10-11T23:50:30.041Z', `summary-nested shape (14b live) must extract: ${JSON.stringify(poNested)}`);
    assert(!distillProfit(po).length, 'PROFIT must not fire the loss guard');
    const nowMs = Date.now();
    const snapshot = { at: new Date(nowMs).toISOString(), registry: { source: 'fallback-embedded', note: 'n', registry: { schema: 'x', feeds: [] } }, bus: { at: 't', counts: { green: 0, amber: 0, red: 0, grey: 0 }, feeds: [] }, findings: { found: false, note: 'n' }, gates: { source: 'unavailable', note: 'n', gates: null }, digest: { source: 'unavailable', note: 'n', generatedAt: null }, workOrders: null, e1: null, profit: po };
    const ranked = rank(distill(snapshot));
    assert(!ranked.some((i) => i.id === 'profit-guard-loss'), 'PROFIT fixture must not produce the guard item');
    const executed = executePlan(ranked);
    const ctx = { snapshot, ranked, executed, proposal: buildProposal(ranked[0], snapshot, nowMs), nowMs };
    const dir = mkdtempSync(join(tmpdir(), 'retro-po-'));
    try {
      const files = {
        [join(dir, 'BACKLOG.md')]: buildBacklog(ctx),
        [join(dir, 'RETRO-LATEST.md')]: buildRetroLatest(ctx),
        [join(dir, 'retro-state.json')]: JSON.stringify(buildState(ctx), null, 2),
        [join(dir, 'index.html')]: renderIndex(ctx),
      };
      writeLane(files);
      const backlog = readFileSync(join(dir, 'BACKLOG.md'), 'utf8');
      assert(backlog.includes('1234.5') && backlog.includes('PROFIT'), 'backlog must surface the profit fields');
      const state = JSON.parse(readFileSync(join(dir, 'retro-state.json'), 'utf8'));
      assert(state.profit && state.profit.unavailable === false && state.profit.verdict === 'PROFIT' && state.profit.netWorthSbdEquiv === 1234.5 && state.profit.deltaVsPriorPct === 0.42 && state.profit.gridVerdict === 'EDGE-POSITIVE', 'state must carry the profit fields');
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      assert(html.includes('profit-oracle') && html.includes('PROFIT') && html.includes('1234.5'), 'index must surface the profit block');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // V21 — zai-14c guard law boundaries: LOSS verdict or delta < -0.5% → ONE SAFE doc-only item; healthy → none
  vec('profit-guard law: LOSS → one SAFE doc-only item · delta -0.8 fires · -0.4/-0.5 boundary + PROFIT/FLAT stay silent', () => {
    const mk = (v, d) => ({ unavailable: false, source: 'fixture', note: 'n', verdict: v, deltaVsPriorPct: d, netWorthSbdEquiv: 100, gridVerdict: null, at: '2026-10-12T05:29:00Z' });
    const loss = distillProfit(mk('LOSS', 0.1));
    assert(loss.length === 1 && loss[0].id === 'profit-guard-loss' && loss[0].riskClass === 'SAFE' && loss[0].ownerWordRequired === false, `LOSS must fire exactly one SAFE guard: ${JSON.stringify(loss)}`);
    assert(loss[0].executableBy === 'next-retro' && /doc-only/.test(loss[0].title), 'guard must be doc-only next-retro');
    const deltaFire = distillProfit(mk('FLAT', -0.8));
    assert(deltaFire.length === 1 && deltaFire[0].id === 'profit-guard-loss', 'delta < -0.5 must fire even when verdict is not LOSS');
    assert(distillProfit(mk('FLAT', -0.4)).length === 0, 'delta -0.4 must NOT fire');
    assert(distillProfit(mk('FLAT', -0.5)).length === 0, 'delta exactly -0.5 must NOT fire (strict <)');
    assert(distillProfit(mk('PROFIT', 1.2)).length === 0, 'PROFIT must not fire');
    assert(distillProfit(mk(null, null)).length === 0, 'no verdict + no delta must not fire');
  });

  const passed = results.filter((r) => r.pass).length;
  for (const r of results) {
    console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'} — ${r.name}${r.pass ? '' : `\n   ${r.err}`}`);
  }
  console.log(`\nselftest: ${passed}/${results.length} PASS`);
  return passed === results.length ? 0 : 1;
}

// ─────────────────────────────────────────────── main
if (hasFlag('--selftest')) {
  process.exit(selftest());
}
if (hasFlag('--verify-bus')) {
  runVerifyBus({ json: hasFlag('--json') }).then((code) => process.exit(code)).catch((e) => {
    console.error(`verify-bus failed: ${e && e.message}`);
    process.exit(1);
  });
} else {
  runLive().catch((e) => {
    console.error(`retro failed: ${e && (e.stack || e.message)}`);
    process.exit(1);
  });
}
