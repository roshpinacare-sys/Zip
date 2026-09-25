"use client";

// ─────────────────────────────────────────────────────────────────────
// GridArmCard — דלת חימום הגריד החוץ (R37).
//
// הגריד החיצוני בנוי, נמדד (פרימיית-SBD חיה של +18%–29%) ומתוזמן
// (יומי 03:17 UTC — תופס את דלק-ה-powerdown של 02:01) — אך נעול על
// סוד-ריפו אחד. כרטיס זה הוא הדלת: המפעיל מזין את המפתח פעם אחת,
// השרת מאמת מול השרשרת ואוטם ישר אל הכספת המוצפנת של הריפו.
// המפתח לא נשמר בשום מקום אחר — לא בסנדבוקס, לא בלוג, לא בתשובה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  Eye,
  EyeOff,
  Flame,
  Fuel,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Swords,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import { useOperator } from "@/components/weave/operator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ArmGridState {
  ok: boolean;
  repo: string;
  secretPresent: boolean | null;
  secretUpdatedAt: string | null;
  nextScheduledRun: string | null;
  grid: {
    armed: boolean;
    verdict: string;
    blocker: string[];
    fuel: {
      powerdownActive: boolean;
      weeklySp?: number;
      weeklyUsd?: number;
      nextPayout?: string;
      remainingSp?: number;
    } | null;
    inventory: { steem?: number; sbd?: number } | null;
    publishedAt: string;
  } | null;
}

function payoutLabel(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return "התשלום כבר יצא / הבא בדרך";
  const h = Math.round(diffMs / 3_600_000);
  if (h < 48) return `בעוד ~${h} שע׳ (${d.toLocaleDateString("he-IL")} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })})`;
  return d.toLocaleString("he-IL");
}

export function GridArmCard() {
  const { authedFetch, status } = useOperator();
  const [state, setState] = useState<ArmGridState | null>(null);
  const [loading, setLoading] = useState(false);
  const [arming, setArming] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/admin/arm-grid");
      const j = (await res.json()) as ArmGridState & { error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `שגיאה (${res.status})`);
      setState(j);
    } catch (e) {
      setState(null);
      toast.error("טעינת מצב הגריד נכשלה", {
        description: e instanceof Error ? e.message : "נסה שוב",
      });
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status === "in") void load();
  }, [load, status]);

  const arm = useCallback(async () => {
    const key = keyValue.trim();
    if (!key) {
      toast.error("הזן את המפתח", { description: "WIF של ה-active (52 תווים) או סיסמת-אב" });
      return;
    }
    setArming(true);
    try {
      const res = await authedFetch("/api/admin/arm-grid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        stage?: string;
        reason?: string;
        error?: string;
        secret?: string;
        repo?: string;
        secretUpdatedAt?: string | null;
      };
      if (!res.ok || !j.ok) {
        throw new Error(j.reason ?? j.error ?? `שלב: ${j.stage ?? res.status}`);
      }
      setKeyValue("");
      toast.success("הגריד חומש 🔥", {
        description: `${j.secret} נאטם בכספת ${j.repo}. ההזנקה הידנית זמינה למטה.`,
        duration: 7000,
      });
      await load();
    } catch (e) {
      toast.error("החימוש נכשל — שום דבר לא השתנה", {
        description: e instanceof Error ? e.message : "נסה שוב",
        duration: 7000,
      });
    } finally {
      setArming(false);
    }
  }, [authedFetch, keyValue, load]);

  const gridVerdict = state?.grid?.verdict ?? null;
  // r124 · כנות: null = רישום הסודות לא נקרא (כשל-API) — לא “לא קיים”.
  // במקרה כזה נציג את דלת-החימוש עם הסבר, לא נטען שהסוד נעלם.
  const armedSecret = state?.secretPresent ?? false;
  const secretListUnread = state != null && state.secretPresent == null;
  const fuel = state?.grid?.fuel ?? null;

  return (
    <Card className="mb-6 border-amber-500/30 bg-gradient-to-b from-amber-500/[0.04] to-transparent">
      <CardContent className="flex flex-col gap-4 p-5">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Swords className="size-4 text-amber-500" aria-hidden="true" />
            חימום הגריד החוץ — עורק הכסף האמיתי
            {gridVerdict ? (
              armedSecret ? (
                <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <Unlock className="size-3" aria-hidden="true" />
                  מפתח נאטם בכספת
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <Lock className="size-3" aria-hidden="true" />
                  נעול — בלי מפתח
                </Badge>
              )
            ) : null}
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-muted-foreground" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
            רענן
          </Button>
        </div>

        {/* מצב חי */}
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Swords className="size-3.5" aria-hidden="true" />
              פסק-דין אחרון (חי)
            </div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed" dir="ltr">
              {gridVerdict ?? (loading ? "…" : "—")}
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Fuel className="size-3.5" aria-hidden="true" />
              דלק שבועי
            </div>
            <div className="mt-1 font-mono text-[11px]">
              {fuel?.weeklySp ? `${fuel.weeklySp.toFixed(0)} SP ≈ $${(fuel.weeklyUsd ?? 0).toFixed(0)}/שבוע` : "—"}
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              תשלום powerdown הבא
            </div>
            <div className="mt-1 font-mono text-[11px]">{payoutLabel(fuel?.nextPayout)}</div>
          </div>
        </div>

        {secretListUnread && (
          <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-4 py-2 text-xs">
            <span className="font-bold text-amber-700 dark:text-amber-400">רישום הסודות של הריפו לא נקרא (כשל GitHub API)</span>
            <span className="text-muted-foreground">
              לא נטען שהמפתח נעלם ולא שהוא קיים — האמת תימדד בקריאה הבאה. אין פעולה אוטומטית על סמך לא-נמדד.
            </span>
          </div>
        )}
        {armedSecret ? (
          /* מצב חמוש */
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-4" aria-hidden="true" />
              הגריד חמוש
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              הכספת המוצפנת של <span className="font-mono">roshpinacare-sys/saos-dex</span> מחזיקה מעתה את מלוא חוט-המפתחות:{" "}
              <span className="font-mono">STEEM_ACTIVE_WIF + HIVE_ACTIVE_WIF + HIVE_POSTING_WIF + BLURT_ACTIVE_WIF + STEEM_POSTING_WIF</span>{" "}
              (R99 — נמסרו מכספת-הארנק הריבונית, אומתו ביט-מול-ביט מול הרשויות החיות בשלוש השרשראות לפני האטימה)
              {state?.secretUpdatedAt ? ` (אומת לאחרונה ${new Date(state.secretUpdatedAt).toLocaleString("he-IL")})` : ""}.
              המכונה החיה: התאום הציבורי ב-Domain ({state?.nextScheduledRun ?? "לוח-הזמנים לא נקרא מהענן ברגע זה"}) — רגל-STEEM ורגל-HIVE חיות יחד,
              כל מילוי-חוץ נספר בכנות בקונסולה הציבורית. אפשר להזניק ריצה ראשונה עכשיו דרך כפתורי ההזנקה למטה.
            </p>
          </div>
        ) : (
          /* דלת החימום */
          <div className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.03] px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              הגריד בנוי, נמדד (פרימיית-SBD חיה של{" "}
              <span className="font-mono text-amber-600 dark:text-amber-400">+18%–29%</span> מול קו-הזהות — נמדד 2026-09-24) ומתוזמן יומית —
              אך לא חותם בלי המפתח. הזן כאן את ה-active של @headcorner: השרת מאמת אותו מול השרשרת ואוטם אותו ישר אל
              הכספת המוצפנת של הריפו (GitHub Actions Secrets).{" "}
              <span className="font-semibold">
                המפתח לא נשמר בשום מקום אחר — לא דיסק, לא לוג, לא תשובה.
              </span>
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <KeyRound className="absolute inset-y-0 right-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  type={showKey ? "text" : "password"}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void arm();
                  }}
                  className="border-zinc-700 bg-zinc-900/70 pr-10 pl-10 font-mono text-sm placeholder:text-zinc-600"
                  placeholder="5K… / L… / סיסמת-אב"
                  aria-label="מפתח ה-active של המפעיל לחימום הגריד"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={arming}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute inset-y-0 left-2 my-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showKey ? "הסתר מפתח" : "הצג מפתח"}
                >
                  {showKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
              <Button
                onClick={() => void arm()}
                disabled={arming || !keyValue.trim()}
                className="gap-2 bg-amber-600 text-white hover:bg-amber-500"
              >
                {arming ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Flame className="size-4" aria-hidden="true" />
                )}
                {arming ? "מאמת ואוטם…" : "חמש את הגריד"}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              מגבלת-קצה: 8 ניסיונות לשעה. מפתח שגוי נדחה בלי לגעת בכלום — ושום דבר מה שהוזן לא נשמר כאן.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
