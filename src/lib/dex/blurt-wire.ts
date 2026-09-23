// ─────────────────────────────────────────────────────────────────────
// THE BLURT RAIL — רגל BLURT של הכלכלה (R101d)
//
// החסימה המתועדת (BLK-BLURT-NOMEASURE) נפתחת כאן לשני פסים אמיתיים:
//   1. מדידה חיה — יתרת BLURT מהשרשרת (rpc.blurt.blog), בריאות RPC.
//   2. נתיב-מפתח ריבוני — כספת-הארנק נפתחת בנתיב R101c (סיסמת-האב →
//      חותמה → מפתח-אב → AES-256-GCM) ומניבה את ה-active של BLURT.
//      חוק הקידומת: Blurt מציג פומביות בקידומת BLT אך ה-WIF זהה
//      בבייטים לשורש-המורשת (BLT5HhJD ≡ STM5HhJD — נמדד ב-R99).
//
// מה שנשאר מחוץ לכאן בכנות: שידור. העברות/זירת WBLURT הן הצעד הבא
// המתועד — עד שהן נבנות, הרגל מודדת ומוכיחה סמכות, ולא משדרת.
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import path from "node:path";

const HOME = "/home/z/my-project";
export const BLURT_RPC = process.env.BLURT_RPC || "https://rpc.blurt.blog";

/** RPC-JSON כללי ל-Blurt (condenser_api תואם-Steem בפרוטוקול) */
async function blurtRpc<T = unknown>(method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const r = await fetch(BLURT_RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // ענן-הגנה של rpc.blurt.blog חוסם בקשות ללא UA (נמדד חי: node-fetch
        // קיבל דף-אתגר HTML, curl עבר) — UA מפורש פותח את הדלת לכל הלקוחות.
        "User-Agent": "saos-weave-rail/1.0",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: T };
    return (j?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

export interface BlurtLegState {
  ok: boolean;
  at: string;
  account: string;
  rpc: { url: string; alive: boolean; ms: number };
  balances: { liquid: number; vesting: number };
  /** הפומבי הנגזר מהכספת (קידומת STM תמיד) — לאימות מול הרשות החיה */
  keyPreflight: {
    vaultOpened: boolean;
    derivedPub: string | null;
    liveActive: string | null;
    /** השוואה אחרי נרמול-קידומת (BLT≡STM — אותם בייטים) */
    match: boolean | null;
    detail?: string;
  };
  verdict: "RAIL-ARMED" | "RAIL-NO-KEY" | "RPC-DOWN" | "NO-ACCOUNT";
  note: string;
}

/** קריאת מצב הרגל — האמת החיה מהשרשרת ומהכספת, בלי שידור */
export async function readBlurtLeg(account = "headcorner"): Promise<BlurtLegState> {
  const at = new Date().toISOString();
  const t0 = Date.now();
  const accts = await blurtRpc<Array<{ balance: string; vesting_shares: string; active?: { key_auths?: Array<[string, number]> } }>>(
    "condenser_api.get_accounts",
    [[account]],
  );
  const ms = Date.now() - t0;

  if (!accts || !accts.length) {
    return {
      ok: false,
      at,
      account,
      rpc: { url: BLURT_RPC, alive: false, ms },
      balances: { liquid: 0, vesting: 0 },
      keyPreflight: { vaultOpened: false, derivedPub: null, liveActive: null, match: null },
      verdict: "RPC-DOWN",
      note: "rpc.blurt.blog לא ענה — אין אמת, אין מדידה. סירוב-כנה.",
    };
  }

  const liquid = parseFloat(accts[0].balance) || 0;
  const vesting = parseFloat(String(accts[0].vesting_shares ?? "0")) || 0;
  const liveActive = accts[0]?.active?.key_auths?.[0]?.[0] ?? null;

  // נתיב-הכספת הריבוני — בזיכרון בלבד, אימות פומבי בלבד
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  let vaultOpened = false;
  let derivedPub: string | null = null;
  let vaultDetail = "";
  try {
    const { openVaultKey } = await import("@/lib/dex/wallet-vault");
    const v = openVaultKey("blurt", account, "active");
    if (v.ok && v.wif && v.pub) {
      vaultOpened = true;
      derivedPub = v.pub;
    } else {
      vaultDetail = v.detail ?? "";
    }
  } catch (e) {
    vaultDetail = String((e as Error).message ?? e).slice(0, 80);
  }

  // חוק הקידומת: השוואת בסיס-base58 בלבד (BLT… ≡ STM… — אותם בייטים)
  const strip = (p: string | null) => (p ? p.replace(/^(STM|BLT)/, "") : null);
  const match = derivedPub && liveActive ? strip(derivedPub) === strip(liveActive) : null;

  const verdict: BlurtLegState["verdict"] = vaultOpened
    ? match
      ? "RAIL-ARMED"
      : "RAIL-NO-KEY"
    : "RAIL-NO-KEY";

  return {
    ok: true,
    at,
    account,
    rpc: { url: BLURT_RPC, alive: true, ms },
    balances: { liquid, vesting },
    keyPreflight: {
      vaultOpened,
      derivedPub,
      liveActive,
      match,
      detail: vaultDetail || undefined,
    },
    verdict,
    note:
      verdict === "RAIL-ARMED"
        ? "פסי הרגל חיים: השרשרת נקראת, הכספת נפתחת בנתיב-האב, הסמכות אומתה ביט-מול-ביט. הצעד הבא המתועד: שידור העברות + זירת WBLURT."
        : vaultDetail
          ? `הכספת לא נפתחה: ${vaultDetail}`
          : "הרשות לא אומתה — אין שידור בלי התאמה חיה (סירוב-כנה).",
  };
}
