// ─────────────────────────────────────────────────────────────────────
// GOVERNANCE-LOOP · מחזור-ההחלטות הריבוני (r142 · D-OP-01)
//
// הפער שנסגר כאן: הדיבונים מקציבים מכונות (פעימות, עוגנים, שמירה),
// אבל מי שבוחר "מה עכשיו" — זה היה סשן-בינה שהמפעיל פותח ביד.
// החוק החדש (אישור-עומד D-OP-01, 2026-09-30): הרשת בוחרת לבד מתוך
// גבולות-הפרוטוקול, מבצעת, מודדת, רושמת ראיה חתומה-גיבוב, ומתקדמת.
//
// הפרוטוקול שאומץ מפרויקט-העבר (unified-platform v33.56):
//   · NEXT_ACTION אחת עם allowed/forbidden/exitCriteria
//   · OPEN_DECISIONS עם המלצות וסטטוס
//   · PROGRAM_STATE עם גבולות-ביצוע מפורשים
//   · יומן-החלטות append-only hash-chained
//
// חוקי-ברזל: לולאה-יחידה ב-globalThis (R80) · בחירה מתוך allowed בלבד
// · כל מחזור = החלטה אחת חתומה (chosen+why+evidence) · קידום-מדינה רק
// כשכל תנאי-היציאה נמדדו מלאים · אפס סודות ביומן.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import net from "node:net";
import {
  appendDecision,
  chooseAction,
  readDecisionLog,
  readNextAction,
  readOpenDecisions,
  readProgramState,
  verifyDecisionLog,
  writeNextAction,
  type BrainCaller,
} from "./sovereign-decisions";

const HOME = "/home/z/my-project";
const CYCLE_STATE_PATH = `${HOME}/sovereign/governance/cycle-state.json`;
const CYCLE_INTERVAL_MS = 10 * 60_000; // מחזור כל 10 דק'
const FIRST_CYCLE_DELAY_MS = 15_000; // מחזור ראשון אחרי עליית-השרת
const HOME_BASE = "http://127.0.0.1:3000";

const DAEMON_PORTS: Array<{ name: string; port: number }> = [
  { name: "pulse", port: 3033 },
  { name: "money", port: 3034 },
  { name: "hunter", port: 3035 },
  { name: "keeper", port: 3036 },
  { name: "student", port: 3037 },
  { name: "fleet-verify", port: 3038 },
  { name: "weblift", port: 3039 },
  { name: "curation", port: 3040 },
  { name: "kpi", port: 3041 },
];

export interface CycleState {
  service: "governance-loop";
  format: "governance-cycle-state-v1";
  bootedAt: string;
  cycles: number;
  lastCycleAt: string | null;
  lastDecisionId: string | null;
  lastChosen: string | null;
  lastVerdict: "DECIDED" | "ADVANCED" | "DEGRADED" | null;
  lastDetail: string | null;
  brainUsed: boolean;
}

interface LoopGlobal {
  __weaveGovernanceLoop?: { timer: ReturnType<typeof setInterval> | null; started: boolean; state: CycleState };
}

const g = globalThis as typeof globalThis & LoopGlobal;

function utcIso(): string {
  return new Date().toISOString();
}

function readCycleState(): CycleState {
  try {
    const raw = JSON.parse(fs.readFileSync(CYCLE_STATE_PATH, "utf8")) as CycleState;
    if (raw && raw.service === "governance-loop") return raw;
  } catch {}
  return {
    service: "governance-loop",
    format: "governance-cycle-state-v1",
    bootedAt: utcIso(),
    cycles: 0,
    lastCycleAt: null,
    lastDecisionId: null,
    lastChosen: null,
    lastVerdict: null,
    lastDetail: null,
    brainUsed: false,
  };
}

function writeCycleState(s: CycleState): void {
  try {
    fs.mkdirSync(`${HOME}/sovereign/governance`, { recursive: true });
    const tmp = `${CYCLE_STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
    fs.renameSync(tmp, CYCLE_STATE_PATH);
  } catch {}
}

// ─── מדידות-חיות (הראיות של כל החלטה) ───

async function fetchJson(pathname: string, timeoutMs = 6_000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${HOME_BASE}${pathname}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tcpAlive(port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function measureFleet(): Promise<{ alive: string[]; dead: string[] }> {
  const alive: string[] = [];
  const dead: string[] = [];
  for (const d of DAEMON_PORTS) (await tcpAlive(d.port) ? alive : dead).push(d.name);
  return { alive, dead };
}

async function measureEvidenceFreshness(): Promise<Array<{ file: string; ageMinutes: number }>> {
  const files = [
    `${HOME}/sovereign/ops-log.json`,
    `${HOME}/sovereign/beat-report.json`,
    `${HOME}/sovereign/kpi/state.json`,
    `${HOME}/sovereign/keeper/fleet-guard-state.json`,
  ];
  const out: Array<{ file: string; ageMinutes: number }> = [];
  const now = Date.now();
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      out.push({ file: f.split("/").slice(-2).join("/"), ageMinutes: Math.round((now - st.mtimeMs) / 60_000) });
    } catch {}
  }
  return out;
}

async function measureGitAhead(): Promise<number> {
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("git", ["rev-list", "--count", "origin/main..HEAD"], {
      cwd: HOME,
      timeout: 20_000,
      encoding: "utf8",
    });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

// ─── קריאת-מוח דרך ה-API של הבית ───

const brainCaller: BrainCaller = async (prompt, system) => {
  try {
    const res = await fetch(`${HOME_BASE}/api/weave/brain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        maxTokens: 256,
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; reply?: string; content?: string; text?: string };
    return data.reply ?? data.content ?? data.text ?? null;
  } catch {
    return null;
  }
};

// ─── הרצאות-פעולה חסומות (בתוך allowed בלבד) ───

async function execFleetTriage(): Promise<string> {
  const fleet = await measureFleet();
  const detail =
    fleet.dead.length === 0
      ? `צי מלא חי: ${fleet.alive.length}/${DAEMON_PORTS.length} דיבונים עונים`
      : `חיים ${fleet.alive.length} · מתים ${fleet.dead.length} (${fleet.dead.join(",")}) — fleet-guard יטפל ע"פ חוקיו`;
  return detail;
}

async function execEvidenceRefresh(): Promise<string> {
  const [treasury, freshness] = await Promise.all([fetchJson("/api/treasury"), measureEvidenceFreshness()]);
  const stalest = freshness.sort((a, b) => b.ageMinutes - a.ageMinutes)[0];
  const key = treasury && typeof treasury === "object" ? ("keyPresent" in treasury ? `keyPresent=${String((treasury as { keyPresent?: unknown }).keyPresent)}` : "house-state") : "treasury-unreachable";
  return `מדידת-בית: ${key} · ראיה-כי-ישנה ביותר: ${stalest ? `${stalest.file} בת ${stalest.ageMinutes} דק'` : "אין"}`;
}

async function execAdvanceCheck(): Promise<string> {
  const na = readNextAction();
  if (!na) return "אין פעולה-באה — פרוטוקול פגום";
  const [gov, fleet] = await Promise.all([fetchJson("/api/governance"), measureFleet()]);
  const log = readDecisionLog();
  const distinct = new Set(log.map((d) => d.decisionId)).size;
  const chain = verifyDecisionLog();
  const govOk = gov?.ok === true;
  const daemonAlive = await tcpAlive(3042);
  const gitAhead = await measureGitAhead();
  const checks = [
    { name: "daemon-3042-alive", ok: daemonAlive, measured: daemonAlive ? "חי" : "מת" },
    { name: "distinct-decisions>=3", ok: distinct >= 3, measured: `${distinct}` },
    { name: "log-chain-valid", ok: chain.ok, measured: chain.ok ? `${chain.entries} רשומות תקינות` : `שבור ב-${chain.brokenAt}` },
    { name: "governance-api-live", ok: govOk, measured: govOk ? "200" : "no-response" },
    { name: "git-advanced", ok: gitAhead === 0, measured: gitAhead < 0 ? "git-unreachable" : gitAhead === 0 ? "הכל ב-origin" : `${gitAhead} קומיטים מקומיים` },
  ];
  const allMet = checks.every((c) => c.ok);
  return allMet
    ? `כל תנאי-היציאה של ${na.actionId} נמדדו מלאים: ${checks.map((c) => `${c.name}=${c.measured}`).join(" · ")}`
    : `תנאי-יציאה: ${checks.map((c) => `${c.name}=${c.ok ? "PASS" : `FAIL(${c.measured})`}`).join(" · ")}`;
}

// ─── המחזור עצמו ───

export async function runGovernanceCycle(): Promise<CycleState> {
  const state = readCycleState();
  try {
    const ps = readProgramState();
    const na = readNextAction();
    const od = readOpenDecisions();
    const log = readDecisionLog();
    const last = log[log.length - 1] ?? null;

    if (!ps || !na) {
      state.lastVerdict = "DEGRADED";
      state.lastDetail = "פרוטוקול חסר (PROGRAM_STATE/NEXT_ACTION) — לא מחליטים בתוך-עיוורון";
      writeCycleState(state);
      return state;
    }

    // מדידות-חיות לפני הבחירה
    const [fleet, freshness] = await Promise.all([measureFleet(), measureEvidenceFreshness()]);
    const fleetSummary = `דיבונים ${fleet.alive.length}/${DAEMON_PORTS.length} חיים${fleet.dead.length ? ` · מתים: ${fleet.dead.join(",")}` : ""} · ראיה-ישנה: ${freshness.sort((a, b) => b.ageMinutes - a.ageMinutes)[0]?.ageMinutes ?? "?"} דק'`;

    // המוח בוחר מתוך allowedActions בלבד; כישלון-מוח ⇒ רוטציה דטרמיניסטית
    const choice = await chooseAction(
      na.allowedActions,
      { phase: ps.phase, openDecisions: od?.decisions ?? [], lastDecision: last, fleetSummary },
      brainCaller,
    );
    const chosen = choice.index !== null ? (na.allowedActions[choice.index] ?? "") : "";

    // הרצאה חסומה לפי מה שנבחר
    let detail = "";
    if (/טריאז'|triage|degraded/i.test(chosen)) detail = await execFleetTriage();
    else if (/Refresh stale evidence|רענון|evidence/i.test(chosen)) detail = await execEvidenceRefresh();
    else if (/Advance NEXT_ACTION|התקדמות|advance/i.test(chosen)) detail = await execAdvanceCheck();
    else detail = await execEvidenceRefresh(); // ברירת-מחדל חסומה: מדידת-אמת

    // רישום ההחלטה — חתומה גיבוב, עם הראיה שנמדדה
    const sealed = appendDecision({
      decisionId: `D-r142-${String(state.cycles + 1).padStart(3, "0")}`,
      class: "governance",
      chosen: chosen || "measure-truth",
      why: choice.why,
      boundary: "AUTO (D-OP-01 אישור-עומד) · בתוך allowedActions של " + na.actionId,
      evidence: detail,
    });

    state.cycles += 1;
    state.lastCycleAt = utcIso();
    state.lastDecisionId = sealed.decisionId;
    state.lastChosen = sealed.chosen;
    state.brainUsed = choice.index !== null && Boolean(choice.raw);
    state.lastVerdict = "DECIDED";
    state.lastDetail = detail.slice(0, 300);
    writeCycleState(state);
    return state;
  } catch (e) {
    state.lastVerdict = "DEGRADED";
    state.lastDetail = (e instanceof Error ? e.message : "שגיאת מחזור").slice(0, 300);
    writeCycleState(state);
    return state;
  }
}

// ─── לולאה-יחידה (R80) ───

export function startGovernanceLoop(): void {
  if (g.__weaveGovernanceLoop?.started) return;
  const state = readCycleState();
  state.bootedAt = state.bootedAt || utcIso();
  g.__weaveGovernanceLoop = { timer: null, started: true, state };

  const tick = async () => {
    try {
      await runGovernanceCycle();
    } catch {}
  };

  setTimeout(tick, FIRST_CYCLE_DELAY_MS);
  g.__weaveGovernanceLoop.timer = setInterval(tick, CYCLE_INTERVAL_MS);

  try {
    fs.mkdirSync(`${HOME}/sovereign/keeper/logs`, { recursive: true });
    fs.appendFileSync(
      `${HOME}/sovereign/keeper/logs/governance-loop.log`,
      `${utcIso()} governance-loop started (interval=${CYCLE_INTERVAL_MS / 1000}s)\n`,
    );
  } catch {}
}

export function governanceLoopState(): CycleState {
  return g.__weaveGovernanceLoop?.state ?? readCycleState();
}
