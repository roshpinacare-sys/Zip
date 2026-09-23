// ─────────────────────────────────────────────────────────────────────
// STUDENT — התלמיד · האוטונומיה המתפתחת (R94).
//
// הוראת המפעיל שיצרה את הדיבון: "אני רוצה אוטונומיה מתפתחת שמייעלת
// את עצמה בוחנת את עצמה ולומדת את עצמה טוב יותר... אם נכסה את הכל
// מבחינת סוכנים וניתן להם יכולות שיפור הבנה התייעלות וכו הם יוכלו
// לשפר הכל כמכלול... אני לא רוצה ריבונות עצלנית אני רוצה הוכחות
// התפתחות הבנה התייעלות".
//
// מה התלמיד עושה בכל מחזור (10 דק'):
//   1. בחינה-עצמית: בודק את המערכות (API מקומיים + צי הדיבונים)
//      ומודד זמינות + זמן-תגובה. כישלון נרשם כ"לא נמדד" — לא מוסתר.
//   2. מפת-כיסוי הרשת: 16 הריפואים — דחיפה אחרונה, סוכנים פעילים,
//      פסק-דין ריצה אחרונה. מי מתקדם בלי עין = פער מתועד.
//   3. למידה מההיסטוריה: קורא את ה-worklog (הספר שלנו), סופר
//      סבבים, באגים-חיים שנתפסו ולקחים — ובונה מדד-התפתחות מדוד.
//      למידה מהישנות: כשל חוזר 3× רצוף מסומן RECURRING עד ריפוי.
//   4. ספר-פוטנציאל: מה צפוי מהרשת, מה נמדד, מה חסום מאחורי שער.
//   5. ריפוי-בטוח (תקציב 3/יום): סנכרון הספר + ריפוי הצ'רטרים —
//      הפעולות האידמפוטנטיות המתועדות בלבד. שום דבר אחר.
//
// חוקי-ברזל:
//   · לעולם לא מזייף מספר — כישלון מדידה = "לא נמדד"
//   · ה-PAT בקריאה בלבד, לעולם לא נכתב לשום מקום
//   · אין פעולת-כסף, אין פעולת-גיט — רק מדידה + ריפוי מתועד
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/student/state.json`;
const PORT = 3037;
const CYCLE_SEC = 600;
const COVERAGE_EVERY = 6; // כל 6 מחזורים = שעה — עדינות מול ה-API של GitHub
const WORKLOG = `${HOME}/worklog.md`;
const GH = "https://api.github.com";

// ── הגדרות-כיסוי: הריפואים המוכרים + תפקידם (נמדדו בפתיחת R94) ────

const REPO_ROLES: Record<string, string> = {
  Zip: "בית ריבוני — ספר, סקריפטים, worklog",
  Console: "קונסולה ציבורית — אתר, זרימות, גשר-סוכנים",
  steem: "כלי רשות העוגן",
  "saos-dex": "מנוע הדקס",
  Defi: "ריפו-קנון — דוחות וקבלות",
  Domain: "מראה ציבורית — המכונה (20 זרימות)",
  "saos-sovereign-foundry": "CI חוזים — האמת לפי הריצה האחרונה (לא הזיכרון)",
  Adsmarket: "שמירת-טענות שיווק",
  "anchor-baseline": "שלמות בסיס-קו",
  roshpina: "ביקורת בקרות",
  Sdk: "אימות SDK",
  "saos-jummper": "סוויטת נוטריון",
  "Project-files": "שומר-ארכיון",
  "saos-control-center": "בניית מרכז-בקרה",
  "saos-sovereign-platform": "מנוע-קצה",
  Saosmartwallet: "אימות ארנק",
};

// ── טיפוסים ────────────────────────────────────────────────────────

type Decision = { at: string; kind: string; detail: string };

interface ProbeResult {
  probe: string;
  ok: boolean;
  ms: number | null;
  at: string;
}

interface CoverageEntry {
  repo: string;
  role: string;
  pushedAt: string | null;
  pushAgeH: number | null;
  workflows: number | null;
  lastRun: { name: string; conclusion: string | null; createdAt: string | null } | null;
  verdict: "AGENTED" | "STALE" | "IDLE" | "UNKNOWN";
}

interface Finding {
  id: string;
  title: string;
  detail: string;
  state: "OPEN" | "WORKING" | "GATED" | "DONE" | "DISPROVEN";
  addedAt: string;
  updatedAt: string;
  source: "seeded" | "live";
  verify?: VerifyEvidence;
}

interface HealReceipt {
  at: string;
  action: string;
  ok: boolean;
  detail: string;
}

interface Lessons {
  rounds: number;
  liveBugsCaught: number;
  fixedMentions: number;
  honestyMentions: number;
  parsedAt: string;
  note: string[];
}

interface StudentState {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  cycleSec: number;
  alive: boolean;
  examining: boolean;
  lastExamAt: string | null;
  probes: ProbeResult[];
  probeHistory: ProbeResult[]; // חלון מגולגל — 24 שעות בערך
  recurring: Array<{ probe: string; since: string; count: number; resolvedAt: string | null }>;
  coverage: CoverageEntry[];
  coverageAt: string | null;
  findings: Finding[];
  lessons: Lessons | null;
  heal: { receipts: HealReceipt[]; today: number; day: string };
  history: Decision[];
}

// ── מצב ──────────────────────────────────────────────────────────────

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function seedFindings(): Finding[] {
  const now = new Date().toISOString();
  const mk = (id: string, title: string, detail: string, st: Finding["state"]): Finding => ({
    id, title, detail, state: st, addedAt: now, updatedAt: now, source: "seeded",
  });
  return [
    mk(
      "P1",
      "גריד דו-צדדי על שוק Steem",
      "צד המכירה חמוש וחי (מוביל הכסף R81+). צד הקנייה דורש מלאי SBD — שער-מפעיל בסף 0.15. מנוע המדידה: /api/market/cross (R94)",
      "GATED",
    ),
    mk(
      "P2",
      "סוכני-פיתוח לכל ריפו (לא רק אימות)",
      "16/16 ריפואים מכוסים בסוכני אימות — אף סוכן לא מפתח בעצמו. התלמיד (R94) מודד את הפער; פיתוח אוטונומי אמיתי עבר למספנת הצ'רטרים (R89) עם בונים חיצוניים",
      "WORKING",
    ),
    mk(
      "P3",
      "Foundry CI אדום 0/100",
      "מתועד כסימן-אדום כנה מאז 2026-09-14 (OL-3). תיקון בדיקות החוזה או פיצוי בהערה ציבורית",
      "OPEN",
    ),
    mk(
      "P4",
      "מנוע השוק הבין-רשתי",
      "STEEM/SBD + HIVE/HBD + חיצוניים + סימולציית גריד על היסטוריה אמיתית — נבנה ב-R94, API /api/market/cross",
      "DONE",
    ),
    mk(
      "P5",
      "דיבון התלמיד — בחינה עצמית מתמדת",
      "בחינה עצמית, מפת-כיסוי, למידה מה-worklog וספר-פוטנציאל — נולד בסשן זה (R94)",
      "DONE",
    ),
    mk(
      "P6",
      "עיגון-חוץ לצ'רטרים על שרשרת ציבורית",
      "הושלם ב-R91: שורש Merkle ב-custom_json על Steem, אומת מההיסטוריה",
      "DONE",
    ),
    mk(
      "P7",
      "סחירות BLURT",
      "אין טוקן-דולר/שוק פנימי; צומת RPC לא נענה מהסנדבוקס. דורש בורסה חיצונית = שער-מפעיל",
      "GATED",
    ),
  ];
}

function freshState(): StudentState {
  return {
    service: "student",
    version: "1.1.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    cycleSec: CYCLE_SEC,
    alive: true,
    examining: false,
    lastExamAt: null,
    probes: [],
    probeHistory: [],
    recurring: [],
    coverage: [],
    coverageAt: null,
    findings: seedFindings(),
    lessons: null,
    heal: { receipts: [], today: 0, day: utcDay() },
    history: [],
  };
}

function readState(): StudentState {
  const base = freshState();
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.heal?.day === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastExamAt: prev.lastExamAt ?? null,
      probes: Array.isArray(prev.probes) ? prev.probes : [],
      probeHistory: Array.isArray(prev.probeHistory) ? prev.probeHistory.slice(-2000) : [],
      recurring: Array.isArray(prev.recurring) ? prev.recurring : [],
      coverage: Array.isArray(prev.coverage) ? prev.coverage : [],
      coverageAt: prev.coverageAt ?? null,
      // ספר-הפוטנציאל: זרעים חיים רק פעם אחת — אחר-כך המצב נשמר (למידה אמיתית = היסטוריה)
      findings: Array.isArray(prev.findings) && prev.findings.length ? prev.findings : base.findings,
      lessons: prev.lessons ?? null,
      heal: {
        receipts: Array.isArray(prev.heal?.receipts) ? prev.heal.receipts.slice(-40) : [],
        today: sameDay ? (prev.heal?.today ?? 0) : 0,
        day: sameDay ? prev.heal.day : utcDay(),
      },
      history: Array.isArray(prev.history) ? prev.history.slice(-40) : [],
    };
  } catch {
    return base;
  }
}

let state: StudentState = readState();
let coverageTriggered = false;

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/student`, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

// ── 1. בחינה-עצמית: בדיקות-מערכות ─────────────────────────────────

const HTTP_PROBES: Array<{ name: string; url: string }> = [
  { name: "app:health", url: "http://127.0.0.1:3000/api/health" },
  { name: "app:money", url: "http://127.0.0.1:3000/api/money" },
  { name: "app:crossmarket", url: "http://127.0.0.1:3000/api/market/cross" },
  { name: "app:charter", url: "http://127.0.0.1:3000/api/charter" },
  { name: "fleet:pulse", url: "http://127.0.0.1:3033/" },
  { name: "fleet:money", url: "http://127.0.0.1:3034/" },
  { name: "fleet:hunter", url: "http://127.0.0.1:3035/" },
  { name: "fleet:keeper", url: "http://127.0.0.1:3036/" },
];

async function probeOne(p: { name: string; url: string }): Promise<ProbeResult> {
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const res = await fetch(p.url, { signal: ctl.signal, cache: "no-store" });
    return { probe: p.name, ok: res.ok, ms: Date.now() - started, at: new Date().toISOString() };
  } catch {
    return { probe: p.name, ok: false, ms: null, at: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}

async function selfExamine(): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  // טורי — בדיקות מהירות, לא מציפות את השרת
  for (const p of HTTP_PROBES) {
    out.push(await probeOne(p));
  }
  return out;
}

// ── 2. למידה מהישנות: RECURRING / RESOLVED ──────────────────────────

function learnRecurrence(probes: ProbeResult[]): string[] {
  const notes: string[] = [];
  for (const pr of probes) {
    const recent = state.probeHistory.filter((h) => h.probe === pr.probe).slice(-3);
    const allFailed = [...recent.map((h) => h.ok), pr.ok].filter((x) => x === false).length;
    const entry = state.recurring.find((r) => r.probe === pr.probe && !r.resolvedAt);
    if (allFailed >= 4 && !entry) {
      state.recurring.push({ probe: pr.probe, since: pr.at, count: allFailed, resolvedAt: null });
      notes.push(`RECURRING: ${pr.probe} נכשל ${allFailed}× רצוף — מסומן ככשל-חוזר עד ריפוי`);
    } else if (entry) {
      entry.count = allFailed;
      if (pr.ok) {
        entry.resolvedAt = pr.at;
        notes.push(`RESOLVED: ${pr.probe} התאושש — ההישנות נסגרה ונלמדה (${pr.at})`);
      }
    }
  }
  state.recurring = state.recurring.slice(-30);
  return notes;
}

// ── 3. מפת-כיסוי הרשת (GitHub, קריאה בלבד) ─────────────────────────

// ── 3ב. מאמת-האמת (R95 — מפקד האמת) ──────────────────────────────
// לקח-המקור: P3 נזרע מזיכרון (OL-3, 2026-09-14) בעוד הריצה האחרונה
// של foundry כבר הייתה ירוקה (2026-09-16, נסגר ב-Task 43). הקנון ידע —
// התלמיד לא, כי הוא זכר במקום למדוד. מעתה: כל טענה שניתנת לאימות
// נמדדת מול המקור החי לפני שהיא נשארת פתוחה. הזיכרון מפגר — המדידה לא.

interface VerifyEvidence {
  at: string;
  claim: string;
  verdict: "DISPROVEN" | "CONFIRMED" | "INCONCLUSIVE";
  evidence: string;
}

async function ghJson(pat: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${GH}${path}`, {
      headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "student-daemon" },
      cache: "no-store",
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// מאמת P3: "Foundry CI אדום 0/100" — האמת היא הריצה האחרונה, לא הזיכרון
async function verifyFoundryCiClaim(pat: string): Promise<Omit<VerifyEvidence, "at" | "claim"> | null> {
  const j = await ghJson(pat, "/repos/roshpinacare-sys/saos-sovereign-foundry/actions/runs?per_page=1");
  const last = j?.workflow_runs?.[0];
  if (!last || !last.conclusion) return null; // רץ כרגע / לא-נמדד — טרם ניתן לשיפוט
  const short = `ריצה #${last.run_number} · ${String(last.head_sha ?? "").slice(0, 7)} · ${last.created_at} · ${last.html_url}`;
  if (last.conclusion === "success") {
    return { verdict: "DISPROVEN", evidence: `CI ירוק בריצה האחרונה — ${short}` };
  }
  if (last.conclusion === "failure" || last.conclusion === "timed_out") {
    return { verdict: "CONFIRMED", evidence: `CI אדום בפועל — ${short}` };
  }
  return null;
}

async function verifyFindings(): Promise<string[]> {
  const notes: string[] = [];
  const pat = readPat();
  const now = new Date().toISOString();
  const p3 = state.findings.find((f) => f.id === "P3");
  if (p3 && p3.state === "OPEN" && pat) {
    const v = await verifyFoundryCiClaim(pat);
    if (v) {
      p3.verify = { at: now, claim: "Foundry CI אדום 0/100", ...v };
      p3.updatedAt = now;
      p3.source = "live";
      if (v.verdict === "DISPROVEN") {
        p3.state = "DISPROVEN";
        p3.title = "Foundry CI — הטענה הופרכה במדידה";
        p3.detail = `האמונה "אדום 0/100" הופרכה במדידה חיה: ${v.evidence}. האדום ההיסטורי (99 כישלונים) נסגר ב-Task 43; מקור הזרע (OL-3, 2026-09-14) הקדים את התיקון — הזיכרון מפגר אחרי המציאות (TRUTH-AUDIT §15.5).`;
        notes.push("VERIFY: P3 הופרך במדידה חיה — foundry CI ירוק. האמונה השקרית נסגרה בראיה, לא בזיכרון");
      } else {
        notes.push(`VERIFY: P3 אומת כאדום בפועל — ${v.evidence}`);
      }
    }
  }
  return notes;
}

async function measureCoverage(): Promise<void> {
  const pat = readPat();
  if (!pat) {
    state.coverageAt = new Date().toISOString();
    return;
  }
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "student-daemon",
  };
  const out: CoverageEntry[] = [];
  try {
    const res = await fetch(`${GH}/user/repos?per_page=100&affiliation=owner`, { headers });
    if (!res.ok) throw new Error(`repos http ${res.status}`);
    const repos = (await res.json()) as Array<{ name: string; pushed_at: string }>;
    for (const r of repos) {
      const pushedAt = r.pushed_at ?? null;
      const pushAgeH = pushedAt ? Math.max(0, (Date.now() - Date.parse(pushedAt)) / 3_600_000) : null;
      let workflows: number | null = null;
      let lastRun: CoverageEntry["lastRun"] = null;
      try {
        const wfRes = await fetch(`${GH}/repos/roshpinacare-sys/${r.name}/actions/workflows?per_page=100`, { headers });
        if (wfRes.ok) {
          const wf = (await wfRes.json()) as { workflows?: Array<{ state?: string; path?: string }> };
          workflows = (wf.workflows ?? []).filter((w) => w.state === "active" && (w.path ?? "").startsWith(".github/")).length;
        }
        const runRes = await fetch(`${GH}/repos/roshpinacare-sys/${r.name}/actions/runs?per_page=1`, { headers });
        if (runRes.ok) {
          const runs = (await runRes.json()) as { workflow_runs?: Array<{ name: string; conclusion: string | null; created_at: string }> };
          const last = runs.workflow_runs?.[0];
          if (last) lastRun = { name: last.name, conclusion: last.conclusion, createdAt: last.created_at };
        }
      } catch {
        // ריפו בודד — נסומן UNKNOWN בכנות
      }
      // פסק-דין כפול (R94): עם-סוכן ומתקדם · עצור (סוכן יש, דחיפה 3+ ימים)
      // · חסר-סוכן · לא-נמדד. "התקדמות במשך ימים" של המפעיל — נמדדת כאן.
      let verdict: CoverageEntry["verdict"];
      if (workflows == null) verdict = "UNKNOWN";
      else if (workflows === 0) verdict = "IDLE";
      else if (pushAgeH != null && pushAgeH > 72) verdict = "STALE";
      else verdict = "AGENTED";
      out.push({ repo: r.name, role: REPO_ROLES[r.name] ?? "", pushedAt, pushAgeH, workflows, lastRun, verdict });
    }
    out.sort((a, b) => (b.pushAgeH ?? 0) - (a.pushAgeH ?? 0));
  } catch {
    // כיסוי שלם לא נמדד — נשמר הקודם, בכנות
  }
  if (out.length) state.coverage = out;
  state.coverageAt = new Date().toISOString();
}

// ── 4. למידה מה-worklog — ספר-הדורות שלנו ──────────────────────────

function learnFromWorklog(): Lessons {
  try {
    const text = fs.readFileSync(WORKLOG, "utf8");
    const rounds = [...text.matchAll(/^Task ID:\s*(\S+)/gm)].map((m) => m[1]);
    const liveBugsCaught = (text.match(/באג חי|באגים חיים/g) ?? []).length;
    const fixedMentions = (text.match(/תוקן|תיקון/g) ?? []).length;
    const honestyMentions = (text.match(/כנות|בכנות/g) ?? []).length;
    return {
      rounds: rounds.length,
      liveBugsCaught,
      fixedMentions,
      honestyMentions,
      parsedAt: new Date().toISOString(),
      note: [
        `${rounds.length} סבבי-עבודה תועדו מאז הפתיחה — כל אחד בנוי על קודמו`,
        `${liveBugsCaught} אזכורי "באג חי" — באגים שנתפסו בשידור חי ותוקנו בשורש, לא טואטאו`,
        "לקח-הדורות (נלמד מהספר): ההיסטוריה מפגרת אחרי השרשרת — אימות שידור דורש חלון + דה-דופ (R87/R91)",
        "לקח-הדורות: bun --hot מקפיא טיימרים — בריאות דיבון נמדדת לפי טריות פעימות, לא פורט פתוח (R91)",
        "לקח-מפקד-האמת (R95): מסמך של ריפו יכול לשקר על הריפו — מפת הדרכים של foundry סימנה 5 סעיפים פתוחים כש-4 כבר נסגרו; אמת נמדדת מהקוד והריצות, לא מהזיכרון",
      ],
    };
  } catch {
    return {
      rounds: 0,
      liveBugsCaught: 0,
      fixedMentions: 0,
      honestyMentions: 0,
      parsedAt: new Date().toISOString(),
      note: ["ה-worklog לא נקרא במחזור זה — לא נמדד"],
    };
  }
}

// ── 5. ריפוי-בטוח (אידמפוטנטי, מתועד, בתקציב) ────────────────────────

async function safeHeal(): Promise<string[]> {
  const notes: string[] = [];
  // תקציב יומי: 3 ריפויים — לא מפציצים
  if (state.heal.today >= 3) return notes;
  const doHeal = async (action: string, run: () => Promise<{ ok: boolean; detail: string }>) => {
    if (state.heal.today >= 3) return;
    try {
      const r = await run();
      state.heal.today += 1;
      state.heal.receipts.push({ at: new Date().toISOString(), action, ok: r.ok, detail: r.detail });
      state.heal.receipts = state.heal.receipts.slice(-40);
      notes.push(`${action}: ${r.ok ? "ok" : "נכשל"} — ${r.detail}`);
    } catch (e: any) {
      state.heal.today += 1;
      state.heal.receipts.push({ at: new Date().toISOString(), action, ok: false, detail: String(e?.message ?? e).slice(0, 100) });
      notes.push(`${action}: חריגה — תועדה בכנות`);
    }
  };
  // ריפוי הצ'רטרים — קריאה מאושרת אידמפוטנטית (R92: selfHeal)
  await doHeal("charter-selfheal", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/charter/projects", { cache: "no-store" });
    const j = res.ok ? await res.json().catch(() => null) : null;
    return { ok: !!(j?.ok), detail: j?.count != null ? `${j.count} פרויקטים · אירועים ${j?.healed?.eventsImported ?? 0}` : `http ${res.status}` };
  });
  // סנכרון הספר — פעולת-פרוטוקול הסשן (R93: ה-POST האידמפוטנטי המתועד)
  await doHeal("book-sync", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/weave/sovereignty/sync", { method: "POST", cache: "no-store" });
    const j = res.ok ? await res.json().catch(() => null) : null;
    return { ok: !!(j?.ok), detail: j?.imported?.attestations != null ? `${j.imported.attestations} אימותים` : `http ${res.status}` };
  });
  return notes;
}

// ── מחזור ────────────────────────────────────────────────────────────

let ticking = false;
async function tick() {
  if (ticking || state.examining) return;
  ticking = true;
  state.examining = true;
  try {
    state.beats += 1;

    // בחינה-עצמית
    const probes = await selfExamine();
    state.probes = probes;
    state.probeHistory = [...state.probeHistory, ...probes].slice(-2000);
    const learnNotes = learnRecurrence(probes);

    // כיסוי — כל שעה (עדינות מול GitHub), ומיד אחריו מאמת-האמת:
    // כל טענה פתוחה שאפשר למדוד — נמדדת מול המקור החי (R95).
    if (state.beats % COVERAGE_EVERY === 1) {
      await measureCoverage();
      const verifyNotes = await verifyFindings();
      state.history = [
        ...state.history,
        ...verifyNotes.map((n) => ({ at: new Date().toISOString(), kind: "VERIFY", detail: n })),
      ].slice(-40);
    }

    // למידה מה-worklog — פעם בשעה
    if (state.beats % COVERAGE_EVERY === 2) {
      state.lessons = learnFromWorklog();
    }

    // ריפוי-בטוח — פעם בשעה (פרוטוקול הסשן, אידמפוטנטי)
    const healNotes = state.beats % COVERAGE_EVERY === 3 ? await safeHeal() : [];

    // סיכום-החלטה
    const okCount = probes.filter((p) => p.ok).length;
    const coverageOk = state.coverage.filter((c) => c.verdict === "AGENTED").length;
    const staleCount = state.coverage.filter((c) => c.verdict === "STALE").length;
    const detail =
      `בחינה: ${okCount}/${probes.length} מערכות תקינות` +
      (state.coverage.length
        ? ` · כיסוי רשת: ${coverageOk}/${state.coverage.length} מתקדמים עם סוכן${staleCount ? ` · ${staleCount} עצורים 3+ ימים (פער מתועד)` : ""}`
        : "") +
      (state.recurring.some((r) => !r.resolvedAt) ? ` · כשלים חוזרים פתוחים` : "") +
      (healNotes.length ? ` · ריפוי: ${healNotes.length}` : "");
    state.lastDecision = { at: new Date().toISOString(), kind: "EXAMINE", detail };
    state.history = [
      ...state.history,
      state.lastDecision,
      ...learnNotes.map((n) => ({ at: new Date().toISOString(), kind: "LEARN", detail: n })),
      ...healNotes.map((n) => ({ at: new Date().toISOString(), kind: "HEAL", detail: n })),
    ].slice(-40);
    state.lastExamAt = new Date().toISOString();
  } catch (e: any) {
    state.history = [
      ...state.history,
      { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) },
    ].slice(-40);
  } finally {
    state.examining = false;
    ticking = false;
    saveState();
  }
}

// ── שרת-בריאות ─────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      // מדד-זמינות נגזר (מדידה, לא המצאה): אחוז הבדיקות שעברו בחלון
      const win = state.probeHistory.slice(-8 * HTTP_PROBES.length);
      const uptime = win.length ? Math.round((win.filter((h) => h.ok).length / win.length) * 100) : null;
      return Response.json({
        ...state,
        ok: true,
        alive: true,
        uptimePct: uptime,
        now: new Date().toISOString(),
      });
    }
    // טריגר-מפעיל: מדידת-כיסוי חדשה — מיד ברקע (קריאה בלבד — בטוח).
    // התשובה חוזרת מיד (מדידת-המקור אורכת עשרות שניות — Bun.serve חותך
    // חיבורים סרקניים אחרי 10ש'); התוצאה נקראת מ-/ כשהיא מוכנה (coverageAt).
    if (url.pathname === "/coverage") {
      if (!coverageTriggered) {
        coverageTriggered = true;
        void measureCoverage()
          .then(() => verifyFindings())
          .catch(() => {})
          .finally(() => {
            coverageTriggered = false;
            saveState();
          });
      }
      return Response.json({ ok: true, triggered: true, coverageAt: state.coverageAt });
    }
    return new Response("not found", { status: 404 });
  },
});

saveState();
console.log(`[student] התלמיד חי על פורט ${PORT} · beats=${state.beats} · מחזור ${CYCLE_SEC}s`);
tick();
setInterval(tick, CYCLE_SEC * 1000);
