// ─────────────────────────────────────────────────────────────────────
// /api/admin/cloud — מלאי הענן: 14 הריפואים, ריצות אחרונות לכל מאגר
// פעיל, ורשימת הסוכנים שניתן להזניק ידנית. ה-PAT נשאר צד-שרת.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getRepos, getRecentRuns, DISPATCHABLE, getGhToken } from "@/lib/live/cloud";

export const dynamic = "force-dynamic";

const ACTIVE_REPOS = ["Zip", "steem", "saos-dex", "Console", "saos-sovereign-foundry"];

export async function GET() {
  try {
    const hasToken = (await getGhToken()) !== null;
    const [repos, runsEntries] = await Promise.all([
      getRepos(),
      Promise.all(
        ACTIVE_REPOS.map(async (repo) => [repo, await getRecentRuns(repo, 4).catch(() => [])] as const)
      ),
    ]);
    const runs: Record<string, Awaited<ReturnType<typeof getRecentRuns>>> =
      Object.fromEntries(runsEntries);

    return NextResponse.json({
      ok: true,
      repos: repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)),
      runs,
      dispatchable: DISPATCHABLE,
      canDispatch: hasToken,
      servedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `לא ניתן לקרוא את הענן: ${err.message}`
            : "לא ניתן לקרוא את הענן — נסה שוב",
      },
      { status: 502 }
    );
  }
}
