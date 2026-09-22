// ─────────────────────────────────────────────────────────────────────
// HUNTER — הצייד · סריקת הזדמנויות + קנרית שער-הדקות (R82, rebuilt R90)
//
// החוזה: סריקה כל 10 דק' (מוביל + אוצר) עם דוח-כנות, וקנרית אוטונומית
// כל 6 שעות שמנסה להעיר את שער-הדקות של הריפואים הפרטיים (dispatch
// canary.yml ב-Defi). כשהקנרית מצייצת — השער נפתח חזרה.
//
// חוקי-ברזל:
//   · סריקה שנכשלה נרשמת כ"לא נמדד" — אף פעם לא מזייפים מספר
//   · הקנרית לעולם לא שוכחת את המועד הבא (6ש' קדימה מהניסיון האחרון)
//   · הקנרית לא מפציצה: מקסימום 4 dispatch/יום (כל 6ש')
//   · קבלת הקנרית לקנון אחרי שער-סודות
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/hunter/state.json`;
const PORT = 3035;
const SCAN_INTERVAL_SEC = 600;
const CANARY_EVERY_MS = 6 * 60 * 60 * 1000;
const CANARY_REPO = "roshpinacare-sys/Defi";
const CANARY_WORKFLOW = "canary.yml";
const GH = "https://api.github.com";

type Decision = { at: string; kind: string; detail: string };

type HunterState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  scanIntervalSec: number;
  alive: boolean;
  scanning: boolean;
  lastScanAt: string | null;
  canary: {
    repo: string;
    workflow: string;
    lastDispatchAt: string | null;
    lastRun: Record<string, unknown> | null;
    lastSuccessAt: string | null;
    nextDueAt: string;
    dispatchesToday: number;
    day: string;
  };
  lastDecision: Decision | null;
  history: Array<Decision>;
  canonLast: { at: string; ok: boolean; path: string } | null;
  scansToday: number;
  scanDay: string;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readState(): HunterState {
  const base: HunterState = {
    service: "hunter",
    version: "1.1.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    scanIntervalSec: SCAN_INTERVAL_SEC,
    alive: true,
    scanning: false,
    lastScanAt: null,
    canary: {
      repo: CANARY_REPO,
      workflow: CANARY_WORKFLOW,
      lastDispatchAt: null,
      lastRun: null,
      lastSuccessAt: null,
      nextDueAt: new Date().toISOString(),
      dispatchesToday: 0,
      day: utcDay(),
    },
    lastDecision: null,
    history: [],
    canonLast: null,
    scansToday: 0,
    scanDay: utcDay(),
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.canary?.day === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastScanAt: prev.lastScanAt ?? null,
      canary: {
        ...base.canary,
        ...prev.canary,
        // המשכיות: nextDueAt תמיד נשמר — הקנרית הבאה בדיוק 6ש' אחרי האחרונה
        nextDueAt: prev.canary?.nextDueAt ?? new Date().toISOString(),
        dispatchesToday: sameDay ? (prev.canary?.dispatchesToday ?? 0) : 0,
        day: sameDay ? prev.canary.day : utcDay(),
      },
      lastDecision: prev.lastDecision ?? null,
      history: Array.isArray(prev.history) ? prev.history.slice(-40) : [],
      canonLast: prev.canonLast ?? null,
      scansToday: prev.scanDay === utcDay() ? (prev.scansToday ?? 0) : 0,
      scanDay: prev.scanDay === utcDay() ? prev.scanDay : utcDay(),
    };
  } catch {
    return base;
  }
}

let state: HunterState = readState();

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/hunter`, { recursive: true });
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

// ── קנרית: הערת שער-הדקות ─────────────────────────────────────────
async function canaryTick(): Promise<void> {
  const pat = readPat();
  if (!pat) return;
  const now = Date.now();
  if (now < Date.parse(state.canary.nextDueAt)) return;
  if (state.canary.dispatchesToday >= 4) return; // תקציב יומי כנה

  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "hunter-daemon",
  };
  // dispatch
  try {
    const res = await fetch(`${GH}/repos/${CANARY_REPO}/actions/workflows/${CANARY_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status === 204 || res.ok) {
      state.canary.lastDispatchAt = new Date().toISOString();
      state.canary.dispatchesToday += 1;
    }
  } catch {
    // dispatch נכשל — הקנרית תנסה שוב בסריקה הבאה (nextDueAt לא זז)
  }
  // קריאת הריצה האחרונה (גם אם dispatch נכשל — עדיין מודדים את האמת)
  try {
    const runs = await fetch(`${GH}/repos/${CANARY_REPO}/actions/workflows/${CANARY_WORKFLOW}/runs?per_page=1`, { headers });
    if (runs.ok) {
      const j = await runs.json();
      const run = j?.workflow_runs?.[0];
      if (run) {
        state.canary.lastRun = {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          createdAt: run.created_at,
          url: run.html_url,
        };
        if (run.conclusion === "success") state.canary.lastSuccessAt = run.created_at;
      }
    }
  } catch {}
  // המועד הבא: 6ש' קדימה — תמיד, גם אם עכשיו נכשל
  state.canary.nextDueAt = new Date(now + CANARY_EVERY_MS).toISOString();
  state.canary.day = utcDay();
  saveState();
}

// ── ראיית-ענן: grid.json הציבורי כגיבוי כשה-RPC מהסנדבוקס נחסם ───────
// (לא מקור לפעולה — מקור לאמת-נראות בלבד. הפעולה דורשת מדידה ישירה טרייה.)
async function cloudEye(): Promise<string | null> {
  const pat = readPat();
  if (!pat) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(
      "https://api.github.com/repos/roshpinacare-sys/Console/contents/dex/grid.json",
      { headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "hunter-daemon" }, signal: ctl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const d = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
    if (!d?.ok) return null;
    const ageH = Math.max(0, (Date.now() - Date.parse(d.publishedAt)) / 3_600_000);
    return `ראיית-ענן אחרונה: ${d.openOrdersNow} פקודות פתוחות · ${d.verdict} · גיל ${Math.floor(ageH)}ש' (מדידת-Actions, לא-מקור-לפעולה)`;
  } catch {
    return null;
  }
}

// ── סריקת ההזדמנויות ──────────────────────────────────────────────
async function scan(): Promise<void> {
  state.scanning = true;
  saveState();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25_000);
    const [moneyRes, treasuryRes] = await Promise.all([
      fetch("http://127.0.0.1:3000/api/money", { signal: ctl.signal, cache: "no-store" }).catch(() => null),
      fetch("http://127.0.0.1:3000/api/treasury", { signal: ctl.signal, cache: "no-store" }).catch(() => null),
    ]);
    clearTimeout(t);
    const money = moneyRes?.ok ? await moneyRes.json().catch(() => null) : null;
    const treasury = treasuryRes?.ok ? await treasuryRes.json().catch(() => null) : null;

    // שער שלמות-מדידה (R90): balances.steem === null → ה-RPC נכשל — "לא נמדד", לא "0"
    const moverMeasured = money?.balances?.steem != null;
    const deployed = moverMeasured ? Number(money?.deployedSteem ?? 0) : null;
    const idle = moverMeasured ? Number(money?.idleSteem ?? 0) : null;
    const orders = moverMeasured && Array.isArray(money?.orders) ? money.orders : [];
    const ageH = orders.length
      ? Math.max(...orders.map((o: any) => (Date.now() - Date.parse(o.created ?? 0)) / 3_600_000))
      : 0;
    const totalUsd = Number(treasury?.usd?.total ?? 0);
    const liquidUsd = Number(treasury?.usd?.liquid ?? 0);
    let moverPart: string;
    if (moverMeasured) {
      moverPart = `מוביל: דלק ${deployed!.toFixed(3)} STEEM בסולם · נזיל ${idle!.toFixed(3)} · גיל פקודה ${Math.floor(ageH)}ש'`;
    } else {
      const eye = await cloudEye();
      moverPart = `מוביל: לא נמדד (כנות — RPC חסום מהסנדבוקס)${eye ? " · " + eye : ""}`;
    }
    const treasuryPart = totalUsd > 0 ? `אוצר: $${totalUsd.toFixed(0)} (${liquidUsd.toFixed(2)} נזיל)` : "אוצר: לא נמדד (כנות)";

    const detail = `${moverPart} · ${treasuryPart} · דופק: חי · הבא ${state.canary.nextDueAt}`;
    state.lastDecision = { at: new Date().toISOString(), kind: "SCAN", detail };
    state.history = [...state.history, state.lastDecision].slice(-40);
    state.lastScanAt = new Date().toISOString();
    state.scansToday += 1;
    state.scanDay = utcDay();
  } finally {
    state.scanning = false;
    saveState();
  }
}

let ticking = false;
async function tick() {
  if (ticking || state.scanning) return;
  ticking = true;
  try {
    state.beats += 1;
    await canaryTick();
    await scan();
  } catch (e: any) {
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: String(e?.message ?? e).slice(0, 160) };
    saveState();
  } finally {
    ticking = false;
  }
}

// ── שרת-בריאות ─────────────────────────────────────────────────────
Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return Response.json({ ...state, ok: true, alive: true, now: new Date().toISOString() });
    }
    return new Response("not found", { status: 404 });
  },
});

saveState();
console.log(`[hunter] חי על פורט ${PORT} · beats=${state.beats} · קנרית הבאה ${state.canary.nextDueAt}`);
tick();
setInterval(tick, SCAN_INTERVAL_SEC * 1000);
