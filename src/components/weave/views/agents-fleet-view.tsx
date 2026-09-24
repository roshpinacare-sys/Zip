"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Agents Fleet View - הצי החי.
//
// 12 הסוכנים האוטונומיים ב-5 ריפואים, כפי שהענן מכיר אותם:
// רישום חי מ-agents-watch (מתעדכן שעתית מה-API של גיטהאב) + נקודת
// חיים לפי זמן הריצה האחרונה. מי שמת - נראה מת. הכל עובדות.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CircleCheck,
  Clock3,
  Cpu,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWeave } from "../store";

// ── עזרי זמן ────────────────────────────────────────────────────────

function ageLabel(iso: string | undefined): string {
  if (!iso) return "לא נמדד";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ימים`;
}

function lifeLevel(iso: string | undefined): "live" | "ok" | "slow" | "dead" {
  if (!iso) return "dead";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 2) return "live";
  if (h < 26) return "ok";
  if (h < 50) return "slow";
  return "dead";
}

const LIFE_STYLE: Record<ReturnType<typeof lifeLevel>, { dot: string; label: string }> = {
  live: { dot: "bg-emerald-500", label: "חי" },
  ok: { dot: "bg-emerald-400", label: "חי" },
  slow: { dot: "bg-amber-500", label: "מזדקן" },
  dead: { dot: "bg-rose-500", label: "דורם" },
};

const LAYER_STYLE: Record<string, string> = {
  "ALWAYS-UP": "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  WITNESS: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  MIRROR: "border-cyan-600/40 bg-cyan-600/10 text-cyan-700 dark:text-cyan-300",
  PUBLISH: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  ENFORCEMENT: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  RECOVERY: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  QA: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// ── כרטיס סוכן ──────────────────────────────────────────────────────

function AgentCard({
  agent,
  delay,
}: {
  agent: NonNullable<ReturnType<typeof useWeave>["registry"]["data"]>["agents"][number];
  delay: number;
}) {
  const life = lifeLevel(agent.lastRun?.at);
  const style = LIFE_STYLE[life];
  const success = agent.stats?.successRate;
  return (
    <Card
      className="group relative overflow-hidden transition-colors hover:border-emerald-500/30"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
              <span className="truncate font-mono text-sm font-bold">{agent.name}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {agent.repo}
              {agent.visibility === "public" ? " · ציבורי" : " · פרטי"}
            </span>
          </div>
          <Badge variant="outline" className={cn("shrink-0", LAYER_STYLE[agent.layer] ?? "")}>
            {agent.layer}
          </Badge>
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          {agent.role.he}
        </p>

        <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
          <div>
            <div className="text-lg font-bold tabular-nums leading-none">
              {agent.stats ? `${Math.round(agent.stats.successRate)}%` : "-"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">הצלחה</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums leading-none">
              {agent.stats?.runs_sampled ?? "-"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">ריצות שנדגמו</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums leading-none">
              {agent.stats ? `${agent.stats.avgDurS.toFixed(0)}ש׳` : "-"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">משך ממוצע</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {ageLabel(agent.lastRun?.at)}
          </span>
          {agent.lastRun && (
            <span
              className={cn(
                "flex items-center gap-1",
                agent.lastRun.conclusion === "success"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              )}
            >
              {agent.lastRun.conclusion === "success" ? (
                <CircleCheck className="size-3.5" aria-hidden="true" />
              ) : (
                <XCircle className="size-3.5" aria-hidden="true" />
              )}
              {agent.lastRun.conclusion === "success" ? "הצליח" : agent.lastRun.conclusion}
            </span>
          )}
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed">
          <span className="font-medium">קלט:</span> {agent.input.he}
          <br />
          <span className="font-medium">פלט:</span> {agent.output.he}
        </div>
      </CardContent>
    </Card>
  );
}

// ── מפעל האימות המקומי (R109) — הריבונות מהמכסה ────────────────────

interface VerifyJob {
  id: string;
  repo: string;
  titleHe: string;
  layer: string;
  roleHe: string;
  verdict: "PENDING" | "RUNNING" | "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
  lastRunAt: string | null;
  durationMs: number | null;
  checks: Record<string, unknown> | null;
  reason: string | null;
  outputTail: string[];
  nextDueAt: string;
  commit: string | null;
  runs: number;
}

interface FleetVerifyDTO {
  ok: boolean;
  service?: string;
  version?: string;
  beats?: number;
  patAvailable?: boolean;
  current?: { id: string; startedAt: string } | null;
  lastDecision?: { at: string; kind: string; detail: string } | null;
  summary?: { total: number; pass: number; fail: number; pending: number };
  jobs?: VerifyJob[];
  error?: string;
}

const VERIFY_VERDICT_STYLE: Record<string, { badge: string; label: string }> = {
  PASS: { badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "עבר" },
  FAIL: { badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300", label: "נכשל" },
  ERROR: { badge: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300", label: "שגיאה" },
  TIMEOUT: { badge: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", label: "פסק-זמן" },
  RUNNING: { badge: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300", label: "רץ עכשיו" },
  PENDING: { badge: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300", label: "ממתין" },
};

function VerifyCard({ job, delay }: { job: VerifyJob; delay: number }) {
  const style = VERIFY_VERDICT_STYLE[job.verdict] ?? VERIFY_VERDICT_STYLE.PENDING;
  const checks = job.checks ? Object.entries(job.checks) : [];
  return (
    <Card
      className="group relative overflow-hidden transition-colors hover:border-emerald-500/30"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              {job.verdict === "RUNNING" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-500" aria-hidden="true" />
              ) : (
                <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
              )}
              <span className="truncate font-mono text-sm font-bold">{job.id}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {job.repo}
              {job.commit ? ` @ ${job.commit}` : ""} · מקומי
            </span>
          </div>
          <Badge variant="outline" className={cn("shrink-0", style.badge)}>
            {job.verdict === "RUNNING" && <Loader2 className="ml-1 size-3 animate-spin" aria-hidden="true" />}
            {style.label}
          </Badge>
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">{job.roleHe}</p>

        {checks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {checks.slice(0, 5).map(([k, v]) => (
              <span
                key={k}
                className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                dir="ltr"
              >
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {job.lastRunAt ? ageLabel(job.lastRunAt) : "טרם רץ"}
          </span>
          <span className="tabular-nums">
            {job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}ש׳` : "-"} · {job.runs} ריצות
          </span>
        </div>

        {job.reason && (
          <p className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed" dir="auto">
            {job.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── העמוד ───────────────────────────────────────────────────────────

export function AgentsFleetView() {
  const { registry, loadRegistry } = useWeave();
  const [tick, setTick] = useState(0);
  const [verify, setVerify] = useState<FleetVerifyDTO | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const loadVerify = () => {
    setVerifyLoading(true);
    fetch("/api/fleet-verify", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: FleetVerifyDTO) => setVerify(d))
      .catch(() => setVerify({ ok: false, error: "המפעל לא ענה" }))
      .finally(() => setVerifyLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(loadVerify, 0);
    const iv = setInterval(loadVerify, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  // רענון גילאים כל דקה - בלי לרדוף אחרי הענן
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  void tick;

  const data = registry.data;
  const loading = registry.loading && !data;

  const summary = useMemo(() => {
    if (!data) return null;
    const agents = data.agents;
    const live = agents.filter((a) => ["live", "ok"].includes(lifeLevel(a.lastRun?.at))).length;
    const slow = agents.filter((a) => lifeLevel(a.lastRun?.at) === "slow").length;
    const dead = agents.filter((a) => lifeLevel(a.lastRun?.at) === "dead").length;
    const avg =
      agents.filter((a) => a.stats).reduce((s, a) => s + (a.stats?.successRate ?? 0), 0) /
      Math.max(1, agents.filter((a) => a.stats).length);
    return { total: agents.length, live, slow, dead, avg };
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Users className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            הצי החי
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            הסוכנים האוטונומיים שמפעילים את הרשת - בענן, 24/7, בלי תלות בשום סביבת
            עבודה חולפת. הרישום מתעדכן שעתית על-ידי agents-watch מה-API של גיטהאב.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => loadRegistry()}
          disabled={registry.loading}
        >
          <RefreshCw className={cn("size-4", registry.loading && "animate-spin")} aria-hidden="true" />
          רענן
        </Button>
      </div>

      {/* סיכום */}
      {summary ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Activity className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {summary.live}/{summary.total}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">סוכנים חיים</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Clock3 className="size-5 text-amber-500" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">{summary.slow}</div>
                <div className="mt-1 text-xs text-muted-foreground">מזדקנים</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="size-5 text-rose-500" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">{summary.dead}</div>
                <div className="mt-1 text-xs text-muted-foreground">דורמים</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {Math.round(summary.avg)}%
                </div>
                <div className="mt-1 text-xs text-muted-foreground">הצלחה משוקללת</div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px]" />
          ))}
        </div>
      )}

      {/* מפעל האימות המקומי — הריבונות מהמכסה (R109) */}
      <section className="mb-8" aria-label="מפעל האימות המקומי">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Cpu className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              מפעל האימות המקומי
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {verify?.summary ? `${verify.summary.pass}/${verify.summary.total} עברו` : "טוען"}
              </Badge>
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              תשעת סוכני-האימות של הרשת מתו עם מכסת ה-Actions של הארגון — הרץ הפרטי מעולם לא התחיל.
              הריבונות: אותן בדיקות בדיוק, רצות כאן, בבית. כל ריצה משכפלת את הריפו החי, מריצה
              את מלוא שלבי-האימות וכותבת פסק-דין כן. הענן הוא גיבוי — הבית הוא המכונה.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {verify?.lastDecision && (
              <span className="hidden max-w-xs truncate text-[11px] text-muted-foreground sm:inline" dir="auto">
                {verify.lastDecision.detail}
              </span>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={loadVerify} disabled={verifyLoading}>
              <RefreshCw className={cn("size-4", verifyLoading && "animate-spin")} aria-hidden="true" />
              רענן מפעל
            </Button>
          </div>
        </div>

        {verify?.ok ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(verify.jobs ?? []).map((job, i) => (
              <VerifyCard key={job.id} job={job} delay={i * 50} />
            ))}
          </div>
        ) : verify ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <ShieldCheck className="size-7 text-amber-500" aria-hidden="true" />
              <p className="text-sm text-muted-foreground" dir="auto">
                {verify.error ?? "המפעל לא כתב עדיין את קובץ-האמת — הדיבון עולה או ממתין לסמכות."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        )}
      </section>

      {/* הכרטיסים */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.agents.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} delay={i * 60} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle className="size-8 text-amber-500" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {registry.error ?? "הרישום לא נטען - הענן לא נענה."}
            </p>
            <Button variant="outline" size="sm" onClick={() => loadRegistry()}>
              נסה שוב
            </Button>
          </CardContent>
        </Card>
      )}

      {/* הריפואים השקטים */}
      {data && data.reposIdle.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {data.reposIdle.length} ריפואים שקטים (ארכיונים, כספות ומקורות אמת)
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.reposIdle.map((r) => (
              <Badge key={r} variant="outline" className="font-mono text-xs">
                {r}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            ריפואים אלה אינם מריצים סוכנים בכוונה - הם ארכיון קר, כספות וגיבויים.
            גלויים ברישום כדי שהתמונה תהיה מלאה וכנה.
          </p>
        </div>
      )}
    </div>
  );
}
