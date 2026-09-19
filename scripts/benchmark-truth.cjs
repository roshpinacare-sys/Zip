#!/usr/bin/env node
/**
 * TRUTH-GATE — מכונת מדידת האמת של המערך.
 * עיקרון: שום ניקוד/פסק-דין לא נכתב כאן ביד — הכל נמדד בזמן ריצה.
 * כל בדיקה מחזירה PASS / FAIL / SKIP + את הערך הגולמי שנמדד.
 * הריצה עצמה היא הראיה; הפלט נשמר ל- sovereign/reports/.
 *
 * שימוש: node scripts/benchmark-truth.cjs
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BASE = "https://roshpinacare-sys.github.io/Console";
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "sovereign", "reports");

const results = [];
function record(gate, status, measured, note = "") {
  results.push({ gate, status, measured, note, at: new Date().toISOString() });
  const sym = status === "PASS" ? "✔" : status === "SKIP" ? "·" : "✘";
  console.log(`${sym} ${gate.padEnd(28)} ${status}  ${measured}${note ? "  — " + note : ""}`);
}

async function fetchJson(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
    const text = await r.text();
    try { return { ok: r.ok, status: r.status, json: JSON.parse(text), text }; }
    catch { return { ok: r.ok, status: r.status, json: null, text }; }
  } catch (e) {
    return { ok: false, status: 0, json: null, text: "", error: String(e.message || e) };
  } finally { clearTimeout(t); }
}

function readLocal(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch { return null; }
}

function hoursBetween(a, b) { return Math.abs(new Date(b) - new Date(a)) / 36e5; }

(async () => {
  console.log(`\nTRUTH-GATE · ${new Date().toISOString()}\ntarget: ${BASE}\n`);

  // ── G1: האתר הציבורי חי ────────────────────────────────────────────
  const home = await fetchJson(BASE + "/");
  const homeBytes = home.text ? Buffer.byteLength(home.text) : 0;
  record("G1-site-up", home.ok ? "PASS" : "FAIL",
    `HTTP ${home.status} · ${homeBytes} bytes`);

  // ── G2: אפס קישורים שבורים בעמוד הבית ────────────────────────────
  let broken = [], blocked = [], checked = 0;
  if (home.ok) {
    const hrefs = new Set();
    const re = /href="([^"]*)"/g; let m;
    while ((m = re.exec(home.text)) !== null) hrefs.add(m[1]);
    const links = [...hrefs].filter(h =>
      !h.startsWith("#") && !h.startsWith("data:") && !h.startsWith("javascript:") &&
      !h.includes("'") && !h.includes("+") && h.trim().length > 1
    );
    for (const h of links) {
      const url = h.startsWith("http") ? h : BASE + "/" + h.replace(/^\.\//, "");
      checked++;
      const r = await fetchJson(url, 12000);
      // 404/5xx = שבור בוודאות. 403 מאתר-צד שלישי = חומת-בוטים, לא הוכחת שבירה.
      if (r.status === 403) blocked.push(`${h} → 403 (חומת-בוטים, בלתי-מוכרע)`);
      else if (!r.ok) broken.push(`${h} → ${r.status}`);
    }
  }
  record("G2-zero-broken-links",
    home.ok ? (broken.length === 0 ? "PASS" : "FAIL") : "SKIP",
    `${checked} קישורים נבדקו · ${broken.length} שבורים · ${blocked.length} בלתי-מוכרעים`,
    broken.length ? broken.join(" | ") : "");

  // ── G3: טריות קו העדות באתר הפרוס ────────────────────────────────
  const depStatus = await fetchJson(BASE + "/status.json");
  if (depStatus.json) {
    const gen = depStatus.json.generatedAt;
    const ageH = hoursBetween(gen, new Date());
    const thr = depStatus.json.freshness?.thresholdHours ?? 26;
    record("G3-witness-freshness", ageH <= thr ? "PASS" : "FAIL",
      `cp#${depStatus.json.witness?.checkpoint} · att ${depStatus.json.witness?.attestations} · גיל ${ageH.toFixed(1)}h (סף ${thr}h)`);
  } else record("G3-witness-freshness", "FAIL", `status.json לא נקרא (HTTP ${depStatus.status})`);

  // ── G4: מראה מקומית לא משקרת (מקומי מול פרוס) ─────────────────────
  const locStatus = readLocal("console/status.json"); // העותק המקומי שמפורסם בפועל ל-Pages
  if (depStatus.json && locStatus) {
    const sameFormat = locStatus.format === depStatus.json.format;
    const lagH = hoursBetween(locStatus.generatedAt, depStatus.json.generatedAt);
    const lagging = lagH > (depStatus.json.freshness?.cadenceHours ?? 2);
    // עותק מקומי קדום זה לא כשל אם הוא לא מוצג לשום אחד כ"עכשווי".
    // הסנדבוקס ארעי — האמת היחידה היא הפרוס. כאן נמדד הפער ותו לא.
    record("G4-mirror-lag", lagging ? "WARN" : "PASS",
      `מקומי ${locStatus.witness?.checkpoint ?? "?"} (מ-${locStatus.generatedAt.slice(0, 10)}) מול פרוס ${depStatus.json.witness?.checkpoint} · פער ${lagH.toFixed(1)}h`,
      sameFormat ? "" : "פורמט שונה בין העותקים");
  } else record("G4-mirror-lag", "SKIP", "חסר עותק מקומי או פרוס");

  // ── G5: אחידות פורמט saos-live.json (שם זהה = פורמט זהה) ─────────
  const depLive = await fetchJson(BASE + "/saos-live.json");
  const locLive = readLocal("sovereign/saos-live.json");
  if (depLive.json && locLive) {
    const fDep = depLive.json.format, fLoc = locLive.format;
    record("G5-live-format-consistency", fDep === fLoc ? "PASS" : "FAIL",
      `פרוס="${fDep}" מול מקומי="${fLoc}"`,
      fDep === fLoc ? "" : "שני פורמטים שונים תחת אותו שם-קובץ = שתי אמיתות");
  } else record("G5-live-format-consistency", "SKIP", "צד חסר");

  // ── G6: מספור המסירות מסונכרן (bridgehead מול git HEAD) ────────────
  let gitR = null;
  try {
    const log = execSync("git log --oneline -20", { cwd: ROOT, encoding: "utf8" });
    const rs = [...log.matchAll(/\bR(\d+)\b/g)].map(x => parseInt(x[1], 10));
    gitR = rs.length ? Math.max(...rs) : null;
  } catch {}
  const bridge = await fetchJson(BASE + "/agent/state.json");
  let bridgeR = null;
  if (bridge.json) {
    const m = (bridge.json.currentTask || "").match(/\bR(\d+)\b/);
    if (m) bridgeR = parseInt(m[1], 10);
  }
  if (gitR != null && bridgeR != null) {
    record("G6-delivery-numbering", bridgeR >= gitR ? "PASS" : "FAIL",
      `bridgehead R${bridgeR} מול git R${gitR}`,
      bridgeR >= gitR ? "" : "האתר הציבורי לא יודע על המסירות האחרונות — מענה לשתי אמיתות");
  } else record("G6-delivery-numbering", "SKIP", `git=${gitR} bridge=${bridgeR}`);

  // ── G7: שרת הסנדבוקס חי (העולם שהמפעיל לא רואה) ──────────────────
  const dev = await fetchJson("http://localhost:3000/api/health", 5000);
  record("G7-dev-server", dev.ok ? "PASS" : "WARN",
    `HTTP ${dev.status} (סנדבוקס ארעי — לא מקור האמת, רק מקום העבודה)`);

  // ── אגידה ─────────────────────────────────────────────────────────
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const warn = results.filter(r => r.status === "WARN" || r.status === "SKIP").length;
  const verdict = fail === 0 ? "ALL-GREEN" : `${fail} RED`;
  console.log(`\nפסק-דין: ${verdict} · ${pass} PASS · ${fail} FAIL · ${warn} WARN/SKIP\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `truth-gate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const report = {
    format: "truth-gate-v1", at: new Date().toISOString(), target: BASE,
    verdict, counts: { pass, fail, warn }, results
  };
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`דוח: ${path.relative(ROOT, file)}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
