// ─────────────────────────────────────────────────────────────────────
// /api/learning — חשיפת-לולאת-הלמידה (r205) לקונסולה
// state.json (פרמטרים-נגזרים) + tail של experience.jsonl (רשומות-ניסיון
// hash-chained: ניבוי מול תוצאה). קריאה-בלבד, אפס מפתחות.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile, open, stat } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const DIR = "/home/z/my-project/sovereign/learning";

async function tailJsonl(p: string, n: number): Promise<string[]> {
  try {
    const s = await stat(p);
    if (!s.isFile()) return [];
    const fh = await open(p, "r");
    const size = Math.min(s.size, 256 * 1024);
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, Math.max(0, s.size - size));
    await fh.close();
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export async function GET() {
  const t0 = Date.now();
  try {
    const [stateRaw, exp] = await Promise.all([
      readFile(path.join(DIR, "state.json"), "utf8").catch(() => null),
      tailJsonl(path.join(DIR, "experience.jsonl"), 40),
    ]);
    const state = stateRaw ? JSON.parse(stateRaw) : null;
    const experiences = exp
      .map((l) => {
        try {
          const o = JSON.parse(l);
          return {
            seq: o.seq,
            at: o.at,
            actor: o.actor,
            action: o.action,
            expected: o.prediction?.expected?.slice(0, 80) ?? null,
            outcome: o.outcome?.verdict ?? o.outcome?.result ?? null,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const serveMs = Date.now() - t0;
    return NextResponse.json(
      {
        ok: true,
        at: new Date().toISOString(),
        serveMs,
        suspended: state?.suspended ?? null,
        lastExperienceSeq: state?.lastExperienceSeq ?? null,
        params: state?.params ?? {},
        experiences,
        experienceCount: experiences.length,
      },
      { headers: { "X-SAOS-Serve-Ms": String(serveMs) } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "learning-unavailable", detail: String(e).slice(0, 120) },
      { status: 200 }
    );
  }
}
