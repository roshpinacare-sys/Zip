#!/usr/bin/env node
/**
 * candidates-export.mjs — צינור-החתימה · העורק-הראשון (T-60 · trace 1a1251df4476adc5)
 * ═════════════════════════════════════════════════════════════════════════════
 * המנוע-מתכנן (fleet-yield · 300 מועמדים) → פולס-הפעימה → הקוקפיט-של-המפעיל.
 *
 * חוזה-אפס-חשיפה:
 *   · המקור: receipts/fleet-yield/last.json — כבר-מנוכה-סודות (נתוני-שרשרת-פומביים)
 *   · הפלט: receipts/cockpit-candidates.json — פולס-אחד-קריא, מנוכה-סודות,
 *     עם-חותם-זמן-והשוואת-ראשי-מנוע. אפס-WIF · אפס-טוקן · אפס-נתיב-מכונה.
 *   · fail-open-כנה: אין-מקור → פולס-ריק-מסומן (לא-זיוף-ירוק; חוק-הדלת-האדומה).
 *
 * הקוקפיט קורא-את-הפולס-הזה-מהריפו-הפומבי (raw, CORS:*) — שלושת-הבתים
 * (localhost · Render · Pages) מקבלים-את-אותו-פולס, בקצב-הפעימה-של-הצי.
 * האישור-חוזר-כמעטפה-חתומה-בדפדפן (GCM-תחת-מפתח-הסשן) — אפס-מפתח-עובר-על-החוט.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "receipts", "fleet-yield", "last.json");
const DST = path.join(ROOT, "receipts", "cockpit-candidates.json");

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(t, JSON.stringify(v, null, 2));
  fs.renameSync(t, p); /* אטומי — rename הוא-נקודת-המחויבות */
};

let src = null;
try {
  src = JSON.parse(fs.readFileSync(SRC, "utf8"));
} catch {
  src = null;
}

const now = new Date().toISOString();
const sel = Array.isArray(src?.candidates?.selected) ? src.candidates.selected : [];

const pulse = {
  schema: "cockpit-candidates/1",
  pulseAt: now,
  source: src ? "fleet-yield" : "fleet-yield (unavailable — honest empty pulse)",
  engineHead: src?.engineHead ?? null,
  yieldAt: src?.at ?? null,
  verdict: src?.verdict ?? "NO-SOURCE",
  selftest: src?.selftest ? `${src.selftest.passed}/${src.selftest.total} ${src.selftest.status}` : null,
  candidates: sel.slice(0, 12).map((c) => ({
    author: String(c.author ?? "").slice(0, 40),
    permlink: String(c.permlink ?? "").slice(0, 90),
    weight: Number(c.weight ?? 0),
    ageMinutes: Number(c.ageMinutes ?? 0),
    tag: String(c.tag ?? "").slice(0, 30),
  })),
  rejectedCount: Number(src?.candidates?.rejectedCount ?? 0),
  scanned: Number(src?.candidates?.scanned ?? 0),
  dayCapReached: Boolean(src?.candidates?.dayCapReached ?? false),
  doctrine:
    "המנוע-מתכנן · המפעיל-מאשר · הכספת-חותמת — אפס-מפתח-עובר-על-החוט (T-60)",
};

writeJson(DST, pulse);
console.log(
  `[candidates-export] pulse: ${pulse.candidates.length} candidates · verdict=${pulse.verdict} · scanned=${pulse.scanned} · at=${pulse.pulseAt}`,
);
