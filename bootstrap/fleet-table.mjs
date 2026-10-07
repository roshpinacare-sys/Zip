// ─────────────────────────────────────────────────────────────────────────────
// fleet-table.mjs — טבלת-הצי הקנונית (מקור-אמת אחד לריבייב-ולשומר)
// נגזר מ-FLEET של sovereign-revive.mjs (Task 7-b) + המדידות של /api/fleet.
// core = הרשימה-שהוטלה-בהוראת-המפעיל · ext = שאר-הסגל.
// ─────────────────────────────────────────────────────────────────────────────

export const FLEET = [
  { name: "pulse", port: 3033, dir: "pulse", core: true },
  { name: "money-mover", port: 3034, dir: "money", core: true },
  { name: "hunter", port: 3035, dir: "hunter", core: true },
  { name: "keeper", port: 3036, dir: "keeper", core: true },
  { name: "student", port: 3037, dir: "student", core: false },
  { name: "fleet-verify", port: 3038, dir: "fleet-verify", core: false },
  { name: "weblift", port: 3039, dir: "weblift", core: false },
  { name: "curation", port: 3040, dir: "curation", core: true },
  { name: "kpi", port: 3041, dir: "kpi", core: false },
  { name: "governance", port: 3042, dir: "governance", core: false },
  { name: "treasury-audit", port: 3043, dir: "treasury-audit", core: false },
  { name: "scout-market", port: 3044, dir: "scout-market", core: false },
  { name: "business", port: 3045, dir: "business", core: false },
  { name: "content-factory", port: 3046, dir: "content-factory", core: false },
  { name: "llm-bridge", port: 3048, dir: "llm-bridge", core: false },
  { name: "market-maker", port: 3049, dir: "market-maker", core: true },
  { name: "web-console", port: 3050, dir: "web", core: false },
  { name: "dex-grid", port: 3051, dir: "dex-grid", core: true },
  { name: "proof-law", port: 3052, dir: "proof-law", core: true },
  { name: "arbitrage", port: 3053, dir: "arbitrage", core: true },
  // הרחבת-כיסוי (Task 11): השומר-מרפא-גם-את-שאר-האיברים-הקריטיים
  { name: "dex-guard", port: 3054, dir: "dex-guard", core: true, kind: "dex-guard" },
  { name: "decision-brain", port: 3047, dir: "decision-brain", core: true, kind: "python" },
];

// שירותים-מיוחדים-מחוץ-לדפוס-הדיבונים (מטופלים-בנפרד-בשומר):
//   · dex (:3010) — next start ב-saos-dex (בנייה-מלאה; לא-בכל-ריפוי)
//   · cadence-daemon — בודק-pgrep ומשגר-מהגיט (ממומש-בשומר)
export const SPECIAL = {
  dex: { name: "dex", port: 3010, paths: ["/saos-dex/api/dex/state"] },
};

// הקונסולה החיה (:3000) — לא-דיבון-מיני אלא next-dev; מטופל-בנפרד בשומר.
export const CONSOLE = { name: "console-3000", port: 3000 };
