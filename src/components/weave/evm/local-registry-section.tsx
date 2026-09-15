"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · רישום העוגן המקומי · שער EVM-2 (LOCAL) —
// מראה של החוזה WeaveAnchorRegistry כפי שהוא "רץ" בשרת:
// roots[++latestIndex] ב-SQLite, לכל root הקללות שלו.
// ואימות מלא של הכללה מול root ברישום: חישוב-מחדש של העלה,
// הוכחת Merkle והתאמת root — אותה הוכחה בדיוק תאומת מול
// שרשרת אמיתית כש-EVM-2 ייסגר. תווית אמת: LOCAL.
// ─────────────────────────────────────────────────────────────────────

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Boxes, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LocalAnchorDTO, RegistryVerifyDTO } from "@/lib/weave/evmext-types";
import { apiFetch, errorMessage } from "../api";
import {
  CopyButton,
  ErrorBox,
  HashChip,
  MotionCard,
  scrollBoxClass,
  TruthLabel,
  fmtDateTime,
} from "../shared";
import { CheckRow } from "./bits";
import type { LocalAnchorsSlice } from "./use-local-anchors";

export function LocalRegistrySection({
  anchors,
  onReload,
}: {
  anchors: LocalAnchorsSlice;
  onReload: () => void;
}) {
  const list = anchors.data ?? [];
  // הרשימה מסודרת יורד לפי registryIndex — הראשון הוא latestIndex
  const latestIndex = list.length > 0 ? list[0].registryIndex : 0;

  return (
    <MotionCard className="p-4 sm:p-6">
      {/* שורת כותרת + רענון */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Boxes className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">רישום עוגן מקומי · שער EVM-2</h3>
            <TruthLabel kind="LOCAL" />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            מראה של{" "}
            <span dir="ltr" className="font-mono">
              WeaveAnchorRegistry
            </span>{" "}
            בשרת —{" "}
            <span dir="ltr" className="font-mono">
              roots[++latestIndex]
            </span>{" "}
            ב-SQLite. אותה הוכחת הכללה בדיוק תאומת מול שרשרת אמיתית כשהשער
            ייסגר.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={onReload}
          disabled={anchors.loading}
          aria-label="רענן את הרישום המקומי"
        >
          {anchors.loading ? "מרענן…" : "רענן"}
        </Button>
      </div>

      {/* גוף הרישום */}
      {anchors.loading && !anchors.data ? (
        <div className="mt-4">
          <Skeleton className="h-5 w-48" />
          <div className="mt-3 flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
      ) : anchors.error && !anchors.data ? (
        <div className="mt-4">
          <ErrorBox message={anchors.error} onRetry={onReload} retrying={anchors.loading} />
        </div>
      ) : list.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Boxes className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">הרישום עוד ריק</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            עגן checkpoint למעלה — ה-root שלו יירשם כאן כאילו נשלחה tx לחוזה
          </p>
        </div>
      ) : (
        <>
          {/* סיכום — כמו קריאת latestIndex() / roots.length */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge
              dir="ltr"
              className="border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-400"
            >
              latestIndex = {latestIndex}
            </Badge>
            <Badge
              dir="ltr"
              variant="secondary"
              className="font-mono text-[10px]"
            >
              {list.length} roots
            </Badge>
          </div>

          <ul className={cn(scrollBoxClass, "mt-3 flex flex-col gap-3 pe-1")}>
            {list.map((anchor) => (
              <AnchorRow key={anchor.registryIndex} anchor={anchor} />
            ))}
          </ul>
        </>
      )}
    </MotionCard>
  );
}

// ── שורת רישום אחת — root שירד + הוכחת הכללה של אימות מולו ──────────

function AnchorRow({ anchor }: { anchor: LocalAnchorDTO }) {
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(String(anchor.attFrom));
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RegistryVerifyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const covered = anchor.attTo - anchor.attFrom + 1;

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    const seqNum = Number(seq);
    if (!Number.isInteger(seqNum)) {
      toast.error("נדרש seq — מספר שלם");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ report: RegistryVerifyDTO }>(
        "/api/weave/registry/verify",
        {
          method: "POST",
          body: JSON.stringify({ seq: seqNum, index: anchor.checkpointIndex }),
        }
      );
      setReport(res.report);
      const allOk =
        res.report.leafRecomputedMatch &&
        res.report.rootInRegistry &&
        res.report.proofValid;
      if (allOk) {
        toast.success(
          `הכללה של seq ${seqNum} אומתה מול root ברישום #${anchor.registryIndex}`,
          { description: `${res.report.proof.length} צעדי הוכחה · Merkle תקף` }
        );
      } else {
        toast.error("האימות הושלם עם כשלים — ראה את השורות המסומנות");
      }
    } catch (err) {
      setReport(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          dir="ltr"
          className="border-amber-500/40 bg-amber-500/10 font-mono text-xs text-amber-700 dark:text-amber-400"
        >
          #{anchor.registryIndex}
        </Badge>
        <span className="text-sm font-semibold">
          checkpoint{" "}
          <span dir="ltr" className="font-mono">
            #{anchor.checkpointIndex}
          </span>
        </span>
        <Badge variant="secondary" dir="ltr" className="font-mono text-[10px]">
          seq {anchor.attFrom} → {anchor.attTo} · {covered} leaves
        </Badge>
        <span className="text-xs text-muted-foreground sm:ms-auto">
          {fmtDateTime(anchor.anchoredAt)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">root ברישום</dt>
          <dd>
            <HashChip value={anchor.root} head={8} tail={6} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">עוגן ע"י (relayer)</dt>
          <dd>
            <HashChip value={anchor.anchoredBy} head={8} tail={6} copy={false} />
          </dd>
        </div>
      </dl>

      {anchor.calldata ? (
        <div className="mt-3 rounded-lg border bg-muted/50 p-2" dir="ltr">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              calldata · anchor(bytes32)
            </span>
            <CopyButton value={anchor.calldata} label="calldata" className="size-6" />
          </div>
          <p className="truncate px-1 pt-1 font-mono text-[11px]">{anchor.calldata}</p>
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`הוכחת הכללה מול root ברישום ${anchor.registryIndex}`}
        >
          <ShieldCheck />
          {open ? "סגור הוכחה" : "הוכחת הכללה"}
        </Button>
      </div>

      {/* פאנל הוכחת הכללה — בחירת seq בטווח ואימות מלא מול ה-root */}
      {open ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            בחר אימות (seq) בטווח{" "}
            <span dir="ltr" className="font-mono">
              {anchor.attFrom}–{anchor.attTo}
            </span>{" "}
            — השרת יחשב את העלה מחדש מהרשומה, יבנה הוכחת Merkle ויאמת אותה
            מול ה-root שברישום.
          </p>

          <form onSubmit={onVerify} className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              dir="ltr"
              type="number"
              inputMode="numeric"
              className="h-11 w-32 font-mono"
              value={seq}
              min={anchor.attFrom}
              max={anchor.attTo}
              onChange={(e) => setSeq(e.target.value)}
              aria-label="seq של האימות לאימות הכללה"
            />
            <Button
              type="submit"
              className="h-11 border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              disabled={busy}
            >
              {busy ? "מאמת…" : "אמת הכללה"}
            </Button>
          </form>

          {error ? (
            <div className="mt-3">
              <ErrorBox message={error} />
            </div>
          ) : null}

          {report ? (
            <div className="mt-3 flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                <CheckRow
                  ok={report.leafRecomputedMatch}
                  label="העלה חושבה מחדש מהרשומה — תואמת"
                  hint="hashEntry(רשומת האימות) === entryHash השמור — לא סמיכות על השדה"
                />
                <CheckRow
                  ok={report.rootInRegistry}
                  label={`ה-root רשום ברישום #${report.registryIndex}`}
                  hint="roots[registryIndex] === root ה-checkpoint"
                />
                <CheckRow
                  ok={report.proofValid}
                  label="הוכחת Merkle תקפה מול ה-root"
                  hint={`${report.proof.length} צעדי הוכחה · verifyMerkleProof(leaf, proof, root, index)`}
                />
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                <HashChip
                  value={report.entryHash}
                  label={`entryHash · seq ${report.seq}`}
                  head={8}
                  tail={6}
                />
                <HashChip
                  value={report.root}
                  label="root מאומת"
                  head={8}
                  tail={6}
                  copy={false}
                />
              </div>

              {report.proof.length > 0 ? (
                <div dir="ltr" className="rounded-lg border bg-muted/40 p-2">
                  <p className="px-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    merkle proof · {report.proof.length} siblings
                  </p>
                  <ol className="mt-1 flex flex-col gap-1">
                    {report.proof.map((step, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 px-1 font-mono text-[11px]"
                      >
                        <span className="shrink-0 text-muted-foreground">
                          [{i}]
                        </span>
                        <span className="truncate">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <p className="text-[11px] text-muted-foreground">
                אומת ב-{fmtDateTime(report.verifiedAt)} · מצב{" "}
                <span dir="ltr" className="font-mono">
                  {report.mode}
                </span>{" "}
                — סימולציית חוזה בשרת, לא שרשרת
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
