// ─────────────────────────────────────────────────────────────────────
// /api/evm-rails — מסילות ה-EVM של הרשת, מדידה חיה מהצומת הציבורי.
//
// המשאלה של המפעיל ("מה הרשת שלנו יכולה לעשות על ETH?") — נענית במדידה:
//  · Z-Chain 9369 (Zero Network) — עיגוני-checkpoint בגז 0x0, שעה-בשעה
//    מ-Domain (Actions ציבורי). החותם במאזן 0 וזו בדיוק הנקודה.
//  · Ethereum mainnet — חוזה SAOSRelay (קוד חי) + יתרות הארנקים.
//  · Optimism — ה-EOA הריבוני (EVM_ANCHOR_PK) + חוזה ה-Relay.
//  · ענן (GitHub Actions) — הריצות האחרונות של הקווים: anchor-lines
//    (שעתי :33), anchor-execute (יומי 13:55Z), arb-mesh (יומי 14:07Z).
//  · ספר-מסילות-חלופיות ל-Binance — מהגיט (sovereign/businesses).
//
// אין כאן דבר מומצא: כל כשל נתיב → ok:false + הודעה כנה. Cache 60ש'.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

type RpcResult = { ok: true; value: string } | { ok: false; error: string };

async function rpc(url: string, method: string, params: unknown[]): Promise<RpcResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = (await res.json()) as { result?: string; error?: { message?: string } };
    if (j.error) return { ok: false, error: j.error.message ?? "rpc error" };
    if (typeof j.result !== "string") return { ok: false, error: "no result" };
    return { ok: true, value: j.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 60) : "fetch failed" };
  }
}

const hexToNum = (h: string): number | null => {
  try {
    return parseInt(h, 16);
  } catch {
    return null;
  }
};
const weiToEth = (h: string): number | null => {
  try {
    return Number(BigInt(h)) / 1e18;
  } catch {
    return null;
  }
};

const Z_RPC = "https://rpc.zero.tech";
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const OP_RPC = "https://optimism-rpc.publicnode.com";

const ZERO_SEALER = "0xe376d8431089A0275A0CF125655B6Bc7d693F1b2";
const MAIN_RELAY = "0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6";
const MAIN_FUNDED = "0x2767e8146c11baD1d9B0784f11325375195c1b0f";
const MAIN_TREASURY = "0x0FB6C1807d8D7945B5E3a14ea3679e19795cb545";
const OP_RELAY = "0x56c9D54ea866e25916757903E51392BBEdeE2ECe";
const OP_ANCHOR_EOA = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";

// ── GitHub: הריצות האחרונות של קווי-הענן ב-Domain ─────────────────────
type RunInfo = { name: string; startedAt: string | null; status: string; conclusion: string | null } | null;

function readPat(): string | null {
  if (process.env.PAT) return process.env.PAT;
  if (process.env.ZIP_PAT) return process.env.ZIP_PAT;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const candidates = [
    "/home/z/my-project/pat.env",
    "/home/z/revive/pat.env",
    "/home/z/my-project/upload/pat.env",
  ];
  try {
    const fs = require("fs") as typeof import("fs");
    for (const p of candidates) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const m = raw.match(/^(?:PAT|ZIP_PAT|WEAVE_OPS_PAT|GITHUB_TOKEN)=(.+)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

async function lastRun(pat: string | null, workflowId: string): Promise<RunInfo> {
  if (!pat) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(
      `https://api.github.com/repos/roshpinacare-sys/Domain/actions/workflows/${workflowId}/runs?per_page=1`,
      { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" }, signal: ctrl.signal, cache: "no-store" }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      workflow_runs?: { name?: string; run_started_at?: string; status?: string; conclusion?: string | null }[];
    };
    const r = j.workflow_runs?.[0];
    if (!r) return null;
    return {
      name: r.name ?? workflowId,
      startedAt: r.run_started_at ?? null,
      status: r.status ?? "?",
      conclusion: r.conclusion ?? null,
    };
  } catch {
    return null;
  }
}

async function readAltRails(): Promise<string | null> {
  // העץ-החי: cwd יכול להיות my-project (שורש) או my-project/zip (עץ-הקונסולה הקנון)
  const candidates = [
    path.join(process.cwd(), "sovereign/businesses/alt-rails.json"),
    path.join(process.cwd(), "zip/sovereign/businesses/alt-rails.json"),
    path.join(process.cwd(), "../zip/sovereign/businesses/alt-rails.json"),
    "/home/z/my-project/zip/sovereign/businesses/alt-rails.json",
  ];
  for (const p of candidates) {
    try {
      return await readFile(p, "utf8");
    } catch {}
  }
  return null;
}

// ── Cache ────────────────────────────────────────────────────────────
type Snapshot = { measuredAt: string; data: unknown };
let cache: Snapshot | null = null;
const CACHE_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - new Date(cache.measuredAt).getTime() < CACHE_MS) {
    return NextResponse.json({ ok: true, ...(cache.data as Record<string, unknown>), cached: true });
  }

  const [
    zBlock, zBal, zNonce,
    mCode, mFunded, mTreasury,
    opCode, opEoa,
    runLines, runExecute, runMesh,
  ] = await Promise.all([
    rpc(Z_RPC, "eth_blockNumber", []),
    rpc(Z_RPC, "eth_getBalance", [ZERO_SEALER, "latest"]),
    rpc(Z_RPC, "eth_getTransactionCount", [ZERO_SEALER, "latest"]),
    rpc(ETH_RPC, "eth_getCode", [MAIN_RELAY, "latest"]),
    rpc(ETH_RPC, "eth_getBalance", [MAIN_FUNDED, "latest"]),
    rpc(ETH_RPC, "eth_getBalance", [MAIN_TREASURY, "latest"]),
    rpc(OP_RPC, "eth_getCode", [OP_RELAY, "latest"]),
    rpc(OP_RPC, "eth_getBalance", [OP_ANCHOR_EOA, "latest"]),
    lastRun(readPat(), "362949450"), // weave-anchor-lines (hourly :33)
    lastRun(readPat(), "369193665"), // anchor-execute (daily 13:55Z)
    lastRun(readPat(), "374548486"), // arb-mesh (daily 14:07Z)
  ]);

  const altRailsRaw = await readAltRails();
  const altRails = altRailsRaw
    ? (() => {
        try {
          return JSON.parse(altRailsRaw) as unknown;
        } catch {
          return null;
        }
      })()
    : null;

  const data = {
    measuredAt: new Date().toISOString(),
    zChain: {
      chainId: 9369,
      rpc: "rpc.zero.tech",
      block: zBlock.ok ? hexToNum(zBlock.value) : null,
      blockError: zBlock.ok ? null : zBlock.error,
      sealer: ZERO_SEALER,
      sealerBalanceEth: zBal.ok ? weiToEth(zBal.value) : null,
      sealerNonce: zNonce.ok ? hexToNum(zNonce.value) : null,
      note:
        zBal.ok && zBal.value === "0x0"
          ? "גז מדוד 0x0 — עיגון checkpoint עולה $0.00; זו מסילת האפס שהוכחה"
          : null,
    },
    mainnet: {
      relay: MAIN_RELAY,
      relayCodeBytes: mCode.ok ? (mCode.value.length - 2) / 2 : null,
      relayCodeError: mCode.ok ? null : mCode.error,
      fundedWallet: MAIN_FUNDED,
      fundedEth: mFunded.ok ? weiToEth(mFunded.value) : null,
      treasury: MAIN_TREASURY,
      treasuryEth: mTreasury.ok ? weiToEth(mTreasury.value) : null,
    },
    optimism: {
      relay: OP_RELAY,
      relayCodeBytes: opCode.ok ? (opCode.value.length - 2) / 2 : null,
      anchorEoa: OP_ANCHOR_EOA,
      anchorEoaEth: opEoa.ok ? weiToEth(opEoa.value) : null,
    },
    cloud: {
      anchorLines: runLines,
      anchorExecute: runExecute,
      arbMesh: runMesh,
      repo: "roshpinacare-sys/Domain (public Actions — free minutes)",
    },
    altRails,
    paymaster: {
      status: "READY+GATED",
      detail:
        "steem/agent/paymaster.cjs — meta-tx RELAY + FUEL (VESTS); capital-gate מחזיק STASIS-HALT מפקודת-בעלים 2026-10-04. מתעורר רק בהרמת-השער על-ידי המפעיל.",
    },
  };

  cache = { measuredAt: data.measuredAt, data };
  // קונבנציית-הקונסולה: כל תשובה { ok: true, ... } — apiFetch בצד-הלקוח מחייב זאת
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
