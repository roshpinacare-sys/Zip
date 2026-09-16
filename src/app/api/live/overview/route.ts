// ─────────────────────────────────────────────────────────────────────
// /api/live/overview — התמונה החיה מהענן: ספר + עד שרשרת + רישום סוכנים.
// מקור: המראה הציבורית (Console repo) — נגזרת אמת ללא סודות.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import {
  getMirror,
  getChainStatus,
  getAgentsRegistry,
  getAgentState,
  getAgentRequests,
  getVerifyResults,
  computeVitalityFromMirror,
} from "@/lib/live/cloud";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [mirror, chain, registry, agentState, agentRequests, verify] = await Promise.all([
      getMirror(),
      getChainStatus().catch(() => null),
      getAgentsRegistry().catch(() => null),
      getAgentState().catch(() => null),
      getAgentRequests().catch(() => null),
      getVerifyResults().catch(() => null),
    ]);
    const vitality = computeVitalityFromMirror(mirror);

    return NextResponse.json({
      ok: true,
      live: {
        source: "cloud-mirror",
        mirrorGeneratedAt: mirror.generatedAt,
        stats: mirror.stats,
        vitality,
        freshness: chain?.freshness ?? null,
        witness: chain?.witness ?? null,
        brain: mirror.brain,
        anchorLines: {
          steem: mirror.anchorLines.steem?.length ?? 0,
          zero: mirror.anchorLines.zero?.length ?? 0,
        },
        marketEvents: mirror.market.slice(0, 10),
        agents: mirror.agents,
        recentAttestations: mirror.attestations.slice(0, 8),
        lastCheckpoint: mirror.checkpoints[0] ?? null,
        loop: {
          coverage: registry
            ? {
                withAgents: registry.reposWithAgents.length,
                total: registry.reposTotal,
                idle: registry.reposIdle.length,
                agents: registry.agents.length,
              }
            : null,
          requests: agentRequests
            ? {
                delivered: agentRequests.requests.filter((r) =>
                  String(r.status ?? "").startsWith("delivered")
                ).length,
                total: agentRequests.requests.length,
              }
            : null,
          standingOrders: agentState ? agentState.standingOrders.length : null,
          verify: verify ? verify.summary : null,
          checkpoints: mirror.stats.checkpoints,
        },
      },
      registry: registry
        ? {
            generatedAt: registry.generatedAt,
            reposTotal: registry.reposTotal,
            reposWithAgents: registry.reposWithAgents,
            reposIdle: registry.reposIdle,
            agents: registry.agents,
          }
        : null,
      servedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `הענן לא נענה: ${err.message}`
            : "הענן לא נענה — נסה שוב",
      },
      { status: 502 }
    );
  }
}
