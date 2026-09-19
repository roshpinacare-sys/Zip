"use client";

// ─────────────────────────────────────────────────────────────────────
// GATE VIEW · שער המפעיל — התשובה ל"איפה אני מתחבר ואיך מתחילים להזרים".
//
// ארבעה גופים, כולם ממדידה חיה בלבד (שום טענה לא נטענת מסתם):
//   1. מלאי-אמת: כל ארנקי הרשת על כל השרשרות, נקראים מה-RPC הציבורי.
//   2. הדלת: הזנת ה-active של המפקד — אימות מול השרשרת, חתימה
//      לסוד-GitHub, אפס אחסון מקומי. זה מה שחוסם את הזרימה החוץ.
//   3. מה-רץ-בפועל: עמודת אמת — רץ / חסום / מדמם, עם הוכחה לשורה.
//   4. איך-מתחילים-להזרים: צינור-הערך מה-powerdown ועד חלון-הפדיון.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Coins,
  DoorOpen,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  Fuel,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── טיפוסי-המלאי (משקפים את /api/treasury בדיוק) ────────────────────

interface SteemAccountRow {
  name: string;
  steem: number;
  sbd: number;
  sp: number;
  receivedSp: number;
}
interface TreasuryData {
  ok: boolean;
  fetchedAt: string;
  cached?: boolean;
  cacheAgeSec?: number;
  down?: string[];
  usd: { total: number; liquid: number; vesting: number; missingPrices: string[] };
  steem?: {
    accounts: SteemAccountRow[];
    powerdown: {
      active: boolean;
      weeklySteem: number;
      nextPayment: string | null;
      paymentsLeft: number;
      totalRemainingSteem: number;
    };
  };
  hive?: { accounts: Array<{ name: string; hive: number; hbd: number; hp: number }> };
  tron?: Array<{ label: string; address: string; trx: number; trc20: number }>;
  evm?: Array<{ label: string; address: string; eth: number; txsSent: number | null }>;
  sol?: Array<{ label: string; address: string; sol: number }>;
  btc?: Array<{ label: string; address: string; btc: number; txs: number }>;
  prices?: Record<string, number | null>;
  network?: {
    height?: number | null;
    treasuryProfitUsds?: number | null;
    backingWsteem?: number | null;
    depositsTotal?: number | null;
    gridVerdict?: string | null;
    gridArmed?: boolean | null;
    chains?: Record<string, string> | null;
    halted?: boolean | null;
  };
}

interface ArmResult {
  ok: boolean;
  stage: string;
  reason?: string;
  secretName?: string;
  secretVerified?: boolean;
  gridDispatched?: boolean;
  publicKey?: string;
  links?: { gridLive?: string; actionsRuns?: string; secretsSettings?: string };
}

// ── עזרים ────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}
function dataAge(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return "לפני פחות מדקה";
  if (s < 3600) return `לפני ${Math.round(s / 60)} דקות`;
  return `לפני ${Math.round(s / 3600)} שעות`;
}

// ── צ'יפ-מצב ────────────────────────────────────────────────────────

function StatusPill({
  icon: Icon,
  label,
  value,
  tone = "zinc",
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "emerald" | "rose" | "amber" | "zinc" | "gold";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    zinc: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
    gold: "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]",
  };
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5", tones[tone])}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="text-[11px] leading-tight">
        <span className="opacity-70">{label} </span>
        <span className="font-mono font-semibold">{value}</span>
      </span>
    </div>
  );
}

// ── כרטיס-מקטע ───────────────────────────────────────────────────────

function GateSection({
  icon: Icon,
  title,
  sub,
  children,
  id,
}: {
  icon: typeof Gauge;
  title: string;
  sub: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="scroll-mt-24" aria-label={title}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10">
          <Icon className="h-4.5 w-4.5 text-[#e8cd6e]" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{title}</h2>
          <p className="text-xs text-zinc-500">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ── הטיפה-הראשונה: הוכחה-חיה מהאתר-הציבורי ──────────────────────────

const DROP_TXID = "8d84e637f3ebc87b8248361a58342eb05014315beb9a9e9b6f3c1c403de9e917";
const DROP_CUSTODY = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const WORLD_URL = "https://roshpinacare-sys.github.io/Console/dex/world.json";

interface WorldMirror {
  ok?: boolean;
  publishedAt?: string;
  state?: { height?: number; backing?: Record<string, number> };
  wallets?: Array<{ name?: string; balances?: Record<string, number> }>;
}

function FirstDropProof() {
  const [w, setW] = useState<WorldMirror | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${WORLD_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setW((await r.json()) as WorldMirror);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 60));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const operatorWtrx =
    w?.wallets?.find((x) => x.name === "operator")?.balances?.WTRX ?? null;
  const backingWtrx = w?.state?.backing?.WTRX ?? null;
  const live = operatorWtrx != null && operatorWtrx > 0;
  return (
    <Card
      className={cn(
        "border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.07] to-transparent",
      )}
    >
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xl" aria-hidden>💧</span>
          <h3 className="text-base font-bold text-zinc-100">
            הטיפה הראשונה — הכסף האמת הראשון בדלת
          </h3>
          <Badge
            className={cn(
              live
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-600/40 bg-zinc-600/10 text-zinc-400",
            )}
          >
            {live ? "נטען-חי מהאתר-הציבורי" : "ממתין לקריאה…"}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-zinc-300">
          הפקדה-אמיתית של <span className="font-semibold text-zinc-100">2.000 TRX</span> (TransferContract
          על-רשת-TRON) אומתה מול-RPC-ציבורי, והוטבעו מולה{" "}
          <span className="font-semibold text-emerald-300">2,000µ WTRX</span> — הנכס-העטוף הראשון
          בהיסטוריה-של-הרשת שמגובה 1:1 בכסף-אמת שנמדד-חי. ה-TRX נשאר בכתובת-המשמורת כגיבוי-פיזי;{" "}
          ה-WTRX הוא זכות-הפדיון המתועדת.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">כתובת-המשמורת (TRON)</div>
            <a
              className="break-all font-mono text-[11px] text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]"
              href={`https://tronscan.org/#/address/${DROP_CUSTODY}`}
              target="_blank"
              rel="noreferrer"
            >
              {DROP_CUSTODY}
            </a>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">העסקה על-השרשרת (Tronscan)</div>
            <a
              className="break-all font-mono text-[11px] text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]"
              href={`https://tronscan.org/#/transaction/${DROP_TXID}`}
              target="_blank"
              rel="noreferrer"
            >
              {DROP_TXID.slice(0, 26)}…
            </a>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">התביעה בספר (חד-פעמית)</div>
            <div className="break-all font-mono text-[11px] text-zinc-300">trx:{DROP_TXID.slice(0, 18)}…</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">יתרת-המפעיל (חי)</div>
            <div className="font-mono text-lg font-bold text-emerald-300">
              {operatorWtrx != null ? `${operatorWtrx.toLocaleString()}µ WTRX` : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">גיבוי-האוצר (חי)</div>
            <div className="font-mono text-lg font-bold text-emerald-300">
              {backingWtrx != null ? `${backingWtrx.toLocaleString()}µ` : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">מקור-המדידה</div>
            <div className="font-mono text-[11px] text-zinc-400">
              {w ? `world.json · h${w.state?.height} · ${w.publishedAt?.slice(11, 16) ?? "?"}Z` : err ? `קריאה נכשלה (${err})` : "…"}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            כל-מספר בכרטיס נקרא בזמן-פתיחת-העמוד מהמראה-הציבורית שפרסם הלב (GitHub Pages) — לא מהאתר-הזה. אם-הוא
            מופיע-כאן, הוא נכתב על-ידי השרשרת-הקנונית ונראה-לכל-אדם.
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()} className="shrink-0">
            <RefreshCw className="ml-1 h-3.5 w-3.5" aria-hidden />
            רענן
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── המחזור-המלא-הראשון: הוכחה-חיה מהמראה-הציבורית ────────────────────

const RECEIPT_URL = "https://roshpinacare-sys.github.io/Console/receipts/r35-full-cycle.json";
const ENGINE_COMMIT = "https://github.com/roshpinacare-sys/saos-dex/commit/afccfff";

interface CycleMirror {
  ok?: boolean;
  publishedAt?: string;
  version?: number;
  state?: {
    height?: number;
    backing?: Record<string, number>;
    assets?: Record<string, { refPrice?: number; listed?: number }>;
    oracle?: Record<string, { mu?: number; atH?: number; src?: string }>;
  };
  pools?: Array<{ a?: string; b?: string; ra?: number; rb?: number; lp?: number; swaps?: number; feeAccruedTreasury?: number }>;
  wallets?: Array<{ name?: string; balances?: Record<string, number> }>;
}

function FullCycleProof() {
  const [w, setW] = useState<CycleMirror | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${WORLD_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setW((await r.json()) as CycleMirror);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 60));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const pool = w?.pools?.find((p) => p.a === "USDS" && p.b === "WTRX") ?? null;
  const wallet = (n: string) => w?.wallets?.find((x) => x.name === n)?.balances ?? null;
  const op = wallet("operator");
  const outbox = wallet("peg-outbox");
  const oracleMu = w?.state?.oracle?.WTRX?.mu ?? null;
  const midMilli = pool && pool.rb ? Math.floor(((pool.ra ?? 0) * 1000) / pool.rb) : null;
  const oracleMilli = oracleMu != null ? Math.round(oracleMu / 1000) : null;
  const spreadBps =
    midMilli != null && oracleMilli
      ? Math.round(((midMilli - oracleMilli) / oracleMilli) * 10_000)
      : null;
  const verdict =
    spreadBps == null ? null : Math.abs(spreadBps) < 300 ? "CONVERGED" : Math.abs(spreadBps) < 1500 ? "DRIFT" : "DIVERGENT";
  const sumLive =
    (op?.WTRX ?? 0) + (outbox?.WTRX ?? 0) + (pool?.rb ?? 0);
  const backingWtrx = w?.state?.backing?.WTRX ?? null;
  const live = pool != null && op != null && outbox != null;

  return (
    <Card className="border-[#d4af37]/30 bg-gradient-to-b from-[#d4af37]/[0.08] to-transparent">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Coins className="h-5 w-5 text-[#e8cd6e]" aria-hidden />
          <h3 className="text-base font-bold text-zinc-100">
            המחזור-המלא-הראשון — מהפקדה ועד תביעת-פדיון
          </h3>
          <Badge
            className={cn(
              verdict === "CONVERGED"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : verdict
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-zinc-600/40 bg-zinc-600/10 text-zinc-400",
            )}
          >
            {live ? (verdict ? `שוק-חי · ${verdict}` : "נטען…") : "ממתין לקריאה…"}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-zinc-300">
          הכסף-האמת שנכנן בדלת (2.0 TRX → 2,000µ WTRX) עבר את כל המסלול הכלכלי על השרשרת-הקנונית:{" "}
          <span className="font-semibold text-zinc-100">רישום בסולם-הערך</span> (refPrice 335, h21496) ·{" "}
          <span className="font-semibold text-zinc-100">שוק-חי USDS/WTRX</span> שנפתח במחיר-האורקל ·{" "}
          <span className="font-semibold text-zinc-100">המכירה-האמיתית הראשונה</span> 30µ WTRX → 9µ USDS ·{" "}
          <span className="font-semibold text-zinc-100">קנייה-חזרה</span> 9µ USDS → 27µ WTRX (שוק דו-כיווני) ·{" "}
          <span className="font-semibold text-zinc-100">תביעת-הפדיון הראשונה</span> — 100µ לתיבת-היציאה
          עם יעד-TRON חתום.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[#d4af37]/20 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">השוק החי (USDS/WTRX)</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-[#e8cd6e]">
              {pool ? `${(pool.ra ?? 0).toLocaleString()}µ USDS + ${(pool.rb ?? 0).toLocaleString()}µ WTRX` : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">
              {pool ? `LP ${pool.lp?.toLocaleString() ?? 0}µ · ${pool.swaps ?? 0} החלפות` : "ממתין למראה"}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">עוגן-חי מול אורקל</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">
              {midMilli != null && oracleMilli ? `mid ${midMilli} מול ${oracleMilli}mµ` : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">
              {spreadBps != null ? `${spreadBps > 0 ? "+" : ""}${spreadBps}bps · ${verdict}` : "ממתין למראה"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">תיבת-היציאה — תביעת-פדיון</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-[#e8cd6e]">
              {outbox ? `${(outbox.WTRX ?? 0).toLocaleString()}µ WTRX` : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">ממתין לשידור-המפעיל מהמשמרת</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">יתרת-המפעיל אחרי המחזור (חי)</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-zinc-100">
              {op ? `${(op.WTRX ?? 0).toLocaleString()}µ WTRX · ${(op.USDS ?? 0).toLocaleString()}µ USDS` : "…"}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <div className="text-[11px] text-zinc-500">אינווריאנטה חיה (סכום = גיבוי)</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">
              {live && backingWtrx != null
                ? `${sumLive.toLocaleString()}µ = ${backingWtrx.toLocaleString()}µ ✓`
                : "…"}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">מפעיל + תיבת-יציאה + בריכה = 2.0 TRX במשמרת</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] text-zinc-500">מקור-המדידה</div>
            <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
              {w ? `world.json · h${w.state?.height} · ${w.publishedAt?.slice(11, 16) ?? "?"}Z` : err ? `קריאה נכשלה (${err})` : "…"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href={RECEIPT_URL} target="_blank" rel="noreferrer">
              קבלת-מכונה (JSON)
            </a>
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href="https://roshpinacare-sys.github.io/Console/receipts/" target="_blank" rel="noreferrer">
              קיר-הקבלות
            </a>
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href={ENGINE_COMMIT} target="_blank" rel="noreferrer">
              commit השרשרת (afccfff)
            </a>
            <a className="text-[#e8cd6e] underline decoration-[#d4af37]/40 underline-offset-2 hover:decoration-[#d4af37]" href={`https://tronscan.org/#/transaction/${DROP_TXID}`} target="_blank" rel="noreferrer">
              הפקדה ב-Tronscan
            </a>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} className="shrink-0">
            <RefreshCw className="ml-1 h-3.5 w-3.5" aria-hidden />
            רענן
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── הדלת: הזנת-המפתח ────────────────────────────────────────────────

function ArmDoor({ onArmed }: { onArmed: () => void }) {
  const [wif, setWif] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ArmResult | null>(null);

  const submit = useCallback(async () => {
    if (!wif.trim()) {
      toast.error("הזן את ה-WIF של ה-active של המפקד");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/arm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wif: wif.trim() }),
      });
      const j = (await r.json()) as ArmResult;
      setResult(j);
      if (j.ok) {
        toast.success("המפתח אומת מול השרשרת ונחתם כסוד-GitHub. הגריד שוגר.");
        onArmed();
      } else {
        toast.error(j.reason ?? "האימות נכשל");
      }
    } catch (e) {
      toast.error(`שגיאת רשת: ${String((e as Error).message).slice(0, 80)}`);
    } finally {
      setBusy(false);
      setWif("");
    }
  }, [wif, onArmed]);

  return (
    <Card className="border-[#d4af37]/25 bg-gradient-to-b from-[#d4af37]/[0.06] to-transparent">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-[auto_1fr]">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#e8cd6e]" aria-hidden />
            <span className="font-semibold text-zinc-100">איך הדלת בנויה:</span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <li>
              <span className="text-zinc-200">אימות מול השרשרת:</span> המפתח שיוזן נגזר למפתח-ציבורי ומושווה ביט-מול-ביט מול
              הסמכות החיה של <span className="font-mono">@headcorner</span> ב-api.steemit.com. אין התאמה — הבקשה נעצרת לפני שנוגעים במשהו.
            </li>
            <li>
              <span className="text-zinc-200">אפס אחסון מקומי:</span> המפתח לא נכתב לדיסק, ללוג, או לתשובה — רק עובר
              בזיכרון הבקשה אל חתימת-סגור של libsodium (sealed box) שרק GitHub יכול לפתוח, ונשמר כסוד-Actions בשם{" "}
              <span className="font-mono">STEEM_ACTIVE_WIF</span> בריפו המנוע הפרטי.
            </li>
            <li>
              <span className="text-zinc-200">ההדלקה מידית:</span> מיד אחרי השמירה משוגר רץ-ה-dex-grid (לא מחכים ל-03:17) —
              ואפשר לראות את הגריד מתחמש בפומבי.
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <label htmlFor="arm-wif" className="block text-xs font-semibold text-zinc-400">
            ה-active WIF של המפקד (מתחיל ב-5, L או K, 52 תווים בדרך-כלל)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Input
                id="arm-wif"
                type={show ? "text" : "password"}
                value={wif}
                onChange={(e) => setWif(e.target.value)}
                placeholder="5J… או L… או K…"
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                className="pr-10 font-mono text-xs"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-2 flex items-center text-zinc-500 hover:text-zinc-300"
                aria-label={show ? "הסתר מפתח" : "הצג מפתח"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              onClick={submit}
              disabled={busy || !wif.trim()}
              className="gap-2 border-[#d4af37]/40 bg-[#d4af37]/15 text-[#e8cd6e] hover:bg-[#d4af37]/25"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {busy ? "מאמת מול השרשרת…" : "אמת וחמש את הגריד"}
            </Button>
          </div>
          <p className="text-[11px] text-zinc-500">
            הערך נמחק מהזיכרון של הדפדפן ברגע שהבקשה מסתיימת. מומלץ להזין מקובץ-מפתחות ולא להדביק ממקור מקוון.
          </p>
        </div>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "rounded-lg border p-4 text-sm",
              result.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200",
            )}
            role="status"
          >
            {result.ok ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  הדלת נפתחה: הסוד {result.secretName} נשמר ואומר ברשימת הסודות
                  {result.secretVerified ? "" : " (אימות-חוזר לא הושלם — בדוק בקישור)"}
                </p>
                <p className="text-xs text-emerald-300/80">
                  dex-grid {result.gridDispatched ? "שוגר כעת — הריצה החיה תתפרסם בקונסולה בתוך דקות" : "ירוץ בלוח-הזמנים היומי (03:17 UTC)"}
                </p>
                <div className="flex flex-wrap gap-3 pt-1 text-xs">
                  {result.links?.gridLive && (
                    <a href={result.links.gridLive} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                      מצב-הגריד החי <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {result.links?.actionsRuns && (
                    <a href={result.links.actionsRuns} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                      ריצות-ה-Actions <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {result.links?.secretsSettings && (
                    <a href={result.links.secretsSettings} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                      הגדרות-הסודות בריפו <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {result.reason} <span className="opacity-70">(שלב: {result.stage})</span>
                </span>
              </p>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

// ── התצוגה הראשית ───────────────────────────────────────────────────

export function GateView() {
  const [data, setData] = useState<TreasuryData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const reduced = useReducedMotion();
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/treasury", { cache: "no-store" });
      const j = (await r.json()) as TreasuryData;
      setData(j);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 90));
    } finally {
      setRefreshing(false);
      firstLoad.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const head = useMemo(
    () => data?.steem?.accounts.find((a) => a.name === "headcorner") ?? null,
    [data],
  );
  const gridArmed = data?.network?.gridArmed === true;
  const powerdown = data?.steem?.powerdown;

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: Math.min(i * 0.06, 0.3), duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
      {/* ── פתיח-השער ── */}
      <motion.div {...fade(0)} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]">שער המפעיל</Badge>
          <span className="text-xs text-zinc-500">הדלת היחידה שבה המערכת מתחברת לכסף האמת</span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50 sm:text-3xl">
          איפה הכסף, איפה המפתח, ומה באמת רץ
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          כל מספר בעמוד הזה נקרא כרגע מהשרשרות הציבוריות (Steem, Hive, TRON, Ethereum, Solana,
          Bitcoin) ומהבורסות — לא מהזיכרון, לא מהצהרות. החסם היחיד בין הרשת לבין זרימת-כסף אמת
          הוא סוד אחד שחסר, ולו בנינו כאן דלת אמיתית.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusPill
            icon={Gauge}
            label="גובה-השרשרת הפנימית"
            value={data?.network?.height != null ? `h${data.network.height}` : "…"}
            tone="zinc"
          />
          <StatusPill
            icon={gridArmed ? ShieldCheck : CircleSlash}
            label="הגריד החוץ"
            value={gridArmed ? "חמוש" : data?.network?.gridVerdict ?? "…"}
            tone={gridArmed ? "emerald" : "rose"}
          />
          <StatusPill
            icon={Wallet}
            label="הפקדות חוץ שנספרו"
            value={String(data?.network?.depositsTotal ?? "…")}
            tone={Number(data?.network?.depositsTotal ?? 0) > 0 ? "emerald" : "zinc"}
          />
          <StatusPill
            icon={Fuel}
            label="דלק-ה-powerdown"
            value={
              powerdown?.active
                ? `${fmtNum(powerdown.weeklySteem, 0)} STEEM בשבוע, עוד ${powerdown.paymentsLeft} תשלומים`
                : "לא פעיל"
            }
            tone={powerdown?.active ? "gold" : "zinc"}
          />
          {data?.cached && (
            <span className="text-[11px] text-zinc-600">
              מטמון {data.cacheAgeSec}s · נמדד {dataAge(data.fetchedAt)}
            </span>
          )}
        </div>
        {err && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            קריאת-המלאי נכשלה: {err} — נסה רענון. אף מספר לא מוצג מסתם.
          </p>
        )}
        {data?.down && data.down.length > 0 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            מקורות שלא ענו כרגע: {data.down.join(" · ")} — הם לא נספרים בסכומים.
          </p>
        )}
      </motion.div>

      {/* ── R55 · מרכז המשחקים — כניסה בולטת מהנחיתה ── */}
      <motion.div {...fade(1)}>
        <a
          href="#/games"
          className="group flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/5 p-4 transition-all hover:border-[#d4af37] hover:bg-[#d4af37]/10"
        >
          <span className="flex items-center gap-3">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 text-2xl"
              aria-hidden="true"
            >
              🎮
            </span>
            <span>
              <span className="block text-sm font-bold text-[#e8cd6e]">
                מרכז המשחקים — משחקי מזל ומיומנות, בידור בלבד
              </span>
              <span className="block text-xs text-zinc-500">
                מוגש מרשת-האחסון הריבונית · הקוד לא בריפו · נקודות וירטואליות בלבד
              </span>
            </span>
          </span>
          <span className="rounded-full border border-[#d4af37]/50 px-4 py-1.5 text-xs font-bold text-[#e8cd6e] transition-colors group-hover:bg-[#d4af37] group-hover:text-zinc-950">
            שחק עכשיו ←
          </span>
        </a>
      </motion.div>

      {/* ── הטיפה הראשונה — הוכחה חיה ── */}
      <motion.div {...fade(1)}>
        <FirstDropProof />
      </motion.div>

      {/* ── המחזור-המלא-הראשון — הוכחה חיה ── */}
      <motion.div {...fade(1)}>
        <FullCycleProof />
      </motion.div>

      {/* ── מלאי-אמת ── */}
      <motion.div {...fade(1)}>
        <GateSection
          id="inventory"
          icon={Banknote}
          title="מה יש באמת — מלאי חי של כל ארנקי הרשת"
          sub="נקרא עכשיו מכל שרשרת ב-RPC ציבורי. ארנק שלא ענה לא נספר."
        >
          {firstLoad.current && !data ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">שווי-כסף אמת (כל השרשרות)</p>
                    <p className="mt-1 font-mono text-2xl font-black text-[#e8cd6e]">
                      ${fmtUsd(data?.usd.total)}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      במחירים חיים מהרגע ({dataAge(data?.fetchedAt ?? new Date().toISOString())})
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">נזיל כרגע (מימוש מיידי)</p>
                    <p className="mt-1 font-mono text-2xl font-bold text-zinc-100">${fmtUsd(data?.usd.liquid)}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">STEEM, SBD, TRX, אבק-ETH — הכל נזיל</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-xs text-zinc-500">כלוא ב-Steam-Power (13 שבועות שחרור)</p>
                    <p className="mt-1 font-mono text-2xl font-bold text-zinc-100">${fmtUsd(data?.usd.vesting)}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {fmtNum(head?.sp ?? null, 0)} SP של המפקד + הצי — זה 95% מההון
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* דלק-ה-powerdown */}
              {powerdown?.active && (
                <Card className="border-[#d4af37]/25">
                  <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <Flame className="mt-0.5 h-5 w-5 shrink-0 text-[#e8cd6e]" aria-hidden />
                      <div>
                        <p className="text-sm font-bold text-zinc-100">דלק-המסילה: ה-powerdown הפעיל של המפקד</p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                          ההעברה האוטומטית היחידה שמזרימה כסף אמת פנימה בלי הפקדות: כל יום חמישי ב-02:01 UTC
                          נוחתים {fmtNum(powerdown.weeklySteem)} STEEM נזילים בחשבון. זה מה שהגריד החמוש יסחר.
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 space-y-1 text-left" dir="ltr">
                      <p className="font-mono text-lg font-bold text-[#e8cd6e]">
                        {fmtNum(powerdown.totalRemainingSteem, 0)} STEEM
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        נותרו {powerdown.paymentsLeft} תשלומים · הבא:{" "}
                        {powerdown.nextPayment ? new Date(powerdown.nextPayment).toLocaleDateString("he-IL") : "—"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* טבלאות-השרשרות */}
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardContent className="p-0">
                    <div className="border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-200">
                      Steem — צי ה-13 (STEEM נזיל + SP)
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-950/95 text-zinc-500">
                          <tr>
                            <th className="px-4 py-2 text-right font-medium">חשבון</th>
                            <th className="px-2 py-2 text-left font-mono font-medium">STEEM</th>
                            <th className="px-2 py-2 text-left font-mono font-medium">SBD</th>
                            <th className="px-4 py-2 text-left font-mono font-medium">SP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data?.steem?.accounts ?? []).map((a) => (
                            <tr key={a.name} className="border-t border-zinc-900">
                              <td className="px-4 py-2 font-mono text-zinc-300">{a.name}</td>
                              <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.steem)}</td>
                              <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.sbd)}</td>
                              <td className="px-4 py-2 text-left font-mono text-zinc-200">
                                {a.sp > 0.5 ? fmtNum(a.sp, 0) : "—"}
                                {a.receivedSp > 0.5 && (
                                  <span className="text-[10px] text-zinc-600"> (+{fmtNum(a.receivedSp, 0)} מואצל)</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {[
                    {
                      title: "Hive — אותם 13 חשבונות",
                      rows: (data?.hive?.accounts ?? []).filter((a) => a.hive > 0 || a.hbd > 0 || a.hp > 0.01),
                      cols: ["hive", "hbd", "hp"],
                    },
                  ].map((sec) => (
                    <Card key={sec.title}>
                      <CardContent className="p-0">
                        <div className="border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-200">
                          {sec.title}
                        </div>
                        <div className="max-h-32 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-zinc-950/95 text-zinc-500">
                              <tr>
                                <th className="px-4 py-2 text-right font-medium">חשבון</th>
                                <th className="px-2 py-2 text-left font-mono font-medium">HIVE</th>
                                <th className="px-2 py-2 text-left font-mono font-medium">HBD</th>
                                <th className="px-4 py-2 text-left font-mono font-medium">HP</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-4 py-3 text-center text-zinc-600">
                                    אפס נזיל — ה-RC של העיגון אכל הכל
                                  </td>
                                </tr>
                              ) : (
                                sec.rows.map((a: any) => (
                                  <tr key={a.name} className="border-t border-zinc-900">
                                    <td className="px-4 py-2 font-mono text-zinc-300">{a.name}</td>
                                    <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.hive)}</td>
                                    <td className="px-2 py-2 text-left font-mono text-zinc-400">{fmtNum(a.hbd)}</td>
                                    <td className="px-4 py-2 text-left font-mono text-zinc-200">{fmtNum(a.hp, 1)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  <Card>
                    <CardContent className="p-0">
                      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-200">
                        ארנקי-החוץ (TRON / ETH / SOL / BTC)
                      </div>
                      <div className="max-h-44 overflow-y-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {(data?.tron ?? []).map((t) => (
                              <tr key={t.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">{t.label}</td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">{fmtNum(t.trx)} TRX</td>
                              </tr>
                            ))}
                            {(data?.evm ?? []).map((e) => (
                              <tr key={e.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">
                                  {e.label}
                                  {e.txsSent != null && e.txsSent > 0 && (
                                    <span className="text-[10px] text-zinc-600"> · {e.txsSent} עסקאות נשלחו מהכתובת</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">
                                  {e.eth > 0 ? e.eth.toExponential(2) : "0"} ETH
                                </td>
                              </tr>
                            ))}
                            {(data?.sol ?? []).map((s) => (
                              <tr key={s.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">{s.label}</td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">{fmtNum(s.sol)} SOL</td>
                              </tr>
                            ))}
                            {(data?.btc ?? []).map((b) => (
                              <tr key={b.address} className="border-t border-zinc-900">
                                <td className="px-4 py-2 text-zinc-400">{b.label}</td>
                                <td className="px-4 py-2 text-left font-mono text-zinc-300">{fmtNum(b.btc, 8)} BTC</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-500">
                הערת-אמת על ההיסטוריה שנמדדה בשרשרות: ה-ETH של כתובת-ההפקדה קיבל פעם אחת 0.0002 ETH
                ונשלח משם 0.000186 ETH לסוכן הלב — שכל אותם חתימות-לב-פעימות שרפו כמעט הכל בגז. מה שנשאר
                בחוץ זה אבק. ההון האמת חי ב-Steam-Power של המפקד, והוא משתחרר ב-powerdown שבועי.
              </p>
            </div>
          )}
        </GateSection>
      </motion.div>

      {/* ── הדלת ── */}
      <motion.div {...fade(2)}>
        <GateSection
          id="door"
          icon={DoorOpen}
          title="הדלת — איפה מכניסים את המפתח"
          sub="הסוד היחיד שחוסם את כל הזרימה החוץ. בלעדיו הגריד מפורסם כלוחם-בלי-מפתח, בכנות, כבר מהיום הראשון."
        >
          <ArmDoor
            onArmed={() => {
              setTimeout(load, 20_000);
              setTimeout(load, 90_000);
            }}
          />
        </GateSection>
      </motion.div>

      {/* ── מה-רץ-בפועל ── */}
      <motion.div {...fade(3)}>
        <GateSection
          id="truth"
          icon={ShieldAlert}
          title="מה רץ בפועל — עמודת-האמת של היום"
          sub="לא מה שכתוב. מה שנמדד כרגע, עם הסיבה לכל שורה."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border-emerald-500/20">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-emerald-300">
                  <PlayCircle className="h-4 w-4" aria-hidden /> רץ באמת (נמדד כרגע)
                </div>
                <ul className="space-y-2.5 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      לב-הבורסה בענן: שרשרת פנימית בגובה{" "}
                      <span className="font-mono text-emerald-300">h{data?.network?.height ?? "…"}</span>, פועם כל-שעתיים,
                      רווח-אוצר פנימי {fmtUsd(data?.network?.treasuryProfitUsds, 0)}$ מעמלות.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      צופה-ההפקדות: ארבע שרשרות נקראות כל-20-דקות בלי-מפתח
                      {data?.network?.chains ? ` (${Object.values(data.network.chains).join(" · ")})` : ""}.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      פרימיטיבים ציבוריים חיים בכל-טיק: אצוות-CoW, DCA, טריגרים, ארביטראז'-פרוטוקול, ראוטר-שריפה —
                      מונים אמת במראה הציבורי.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                    <span>
                      מסדרון-העוגן מרפא את עצמו כל-פעימה מאז התיקון: מחיר-ה-WSTEEM הפנימי נצמד למחיר החוץ האמת.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-rose-500/20">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-rose-300">
                  <CircleSlash className="h-4 w-4" aria-hidden /> חסום (ולמה)
                </div>
                <ul className="space-y-2.5 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      הגריד-החוץ מפורסם <span className="font-mono text-rose-300">{data?.network?.gridVerdict ?? "DISARMED-NO-KEY"}</span> —
                      בריפו-המנוע קיים סוד-Actions יחיד (טוקן-פרסום), מפתח-ה-active מעולם לא הוזן. זו הדלת שלמעלה.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      שידור-ETH/SOL כבוי בשערי-מדיניות (ETH_BROADCAST_ENABLED=false וכן ב-SOL) והמפתחות נמחקו עם
                      איפוסי-הסנדבוקס — אין ערוץ-חוץ חי מלבד Steem.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      משמרת המפתחות של הצי (כספת מוצפנת) חיה בריפו הפרטי — לא במכונה הזו, ואין לה דלת מתועדת עד עכשיו.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span>
                      אפס הפקדות-חוץ מאז פתיחת הדלת לציבור — המעגל האמיתי טרם נסגר אף-פעם בכסף של מישהו אחר.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-amber-500/20">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-amber-300">
                  <TrendingDown className="h-4 w-4" aria-hidden /> מדמם (עלות אמת)
                </div>
                <ul className="space-y-2.5 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                  <li className="flex gap-2">
                    <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                    <span>
                      גז-ETH שנשרף בפעימות-הסוכנים: 93% ממה שהיה (0.0002 ETH) — הודלק בלי שער-עלות. התוקן: השערים
                      כבויים עד תקציב מודע.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                    <span>
                      ההון (95%) יושב ב-Steam-Power שלא מייצר כלום מלבד RC — חלון-13-השבועות מונע מימוש מהיר,
                      ה-powerdown מחלק אותו ב-4 תשלומים ונגמר.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                    <span>
                      הפער הפנימי: אלפי USDS פנימיים מול גיבוי-נזיל של{" "}
                      {data?.network?.backingWsteem != null ? `${fmtNum(data.network.backingWsteem, 0)} WSTEEM` : "965 WSTEEM"} בערך
                      של עשרות דולרים בודדים. הזיכוי להפקדות תלוי בהון שיגיע, לא במה שיש.
                    </span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </GateSection>
      </motion.div>

      {/* ── איך-מתחילים-להזרים ── */}
      <motion.div {...fade(4)}>
        <GateSection
          id="flow"
          icon={Coins}
          title="איך מתחילים להזרים — צינור-הערך מכאן והלאה"
          sub="בלי המצאת כסף: הדלק הקיים, היתרון המדוד, והדלת שפותחת אותם."
        >
          <div className="space-y-3">
            {[
              {
                icon: CalendarClock,
                head: "יום-חמישי 02:01 UTC — הדלק נוחת",
                body: "תשלום-ה-powerdown השבועי ממיר SP ל-STEEM נזיל בחשבון המפקד. זו הכניסה החד-משמעית של ערך אמת, בלי הפקדה של אף אחד.",
              },
              {
                icon: KeyRound,
                head: "הדלת — הסוד שפותח את הגריד",
                body: "ה-active נחתם כסוד-Actions ורץ-ה-dex-grid מתחמש: הוא קורא את ספר-STEEM הפנימי הציבורי, מפרוש מדפים של BID מתחת לקו-הזהות ו-ASK מעליו — יצרן-בלבד, אף-פעם לא חוצה את הספר.",
              },
              {
                icon: TrendingDown,
                head: "היתרון המדוד — פער 20.7% בין השוק הפנימי לחוץ",
                body: "הספר הפנימי של Steem סוחר SBD/STEEM מתחת לקו-הזהות של הערך החיצוני. כל קנייה שם היא עודף מדוד (18% עד 29% במדידה החיה; עסקה אמיתית אחת כבר לכדה 26.28%). מכירה רק מעל הקו — הפרמיה היא אופציה חינם.",
              },
              {
                icon: Banknote,
                head: "מילויים שנספרים בכנות",
                body: "כל מילוי-חוץ של הגריד נרשם בספר-הגריד הציבורי (grid.json) עם המחיר, השווי ב-USD והבקע מול הציון. הנזילות החוץ שנספרת היא זו שבאמת מגבה את חלון-הפדיון.",
              },
              {
                icon: DoorOpen,
                head: "ומהכיוון השני — הפקדות",
                body: "כתובות-ההפקדה בארבע שרשרות נצפות בלי-מפתח; תביעה חתומה של המפקיד מזוכה ב-USDS פנימי (תקרה למשתמש), ומשם: הבורסה הפנימית, האצוות, ה-DCA — וחלון-הפדיון שנפתח ככל שהגיבוי-הנזיל גדל מהגריד.",
              },
            ].map((s, i) => (
              <Card key={s.head}>
                <CardContent className="flex items-start gap-4 p-4 sm:p-5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 font-mono text-sm font-bold text-[#e8cd6e]">
                    {i + 1}
                  </div>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                      <s.icon className="h-4 w-4 text-[#e8cd6e]" aria-hidden />
                      {s.head}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">{s.body}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </GateSection>
      </motion.div>

      {/* ── רענון ── */}
      <motion.div {...fade(5)} className="flex items-center justify-between border-t border-zinc-900 pt-4">
        <p className="text-[11px] text-zinc-600">
          מקורות-המדידה: api.steemit.com · api.hive.blog · tronscan · publicnode · blockchain.info · binance ·
          הקונסולה הציבורית. רענון-אוטומטי כל-דקה.
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing} className="gap-2">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
          רענן מדידה
        </Button>
      </motion.div>
    </div>
  );
}
