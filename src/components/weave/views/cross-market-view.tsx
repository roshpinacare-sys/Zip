"use client";

// ─────────────────────────────────────────────────────────────────────
// CROSS-MARKET VIEW · השוק הבין-רשתי (R94).
//
// הוראת המפעיל שיצרה את התצוגה: "חשוב לבחון את האפשרות של מסחר בין
// blurt hive steem sbd וכו על השוק של סטים ולהרוויח מmarket maker grid".
//
// הכל כאן מדידה חיה חסרת-מפתחות: /api/market/cross מודד את שני השווקים
// הפנימיים (Steem + Hive), מחירים חיצוניים (בינאנס/קוינגקו), גוזר את
// ערכי ה"דולרים" (SBD/HBD), ומריץ סימולציית גריד על ההיסטוריה האמיתית
// של העסקאות. שום דבר לא מובטח — הכל נמדד.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Coins,
  FlaskConical,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  Scale,
  Siren,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/weave/api";

// ── טיפוסים (מראה את חוזה ה-API) ───────────────────────────────────

interface ChainMarket {
  chain: "steem" | "hive";
  baseAsset: string;
  quoteAsset: string;
  ok: boolean;
  at: string;
  book: {
    bestBid: number | null;
    bestAsk: number | null;
    mid: number | null;
    spreadBps: number | null;
    bidDepthBase: number;
    askDepthBase: number;
    levels: number;
  };
  trades: {
    count: number;
    firstAt: string | null;
    lastAt: string | null;
    windowHours: number | null;
    volumeBase: number;
    volumeQuote: number;
    vwap: number | null;
    volBps: number | null;
    reversals: number | null;
  };
  down?: string;
}

interface GridSimResult {
  spacingBps: number;
  rungBase: number;
  tradesAnalyzed: number;
  windowHours: number | null;
  buyFills: number;
  sellFills: number;
  roundTrips: number;
  capturedQuote: number;
  inventoryEndBase: number;
  inventoryEndQuote: number;
  note: string[];
}

interface CrossData {
  ok: boolean;
  at: string;
  steem: ChainMarket;
  hive: ChainMarket;
  marks: {
    steemUsd: number | null;
    hiveUsd: number | null;
    coingecko: { sbdUsd: number | null; hbdUsd: number | null; blurtUsd: number | null };
    sources: Record<string, string>;
    down: string[];
  };
  dollar: { sbdImpliedUsd: number | null; hbdImpliedUsd: number | null; divergenceBps: number | null };
  steemPerHive: number | null;
  ladderGapBps: number | null;
  grids: { steem: GridSimResult; hive: GridSimResult };
  verdicts: Array<{ id: string; title: string; state: "ARMED" | "WAIT" | "GATED" | "NOT-MEASURABLE"; detail: string }>;
  doctrine: string[];
  cached: boolean;
  cacheAgeSec: number;
  stale: boolean;
}

// ── עזרים ────────────────────────────────────────────────────────────

const fmtNum = (v: number | null | undefined, digits = 5): string =>
  v == null || !isFinite(v) ? "—" : v.toFixed(digits);
const fmtInt = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("he-IL");
const fmtBps = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? "—" : `${v.toLocaleString("he-IL")} bps`;
const fmtUsd = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? "—" : `$${v < 0.01 ? v.toFixed(5) : v.toFixed(4)}`;

function dataAge(iso: string | undefined): string {
  if (!iso) return "?";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  return `לפני ${Math.round(min / 60)} שע׳`;
}

const VERDICT_STYLE: Record<string, { cls: string; label: string }> = {
  ARMED: { cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "חמוש · נמדד" },
  WAIT: { cls: "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", label: "המתנה" },
  GATED: { cls: "border-zinc-600/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300", label: "שער-מפעיל" },
  "NOT-MEASURABLE": { cls: "border-zinc-600/40 bg-zinc-500/10 text-zinc-500", label: "לא נמדד כאן" },
};

// ── כרטיס שוק-שרשרת ──────────────────────────────────────────────────

function ChainMarketCard({ m }: { m: ChainMarket }) {
  const q = m.quoteAsset;
  const b = m.baseAsset;
  return (
    <Card className="border-zinc-800 bg-zinc-950/40">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className={cn("size-4", m.chain === "steem" ? "text-emerald-500" : "text-amber-500")} aria-hidden />
            <h3 className="text-sm font-bold">
              שוק {m.chain === "steem" ? "Steem" : "Hive"} הפנימי
            </h3>
          </div>
          {m.ok ? (
            <Badge className="border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">חי</Badge>
          ) : (
            <Badge variant="outline" className="border-rose-600/40 bg-rose-500/10 text-rose-600">לא נמדד</Badge>
          )}
        </div>
        {m.ok ? (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
              <div className="text-zinc-500">ביד (קניית {b})</div>
              <div className="mt-1 font-mono text-sm text-emerald-600 dark:text-emerald-400" dir="ltr">
                {fmtNum(m.book.bestBid)}
              </div>
              <div className="text-[10px] text-zinc-600">{q}/{b}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
              <div className="text-zinc-500">אסק (מכירת {b})</div>
              <div className="mt-1 font-mono text-sm text-rose-600 dark:text-rose-400" dir="ltr">
                {fmtNum(m.book.bestAsk)}
              </div>
              <div className="text-[10px] text-zinc-600">{q}/{b}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
              <div className="text-zinc-500">פער ביד-אסק</div>
              <div className={cn("mt-1 font-mono text-sm font-bold", (m.book.spreadBps ?? 0) >= 500 ? "text-[#d4af37]" : "text-zinc-300")}>
                {fmtBps(m.book.spreadBps)}
              </div>
              <div className="text-[10px] text-zinc-600">מרחב המרקט-מייקר</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
              <div className="text-zinc-500">עומק ביד (ראש הספר)</div>
              <div className="mt-1 font-mono text-sm text-zinc-200">{fmtInt(m.book.bidDepthBase)} {b}</div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
              <div className="text-zinc-500">עסקאות בחלון</div>
              <div className="mt-1 font-mono text-sm text-zinc-200">
                {fmtInt(m.trades.count)}
                <span className="text-[10px] text-zinc-600"> ב-{m.trades.windowHours?.toFixed(1) ?? "?"}ש׳</span>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
              <div className="text-zinc-500">תנודתיות · מידונים</div>
              <div className="mt-1 font-mono text-sm text-zinc-200" dir="ltr">
                {m.trades.volBps != null ? `${m.trades.volBps} bps σ` : "—"}
                <span className="text-[10px] text-zinc-600"> · {fmtInt(m.trades.reversals)} ↯</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-500">
            השוק לא נמדד במחזור זה — {m.down ?? "סיבה לא נמדדה"}. זו מדידה כנה, לא אפס שקרי.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── כרטיס סימולציית גריד ────────────────────────────────────────────

function GridSimCard({ title, g, quote }: { title: string; g: GridSimResult; quote: string }) {
  return (
    <Card className="border-[#d4af37]/30 bg-gradient-to-b from-[#d4af37]/[0.05] to-transparent">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical className="size-4 text-[#d4af37]" aria-hidden />
          <h3 className="text-sm font-bold">{title}</h3>
          <Badge variant="outline" className="ms-auto border-[#d4af37]/40 bg-[#d4af37]/10 text-[#d4af37]">
            סימולציה על עסקאות אמיתיות
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
            <div className="text-zinc-500">סבבים שנלכדו</div>
            <div className="mt-1 font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtInt(g.roundTrips)}</div>
          </div>
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
            <div className="text-zinc-500">הכנסה גולמית</div>
            <div className="mt-1 font-mono text-sm text-zinc-200" dir="ltr">{g.capturedQuote.toFixed(3)} {quote}</div>
          </div>
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
            <div className="text-zinc-500">מילויים (קנייה/מכירה)</div>
            <div className="mt-1 font-mono text-sm text-zinc-200" dir="ltr">{fmtInt(g.buyFills)} / {fmtInt(g.sellFills)}</div>
          </div>
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
            <div className="text-zinc-500">ריווחיות/שעה</div>
            <div className="mt-1 font-mono text-sm text-zinc-200" dir="ltr">
              {g.windowHours && g.windowHours > 0 ? `${(g.capturedQuote / g.windowHours).toFixed(4)} ${quote}/ש׳` : "—"}
            </div>
          </div>
        </div>
        {/* סיכון-המלאי — הנתון הכי חשוב בכנות של גריד */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <span className="font-semibold">סיכון-מלאי בסוף החלון:</span>
          <span className="font-mono" dir="ltr">
            {g.inventoryEndBase >= 0 ? "+" : ""}{g.inventoryEndBase} base · {g.inventoryEndQuote >= 0 ? "+" : ""}{g.inventoryEndQuote} {quote}
          </span>
          <span className="text-zinc-600">
            שוק שירד צובר נכס — זו האמת של גריד, לא רק הלכידה. המלאי נכנס לספירת ההכנסה רק כשהוא נמכר.
          </span>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          מרווח {(g.spacingBps / 100).toFixed(1)}% · מדרגה {g.rungBase} נכס-בסיס · חלון {g.windowHours?.toFixed(1) ?? "?"} שעות ·{" "}
          {g.note[0]}
        </p>
      </CardContent>
    </Card>
  );
}

// ── התצוגה ───────────────────────────────────────────────────────────

export function CrossMarketView() {
  const [data, setData] = useState<CrossData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const j = await apiFetch<CrossData>("/api/market/cross");
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
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10">
            <ArrowLeftRight className="size-5 text-[#d4af37]" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold sm:text-xl">השוק הבין-רשתי</h1>
            <p className="text-xs text-zinc-500">
              STEEM/SBD · HIVE/HBD · BLURT — מדידה חיה חסרת-מפתחות + סימולציית גריד על ההיסטוריה האמיתית
              {data ? <span className="text-zinc-600"> · {dataAge(data.at)}</span> : null}
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
            מדידה מחדש
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-800/40 bg-rose-950/20 p-4 text-sm text-rose-300">
          <Siren className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4">
          {/* השווקים הפנימיים */}
          <div className="grid gap-4 md:grid-cols-2">
            <ChainMarketCard m={data.steem} />
            <ChainMarketCard m={data.hive} />
          </div>

          {/* הדולרים הנגזרים — לב הניתוח הצולב */}
          <Card className="border-zinc-800 bg-zinc-950/40">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Scale className="size-4 text-[#d4af37]" aria-hidden />
                <h3 className="text-sm font-bold">פער הדולרים — SBD מול HBD (נגזר חי)</h3>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                  <div className="text-zinc-500">STEEM חיצוני (בינאנס)</div>
                  <div className="mt-1 font-mono text-sm text-zinc-200" dir="ltr">{fmtUsd(data.marks.steemUsd)}</div>
                </div>
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                  <div className="text-zinc-500">HIVE חיצוני (בינאנס)</div>
                  <div className="mt-1 font-mono text-sm text-zinc-200" dir="ltr">{fmtUsd(data.marks.hiveUsd)}</div>
                </div>
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                  <div className="text-zinc-500">SBD נגזר (פאריטה × STEEM)</div>
                  <div className={cn("mt-1 font-mono text-sm font-bold", (data.dollar.sbdImpliedUsd ?? 1) < 0.9 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")} dir="ltr">
                    {fmtUsd(data.dollar.sbdImpliedUsd)}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                  <div className="text-zinc-500">HBD נגזר (פאריטה × HIVE)</div>
                  <div className={cn("mt-1 font-mono text-sm font-bold", (data.dollar.hbdImpliedUsd ?? 1) >= 0.9 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")} dir="ltr">
                    {fmtUsd(data.dollar.hbdImpliedUsd)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <Gauge className="size-3.5" aria-hidden />
                <span>
                  הפער בין הדולרים:{" "}
                  <span className="font-mono font-bold text-zinc-300">{fmtBps(data.dollar.divergenceBps)}</span>
                  {data.dollar.divergenceBps != null && data.dollar.divergenceBps > 0 ? " (HBD יקר מ-SBD)" : ""}
                  {" · שער צולב חיצוני: "}
                  <span className="font-mono text-zinc-300" dir="ltr">
                    1 STEEM = {fmtNum(data.steemPerHive, 4)} HIVE
                  </span>
                </span>
              </div>
              {data.marks.coingecko.sbdUsd || data.marks.coingecko.hbdUsd ? (
                <p className="mt-2 text-[11px] text-zinc-600">
                  אימות-צלב קוינגקו: SBD {fmtUsd(data.marks.coingecko.sbdUsd)} · HBD {fmtUsd(data.marks.coingecko.hbdUsd)} · BLURT {fmtUsd(data.marks.coingecko.blurtUsd)}
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-zinc-600">
                  קוינגקו לא נמדד במחזור זה (מגבלת-קצב) — הנגזרים מהשווקים הפנימיים הם הסמכות.
                </p>
              )}
            </CardContent>
          </Card>

          {/* סימולציות הגריד */}
          <div className="grid gap-4 md:grid-cols-2">
            <GridSimCard
              title="סימולציית גריד — שוק Steem"
              g={data.grids.steem}
              quote="SBD"
            />
            <GridSimCard
              title="סימולציית גריד — שוק Hive (השוואה)"
              g={data.grids.hive}
              quote="HBD"
            />
          </div>

          {/* פסקי-דין */}
          <Card className="border-zinc-800 bg-zinc-950/40">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="size-4 text-[#d4af37]" aria-hidden />
                <h3 className="text-sm font-bold">לוח ההזדמנויות — פסקי-דין נמדדים</h3>
              </div>
              <div className="grid gap-2.5">
                {data.verdicts.map((v) => {
                  const st = VERDICT_STYLE[v.state] ?? VERDICT_STYLE.WAIT;
                  return (
                    <motion.div
                      key={v.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-3.5"
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-200">{v.title}</span>
                        <Badge variant="outline" className={cn("ms-auto border", st.cls)}>{st.label}</Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-500">{v.detail}</p>
                    </motion.div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* דוקטרינה */}
          <Card className="border-zinc-800/60 bg-zinc-900/20">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-2 flex items-center gap-2">
                <Banknote className="size-4 text-zinc-500" aria-hidden />
                <h3 className="text-sm font-bold text-zinc-400">דוקטרינת המנוע</h3>
              </div>
              <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-zinc-600">
                {data.doctrine.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              {data.marks.down.length > 0 && (
                <p className="mt-2 text-[11px] text-zinc-600">
                  לא נמדד במחזור זה: {data.marks.down.join(" · ")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* מטא-מדידה */}
      {data && (
        <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-zinc-600">
          <span className="flex items-center gap-1">
            <BarChart3 className="size-3" aria-hidden />
            מדידה {data.cached ? `מהמטמון (גיל ${data.cacheAgeSec}ש׳)` : "טרייה"}
          </span>
          <span className="flex items-center gap-1">
            <Coins className="size-3" aria-hidden />
            מקורות: {Object.values(data.marks.sources).join(" · ") || "שווקים פנימיים"}
          </span>
        </div>
      )}
    </div>
  );
}
