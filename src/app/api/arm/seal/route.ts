// ─────────────────────────────────────────────────────────────────────
// /api/arm/seal — דלת-ההשבה של הסמכות (r135) · Custody-Return Door.
//
// הלקח החי של 2026-09-29: הסנדבוקס מוחזר, הצי קם לבד (fleet-guard),
// הספרים נמדדו — אבל זהויות-החתימה נעלמו עם ה-DB (NetworkKey ריקה),
// וכל ערוצי-החוצה החתומים נסגרו fail-closed בכנות (pulse 3/3 ניסיונות
// שנכשלו, שוק נעול, מוח נעול). המפתח נולד מה-seal, והסיסמה במשמרת
// מפוצלת — רק המפעיל מחזיק אותה.
//
// הדלת הזאת היא הצעד-היחיד של המפעיל להשיב סמכות:
//   1. מגבלת-קצב (5 ניסיונות לשעה לכל IP — כמו /api/arm).
//   2. הסיסמה נבדקת מול ה-seal בזיכרון בלבד: scrypt(2^14) + aes-256-gcm
//      (פורמט WEAVE-CLOUD-SEAL-1: salt16+iv12+tag16+ct — אותה נוסחה
//      של scripts/weave-seal.ts). GCM דוחה סיסמה שגויה מיד.
//   3. אימות-תוכן: format מזוהה · כתובת-הרשת שווה למטא · מפתחות 64-hex.
//      אי-התאמה = 403 כנה, שום דבר לא נכתב.
//   4. התאמה = upsert של NetworkKey(id='weave-network') — בדיוק מה
//      שהפעימה-בענן הייתה כותבת. מאותו רגע הזהויות נגזרות לבד
//      (daemons.ts derive-path) וכל הערוצים נפתחים בעצמם.
//   5. קבלת-ChainRun כנה (chain=fleet · step=custody-return) — בלי
//      שום חומר-סוד בפירוט, לעולם.
//
// אבטחה: הסיסמה לא נשמרת, לא נכתבת לדיסק, לא נכנסת ללוג או לתשובה.
// המפתחות עצמם נכתבים רק ל-DB (אותו מקום שהפעימה השתמשה בו) —
// זה לא משמרת חדשה, זו ההשבה של המשמרת שהייתה.
// ─────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd());
const ENC_PATH = path.join(ROOT, "sovereign", "weave-seal.enc");
const META_PATH = path.join(ROOT, "sovereign", "weave-seal.meta.json");
const MAGIC = "WEAVE-CLOUD-SEAL-1";

// ── מגבלת-קצב זיכרונית (כמו /api/arm) ───────────────────────────────

const hits = new Map<string, number[]>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local"
  );
}

// ── פתיחת ה-seal (אותה נוסחה של scripts/weave-seal.ts) ─────────────

interface SealPayload {
  format: string;
  sealedAt: string;
  cloudKeyHex: string;
  networkKeyHex: string;
  cloudAddress: string;
  networkAddress: string;
}

function readSealEnvelope(): { header: string; payloadHex: string } {
  const raw = fs.readFileSync(ENC_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const [header, ...bodyLines] = lines;
  if (!header || header.trim() !== MAGIC) throw new Error("seal header לא מזוהה");
  const payloadHex = bodyLines.join("");
  if (!/^[0-9a-fA-F]+$/.test(payloadHex)) throw new Error("seal body אינו hex תקני");
  return { header: header.trim(), payloadHex };
}

function sealDecrypt(payloadHex: string, passphrase: string): SealPayload {
  const payload = Buffer.from(payloadHex, "hex");
  if (payload.length < 45) throw new Error("seal payload קצר מכדי להיות תקני");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  // scrypt ברירת-מחדל N=2^14 — תואם המטא (kdf: scrypt(2^14))
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt) as SealPayload;
  if (parsed.format !== MAGIC) throw new Error("תוכן seal לא מזוהה");
  return parsed;
}

const HEX64 = /^[0-9a-f]{64}$/;

// ── הדלת ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "rate-limited", detail: "5 ניסיונות לשעה — החלון ייפתח מאוחר יותר (כמו /api/arm)" },
      { status: 429 },
    );
  }

  let passphrase = "";
  try {
    const body = (await req.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string") passphrase = body.passphrase.trim();
  } catch {
    return NextResponse.json({ ok: false, error: "bad-body" }, { status: 400 });
  }
  if (passphrase.length < 8) {
    return NextResponse.json(
      { ok: false, error: "missing-passphrase", detail: "הסיסמה שבמשמרת המפוצלת (GitHub Secret / .env.local / הכספת האישית)" },
      { status: 400 },
    );
  }

  let meta: { networkAddress?: string; cloudAddress?: string };
  let envelope: { header: string; payloadHex: string };
  try {
    meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    envelope = readSealEnvelope();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "seal-unreadable", detail: String(e instanceof Error ? e.message : e).slice(0, 160) },
      { status: 500 },
    );
  }

  let payload: SealPayload;
  try {
    payload = sealDecrypt(envelope.payloadHex, passphrase);
  } catch {
    // GCM דוחה סיסמה שגויה מיד — כנות, בלי רמזים על התוכן
    return NextResponse.json(
      { ok: false, error: "passphrase-rejected", detail: "ה-seal לא נפתח — AEAD דחה את הסיסמה. שום דבר לא נכתב." },
      { status: 401 },
    );
  }

  // אימות-תוכן מלא — אי-התאמה אחת = 403 וכלום לא נכתב
  const netOk = HEX64.test(payload.networkKeyHex) && payload.networkAddress === meta.networkAddress;
  const cloudOk = HEX64.test(payload.cloudKeyHex) && payload.cloudAddress === meta.cloudAddress;
  if (!netOk || !cloudOk) {
    await db.chainRun.create({
      data: {
        chain: "fleet",
        step: "custody-return-reject",
        firedBy: "operator",
        ok: false,
        detail: "דלת-ההשבה: ה-seal נפתח אך אימות-התוכן נכשל (כתובת/פורמט) — נדחה בכנות, שום דבר לא נכתב",
      },
    });
    return NextResponse.json(
      { ok: false, error: "content-mismatch", detail: "התוכן נפתח אך אינו תואם את המטא — נדחה. שום דבר לא נכתב." },
      { status: 403 },
    );
  }

  // ההשבה — בדיוק מה שהפעימה-בענן הייתה כותבת
  const existing = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (existing && existing.address !== payload.networkAddress) {
    return NextResponse.json(
      { ok: false, error: "identity-conflict", detail: "ב-DB כבר יש מפתח-רשת בכתובת אחרת — סתירה כנה, נדרשת החלטת-מפעיל" },
      { status: 409 },
    );
  }
  await db.networkKey.upsert({
    where: { id: "weave-network" },
    create: { id: "weave-network", address: payload.networkAddress, devKeyHex: payload.networkKeyHex },
    update: { devKeyHex: payload.networkKeyHex, address: payload.networkAddress },
  });

  await db.chainRun.create({
    data: {
      chain: "fleet",
      step: "custody-return",
      firedBy: "operator",
      ok: true,
      detail: `דלת-ההשבה: ה-seal נפתח ואומת (כתובת-רשת ${payload.networkAddress.slice(0, 8)}… תואמת מטא וספר) — מפתח-הרשת הושב ל-DB, הזהויות נגזרות לבד והערוצים נפתחים`,
    },
  });

  return NextResponse.json({
    ok: true,
    networkAddress: payload.networkAddress,
    at: new Date().toISOString(),
    detailHe:
      "הסמכות הושבה: מפתח-הרשת חי שוב ב-DB — זהויות הדיבונים נגזרות לבד במחזור ההחלטה הבא, pulse/שוק/מוח נפתחים מעצמם. אפס סודות בתשובה או בלוג.",
  });
}

export async function GET() {
  // תצוגת-מצב בלבד: האם הסמכות חיה — אפס סודות
  const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  return NextResponse.json({
    ok: true,
    custody: nk?.devKeyHex ? "OPEN" : "GATED",
    networkAddress: nk?.address ?? null,
    door: "POST /api/arm/seal {passphrase} — הצעד היחיד של המפעיל להשיב סמכות",
    noteHe: "המפתח חי ב-DB של הסנדבוקס — מיחזור-סנדבוקס שוב יסגר את הסמכות, והדלת תיפתח בהשבה מה-seal",
  });
}
