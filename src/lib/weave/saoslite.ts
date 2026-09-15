// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · saoslite — SAOS-LIVE v1: המטבע החי של הרשת (Task 29)
//
// מה המודול הזה עושה בכל פעימת לב:
//   1. קורא את ספר הטוקנים מהשרשרת הציבורית (חסר-מפתח לחלוטין):
//      כל custom_json עם op id `saos.weave.live.v1` מחשבונות הרשת
//      (קו העדות cashmachine + המפעיל headcorner) — בסדר חסין.
//   2. מנכיש את הג'נזיס (ענן בלבד): אם SAOS טרם נפרש על השרשרת —
//      בונה את שלוש פעולות הג'נזיס (רישום האוצר → פריסת החוזה →
//      הטבעה ראשונה 126,682 SAOS המשקפת את v0 בדיוק 1:1), חתומות
//      במפתח ה-posting של קו העדות (WEAVE_STEEM_WIF — אותו מפתח
//      שמעגן את כל checkpoints), ומשדר טרנזאקציה אחת אטומית.
//   3. מקפל את הספר (המנוע: console/saos-live.js — אותו קוד בדיוק
//      רץ בדפדפן של כל משתמש; אפס הסתעפות, אפס העתקה) ומאמת
//      כל חתימה מחדש.
//   4. מפרסם את saos-live.json לקונסולה הציבורית (WEAVE_OPS_PAT,
//      שער-סודות על התוכן, פרסום רק בשינוי) — הצומת של כל דפדפן.
//   5. מעיד על שינוי מצב: stateRoot חדש ⇒ אימות SAOSLIVE חתום
//      + checkpoint שמכסה אותו — העוגנים יעידו ב-$0.
//
// דוקטרינת האמון (תווית אמת מלאה): ה-relayer הוא תעבורה. הסמכות
// היא החתימה הפנימית של בעל הארנק. הספר ציבורי, הקיפול דטרמיניסטי,
// וכל צומת — דפדפן או ענן — מגיע לאותו stateRoot מאותן פעולות.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { rpcV4, STEEM_RPC_NODES, steemBroadcast, steemRcGate } from "@/lib/weave/graphene";
import type { GrapheneOperation } from "steem";
import { db } from "@/lib/db";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";
import { secretGate, filterKnownHashes } from "../../../scripts/weave-gate";

export const SAOS_LIVE_OP_ID = "saos.weave.live.v1";
const WITNESS_ACCOUNT = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const OPERATOR_ACCOUNT = (process.env.WEAVE_OPERATOR_ACCOUNT || "headcorner").toLowerCase();
/** שני המשדרים הרשומים כרגע — סדר קבוע לקנון הקריאה */
const RELAY_ACCOUNTS = [WITNESS_ACCOUNT, OPERATOR_ACCOUNT];

const OWNER = process.env.WEAVE_OWNER || "roshpinacare-sys";
const CONSOLE_REPO = `${OWNER}/Console`;
const ROOT = path.resolve(__dirname, "..", "..", "..");
const STATE_PATH = path.join(ROOT, "sovereign", "saos-live.json");
const PAGE = 100;
const MAX_PAGES = 12;

/* ── קובץ מצב מקומי: יומן ג'נזיס + זמני צפייה ראשונה לפעולות ── */
interface SaosLiveStateFile {
  format: "saos-live-state-v1";
  genesis: { attempted: boolean; done: boolean; txid?: string; treasury?: string; broadcastAt?: string; note?: string };
  seen: Record<string, string>;
  lastStateRoot: string | null;
  updatedAt: string;
}
function loadStateFile(): SaosLiveStateFile {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as SaosLiveStateFile;
    if (raw.format === "saos-live-state-v1") {
      raw.genesis = raw.genesis || { attempted: false, done: false };
      raw.seen = raw.seen || {};
      return raw;
    }
  } catch {
    /* נולד עכשיו */
  }
  return { format: "saos-live-state-v1", genesis: { attempted: false, done: false }, seen: {}, lastStateRoot: null, updatedAt: new Date(0).toISOString() };
}
function saveStateFile(st: SaosLiveStateFile): void {
  st.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2) + "\n");
}

/* ── קריאת הספר מהשרשרת הציבורית — חסרת-מפתח לחלוטין ── */
export interface LiveEnvelope {
  env: Record<string, unknown>;
  txid: string;
  block: number | null;
  trxInBlock: number | null;
  account: string;
}

export async function readLiveEnvelopes(): Promise<{ envelopes: LiveEnvelope[]; node: string }> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      const out: LiveEnvelope[] = [];
      for (const account of RELAY_ACCOUNTS) {
        let start = -1;
        for (let p = 0; p < MAX_PAGES; p++) {
          const hist = await rpcV4<Array<[number, { trx_id: string; block: number; trx_in_block: number; op?: [string, Record<string, unknown>] }]>>(
            node,
            "condenser_api.get_account_history",
            [account, start, PAGE],
          );
          if (!Array.isArray(hist) || !hist.length) break;
          let oldest = Infinity;
          for (const [idx, entry] of hist) {
            if (typeof idx === "number") oldest = Math.min(oldest, idx);
            const op = entry && entry.op;
            if (!op || op[0] !== "custom_json") continue;
            const body = op[1] as { id?: string; json?: string; required_posting_auths?: string[] } | undefined;
            if (!body || body.id !== SAOS_LIVE_OP_ID) continue;
            // רק מהחשבון שמשדר — לא התחזות ב-required_posting_auths אחר
            if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(account)) continue;
            try {
              const env = JSON.parse(String(body.json || "{}")) as Record<string, unknown>;
              out.push({ env, txid: String(entry.trx_id || ""), block: typeof entry.block === "number" ? entry.block : null, trxInBlock: typeof entry.trx_in_block === "number" ? entry.trx_in_block : null, account });
            } catch {
              /* ג'ייסון שבור — הקיפול ידחה אותו בכנות */
            }
          }
          if (oldest === Infinity || oldest <= 1) break;
          start = Math.max(1, oldest - 1);
        }
      }
      // סדר חסין-קנוני: בלוק → מיקום בבלוק → שם חשבון (דטרמיניסטי בכל מכונה)
      out.sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || (a.trxInBlock ?? 0) - (b.trxInBlock ?? 0) || a.account.localeCompare(b.account));
      return { envelopes: out, node: new URL(node).hostname };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`קריאת ספר SAOS-LIVE נכשלה בכל הצמתים: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/* ── הנחת הג'נזיס (ענן בלבד): אטומית, חד-פעמית, חתומה ── */
async function ensureGenesis(alreadyFoldedHasSaos: boolean, st: SaosLiveStateFile): Promise<{ broadcast: boolean; note: string; txid?: string; treasury?: string }> {
  if (alreadyFoldedHasSaos) {
    if (!st.genesis.done) {
      st.genesis.done = true;
      st.genesis.note = "genesis found on chain (verified by fold)";
    }
    return { broadcast: false, note: "הג'נזיס כבר על השרשרת" };
  }
  const wif = (process.env.WEAVE_STEEM_WIF || "").trim();
  if (!wif) return { broadcast: false, note: "אין WEAVE_STEEM_WIF בסביבה — דילוג-כנה (הג'נזיס מונח רק מהענן)" };
  if (st.genesis.attempted && st.genesis.broadcastAt && Date.now() - Date.parse(st.genesis.broadcastAt) < 10 * 60 * 1000) {
    return { broadcast: false, note: "ניסיון ג'נזיס אחרון לפני פחות מ-10 דק' — המתנה כנה להיכללות בבלוק" };
  }

  try {
    const GateCrypto = await import("../../../console/gate-crypto.js");
    const SaosLive = await import("../../../console/saos-live.js");

    // שער ה-RC לפני שידור — אותה משמעת כמו קווי העוגן
    const gate = await steemRcGate(WITNESS_ACCOUNT);
    if (!gate.ok) {
      return { broadcast: false, note: `דילוג-כנה — RC נמוך (${gate.reason ?? "gated"})` };
    }

    // האוצר = הזהות שנגזרת ממפתח ה-posting של קו העדות — ניתן לאימות ציבורי מהשרשרת
    const priv = await GateCrypto.wifToPriv(wif);
    const pubSTM = await GateCrypto.pubToSTM(GateCrypto.privToPubBytes(priv));
    const { treasury, ops } = await SaosLive.buildGenesisOps(priv, pubSTM);

    const txOps: GrapheneOperation[] = ops.map((op: Record<string, unknown>) => [
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [WITNESS_ACCOUNT],
        id: SAOS_LIVE_OP_ID,
        json: JSON.stringify(op),
      },
    ]) as GrapheneOperation[];

    const res = await steemBroadcast(txOps, wif);
    st.genesis.attempted = true;
    st.genesis.broadcastAt = new Date().toISOString();
    st.genesis.treasury = treasury;
    st.genesis.note = res.txid ? "broadcast ok — ממתין להיכללות בבלוק" : `broadcast נכשל: ${res.note ?? "?"}`;
    if (res.txid) st.genesis.txid = res.txid;
    return { broadcast: true, txid: res.txid ?? undefined, treasury, note: res.txid ? `הג'נזיס שודר ✓ (tx ${res.txid.slice(0, 14)}…)` : `שידור נכשל — ${res.note ?? "?"}` };
  } catch (e) {
    st.genesis.attempted = true;
    st.genesis.broadcastAt = new Date().toISOString();
    st.genesis.note = `שגיאה: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
    return { broadcast: false, note: st.genesis.note };
  }
}

/* ── פרסום saos-live.json לריפו הציבורי — כמו המראה: שער + שינוי-בלבד ── */
async function publishLiveFile(payload: Record<string, unknown>): Promise<{ published: boolean; reason: string; bytes?: number }> {
  const text = JSON.stringify(payload, null, 2) + "\n";
  const leak = secretGate(filterKnownHashes(text));
  if (leak) throw new Error(`saos-live.json נחסם בשער-הסודות: ${leak} — לא מפורסם כלום`);

  const pat = process.env.WEAVE_OPS_PAT || "";
  if (!pat) return { published: false, reason: "אין WEAVE_OPS_PAT בסביבה — דילוג-כנה (הפרסום רק מהענן)" };

  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`https://api.github.com${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };

  const cur = await api("GET", `/repos/${CONSOLE_REPO}/contents/saos-live.json?ref=main`);
  if (cur.status === 200 && cur.json && typeof cur.json.content === "string") {
    const curText = Buffer.from(cur.json.content, "base64").toString("utf8");
    if (curText.trim() === text.trim()) return { published: false, reason: "הספר החי כבר עדכני — אין שינוי לפרסם", bytes: text.length };
  }
  const put = await api("PUT", `/repos/${CONSOLE_REPO}/contents/saos-live.json`, {
    message: `saos-live: ${(payload.stateRoot as string || "").slice(0, 16)} · ${(payload.ops as unknown[] || []).length} ops · ${((payload.state as Record<string, Record<string, unknown>>)?.wallets ? Object.keys((payload.state as Record<string, Record<string, unknown>>).wallets).length : 0)} wallets · sovereign live ledger`,
    content: Buffer.from(text, "utf8").toString("base64"),
    sha: cur.status === 200 && cur.json ? String(cur.json.sha || "") : undefined,
    branch: "main",
  });
  if (put.status !== 200 && put.status !== 201) {
    return { published: false, reason: `פרסום נכשל (HTTP ${put.status}) — ${String(put.json?.message || "").slice(0, 80)}` };
  }
  return { published: true, reason: "פורסם ✓", bytes: text.length };
}

/* ── סיכום פעולה לתצוגה ── */
function opSummary(env: Record<string, unknown>): string {
  const k = String(env.k || "");
  const n = (x: unknown) => Number(x || 0).toLocaleString("en");
  if (k === "wallet.create") return `רישום ארנק${env.nick ? ` "${env.nick}"` : ""} ${String(env.by || "").slice(0, 12)}…`;
  if (k === "token.deploy") return `פריסת חוזה ${env.symbol} (תקרה ${n(env.maxSupply)})`;
  if (k === "token.mint") return `הטבעת ${n(env.amount)} ${env.symbol} → ${String(env.to || "").slice(0, 12)}…`;
  if (k === "token.transfer") return `${n(env.amount)} ${env.symbol} → ${String(env.to || "").slice(0, 12)}…`;
  if (k === "token.burn") return `שריפת ${n(env.amount)} ${env.symbol}`;
  return k;
}

export interface SaosLiveResult {
  ok: boolean;
  ops: number;
  valid: number;
  wallets: number;
  tokens: number;
  stateRoot: string;
  attested: boolean;
  attSeq?: number;
  checkpoint?: { index: number; root: string };
  genesisNote: string;
  publishNote: string;
  node: string;
}

/**
 * השלב שהלב מריץ בכל פעימה: קריאה → ג'נזיס (ענן) → קיפול → פרסום → עדות-על-שינוי.
 * attested=true מעיר את הרשת (עוקף את נסיגת SANDBOX-ALIVE) — המטבע דיבר.
 */
export async function processSaosLive(ctx: { runner: string; cloudAgentId: string; gitHead: string; repoSlug: string; runUrl?: string }): Promise<SaosLiveResult> {
  const st = loadStateFile();
  const { envelopes, node } = await readLiveEnvelopes();

  const SaosLive = await import("../../../console/saos-live.js");
  let res = await SaosLive.fold(envelopes.map((e) => e.env));
  const hasSaos = Boolean(res.state.tokens?.SAOS);

  // הנחת הג'נזיס — רק אם SAOS טרם נפרש (השרשרת היא השופט)
  const gen = await ensureGenesis(hasSaos, st);
  if (gen.broadcast && gen.txid) {
    // המתנה קצרה להיכללות ואז קריאה חוזרת — הפעימה הבאה תאסוף אם פספסנו
    await new Promise((r) => setTimeout(r, 9000));
    const again = await readLiveEnvelopes().catch(() => null);
    if (again) {
      res = await SaosLive.fold(again.envelopes.map((e) => e.env));
      if (res.state.tokens?.SAOS) st.genesis.done = true;
    }
  }
  if (res.state.tokens?.SAOS) st.genesis.done = true;

  // זמני צפייה ראשונה (תווית אמת: "נצפה בענן", לא זמן השרשרת)
  const seen = st.seen || {};
  for (const e of envelopes) {
    const id = String(e.env.id ?? "");
    if (id && !seen[id]) seen[id] = new Date().toISOString();
  }
  st.seen = seen;

  const state = res.state as {
    wallets: Record<string, { pub: string; nick: string | null; at: string | null; txid: string | null }>;
    tokens: Record<string, { name: string; decimals: number; maxSupply: string; issuer: string; at: string | null; txid: string | null }>;
  };
  const saosSupply = String(res.supplyCanon?.SAOS ?? "0");
  const saosDisplay = SaosLive.fmt(saosSupply, state.tokens?.SAOS?.decimals ?? 3);

  const opsList = envelopes.map((e) => ({
    id: String(e.env.id ?? "?"),
    k: String(e.env.k ?? "?"),
    by: String(e.env.by ?? ""),
    at: seen[String(e.env.id ?? "")] ?? null,
    txid: e.txid,
    block: e.block,
    summary: opSummary(e.env),
  }));

  const payload = {
    format: "saos-live-v1",
    generatedAt: new Date().toISOString(),
    protocol: SaosLive.PROTOCOL,
    stateRoot: res.stateRoot,
    genesis: {
      done: st.genesis.done,
      treasury: st.genesis.treasury ?? null,
      txid: st.genesis.txid ?? null,
      symbol: SaosLive.SAOS_GENESIS.symbol,
      initialMint: SaosLive.SAOS_GENESIS.initialMint,
      maxSupply: SaosLive.SAOS_GENESIS.maxSupply,
      note: SaosLive.SAOS_GENESIS.note,
    },
    state: {
      wallets: state.wallets,
      tokens: state.tokens,
      balances: res.balCanon,
      supply: res.supplyCanon,
    },
    ops: opsList,
    invalid: res.invalid,
    verify: {
      replayed: envelopes.length,
      valid: res.valid,
      readFrom: node,
      engine: "console/saos-live.js (same code as every browser)",
    },
    truthLabel: "REAL — deterministic fold of public-chain custom_json ops; every signature re-verified; relayer = transport only",
  };

  // פרסום לקונסולה — הצומת של כל דפדפן
  let publishNote = "";
  try {
    const pub = await publishLiveFile(payload);
    publishNote = pub.published ? `פורסם ✓ (${Math.round((pub.bytes || 0) / 1024)}KB)` : pub.reason;
  } catch (pubErr) {
    publishNote = `נדחה: ${pubErr instanceof Error ? pubErr.message.slice(0, 90) : String(pubErr)}`;
  }

  // עדות על שינוי מצב בלבד — הספר לא מציף את החותמת, הוא מעיד על אמת מתקדמת
  let attested = false;
  let attSeq: number | undefined;
  let checkpoint: { index: number; root: string } | undefined;
  if (res.stateRoot && res.stateRoot !== st.lastStateRoot) {
    const last = await db.attestation.findFirst({ where: { claimType: "SAOSLIVE" }, orderBy: { seq: "desc" } });
    const lastRoot = last ? /stateRoot=([0-9a-f]{64})/.exec(last.evidence || "")?.[1] : undefined;
    if (lastRoot !== res.stateRoot) {
      const first = !last;
      const claim = first
        ? `SAOS-LIVE v1 נולד: ספר הטוקנים החי על השרשרת הציבורית — ${res.valid} פעולות תקפות, ${Object.keys(state.wallets).length} ארנקים, ${Object.keys(state.tokens).length} חוזים, אספקת SAOS ${saosDisplay} (משקף את SAOS-NET v0 בדיוק 1:1)`
        : `SAOS-LIVE v1 התקדם: stateRoot חדש ${res.stateRoot.slice(0, 16)}… — ${res.valid} פעולות תקפות, ${Object.keys(state.wallets).length} ארנקים, ${Object.keys(state.tokens).length} חוזים, אספקת SAOS ${saosDisplay}`;
      const evidence = [
        `protocol=${SaosLive.PROTOCOL}`,
        `opId=${SAOS_LIVE_OP_ID}`,
        `stateRoot=${res.stateRoot}`,
        `ops=${res.valid}/${envelopes.length}`,
        `wallets=${Object.keys(state.wallets).length}`,
        `tokens=${Object.keys(state.tokens).length}`,
        `saosSupply=${saosSupply}`,
        st.genesis.txid ? `genesisTxid=${st.genesis.txid}` : null,
        st.genesis.treasury ? `treasury=${st.genesis.treasury}` : null,
        st.genesis.txid ? `explorer=https://steemscan.com/transaction/${st.genesis.txid}` : null,
        `fold=console/saos-live.js (deterministic, same code in every browser)`,
        `relayers=${RELAY_ACCOUNTS.map((a) => "@" + a).join("+")} (posting, transport only)`,
        `readFrom=${node}`,
        `runner=${ctx.runner}`,
        `commit=${ctx.gitHead}`,
        ctx.runUrl ? `run=${ctx.runUrl}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const att = await appendAttestation({ agentId: ctx.cloudAgentId, claim, claimType: "SAOSLIVE", evidence });
      attested = true;
      attSeq = att.seq;
      console.log(`[saos-live] אימות SAOSLIVE att${att.seq} · stateRoot ${res.stateRoot.slice(0, 16)}… · ${res.valid} פעולות`);
      const cp = await createCheckpointNow();
      if (cp) {
        checkpoint = { index: cp.index, root: cp.root };
        console.log(`[saos-live] checkpoint #${cp.index} מכסה את הספר החי (att ${cp.attFrom}..${cp.attTo})`);
      }
    }
  }

  st.lastStateRoot = res.stateRoot || null;
  saveStateFile(st);

  return {
    ok: true,
    ops: envelopes.length,
    valid: res.valid,
    wallets: Object.keys(state.wallets).length,
    tokens: Object.keys(state.tokens).length,
    stateRoot: res.stateRoot,
    attested,
    attSeq,
    checkpoint,
    genesisNote: gen.note,
    publishNote,
    node,
  };
}
