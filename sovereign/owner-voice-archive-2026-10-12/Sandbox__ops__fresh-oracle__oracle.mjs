#!/usr/bin/env node
/**
 * fresh-oracle — שער-אימות-עומד (STANDING VERIFICATION GATE) · zai-12b · trace 1a12cf99469635d9
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * מצטרף ל-OWNER-WORD המדוגל של zai-13 ("standing scheduled gate") — הקבלה של המדידה הראשונה שלהם
 * (receipts/fresh-oracle-2026-10-11.json · V-FLEETHQ-FRESH 4/4 MATCH) לשער-מתוזמן קבוע.
 * הקבלה, לא החלפה: הקובץ המקורי של zai-13 לא נוגע; הפנקס-המאוחד שומר את התוכן שלו תחת `prior`.
 *
 * צ'רטר (ops/sovereign/DECIDER/CHARTER.md) — זה המכשיר של R1 על המשטחים-הציבוריים:
 *   R1 אנטי-זיופים: אין ירוק בלי מדידה עצמאית. שוויון-בתים נדרש, לא טענה.
 *   R5 כנות-מעל-הכל: כשל-רשת = UNKNOWN + סיבה. לעולם לא "מנחשים ירוק".
 *
 * הבדיקות:
 *   V-FLEETHQ-FRESH   בתים-חיים מול בתים-committed (sha256-16hex) · 4 קבצים:
 *                     FleetHQ/ + potential.html (מול ענף office-pages — Pages חי)
 *                     Domain/ + Domain/office3d/ (מול main)
 *                     מקור-committed: raw.githubusercontent ב-ref הנכון — אומת אמפירית
 *                     שווה-בתים ל-git show על ה-remote-tracking ref המזוכך.
 *   V-KEYPROOF-FRESH  proof/out/KEY-PROOF-LATEST.json קיים + generatedAt ≤ 8d → GREEN
 *                     (8d..15d AMBER, >15d או חסר RED; ALIVE-ALERT → RED צורח)
 *   V-RESEARCH-FRESH  research/findings-*.json החדש ביותר ≤ 9d → GREEN
 *                     (9d..16d AMBER, >16d או חסר RED)
 *   V-BUS-HEALTH      מרשם-הזרימה (Zip, פרטי): ≥80% הזנות-נמדדו + 0 RED → GREEN.
 *                     פורט קריאה-בלבד של שיטת Zip/sovereign/bus-validate.mjs
 *                     (GREEN/AMBER/RED/GREY · stalenessWarningHours · חוק-צורה).
 *                     מקורות-רישם: clone שכן → raw פרטי עם token (מעולם לא נכתב/מודפס)
 *                     → אין גישה = BUS-UNKNOWN כנה ("private registry — validator runs in-lane").
 *   V-DOMAIN-LIVE     Pages 200 + <title> מכיל "מפקדת הצי" + פאנל #p-research קיים → GREEN
 *   V-FLEET-HEARTBEAT (zai-14c) מניפסט-עורקים: 8 מפיקי-workflow של הצי נמדדים מול Actions API
 *                     (הריצה-המוצלחת האחרונה מול maxAgeH לכל-עורק) → GREEN/AMBER/RED/UNKNOWN כנים
 *                     לכל-עורק. --heal: עורק שנמדד-מיושן (AMBER/RED) ו-healable:true →
 *                     workflow_dispatch {"ref":"main"} (ריפוי-מפיקים מדווחים/מראות בלבד — לעולם
 *                     לא-חתימה/שידור). --heal אינו רץ ב-workflow השבועי — כלי-ידני/סוכן בלבד.
 *
 * פסקים: GREEN / AMBER / RED / UNKNOWN — כנים. אפס סודות בפלט (scanner לפני-כתיבה, הפרה = אבוט).
 *
 * שימוש:
 *   node ops/fresh-oracle/oracle.mjs --selftest   # וקטורי-אפס-רשת (12 בסיס + 5 heartbeat = 17)
 *   node ops/fresh-oracle/oracle.mjs              # ריצה-חיה: כותב receipts/fresh-oracle-latest.json + verdict.md
 *   node ops/fresh-oracle/oracle.mjs --heal       # ריצה-חיה + ריפוי-עורקים מיושנים (dispatch + יומן בקבלה)
 *
 * אפס-תלות. node >= 18. ESM טהור.
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/* ══════════════════ חוקים-מספריים (המדידה מחייבת, לא הטענה) ══════════════════ */
export const LAWS = {
  KEYPROOF_GREEN_MAX_DAYS: 8,   // מנדט: ≤ 8 ימים = טרי
  KEYPROOF_AMBER_MAX_DAYS: 15,  // שבועיים-מוחמצים = אדום
  RESEARCH_GREEN_MAX_DAYS: 9,   // מנדט: ≤ 9 ימים = טרי
  RESEARCH_AMBER_MAX_DAYS: 16,
  RUNS_CAP: 12,                 // append-bounded: 12 ריצות אחרונות בלבד
  BUS_MEASURED_FLOOR: 0.8,      // ≥80% מההזנות נמדדו
  BUS_STALENESS_DEFAULT_H: 24,
  FETCH_TIMEOUT_MS: 10_000,
  TITLE_MUST_CONTAIN: "מפקדת הצי",
  RESEARCH_PANEL_ID: 'id="p-research"',
  HEARTBEAT_RED_FACTOR: 2,      // מעל maxAgeH×2 = לפחות-שני-מחזורים הוחמצו → RED (בין לבין = AMBER)
  HEARTBEAT_DISPATCH_RETRIES: 1, // --heal: ניסיון-שליחה אחד + ריטרי-אחד על-כשל-חולף
};

/* מקורות הבתים-committed — raw.githubusercontent ב-ref הנכון (אומת אמפירית 2026-10-11:
   שווה-בתים ל-git show על origin/office-pages ו-origin/main מזוככים, ול-live Pages עצמו). */
export const BYTE_CHECKS = [
  {
    page: "https://roshpinacare-sys.github.io/FleetHQ/",
    committed: "https://raw.githubusercontent.com/roshpinacare-sys/FleetHQ/office-pages/index.html",
    source: "FleetHQ@office-pages:index.html",
  },
  {
    page: "https://roshpinacare-sys.github.io/FleetHQ/potential.html",
    committed: "https://raw.githubusercontent.com/roshpinacare-sys/FleetHQ/office-pages/potential.html",
    source: "FleetHQ@office-pages:potential.html",
  },
  {
    page: "https://roshpinacare-sys.github.io/Domain/",
    committed: "https://raw.githubusercontent.com/roshpinacare-sys/Domain/main/index.html",
    source: "Domain@main:index.html",
  },
  {
    page: "https://roshpinacare-sys.github.io/Domain/office3d/",
    committed: "https://raw.githubusercontent.com/roshpinacare-sys/Domain/main/office3d/index.html",
    source: "Domain@main:office3d/index.html",
  },
];

export const DOMAIN_URL = "https://roshpinacare-sys.github.io/Domain/";
export const ZIP_REGISTRY_RAW =
  "https://raw.githubusercontent.com/roshpinacare-sys/Zip/main/sovereign/bus-registry.json";

/* ══════════════════ עזרים ══════════════════ */
export function sha16(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}
export function isoNow() {
  return new Date().toISOString();
}
export function ageDays(fromIso, nowMs) {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 86400e3);
}

/** מנוע-רשת נתין (injectable): מחזיר {status, body} או {status:0, error}. אף הדפסת-כותרות. */
export function defaultFetcher(url, { headers } = {}) {
  return fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "roshpinacare-fresh-oracle/1 (verification gate)", ...(headers || {}) },
    signal: AbortSignal.timeout(LAWS.FETCH_TIMEOUT_MS),
  })
    .then(async (res) => ({ status: res.status, body: await res.text() }))
    .catch((e) => ({ status: 0, error: String((e && e.message) || e).slice(0, 120) }));
}

/* ══════════════════ V-KEYPROOF-FRESH ══════════════════ */
/** סיווג-טריות טהור — וקטורי-גבול נבדקים ב-selftest. */
export function classifyFreshness({ exists, ageD, incident, greenMax, amberMax }) {
  if (!exists) return { verdict: "RED", note: "ארטיפקט חסר — אין מה להחשיב טרי (כנות, לא מילוי)" };
  if (ageD == null) return { verdict: "RED", note: "חותמת-זמן לא-קריאה בארטיפקט" };
  if (incident) return { verdict: "RED", note: "🚨 ALIVE-ALERT — חומר-מפתות חי נמדד; זעקה, לא טריות" };
  if (ageD <= greenMax) return { verdict: "GREEN", note: `טרי: ${ageD.toFixed(2)}d ≤ ${greenMax}d` };
  if (ageD <= amberMax) return { verdict: "AMBER", note: `מזדקן: ${ageD.toFixed(2)}d (>${greenMax}d, ≤${amberMax}d) — כנה, לא מושתק` };
  return { verdict: "RED", note: `ישן מדי: ${ageD.toFixed(2)}d > ${amberMax}d — מחזור-הוכחה הוחמץ` };
}

export function checkKeyproof({ sandboxRoot, nowMs, readFile }) {
  const measuredAt = isoNow();
  const file = path.join(sandboxRoot, "proof", "out", "KEY-PROOF-LATEST.json");
  try {
    const doc = JSON.parse(readFile(file));
    const ageD = ageDays(doc.generatedAt, nowMs);
    const cls = classifyFreshness({
      exists: true,
      ageD,
      incident: !!(doc.summary && doc.summary.incident),
      greenMax: LAWS.KEYPROOF_GREEN_MAX_DAYS,
      amberMax: LAWS.KEYPROOF_AMBER_MAX_DAYS,
    });
    const s = doc.summary || {};
    return {
      id: "V-KEYPROOF-FRESH",
      verdict: cls.verdict,
      measuredAt,
      evidence: {
        file: "proof/out/KEY-PROOF-LATEST.json",
        generatedAt: doc.generatedAt || null,
        ageDays: ageD == null ? null : Number(ageD.toFixed(3)),
        DEAD: s.DEAD ?? null, "ALIVE-ALERT": s["ALIVE-ALERT"] ?? null,
        UNKNOWN: s.UNKNOWN ?? null, "UNKNOWN-NOT-CHAIN-TESTABLE": s["UNKNOWN-NOT-CHAIN-TESTABLE"] ?? null,
      },
      note: cls.note,
    };
  } catch (e) {
    return {
      id: "V-KEYPROOF-FRESH",
      verdict: "RED",
      measuredAt,
      evidence: { file: "proof/out/KEY-PROOF-LATEST.json", error: String((e && e.code) || e).slice(0, 80) },
      note: "לא ניתן לקרוא את ארטיפקט ההוכחה — לא מנחשים ירוק",
    };
  }
}

/* ══════════════════ V-RESEARCH-FRESH ══════════════════ */
export function latestFindingsFile(researchDir) {
  const files = (fs.existsSync(researchDir) ? fs.readdirSync(researchDir) : [])
    .filter((f) => /^findings-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? files[files.length - 1] : null;
}

export function checkResearch({ sandboxRoot, nowMs, readFile }) {
  const measuredAt = isoNow();
  const dir = path.join(sandboxRoot, "research");
  const name = latestFindingsFile(dir);
  if (!name) {
    return {
      id: "V-RESEARCH-FRESH", verdict: "RED", measuredAt,
      evidence: { dir: "research/", pattern: "findings-YYYY-MM-DD.json" },
      note: "אין קובץ-ממצאים כלל — מסילת-המחקר לא ידועה כחיה",
    };
  }
  try {
    const doc = JSON.parse(readFile(path.join(dir, name)));
    const stamp = doc.at || doc.generatedAt || null;
    const ageD = stamp ? ageDays(stamp, nowMs) : null;
    const cls = classifyFreshness({
      exists: true, ageD, incident: false,
      greenMax: LAWS.RESEARCH_GREEN_MAX_DAYS, amberMax: LAWS.RESEARCH_AMBER_MAX_DAYS,
    });
    return {
      id: "V-RESEARCH-FRESH", verdict: cls.verdict, measuredAt,
      evidence: {
        file: `research/${name}`, at: stamp, ageDays: ageD == null ? null : Number(ageD.toFixed(3)),
        experiments: Array.isArray(doc.experiments) ? doc.experiments.length : null,
        allConclusive: doc.allConclusive ?? null,
      },
      note: cls.note,
    };
  } catch (e) {
    return {
      id: "V-RESEARCH-FRESH", verdict: "RED", measuredAt,
      evidence: { file: `research/${name}`, error: String((e && e.code) || e).slice(0, 80) },
      note: "קובץ-ממצאים לא-קריא — לא מנחשים ירוק",
    };
  }
}

/* ══════════════════ V-FLEETHQ-FRESH (byte-oracle, על בסיס שיטת zai-13) ══════════════════ */
export async function checkBytesPair({ page, committed, source, fetcher, refetchDelayMs = 0 }) {
  const live = await fetcher(page);
  const committedRes = await fetcher(committed);
  if (live.status !== 200 || live.error) {
    return { page, source, liveSha16: null, committedSha16: null, verdict: "UNKNOWN",
      note: `live לא-נמדד: http ${live.status}${live.error ? ` (${live.error})` : ""}` };
  }
  if (committedRes.status !== 200 || committedRes.error) {
    return { page, source, liveSha16: sha16(Buffer.from(live.body, "utf8")), committedSha16: null, verdict: "UNKNOWN",
      note: `committed לא-נמדד: http ${committedRes.status}${committedRes.error ? ` (${committedRes.error})` : ""}` };
  }
  const liveSha = sha16(Buffer.from(live.body, "utf8"));
  const committedSha = sha16(Buffer.from(committedRes.body, "utf8"));
  if (liveSha === committedSha) {
    return { page, source, liveSha16: liveSha, committedSha16: committedSha, verdict: "MATCH",
      note: `שוויון-בתים (${live.body.length} bytes)` };
  }
  /* double-measure: MISMATCH עלול להיות מירוץ-deploy חי — מודדים שוב לפני פסק אדום. */
  if (refetchDelayMs > 0) await new Promise((r) => setTimeout(r, refetchDelayMs));
  const live2 = await fetcher(page);
  const committed2 = await fetcher(committed);
  const live2Sha = live2.status === 200 ? sha16(Buffer.from(live2.body, "utf8")) : null;
  const committed2Sha = committed2.status === 200 ? sha16(Buffer.from(committed2.body, "utf8")) : null;
  const still = !!(live2Sha && committed2Sha && live2Sha !== committed2Sha);
  const bothUnknown = !live2Sha && !committed2Sha;
  return {
    page, source,
    liveSha16: live2Sha || liveSha, committedSha16: committed2Sha || committedSha,
    verdict: still || bothUnknown ? "MISMATCH" : "UNKNOWN",
    note: still
      ? `סטיית-בתים מוכחת גם-במדידה-כפולה: live ${liveSha}→${live2Sha} · committed ${committedSha}→${committed2Sha}`
      : `מדידה-כפולה לא-חד-משמעית (deploy חי במירוץ?) — ${liveSha} מול ${committedSha}; כנות: UNKNOWN`,
  };
}

export async function checkFleethq({ fetcher }) {
  const measuredAt = isoNow();
  const files = [];
  for (const c of BYTE_CHECKS) {
    files.push(await checkBytesPair({ ...c, fetcher }));
  }
  const match = files.filter((f) => f.verdict === "MATCH").length;
  const mismatch = files.filter((f) => f.verdict === "MISMATCH").length;
  const unknown = files.filter((f) => f.verdict === "UNKNOWN").length;
  const verdict = mismatch > 0 ? "RED" : unknown > 0 ? "UNKNOWN" : "GREEN";
  return {
    id: "V-FLEETHQ-FRESH", verdict, measuredAt,
    evidence: { files, checked: files.length, match, drift: mismatch, unknown },
    note:
      mismatch > 0 ? `🔴 סטיית-בתים חיה: ${match}/${files.length} MATCH, ${mismatch} MISMATCH`
      : unknown > 0 ? `לא-כל-הבדיקות נמדדו (${match}/${files.length} MATCH, ${unknown} UNKNOWN) — לא מנחשים ירוק`
      : `🟢 שוויון-בתים מלא: ${match}/${files.length} MATCH — הדף החי הוא הבתים שנדחפו`,
  };
}

/* ══════════════════ V-DOMAIN-LIVE ══════════════════ */
export async function checkDomainLive({ fetcher }) {
  const measuredAt = isoNow();
  const res = await fetcher(DOMAIN_URL);
  if (res.status !== 200 || res.error) {
    return {
      id: "V-DOMAIN-LIVE", verdict: "UNKNOWN", measuredAt,
      evidence: { url: DOMAIN_URL, http: res.status, error: res.error || null },
      note: `Pages לא-נמדד: http ${res.status}${res.error ? ` (${res.error})` : ""} — כשל-רשת שלנו, לא פסק על העולם`,
    };
  }
  const titleM = String(res.body).match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleM ? titleM[1].trim() : null;
  const titleOk = !!title && title.includes(LAWS.TITLE_MUST_CONTAIN);
  const panelOk = String(res.body).includes(LAWS.RESEARCH_PANEL_ID);
  const ok = titleOk && panelOk;
  return {
    id: "V-DOMAIN-LIVE", verdict: ok ? "GREEN" : "RED", measuredAt,
    evidence: { url: DOMAIN_URL, http: res.status, title, titleOk, researchPanelPresent: panelOk },
    note: ok ? `🟢 חי: 200 + title מכיל "${LAWS.TITLE_MUST_CONTAIN}" + פאנל #p-research קיים`
      : `🔴 סמנים-חסרים: titleOk=${titleOk} · #p-research=${panelOk} — הדף שונה ממה שהצי מפרסם`,
  };
}

/* ══════════════════ V-BUS-HEALTH — פורט קריאה-בלבד של Zip/sovereign/bus-validate.mjs ══════════════════ */
export function resolveUrls(feed, nowMs) {
  const tpl = String(feed.url || "");
  const res = feed.resolve;
  if (!res || !tpl.includes(res.placeholder)) return [tpl];
  return (res.offsetsDays || [0]).map((off) => {
    const d = new Date(nowMs - off * 86400e3);
    const p = (x) => (x < 10 ? "0" : "") + x;
    const iso = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    return tpl.split(res.placeholder).join(iso);
  });
}

export function shapeCheck(doc, feed) {
  const fields = feed.shape || [];
  for (const f of fields) {
    if (f.includes("|")) {
      if (!f.split("|").some((k) => doc && doc[k] !== undefined)) return f;
    } else if (!doc || doc[f] === undefined) return f;
  }
  if (feed.schema && doc && typeof doc.schema === "string" && doc.schema !== feed.schema) {
    return `schema=${doc.schema} (ציפינו ${feed.schema})`;
  }
  return null;
}

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
export function extractTs(doc, body, feed) {
  const f = String(feed.freshnessField || "");
  if (doc) {
    for (const k of f.split("|").map((s) => s.trim())) {
      if (doc[k]) { const d = new Date(doc[k]); if (!isNaN(d)) return d; }
    }
    for (const k of ["publishedAt", "generatedAt", "updatedAt", "at", "savedAt", "checkedAt"]) {
      if (doc[k]) { const d = new Date(doc[k]); if (!isNaN(d)) return d; }
    }
  }
  const m = String(body).match(ISO_RE);
  if (m && m.length) { const d = new Date(m[m.length - 1]); if (!isNaN(d)) return d; }
  return null;
}

/** פורט-שיטה של validateRegistry (Zip@11-c) — אותן-סמנטיקות, קוד-עצמאי, קריאה-בלבד. */
export async function validateBusRegistry(reg, { fetcher, token = "", nowMs = Date.now() } = {}) {
  const rows = [];
  for (const feed of reg.feeds || []) {
    const row = { id: feed.id, tier: feed.tier || "?", exposure: feed.exposure || "public",
      http: null, bytes: null, ageH: null, verdict: "GREY", note: "" };
    try {
      if (feed.exposure === "private-raw" && !token) {
        row.note = "private-raw · אין token — דילוג כנה (GREY)"; rows.push(row); continue;
      }
      let res = null, lastErr = null;
      for (const u of resolveUrls(feed, nowMs)) {
        try {
          const headers = feed.exposure === "private-raw" && token ? { authorization: `token ${token}` } : {};
          res = await fetcher(u, { headers });
          if (res && res.status === 200) break;
          lastErr = res ? `http ${res.status}` : "no response";
        } catch (e) { lastErr = String((e && e.message) || e).slice(0, 60); }
      }
      if (!res || res.status !== 200 || res.error) {
        row.verdict = "RED";
        row.note = `בלתי-נגיש (${lastErr || (res && res.error) || "no attempt"})`;
        rows.push(row); continue;
      }
      row.http = res.status; row.bytes = res.body.length;
      const isJsonFeed = !/markdown|text\//i.test(String(feed.schema || ""));
      let doc = null;
      if (isJsonFeed) {
        try { doc = JSON.parse(res.body); }
        catch { row.verdict = "RED"; row.note = "גוף לא-JSON"; rows.push(row); continue; }
      }
      const shapeMiss = isJsonFeed ? shapeCheck(doc, feed) : null;
      const at = extractTs(doc, res.body, feed);
      if (at != null) row.ageH = Math.max(0, (nowMs - at.getTime()) / 3600e3);
      const warnH = Number(feed.stalenessWarningHours || LAWS.BUS_STALENESS_DEFAULT_H);
      if (shapeMiss) { row.verdict = "AMBER"; row.note = `סטיית-מבנה: חסר ${shapeMiss}`; }
      else if (row.ageH == null) { row.verdict = "AMBER"; row.note = "אין חותמת-זמן מזוהה"; }
      else if (row.ageH > warnH) { row.verdict = "AMBER"; row.note = `ישן: ${row.ageH.toFixed(1)}h > ${warnH}h (כנה, לא מושתק)`; }
      else { row.verdict = "GREEN"; row.note = "חי וטרי"; }
    } catch (e) {
      row.verdict = "RED"; row.note = `חריגה: ${String((e && e.message) || e).slice(0, 60)}`;
    }
    rows.push(row);
  }
  const counts = { GREEN: 0, AMBER: 0, RED: 0, GREY: 0 };
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const total = rows.length;
  const measured = counts.GREEN + counts.AMBER;
  const measuredRatio = total ? measured / total : 0;
  let verdict;
  if (total === 0) verdict = "UNKNOWN";
  else if (counts.RED > 0) verdict = "RED";
  else if (measuredRatio >= LAWS.BUS_MEASURED_FLOOR) verdict = "GREEN";
  else verdict = "AMBER"; /* אין אדום אבל יותר-מדי הזנות לא-נמדדו — כנות-חשיפה חלקית */
  return { rows, counts, total, measured, measuredRatio, verdict, at: new Date(nowMs).toISOString() };
}

/** טעינת מרשם-ה-באס: clone שכן → raw פרטי-עם-token → כנות-UNKNOWN. אף token לא נכתב/מודפס. */
export async function loadBusRegistry({ sandboxRoot, fetcher }) {
  const candidates = [];
  const envPath = process.env.BUS_REGISTRY_PATH;
  if (envPath) candidates.push({ kind: "env-path", file: envPath });
  candidates.push({ kind: "zip-clone", file: path.join(sandboxRoot, "..", "Zip", "sovereign", "bus-registry.json") });
  for (const c of candidates) {
    try {
      const raw = fs.readFileSync(c.file, "utf8");
      return { reg: JSON.parse(raw), source: c.kind, file: "sovereign/bus-registry.json" };
    } catch { /* next */ }
  }
  const token = process.env.BUS_TOKEN || process.env.GH_TOKEN || "";
  const headers = token ? { authorization: `token ${token}` } : {};
  const res = await fetcher(ZIP_REGISTRY_RAW, { headers });
  if (res.status === 200 && !res.error) {
    try { return { reg: JSON.parse(res.body), source: token ? "private-raw(token)" : "private-raw(anonymous-ok)", file: "Zip@main:sovereign/bus-registry.json" }; }
    catch { /* fallthrough */ }
  }
  return null;
}

export async function checkBus({ sandboxRoot, fetcher, nowMs = Date.now() }) {
  const measuredAt = isoNow();
  const loaded = await loadBusRegistry({ sandboxRoot, fetcher });
  if (!loaded) {
    return {
      id: "V-BUS-HEALTH", verdict: "UNKNOWN", measuredAt,
      evidence: { registry: "Zip:sovereign/bus-registry.json", reachable: false },
      note: "private registry — validator runs in-lane: אין clone שכן ואין token-קריאה זמין (raw 404 אנונימי) — לא מנחשים",
    };
  }
  const token = process.env.BUS_TOKEN || process.env.GH_TOKEN || "";
  const out = await validateBusRegistry(loaded.reg, { fetcher, token, nowMs });
  const note =
    out.verdict === "GREEN" ? `🟢 זרימה חיה: ${out.measured}/${out.total} הזנות נמדדו (≥80%), 0 RED (${out.counts.GREEN} ירוק / ${out.counts.AMBER} כתום-כנה / ${out.counts.GREY} אפור-פרטי)`
    : out.verdict === "AMBER" ? `חשיפה חלקית: ${out.measured}/${out.total} נמדדו (<80%) — ${out.counts.GREY} לא-ניתנות-למדידה ללא token`
    : out.verdict === "RED" ? `🔴 מפיק-ציבורי מת: ${out.counts.RED} RED — הזרימה שבורה בגלוי`
    : "אין הזנות ברישם — לא ניתן למדוד";
  return {
    id: "V-BUS-HEALTH", verdict: out.verdict, measuredAt,
    evidence: {
      registrySource: loaded.source, registryGeneratedAt: loaded.reg.generatedAt || null,
      feedCount: out.total, measured: out.measured, measuredRatio: Number(out.measuredRatio.toFixed(3)),
      counts: out.counts, rows: out.rows,
    },
    note,
  };
}

/* ══════════════════ V-FLEET-HEARTBEAT — liveness+heal (zai-14c · trace 1a12d502a99b7021) ══════════════════
 * COORDINATION.md [zai-14] lane 14-c: מניפסט-מפיקי-העורקים של הצי (workflows שמפרסמים/משקפים ספרים).
 * כל-(repo, workflow) אומת פעמיים לפני-כניסה למניפסט: (1) קו-cron נקרא מה-clone המקומי,
 * (2) probe API אחד — שניהם 2026-10-12; maxAgeH אומת מול ה-cron המוצהר (ראו הערות-שורה).
 * סיווג-בטיחות ל-heal: דווח/מראה בלבד (dex-mirror/dex-beat/office-feed/digest = מראות;
 * value-scan/verifier/fleet-heal = קוראי-Sandbox). לא-בטוח ב-100% בסיווג → healable:false
 * (console-trigger-mesh — הוא עצמו מנוע-הטריגרים: שליחה-אליו עלולה להקפיץ את מה שהוא מצית). */
export const ARTERIES = [
  { id: "domain-dex-mirror", repo: "Domain", workflow: "dex-mirror.yml", maxAgeH: 30, healable: true },      // cron daily 12:50 UTC → 30h = 24h+6h חסד
  { id: "domain-dex-beat", repo: "Domain", workflow: "dex-beat.yml", maxAgeH: 9, healable: true },           // cron כל-4h (12 */4) → 9h ≈ שני-מחזורים+1h
  { id: "domain-office-feed", repo: "Domain", workflow: "office-feed.yml", maxAgeH: 30, healable: true },    // cron daily 03:41 UTC → 30h
  { id: "fleethq-digest", repo: "FleetHQ", workflow: "office-window.yml", maxAgeH: 30, healable: true },     // cron daily 06:17 UTC → 30h
  { id: "sandbox-value-scan", repo: "Sandbox", workflow: "value-scan.yml", maxAgeH: 2, healable: true },     // cron כל-30דק' (17,47) → 2h = 4 מחזורים
  { id: "sandbox-verifier", repo: "Sandbox", workflow: "verifier.yml", maxAgeH: 2, healable: true },         // cron 4×/שעה (7,37+23,53) → 2h
  { id: "sandbox-fleet-heal", repo: "Sandbox", workflow: "fleet-heal.yml", maxAgeH: 2, healable: true },     // cron כל-30דק' (5,35) → 2h
  { id: "console-trigger-mesh", repo: "Console", workflow: "trigger-mesh.yml", maxAgeH: 3, healable: false }, // cron כל-3h (44 */3) → 3h = מחזור-אחד (קפדן-בכוונה); report-only — לעולם לא נשלח
];

export function heartbeatRunsUrl(repo, workflow) {
  return `https://api.github.com/repos/roshpinacare-sys/${repo}/actions/workflows/${workflow}/runs?per_page=1&status=success`;
}

function ghApiHeaders(token) {
  const h = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) h.authorization = `token ${token}`; // מעולם לא נכתב/מודפס/נכנס ל-URL
  return h;
}

/** סיווג-חיות טהור — וקטורי-גבולות נבדקים ב-selftest. כשל-API = UNKNOWN כנה (R5). */
export function classifyHeartbeat({ ageH, maxAgeH, apiError = null, noSuccessEver = false }) {
  if (apiError) return { verdict: "UNKNOWN", note: `API לא-נמדד: ${apiError} — כשל-רשת שלנו, לא פסק על המפיק` };
  if (ageH == null) {
    return noSuccessEver
      ? { verdict: "RED", note: "אין אף ריצה-מוצלחת בהיסטוריה — העורק לא ידוע כחי אף-פעם" }
      : { verdict: "UNKNOWN", note: "ריצה-אחרונה בלי חותמת-זמן קריאה — לא מנחשים" };
  }
  if (ageH <= maxAgeH) return { verdict: "GREEN", note: `ריצה-מוצלחת לפני ${ageH.toFixed(1)}h ≤ ${maxAgeH}h` };
  if (ageH <= maxAgeH * LAWS.HEARTBEAT_RED_FACTOR) {
    return { verdict: "AMBER", note: `מיושן: ${ageH.toFixed(1)}h > ${maxAgeH}h (≤${maxAgeH * LAWS.HEARTBEAT_RED_FACTOR}h) — מחזור-הפקה הוחמץ` };
  }
  return { verdict: "RED", note: `ישן מדי: ${ageH.toFixed(1)}h > ${maxAgeH * LAWS.HEARTBEAT_RED_FACTOR}h — לפחות-שני-מחזורים הוחמצו` };
}

/** החלטת-ריפוי טהורה: stale(AMBER/RED) + healable → dispatch · GREEN/UNKNOWN/non-healable → לעולם לא. */
export function healDecision(artery, verdict) {
  if (verdict === "GREEN") return { dispatch: false, reason: "טרי — אין מה לרפא" };
  if (verdict === "UNKNOWN") return { dispatch: false, reason: "לא-נמדד — אין בסיס לשלוח ריפוי" };
  if (!artery.healable) return { dispatch: false, reason: "non-healable — דווח-בלבד (לעולם לא נשלח)" };
  return { dispatch: true, reason: `stale(${verdict}) + healable → dispatch` };
}

/** שולח-workflow (POST dispatches {"ref":"main"}) — ניסיון אחד + ריטרי-אחד על-כשל-חולף בלבד. */
export async function dispatchWorkflow({ repo, workflow, token, poster, retries = LAWS.HEARTBEAT_DISPATCH_RETRIES }) {
  const url = `https://api.github.com/repos/roshpinacare-sys/${repo}/actions/workflows/${workflow}/dispatches`;
  const attempts = [];
  for (let i = 0; i <= retries; i++) {
    const res = await poster(url, { ref: "main" }, token);
    attempts.push(res.status);
    if (res.status === 204) return { dispatched: true, attempts, ok: true }; // 204 = queued
    if (res.status === 0 || res.status === 429 || res.status >= 500) continue; // חולף → ריטרי-אחד
    break; // 4xx אחר (403/404…) — לא-חולף, כנות בלי-ניחושים
  }
  return { dispatched: false, attempts, ok: false };
}

/** מנוע-POST נתין (injectable): 204/סטטוס בלבד — אף token לא נכתב/מודפס. */
export function defaultPoster(url, bodyObj, token) {
  return fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: {
      "user-agent": "roshpinacare-fresh-oracle/1 (heartbeat heal; report/mirror-class only)",
      ...ghApiHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify(bodyObj),
    signal: AbortSignal.timeout(LAWS.FETCH_TIMEOUT_MS),
  })
    .then((res) => ({ status: res.status }))
    .catch((e) => ({ status: 0, error: String((e && e.message) || e).slice(0, 120) }));
}

/** הבדיקה-השישית: מדוד את כל-העורקים (עכשיו), ואם heal=true — שלח ריפוי למיושנים-הניתנים-לריפוי. */
export async function checkFleetHeartbeat({
  fetcher = defaultFetcher, poster = defaultPoster, nowMs = Date.now(),
  token = process.env.BUS_TOKEN || process.env.GH_TOKEN || "", heal = false,
} = {}) {
  const measuredAt = isoNow();
  const arteries = [];
  const dispatchLog = [];
  for (const a of ARTERIES) {
    let ageH = null, lastSuccessAt = null, lastRunId = null, apiError = null, noSuccessEver = false;
    let res = null;
    try { res = await fetcher(heartbeatRunsUrl(a.repo, a.workflow), { headers: ghApiHeaders(token) }); }
    catch (e) { res = { status: 0, error: String((e && e.message) || e).slice(0, 120) }; }
    if (!res || res.status !== 200 || res.error) {
      apiError = `http ${res ? res.status : "no-response"}${res && res.error ? ` (${res.error})` : ""}`;
    } else {
      try {
        const doc = JSON.parse(res.body);
        const run = Array.isArray(doc.workflow_runs) ? doc.workflow_runs[0] : null;
        if (!run) noSuccessEver = true;
        else {
          const t = run.run_started_at || run.created_at || run.updated_at || null;
          lastRunId = run.id ?? null;
          if (t && Number.isFinite(Date.parse(t))) {
            lastSuccessAt = t;
            ageH = Math.max(0, (nowMs - Date.parse(t)) / 3600e3);
          } else apiError = "הריצה-האחרונה בלי חותמת-זמן קריאה";
        }
      } catch { apiError = "JSON תקול מה-API"; }
    }
    const cls = classifyHeartbeat({ ageH, maxAgeH: a.maxAgeH, apiError, noSuccessEver });
    const decision = healDecision(a, cls.verdict);
    let dispatch = { dispatched: false, reason: heal ? decision.reason : "--heal לא הופעל בריצה זו (כלי-ידני)" };
    if (heal && decision.dispatch) {
      const d = await dispatchWorkflow({ repo: a.repo, workflow: a.workflow, token, poster });
      dispatch = { dispatched: d.dispatched, attempts: d.attempts, reason: decision.reason };
      dispatchLog.push({ id: a.id, repo: a.repo, workflow: a.workflow, verdict: cls.verdict, dispatched: d.dispatched, attempts: d.attempts });
    }
    arteries.push({
      id: a.id, repo: a.repo, workflow: a.workflow, maxAgeH: a.maxAgeH, healable: a.healable,
      verdict: cls.verdict, ageH: ageH == null ? null : Number(ageH.toFixed(2)),
      lastSuccessAt, lastRunId, dispatch, note: cls.note,
    });
  }
  const counts = { GREEN: 0, AMBER: 0, RED: 0, UNKNOWN: 0 };
  for (const r of arteries) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const verdict = counts.RED > 0 ? "RED" : counts.UNKNOWN > 0 ? "UNKNOWN" : counts.AMBER > 0 ? "AMBER" : "GREEN";
  const dispatchedN = dispatchLog.filter((d) => d.dispatched).length;
  const note =
    verdict === "RED" ? `🔴 עורק(ים) מתים/מוזנחים: ${counts.RED}/${arteries.length} RED — המפיקים שלהם דורשים-עין${heal ? ` · heal: ${dispatchedN}/${dispatchLog.length} dispatch נשלחו` : ""}`
    : verdict === "UNKNOWN" ? `לא-כל-העורקים נמדדו (${counts.UNKNOWN} UNKNOWN) — לא מנחשים ירוק`
    : verdict === "AMBER" ? `עורקים מיושנים: ${counts.AMBER}/${arteries.length} AMBER — חיים-אבל-מפספסים-מחזורים${heal ? ` · heal: ${dispatchedN}/${dispatchLog.length} dispatch נשלחו` : ""}`
    : `🟢 כל-העורקים חיים: ${arteries.length}/${arteries.length} GREEN בתוך maxAgeH`;
  return {
    id: "V-FLEET-HEARTBEAT", verdict, measuredAt,
    evidence: { arteries, counts, dispatchLog, healMode: !!heal },
    note,
  };
}

/* ══════════════════ פנקס-מאוחד (union receipt) — append-bounded ══════════════════ */
export function summarize(checks) {
  const summary = { GREEN: 0, AMBER: 0, RED: 0, UNKNOWN: 0 };
  for (const c of checks) summary[c.verdict] = (summary[c.verdict] || 0) + 1;
  return summary;
}

export function unionAppend(existing, run, { cap = LAWS.RUNS_CAP, prior = undefined } = {}) {
  const doc = existing && typeof existing === "object" ? { ...existing } : {};
  doc.schema = doc.schema || "sandbox/fresh-oracle-latest/1";
  doc.gate = doc.gate || "fresh-oracle (zai-12b) — standing verification gate; joins zai-13's V-FLEETHQ-FRESH OWNER-WORD";
  doc.law = doc.law ||
    "no green without independent measurement: live bytes == committed bytes (sha256-16hex), artifacts ≤ age-law, bus ≥80% measured & 0 RED; network failure = UNKNOWN + reason, never guessed green";
  /* prior של zai-13 — נשמר מילה-במילה מהכתיבה-הראשונה והלאה; לעולם לא נדרס. */
  if (doc.prior === undefined) {
    doc.prior = prior !== undefined ? prior : null;
  }
  const runs = Array.isArray(doc.runs) ? doc.runs.slice() : [];
  runs.push(run);
  doc.runs = runs.slice(-cap); /* append-bounded: 12 אחרונות */
  doc.updatedAt = run.at;
  doc.summary = { ...run.summary }; /* מצב-עדכני = הריצה-האחרונה */
  return doc;
}

/* ══════════════════ סריקת-סודות (auditor לפני-כתיבה — הפרה = אבוט) ══════════════════ */
export function scanSecrets(text) {
  const findings = [];
  const push = (kind, idx) => findings.push({ kind, index: idx });
  /* WIF: לא-דחוס = 51 תווי-base58 המתחילים ב-5 (5H/5J/...) · דחוס = 52 המתחילים K/L */
  const wif = /\b5[1-9A-HJ-NP-Za-km-z]{50}\b|\b[KL][1-9A-HJ-NP-Za-km-z]{51}\b/g;
  let m;
  while ((m = wif.exec(text))) { push("WIF-like-51char-base58", m.index); }
  /* טוקני-GitHub */
  const gh = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g;
  while ((m = gh.exec(text))) { push("github-token-pattern", m.index); }
  /* שדות-חומר-מפתות ב-JSON */
  const fields = /"(?:steem_?wif|active_?wif|posting_?wif|owner_?wif|memo_?wif|private_?key|password|secret_?key)"\s*:/gi;
  while ((m = fields.exec(text))) { push("secret-field-name", m.index); }
  return findings;
}

/* ══════════════════ verdict.md (עברית, מתחדש כל-ריצה) ══════════════════ */
export function renderVerdictMd(run) {
  const badge = { GREEN: "🟢", AMBER: "🟠", RED: "🔴", UNKNOWN: "⚪" };
  const short = (v) => String(v ?? "—").slice(0, 90).replace(/\|/g, "/");
  const rows = run.checks.map((c) => {
    let ev = "";
    if (c.id === "V-FLEETHQ-FRESH") ev = `${c.evidence.match}/${c.evidence.checked} MATCH` + (c.evidence.drift ? ` · ${c.evidence.drift} drift` : "");
    else if (c.id === "V-KEYPROOF-FRESH") ev = c.evidence.generatedAt ? `generatedAt ${String(c.evidence.generatedAt).slice(0, 10)} · ${c.evidence.ageDays}d` : "ארטיפקט חסר";
    else if (c.id === "V-RESEARCH-FRESH") ev = c.evidence.file ? `${c.evidence.file} · ${c.evidence.ageDays ?? "—"}d` : "אין קובץ";
    else if (c.id === "V-BUS-HEALTH") ev = c.evidence.feedCount != null ? `${c.evidence.measured}/${c.evidence.feedCount} הזנות · ${c.evidence.counts.GREEN}G/${c.evidence.counts.AMBER}A/${c.evidence.counts.RED}R/${c.evidence.counts.GREY}Gr` : "אין גישה לרישם";
    else if (c.id === "V-DOMAIN-LIVE") ev = c.evidence.http ? `http ${c.evidence.http} · title=${c.evidence.titleOk} · #p-research=${c.evidence.researchPanelPresent}` : "לא נמדד";
    else if (c.id === "V-FLEET-HEARTBEAT") {
      const k = c.evidence.counts || {};
      const dl = c.evidence.dispatchLog || [];
      ev = `${k.GREEN ?? 0}G/${k.AMBER ?? 0}A/${k.RED ?? 0}R/${k.UNKNOWN ?? 0}U מתוך ${c.evidence.arteries ? c.evidence.arteries.length : "?"} עורקים` + (dl.length ? ` · heal: ${dl.filter((d) => d.dispatched).length}/${dl.length} dispatched` : "");
    }
    return `| ${badge[c.verdict] || "—"} ${c.id} | ${c.verdict} | ${short(ev)} | ${short(c.note)} |`;
  });
  return [
    "# fresh-oracle — פסק-עדכני (שער-אימות-עומד)",
    "",
    `> נמדד: ${run.at} · מפעיל: ${run.trigger} · סיכום: ${run.summary.GREEN} ירוק · ${run.summary.AMBER} כתום · ${run.summary.RED} אדום · ${run.summary.UNKNOWN} לא-ידוע`,
    "",
    "| בדיקה | פסק | ראיות | הערה |",
    "|---|---|---|---|",
    ...rows,
    "",
    "**חוק:** אין ירוק בלי מדידה-עצמאית (R1) · כשל-רשת = UNKNOWN + סיבה, לעולם לא ירוק-מנוחש (R5).",
    "",
    `מצטרף ל-OWNER-WORD של zai-13 (V-FLEETHQ-FRESH 4/4 MATCH, receipts/fresh-oracle-2026-10-11.json) — ההקבלה לשער-מתוזמן. הקבלה, לא החלפה.`,
    "",
    `_הקובץ נוצר אוטומטית — אל תערכו ידנית; הריצה-הבאה מחליפה אותו._`,
    "",
  ].join("\n");
}

/* ══════════════════ ריצה-מלאה ══════════════════ */
export async function runAll({ nowMs = Date.now(), fetcher = defaultFetcher, trigger = "local", sandboxRoot, heal = false, poster = defaultPoster }) {
  const checks = [];
  checks.push(await checkFleethq({ fetcher }));
  checks.push(checkKeyproof({ sandboxRoot, nowMs, readFile: (f) => fs.readFileSync(f, "utf8") }));
  checks.push(checkResearch({ sandboxRoot, nowMs, readFile: (f) => fs.readFileSync(f, "utf8") }));
  checks.push(await checkBus({ sandboxRoot, fetcher, nowMs }));
  checks.push(await checkDomainLive({ fetcher }));
  checks.push(await checkFleetHeartbeat({ fetcher, poster, nowMs, heal })); // zai-14c — הבדיקה-השישית
  return {
    at: new Date(nowMs).toISOString(),
    trigger,
    checks,
    summary: summarize(checks),
  };
}

/* ══════════════════ selftest — 12 וקטורים, אפס-רשת ══════════════════ */
export async function selftest() {
  const vectors = [];
  const vec = (name, pass, detail = "") => vectors.push({ name, pass: !!pass, detail: String(detail).slice(0, 140) });

  /* ── 1..3: גבולות-גיל key-proof (8d) ── */
  const kpBase = { greenMax: 8, amberMax: 15, incident: false };
  let c = classifyFreshness({ ...kpBase, exists: true, ageD: 8.0 });
  vec("keyproof age == 8d → GREEN", c.verdict === "GREEN", c.note);
  c = classifyFreshness({ ...kpBase, exists: true, ageD: 8.0 + 1 / 24 });
  vec("keyproof age 8d+1h → AMBER", c.verdict === "AMBER", c.note);
  c = classifyFreshness({ ...kpBase, exists: false, ageD: null });
  vec("keyproof missing artifact → RED", c.verdict === "RED", c.note);

  /* ── 4..6: גבולות-גיל research (9d) ── */
  const rsBase = { greenMax: 9, amberMax: 16, incident: false };
  c = classifyFreshness({ ...rsBase, exists: true, ageD: 9.0 });
  vec("research age == 9d → GREEN", c.verdict === "GREEN", c.note);
  c = classifyFreshness({ ...rsBase, exists: true, ageD: 9.0 + 1 / 24 });
  vec("research age 9d+1h → AMBER", c.verdict === "AMBER", c.note);
  c = classifyFreshness({ ...rsBase, exists: false, ageD: null });
  vec("research missing → RED", c.verdict === "RED", c.note);

  /* ── 7..8: פנקס-מאוחד — append-bounded 12 + prior נשמר מילה-במילה ── */
  const prior = { schema: "sandbox/fresh-oracle/1", at: "2026-10-11T21:40:00Z", mandate: "zai-13", results: [{ page: "x", verdict: "MATCH" }] };
  const mkRun = (i) => ({ at: `2026-10-11T00:${String(i % 60).padStart(2, "0")}:00Z`, trigger: "test",
    checks: [{ id: "V-TEST", verdict: i % 2 ? "GREEN" : "AMBER", measuredAt: "x", evidence: { i }, note: "v" }],
    summary: summarize([{ verdict: i % 2 ? "GREEN" : "AMBER" }]) });
  let doc = null;
  for (let i = 0; i < 15; i++) doc = unionAppend(doc, mkRun(i), { prior });
  vec("union: 15 runs → cap 12 (oldest dropped)",
    doc.runs.length === 12 && doc.runs[0].at === "2026-10-11T00:03:00Z" && doc.runs[11].at === "2026-10-11T00:14:00Z",
    `len=${doc.runs.length} first=${doc.runs[0].at}`);
  vec("union: prior verbatim + summary mirrors latest run",
    JSON.stringify(doc.prior) === JSON.stringify(prior) && doc.summary.GREEN === doc.runs[11].summary.GREEN && doc.updatedAt === doc.runs[11].at,
    `priorKept=${JSON.stringify(doc.prior) === JSON.stringify(prior)}`);

  /* ── 9: כשל-רשת → UNKNOWN + סיבה (מנוע-רשת מוזרק) ── */
  const safeFetcher = async () => ({ status: 0, error: "ECONNREFUSED-mock" });
  const pair = await checkBytesPair({ page: "https://x/", committed: "https://y/", source: "t", fetcher: safeFetcher });
  const dom = await checkDomainLive({ fetcher: safeFetcher });
  vec("fetch failure → UNKNOWN + reason recorded", pair.verdict === "UNKNOWN" && /ECONNREFUSED-mock/.test(pair.note) && dom.verdict === "UNKNOWN" && /לא-נמדד/.test(dom.note),
    `pair=${pair.verdict} dom=${dom.verdict} note="${pair.note.slice(0, 50)}"`);

  /* ── 10: סטיית-בתים → MISMATCH + שוויון → MATCH (מנוע-מוזרק; מדידה-כפולה לא מסתירה) ── */
  const diffFetcher = async (url) =>
    url.startsWith("https://live/") ? { status: 200, body: "<html>live-drift</html>" } : { status: 200, body: "<html>committed</html>" };
  const mis = await checkBytesPair({ page: "https://live/a", committed: "https://git/a", source: "t", fetcher: diffFetcher, refetchDelayMs: 1 });
  const mt = await checkBytesPair({ page: "https://live/a", committed: "https://git/a", source: "t", fetcher: async () => ({ status: 200, body: "<html>same</html>" }) });
  vec("sha mismatch → MISMATCH · byte equality → MATCH (16-hex)",
    mis.verdict === "MISMATCH" && mis.liveSha16 !== mis.committedSha16 && mis.liveSha16.length === 16 && mt.verdict === "MATCH" && mt.liveSha16 === mt.committedSha16,
    `${mis.liveSha16} vs ${mis.committedSha16} / match=${mt.liveSha16}`);

  /* ── 11: פורט-באס — סיווג GREEN/AMBER/RED/GREY על fixtures + מיפוי-פסק-רישם ── */
  const busNow = Date.parse("2026-10-11T20:00:00Z");
  const fixtures = {
    "https://b/fresh.json": { status: 200, body: JSON.stringify({ schema: "t/1", generatedAt: "2026-10-11T19:00:00Z" }) },
    "https://b/stale.json": { status: 200, body: JSON.stringify({ generatedAt: "2026-10-09T20:00:00Z" }) },
    "https://b/missing.json": { status: 404, body: "not found" },
    "https://b/private.json": { status: 404, body: "not found" },
  };
  const busFetcher = async (u) => fixtures[u] || { status: 404, body: "not found" };
  const reg = { feeds: [
    { id: "t-fresh", url: "https://b/fresh.json", schema: "t/1", shape: ["generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt" },
    { id: "t-stale", url: "https://b/stale.json", shape: ["generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt" },
    { id: "t-dead", url: "https://b/missing.json", shape: [], stalenessWarningHours: 24 },
    { id: "t-private", url: "https://b/private.json", exposure: "private-raw", shape: [], stalenessWarningHours: 24 },
  ] };
  const bus = await validateBusRegistry(reg, { fetcher: busFetcher, token: "", nowMs: busNow });
  const okRows = bus.rows.find((r) => r.id === "t-fresh").verdict === "GREEN"
    && bus.rows.find((r) => r.id === "t-stale").verdict === "AMBER"
    && bus.rows.find((r) => r.id === "t-dead").verdict === "RED"
    && bus.rows.find((r) => r.id === "t-private").verdict === "GREY";
  const allFresh = await validateBusRegistry({ feeds: [{ id: "f", url: "https://b/fresh.json", schema: "t/1", shape: ["generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt" }] }, { fetcher: busFetcher, token: "", nowMs: busNow });
  const greyHeavy = await validateBusRegistry({ feeds: [
    { id: "f", url: "https://b/fresh.json", schema: "t/1", shape: ["generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt" },
    { id: "p1", url: "https://b/private.json", exposure: "private-raw" }, { id: "p2", url: "https://b/private.json", exposure: "private-raw" }, { id: "p3", url: "https://b/private.json", exposure: "private-raw" },
  ] }, { fetcher: busFetcher, token: "", nowMs: busNow });
  vec("bus port rows G/A/R/GREY + registry mapping (fresh→GREEN · <80% measured→AMBER · dead→RED)",
    okRows && allFresh.verdict === "GREEN" && greyHeavy.verdict === "AMBER" && bus.verdict === "RED",
    `rows=${JSON.stringify(bus.counts)} allFresh=${allFresh.verdict} greyHeavy=${greyHeavy.verdict}`);

  /* ── 12: סריקת-סודות — תופסת חומר-מפתות, לא טועה על פלט-נקי ── */
  const fakeWif = "5H" + "p".repeat(49); /* 51 תווי-base58 מזויףים (תבנית-WIF לא-דחוס) */
  const poisoned = JSON.stringify({ a: fakeWif, t: "ghp_" + "A".repeat(36), d: { active_wif: "x" } });
  const found = scanSecrets(poisoned);
  const kinds = new Set(found.map((f) => f.kind));
  const clean = JSON.stringify({ id: "V-X", sha16: "9e0b065b9f6319b7", url: "https://roshpinacare-sys.github.io/FleetHQ/", note: "שוויון-בתים" });
  const cleanFound = scanSecrets(clean);
  vec("secret scan catches WIF/5H + github-token + secret-field; clean output passes (no false positive)",
    kinds.has("WIF-like-51char-base58") && kinds.has("github-token-pattern") && kinds.has("secret-field-name") && cleanFound.length === 0,
    `poisonedKinds=${[...kinds].join(",")} cleanFindings=${cleanFound.length}`);

  /* ── 13..18: V-FLEET-HEARTBEAT (zai-14c) — גבולות-גיל, החלטת-ריפוי, מנוע-שליחה מוזרק ── */
  c = classifyHeartbeat({ ageH: 2.9, maxAgeH: 3, apiError: null, noSuccessEver: false });
  vec("heartbeat age 2.9h ≤ max 3h → GREEN", c.verdict === "GREEN", c.note);
  c = classifyHeartbeat({ ageH: 3.5, maxAgeH: 3, apiError: null, noSuccessEver: false });
  vec("heartbeat age 3.5h > 3h (≤2×3h) → AMBER", c.verdict === "AMBER", c.note);
  c = classifyHeartbeat({ ageH: 7.0, maxAgeH: 3, apiError: null, noSuccessEver: false });
  vec("heartbeat age 7h > 2×3h → RED · API-fail → UNKNOWN כנה",
    c.verdict === "RED"
    && classifyHeartbeat({ ageH: null, maxAgeH: 2, apiError: "http 0 (ECONNREFUSED-mock)", noSuccessEver: false }).verdict === "UNKNOWN"
    && /ECONNREFUSED-mock/.test(classifyHeartbeat({ ageH: null, maxAgeH: 2, apiError: "http 0 (ECONNREFUSED-mock)", noSuccessEver: false }).note)
    && classifyHeartbeat({ ageH: null, maxAgeH: 2, apiError: null, noSuccessEver: true }).verdict === "RED",
    c.note);

  const hbA = { id: "t", repo: "R", workflow: "w.yml", maxAgeH: 2, healable: true };
  const hbN = { ...hbA, healable: false };
  const dG = healDecision(hbA, "GREEN"), dAm = healDecision(hbA, "AMBER"), dR = healDecision(hbA, "RED");
  const dU = healDecision(hbA, "UNKNOWN"), dN = healDecision(hbN, "AMBER");
  vec("heal decision: stale+healable(AMBER/RED) → dispatch · GREEN/UNKNOWN/non-healable → never",
    dAm.dispatch && dR.dispatch && !dG.dispatch && !dU.dispatch && !dN.dispatch && /לעולם לא נשלח/.test(dN.reason),
    JSON.stringify({ G: dG.dispatch, A: dAm.dispatch, R: dR.dispatch, U: dU.dispatch, N: dN.dispatch }));

  /* drill מלא על checkFleetHeartbeat עם fetcher+poster מוזרקים: רק stale+healable נשלח;
     non-healable stale לעולם לא; API-fail → UNKNOWN ולא-נשלח; ריטרי-אחד על-500. */
  const hbNow = Date.parse("2026-10-12T12:00:00Z");
  const isoAgo = (h) => new Date(hbNow - h * 3600e3).toISOString();
  const hbFixture = (h) => ({ status: 200, body: JSON.stringify({ total_count: 1, workflow_runs: [{ id: 42, run_started_at: isoAgo(h), created_at: isoAgo(h), conclusion: "success" }] }) });
  const hbFetcher = async (url) => {
    if (url.includes("/Domain/actions/workflows/dex-beat.yml/")) return hbFixture(20);      // RED (>18h) → dispatch + retry
    if (url.includes("/FleetHQ/actions/workflows/office-window.yml/")) return hbFixture(40); // AMBER (>30h) → dispatch
    if (url.includes("/Console/actions/workflows/trigger-mesh.yml/")) return hbFixture(5);  // AMBER אך non-healable → לעולם לא
    if (url.includes("/Domain/actions/workflows/dex-mirror.yml/")) return { status: 0, error: "ECONNREFUSED-mock" }; // UNKNOWN
    return hbFixture(0.5); // כל-השאר טריים
  };
  const posted = [];
  const hbPoster = async (url, body) => {
    posted.push({ url, body });
    if (url.includes("dex-beat.yml") && posted.filter((p) => p.url.includes("dex-beat.yml")).length === 1) return { status: 500 }; // חולף → ריטרי-אחד
    return { status: 204 };
  };
  const hb = await checkFleetHeartbeat({ fetcher: hbFetcher, poster: hbPoster, nowMs: hbNow, token: "", heal: true });
  const dispatchedIds = hb.evidence.dispatchLog.filter((d) => d.dispatched).map((d) => d.id);
  const beatLog = hb.evidence.dispatchLog.find((d) => d.id === "domain-dex-beat");
  const meshRow = hb.evidence.arteries.find((r) => r.id === "console-trigger-mesh");
  const mirrorRow = hb.evidence.arteries.find((r) => r.id === "domain-dex-mirror");
  vec("heartbeat executor: only stale+healable dispatched (correct URL+ref, retry 500→204); non-healable never posted; API-fail → UNKNOWN + no dispatch",
    hb.verdict === "RED"
    && JSON.stringify(dispatchedIds.sort()) === JSON.stringify(["domain-dex-beat", "fleethq-digest"])
    && beatLog.attempts.join(",") === "500,204"
    && posted.every((p) => /\/actions\/workflows\/[\w.-]+\.yml\/dispatches$/.test(p.url) && p.body && p.body.ref === "main")
    && !posted.some((p) => p.url.includes("trigger-mesh.yml"))
    && meshRow.verdict === "AMBER" && meshRow.dispatch.dispatched === false && /לעולם לא נשלח/.test(meshRow.dispatch.reason)
    && mirrorRow.verdict === "UNKNOWN" && mirrorRow.dispatch.dispatched === false
    && hb.evidence.arteries.find((r) => r.id === "sandbox-verifier").ageH === 0.5,
    `verdict=${hb.verdict} dispatched=[${dispatchedIds}] beatAttempts=${beatLog.attempts} posted=${posted.length} mesh=${meshRow.verdict}/${meshRow.dispatch.dispatched} mirror=${mirrorRow.verdict}`);

  /* ── דיווח ── */
  const passed = vectors.filter((v) => v.pass).length;
  console.log(`selftest: ${passed}/${vectors.length} vectors green`);
  for (const v of vectors) {
    console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name}${v.pass ? "" : `  → ${v.detail}`}`);
  }
  return { passed, total: vectors.length, ok: passed === vectors.length };
}

/* ══════════════════ main ══════════════════ */
function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function main() {
  if (process.argv.includes("--selftest")) {
    const r = await selftest();
    process.exit(r.ok ? 0 : 1);
  }

  const heal = process.argv.includes("--heal");
  const root = repoRoot();
  const trigger = process.env.GITHUB_EVENT_NAME || (heal ? "local-heal" : "local");
  const run = await runAll({ trigger, sandboxRoot: root, heal });

  /* קריאת-הפנקס-הקיים + prior של zai-13 (מילה-במילה, פעם-אחת, נשמר לנצח) */
  const latestPath = path.join(root, "receipts", "fresh-oracle-latest.json");
  const zai13Path = path.join(root, "receipts", "fresh-oracle-2026-10-11.json");
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(latestPath, "utf8")); } catch { /* first write */ }
  let prior;
  if (existing && existing.prior !== undefined) {
    prior = existing.prior;
  } else {
    try { prior = JSON.parse(fs.readFileSync(zai13Path, "utf8")); }
    catch { prior = null; console.error("honest note: zai-13's original receipt not found — prior=null"); }
  }

  const doc = unionAppend(existing, run, { prior });
  const out = JSON.stringify(doc, null, 2) + "\n";

  /* auditor לפני-כתיבה (R1): פלט עם חומר-מפתות = אבוט, כלום לא נכתב */
  const findings = scanSecrets(out);
  if (findings.length) {
    console.error("HARD FAIL: secret-pattern audit found " + findings.length + " finding(s) in the serialized receipt — refusing to write (kinds: " + [...new Set(findings.map((f) => f.kind))].join(", ") + ")");
    process.exit(3);
  }

  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, out);
  const mdPath = path.join(root, "ops", "fresh-oracle", "verdict.md");
  fs.writeFileSync(mdPath, renderVerdictMd(run));

  /* readback-אימות (charter VERIFY): מה שנכתב הוא מה שנמדד */
  try {
    const back = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    const last = back.runs[back.runs.length - 1];
    const backOk = back.updatedAt === run.at && JSON.stringify(last.summary) === JSON.stringify(run.summary)
      && back.runs.length <= LAWS.RUNS_CAP && scanSecrets(JSON.stringify(back)).length === 0;
    console.log(`readback: ${backOk ? "OK" : "MISMATCH"} (runs=${back.runs.length}, prior=${back.prior ? "kept" : "null"})`);
    if (!backOk) process.exit(4);
  } catch (e) {
    console.error("readback failed honestly:", String(e).slice(0, 100));
    process.exit(4);
  }

  const s = run.summary;
  console.log(`fresh-oracle run ${run.at} (${trigger}): ${s.GREEN} GREEN · ${s.AMBER} AMBER · ${s.RED} RED · ${s.UNKNOWN} UNKNOWN`);
  for (const c of run.checks) console.log(`  ${c.verdict.padEnd(7)} ${c.id} — ${c.note}`);
  if (heal) {
    const hb = run.checks.find((c) => c.id === "V-FLEET-HEARTBEAT");
    const dl = (hb && hb.evidence.dispatchLog) || [];
    console.log(`heal-log: ${dl.length} dispatch attempt(s), ${dl.filter((d) => d.dispatched).length} queued`);
    for (const d of dl) console.log(`  ${d.dispatched ? "QUEUED" : "FAILED"} ${d.id} (${d.repo}/${d.workflow}, was ${d.verdict}) — http [${d.attempts.join(", ")}]`);
    console.log("honest note: dispatch ≠ heal — הריצה-הבאה היא שתודד את העורקים מחדש (204 = queued, לא = טופל)");
  }
  console.log("written: receipts/fresh-oracle-latest.json + ops/fresh-oracle/verdict.md");
  /* פרסום-פסק-כנה (כולל RED) הוא הצלחת-השער; השער לא נכשל כשהעולם אדום — הוא צורח. */
}

main().catch((e) => { console.error("fresh-oracle crashed:", String((e && e.stack) || e).slice(0, 400)); process.exit(1); });
