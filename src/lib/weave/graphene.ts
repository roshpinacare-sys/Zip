// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Graphene — שכבת שידור לשרשראות Graphene (Steem + Hive)
//
// העברה נאמנה של הדפוס המוכח של הצי (agent/anchor.cjs, Tasks 44/79/82):
//   · Steem — steem-js native (steem.broadcast.sendAsync) — חינם-RC
//   · Hive  — חתימה מקומית עם chain_id המוחלף (steem.auth.signTransaction)
//              ושידור גולמי ב-broadcast_transaction — מאחורי שער RC
//   · אישור txids מההיסטוריה — "ההיסטוריה השופטת היחידה" (לקח 2026-09-05:
//              צומת יכול להחזיר שגיאת-RC בזמן שה-tx באמת נכנס)
//
// רשות: POSTING בלבד (required_posting_auths) — "אפס סיכון הון" לפי
// מסמך המפתחות של הצי (STEEM_KEYS_PLAYBOOK §2.1: כל ה-L2 — custom_json
// בסמכות posting). המפתח לעולם לא מודפס ולא נכנס לגיט.
// ─────────────────────────────────────────────────────────────────────

import steem from "steem";
import type { GrapheneOperation, SignedGrapheneTransaction } from "steem";

export const STEEM_RPC_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steem.61bts.com",
] as const;

export const HIVE_RPC = process.env.HIVE_RPC || "https://api.hive.blog";
export const HIVE_CHAIN_ID =
  "beeab0de00000000000000000000000000000000000000000000000000000000";

/** סף RC לרגל ה-Hive — פעולה עולה ~5M; הסף במרווח גדול (הדפוס: שער-תקציב) */
export const HIVE_RC_FLOOR = 50e6;
/** רגנרציית ה-RC של Hive — 5 ימים (432,000 שניות) */
const HIVE_RC_REGEN_SEC = 432000;

export class GrapheneError extends Error {}

/** JSON-RPC condenser/appbase על HTTPS — ללא תלות ב-WebSocket */
export async function rpcV4<T = unknown>(
  url: string,
  method: string,
  params: unknown,
  timeoutMs = 25_000
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctrl.signal,
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new GrapheneError(json.error.message || "rpc error");
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface DynamicGlobalProperties {
  head_block_number: number;
  head_block_id: string;
  time: string;
}

export async function getDgp(endpoint: string): Promise<DynamicGlobalProperties> {
  return rpcV4<DynamicGlobalProperties>(
    endpoint,
    "condenser_api.get_dynamic_global_properties",
    []
  );
}

/** בניית custom_json בסמכות posting — אופ ה-L2 של האקוסיסטם */
export function buildPostingCustomJson(
  account: string,
  id: string,
  payload: Record<string, unknown>
): GrapheneOperation {
  return [
    "custom_json",
    {
      required_auths: [],
      required_posting_auths: [account],
      id,
      json: JSON.stringify(payload),
    },
  ];
}

/** שער ה-RC של Hive (דפוס 103 של הצי): מנה מחושבת עם רגנרציה — דילוג-כנה, לא כשל */
export async function hiveRcGate(
  account: string,
  floor: number = HIVE_RC_FLOOR
): Promise<{ ok: boolean; mana: number; max: number; reason?: string }> {
  type RcAccount = {
    account: string;
    max_rc: string | number;
    rc_manabar: { current_mana: string | number; last_update_time: number };
  };
  const accounts = await rpcV4<RcAccount[]>(
    HIVE_RPC,
    "condenser_api.find_rc_accounts",
    [[account]]
  );
  const a = accounts?.[0];
  if (!a) return { ok: false, mana: 0, max: 0, reason: "rc-account-not-found" };
  const max = Number(a.max_rc);
  const dgp = await getDgp(HIVE_RPC);
  const now = Math.floor(new Date(dgp.time + "Z").getTime() / 1000);
  const lut = Number(a.rc_manabar.last_update_time);
  const mana = Math.min(
    max,
    Number(a.rc_manabar.current_mana) + Math.max(0, now - lut) * (max / HIVE_RC_REGEN_SEC)
  );
  if (mana < floor) {
    return {
      ok: false,
      mana: Math.round(mana),
      max,
      reason: `rc-gated (mana=${Math.round(mana).toExponential(2)} < floor=${floor.toExponential(2)} — regen budget, honest skip)`,
    };
  }
  return { ok: true, mana: Math.round(mana), max };
}

/** בניית עסקה + חתימה מקומית עם chain_id של הרשת המבוקשת */
export function signGrapheneTx(
  endpoint: string,
  chainId: string,
  ops: GrapheneOperation[],
  wif: string
): Promise<SignedGrapheneTransaction> {
  return (async () => {
    const dgp = await getDgp(endpoint);
    const tx = {
      ref_block_num: dgp.head_block_number & 0xffff,
      ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
      expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000)
        .toISOString()
        .slice(0, 19),
      operations: ops,
      extensions: [] as unknown[],
    };
    const prev = steem.config.get("chain_id");
    steem.config.set("chain_id", chainId);
    try {
      return steem.auth.signTransaction(tx, [wif]);
    } finally {
      steem.config.set("chain_id", prev);
    }
  })();
}

/** שידור Steem — steem-js native (העבר מדויק של הצי) */
export async function steemBroadcast(
  ops: GrapheneOperation[],
  wif: string
): Promise<{ txid: string | null; note?: string }> {
  try {
    const conf = await steem.broadcast.sendAsync(
      { operations: ops, extensions: [] },
      [wif]
    );
    return { txid: conf?.id || null };
  } catch (e) {
    return { txid: null, note: String((e as Error).message || e).slice(0, 140) };
  }
}

/** שידור Hive — חתימה מקומית + broadcast_transaction גולמי (העבר מדויק של הצי) */
export async function hiveBroadcast(
  ops: GrapheneOperation[],
  wif: string
): Promise<{ txid: string | null; note?: string }> {
  try {
    const signed = await signGrapheneTx(HIVE_RPC, HIVE_CHAIN_ID, ops, wif);
    await rpcV4(HIVE_RPC, "condenser_api.broadcast_transaction", [signed]);
    // השידור התקבל — אך ל-steem-js אין id מוחזר כאן; ההיסטוריה תאשר
    return { txid: null, note: "broadcast-accepted (await history confirm)" };
  } catch (e) {
    return { txid: null, note: String((e as Error).message || e).slice(0, 140) };
  }
}

/** איתור ה-op שלנו בהיסטוריית החשבון — ההיסטוריה השופטת היחידה */
export async function findInHistory(
  endpoint: string,
  account: string,
  opId: string,
  expectAt: string,
  pages = 4,
  limit = 100
): Promise<string | null> {
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const hist = await rpcV4<Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string }]>>(
      endpoint,
      "condenser_api.get_account_history",
      [account, start, limit]
    ).catch(() => null);
    if (!Array.isArray(hist) || !hist.length) break;
    let lowest = Infinity;
    for (const [, e] of hist) {
      const op = e.op;
      if (!op || op[0] !== "custom_json") continue;
      if (op[1].id !== opId) continue;
      try {
        const pl = JSON.parse(String(op[1].json || "{}")) as { at?: string };
        if (pl.at === expectAt) return e.trx_id || null;
      } catch {
        /* skip */
      }
    }
    for (const [idx] of hist) if (idx < lowest) lowest = idx;
    if (lowest === Infinity || lowest <= 1) break;
    start = Math.max(1, lowest - 1);
  }
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
