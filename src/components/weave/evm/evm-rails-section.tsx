"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · פס מסילות-EVM + מסילות-חלופיות ל-Binance (מדידה חיה).
//
// המקור: /api/evm-rails — Z-Chain 9369 (גז-אפס), mainnet (SAOSRelay),
// Optimism (EOA ריבוני), קווי-הענן ב-Domain (anchor-lines :33 ·
// anchor-execute יומי · arb-mesh), ספר-המסילות-החלופיות מהגיט, וה-
// PAYMASTER (READY+GATED). אין כאן טענה שלא נמדדה: כל כשל → כרטיס-כנות.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Cloud, Fuel, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, errorMessage } from "../api";

type RunInfo = { name: string; startedAt: string | null; status: string; conclusion: string | null } | null;

type RailsDTO = {
  measuredAt: string;
  cached?: boolean;
  zChain: {
    block: number | null; blockError: string | null; sealer: string;
    sealerBalanceEth: number | null; sealerNonce: number | null; note: string | null;
  };
  mainnet: {
    relay: string; relayCodeBytes: number | null; relayCodeError: string | null;
    fundedWallet: string; fundedEth: number | null; treasury: string; treasuryEth: number | null;
  };
  optimism: { relay: string; relayCodeBytes: number | null; anchorEoa: string; anchorEoaEth: number | null };
  cloud: { anchorLines: RunInfo; anchorExecute: RunInfo; arbMesh: RunInfo; repo: string };
  altRails: {
    exitRails?: { venue: string; assets: string[]; vol24hUsd: number; role: string; kyc: string; verifyBeforeTrust: string }[];
    instantNoAccountRails?: { service: string; assets: string[]; role: string; trust: string; verifyBeforeTrust: string }[];
    trapsMeasured?: { trap: string; danger: string; verdict: string }[];
    recommendedPlaybook?: string[];
  } | null;
  paymaster: { status: string; detail: string };
};

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `לפני ${s}ש׳`;
  if (s < 5400) return `לפני ${Math.round(s / 60)} דק׳`;
  if (s < 172800) return `לפני ${Math.round(s / 3600)} שע׳`;
  return `לפני ${Math.round(s / 86400)} ימים`;
}

function RunPill({ label, run }: { label: string; run: RunInfo }) {
  if (!run) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> {label}: לא נמדד
      </span>
    );
  }
  const ok = run.conclusion === "success";
  const fail = run.conclusion === "failure";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : fail ? "bg-red-500" : "bg-amber-500"}`} />
      <span className="text-zinc-700 dark:text-zinc-300">
        {label}: <span className="font-medium">{ok ? "ירוק" : fail ? "אדום" : run.conclusion ?? run.status}</span> · {ago(run.startedAt)}
      </span>
    </span>
  );
}

function RailCard({
  title, badge, badgeTone, rows,
}: {
  title: string;
  badge: string;
  badgeTone: "live" | "warn" | "dead";
  rows: [string, string][];
}) {
  const tone =
    badgeTone === "live"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : badgeTone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <Badge variant="outline" className={`text-[10px] ${tone}`}>{badge}</Badge>
      </div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-[12px]">
            <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
            <dd className="truncate font-medium text-zinc-800 dark:text-zinc-200" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function EvmRailsSection() {
  const [data, setData] = useState<RailsDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<RailsDTO>("/api/evm-rails");
      setData(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 90_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
      </div>
    );
  }
  if (error && !data) {
    return (
      <Card className="flex items-center gap-2 border-amber-500/40 bg-amber-500/[0.06] p-4 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" /> מסילות-EVM: מדידה נכשלה — {error}
      </Card>
    );
  }
  if (!data) return null;

  const z = data.zChain;
  const m = data.mainnet;
  const o = data.optimism;
  const rails = data.altRails;
  const topRails = (rails?.exitRails ?? []).slice(0, 5);
  const traps = (rails?.trapsMeasured ?? []).slice(0, 2);
  const fmtEth = (v: number | null) => (v === null ? "—" : v === 0 ? "0" : v < 0.001 ? v.toExponential(2) : v.toFixed(6));

  return (
    <section aria-label="מסילות EVM ומסילות חלופיות" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Fuel className="h-4 w-4" /> מסילות-EVM של הרשת — מדידה חיה מהצומת הציבורי
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{ago(data.measuredAt)}{data.cached ? " · cache" : ""}</span>
          <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="רענון מדידה">
            <RefreshCw className="h-3 w-3" /> רענן
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <RailCard
          title="Z-Chain 9369 · Zero Network"
          badge={z.block ? "LIVE · גז 0x0" : "לא נמדד"}
          badgeTone={z.block ? "live" : "warn"}
          rows={[
            ["בלוק", z.block ? z.block.toLocaleString("en-US") : (z.blockError ?? "—")],
            ["עיגונים (nonce)", z.sealerNonce !== null ? String(z.sealerNonce) : "—"],
            ["יתרת חותם", `${fmtEth(z.sealerBalanceEth)} ETH`],
            ["הערה", z.note ?? "עיגון שעתי מ-Domain :33"],
          ]}
        />
        <RailCard
          title="Ethereum mainnet · SAOSRelay"
          badge={m.relayCodeBytes ? "קוד חי" : "לא נמדד"}
          badgeTone={m.relayCodeBytes ? "live" : "warn"}
          rows={[
            ["גודל חוזה", m.relayCodeBytes ? `${m.relayCodeBytes} בייט` : (m.relayCodeError ?? "—")],
            ["ארנק-ממומן", `${fmtEth(m.fundedEth)} ETH`],
            ["כספת (אבק)", `${fmtEth(m.treasuryEth)} ETH`],
            ["מצב", m.fundedEth === 0 ? "המסילה-הממומנת ריקה — צריך תדלוק" : "—"],
          ]}
        />
        <RailCard
          title="Optimism · EOA ריבוני"
          badge={o.relayCodeBytes ? "קוד חי · דלק זעיר" : "לא נמדד"}
          badgeTone={o.anchorEoaEth && o.anchorEoaEth > 0 ? "live" : "dead"}
          rows={[
            ["חוזה Relay", o.relayCodeBytes ? `${o.relayCodeBytes} בייט` : "—"],
            ["דלק EOA", `${fmtEth(o.anchorEoaEth)} ETH`],
            ["קצב", "עיגון יומי 13:55Z (R67-C)"],
            ["הערה", "הדלק מספיק למאות עיגונים זולים"],
          ]}
        />
      </div>

      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          <Cloud className="h-3.5 w-3.5" /> קווי-הענן · {data.cloud.repo}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <RunPill label="anchor-lines (שעתי :33)" run={data.cloud.anchorLines} />
          <RunPill label="anchor-execute (יומי 13:55Z)" run={data.cloud.anchorExecute} />
          <RunPill label="arb-mesh (יומי 14:07Z)" run={data.cloud.arbMesh} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          PAYMASTER: {data.paymaster.status} — {data.paymaster.detail}
        </p>
      </Card>

      {rails ? (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            <ShieldAlert className="h-3.5 w-3.5" /> יציאה בלי Binance — זירות-חלופיות שנמדדו (מהגיט)
          </div>
          <div className="max-h-64 overflow-y-auto pr-1">
            <table className="w-full text-right text-[12px]">
              <thead>
                <tr className="text-zinc-500">
                  <th className="pb-1 font-medium">זירה</th>
                  <th className="pb-1 font-medium">נכסים</th>
                  <th className="pb-1 font-medium">נפח 24ש׳</th>
                  <th className="pb-1 font-medium">תנאי</th>
                </tr>
              </thead>
              <tbody>
                {topRails.map((r) => (
                  <tr key={r.venue} className="border-t border-zinc-200/60 dark:border-zinc-800/60">
                    <td className="py-1.5 font-medium">{r.venue}</td>
                    <td className="py-1.5 text-zinc-600 dark:text-zinc-400">{r.assets.join(" · ")}</td>
                    <td className="py-1.5">${(r.vol24hUsd / 1e6).toFixed(2)}M</td>
                    <td className="py-1.5 text-zinc-500">{r.kyc.slice(0, 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {traps.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-zinc-200/60 pt-2 dark:border-zinc-800/60">
              {traps.map((t) => (
                <p key={t.trap} className="text-[11px] leading-relaxed text-red-600 dark:text-red-400">
                  <span className="font-semibold">⚠ {t.trap}:</span> {t.danger}
                </p>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-zinc-500">
            מקור: zip/sovereign/businesses/alt-rails.json (בגיט) · מדיניות: העסקה-הראשונה-קטנה, פיצול-זירות, אף זירה צעירה משנתיים.
          </p>
        </Card>
      ) : (
        <Card className="p-4 text-[11px] text-zinc-500">ספר-המסילות החלופיות לא נמצא בעץ המקומי (zip/sovereign/businesses/alt-rails.json) — הוא בגיט.</Card>
      )}
    </section>
  );
}
