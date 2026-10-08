// ─────────────────────────────────────────────────────────────────────────────
// /api/decisions — תחנת-ההחלטות המאוחדת (DecisionQueue-Podium · Task 13)
//
// דבר-המפעיל: "הכל מנוהל על-ידי האוטונומיה" — אבל אוטונומיה בלי-פודיום-אחת
// = החלטות-פזורות-בחושך. הפודיום = מקור-אמת-אחד לכל-החלטה בצי:
//
//   · queued     — מה ממתין-למפעיל (TxGate QUEUED — כסף-חיצוני מעל-100$)
//   · autonomous — מה האוטונומיה החליטה-וביצעה לבד (מלגות · ריפויים · הצבעות)
//   · gated      — מה השער סירב-לו (אודות-החוק)
//   · defers     — מה נדחה-בכנות (WEDGED/BUILD-MISSING מהשומר)
//   · law        — חוק-פיצול-המטבע (חיצוני=GATED · פנימי=אוטונומי)
//
// קריאה-בלבד — הפודיום אינו-שער; הוא התצפית על-השערים.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import fs from "node:fs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const WATCHDOG_STATE = "/home/z/fleet-tmp/logs/watchdog-state.json";
const WATCHDOG_LOG = "/home/z/fleet-tmp/logs/watchdog.log";
const COMP_DIR = "/home/z/my-project/zip/sovereign/competition";

function readJsonlTail(file: string, n: number): Array<Record<string, unknown>> {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l));
  } catch { return []; }
}

export async function GET() {
  const at = new Date().toISOString();
  try {
    // 1) שער-הכסף (TxGate) — תור-המפעיל + היסטוריה
    const [queued, recentGates] = await Promise.all([
      db.txGate.findMany({ where: { verdict: "QUEUED" }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.txGate.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    ]);
    const refused24h = recentGates.filter(
      (g) => g.verdict === "REFUSED" && Date.now() - g.createdAt.getTime() < 86_400_000,
    ).length;

    // 2) האוטונומיה — מה בוצע-לבד (מלגות + ריפויי-שומר + הצבעות)
    const scholarships = readJsonlTail(`${COMP_DIR}/rewards-ledger.jsonl`, 5);
    const watchdogState = (() => {
      try { return JSON.parse(fs.readFileSync(WATCHDOG_STATE, "utf8")); } catch { return null; }
    })() as { revives?: Record<string, number>; lastRound?: string; lastActions?: string[] } | null;
    const watchdogTail = (() => {
      try { return fs.readFileSync(WATCHDOG_LOG, "utf8").split("\n").filter(Boolean).slice(-6); } catch { return []; }
    })();

    // 3) הצבעות-החיילים (החלטות-אוטונומיות על-השרשרת)
    const votes = readJsonlTail(`${COMP_DIR}/soldier-votes.jsonl`, 5);

    const autonomous = [
      ...scholarships.map((s) => ({
        kind: "scholarship", at: String(s.at ?? ""), detail: `מלגת-אוצר ${s.week} — ${s.total} SAOS (${(s.payouts as Array<{ member: string; amount: number }>)?.map((p) => `${p.member}:${p.amount}`).join(", ")})`,
      })),
      ...Object.entries(watchdogState?.revives ?? {}).map(([name, n]) => ({
        kind: "self-heal", at: watchdogState?.lastRound ?? at, detail: `${name} — רופא ${n}× ע"י-השומר`,
      })),
      ...votes.map((v) => ({
        kind: "soldier-vote", at: String(v.at ?? ""), detail: `${v.voter} → ${v.author} (${v.chain ?? ""})`,
      })),
    ].sort((x, y) => String(y.at ?? "").localeCompare(String(x.at ?? ""))).slice(0, 20);

    const defers = watchdogState?.lastActions?.filter((a) => /WEDGED|BUILD-MISSING|MISSING/.test(a)) ?? [];

    return NextResponse.json({
      ok: true, at,
      law: "פיצול-מטבע: חיצוני=GATED (שער-המפעיל, 100$+) · פנימי=אוטונומי (תקרות-קשיחות בשרת)",
      podium: {
        queued: queued.map((q) => ({ id: q.id, title: q.title, usdValue: q.usdValue, source: q.source, action: q.action, at: q.createdAt })),
        autonomous,
        gated: { refused24h, recent: recentGates.slice(0, 8).map((g) => ({ title: g.title, verdict: g.verdict, decidedBy: g.decidedBy, usdValue: g.usdValue, at: g.createdAt })) },
        defers,
      },
      counts: { queued: queued.length, autonomous: autonomous.length, refused24h },
      watchdog: { lastRound: watchdogState?.lastRound ?? null, tail: watchdogTail },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, at, error: String((e as Error).message ?? e).slice(0, 160) }, { status: 500 });
  }
}
