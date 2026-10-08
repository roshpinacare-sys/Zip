// ─────────────────────────────────────────────────────────────────────────────
// /api/office/stream — זרם-המשרד החי (SSE · Task 13 · תבנית-agentcraft)
//
// חיבור-אחד במקום N-מדידות: hello→snapshot → tick-כל-10ש'.
// תוכן-הסנאפשוט: הצי (דיבונים) · השומר · תחרות-top3 · שער-הכסף · מלגה.
// tick-מצטמצם: רק-מה שהשתנה מאז-הסנאפשוט (beats · lastBeat · watchdog-round).
// כנות: כל-קריאה-fail-closed — מה-שנכשל מדווח-כשגוי, לא-נבלע-כריק.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const COMP_DIR = "/home/z/my-project/zip/sovereign/competition";
const WATCHDOG_STATE = "/home/z/fleet-tmp/logs/watchdog-state.json";

async function gather() {
  const at = new Date().toISOString();
  const out: Record<string, unknown> = { at };

  // צי (דרך-הקצה החי — מנתב-ה-:3000 משרת-את-ה-API-של-הקונסולה)
  try {
    const r = await fetch("http://127.0.0.1:3000/api/fleet", { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const j = await r.json();
    const d = j?.layers?.daemons;
    out.fleet = d ? { up: d.up, total: d.total } : { up: 0, total: 0, error: "no-layers" };
  } catch { out.fleet = { up: 0, total: 0, error: "fleet-unreachable" }; }

  // שומר
  try { out.watchdog = JSON.parse(fs.readFileSync(WATCHDOG_STATE, "utf8")); } catch { out.watchdog = null; }

  // תחרות (top3 + beats — הקצב-המדוד)
  try {
    const s = JSON.parse(fs.readFileSync(`${COMP_DIR}/state.json`, "utf8"));
    out.competition = {
      beats: s.beats ?? 0, lastBeat: s.lastBeat ?? null, epoch: s.epoch ?? null,
      top3: (s.leaderboard ?? []).slice(0, 3).map((b: { account: string; agent: string; points: number }) => ({ account: b.account, agent: b.agent, points: b.points })),
    };
  } catch { out.competition = null; }

  // שער-הכסף — תור
  try {
    const queued = await db.txGate.count({ where: { verdict: "QUEUED" } });
    out.gate = { queued };
  } catch { out.gate = { queued: null, error: "gate-unreadable" }; }

  // מלגה-אחרונה
  try {
    const l = fs.readFileSync(`${COMP_DIR}/rewards-ledger.jsonl`, "utf8").split("\n").filter(Boolean);
    out.scholarship = l.length ? JSON.parse(l[l.length - 1]) : null;
  } catch { out.scholarship = null; }

  return out;
}

export async function GET() {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      // hello + snapshot
      send("hello", { law: "זרם-המשרד החי — חיבור-אחד במקום N-מדידות", intervalMs: 10_000 });
      const snap = await gather();
      send("snapshot", snap);
      let lastBeat = (snap.competition as { lastBeat?: string } | null)?.lastBeat ?? null;
      let lastRound = (snap.watchdog as { lastRound?: string } | null)?.lastRound ?? null;

      // tick-כל-10ש' — מצטמצם: רק-שינויים
      timer = setInterval(async () => {
        if (closed) { if (timer) clearInterval(timer); return; }
        try {
          const g = await gather();
          const beat = (g.competition as { lastBeat?: string } | null)?.lastBeat ?? null;
          const round = (g.watchdog as { lastRound?: string } | null)?.lastRound ?? null;
          const beatChanged = beat !== lastBeat;
          const roundChanged = round !== lastRound;
          const tick: Record<string, unknown> = { at: g.at, fleet: g.fleet, gate: g.gate, changed: beatChanged || roundChanged };
          if (beatChanged) { tick.competition = g.competition; lastBeat = beat; }
          if (roundChanged) { tick.watchdog = g.watchdog; lastRound = round; }
          send("tick", tick);
        } catch (e) {
          send("tick", { error: String((e as Error).message ?? e).slice(0, 120), at: new Date().toISOString() });
        }
      }, 10_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
