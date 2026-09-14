// GET /api/weave/attestations?limit=100 — ספר האימותים (desc לפי seq, עם פרטי הסוכן)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";
import { toAttestationDTO } from "@/lib/weave/ledger";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : 100;

    const [total, rows] = await Promise.all([
      db.attestation.count(),
      db.attestation.findMany({
        orderBy: { seq: "desc" },
        take: limit,
        include: { agent: true },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      total,
      entries: rows.map((row) => toAttestationDTO(row)),
    });
  } catch (error) {
    return jsonError(error);
  }
}
