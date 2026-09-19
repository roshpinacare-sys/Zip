// /api/domains/[id] — עדכון סטטוס / מחיקת דומיין מהרישום.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["PLANNED", "DNS", "DEPLOYING", "LIVE"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let data: { status?: string; notes?: string; purpose?: string } = {};
  try {
    const body = (await req.json()) as {
      status?: unknown;
      notes?: unknown;
      purpose?: unknown;
    };
    if (typeof body?.status === "string") {
      if (!STATUSES.has(body.status)) {
        return NextResponse.json(
          { ok: false, error: "סטטוס לא מוכר" },
          { status: 400 },
        );
      }
      data.status = body.status;
    }
    if (typeof body?.notes === "string") data.notes = body.notes.slice(0, 500);
    if (typeof body?.purpose === "string")
      data.purpose = body.purpose.slice(0, 300);
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }
  try {
    const updated = await db.sovereignDomain.update({ where: { id }, data });
    return NextResponse.json({ ok: true, domain: updated });
  } catch {
    return NextResponse.json(
      { ok: false, error: "הדומיין לא נמצא" },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await db.sovereignDomain.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "הדומיין לא נמצא" },
      { status: 404 },
    );
  }
}
