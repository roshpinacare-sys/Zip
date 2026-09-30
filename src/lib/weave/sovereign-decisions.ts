// ─────────────────────────────────────────────────────────────────────
// SOVEREIGN-DECISIONS · מנוע-ההחלטות הריבוני (r142 · D-OP-01)
//
// מקור: פרויקט-העבר של המפעיל (unified-platform v33.56 · governance-state).
// הפרוטוקול שאומץ: פעולה-באה-אחת עם allowed/forbidden/exitCriteria,
// החלטות-פתוחות עם המלצות, מצב-תוכנית עם גבולות, ורישום-החלטות
// נגיש-רק-להוספה עם שרשור-גיבוב (prevHash → entryHash).
//
// השינוי הריבוני (D-OP-01, אישור-עומד של המפעיל 2026-09-30):
// "אני מאשר הכל" — הצי מחליט לבד בתוך גבולות AUTO, מבצע, רושם ראיה,
// ומתקדם. המתנה-למפעיל אינה עוד מצב חוקי בתוך הגבולות.
//
// חוקי-ברזל:
//   · כל החלטה: chosen + why + class + evidence — בלי יוצאים מן הכלל.
//   · היומן append-only: אסור לערוך; כל רשומה חתומה בגיבוב הקודמת.
//   · טענה בלי מדידה = פסול. ראיה = מספר/קישור/קובץ-מדידה.
//   · סודות: אף פעם לא ביומן, בלוג או תשובה. טביעת-אצבע בלבד.
//   · המוח בוחר מתוך allowedActions בלבד — מה שאסור, לא נשאל אפילו.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const HOME = "/home/z/my-project";
export const GOV_DIR = path.join(HOME, "sovereign", "governance");
export const PROGRAM_STATE_PATH = path.join(GOV_DIR, "PROGRAM_STATE.json");
export const NEXT_ACTION_PATH = path.join(GOV_DIR, "NEXT_ACTION.json");
export const OPEN_DECISIONS_PATH = path.join(GOV_DIR, "OPEN_DECISIONS.json");
export const DECISION_LOG_PATH = path.join(GOV_DIR, "DECISION_LOG.jsonl");

export type DecisionClass = "governance" | "economy" | "fleet" | "evidence" | "external-leg" | "gate";

export interface DecisionEntry {
  seq: number;
  at: string;
  decisionId: string;
  class: DecisionClass;
  chosen: string;
  why: string;
  boundary: string;
  evidence?: string;
  prevHash: string;
  entryHash: string;
}

// ─── גיבוב-שרשור: הרשומה נחתמת על כל-תוכנה פרט ל-entryHash שלה ───

export function hashDecision(entry: Omit<DecisionEntry, "entryHash">): string {
  const { entryHash: _omit, ...rest } = entry as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export function readDecisionLog(): DecisionEntry[] {
  try {
    const raw = fs.readFileSync(DECISION_LOG_PATH, "utf8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as DecisionEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is DecisionEntry => x !== null);
  } catch {
    return [];
  }
}

/** אימות-שרשרת: כל prevHash תואם את entryHash של קודמו, וכל entryHash תואם את תוכנו. */
export function verifyDecisionLog(): { ok: boolean; brokenAt: number | null; entries: number } {
  const log = readDecisionLog();
  let prev = "GENESIS";
  for (let i = 0; i < log.length; i++) {
    const e = log[i]!;
    if (i === 0 ? e.prevHash !== "GENESIS" : e.prevHash !== prev) return { ok: false, brokenAt: e.seq, entries: log.length };
    const recomputed = hashDecision(e);
    if (recomputed !== e.entryHash) return { ok: false, brokenAt: e.seq, entries: log.length };
    prev = e.entryHash;
  }
  return { ok: true, brokenAt: null, entries: log.length };
}

export function appendDecision(
  entry: Omit<DecisionEntry, "seq" | "prevHash" | "entryHash" | "at"> & { at?: string },
): DecisionEntry {
  const log = readDecisionLog();
  const last = log[log.length - 1];
  const seq = (last?.seq ?? 0) + 1;
  const full: Omit<DecisionEntry, "entryHash"> = {
    seq,
    at: entry.at ?? new Date().toISOString(),
    decisionId: entry.decisionId,
    class: entry.class,
    chosen: entry.chosen,
    why: entry.why,
    boundary: entry.boundary,
    ...(entry.evidence ? { evidence: entry.evidence } : {}),
    prevHash: last?.entryHash ?? "GENESIS",
  };
  const sealed: DecisionEntry = { ...full, entryHash: hashDecision(full) };
  fs.mkdirSync(GOV_DIR, { recursive: true });
  fs.appendFileSync(DECISION_LOG_PATH, `${JSON.stringify(sealed)}\n`, { encoding: "utf8" });
  return sealed;
}

// ─── קריאת-פרוטוקול ───

export interface ProgramState {
  format: string;
  version: string;
  updatedAt: string;
  program: string;
  phase: string;
  readiness: string;
  status: string;
  operatorStandingApproval?: { decisionId: string; givenAt: string; meaning: string };
  executionBoundary: { auto: string[]; gate: string[]; forbidden: string[] };
  completed: string[];
  blockedGates: string[];
  evidencePaths: string[];
}

export interface NextAction {
  format: string;
  version: string;
  updatedAt: string;
  actionId: string;
  title: string;
  allowedActions: string[];
  forbiddenActions: string[];
  exitCriteria: string[];
  qualificationTargetVersion: string;
}

export interface OpenDecision {
  id: string;
  status: string;
  class?: string;
  recommendation?: string;
  decision?: string;
  evidence?: string;
  resolvedAt?: string;
  preApprovedBy?: string;
}

export function readProgramState(): ProgramState | null {
  try {
    return JSON.parse(fs.readFileSync(PROGRAM_STATE_PATH, "utf8")) as ProgramState;
  } catch {
    return null;
  }
}

export function readNextAction(): NextAction | null {
  try {
    return JSON.parse(fs.readFileSync(NEXT_ACTION_PATH, "utf8")) as NextAction;
  } catch {
    return null;
  }
}

export function readOpenDecisions(): { version: string; updatedAt: string; decisions: OpenDecision[] } | null {
  try {
    return JSON.parse(fs.readFileSync(OPEN_DECISIONS_PATH, "utf8"));
  } catch {
    return null;
  }
}

/** כתיבת פעולה-באה (התקדמות-מדינה). רק כשתנאי-יציאה נמדדו מלאים. */
export function writeNextAction(next: NextAction): void {
  const tmp = `${NEXT_ACTION_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, NEXT_ACTION_PATH);
}

// ─── בחירת-פעולה על-ידי המוח (בתוך allowed בלבד) ───

export interface BrainChoice {
  index: number | null;
  why: string;
  raw?: string;
}

export interface BrainCaller {
  (prompt: string, system: string): Promise<string | null>;
}

/** שואל את המוח לבחור פעולה אחת מתוך allowedActions; כישלון-מוח ⇒ בחירה-דטרמיניסטית עגולה. */
export async function chooseAction(
  allowed: string[],
  context: { phase: string; openDecisions: OpenDecision[]; lastDecision: DecisionEntry | null; fleetSummary: string },
  callBrain: BrainCaller,
): Promise<BrainChoice> {
  const system =
    "אתה מוח-ההחלטות של רשת ריבונית. עליך לבחור בדיוק פעולה אחת מהרשימה — אין יצירה חופשית, אין פעולה מחוץ לרשימה. " +
    "ענה בפורמט קשיח בדיוק: INDEX=<מספר> | WHY=<נימוק קצר בעברית עד 40 מילים>. " +
    "העדפה: מה שמוכיח אמת חיה (מדידה), סוגר החלטה פתוחה, או מקדם קריטריון-יציאה של הפעולה-הבאה.";
  const prompt =
    `פאזה: ${context.phase}\n` +
    `פעולות-מותרות:\n${allowed.map((a, i) => `${i}. ${a}`).join("\n")}\n` +
    `החלטות-פתוחות: ${context.openDecisions.filter((d) => d.status === "open" || d.status === "provisional").map((d) => d.id).join(", ") || "אין"}\n` +
    `החלטה-אחרונה: ${context.lastDecision ? `${context.lastDecision.decisionId}: ${context.lastDecision.chosen}` : "אין"}\n` +
    `מצב-צי: ${context.fleetSummary}\n` +
    `בחר INDEX ונמק.`;
  try {
    const raw = await callBrain(prompt, system);
    if (raw) {
      const m = /INDEX\s*=\s*(\d+)/.exec(raw);
      const wm = /WHY\s*=\s*(.+)/.exec(raw);
      if (m) {
        const idx = Number(m[1]);
        if (Number.isInteger(idx) && idx >= 0 && idx < allowed.length) {
          return { index: idx, why: (wm?.[1] ?? "נימוק המוח חסר").trim().slice(0, 400), raw: raw.slice(0, 500) };
        }
      }
    }
  } catch {
    /* כישלון-מוח: נפילה לבחירה דטרמיניסטית */
  }
  // בחירה דטרמיניסטית: רוטציה עגולה לפי זמן — גם בלי מוח, הצי מתקדם
  const idx = Math.floor(Date.now() / 600_000) % allowed.length;
  return { index: idx, why: "בחירה דטרמיניסטית (רוטציה עגולה) — המוח לא השיב; הרשת ממשיכה בלי המתנה" };
}
