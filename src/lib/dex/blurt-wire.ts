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
// שידור (R103): חוק-החוט של BLURT הוכח במעבדה אמפירית
// (scripts/lab-blurt-wire-law.cjs): שחזור חתימה אמיתית מהשרשרת עובר רק
// בצורה המילולית "N.NNN BLURT" — אין מיפוי-מורשת (בניגוד ל-HIVE שמסדרת
// HIVE=STEEM בייטים). ה-chain_id נמדד חי מ-get_config של הצומת עצמו.
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from "node:module";
import path from "node:path";

const HOME = "/home/z/my-project";
export const BLURT_RPC = process.env.BLURT_RPC || "https://rpc.blurt.blog";

/** חוק-החוט (R103, נמדד חי מ-get_config של הצומת): זהות השרשרת */
export const BLURT_CHAIN_ID =
  "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";

const UA_HEADERS = {
  "Content-Type": "application/json",
  // ענן-הגנה של rpc.blurt.blog חוסם בקשות ללא UA (נמדד חי ב-R101)
  "User-Agent": "saos-weave-rail/1.0",
};

/** RPC-JSON כללי ל-Blurt (condenser_api תואם-Steem בפרוטוקול) */
async function blurtRpc<T = unknown>(method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const r = await fetch(BLURT_RPC, {
      method: "POST",
      headers: UA_HEADERS,
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

// ── שידור (R103) — חוק-החוט המילולי, מוכח במעבדה ─────────────────────

export interface BlurtSendResult {
  accepted: boolean;
  txid: string | null;
  note?: string;
}

/** מאפייני-שרשרת חיים לבניית העסקה (head_block + זמן-שרשרת) */
async function blurtDgp(): Promise<{ head_block_number: number; head_block_id: string; time: string } | null> {
  return blurtRpc<{ head_block_number: number; head_block_id: string; time: string }>(
    "condenser_api.get_dynamic_global_properties",
    [],
  );
}

// ── r184 — חותמת-הסכמה הרשמית של הרגל ──────────────────────────────────
// המדידה שהפילה את החשוד-הישן (scripts/lab-blurt-serialize-diff.cjs):
// steem-js סודר custom_json כ-op-id **18**; Blurt סודר אותו כ-op-id **12**
// (בייט 11: 0x12 מול 0x0c — הסכמות נפרדות בגלל 6-פעולות שנחתכו במזלג).
// חתימה על בייטי-Steem מול שרשרת-Blurt = החתימה אינה מכסה את ה-op שהצומת
// מפרש ⇒ "Missing Active Authority". החוק החדש: הרגל חותמת רק דרך
// blurtjs (הספרייה הרשמית של השרשרת) — הבייטים שהצומת מפרש הם הבייטים
// שחתמנו. חוק-החוט המילולי של הנכס (R103) עומד — blurtjs סודר את הנכס
// מילולית ממילא.

interface BlurtLib {
  auth: { signTransaction(tx: unknown, keys: string[]): unknown };
  config: { get(k: string): unknown; set(k: string, v: unknown): void };
}

let blurtLibCache: BlurtLib | null = null;

function blurtAuth(): BlurtLib {
  if (!blurtLibCache) {
    const nodeRequire = createRequire(path.join(HOME, "package.json"));
    blurtLibCache = nodeRequire("@blurtfoundation/blurtjs") as BlurtLib;
    // חוק-השרשרת (R101, נמדד חי מ-get_config; blurtjs נולד עם אותו ערך —
    // נקבע במפורש: קבוצה-חוקית, לא נגזרת ממצב-ספרייה)
    blurtLibCache.config.set("chain_id", BLURT_CHAIN_ID);
  }
  return blurtLibCache;
}

/** חתימת עסקת-Blurt בסכמה הרשמית — DGP חי, chain_id קבוע, blurtjs סודר וחותם. */
export async function blurtSignTx(
  ops: Array<[string, Record<string, unknown>]>,
  wif: string,
): Promise<Record<string, unknown>> {
  const dgp = await blurtDgp();
  if (!dgp) throw new Error("NO-DGP: השרשרת לא ענתה — אין חתימה בלי ראש-שרשרת");
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000)
      .toISOString()
      .slice(0, 19),
    operations: ops,
    extensions: [] as unknown[],
  };
  return blurtAuth().auth.signTransaction(tx, [wif]) as Record<string, unknown>;
}

/**
 * העברת BLURT אמיתית בשרשרת.
 *
 * חוק-החוט (הוכח אמפירית ב-R103): הנכס נסדר בצורתו המילולית —
 * "N.NNN BLURT". אין מיפוי-מורשת כמו ב-HIVE. החתימה על הצורה
 * המילולית, השידור כמות שהוא — הצומת מסדר לאותם בייטים.
 *
 * הקבלה: ההיסטוריה השופטת — txid נקרא מ-get_account_history אחרי
 * השידור (ל-broadcast_transaction אין מזהה מוחזר).
 */
export async function blurtSendTransfer(params: {
  from: string;
  to: string;
  amount: number; // BLURT
  memo?: string;
  wif: string;
}): Promise<BlurtSendResult> {
  const { from, to, amount, memo, wif } = params;
  try {
    if (!(amount > 0)) return { accepted: false, txid: null, note: "BAD-AMOUNT" };
    const asset = `${amount.toFixed(3)} BLURT`; // 3 ספרות — חוק השרשרת
    const dgp = await blurtDgp();
    if (!dgp) return { accepted: false, txid: null, note: "NO-DGP: השרשרת לא ענתה" };

    // r184 — חתימה דרך blurtSignTx (הסכמה הרשמית; חותמת steem-js היתה
    // סודרת את ה-op במזהה-שגוי לשרשרת הזאת — נמדד במעבדה)
    const signed = await blurtSignTx(
      [["transfer", { from, to, amount: asset, memo: memo ?? "" }]],
      wif,
    );

    // שידור — הצומת מסדר לאותם בייטים שחתמנו
    const r = await fetch(BLURT_RPC, {
      method: "POST",
      headers: UA_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "condenser_api.broadcast_transaction",
        params: [signed],
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) {
      return { accepted: false, txid: null, note: String(j.error.message ?? "rpc error").slice(0, 160) };
    }

    // הקבלה — ההיסטוריה השופטת: איתור ההעברה בהיסטוריה של המקבל/השולח
    let txid: string | null = null;
    for (let attempt = 0; attempt < 6 && !txid; attempt++) {
      await new Promise((res) => setTimeout(res, 2500));
      const hist = await blurtRpc<Array<[number, { op?: [string, Record<string, unknown>]; trx_id?: string }]>>(
        "condenser_api.get_account_history", [to, -1, 20],
      );
      if (hist) {
        for (const [, e] of hist) {
          const [kind, data] = e.op ?? [];
          if (kind === "transfer" && (data as { amount?: string })?.amount === asset) {
            txid = String(e.trx_id ?? "") || null;
            break;
          }
        }
      }
    }
    return {
      accepted: true,
      txid,
      note: txid ? "broadcast-accepted · txid מההיסטוריה" : "broadcast-accepted (ההיסטוריה עוד לא שיקפה — הקבלה בהמשך)",
    };
  } catch (e) {
    return { accepted: false, txid: null, note: String((e as Error).message ?? e).slice(0, 160) };
  }
}
