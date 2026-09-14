"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 7 — רשת ריבונית
// הריפו הוא האמת: לב-ענן חמוש · הספר בגיט · seal · גזירת העוגנים ·
// מפת הפערים ל"הכל על גבי הרשת שלנו" · כפתור סנכרון מהריפו.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Cloud,
  Database,
  FileCheck2,
  GitBranch,
  ExternalLink,
  Globe2,
  HeartPulse,
  Landmark,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CopyButton,
  ErrorBox,
  FadeIn,
  HashChip,
  KpiSkeletonRow,
  MotionCard,
  scrollBoxClass,
  Section,
  StatusBadge,
  TruthLabel,
  truncateMiddle,
} from "../shared";

// ── DTO (משוקף מה-route) ────────────────────────────────────────────

interface SovereigntyDTO {
  truthLabel: string;
  cloud: {
    armed: boolean;
    workflow: string | null;
    schedule: string | null;
    authModel: string;
  };
  ledger: {
    file: string | null;
    repoCount: number | null;
    repoHead: string | null;
    exportedAt: string | null;
    localCount: number;
    localHead: string | null;
    relation: "IN-SYNC" | "REPO-AHEAD" | "LOCAL-AHEAD" | "NO-LEDGER" | "HEAD-MISMATCH";
  };
  seal: {
    exists: boolean;
    at?: string | null;
    rotatedAt?: string | null;
    kdf?: string | null;
    enc?: string | null;
    cloudAddress?: string | null;
    networkAddress?: string | null;
    custody?: string;
  };
  cloudAgent: { name: string; address: string; status: string } | null;
  lastBeat: {
    at: string | null;
    runner: string | null;
    mode: string;
    verdict: string | null;
    checked: number | null;
    sigOk: number | null;
    beatSeq: number | null;
    checkpoint: { index: number | null; root: string | null } | null;
    gatesClosed: Array<{ code: string; attSeq: number }>;
  } | null;
  steemLine: {
    exists: boolean;
    account?: string | null;
    opId?: string | null;
    authority?: string;
    anchorsTotal?: number;
    workflowArmed?: boolean;
    schedule?: string | null;
    custody?: string;
    anchorAttestationsTotal?: number;
    lastReportMode?: string | null;
    last?: {
      checkpoint: number | null;
      root: string | null;
      at: string | null;
      txids: Record<string, string | null> | null;
      attSeq: number | null;
      explorer: { steem: string | null; hive: string | null };
    } | null;
    lastAnchorAttestations?: Array<{
      seq: number;
      claim: string;
      evidence: string;
      createdAt: string;
    }>;
  };
  anchors: {
    derived: boolean;
    fileCount?: number | null;
    totalBytes?: number | null;
    root?: string | null;
    source?: Record<string, string> | null;
    derivedAt?: string | null;
  };
  toolkit: {
    derived: boolean;
    fileCount?: number | null;
    totalBytes?: number | null;
    root?: string | null;
    derivedAt?: string | null;
    custody?: string | null;
    attestation?: { seq: number; claim: string; createdAt: string } | null;
  };
  console: {
    repoUrl: string;
    pagesUrl: string;
    pagesHttp: number;
    pagesLive: boolean;
    rawHttp: number;
    siteSourceInRepo: boolean;
    publicStatus: {
      generatedAt: string | null;
      source?: Record<string, string> | null;
      freshness?: { verdict: string | null; ageHours: number | null; thresholdHours: number | null } | null;
      witness?: {
        checkpoint: number | null;
        root: string | null;
        txid: string | null;
        at: string | null;
        attestations: number | null;
        explorer: string | null;
      } | null;
    } | null;
    architecture?: string;
    attestation?: { seq: number; claim: string; createdAt: string } | null;
  };
  sovGates: Array<{
    code: string;
    title: string;
    state: string;
    attSeq: number | null;
    gate: string;
  }>;
  git: { remote: string | null; lastCommit: string | null; dirty: number };
  gaps: Array<{ id: string; title: string; missing: string; path: string }>;
  sovereigntyDoc: string | null;
}

interface SyncReport {
  ok: boolean;
  synced?: boolean;
  reason?: string;
  imported?: Record<string, number>;
  keysPreserved?: { agents: number; network: boolean };
  remote?: { chainCount: number; headHash: string; exportedAt: string };
  verify?: { valid: boolean; checked: number; sigOk: number; sigFail: number };
  error?: string;
}

const RELATION_META: Record<
  SovereigntyDTO["ledger"]["relation"],
  { label: string; tone: string; hint: string }
> = {
  "IN-SYNC": {
    label: "מסונכרן",
    tone: "text-emerald-600 dark:text-emerald-400",
    hint: "ה-DB המקומי והספר בריפו זהים בדיוק",
  },
  "REPO-AHEAD": {
    label: "הריפו קדימה",
    tone: "text-amber-600 dark:text-amber-400",
    hint: "יש פעימות חדשות בריפו (למשל מהענן) — משוך סנכרון",
  },
  "LOCAL-AHEAD": {
    label: "המקומי קדימה",
    tone: "text-amber-600 dark:text-amber-400",
    hint: "ה-DB המקומי חדש — דחוף פעימה (bun scripts/weave-beat.ts --local)",
  },
  "NO-LEDGER": {
    label: "אין ספר בריפו",
    tone: "text-zinc-500",
    hint: "sovereign/ledger.json טרם נוצר — הפעימה הראשונה תייצא אותו",
  },
  "HEAD-MISMATCH": {
    label: "סתירת head",
    tone: "text-rose-600 dark:text-rose-400",
    hint: "אורך זהה אך head שונה — נדרשת בדיקה ידנית",
  },
};

export function SovereigntyTab() {
  const [data, setData] = useState<SovereigntyDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/weave/sovereignty", { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; sovereignty?: SovereigntyDTO; error?: string };
      if (!json.ok || !json.sovereignty) throw new Error(json.error ?? "טעינת ריבונות נכשלה");
      setData(json.sovereignty);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncReport(null);
    try {
      const res = await fetch("/api/weave/sovereignty/sync", { method: "POST" });
      const json = (await res.json()) as SyncReport;
      setSyncReport(json);
      if (json.ok && json.synced) {
        toast.success(
          `נמשכו ${json.remote?.chainCount ?? "?"} אימותים מהריפו · אימות מחדש: ${
            json.verify?.valid ? "תקין ✓" : "שבור ✗"
          }`
        );
      } else if (json.ok) {
        toast.info(json.reason ?? "כבר מסונכרן");
      } else {
        toast.error(json.error ?? "הסנכרון נכשל");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "הסנכרון נכשל");
    } finally {
      setSyncing(false);
    }
  }, [load]);

  if (loading && !data) {
    return (
      <FadeIn className="flex flex-col gap-4 sm:gap-6">
        <KpiSkeletonRow count={4} />
      </FadeIn>
    );
  }
  if (error) {
    return <ErrorBox message={error} onRetry={() => void load()} />;
  }
  if (!data) return null;

  const rel = RELATION_META[data.ledger.relation];
  const beatIsCloud = data.lastBeat?.runner === "github-actions";

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* ── כרטיסי KPI ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Cloud className="h-4 w-4" />
            לב-ענן
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-lg font-semibold",
                data.cloud.armed
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              )}
            >
              {data.cloud.armed ? "חמוש ✓" : "לא חמוש"}
            </span>
            <TruthLabel kind="REAL" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data.cloud.schedule ?? "—"} ·{" "}
            <span dir="ltr" className="font-mono">
              {data.cloud.workflow ?? "—"}
            </span>
          </p>
        </MotionCard>

        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <GitBranch className="h-4 w-4" />
            ספר בריפו
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={cn("text-lg font-semibold", rel.tone)}>{rel.label}</span>
            <TruthLabel kind="LOCAL" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            מקומי {data.ledger.localCount} · ריפו {data.ledger.repoCount ?? "—"} ·{" "}
            {data.ledger.exportedAt
              ? new Date(data.ledger.exportedAt).toLocaleString("he-IL")
              : "לא ייוצא"}
          </p>
        </MotionCard>

        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <HeartPulse className="h-4 w-4" />
            פעימה אחרונה
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-lg font-semibold",
                data.lastBeat?.verdict?.startsWith("LEDGER-VALID")
                  ? "text-emerald-600 dark:text-emerald-400"
                  : data.lastBeat
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-zinc-500"
              )}
            >
              {data.lastBeat ? (beatIsCloud ? "ענן" : "מקומית") : "אין"}
            </span>
            <StatusBadge status={data.lastBeat?.verdict?.startsWith("LEDGER-VALID") ? "VERIFIED" : data.lastBeat ? "REFUTED" : "UNMEASURED"} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data.lastBeat?.at ? new Date(data.lastBeat.at).toLocaleString("he-IL") : "—"}
            {data.lastBeat?.beatSeq ? ` · seq ${data.lastBeat.beatSeq}` : ""}
            {data.lastBeat?.checkpoint ? ` · cp #${data.lastBeat.checkpoint.index}` : ""}
          </p>
        </MotionCard>

        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Landmark className="h-4 w-4" />
            גזירת העוגנים
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-lg font-semibold",
                data.anchors.derived
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-500"
              )}
            >
              {data.anchors.derived ? "נארג ✓" : "טרם"}
            </span>
            <TruthLabel kind="REAL" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data.anchors.derived
              ? `${data.anchors.fileCount ?? "?"} קבצים ⇒ שורש מרקל בספר`
              : "הארכיון עדיין לא נגרר לשורש"}
          </p>
        </MotionCard>
      </div>

      {/* ── שרשרת הריבונות — דיאגרמה ── */}
      <Section
        title="שרשרת הריבונות — מי מפעיל את מי"
        icon={<Globe2 />}
        description="הסנדבוקס הוא workspace; הריפו הוא האמת; הענן הוא המנוע שלא מת"
      >
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-5">
              {[
                {
                  icon: Server,
                  title: "Runner ראשי",
                  sub: "סנדבוקס / מקומי",
                  body: "פעימה מלאה: pull → verify → attest → checkpoint → push",
                  tone: "border-amber-500/40",
                },
                {
                  icon: GitBranch,
                  title: "הבית בריפו",
                  sub: "roshpinacare-sys · weave-core",
                  body: "ledger.json + seal + workflow + הקוד — שורד איפוסים",
                  tone: "border-emerald-500/40",
                },
                {
                  icon: Cloud,
                  title: "לב-ענן",
                  sub: "GitHub Actions · כל 6 שעות",
                  body: "ספר טרי ⇒ אימות-בלבד · ישן ⇒ TAKEOVER",
                  tone: "border-emerald-500/40",
                },
                {
                  icon: HeartPulse,
                  title: "פעימה חתומה",
                  sub: "EIP-191 · מפתח מה-seal",
                  body: "אימות MEASUREMENT נמדד + checkpoint EIP-712",
                  tone: "border-emerald-500/40",
                },
                {
                  icon: ShieldCheck,
                  title: "שער-סודות",
                  sub: "לפני כל דחיפה",
                  body: "WIF/PEM/PAT/מפתח ב-diff ⇒ חסימה מוחלטת",
                  tone: "border-rose-500/40",
                },
              ].map((step, i) => (
                <div
                  key={step.title}
                  className={cn(
                    "relative flex flex-col gap-2 rounded-lg border bg-zinc-50 p-3 dark:bg-zinc-900/60",
                    step.tone
                  )}
                >
                  <div className="flex items-center gap-2">
                    <step.icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span className="text-sm font-semibold">{step.title}</span>
                    <span className="mr-auto font-mono text-[10px] text-zinc-400">{i + 1}/5</span>
                  </div>
                  <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {step.sub}
                  </div>
                  <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {step.body}
                  </div>
                  {i < 4 && (
                    <ArrowLeftRight className="absolute -left-2 top-1/2 hidden h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-300 md:block ltr:-rotate-90" />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              שיפוט הבריאות — השרשרת עצמה: טריות האימות האחרון בספר + הדחיפה האחרונה בגיט.
              אין תיאום, אין שרת-בחירות, אין אמון בין runners. מפתח המפעיל לא נחוץ בענן —{" "}
              <span dir="ltr" className="font-mono">
                {data.cloud.authModel}
              </span>
            </p>
          </CardContent>
        </Card>
      </Section>

      {/* ── הספר בריפו + סנכרון ── */}
      <Section
        title="הספר בריפו מול העותק המקומי"
        icon={<Database />}
        description="ledger.json = אמת קנונית חסרת-סודות; SQLite = מטמון שנבנה ממנה"
      >
        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <HashChip value={data.ledger.repoHead ?? "—"} label="head בריפו" />
              <HashChip value={data.ledger.localHead ?? "—"} label="head מקומי" />
              <Button
                onClick={() => void runSync()}
                disabled={syncing}
                size="sm"
                className="h-11 gap-2 px-4"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? "מסנכרן…" : "משוך מהריפו"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {rel.hint} · git:{" "}
              <span dir="ltr" className="font-mono">
                {data.git.remote ?? "אין remote מקומי"}
              </span>{" "}
              {data.git.lastCommit ? `· commit ${truncateMiddle(data.git.lastCommit.split(" ")[0], 8, 0)}` : ""}
              {data.git.dirty > 0 ? ` · ${data.git.dirty} שינויים מקומיים לא מחויבים` : ""}
            </p>
            {syncReport && (
              <div
                className={cn(
                  "rounded-md border p-3 text-xs leading-relaxed",
                  syncReport.ok && syncReport.synced
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : syncReport.ok
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-rose-500/40 bg-rose-500/5"
                )}
              >
                {syncReport.ok && syncReport.synced ? (
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      ייובאו {syncReport.imported?.attestations ?? "?"} אימותים · מפתחות מקומיים
                      שנשמרו: {syncReport.keysPreserved?.agents ?? 0}
                    </span>
                    <span>
                      אימות לאחר ייבוא:{" "}
                      {syncReport.verify?.valid
                        ? `תקין ✓ (${syncReport.verify.sigOk}/${syncReport.verify.checked} חתימות)`
                        : "שבור ✗ — עצור ובדוק"}
                    </span>
                  </div>
                ) : syncReport.ok ? (
                  <span>{syncReport.reason}</span>
                ) : (
                  <span className="text-rose-700 dark:text-rose-300">{syncReport.error}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* ── ה-seal + סוכן הענן ── */}
      <Section
        title="משמורת הזהויות — ה-seal"
        icon={<Lock />}
        description="מפתחות במעטפת מוצפנת; הסיסמה במשמרת מפוצלת — Secrets (ענן) + .env.local (מקומי) + כספת המפעיל"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4" />
                sovereign/weave-seal.enc
                <TruthLabel kind="REAL" />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {data.seal.exists ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">הצפנה</span>
                    <span dir="ltr" className="font-mono text-xs">
                      {data.seal.enc} · {data.seal.kdf}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">כתובת ענן</span>
                    <HashChip value={data.seal.cloudAddress ?? "—"} label="" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">כתובת רשת</span>
                    <HashChip value={data.seal.networkAddress ?? "—"} label="" />
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {data.seal.custody}
                    {data.seal.at ? ` · נחתם ${new Date(data.seal.at).toLocaleString("he-IL")}` : ""}
                    {data.seal.rotatedAt
                      ? ` · סובב ${new Date(data.seal.rotatedAt).toLocaleString("he-IL")}`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  seal טרם נוצר — הרץ{" "}
                  <span dir="ltr" className="font-mono text-xs">
                    bun scripts/weave-seal.ts --create
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cloud className="h-4 w-4" />
                סוכן הענן — weave-cloud-heart
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {data.cloudAgent ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">זהות EVM</span>
                    <HashChip value={data.cloudAgent.address} label="" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">סטטוס</span>
                    <StatusBadge status={data.cloudAgent.status === "ACTIVE" ? "VERIFIED" : "UNMEASURED"} />
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    חותם את אימותי הפעימה; מפתחו חי רק ב-seal — לעולם לא בספר ולא ב-DB המיוצא.
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  הסוכן נולד בפעימה הראשונה (ensureCloudAgent מה-seal).
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ── גזירת העוגנים ── */}
      {data.anchors.derived && (
        <Section
          title="גזירת העוגנים — הארכיון המת הפך לעדות נצחית"
          icon={<FileCheck2 />}
          description="כל קובץ ⇒ sha256 · עלה=keccak256(path:sha256) · שורש מרקל נרשם בספר"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <HashChip value={data.anchors.root ?? "—"} label="merkleRoot" />
                <CopyButton value={data.anchors.root ?? ""} label="העתק שורש" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קבצים</div>
                  <div className="font-mono">{data.anchors.fileCount ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נפח</div>
                  <div className="font-mono">
                    {(((data.anchors.totalBytes ?? 0) / 1024) || 0).toFixed(0)}KB
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">מקור</div>
                  <div dir="ltr" className="font-mono text-xs">
                    {data.anchors.source?.repo ?? "—"}
                    {data.anchors.source?.commit
                      ? `@${truncateMiddle(data.anchors.source.commit, 8, 0)}`
                      : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נגזר</div>
                  <div className="font-mono text-xs">
                    {data.anchors.derivedAt
                      ? new Date(data.anchors.derivedAt).toLocaleString("he-IL")
                      : "—"}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                הכלל שנגזר מהעוגנים: עוגן שרק "יושב" = ארכיון; עוגן שנכנס לשרשרת-חתומה = כוח.
                מרגע זה, שינוי של בית אחד בארכיון ניתן לאיתור ע״י חישוב-מחדש מכל clone.
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── הקונסולה הציבורית — החלון חסר-המפתחות (G5) ── */}
      {data.console && (
        <Section
          title="הקונסולה הציבורית — הרשת מפרסמת את עצמה בחוץ"
          icon={<Globe2 />}
          description="ריפו ציבורי שמפרסם את קו העוגנים חזרה מהשרשרת · אפס סודות · אפס תלות בסנדבוקס"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                {data.console.attestation ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    G5 SEALED · att {data.console.attestation.seq}
                  </span>
                ) : data.console.pagesLive ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    PAGES LIVE · ממתין לאימות החתום של המחזור הבא
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    SELF-PUBLISHING · ממתין להפעלת Pages (המפעיל)
                  </span>
                )}
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  raw {data.console.rawHttp} · pages {data.console.pagesHttp}
                </span>
                <a
                  href={data.console.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  הריפו הציבורי <ExternalLink className="size-3" />
                </a>
                {data.console.pagesLive && (
                  <a
                    href={data.console.pagesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    האתר בחוץ <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">עד חיצוני</div>
                  <div className="font-mono">
                    {data.console.publicStatus?.witness?.checkpoint != null
                      ? `cp#${data.console.publicStatus.witness.checkpoint}`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">טריות בחוץ</div>
                  <div className="font-mono">
                    {data.console.publicStatus?.freshness?.verdict
                      ? `${data.console.publicStatus.freshness.verdict} · ${
                          data.console.publicStatus.freshness.ageHours ?? "?"
                        }h`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">פורסם</div>
                  <div className="font-mono text-xs">
                    {data.console.publicStatus?.generatedAt
                      ? new Date(data.console.publicStatus.generatedAt).toLocaleString("he-IL")
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">מקור האתר</div>
                  <div className="font-mono text-xs">
                    {data.console.siteSourceInRepo ? "בריפו הריבוני (console/)" : "חסר"}
                  </div>
                </div>
              </div>
              {data.console.publicStatus?.witness?.txid && (
                <div className="flex flex-wrap items-center gap-3">
                  <HashChip
                    value={data.console.publicStatus.witness.txid}
                    label="witness txid (on-chain)"
                  />
                  {data.console.publicStatus.witness.explorer && (
                    <a
                      href={data.console.publicStatus.witness.explorer}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      steemscan <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              )}
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                ארכיטקטורה חסרת-מפתחות: workflow בריפו הציבורי קורא את קו העוגנים מ-Steem
                RPC ציבורי (custom_json מהעד בסמכות posting), מרנדר status.json ומבצע
                commit ב-GITHUB_TOKEN שלו בלבד — כל 6 שעות (פעימה :00 → עיגון :20 →
                קריאה-חזרה :40). מוות של הסנדבוקס או של הריפו הפרטי לא מפיל את החלון.
                מה שלא עולה לחוץ לעולם: מפתחות, טוקנים, יתרות, מסמכים פנימיים (CONSOLE-POLICY.md).
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── ערכת הכלים — משמרת בת-קיימא ── */}
      {data.toolkit?.derived && (
        <Section
          title="ערכת הכלים — ה-toolkit הפך לנכס מאומת"
          icon={<FileCheck2 />}
          description="5 zips + פריצה מלאה ⇒ שורש מרקל בספר · הבתים במשמרת Project-files"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <HashChip value={data.toolkit.root ?? "—"} label="merkleRoot" />
                <CopyButton value={data.toolkit.root ?? ""} label="העתק שורש" />
                {data.toolkit.attestation ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    VERIFIED · att {data.toolkit.attestation.seq}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    שורש נגזר · ממתין לאימות
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קבצים</div>
                  <div className="font-mono">{data.toolkit.fileCount ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נפח</div>
                  <div className="font-mono">
                    {(((data.toolkit.totalBytes ?? 0) / 1024 / 1024) || 0).toFixed(1)}MB
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">משמרת הבתים</div>
                  <div className="font-mono text-xs">Project-files</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נגזר</div>
                  <div className="font-mono text-xs">
                    {data.toolkit.derivedAt
                      ? new Date(data.toolkit.derivedAt).toLocaleString("he-IL")
                      : "—"}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                ה-zips המקוריים הוצלבו מול ה-blob-sha של Project-files (5/5 זהים לבית) · הורדה עתידית
                מאומתת מול השורש בספר — מות הסנדבוקס לא מאבד מה-toolkit דבר.
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── קו ה-Steem/Hive ── */}
      {data.steemLine?.exists && (
        <Section
          title="קו ה-Steem/Hive — הספר מעיד על עצמו מחוץ לגיטהאב"
          icon={<Globe2 />}
          description="root של ה-checkpoint עולה כ-custom_json על שתי שרשראות ציבוריות · ה-txids חוזרים לספר כאימות ANCHOR חתום"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  status={
                    data.steemLine?.last && (data.steemLine.last.txids?.steem || data.steemLine.last.txids?.hive)
                      ? "VERIFIED"
                      : "UNMEASURED"
                  }
                />
                <span dir="ltr" className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  @{data.steemLine?.account ?? "—"} · {data.steemLine?.opId ?? "—"}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {data.steemLine?.authority ?? ""}
                </span>
              </div>
              {data.steemLine?.last ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <HashChip value={data.steemLine.last.root ?? "—"} label={`cp#${data.steemLine.last.checkpoint ?? "?"}`} />
                    {data.steemLine.last.attSeq != null && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        אימות ANCHOR seq {data.steemLine.last.attSeq}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.steemLine.last.txids?.steem && (
                      <a
                        href={data.steemLine.last.explorer.steem ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Steem · {truncateMiddle(data.steemLine.last.txids.steem, 10, 6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {data.steemLine.last.txids?.hive && (
                      <a
                        href={data.steemLine.last.explorer.hive ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Hive · {truncateMiddle(data.steemLine.last.txids.hive, 10, 6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      עוגן {data.steemLine.last.at ? new Date(data.steemLine.last.at).toLocaleString("he-IL") : "—"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  הקו חמוש אך טרם עוגן — הריצה היומית (07:17Z) או dispatch ידני יעגנו את ה-checkpoint האחרון.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">עוגנים בקו</div>
                  <div className="font-mono">{data.steemLine?.anchorsTotal ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">אימותי ANCHOR בספר</div>
                  <div className="font-mono">{data.steemLine?.anchorAttestationsTotal ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">workload ענן</div>
                  <div className="font-mono text-xs" dir="ltr">
                    {data.steemLine?.workflowArmed ? "weave-anchor.yml" : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קצב</div>
                  <div className="font-mono text-xs" dir="ltr">{data.steemLine?.schedule ?? "—"}</div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {data.steemLine?.custody}
                {" · העדות חיה לנצח מול ה-RPC הציבורי — בלי לסמוך עלינו ועל גיטהאב כלל."}
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── שערי SOV ── */}
      <Section
        title="שערי הריבונות — SOV"
        icon={<ShieldCheck />}
        description="כל שער נסגר רק ע״י אימות VERIFIED — הרשת סוגרת לעצמה"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.sovGates.map((g) => (
            <MotionCard key={g.code} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{g.code}</span>
                <StatusBadge status={g.state === "DONE" ? "VERIFIED" : "UNMEASURED"} />
              </div>
              <div className="mt-1 text-sm font-medium">{g.title}</div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {g.gate}
              </p>
              {g.attSeq != null && (
                <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  נסגר עם אימות #{g.attSeq}
                </div>
              )}
            </MotionCard>
          ))}
        </div>
      </Section>

      {/* ── מפת הפערים ── */}
      <Section
        title="מה חסר עוד ל׳הכל על גבי הרשת׳"
        icon={<Siren />}
        description="שישה פערים בלבד — כולם נסגרים באותה שיטה: עוד workflow + עוד שורה חתומה בספר"
      >
        <Card>
          <CardContent className="p-0">
            <div className={cn("max-h-96 overflow-y-auto", scrollBoxClass)}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-14">#</TableHead>
                    <TableHead>הפער</TableHead>
                    <TableHead className="hidden md:table-cell">למה חסר</TableHead>
                    <TableHead className="hidden lg:table-cell">הדרך לסגירה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.gaps.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-mono text-xs">{g.id}</TableCell>
                      <TableCell className="font-medium">{g.title}</TableCell>
                      <TableCell className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:table-cell">
                        {g.missing}
                      </TableCell>
                      <TableCell className="hidden text-xs text-zinc-500 dark:text-zinc-400 lg:table-cell">
                        {g.path}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          המסמך המלא:{" "}
          <span dir="ltr" className="font-mono">
            {data.sovereigntyDoc ?? "SOVEREIGNTY.md"}
          </span>{" "}
          בשורש הריפו — כולל ההסקה (I1-I5), הרכיבים שנבנו ותורת העוגנים.
        </p>
      </Section>

      {/* ── פעימה אחרונה — פירוט ── */}
      {data.lastBeat && (
        <Section
          title="הפעימה האחרונה — פירוט מלא"
          icon={<HeartPulse />}
          description="הדוח כפי שנכתב ע״י ה-runner שהריץ (מקומי או ענן)"
        >
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 text-sm sm:p-6">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">מתי: </span>
                  {data.lastBeat.at ? new Date(data.lastBeat.at).toLocaleString("he-IL") : "—"}
                </span>
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">runner: </span>
                  <span dir="ltr" className="font-mono text-xs">
                    {data.lastBeat.runner}
                  </span>{" "}
                  ({data.lastBeat.runner === "github-actions" ? "הענן" : "מקומי"})
                </span>
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">מצב: </span>
                  <span dir="ltr" className="font-mono text-xs">
                    {data.lastBeat.mode}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">פסק-דין: </span>
                  <span
                    className={cn(
                      "font-medium",
                      data.lastBeat.verdict?.startsWith("LEDGER-VALID")
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    )}
                    dir="ltr"
                  >
                    {data.lastBeat.verdict ?? "—"}
                  </span>
                </span>
                {data.lastBeat.checked != null && (
                  <span>
                    <span className="text-zinc-500 dark:text-zinc-400">אימותים: </span>
                    {data.lastBeat.checked} · חתימות {data.lastBeat.sigOk ?? 0}/
                    {data.lastBeat.checked}
                  </span>
                )}
              </div>
              {data.lastBeat.checkpoint?.root && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-zinc-500 dark:text-zinc-400">checkpoint:</span>
                  <HashChip value={data.lastBeat.checkpoint.root} label={`#${data.lastBeat.checkpoint.index}`} />
                </div>
              )}
              {data.lastBeat.gatesClosed.length > 0 && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400">
                  שערים שנסגרו בפעימה:{" "}
                  {data.lastBeat.gatesClosed
                    .map((g) => `${g.code} ← אימות #${g.attSeq}`)
                    .join(" · ")}
                </div>
              )}
            </CardContent>
          </Card>
        </Section>
      )}
    </FadeIn>
  );
}
