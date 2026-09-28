"use client";

// ─────────────────────────────────────────────────────────────────────
// SOVEREIGNTY CARDS · שני כרטיסים חיים בבית הרשת (D-017/D-018).
//
// 1) החלטת הריבונות — הקנון העומד, חי מהגיט, עם טביעת-אצבע של המסמך.
// 2) מבדק התייעלות — המערך האוטונומי נספר 24/7: חיות-צי, ריצות-שרשראות,
//    חלק-הפעלה-עצמי (דבר גורר דבר נמדד), פעימות-שומרים, הכנסה-נמדדת.
//
// חוק התצוגה: מדידה שלא ענתה מוצגת כ"לא נמדד" — לעולם לא כהצלחה
// שנטענת. אפס מקפים בתוכן (חוק-הטון D-013).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Gavel, ScrollText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Decision {
  id: string;
  date: string;
  titleHe: string;
  status: string;
}

interface DecisionsState {
  ok: boolean;
  count: number;
  byStatus: Record<string, number>;
  updatedAt: string | null;
  docHash: string | null;
  errorHe: string | null;
  decisions: Decision[];
}

interface EfficiencyState {
  verdict: { level: string; he: string };
  server: { uptimeSec: number };
  fleet: {
    alive: number;
    total: number;
    aliveShare: number | null;
    source: string;
    daemons: Array<{ name: string; state: string; beats: number | null }>;
    keeper: { beats: number | null; lastDecision: { detail: string } | null };
  };
  chains24h: {
    total: number;
    ok: number;
    failed: number;
    autonomousShare: number | null;
    lastRun: { chain: string; step: string; firedBy: string; ok: boolean; at: string } | null;
  };
  pulse: { state: { beats: number; lastPublishUtcDay: string | null } | null };
  guardians: { fleetGuard: { cycles: number; lastCycleAt: string | null; revives24h: number } | null };
  book: { attestations: number; checkpoints: number };
  income: { lastDay: string | null; usdToday: number | null; honestyHe: string };
}

function statusBadge(status: string) {
  if (status === "ACTIVE")
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        תקף
      </Badge>
    );
  if (status === "OPEN-OPERATOR")
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        להחלטת מפעיל
      </Badge>
    );
  return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
}

function useLiveJson<T>(url: string, intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) setData((await r.json()) as T);
    } catch {
      // המדידה הקודמת נשארת על המסך; אין מדידה חדשה = אין שינוי תצוגה
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, loading };
}

// ── כרטיס 1: החלטת הריבונות ─────────────────────────────────────────

export function SovereigntyDecisionsCard() {
  const { data, loading } = useLiveJson<DecisionsState>("/api/sovereignty/decisions");
  const reduced = useReducedMotion();
  const latest = data?.decisions.slice(-4).reverse() ?? [];

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Gavel className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            החלטת הריבונות
          </div>
          {loading ? (
            <Skeleton className="h-5 w-16" />
          ) : data?.ok ? (
            <Badge variant="outline" className="font-mono" dir="ltr">
              {data.count} החלטות
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 dark:text-amber-300">לא נמדד</Badge>
          )}
        </div>

        {data?.docHash && (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
            SOVEREIGNTY-DECISIONS.md · sha256 {data.docHash.slice(0, 16)}…
          </p>
        )}
        {data?.errorHe && (
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-300" dir="auto">
            {data.errorHe}
          </p>
        )}

        <div className="grid gap-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : latest.length > 0 ? (
            latest.map((d) => (
              <div key={d.id} className="flex items-start gap-3 rounded-lg border bg-card/60 p-3">
                <span className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                  {d.id}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90" dir="auto">
                  {d.titleHe}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{d.date}</span>
                </span>
                {statusBadge(d.status)}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">אין החלטות נמדדות כרגע.</p>
          )}
        </div>

        <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          הקנון חי בגיט: החלטות חדשות נוספות בסוף בלבד, שום החלטה לא נערכת לאחור, והחלטה שנפסלת מסומנת בכנות.
        </p>
      </Card>
    </motion.div>
  );
}

// ── כרטיס 2: מבדק התייעלות המערך ────────────────────────────────────

function EffTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card/60 p-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" dir="auto">
        {label}
      </span>
      <span className="text-lg font-bold tabular-nums leading-none" dir="ltr">
        {value}
      </span>
      {sub && (
        <span className="text-[10px] leading-snug text-muted-foreground" dir="auto">
          {sub}
        </span>
      )}
    </div>
  );
}

export function ArrayEfficiencyCard() {
  const { data, loading } = useLiveJson<EfficiencyState>("/api/sovereignty/efficiency");
  const reduced = useReducedMotion();

  const v = data?.verdict?.level;
  const verdictBadge =
    v === "GREEN" ? (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="size-3" aria-hidden="true" /> ירוק
      </Badge>
    ) : v === "AMBER" ? (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        ענבר
      </Badge>
    ) : v ? (
      <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300">
        אדום
      </Badge>
    ) : (
      <Skeleton className="h-5 w-16" />
    );

  const pct = (x: number | null | undefined) =>
    x == null ? "לא נמדד" : `${Math.round(x * 100)}%`;

  const uptime = data?.server?.uptimeSec;
  const uptimeStr =
    uptime == null
      ? "…"
      : uptime < 3600
        ? `${Math.round(uptime / 60)} דק'`
        : `${Math.floor(uptime / 3600)}ש' ${Math.round((uptime % 3600) / 60)}דק'`;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      <Card className="flex h-full flex-col gap-4 p-6 transition-colors hover:border-emerald-500/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Activity className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            תייעלות המערך 24/7
          </div>
          {verdictBadge}
        </div>

        {data?.verdict?.he && (
          <p className="text-xs leading-relaxed text-muted-foreground" dir="auto">
            {data.verdict.he}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <EffTile
            label="צי חי"
            value={data ? `${data.fleet.alive}/${data.fleet.total}` : "…"}
            sub={data?.fleet?.source}
          />
          <EffTile
            label="ריצות שרשרת 24ש'"
            value={data ? `${data.chains24h.total}` : "…"}
            sub={data ? `${data.chains24h.ok} תקינות · ${data.chains24h.failed} כישלונות` : undefined}
          />
          <EffTile
            label="הפעלה עצמית"
            value={data ? pct(data.chains24h.autonomousShare) : "…"}
            sub="דבר גורר דבר: חלק הריצות שהציתו את עצמן"
          />
          <EffTile
            label="פעימות שומר"
            value={data?.fleet?.keeper?.beats != null ? String(data.fleet.keeper.beats) : "…"}
            sub="סיור keeper כל 30ש'"
          />
          <EffTile
            label="סיורי שרת"
            value={data?.guardians?.fleetGuard ? String(data.guardians.fleetGuard.cycles) : "0"}
            sub="fleet-guard כל 60ש' · החייאות 24ש'"
          />
          <EffTile
            label="הכנסה נמדדת"
            value={data?.income?.usdToday != null ? `$${data.income.usdToday.toFixed(4)}` : "לא נמדד"}
            sub={data?.income?.lastDay ? `יום ${data.income.lastDay}` : data?.income?.honestyHe}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(data?.fleet?.daemons ?? []).map((d) => (
            <span
              key={d.name}
              className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              dir="ltr"
              title={`${d.name}: ${d.state}`}
            >
              <span
                className={`inline-block size-1.5 rounded-full ${
                  d.state === "UP" ? "bg-emerald-500" : d.state === "BUSY" ? "bg-amber-500" : "bg-red-500"
                }`}
                aria-hidden="true"
              />
              {d.name}
            </span>
          ))}
          {!data && loading && <Skeleton className="h-5 w-40" />}
        </div>

        {data?.chains24h?.lastRun && (
          <p className="mt-auto font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
            last: {data.chains24h.lastRun.chain}/{data.chains24h.lastRun.step} by {data.chains24h.lastRun.firedBy}{" "}
            {data.chains24h.lastRun.ok ? "ok" : "fail"}
          </p>
        )}
        {uptime && (
          <p className="text-[11px] text-muted-foreground" dir="auto">
            זמן-ריצת שרת: {uptimeStr} · הספר: {data?.book?.attestations ?? "…"} אימותים ·{" "}
            {data?.book?.checkpoints ?? "…"} צ'קפוינטים
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          <ScrollText className="mr-1 inline size-3" aria-hidden="true" />
          כל מספר נמדד כרגע ממקורות-אמת: keeper, הדופק, ChainRun והספר. מדידה שלא ענתה מוצגת כלא-נמדדת, לעולם לא כהצלחה.
        </p>
      </Card>
    </motion.div>
  );
}
