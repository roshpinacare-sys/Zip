// ─────────────────────────────────────────────────────────────────────
// MONEY-MOVER — מוביל הכסף · דיבון סולם-הפאריטה (R81, rebuilt R90)
//
// החוזה: המוח הפיננסי חי ב-/api/money (Next.js) — הדיבון הוא לב-פעימה
// בלבד: מודד כל 60ש', מפעיל REPRICE כשהקו זז, וכותב את המצב לספרים.
//
// חוקי-ברזל (מהקנון):
//   · טריגרים: סטיית-פאריטה >50bps מהמדרגה · נזיל ≥1 STEEM
//   · צינון 30 דק' בין פעולות · תקציב 12 פעולות/יום
//   · acting=true בזמן פעולה — השומר לעולם לא הורג באמצע (חוק הפעולה)
//   · כנות: מדידה שנכשלה נרשמת ככישלון — אין "נניח שבסדר"
//   · הקנון מקבל קבלה אחרי כל פעולה, אחרי שער-סודות
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/money/state.json`;
const HISTORY_FILE = `${HOME}/sovereign/money/history.json`;
const PORT = 3034;
const CHECK_INTERVAL_SEC = 60;
const API = "http://127.0.0.1:3000/api/money";

const POLICY = {
  triggers: { parityDriftBps: 50, floorBps: -50, idleTriggerSteem: 1 },
  cooldownMin: 30,
  actionsBudgetPerDay: 12,
  truthSource: "api.steemit.com · get_open_orders/get_accounts (via /api/money)",
};

type Decision = { at: string; kind: string; detail: string };

type MoneyState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  checkIntervalSec: number;
  policy: typeof POLICY;
  lastActionAt: string | null;
  actionsToday: number;
  actionDay: string;
  acting: boolean;
  lastDecision: Decision | null;
  canonLast: { at: string; ok: boolean; path: string } | null;
  history?: Array<Record<string, unknown>>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readState(): MoneyState {
  const base: MoneyState = {
    service: "money-mover",
    version: "1.1.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    checkIntervalSec: CHECK_INTERVAL_SEC,
    policy: POLICY,
    lastActionAt: null,
    actionsToday: 0,
    actionDay: utcDay(),
    acting: false,
    lastDecision: null,
    canonLast: null,
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    // המשכיות אמיתית: מונים, תקציבים וצינון שורדים restart/hot-reload (לקח R84)
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastActionAt: prev.lastActionAt ?? null,
      actionsToday: prev.actionDay === utcDay() ? (prev.actionsToday ?? 0) : 0,
      actionDay: prev.actionDay === utcDay() ? prev.actionDay : utcDay(),
      acting: false, // אתחול: תהליך חדש — אין פעולה בטיסה. אם פעולה קודמת נתקעה mid-flight, היא הסתיימה עם מות התהליך.
      lastDecision: prev.lastDecision ?? null,
      canonLast: prev.canonLast ?? null,
    };
  } catch {
    return base;
  }
}

let state: MoneyState = readState();

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/money`, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendHistory(entry: Record<string, unknown>, cap = 60) {
  try {
    let h: Array<Record<string, unknown>> = [];
    try {
      h = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      if (!Array.isArray(h)) h = [];
    } catch {}
    h.push({ at: new Date().toISOString(), ...entry });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-cap), null, 2));
  } catch {}
}

// ── שער-סודות לקנון: שום מפתח לא עובר ─────────────────────────────
function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) {
    return { ok: false, reason: "base58-wif-shape" };
  }
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) {
    return { ok: false, reason: "github-token-shape" };
  }
  if (/(pat|token|wif|password)\s*[:=]\s*\S{16,}/i.test(text)) {
    return { ok: false, reason: "secret-assignment-shape" };
  }
  return { ok: true };
}

function readPat(): string | null {
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    return t.length > 20 ? t : null;
  } catch {
    return null;
  }
}

async function canonPush(path: string, content: string): Promise<boolean> {
  const gate = secretsGate(content);
  if (!gate.ok) {
    state.canonLast = { at: new Date().toISOString(), ok: false, path: `${path} (BLOCKED: ${gate.reason})` };
    return false;
  }
  const pat = readPat();
  if (!pat) return false;
  const url = `https://api.github.com/repos/roshpinacare-sys/Defi/contents/${path}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "money-mover-daemon",
  };
  try {
    let sha: string | undefined;
    const cur = await fetch(url, { headers });
    if (cur.ok) {
      const j = await cur.json();
      sha = j.sha;
    }
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `money-mover: reprice receipt ${new Date().toISOString()}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
    const ok = res.ok;
    state.canonLast = { at: new Date().toISOString(), ok, path };
    return ok;
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path };
    return false;
  }
}

// ── החלטה ───────────────────────────────────────────────────────────
async function decide(meas: any): Promise<{ act: boolean; reason: string }> {
  const now = new Date();
  // day roll
  if (state.actionDay !== utcDay(now)) {
    state.actionDay = utcDay(now);
    state.actionsToday = 0;
  }
  // צינון
  if (state.lastActionAt) {
    const sinceMin = (now.getTime() - new Date(state.lastActionAt).getTime()) / 60_000;
    if (sinceMin < POLICY.cooldownMin) {
      return { act: false, reason: `WAIT-COOLDOWN · עוד ${Math.ceil(POLICY.cooldownMin - sinceMin)} דק'` };
    }
  }
  // תקציב
  if (state.actionsToday >= POLICY.actionsBudgetPerDay) {
    return { act: false, reason: "WAIT-BUDGET · 12/12 פעולות היום — התקציב נאכל" };
  }
  // טריגר: נזיל
  const idle = Number(meas?.idleSteem ?? 0);
  if (idle >= POLICY.triggers.idleTriggerSteem) {
    return { act: true, reason: `נזיל ${idle.toFixed(3)} STEEM יושב מחוץ לסולם — נפרס לעבודה (חוק 2)` };
  }
  // טריגר: סטיית פאריטה מהמדרגה שהוצבה
  const parity = Number(meas?.marks?.parity);
  const ladder: Array<{ level: number; premiumBps: number; price: number }> = meas?.ladder ?? [];
  if (typeof parity === "number" && parity > 0 && ladder.length > 0) {
    const base = ladder.find((l) => l.level === 1)?.price ?? ladder[0]?.price;
    if (base > 0) {
      const driftBps = Math.round(((parity - base) / base) * 10_000);
      if (Math.abs(driftBps) > POLICY.triggers.parityDriftBps) {
        return {
          act: true,
          reason: `הפאריטה זזה ${driftBps > 0 ? "+" : ""}${driftBps}bps מהסולם שהוצב — הסולם נגרר אליה (חוק 3)`,
        };
      }
    }
  }
  // שקט כנה
  return { act: false, reason: "הסולם על הקו — אין פעולה נדרשת" };
}

async function measure(): Promise<any | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${API}?fresh=1`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function act(reason: string): Promise<void> {
  state.acting = true;
  state.lastDecision = { at: new Date().toISOString(), kind: "ACTING", detail: reason };
  saveState();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180_000); // פעולת-כסף: חלון רחב (3 דק'), שידור Steem איטי
  let result: Record<string, unknown> = {};
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reprice", reason }),
      signal: ctl.signal,
    });
    result = (await res.json()) as Record<string, unknown>;
  } catch (e: any) {
    result = { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
  state.actionsToday += 1;
  state.lastActionAt = new Date().toISOString();
  state.acting = false;
  const placed = (result as any)?.placed ?? [];
  state.lastDecision = {
    at: new Date().toISOString(),
    kind: (result as any)?.ok ? "REPRICE" : "REPRICE-FAIL",
    detail:
      (result as any)?.ok
        ? `הוצבו ${Array.isArray(placed) ? placed.length : 0} · ${reason}`
        : `כישלון כנה: ${String((result as any)?.error ?? "לא ידוע").slice(0, 120)}`,
  };
  saveState();
  appendHistory({
    kind: state.lastDecision.kind,
    reason,
    parity: (result as any)?.parity,
    placed,
    cancelled: (result as any)?.cancelled,
    error: (result as any)?.error ?? null,
  });
  // קבלה לקנון אחרי כל פעולה (שער-סודות בפנים)
  const placedN = Array.isArray(placed) ? placed.length : 0;
  const receipt = [
    `# קבלת מוביל-הכסף · ${new Date().toISOString()}`,
    "",
    `- **סיבה**: ${reason}`,
    `- **תוצאה**: ${state.lastDecision.kind} · הוצבו ${placedN}`,
    `- **פאריטה בזמן הפעולה**: ${(result as any)?.parity ?? "לא נמדד"}`,
    `- **פעולות היום**: ${state.actionsToday}/${POLICY.actionsBudgetPerDay}`,
    `- **כנות**: ${(result as any)?.error ? `שגיאה: ${String((result as any).error).slice(0, 200)}` : "אין"}`,
    "",
    `_מופק אוטונומית על-ידי money-mover v1.1 (R90 rebuild)._`,
  ].join("\n");
  await canonPush(`reports/money-${utcDay()}.md`, receipt);
}

let ticking = false;
async function tick() {
  if (ticking || state.acting) return; // לולאה-יחידה (לקח R80)
  ticking = true;
  try {
    state.beats += 1;
    const meas = await measure();
    // שער שלמות-מדידה (R90): balances.steem === null → RPC נכשל → אין אמת, אין פעולה.
    // לעולם לא מפרשים "לא נמדד" כ"0 נזיל" — כסף לא זז על נתוני-רפא.
    if (!meas || meas?.balances?.steem == null) {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "HONEST-FAIL",
        detail: "מדידה חיה נכשלה — לא מתיירים, לא פועלים על נתוני אתמול",
      };
      saveState();
      return;
    }
    const d = await decide(meas);
    if (d.act) {
      await act(d.reason);
    } else {
      state.lastDecision = { at: new Date().toISOString(), kind: d.reason.startsWith("WAIT") ? d.reason.split(" ·")[0] : "HOLD", detail: d.reason };
      saveState();
    }
  } catch (e: any) {
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) };
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות (השומר קורא את זה כל 30ש') ─────────────────────────
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
    }
    if (url.pathname === "/act" && req.method === "POST") {
      // פקודת-מפעיל ידנית (דרך שער המפעיל) — אותה פעולה, אותו חוק
      if (state.acting) return Response.json({ ok: false, error: "already-acting" }, { status: 409 });
      const body = await req.json().catch(() => ({}));
      await act(String(body?.reason ?? "manual operator command").slice(0, 200));
      return Response.json({ ok: true, lastDecision: state.lastDecision });
    }
    return new Response("not found", { status: 404 });
  },
});

saveState();
console.log(`[money-mover] חי על פורט ${PORT} · beats=${state.beats} · actionsToday=${state.actionsToday}`);
tick();
setInterval(tick, CHECK_INTERVAL_SEC * 1000);
