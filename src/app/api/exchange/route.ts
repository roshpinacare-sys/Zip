// ─────────────────────────────────────────────────────────────────────
// /api/exchange — זירת-המסחר הריבונית (R102)
//
// GET  — תמונת-זירה חיה: בריכות, רזרבת-USDS, חברים, ספר, דלת-ההפקדות.
// POST — פעולות החברים: swap | usds-mint | usds-burn | withdraw |
//        deposit-scan | quote — הכל דרך החוקים (שער-$100, hash-chain,
//        קבלה-כנה, אימות-סמכות ביט-מול-ביט בכל שידור).
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  ensureExchange, exchangeSnapshot, quoteSwap, swap,
  usdsMint, usdsBurn, withdraw, depositScan,
  type ExchangeAsset,
} from "@/lib/weave/sovereign-exchange";
import { operatorFromRequest } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("with") === "quote") {
    const pair = url.searchParams.get("pair") ?? "";
    const side = (url.searchParams.get("side") === "B2A" ? "B2A" : "A2B") as "A2B" | "B2A";
    const amountIn = Number(url.searchParams.get("amountIn") ?? "0");
    const q = await quoteSwap(pair, side, amountIn);
    if (!("expectedOut" in q)) return NextResponse.json({ ...q }, { status: 400 });
    return NextResponse.json({ quote: q });
  }
  const snap = await exchangeSnapshot();
  return NextResponse.json(snap);
}

export async function POST(req: NextRequest) {
  const at = new Date().toISOString();
  try {
    const body = (await req.json()) as {
      action?: string;
      member?: string;
      pair?: string;
      side?: "A2B" | "B2A";
      amountIn?: number;
      minOut?: number;
      asset?: ExchangeAsset;
      stable?: "WSBD" | "WHBD";
      amount?: number;
      toAccount?: string;
    };
    await ensureExchange();
    const session = operatorFromRequest(req);
    const issuedBy: "operator" | "daemon" = session ? "operator" : "daemon";
    // המפעיל פועל כראש-הזירה; פעולות של חברים אחרים מחייבות סשן-מפעיל
    // (חברות-ציבור עוברת דרך דלת-ההפקדות החיה — ההיסטוריה מזהה אותם)
    const member = session ? (body.member ?? "operator") : "treasury";

    switch (body.action) {
      case "quote": {
        const q = await quoteSwap(String(body.pair), body.side === "B2A" ? "B2A" : "A2B", Number(body.amountIn ?? 0));
        if (!("expectedOut" in q)) return NextResponse.json({ ...q, at }, { status: 400 });
        return NextResponse.json({ quote: q, at });
      }
      case "swap": {
        const r = await swap({
          member,
          pair: String(body.pair),
          side: body.side === "B2A" ? "B2A" : "A2B",
          amountIn: Number(body.amountIn ?? 0),
          minOut: body.minOut != null ? Number(body.minOut) : 0,
        });
        return NextResponse.json({ ...r, at });
      }
      case "usds-mint": {
        const stable = body.stable === "WHBD" ? "WHBD" : "WSBD";
        const r = await usdsMint(member, stable, Number(body.amount ?? 0));
        return NextResponse.json({ ...r, at });
      }
      case "usds-burn": {
        const stable = body.stable === "WHBD" ? "WHBD" : "WSBD";
        const r = await usdsBurn(member, stable, Number(body.amount ?? 0));
        return NextResponse.json({ ...r, at });
      }
      case "withdraw": {
        const r = await withdraw({
          member,
          asset: String(body.asset) as ExchangeAsset,
          amount: Number(body.amount ?? 0),
          toAccount: String(body.toAccount ?? ""),
          issuedBy,
        });
        return NextResponse.json({ ...r, at });
      }
      case "deposit-scan": {
        const r = await depositScan();
        return NextResponse.json({ ...r, at });
      }
      default:
        return NextResponse.json({ ok: false, at, error: "BAD-ACTION" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, at, error: String((e as Error).message ?? e).slice(0, 160) }, { status: 400 });
  }
}
