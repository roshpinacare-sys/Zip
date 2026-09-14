"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 1 — לוח בקרה
// KPI + תקפות שרשרת (אימות אוטומטי בעת טעינה) + סטטוסים + 8 אחרונים
// ─────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { toast } from "sonner";
import {
  Anchor,
  Bot,
  History,
  Link2,
  Quote,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorMessage } from "../api";
import { useWeave } from "../store";
import {
  ClaimTypeBadge,
  ErrorBox,
  FadeIn,
  HashChip,
  KpiSkeletonRow,
  ListSkeleton,
  MotionCard,
  scrollBoxClass,
  StatusBadge,
  truncateEnd,
} from "../shared";

const STATUS_COLORS: Record<string, string> = {
  VERIFIED: "bg-emerald-500",
  REFUTED: "bg-rose-500",
  UNMEASURED: "bg-amber-500",
  CONTESTED: "bg-rose-400",
};

export function DashboardTab() {
  const { state, attestations, report, loadState, loadAttestations, runVerify } =
    useWeave();

  useEffect(() => {
    loadState();
    loadAttestations();
    // אימות אוטומטי של השרשרת בכל כניסה ללוח הבקרה (read-only, מהיר)
    runVerify().catch(() => undefined);
  }, [loadState, loadAttestations, runVerify]);

  const onManualVerify = async () => {
    try {
      const r = await runVerify();
      if (r.valid) {
        toast.success(`שרשרת תקינה ✓ ${r.checked} רשומות`, {
          description: `חתימות EIP-191 תקינות: ${r.sigOk}/${r.checked}`,
        });
      } else {
        toast.error(`שבר בשרשרת — seq ${r.firstBreak ?? "?"}`, {
          description: "חישוב מחדש לכל אורך השרשרת גילה סטייה",
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const stateLoading = state.loading && !state.data;
  const stateError = state.error && !state.data;
  const latest = (attestations.data ?? []).slice(0, 8);
  const stats = state.data?.stats ?? {};

  if (stateError) {
    return (
      <FadeIn className="flex flex-col gap-4">
        <ErrorBox message={state.error ?? ""} onRetry={loadState} retrying={state.loading} />
      </FadeIn>
    );
  }

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* פס הדוקטרינה */}
      <Card className="border-emerald-500/25 bg-gradient-to-l from-emerald-500/10 via-transparent to-transparent p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Quote className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold sm:text-base">
              שום טענה בלי מדידה — חישוב מחדש, לא סמיכות
            </p>
            <p className="text-xs text-muted-foreground">
              טענה שלא נמדדה היא רעש · השרת קובע סטטוס, לא הלקוח · תווית אמת מוצהרת
              תמיד: REAL / LOCAL / NOT-YET
            </p>
          </div>
        </div>
      </Card>

      {/* שורת KPI */}
      {stateLoading ? (
        <KpiSkeletonRow />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">ספירת שרשרת</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums">
                  {state.data?.chainCount ?? 0}
                </p>
                <div className="mt-3">
                  <HashChip value={state.data?.headHash ?? null} label="HEAD" head={8} tail={6} />
                </div>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <Link2 className="size-4" />
              </span>
            </div>
          </MotionCard>

          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">סוכנים רשומים</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums">
                  {state.data?.agents ?? 0}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  זהויות EVM · secp256k1
                </p>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <Bot className="size-4" />
              </span>
            </div>
          </MotionCard>

          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Checkpoints</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums">
                  {state.data?.checkpoints ?? 0}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  {state.data?.lastAnchorStatus ? (
                    <Badge
                      dir="ltr"
                      className="border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-400"
                    >
                      {state.data.lastAnchorStatus}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {state.data?.lastRoot ? "Merkle root קיים" : "טרם נוצר checkpoint"}
                  </span>
                </div>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <Anchor className="size-4" />
              </span>
            </div>
          </MotionCard>

          <MotionCard className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">תקפות שרשרת</p>
                {report.loading ? (
                  <Skeleton className="mt-2 h-7 w-36" />
                ) : report.data ? (
                  report.data.valid ? (
                    <Badge className="mt-1.5 gap-1 border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="size-4" />
                      שרשרת תקינה ✓ {report.data.checked} רשומות
                    </Badge>
                  ) : (
                    <Badge className="mt-1.5 gap-1 border-rose-500/40 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-400">
                      <ShieldAlert className="size-4" />
                      שבר ב-seq {report.data.firstBreak ?? "?"}
                    </Badge>
                  )
                ) : report.error ? (
                  <Badge className="mt-1.5 border-rose-500/40 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-400">
                    האימות נכשל
                  </Badge>
                ) : (
                  <Skeleton className="mt-2 h-7 w-36" />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-11"
                  onClick={onManualVerify}
                  disabled={report.loading}
                >
                  <ShieldCheck />
                  אמת מחדש
                </Button>
              </div>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                <ShieldCheck className="size-4" />
              </span>
            </div>
          </MotionCard>
        </div>
      )}

      {/* סטטיסטיקה לפי סטטוס */}
      {stateLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-6 w-12" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["VERIFIED", "REFUTED", "UNMEASURED", "CONTESTED"] as const).map((status) => (
            <MotionCard key={status} className="p-4">
              <div className="flex items-center gap-2">
                <span
                  className={cn("size-2 shrink-0 rounded-full", STATUS_COLORS[status])}
                  aria-hidden="true"
                />
                <StatusBadge status={status} className="text-[10px]" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
                {stats[status] ?? 0}
              </p>
            </MotionCard>
          ))}
        </div>
      )}

      {/* 8 האימותים האחרונים */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
            <History className="size-4" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">
              אימותים אחרונים
            </h2>
            <p className="text-xs text-muted-foreground">
              8 הרשומות החדשות בספר — מסודרות לפי seq
            </p>
          </div>
        </div>
        {attestations.loading && !attestations.data ? (
          <ListSkeleton rows={5} />
        ) : attestations.error && !attestations.data ? (
          <ErrorBox
            message={attestations.error}
            onRetry={loadAttestations}
            retrying={attestations.loading}
          />
        ) : (
          <div className={cn(scrollBoxClass, "border")}>
            <ul className="divide-y">
              {latest.map((entry) => (
                <li
                  key={entry.seq}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 transition-colors hover:bg-muted/40"
                >
                  <span className="font-mono text-xs font-semibold text-muted-foreground" dir="ltr">
                    #{entry.seq}
                  </span>
                  <span className="text-sm font-medium">{entry.agentName}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 max-w-[16rem] flex-1 truncate text-xs text-muted-foreground sm:max-w-[24rem]">
                        {entry.claim}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[360px]">
                      <p className="text-xs leading-relaxed">{truncateEnd(entry.claim, 220)}</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="flex items-center gap-2 sm:ms-auto">
                    <ClaimTypeBadge type={String(entry.claimType)} />
                    <StatusBadge status={String(entry.status)} />
                  </span>
                </li>
              ))}
              {latest.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  אין עדיין אימותים בספר
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </section>
    </FadeIn>
  );
}
