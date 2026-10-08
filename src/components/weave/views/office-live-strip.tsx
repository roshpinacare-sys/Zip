"use client";

// ─────────────────────────────────────────────────────────────────────────────
// OfficeLiveStrip — פס-המשרד החי (Task 13): צריכת זרם-SSE אחד (/api/office/stream)
// במקום מדידות-מרובות. hello→snapshot → tick-כל-10ש'. מוצג למעלה בטאב-הסוכנים.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Activity, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

interface OfficeSnapshot {
  at: string;
  fleet?: { up: number; total: number; error?: string };
  watchdog?: { revives?: Record<string, number>; lastRound?: string } | null;
  competition?: { beats: number; epoch: string; top3: Array<{ account: string; agent: string; points: number }> } | null;
  gate?: { queued: number | null };
  scholarship?: { week: string; total: number } | null;
}

export function OfficeLiveStrip() {
  const [snap, setSnap] = useState<OfficeSnapshot | null>(null);
  const [live, setLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/office/stream");
    esRef.current = es;
    es.addEventListener("hello", () => setLive(true));
    es.addEventListener("snapshot", (e) => {
      try { setSnap(JSON.parse((e as MessageEvent).data)); } catch { /* כנות: דילוג */ }
    });
    es.addEventListener("tick", (e) => {
      try {
        const t = JSON.parse((e as MessageEvent).data) as Partial<OfficeSnapshot> & { changed?: boolean };
        setSnap((prev) => ({ ...(prev ?? {}), ...t }) as OfficeSnapshot);
      } catch { /* כנות: דילוג */ }
    });
    es.onerror = () => setLive(false);
    return () => { es.close(); esRef.current = null; };
  }, []);

  const totalRevives = Object.values(snap?.watchdog?.revives ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 px-3 py-2 text-xs"
      role="status"
      aria-label="פס-המשרד החי"
    >
      <span className={cn("flex items-center gap-1.5 font-semibold", live ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        <Radio className={cn("size-3.5", live && "animate-pulse")} aria-hidden="true" />
        המשרד-החי {live ? "(SSE)" : "(מתחבר…)"}
      </span>
      {snap?.fleet ? (
        <Badge variant="outline" className="tabular-nums">
          צי {snap.fleet.up}/{snap.fleet.total}
        </Badge>
      ) : null}
      {snap?.watchdog ? (
        <Badge variant="outline" className="tabular-nums">
          <Activity className="size-3" aria-hidden="true" /> שומר: ריפויים {totalRevives}×
        </Badge>
      ) : null}
      {snap?.competition ? (
        <Badge variant="outline" className="tabular-nums">
          beat #{snap.competition.beats} · {snap.competition.top3.map((t) => `${t.account}:${t.points}`).join(" · ")}
        </Badge>
      ) : null}
      {snap?.gate ? (
        <Badge variant="outline" className="tabular-nums">
          תור-השער: {snap.gate.queued ?? "—"}
        </Badge>
      ) : null}
      {snap?.scholarship ? (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 tabular-nums">
          מלגה {snap.scholarship.week}: {snap.scholarship.total} SAOS
        </Badge>
      ) : null}
    </div>
  );
}
