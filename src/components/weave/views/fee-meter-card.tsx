"use client";

// ─────────────────────────────────────────────────────────────────────────────
// FEE METER CARD — מנוע הוכחת-הרווח-העצמי (Task 18) · נשען בשער המפעיל.
//
// הכרטיס = העין על הכלכלה: הכנסה-היום מול עלות-24ש' לכל מסילה, פסיקה
// (PROFIT · BREAKEVEN · LOSS · UNMEASURED), בריאות-מסילות חיה (RC · גז-ZERO),
// וכפתור רישום-מדידה לספר ה-hash-chained. LOSS ⇒ תור-המפעיל (decide()).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { BadgeDollarSign, CheckCircle2, CircleDashed, Loader2, RefreshCw, Scale, Save, ShieldAlert, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "../api";
import { fmtDateTime } from "../shared";

type FeeVerdict = "PROFIT" | "BREAKEVEN" | "LOSS" | "UNMEASURED";

interface FeeLane {
  id: string;
  nameHe: string;
  costUsd: number | null;
  incomeUsd: number | null;
  healthHe: string;
  ok: boolean;
}

interface FeeRun {
  seq: number;
  entryHash: string;
  at: string;
  execute: boolean;
  verdict: FeeVerdict;
  incomeUsdToday: number | null;
  spendUsd24h: number | null;
  netUsd24h: number | null;
  lanes: FeeLane[];
  noteHe: string;
}

interface FeePayload {
  ok: boolean;
  doctrine?: string;
  live?: FeeRun;
  latest?: FeeRun | null;
  run?: FeeRun;
  error?: string;
}

const VERDICT_STYLE: Record<FeeVerdict, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  PROFIT: { label: "רווח-עצמי מוכח", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: TrendingUp },
  BREAKEVEN: { label: "איזון", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: Scale },
  LOSS: { label: "הפסד מדוד", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", icon: ShieldAlert },
  UNMEASURED: { label: "לא נמדד", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/25", icon: CircleDashed },
};

const fmtUsd = (n: number | null): string => (n == null ? "?" : `$${n.toFixed(4)}`);

export function FeeMeterCard() {
  const [data, setData] = useState<FeePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<FeePayload>("/api/fee-meter");
      setData(d);
    } catch (e) {
      toast.error(`fee-meter: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const record = useCallback(async () => {
    setSaving(true);
    try {
      const d = await apiFetch<FeePayload>("/api/fee-meter", { method: "POST" });
      if (d.ok && d.run) {
        setData((prev) => ({ ...(prev ?? {}), ...d, latest: d.run }));
        toast.success(`מדידה נרשמה — seq ${d.run.seq} · ${d.run.verdict}`);
      } else {
        toast.error(d.error ?? "רישום נכשל");
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const shown = data?.live ?? data?.latest ?? null;
  const st = shown ? (VERDICT_STYLE[shown.verdict] ?? VERDICT_STYLE.UNMEASURED) : null;
  const VerdictIcon = st?.icon ?? CircleDashed;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgeDollarSign className="h-4 w-4 text-emerald-500" aria-hidden />
            fee-meter — הוכחת-הרווח-העצמי
          </CardTitle>
          <div className="flex items-center gap-2">
            {st ? (
              <Badge variant="outline" className={`px-2 py-0 text-[11px] ${st.cls}`}>
                <VerdictIcon className="mr-1 h-3 w-3" aria-hidden />
                {st.label}
              </Badge>
            ) : null}
            {shown ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {shown.execute ? `seq ${shown.seq} · ${shown.entryHash.slice(0, 10)}…` : "מדידה-יבשה"}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : shown ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">הכנסה היום</p>
                <p className="mt-0.5 font-mono text-sm font-semibold">{fmtUsd(shown.incomeUsdToday)}</p>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">עלות 24ש&apos;</p>
                <p className="mt-0.5 font-mono text-sm font-semibold">{fmtUsd(shown.spendUsd24h)}</p>
              </div>
              <div className={`rounded-md border px-2 py-2 ${shown.netUsd24h != null && shown.netUsd24h > 0 ? "border-emerald-500/30 bg-emerald-500/10" : shown.netUsd24h != null && shown.netUsd24h < 0 ? "border-red-500/30 bg-red-500/10" : "border-border/50 bg-muted/30"}`}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">נטו</p>
                <p className="mt-0.5 font-mono text-sm font-semibold">{fmtUsd(shown.netUsd24h)}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{shown.noteHe}</p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {shown.lanes.map((l) => (
                <div key={l.id} className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5">
                  {l.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground">{l.id}</span>
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        עלות {l.costUsd == null ? "?" : `$${l.costUsd.toFixed(2)}`}
                      </Badge>
                      {l.incomeUsd != null ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">הכנסה {fmtUsd(l.incomeUsd)}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-foreground/90">{l.healthHe}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : data?.error ? (
          <p className="text-sm text-red-500">{data.error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">טרם נמדד — לחץ רישום-מדידה.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={record} disabled={saving} aria-label="רישום מדידה בספר">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            רישום-מדידה בספר
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} aria-label="מדידה מחדש">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            מדידה-יבשה
          </Button>
          <span className="text-[11px] text-muted-foreground">
            נמדד בכל פעימת decide() (שעתי) · ספר hash-chained ב-sovereign/fee-meter/
          </span>
        </div>
        {data?.doctrine ? <p className="text-[11px] leading-relaxed text-muted-foreground/80">{data.doctrine}</p> : null}
      </CardContent>
    </Card>
  );
}
