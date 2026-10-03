"use client";

// ─────────────────────────────────────────────────────────────────────
// ActivationDoorCard — דלת-ההפעלה של הרשת (r136 · r185-ריבוני).
//
// r185 · D-OP-01: "אין לי סיסמת משמרת... יש לך את כל הסיסמאות שלי
// תפעיל הכל מיד" — אף מסך לא מבקש עוד אף מפתח. דלת 1 היא כפתור אחד:
// השרת שואב את ה-active מכספת-הסוכנים, משפט ביט-מול-ביט מול השרשרת,
// פותח את כספת-הארנק, מאטים את חוט-המפתחות לכספת-הריפו ומשגר את
// dex-grid — אפס קלט, אפס שאלות. רופא-המפתחות (שביקש הדבקה ידנית)
// הוסר — האבחון כולו ריבוני: המפתחות כבר בכספת ונשפטים ממנה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Vault,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ArmResultRow {
  secret: string;
  chain: string;
  role: string;
  ok: boolean;
  detailHe: string;
}

interface ArmAllResult {
  ok: boolean;
  stage: string;
  mode?: "vault-auto" | "pasted";
  sealedCount: number;
  total: number;
  vaultOpen: boolean;
  wroteOwnerFile: boolean;
  ownerFileMode?: "master" | "wif" | "already-live" | null;
  dispatched: boolean;
  dispatchedBackup?: boolean;
  results: ArmResultRow[];
  detailHe: string;
}

// r137 · מצב-החי של הבית — ההוכחה שהדלת לא רק אטמה לענן אלא גם החייתה
// את החתימה המקומית: מקור-מפתח · סולם · פאריטה · רצפת-ערך. נמדד מ-/api/money.
interface HouseStatus {
  keyPresent: boolean;
  ordersCount: number;
  deployedSteem: number | null;
  idleSteem: number | null;
  parity: number | null;
  paritySource: string | null;
  floorState: string | null;
  daemonDecision: string | null;
}

function HouseLiveStatus() {
  const [st, setSt] = useState<HouseStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/money", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: any) => {
          if (!alive) return;
          const orders = Array.isArray(j?.orders) ? j.orders : [];
          setSt({
            keyPresent: j?.keyPresent === true,
            ordersCount: orders.length,
            deployedSteem: typeof j?.deployedSteem === "number" ? j.deployedSteem : null,
            idleSteem: typeof j?.idleSteem === "number" ? j.idleSteem : null,
            parity: typeof j?.marks?.parity === "number" ? j.marks.parity : null,
            paritySource: typeof j?.marks?.paritySource === "string" ? j.marks.paritySource : null,
            floorState: typeof j?.valueFloor?.state === "string" ? j.valueFloor.state : null,
            daemonDecision: typeof j?.daemon?.lastDecision?.kind === "string" ? j.daemon.lastDecision.kind : null,
          });
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!st) return null;
  const ladderLive = st.ordersCount > 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2" dir="rtl">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-300">
        <Activity className="size-3.5 text-emerald-500" aria-hidden="true" />
        מצב-החי של הבית אחרי-החימוש · נמדד כל 45ש׳
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {st.keyPresent ? (
          <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-3" aria-hidden="true" />
            בית חתום — מקור-מפתח חי
          </Badge>
        ) : (
          <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <KeyRound className="size-3" aria-hidden="true" />
            בית עיוור — לחיצת הפעלה-ריבונית מחייה אותו
          </Badge>
        )}
        {ladderLive ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            סולם חי · {st.ordersCount} פקודות · {st.deployedSteem?.toFixed(1) ?? "?"} STEEM מוצב
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px]">
            סולם ריק · {st.idleSteem?.toFixed(1) ?? "?"} STEEM נזילים — המוביל מציב במחזור הבא
          </Badge>
        )}
        {st.parity != null ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            פאריטה {st.parity.toFixed(4)} · {st.paritySource ?? "oracle"}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px]">
            פאריטה לא נמדדה
          </Badge>
        )}
        {st.floorState && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            רצפת-ערך {st.floorState}
          </Badge>
        )}
        {st.daemonDecision && (
          <Badge variant="outline" className="gap-1 text-[10px] font-mono">
            מוביל {st.daemonDecision}
          </Badge>
        )}
      </div>
    </div>
  );
}

export function ActivationDoorCard() {
  const [arming, setArming] = useState(false);
  const [armResult, setArmResult] = useState<ArmAllResult | null>(null);
  const [custody, setCustody] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/arm/seal", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { custody?: string }) => {
        if (alive) setCustody(j.custody ?? null);
      })
      .catch(() => {
        if (alive) setCustody(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // r185 · הפעלה-ריבונית: אפס קלט — המפתח נשאב בשרת מכספת הסוכנים
  const armAll = useCallback(async () => {
    setArming(true);
    try {
      const res = await fetch("/api/arm/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as ArmAllResult & { reason?: string; stage?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.reason ?? j.detailHe ?? `שלב: ${j.stage ?? res.status}`);
      }
      setArmResult(j);
      toast.success(j.stage === "armed" ? "הכל חומש 🔥" : `חומש חלקית (${j.sealedCount}/${j.total})`, {
        description: j.detailHe,
        duration: 8000,
      });
    } catch (e) {
      toast.error("ההפעלה לא בוצעה — שום דבר לא השתנה", {
        description: e instanceof Error ? e.message : "נסה שוב",
        duration: 8000,
      });
    } finally {
      setArming(false);
    }
  }, []);

  return (
    <Card className="mb-6 border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.04] to-transparent">
      <CardContent className="flex flex-col gap-4 p-5">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap className="size-4 text-emerald-500" aria-hidden="true" />
            דלת-ההפעלה — לחיצה אחת מחמשת הכל, אפס קלט
            {custody ? (
              custody === "OPEN" ? (
                <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  סמכות חיה
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <KeyRound className="size-3" aria-hidden="true" />
                  סמכות סגורה
                </Badge>
              )
            ) : null}
          </div>
        </div>

        {/* הסבר בשפה פשוטה */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          אין כאן שאלות ואין כאן סיסמאות — לא סיסמת-משמרת ולא סיסמת-מפעיל, כאלה מעולם לא
          היו ולא יהיו. כל המפתחות של הרשת כבר אטומים בכספת הסוכנים במכונה
          (<span className="font-mono">~/.sovereign/vault</span>, 0600, מחוץ-לגיט) ובכספות
          הענן. לחיצת ההפעלה שואבת משם, משפטת מול השרשרת החיה, ומזרימה הכל: גריד, קול,
          כספת ומנוע.
        </p>

        {/* דלת 1 — הפעלה ריבונית (אפס קלט) */}
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Zap className="size-3.5 text-emerald-500" aria-hidden="true" />
            הפעלה מלאה — שואב מהכספת, משפט מול השרשרת, מאטים ומשגר
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              onClick={() => void armAll()}
              disabled={arming}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {arming ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Zap className="size-4" aria-hidden="true" />}
              {arming ? "שואב מהכספת, מאמת ומאטים…" : "הפעל הכל — אפס קלט"}
            </Button>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Vault className="size-3.5" aria-hidden="true" />
              מקור השליטה: כספת הסוכנים · שיפוט: ה-active החי של @headcorner בשרשרת
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            מה קורה בלחיצה: ה-WIF נשאב מהכספת → נשפט ביט-מול-ביט מול השרשרת → כספת-הארנק
            נפתחת → חוט-המפתחות המלא (STEEM active+posting · HIVE active+posting · BLURT
            active) נשפט מול שרשרת-מקור ונאטם לכספת-הריפו → dex-grid משוגר מיד. מגבלת-קצה:
            5 לשעה.
          </p>

          {armResult && (
            <div className="flex flex-col gap-1.5 rounded-md border bg-card/70 px-3 py-2 text-[11px]" dir="rtl">
              <div className="flex flex-wrap items-center gap-1.5">
                {armResult.mode && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    {armResult.mode === "vault-auto" ? "מקור: כספת-סוכנים" : "מקור: הדבקה"}
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1 text-[10px]">
                  {armResult.sealedCount}/{armResult.total} נאטמו
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  כספת {armResult.vaultOpen ? "נפתחה" : "לא נפתחה"}
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  מקור-מפתח מקומי{" "}
                  {armResult.ownerFileMode === "already-live"
                    ? "כבר חי (לא נדרס)"
                    : armResult.wroteOwnerFile
                      ? `נכתב${armResult.ownerFileMode ? ` (${armResult.ownerFileMode})` : ""}`
                      : "לא נכתב"}
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  dex-grid {armResult.dispatched ? "שוגר" : "לא שוגר"}
                </Badge>
                {armResult.dispatchedBackup !== undefined && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    גיבוי {armResult.dispatchedBackup ? "שוגר" : "לא שוגר"}
                  </Badge>
                )}
              </div>
              {armResult.results.map((r) => (
                <div key={r.secret} className="flex items-start gap-1.5">
                  {r.ok ? (
                    <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                  )}
                  <span className={cn("font-mono", r.ok ? "text-foreground" : "text-muted-foreground")}>
                    {r.secret}
                  </span>
                  <span className="text-muted-foreground">— {r.detailHe}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* r137 · מצב-החי — ההוכחה שהחימוש עבר עד-הבית */}
        <HouseLiveStatus />

        {/* מה זה ה-seal */}
        <div className="flex items-start gap-2 rounded-lg border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold text-foreground">מה זה ה-seal?</span> זו מעטפת מוצפנת (AES-256-GCM) שמחזיקה את מפתחות-הזהות של הרשת
            עצמה — זהויות-ה-EVM שבאמצעותן הרשת חותמת אימותים ועוגנים. הסיסמה שלה נשמרת אצל הסוכנים (MAIN_KEY בכספת) ולא אצל אף אדם.{" "}
            {custody === "OPEN"
              ? "הסמכות הושבה בדרך ריבונית: המפתחות שוחזרו מהשושלת-עצמה והשרשרת אישרה את החתימה — הכל חי ללא קלט-אדם."
              : "אם הסמכות סגורה — הסוכנים ישחזרו אותה בעצמם מהכספת; אף אחד לא נדרש לעשות דבר."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
