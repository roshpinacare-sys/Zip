#!/usr/bin/env node
/**
 * vein-probe.mjs — חיישן-עורקי-הרשת-הריבוניים (T-57 · trace 1a125590a7fdebad)
 * ═════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה: עורק-שלא-נמדד = הנחה. אנחנו לא מניחים.
 *
 * מה הוא עושה: מודד חיות עורקי-האינטל (להבדיל מעורקי-תשתית של key-probe):
 *   · TAVILY_API_KEY_1 — חיפוש-רשת ריבוני (מיכסה-מודעת: נמדד תמיד — 1-קרדיט)
 *   · TAVILY_API_KEY_2 — נמדד רק אם K1 מת (חיסכון-מיכסה · failover-מוכח)
 *   · JINA_API_KEY     — קורא-רשת (r.jina.ai) — הוכח-חי קורא steemit.com
 *   · IPAI_API_KEY     — שירות-לא-מזוהה — נאטם-עד-זיהוי (אמת-כנה, אפס-המצאות)
 *
 * מקור-המפתחות: משתני-סביבה בלבד — הקורא מקור-את קובץ-כספת של הכספת ואז מריץ;
 * הסקריפט עצמו אפס-סודות. הפלט-מעולם-לא-מכיל-ערך-מפתח — רק נוכחות וטביעת-אצבע.
 *
 * קבלות: receipts/veins.jsonl (tail-256 · append-only · טביעות-אצבע בלבד).
 * יציאה: 0 תמיד — עורקי-אינטל הם יכולת, לא תשתית; המוות-שלהם נרשם-בכנות, לא-מפיל-שרשרת.
 * ═════════════════════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R_DIR = path.join(ROOT, "receipts");
const LOG = path.join(R_DIR, "veins.jsonl");
const TAIL = 256;
const fp = (s) => (s ? `${s.slice(0, 8)}…(len${s.length})` : "absent");
const now = () => new Date().toISOString();

async function probeTavily(key, label) {
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, query: "sovereign autonomy", max_results: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    return { vein: `tavily:${label}`, fingerprint: fp(key), http: r.status,
      live: r.ok && Array.isArray(j.results) && j.results.length > 0,
      detail: r.ok ? `results:${j.results.length}` : String(j.detail || j.error || "refused").slice(0, 60),
      ms: Date.now() - t0 };
  } catch (e) {
    return { vein: `tavily:${label}`, fingerprint: fp(key), http: 0, live: false, detail: String(e).slice(0, 60), ms: Date.now() - t0 };
  }
}

async function probeJina(key) {
  const t0 = Date.now();
  try {
    const r = await fetch("https://r.jina.ai/https://steemit.com/@headcorner", {
      headers: { Authorization: `Bearer ${key}`, "X-Return-Format": "text" },
      signal: AbortSignal.timeout(20000),
    });
    const t = await r.text();
    return { vein: "jina:reader", fingerprint: fp(key), http: r.status,
      live: r.ok && t.length > 200,
      detail: r.ok ? `bytes:${t.length} steemit-readable:${t.includes("headcorner")}` : "refused",
      ms: Date.now() - t0 };
  } catch (e) {
    return { vein: "jina:reader", fingerprint: fp(key), http: 0, live: false, detail: String(e).slice(0, 60), ms: Date.now() - t0 };
  }
}

async function probeIpai(key) {
  // שירות-לא-מזוהה — נבדק מול צורות-מצרף-נפוצות; אם-אין — כנות: pending-identification
  for (const base of ["https://api.ipai.chat/v1/models", "https://open.ipai.cc/v1/models"]) {
    try {
      const r = await fetch(base, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      if (r.ok) return { vein: "ipai", fingerprint: fp(key), http: r.status, live: true, detail: `identified:${base}`, ms: 0 };
    } catch { /* next */ }
  }
  return { vein: "ipai", fingerprint: fp(key), http: 0, live: false, detail: "service-unidentified (sealed pending identification)", ms: 0 };
}

async function main() {
  fs.mkdirSync(R_DIR, { recursive: true });
  const out = [];
  const k1 = (process.env.TAVILY_API_KEY_1 || "").trim();
  const k2 = (process.env.TAVILY_API_KEY_2 || "").trim();
  const jk = (process.env.JINA_API_KEY || "").trim();
  const ik = (process.env.IPAI_API_KEY || "").trim();

  if (!k1 && !k2 && !jk) {
    out.push({ at: now(), vein: "none", verdict: "no-vein-keys-in-env (vault sealed? honest skip)" });
    fs.appendFileSync(LOG, JSON.stringify(out[0]) + "\n");
    console.log("vein-probe: no vein keys in env — honest skip (nothing measured, nothing faked)");
    return;
  }
  if (k1) out.push(await probeTavily(k1, "K1"));
  // מיכסה-מודעת: K2 נמדד רק אם K1 לא הוכיח חיים
  if (k2 && (!k1 || !out.find((o) => o.vein === "tavily:K1")?.live)) out.push(await probeTavily(k2, "K2"));
  if (jk) out.push(await probeJina(jk));
  if (ik) out.push(await probeIpai(ik));

  const rec = { at: now(), probe: "vein-probe T-57", results: out,
    liveCount: out.filter((o) => o.live).length, ofProbed: out.length };
  fs.appendFileSync(LOG, JSON.stringify(rec) + "\n");
  const lines = fs.readFileSync(LOG, "utf8").trim().split("\n");
  if (lines.length > TAIL) fs.writeFileSync(LOG, lines.slice(-TAIL).join("\n") + "\n");
  for (const o of out) console.log(`vein ${o.vein}: ${o.live ? "LIVE" : "DEAD"} · http=${o.http} · ${o.detail} · ${o.ms}ms · ${o.fingerprint}`);
  console.log(`vein-probe: ${rec.liveCount}/${rec.ofProbed} live (receipts/veins.jsonl · fingerprints only)`);
}

main().catch((e) => { console.log(`vein-probe: crashed honestly (${String(e).slice(0, 80)})`); process.exit(0); });
