"use client";

// ─────────────────────────────────────────────────────────────────────
// STUDENT VIEW · התלמיד — האוטונומיה המתפתחת (R94).
//
// הוראת המפעיל שיצרה את התצוגה: "אני רוצה אוטונומיה מתפתחת שמייעלת
// את עצמה בוחנת את עצמה ולומדת את עצמה טוב יותר... אני לא רוצה
// ריבונות עצלנית אני רוצה הוכחות התפתחות הבנה התייעלות".
//
// מה רואים כאן: מפת-כיסוי הריפואים (מי מתקדם, מי עם סוכן), הבחינה
// העצמית האחרונה (מערכות + צי), הלמידה מה-worklog, ספר-הפוטנציאל,
// וקבלות הריפוי הבטוח. הכל נמדד — כלום לא מומצא.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  GraduationCap,
  HeartPulse,
  Library,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/weave/api";
import { fmtDateTime } from "@/components/weave/shared";

// ── טיפוסים (מראה את חוזה ה-API) ──────────────────────────────────

interface StudentData {
  ok: boolean;
  at: string;
  daemon: {
    service: string;
    version: string;
    alive: boolean;
    bootedAt: string;
    beats: number;
    cycleSec: number;
    examining: boolean;
    lastExamAt: string | null;
    probes: Array<{ probe: string; ok: boolean; ms: number | null; at: string }>;
    recurring: Array<{ probe: string; since: string; count: number; resolvedAt: string | null }>;
    coverage: Array<{
      repo: string;
      role: string;
      pushedAt: string | null;
      pushAgeH: number | null;
      workflows: number | null;
      lastRun: { name: string; conclusion: string | null; createdAt: string | null } | null;
      verdict: "AGENTED" | "STALE" | "IDLE" | "UNKNOWN";
    }>;
    coverageAt: string | null;
    findings: Array<{ id: string; title: string; detail: string; state: string; addedAt: string; updatedAt: string }>;
    lessons: {
      rounds: number;
      liveBugsCaught: number;
      fixedMentions: number;
      honestyMentions: number;
      parsedAt: string;
      note: string[];
    } | null;
    heal: { receipts: Array<{ at: string; action: string; ok: boolean; detail: string }>; today: number; day: string };
    history: Array<{ at: string; kind: string; detail: string }>;
    uptimePct: number | null;
    lastDecision: { at: string; kind: string; detail: string } | null;
  } | null;
  daemonDownHe: string | null;
  summary: {
    coverage: { repos: number; agented: number; idle: number; stale: number; at: string | null } | null;
    uptimePct: number | null;
    findings: { done: number; working: number; open: number; gated: number } | null;
  } | null;
  doctrine: string[];
  cached: boolean;
  cacheAgeSec: number;
}

// ── עזרים ────────────────────────────────────────────────────────────

const FINDING_STYLE: Record<string, { cls: string; label: string }> = {
  DONE: { cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "הושלם" },
  WORKING: { cls: "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#d4af37]", label: "בעבודה" },
  OPEN: { cls: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", label: "פתוח" },
  GATED: { cls: "border-zinc-600/40 bg-zinc-500/10 text-zinc-400", label: "שער-מפעיל" },
};

const VERDICT_STYLE: Record<string, { cls: string; label: string }> = {
  AGENTED: { cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "סוכן חי" },
  STALE: { cls: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", label: "עצור 3+ ימים" },
  IDLE: { cls: "border-rose-600/40 bg-rose-500/10 text-rose-600", label: "ללא סוכן" },
  UNKNOWN: { cls: "border-zinc-600/40 bg-zinc-500/10 text-zinc-500", label: "לא נמדד" },
};

function pushAgeLabel(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return "כרגע";
  if (h < 24) return `לפני ${Math.round(h)} שע׳`;
  return `לפני ${Math.round(h / 24)} ימים`;
}

// ── התצוגה ─────────────────────────────────────────────────────────

export function StudentView() {
  const [data, setData] = useState<StudentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const j = await apiFetch<StudentData>("/api/student");
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאת מדידה");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const d = data?.daemon ?? null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10">
            <GraduationCap className="size-5 text-[#d4af37]" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold sm:text-xl">התלמיד — האוטונומיה המתפתחת</h1>
            <p className="text-xs text-zinc-500">
              בוחן את עצמו כל 10 דקות · מפה את כיסוי הרשת · לומד מההיסטוריה · מרפא בבטחה
              {data?.cached ? <span className="text-zinc-600"> · מטמון {data.cacheAgeSec}ש׳</span> : null}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ms-auto h-8 gap-1.5 border-zinc-700 text-zinc-400 hover:text-zinc-200"
            onClick={() => void load()}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            בחינה מחדש
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-800/40 bg-rose-950/20 p-4 text-sm text-rose-300">{error}</div>
      )}

      {data?.daemonDownHe && (
        <div className="mb-4 rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-300">
          {data.daemonDownHe}
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          {/* שורת מדדים */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <HeartPulse className="size-3.5 text-emerald-500" aria-hidden /> זמינות נמדדת
                </div>
                <div className="mt-1.5 font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {data?.summary?.uptimePct != null ? `${data.summary.uptimePct}%` : "—"}
                </div>
                <div className="text-[10px] text-zinc-600">מהבחינות האחרונות של התלמיד</div>
              </CardContent>
            </Card>
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <MapPin className="size-3.5 text-[#d4af37]" aria-hidden /> כיסוי ריפואים
                </div>
                <div className="mt-1.5 font-mono text-xl font-bold text-zinc-200">
                  {data?.summary?.coverage ? `${data.summary.coverage.agented}/${data.summary.coverage.repos}` : "—"}
                </div>
                <div className="text-[10px] text-zinc-600">
                  {data?.summary?.coverage
                    ? data.summary.coverage.stale
                      ? `${data.summary.coverage.stale} עצורים 3+ ימים · ${data.summary.coverage.idle} ללא סוכן`
                      : data.summary.coverage.idle
                        ? `${data.summary.coverage.idle} ללא סוכן — פער מתועד`
                        : "כולם מתקדמים עם סוכן"
                    : "עם סוכן פעיל"}
                </div>
              </CardContent>
            </Card>
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Sparkles className="size-3.5 text-[#d4af37]" aria-hidden /> ספר-פוטנציאל
                </div>
                <div className="mt-1.5 font-mono text-xl font-bold text-zinc-200">
                  {data?.summary?.findings ? `${data.summary.findings.done}/${data.summary.findings.done + data.summary.findings.working + data.summary.findings.open + data.summary.findings.gated}` : "—"}
                </div>
                <div className="text-[10px] text-zinc-600">הושלמו מתוך הספר החי</div>
              </CardContent>
            </Card>
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Bot className="size-3.5 text-zinc-400" aria-hidden /> פעימות התלמיד
                </div>
                <div className="mt-1.5 font-mono text-xl font-bold text-zinc-200">{d?.beats ?? "—"}</div>
                <div className="text-[10px] text-zinc-600">{d?.lastExamAt ? `בחינה אחרונה ${fmtDateTime(d.lastExamAt)}` : "טרם נמדד"}</div>
              </CardContent>
            </Card>
          </div>

          {/* מפת-כיסוי הרשת */}
          <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <MapPin className="size-4 text-[#d4af37]" aria-hidden />
                <h3 className="text-sm font-bold">מפת כיסוי הרשת — הריפואים וסוכניהם</h3>
                {d?.coverageAt && <span className="ms-auto text-[11px] text-zinc-600">נמדד {fmtDateTime(d.coverageAt)}</span>}
              </div>
              <div className="max-h-96 overflow-auto overscroll-contain rounded-lg border border-zinc-800/70 [scrollbar-width:thin]">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="sticky top-0 bg-zinc-900/95 text-zinc-500 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">ריפו</th>
                      <th className="px-3 py-2 text-start font-medium">תפקיד</th>
                      <th className="px-3 py-2 text-start font-medium">דחיפה אחרונה</th>
                      <th className="px-3 py-2 text-start font-medium">סוכנים פעילים</th>
                      <th className="px-3 py-2 text-start font-medium">ריצה אחרונה</th>
                      <th className="px-3 py-2 text-start font-medium">פסק-דין</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {(d?.coverage ?? []).map((c) => {
                      const vs = VERDICT_STYLE[c.verdict] ?? VERDICT_STYLE.UNKNOWN;
                      const runOk = c.lastRun?.conclusion === "success";
                      return (
                        <tr key={c.repo} className="transition-colors hover:bg-zinc-900/40">
                          <td className="px-3 py-2 font-mono text-zinc-200">{c.repo}</td>
                          <td className="px-3 py-2 text-zinc-500">{c.role || "—"}</td>
                          <td className="px-3 py-2 text-zinc-400">{pushAgeLabel(c.pushAgeH)}</td>
                          <td className="px-3 py-2 font-mono text-zinc-300">{c.workflows ?? "—"}</td>
                          <td className="px-3 py-2">
                            {c.lastRun ? (
                              <span className="flex flex-col gap-0.5">
                                <span className={cn("font-medium", runOk ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                                  {c.lastRun.conclusion ?? "רץ"}
                                </span>
                                <span className="text-[10px] text-zinc-600">{c.lastRun.name}</span>
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={cn("border", vs.cls)}>{vs.label}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                    {!d?.coverage.length && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-zinc-600">
                          הכיסוי טרם נמדד — התלמיד ימפה במחזורו הראשון
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* בחינה-עצמית */}
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-500" aria-hidden />
                  <h3 className="text-sm font-bold">הבחינה העצמית — מערכות וצי</h3>
                </div>
                <div className="grid gap-1.5">
                  {(d?.probes ?? []).map((p) => (
                    <div
                      key={p.probe}
                      className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-xs"
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          p.ok ? "bg-emerald-500" : "bg-rose-500",
                        )}
                        aria-hidden
                      />
                      <span className="font-mono text-zinc-300">{p.probe}</span>
                      <span className="ms-auto font-mono text-zinc-500" dir="ltr">
                        {p.ms != null ? `${p.ms}ms` : "timeout"}
                      </span>
                    </div>
                  ))}
                  {!d?.probes.length && (
                    <p className="text-xs text-zinc-600">טרם נמדד — הבחינה הראשונה תתועד כאן</p>
                  )}
                </div>
                {(d?.recurring ?? []).filter((r) => !r.resolvedAt).length > 0 && (
                  <div className="mt-3 rounded-lg border border-rose-900/40 bg-rose-950/20 p-2.5 text-[11px] text-rose-300">
                    כשלים חוזרים פתוחים:{" "}
                    {d!.recurring.filter((r) => !r.resolvedAt).map((r) => `${r.probe} (${r.count}×)`).join(" · ")}
                  </div>
                )}
                {(d?.recurring ?? []).filter((r) => r.resolvedAt).length > 0 && (
                  <div className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-2.5 text-[11px] text-emerald-300">
                    נלמד והתרפא: {d!.recurring.filter((r) => r.resolvedAt).length} הישנויות נסגרו ותועדו
                  </div>
                )}
              </CardContent>
            </Card>

            {/* למידה מה-worklog */}
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Library className="size-4 text-[#d4af37]" aria-hidden />
                  <h3 className="text-sm font-bold">למידה מההיסטוריה — ספר-הדורות</h3>
                </div>
                {d?.lessons ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                        <div className="text-zinc-500">סבבי-עבודה</div>
                        <div className="mt-1 font-mono text-sm text-zinc-200">{d.lessons.rounds}</div>
                      </div>
                      <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                        <div className="text-zinc-500">באגים-חיים שנתפסו</div>
                        <div className="mt-1 font-mono text-sm text-emerald-600 dark:text-emerald-400">{d.lessons.liveBugsCaught}</div>
                      </div>
                      <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                        <div className="text-zinc-500">תיקונים מתועדים</div>
                        <div className="mt-1 font-mono text-sm text-zinc-200">{d.lessons.fixedMentions}</div>
                      </div>
                      <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                        <div className="text-zinc-500">אזכורי כנות</div>
                        <div className="mt-1 font-mono text-sm text-zinc-200">{d.lessons.honestyMentions}</div>
                      </div>
                    </div>
                    <ul className="list-inside list-disc space-y-1 text-[11px] leading-relaxed text-zinc-500">
                      {d.lessons.note.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-zinc-600">נקרא לאחרונה {fmtDateTime(d.lessons.parsedAt)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600">הלמידה מה-worklog תתבצע במחזורו השני של התלמיד</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ספר-פוטנציאל */}
          <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="size-4 text-[#d4af37]" aria-hidden />
                <h3 className="text-sm font-bold">ספר-הפוטנציאל — מה צפוי מהרשת</h3>
              </div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {(d?.findings ?? []).map((f) => {
                  const st = FINDING_STYLE[f.state] ?? FINDING_STYLE.OPEN;
                  return (
                    <motion.div
                      key={f.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="min-w-0 rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-3.5"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-[10px] text-zinc-600">{f.id}</span>
                        <span className="text-sm font-semibold text-zinc-200">{f.title}</span>
                        <Badge variant="outline" className={cn("ms-auto border", st.cls)}>{st.label}</Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-500">{f.detail}</p>
                    </motion.div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ריפוי-בטוח */}
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Wrench className="size-4 text-emerald-500" aria-hidden />
                  <h3 className="text-sm font-bold">ריפוי-בטוח — קבלות</h3>
                  <span className="ms-auto text-[11px] text-zinc-600">
                    תקציב יומי: {d?.heal.today ?? 0}/3
                  </span>
                </div>
                <div className="max-h-64 space-y-1.5 overflow-auto overscroll-contain [scrollbar-width:thin]">
                  {(d?.heal.receipts ?? []).slice().reverse().map((r, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-[11px]"
                    >
                      <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", r.ok ? "bg-emerald-500" : "bg-rose-500")} aria-hidden />
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-300">{r.action}</div>
                        <div className="truncate text-zinc-500">{r.detail}</div>
                        <div className="text-zinc-600">{fmtDateTime(r.at)}</div>
                      </div>
                    </div>
                  ))}
                  {!d?.heal.receipts.length && (
                    <p className="text-xs text-zinc-600">טרם בוצע ריפוי בסשן זה — הפעולה הראשונה תתועד כאן</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* יומן החלטות */}
            <Card className="min-w-0 border-zinc-800 bg-zinc-950/40">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Bot className="size-4 text-zinc-400" aria-hidden />
                  <h3 className="text-sm font-bold">יומן התלמיד — החלטות אחרונות</h3>
                </div>
                <div className="max-h-64 space-y-1.5 overflow-auto overscroll-contain [scrollbar-width:thin]">
                  {(d?.history ?? []).slice().reverse().map((h, i) => (
                    <div key={i} className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-mono font-semibold",
                            h.kind === "ERROR" ? "text-rose-400" : h.kind === "HEAL" ? "text-emerald-500" : h.kind === "LEARN" ? "text-[#d4af37]" : "text-zinc-400",
                          )}
                        >
                          {h.kind}
                        </span>
                        <span className="ms-auto text-zinc-600">{fmtDateTime(h.at)}</span>
                      </div>
                      <p className="mt-1 leading-relaxed text-zinc-500">{h.detail}</p>
                    </div>
                  ))}
                  {!d?.history.length && <p className="text-xs text-zinc-600">ההחלטה הראשונה תתועד במחזור הקרוב</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* דוקטרינה */}
          <Card className="min-w-0 border-zinc-800/60 bg-zinc-900/20">
            <CardContent className="p-4 sm:p-5">
              <h3 className="mb-2 text-sm font-bold text-zinc-400">דוקטרינת התלמיד</h3>
              <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-zinc-600">
                {(data?.doctrine ?? []).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
