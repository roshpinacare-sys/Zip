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

  // ── G2: אפס קישורים שבורים בדור הנוכחי של העמודים הציבוריים (לקח R57:
  //    הבית בלבד פספס את ה-wallet. לקח R58: הרשימה היא הדור הנוכחי בלבד —
  //    החזיתות שיצאו מהמחזור מכוסות על ידי G8) ──
  const PAGES = ["", "wallet.html", "truth.html", "receipts/", "hub/index.html"];
  let broken = [], blocked = [], checked = 0;
  const seenLinks = new Set();
  for (const page of PAGES) {
    const pageUrl = page ? `${BASE}/${page}` : `${BASE}/`;
    const ph = page ? await fetchJson(pageUrl, 15000) : home;
    if (!ph.ok || !ph.text) { if (page) broken.push(`${page} עצמו → HTTP ${ph.status}`); continue; }
    const pageBase = new URL(pageUrl);
    const hrefs = new Set();
    const re = /href="([^"]*)"/g; let m;
    while ((m = re.exec(ph.text)) !== null) hrefs.add(m[1]);
    for (const h of hrefs) {
      if (!h || h.startsWith("#") || h.startsWith("data:") || h.startsWith("javascript:") ||
          h.startsWith("mailto:") || h.startsWith("tel:")) continue;
      // קטעי תבנית-JS מוטמעים (href="' + esc(x)) הם קוד, לא קישורים
      if (h.includes("'") || h.includes("+") || h.includes("<")) continue;
      let u;
      try { u = new URL(h, pageBase); } catch { continue; }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = "";
      const key = u.toString();
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      checked++;
      const r = await fetchJson(key, 12000);
      // שלנו: כל מה שאינו 200 — שבור, זה שלנו. צד-שלישי: 404/4xx = שבור
      // בוודאות; 403/5xx/0 = בלתי-מוכרע (חומות-בוטים, קריסת מקור חולפת).
      const sameOrigin = u.origin === pageBase.origin;
      if (sameOrigin ? !r.ok : (r.ok ? false : !(r.status === 403 || r.status === 0 || r.status >= 500))) {
        broken.push(`${page || "(home)"}: ${h} → ${r.status}`);
      } else if (!sameOrigin && !r.ok) {
        blocked.push(`${h} (${r.status})`);
      }
    }
  }
  record("G2-zero-broken-links",
    home.ok ? (broken.length === 0 ? "PASS" : "FAIL") : "SKIP",
    `${PAGES.length} עמודים · ${checked} קישורים נבדקו · ${broken.length} שבורים · ${blocked.length} בלתי-מוכרעים`,
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

  // ── G4: אף תאום מזויף — קבצים שנולדים בריפו הציבורי לא מחזיקים עותק
  //    מקומי (דוקטרינת Task 28 + ריפוי R57: עותק מקומי של קובץ שנולד
  //    בציבורי = אמת שנייה שמתיישנת בשקט — בדיוק הכשל שנתפס כאן).
  // הרחבת R58: החזיתות שיצאו מהמחזור נולדו-מחדש כ-stub ציבורי — עותק מקומי שלהן הוא תאום מזויף.
  const RETIRED = ["money.html", "net.html", "acid.html", "gate.html", "roast.html", "defi.html", "deposits.html", "readiness.html", "sovereign.html", "versus.html"];
  const PUBLIC_BORN = ["index.html", "status.json", ...RETIRED];
  const forged = PUBLIC_BORN.filter((f) => fs.existsSync(path.join(ROOT, "console", f)));
  record("G4-no-forged-twins", forged.length === 0 ? "PASS" : "FAIL",
    forged.length ? `עותקים מקומיים מזויפים: ${forged.join(", ")}` : "אף קובץ שנולד בציבורי לא מחזיק תאום בריבוני ✓",
    forged.length ? "קובץ שנערך בריפו הציבורי לא מופיע בריבו הריבוני — שתי אמיתות לקובץ אחד הוא באג" : "");

  // ── G5: שם שמור — saos-live.json פירושו דבר אחד בלבד ─────────────
  // כלל R57: השם שמור לספר הציבורי המתפרסם ל-Pages. במחשב הריבוני לא
  // יהיה עוד קובץ בשם הזה עם פורמט אחר. שני תפקידים = שני שמות.
  const depLive = await fetchJson(BASE + "/saos-live.json");
  const rogueLocal = fs.existsSync(path.join(ROOT, "sovereign", "saos-live.json"));
  const stateFile = readLocal("sovereign/saos-live-state.json");
  if (depLive.json) {
    const pubFormat = depLive.json.format;
    const ok = pubFormat === "saos-live-v1" && !rogueLocal;
    record("G5-live-format-consistency", ok ? "PASS" : "FAIL",
      `ספר ציבורי="${pubFormat}" · קובץ-בשם-שמור מקומי=${rogueLocal ? "קיים (עבירה)" : "אין ✓"}${stateFile ? " · מצב-דמון בנפרד ✓" : ""}`,
      ok ? "" : "שם saos-live.json מציין יותר מאמת אחת");
  } else record("G5-live-format-consistency", "FAIL", `saos-live.json לא נקרא (HTTP ${depLive.status})`);

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


  // ── G8: דור ממשק אחד (R58) — החזיתות שיצאו מהמחזור מגישות הפניה קבועה
  //    בלבד, האינדקס לא מקשר אליהן, האמת מקושרת, והמפה נקייה מהן. ──
  const stubFail = [];
  for (const p of RETIRED) {
    const r = await fetchJson(`${BASE}/${p}`, 12000);
    if (!r.ok || !r.text) { stubFail.push(`${p}: HTTP ${r.status}`); continue; }
    const bytes = Buffer.byteLength(r.text);
    if (bytes > 2500) { stubFail.push(`${p}: ${bytes}B > 2500B`); continue; }
    if (!r.text.includes('content="0; url=/Console/"')) { stubFail.push(`${p}: אין הפניה קבועה`); continue; }
    if (!r.text.includes('rel="canonical"')) { stubFail.push(`${p}: אין canonical`); continue; }
  }
  const indexText = home.text || "";
  const retiredHrefs = RETIRED.filter((p) => indexText.includes(`href="${p}"`));
  const truthLinked = indexText.includes('href="truth.html"');
  const sitemap = await fetchJson(BASE + "/sitemap.xml", 15000);
  const retiredInSitemap = sitemap.ok && sitemap.text ? RETIRED.filter((p) => sitemap.text.includes(`/${p}`)) : ["(מפה בלתי-קריאה)"];
  const g8ok = stubFail.length === 0 && retiredHrefs.length === 0 && truthLinked && retiredInSitemap.length === 0;
  record("G8-single-generation", g8ok ? "PASS" : "FAIL",
    `${RETIRED.length} stubs מוצאים · hrefs מוצאים באינדקס ${retiredHrefs.length} · אמת מקושרת ${truthLinked ? "כן" : "לא"} · במפה ${retiredInSitemap.length === 1 && retiredInSitemap[0] === "(מפה בלתי-קריאה)" ? "?" : retiredInSitemap.length}`,
    [stubFail.join(" | "), retiredHrefs.join(" | "), retiredInSitemap.join(" | ")].filter(Boolean).join(" || "));

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
