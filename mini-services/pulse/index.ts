// ─────────────────────────────────────────────────────────────────────
// PULSE — הדופק · שידור יומי לשרשרת (R8x, rebuilt R90)
//
// החוזה: פוסט-אמת אחד לכל יום-UTC (מקסימום 1), מתוך 3 טיוטות מסתובבות
// שנולדות מנתונים חיים ברגע-התיירה. המוח חי ב-/api/publish — הדיבון
// הוא לב-פעימה: מחליט מתי החלון נפתח ומבצע enqueue→broadcast.
//
// חוקי-ברזל:
//   · מקסימום 1 פרסום/יום-UTC · עד 3 ניסיונות/יום (budget אמיתי)
//   · הטיוטה נולדת מנתונים חיים — לא מטקסט מוכן (דוקטרינת המדידה)
//   · כנות: broadcast שנכשל נרשם כניסיון שנשחק, לא כ"נניח שהצליח"
//   · קבלה לקנון אחרי פרסום מוצלח, אחרי שער-סודות
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/pulse/state.json`;
const PORT = 3033;
const CHECK_INTERVAL_SEC = 30;
const PUBLISH_API = "http://127.0.0.1:3000/api/publish";

const POLICY = {
  maxPerUtcDay: 1,
  rotation: ["draft-truth-he", "draft-liquidity-he", "draft-truth-en"] as const,
  attemptsBudget: 3,
  truthSource: "api.steemit.com · last_root_post",
};

type Decision = { at: string; kind: string; detail: string };

type PulseState = {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  checkIntervalSec: number;
  policy: typeof POLICY;
  lastPublishUtcDay: string | null;
  nextDueAt: string;
  attemptsToday: number;
  broadcasting: boolean;
  lastDecision: Decision | null;
  canonLast: { at: string; ok: boolean; path: string } | null;
  historyTail: Array<Record<string, unknown>>;
};

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnight(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

function readState(): PulseState {
  const base: PulseState = {
    service: "pulse",
    version: "1.1.0",
    bootedAt: new Date().toISOString(),
    beats: 0,
    checkIntervalSec: CHECK_INTERVAL_SEC,
    policy: POLICY,
    lastPublishUtcDay: null,
    nextDueAt: nextUtcMidnight(),
    attemptsToday: 0,
    broadcasting: false,
    lastDecision: null,
    canonLast: null,
    historyTail: [],
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.lastPublishUtcDay === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      lastPublishUtcDay: prev.lastPublishUtcDay ?? null,
      nextDueAt: prev.nextDueAt ?? nextUtcMidnight(),
      attemptsToday: sameDay ? (prev.attemptsToday ?? 0) : 0,
      historyTail: Array.isArray(prev.historyTail) ? prev.historyTail.slice(-20) : [],
      canonLast: prev.canonLast ?? null,
    };
  } catch {
    return base;
  }
}

let state: PulseState = readState();

function saveState() {
  fs.mkdirSync(`${HOME}/sovereign/pulse`, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── שער-סודות לקנון ────────────────────────────────────────────────
function secretsGate(text: string): { ok: boolean; reason?: string } {
  if (/[5JKLMNPQRSTUVWXYZ123456789]{50,52}/.test(text)) return { ok: false, reason: "base58-wif-shape" };
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) return { ok: false, reason: "github-token-shape" };
  if (/(pat|token|wif|password)\s*[:=]\s*\S{16,}/i.test(text)) return { ok: false, reason: "secret-assignment-shape" };
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
    "User-Agent": "pulse-daemon",
  };
  try {
    let sha: string | undefined;
    const cur = await fetch(url, { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `pulse: daily truth-report receipt ${new Date().toISOString()}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });
    state.canonLast = { at: new Date().toISOString(), ok: res.ok, path };
    return res.ok;
  } catch {
    state.canonLast = { at: new Date().toISOString(), ok: false, path };
    return false;
  }
}

// ── הפרסום: enqueue טיוטה חיה → broadcast לשרשרת ───────────────────
async function tryPublish(): Promise<void> {
  const day = utcDay();
  state.broadcasting = true;
  saveState();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    // 1) רענון המפעל — הטיוטות נולדות מנתונים חיים עכשיו
    const refresh = await fetch(PUBLISH_API, { signal: ctl.signal, cache: "no-store" });
    if (!refresh.ok) throw new Error(`refresh ${refresh.status}`);
    const st = await refresh.json();
    const drafts: Array<{ id: string; kind: string; lang: string; title: string; body?: string }> = st?.foundry?.drafts ?? [];
    if (!drafts.length) throw new Error("מפעל הטיוטות ריק — כנות, לא משדרים ריק");

    // 2) בחירת הטיוטה לפי סדר-הרוטציה (יום מודולו 3)
    const wanted = POLICY.rotation[Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % POLICY.rotation.length];
    const draft = drafts.find((d) => d.id === wanted) ?? drafts[0];

    // 3) enqueue
    const enq = await fetch(PUBLISH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enqueue", draftId: draft.id }),
      signal: ctl.signal,
    });
    const enqJ: any = await enq.json();
    if (!enq.ok || !enqJ?.ok) throw new Error(String(enqJ?.error ?? `enqueue ${enq.status}`));
    const taskId = enqJ.task?.id as string;

    // 4) broadcast → השרשרת
    const bc = await fetch(PUBLISH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "broadcast", id: taskId }),
      signal: ctl.signal,
    });
    const bcJ: any = await bc.json();
    if (!bc.ok || !bcJ?.ok) throw new Error(String(bcJ?.error ?? `broadcast ${bc.status}`));

    // 5) הצלחה — רישום וקבלה
    const entry = {
      at: new Date().toISOString(),
      utcDay: day,
      draftId: draft.id,
      kind: draft.kind?.toUpperCase() ?? "TRUTH-REPORT",
      title: draft.title,
      permlink: bcJ.post?.permlink ?? null,
      txid: bcJ.post?.txid ?? null,
      url: bcJ.post?.url ?? null,
      attempt: state.attemptsToday + 1,
    };
    state.lastPublishUtcDay = day;
    state.attemptsToday = 0; // הצלחה מאפסת את מונה הניסיונות של היום
    state.nextDueAt = nextUtcMidnight();
    state.historyTail = [...state.historyTail, entry].slice(-20);
    state.lastDecision = { at: entry.at, kind: "TRUTH-REPORT", detail: `שודר: ${entry.title} → ${entry.url ?? entry.permlink}` };
    saveState();
    const receipt = [
      `# קבלת דופק · ${entry.at}`,
      "",
      `- **טיוטה**: ${entry.draftId} (${entry.kind})`,
      `- **כותרת**: ${entry.title}`,
      `- **שרשרת**: txid \`${entry.txid}\``,
      `- **קישור**: ${entry.url}`,
      "",
      `_מופק אוטונומית על-ידי pulse v1.1 (R90 rebuild)._`,
    ].join("\n");
    await canonPush(`reports/pulse-${day}.md`, receipt);
  } catch (e: any) {
    state.attemptsToday += 1;
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "PUBLISH-FAIL",
      detail: `ניסיון ${state.attemptsToday}/${POLICY.attemptsBudget} נכשל בכנות: ${String(e?.message ?? e).slice(0, 140)}`,
    };
    saveState();
  } finally {
    clearTimeout(timer);
    state.broadcasting = false;
    saveState();
  }
}

let ticking = false;
async function tick() {
  if (ticking || state.broadcasting) return; // לולאה-יחידה
  ticking = true;
  try {
    state.beats += 1;
    const day = utcDay();
    const windowOpen = state.lastPublishUtcDay !== day;
    if (windowOpen && state.attemptsToday < POLICY.attemptsBudget) {
      await tryPublish();
    } else if (windowOpen) {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "WAIT-BUDGET",
        detail: `3/3 ניסיונות נשחקו היום — החלון ייפתח מחר (כנות, לא מתיירים)`,
      };
    } else {
      state.lastDecision = {
        at: new Date().toISOString(),
        kind: "WAIT",
        detail: `ממתין לחלון הבא (${state.nextDueAt.slice(0, 10)}) · ניסיונות היום ${state.attemptsToday}/${POLICY.attemptsBudget}`,
      };
    }
    saveState();
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
console.log(`[pulse] חי על פורט ${PORT} · beats=${state.beats} · פורסם לאחרונה: ${state.lastPublishUtcDay ?? "מעולם"}`);
tick();
setInterval(tick, CHECK_INTERVAL_SEC * 1000);
