// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/login — מקום-ההתחברות של המפעיל.
//
// מקבל { key } — WIF של ה-active (מתחיל ב-5/K/L, ~52 תווים) או סיסמת-אב
// של Steemit (ממנה נגזר ה-active לפי התקן). מאמת מול הסמכות החיצונית החיה
// של @headcorner בשרשרת, ומנפיק טוקן-סשן חתום ל-12 שעות.
//
// אבטחה: המפתח עצמו לא נשמר לשום מקום — לא דיסק, לא לוג, לא תשובה.
// מגבלת-קצב: 8 ניסיונות לשעה לכל IP.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import steemLibRaw from "steem";
import {
  OPERATOR_ACCOUNT,
  commanderActiveKey,
  issueToken,
} from "@/lib/operator-auth";

interface SteemAuth {
  auth: {
    wifToPublic(wif: string): string;
    toWif(account: string, password: string, role: string): string;
  };
}
const steemLib = steemLibRaw as unknown as SteemAuth;

export const dynamic = "force-dynamic";

// ── מגבלת-קצה זיכרונית ───────────────────────────────────────────────

const hits = new Map<string, number[]>();
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, stage: "rate-limit", reason: "יותר מדי ניסיונות — נסה שוב בעוד שעה" },
      { status: 429 },
    );
  }

  let key = "";
  try {
    const body = (await req.json()) as { key?: unknown };
    key = typeof body.key === "string" ? body.key.trim() : "";
  } catch {
    return NextResponse.json(
      { ok: false, stage: "body", reason: "גוף בקשה שגוי" },
      { status: 400 },
    );
  }
  if (!key || key.length < 8 || key.length > 120) {
    return NextResponse.json(
      {
        ok: false,
        stage: "format",
        reason: "הקלט קצר מדי או ארוך מדי. צפה WIF (52 תווים המתחיל ב-5/K/L) או סיסמת-אב.",
      },
      { status: 400 },
    );
  }

  // גזירת המפתח-הציבורי: WIF ישירות, אחרת ניסיון סיסמת-אב (תקן Steemit)
  let pub = "";
  const looksLikeWif = /^[5KL][1-9A-HJ-NP-Za-km-z]{39,59}$/.test(key);
  const attempts: Array<"wif" | "password"> = looksLikeWif ? ["wif"] : ["wif", "password"];
  for (const mode of attempts) {
    try {
      const wif = mode === "wif" ? key : steemLib.auth.toWif(OPERATOR_ACCOUNT, key, "active");
      pub = steemLib.auth.wifToPublic(wif);
      break;
    } catch {
      pub = "";
    }
  }
  if (!pub) {
    return NextResponse.json(
      {
        ok: false,
        stage: "derive",
        reason:
          "לא הצלחתי לגזור מפתח-ציבורי מהקלט (בדיקת checksum של WIF נכשלה). שום דבר לא נשמר.",
      },
      { status: 400 },
    );
  }

  // הסמכות החיצונית החיה מהשרשרת — ביט מול ביט
  let onChain = "";
  try {
    onChain = await commanderActiveKey();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        stage: "steem-rpc",
        reason: `קריאת השרשרת נכשלה: ${String((e as Error).message).slice(0, 60)}`,
      },
      { status: 502 },
    );
  }
  if (pub !== onChain) {
    return NextResponse.json(
      {
        ok: false,
        stage: "authority",
        reason: `המפתח שהוזן אינו ה-active של @${OPERATOR_ACCOUNT} כפי שרשום בשרשרת כרגע. שום דבר לא נשמר ושום דבר לא השתנה.`,
        publicKey: pub.slice(0, 12) + "…",
      },
      { status: 403 },
    );
  }

  // התאמה ← טוקן-סשן חתום. המפתח עצמו נשכח כאן ולצמיתות.
  const { token, exp } = issueToken(pub);
  return NextResponse.json({
    ok: true,
    stage: "connected",
    account: OPERATOR_ACCOUNT,
    publicKey: pub,
    token,
    expiresAt: new Date(exp).toISOString(),
    ttlHours: 12,
  });
}
