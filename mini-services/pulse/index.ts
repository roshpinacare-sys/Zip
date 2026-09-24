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
//   · R91 — עוגן-הצ'רטרים: בדיקת סחף כל 5 דק׳; כשנבנה דבר חדש — הוא
//     מעוגן על Steem (דרך /api/charter/anchor) בלי לחכות לאף אחד
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/pulse/state.json`;
const PORT = 3033;
const CHECK_INTERVAL_SEC = 30;
const PUBLISH_API = "http://127.0.0.1:3000/api/publish";
const CHARTER_ANCHOR_API = "http://127.0.0.1:3000/api/charter/anchor";

const POLICY = {
  maxPerUtcDay: 1,
  rotation: ["draft-truth-he", "draft-liquidity-he", "draft-truth-en"] as const,
  attemptsBudget: 3,
  truthSource: "api.steemit.com · last_root_post",
  // R91 — עוגן-הצ'רטרים: בדיקת סחף כל 10 פעימות (5 דק׳) · תקציב 4/יום בדיבון
  charterCheckEveryBeats: 10,
  charterAnchorsPerDay: 4,
};

type Decision = { at: string; kind: string; detail: string };

type CharterAnchorState = {
  lastAnchorAt: string | null;
  anchorsToday: number;
  anchorDay: string;
  lastRoot: string | null;
  lastTxid: string | null;
  anchoring: boolean;
  lastDecision: Decision | null; // R91: החלטת הצ'רטר האחרונה — לא נדרסת ע"י ה-WAIT של הפרסום
};

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
  charter: CharterAnchorState;
};

function freshCharterState(): CharterAnchorState {
  return { lastAnchorAt: null, anchorsToday: 0, anchorDay: utcDay(), lastRoot: null, lastTxid: null, anchoring: false, lastDecision: null };
}

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
    version: "1.2.0",
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
    charter: freshCharterState(),
  };
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const sameDay = prev.lastPublishUtcDay === utcDay();
    const pc = prev.charter ?? {};
    const charterSameDay = pc.anchorDay === utcDay();
    return {
      ...base,
      beats: typeof prev.beats === "number" ? prev.beats : 0,
      charter: {
        lastAnchorAt: pc.lastAnchorAt ?? null,
        anchorsToday: charterSameDay ? (pc.anchorsToday ?? 0) : 0,
        anchorDay: utcDay(),
        lastRoot: pc.lastRoot ?? null,
        lastTxid: pc.lastTxid ?? null,
        anchoring: false, // הנפשה לעולם לא שורדת אתחול
        lastDecision: pc.lastDecision ?? null,
      },
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
    // R112 — law of the bounded wait: no fetch without a deadline (born from
    // the live money-mover freeze: an un-timeouted canonPush hung the whole
    // tick and the daemon died silently at beats=813 while HTTP kept answering)
    const cur = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (cur.ok) sha = (await cur.json()).sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `pulse: daily truth-report receipt ${new Date().toISOString()}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
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

// ── R91: עוגן-הצ'רטרים — רק כשיש סחף אמיתי ─────────────────────────
async function tryCharterAnchor(): Promise<void> {
  state.charter.anchoring = true;
  saveState();
  const ctl = new AbortController();
  // R92 (שיעור משידור חי): זרימת העיגון של השרת — שידור + אימות מההיסטוריה
  // המדופדפת — אורכת עד ~6 דקות; 180ש׳ גזרו "כשל" על עיגון שהצליח.
  const timer = setTimeout(() => ctl.abort(), 600_000);
  const setCharterDecision = (kind: string, detail: string) => {
    state.charter.lastDecision = { at: new Date().toISOString(), kind, detail };
  };
  try {
    // 1) מצב-אמת חי מהשרת — הסחף נמדד שם, לא כאן
    const st = await fetch(CHARTER_ANCHOR_API, { signal: ctl.signal, cache: "no-store" });
    const stJ: any = await st.json();
    if (!st.ok || !stJ?.ok) throw new Error(String(stJ?.error ?? `status ${st.status}`).slice(0, 120));
    const drift = stJ?.anchor?.drift ?? {};
    const newCount = Number(drift.newProjects ?? 0) + Number(drift.newEvents ?? 0);
    if (newCount === 0) {
      setCharterDecision("CHARTER-COVERED", `המרשם מכוסה — אין סחף מאז העיגון האחרון (שורש …${String(stJ?.anchor?.root ?? "?").slice(-8)})`);
      saveState();
      return;
    }

    // 2) תקציב הדיבון (השרת מאכף 8/יום; הדופק שומר 4/יום — שולי בטחון)
    if (state.charter.anchorsToday >= POLICY.charterAnchorsPerDay) {
      setCharterDecision("CHARTER-WAIT-BUDGET", `תקציב העיגון של הדופק מוצה (${state.charter.anchorsToday}/${POLICY.charterAnchorsPerDay}) — הסחף (${newCount}) יכוסה מחר או ידנית`);
      saveState();
      return;
    }

    // 3) העיגון עצמו — השרת שופט (דה-דופ · צינון · posting · היסטוריה)
    const res = await fetch(CHARTER_ANCHOR_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "anchor" }),
      signal: ctl.signal,
    });
    const j: any = await res.json();
    if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `anchor ${res.status}`).slice(0, 140));

    const r = j.result ?? {};
    state.charter.lastAnchorAt = new Date().toISOString();
    state.charter.lastRoot = r.root ?? null;
    state.charter.lastTxid = r.txid ?? null;
    if (r.status === "ATTESTED") {
      state.charter.anchorsToday += 1;
      setCharterDecision("CHARTER-ANCHORED", `עוגן חוץ: …${String(r.root ?? "?").slice(-8)} על ${r.projects} פרויקטים · txid ${r.txid} · att ${r.attSeq}`);
    } else {
      setCharterDecision("CHARTER-" + String(r.status ?? "SKIPPED"), String(r.reason ?? "דילוג כנה").slice(0, 140));
    }
    saveState();
  } catch (e: any) {
    // R92: timeout אינו כישלון — השידור יצא; השרת ממשיך לאמת מההיסטוריה
    // והבדיקה הבאה תראה את האמת (שורש מעוגן ⇒ COVERED). לקח R87 בשכבת הדיבון.
    if (e?.name === "AbortError") {
      setCharterDecision(
        "CHARTER-ANCHOR-WAIT",
        "העיגון יצא לדרך אך האישור מההיסטוריה חרג מהחלון — הבדיקה הבאה (5 דק׳) תגלה אם השורש מעוגן",
      );
    } else {
      setCharterDecision("CHARTER-ANCHOR-FAIL", `עיגון הצ'רטרים נכשל בכנות: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    saveState();
  } finally {
    clearTimeout(timer);
    state.charter.anchoring = false;
    saveState();
  }
}

let ticking = false;
async function tick() {
  if (ticking || state.broadcasting || state.charter.anchoring) return; // לולאה-יחידה
  ticking = true;
  try {
    state.beats += 1;
    const day = utcDay();

    // R91: בדיקת סחף-צ'רטרים כל 10 פעימות (5 דק׳) — לפני לוגיקת הפרסום.
    // ההחלטה נשמרת ב-charter.lastDecision — לא נדרסת ע"י ה-WAIT שלהלן.
    if (state.beats % POLICY.charterCheckEveryBeats === 0) {
      await tryCharterAnchor();
    }

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
        detail: `ממתין לחלון הבא (${state.nextDueAt.slice(0, 10)}) · ניסיונות היום ${state.attemptsToday}/${POLICY.attemptsBudget} · עיגוני צ'רטר ${state.charter.anchorsToday}/${POLICY.charterAnchorsPerDay}`,
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
// R112 — law of the single timer (R109/R111 lesson, applied to pulse):
// bun --hot re-evaluates the module but does NOT clear the old interval —
// every live edit would multiply the tick. The guard captures the previous
// timer and clears it.
const G = globalThis as unknown as { __PULSE_TIMER__?: ReturnType<typeof setInterval> };
if (G.__PULSE_TIMER__) clearInterval(G.__PULSE_TIMER__);
G.__PULSE_TIMER__ = setInterval(tick, CHECK_INTERVAL_SEC * 1000);
