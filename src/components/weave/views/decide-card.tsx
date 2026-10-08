"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DECIDE CARD — המוח המבצע של האוטונומיה (Task 17) · נשען בשער המפעיל.
//
// decide() רץ על הקצב השעתי (cadence · decide-beat): אוסף מועמדויות מכל
// השולחנות ⇒ חוק-עצימה (r197) ⇒ מבצע פעולות-בטוחות אידמפוטנטיות (אפס-כסף-
// חיצוני) ⇒ תור הסלמות-מפעיל ⇒ רישום hash-chained. הכרטיס = העין עליו:
// הריצה האחרונה, ההכרעות, וכפתור ריצה-ידנית למפעיל.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, CircleDashed, Loader2, MinusCircle, PlayCircle, RefreshCw, ShieldAlert, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "../api";
import { fmtDateTime } from "../shared";

interface DecideLine {
  id: string;
  kind: string;
  verdict: "EXECUTED" | "EXECUTED-NOOP" | "QUEUE" | "DEFER" | "ALERT";
  detailHe: string;
}

interface DecideRun {
  seq: number;
  entryHash: string;
  at: string;
  gate: string;
  execute: boolean;
  verdicts: DecideLine[];
  noteHe: string;
}

interface DecidePayload {
  ok: boolean;
  gate?: { mode: string; reason?: string };
  plan?: DecideRun;
  latest?: DecideRun | null;
  run?: DecideRun;
  error?: string;
}

const VERDICT_STYLE: Record<DecideLine["verdict"], { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  "EXECUTED": { label: "בוצע", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  "EXECUTED-NOOP": { label: "אידמפוטנטי", cls: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25", icon: MinusCircle },
  "QUEUE": { label: "תור-מפעיל", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: Timer },
  "DEFER": { label: "נדחה-בכנות", cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/25", icon: CircleDashed },
  "ALERT": { label: "התראה", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", icon: ShieldAlert },
};

export function DecideCard() {
  const [data, setData] = useState<DecidePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<DecidePayload>("/api/decide");
      setData(d);
    } catch (e) {
      toast.error(`decide: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const d = await apiFetch<DecidePayload>("/api/decide", { method: "POST" });
      if (d.ok && d.run) {
        setData((prev) => ({ ...(prev ?? {}), ...d, latest: d.run }));
        toast.success(`decide() seq=${d.run.seq} — ${d.run.noteHe}`);
      } else {
        toast.error(d.error ?? "ריצה נכשלה");
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const shown = data?.latest ?? data?.plan ?? null;
  const gateMode = data?.gate?.mode ?? shown?.gate ?? "?";

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-emerald-500" aria-hidden />
            decide() — המוח המבצע של האוטונומיה
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={gateMode === "ACTIVE" ? "default" : "secondary"} className={gateMode === "ACTIVE" ? "bg-emerald-600 text-white" : ""}>
              שער {gateMode}
            </Badge>
            {shown ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                seq {shown.seq} · {shown.entryHash.slice(0, 10)}…
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
            <p className="text-sm text-muted-foreground">
              {shown.noteHe} · ריצה {shown.execute ? "אמיתית" : "יבשה"} · {fmtDateTime(shown.at)}
            </p>
            <div className="space-y-1.5">
              {shown.verdicts.map((v) => {
                const st = VERDICT_STYLE[v.verdict] ?? VERDICT_STYLE.DEFER;
                const Icon = st.icon;
                return (
                  <div key={v.id} className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${st.cls}`}>{st.label}</Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">{v.id}</span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-foreground/90">{v.detailHe}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : data?.error ? (
          <p className="text-sm text-red-500">{data.error}</p>
        ) : (
          <p className="text-sm text-muted-foreground">טרם נמדד — הרץ ריצה ראשונה.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={runNow} disabled={running} aria-label="הרץ decide עכשיו">
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlayCircle className="h-4 w-4" aria-hidden />}
            הרץ decide() עכשיו
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} aria-label="מדידה מחדש">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            תוכנית-יבשה
          </Button>
          <span className="text-[11px] text-muted-foreground">
            קצב-שעתי: cadence · decide-beat · רישום hash-chained ב-sovereign/decide/
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
