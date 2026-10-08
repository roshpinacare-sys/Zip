// ─────────────────────────────────────────────────────────────────────
// /api/competition — תחרות-הסוכנים הריבונית (חיילים-חיים על השרשרת)
// קורא sovereign/competition/state.json + registry.json — מדידה בלבד,
// הניקוד נגזר מרווחים on-chain אמיתיים (author/curation/pending).
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  const dir = path.join(process.cwd(), "sovereign", "competition");
  try {
    const [stateRaw, registryRaw] = await Promise.all([
      readFile(path.join(dir, "state.json"), "utf8"),
      readFile(path.join(dir, "registry.json"), "utf8"),
    ]);
    const state = JSON.parse(stateRaw);
    const registry = JSON.parse(registryRaw);
    const serveMs = Date.now() - t0;
    // Task 12 — מלגות-האוצר האוטונומיות: קריאת-ה-ledger (5-האחרונות) — כנות מלאה
    let scholarships: Array<Record<string, unknown>> = [];
    try {
      const ledgerRaw = await readFile(path.join(dir, "rewards-ledger.jsonl"), "utf8");
      scholarships = ledgerRaw.split("\n").filter(Boolean).slice(-5).map((l) => JSON.parse(l));
    } catch { /* אין-מלגות-עדיין — כנה וריק */ }
    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        serveMs,
        law: registry.law ?? null,
        epoch: state.epoch ?? null,
        beats: state.beats ?? 0,
        lastBeat: state.lastBeat ?? null,
        prices: state.prices ?? null,
        dayPoints: state.dayPoints ?? {},
        history: (state.history ?? []).slice(-14),
        leaderboard: state.leaderboard ?? [],
        roster: registry.roster ?? [],
        rewards: registry.rewards ?? null,
        scholarships,
      },
      { headers: { "X-SAOS-Serve-Ms": String(serveMs) } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "competition-state-unavailable", detail: String(e).slice(0, 120) },
      { status: 200 }
    );
  }
}
