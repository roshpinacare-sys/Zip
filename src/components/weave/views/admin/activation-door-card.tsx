"use client";

// ─────────────────────────────────────────────────────────────────────
// ActivationDoorCard — דלת-ההפעלה של המפעיל (r136).
//
// הלקח החי: המפעיל הדביק מפתח בדף שלא הבין — ונדחה בלי הסבר.
// הכרטיס הזה הוא התיקון המלא, בשפה פשוטה:
//   · דלת-הפעלה אחת — הדבקה אחת של סיסמת-האב (או ה-active) מחמשת
//     את כל חוט-המפתחות: גריד + קול + כספת, ומשגר את המנוע מיד.
//   · רופא-מפתחות — הדבק כל ערך ותקבל אבחנה מדויקת: מה יש בידך,
//     לאילו תפקידים הוא שולט (נשפט חי מול שלוש-השרשראות), ומה
//     הצעד הנכון איתו. שום דבר לא נשמר לעולם.
//   · מה זה ה-seal — הסבר כנה בשפה פשוטה + מצב-הסמכות החי.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Stethoscope,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  sealedCount: number;
  total: number;
  vaultOpen: boolean;
  wroteOwnerFile: boolean;
  dispatched: boolean;
  dispatchedBackup?: boolean;
  results: ArmResultRow[];
  detailHe: string;
}

interface InspectVerdict {
  chain: string;
  role: string;
  matched: boolean;
  source: string;
}

interface InspectResult {
  ok: boolean;
  valueKind: string;
  matchedCount: number;
  opensVault: boolean | null;
  verdicts: InspectVerdict[];
  guidanceHe: string;
  noteHe: string;
}

export function ActivationDoorCard() {
  const [armKey, setArmKey] = useState("");
  const [showArmKey, setShowArmKey] = useState(false);
  const [arming, setArming] = useState(false);
  const [armResult, setArmResult] = useState<ArmAllResult | null>(null);

  const [inspectValue, setInspectValue] = useState("");
  const [showInspect, setShowInspect] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);

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

  const armAll = useCallback(async () => {
    const key = armKey.trim();
    if (!key) {
      toast.error("הדבק את סיסמת-האב או את ה-active", {
        description: "סיסמת-האב של @headcorner פותחת את הכל — כולל הכספת.",
      });
      return;
    }
    setArming(true);
    try {
      const res = await fetch("/api/arm/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const j = (await res.json()) as ArmAllResult & { reason?: string; stage?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.reason ?? j.detailHe ?? `שלב: ${j.stage ?? res.status}`);
      }
      setArmResult(j);
      setArmKey("");
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
  }, [armKey]);

  const inspect = useCallback(async () => {
    const value = inspectValue.trim();
    if (!value) {
      toast.error("הדבק ערך לאבחנה");
      return;
    }
    setInspecting(true);
    try {
      const res = await fetch("/api/arm/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const j = (await res.json()) as InspectResult & { detail?: string; reason?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.detail ?? j.reason ?? `שגיאה (${res.status})`);
      }
      setInspectResult(j);
      setInspectValue("");
    } catch (e) {
      toast.error("האבחנה נכשלה", {
        description: e instanceof Error ? e.message : "נסה שוב",
      });
    } finally {
      setInspecting(false);
    }
  }, [inspectValue]);

  return (
    <Card className="mb-6 border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.04] to-transparent">
      <CardContent className="flex flex-col gap-4 p-5">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap className="size-4 text-emerald-500" aria-hidden="true" />
            דלת-ההפעלה של המפעיל — הדבקה אחת מחמשת הכל
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
          לרשת יש שלוש דלתות, וכל אחת רוצה מפתח אחר:
          <span className="mx-1 font-semibold text-foreground">סיסמת-האב</span>
          של @headcorner היא מלך-המפתחות — ממנה נגזרים כולם, היא פותחת את הכספת ומחמשת הכל.
          <span className="mx-1 font-semibold text-foreground">מפתח-owner</span>
          הוא מפתח-הזהות העליון — מוכיח שהחשבון שלך אך לא חותם עסקאות.
          <span className="mx-1 font-semibold text-foreground">סיסמת-ה-seal</span>
          היא רק מעטפת-זהויות-ה-EVM של הרשת — ואחרי השחזור הריבוני מהשושלת (השרשרת עצמה שימשה שופט) הסמכות חיה שוב והיא כבר לא חוסמת דבר.
        </p>

        {/* דלת 1 — הפעלה אחת */}
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Zap className="size-3.5 text-emerald-500" aria-hidden="true" />
            דלת 1 · הפעלה מלאה — הדבק כאן סיסמת-אב של @headcorner (או WIF של ה-active)
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <KeyRound className="absolute inset-y-0 right-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                type={showArmKey ? "text" : "password"}
                value={armKey}
                onChange={(e) => setArmKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void armAll();
                }}
                className="border-zinc-700 bg-zinc-900/70 pr-10 pl-10 font-mono text-sm placeholder:text-zinc-600"
                placeholder="סיסמת-האב של headcorner · או 5K… / L…"
                aria-label="סיסמת-האב או ה-active להפעלה מלאה"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                disabled={arming}
              />
              <button
                type="button"
                onClick={() => setShowArmKey((v) => !v)}
                className="absolute inset-y-0 left-2 my-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showArmKey ? "הסתר" : "הצג"}
              >
                {showArmKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            <Button
              onClick={() => void armAll()}
              disabled={arming || !armKey.trim()}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {arming ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Zap className="size-4" aria-hidden="true" />}
              {arming ? "מאמת, פותח כספת ומאטים…" : "הפעל הכל"}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            מה קורה בלחיצה: המפתח נשפט מול השרשרת (ביט-מול-ביט) → סיסמת-האב נשמרת למקור-המפתח המקומי (מחוץ-לגיט) → הכספת נפתחת → חוט-המפתחות המלא
            (STEEM active+posting · HIVE active+posting · BLURT active) נשפט מול שרשרת-מקור ונאטם לכספת-הריפו → dex-grid משוגר מיד. מגבלת-קצה: 5 לשעה.
          </p>

          {armResult && (
            <div className="flex flex-col gap-1.5 rounded-md border bg-card/70 px-3 py-2 text-[11px]" dir="rtl">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="gap-1 text-[10px]">
                  {armResult.sealedCount}/{armResult.total} נאטמו
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  כספת {armResult.vaultOpen ? "נפתחה" : "לא נפתחה"}
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  מקור-מפתח מקומי {armResult.wroteOwnerFile ? "נכתב" : "לא נכתב"}
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

        {/* דלת 2 — רופא-מפתחות */}
        <div className="flex flex-col gap-2 rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Stethoscope className="size-3.5 text-sky-500" aria-hidden="true" />
            דלת 2 · רופא-מפתחות — לא בטוחים מה יש ביד? הדביקו ותקבלו אבחנה מדויקת
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <KeyRound className="absolute inset-y-0 right-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                type={showInspect ? "text" : "password"}
                value={inspectValue}
                onChange={(e) => setInspectValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void inspect();
                }}
                className="border-zinc-700 bg-zinc-900/70 pr-10 pl-10 font-mono text-sm placeholder:text-zinc-600"
                placeholder="כל סיסמה או מפתח — האבחנה בלבד, אפס שמירה"
                aria-label="ערך לאבחון"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                disabled={inspecting}
              />
              <button
                type="button"
                onClick={() => setShowInspect((v) => !v)}
                className="absolute inset-y-0 left-2 my-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showInspect ? "הסתר" : "הצג"}
              >
                {showInspect ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            <Button variant="outline" onClick={() => void inspect()} disabled={inspecting || !inspectValue.trim()} className="gap-2">
              {inspecting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Stethoscope className="size-4" aria-hidden="true" />}
              אבחן
            </Button>
          </div>

          {inspectResult && (
            <div className="flex flex-col gap-1.5 rounded-md border bg-card/70 px-3 py-2 text-[11px]" dir="rtl">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {inspectResult.valueKind === "wif" ? "WIF" : "סיסמת-אב"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {inspectResult.matchedCount} התאמות-רשות
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {inspectResult.opensVault === true ? "פותח כספת" : inspectResult.opensVault === false ? "לא פותח כספת" : "כספת לא נבדקה"}
                </Badge>
              </div>
              <p className="font-semibold leading-relaxed">{inspectResult.guidanceHe}</p>
              <div className="grid gap-0.5 sm:grid-cols-2">
                {inspectResult.verdicts.map((v) => (
                  <div key={`${v.chain}-${v.role}`} className="flex items-center gap-1.5">
                    {v.matched ? (
                      <BadgeCheck className="size-3 shrink-0 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <XCircle className="size-3 shrink-0 text-zinc-500" aria-hidden="true" />
                    )}
                    <span className="font-mono">
                      {v.chain}:{v.role}
                    </span>
                    <span className="text-muted-foreground">({v.source})</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">{inspectResult.noteHe}</p>
            </div>
          )}
        </div>

        {/* מה זה ה-seal */}
        <div className="flex items-start gap-2 rounded-lg border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold text-foreground">מה זה ה-seal?</span> זו מעטפת מוצפנת (AES-256-GCM) שמחזיקה את מפתחות-הזהות של הרשת
            עצמה — זהויות-ה-EVM שבאמצעותן הרשת חותמת אימותים ועוגנים. הסיסמה שלה היא הערך שהמפעיל מסר תחת MAIN_KEY (2026-09-21).{" "}
            {custody === "OPEN"
              ? "היום הסמכות הושבה בדרך ריבונית: המפתחות שוחזרו מהשושלת-עצמה והשרשרת אישרה את החתימה (checkpoint#906) — הסיסמה כבר לא חוסמת שום דבר."
              : "אם הסמכות סגורה — הדבקת סיסמת-האב בדלת 1 למעלה פותחת הכל, וגם שחזור-השושלת האוטומטי יכול להשיב אותה לבד."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
