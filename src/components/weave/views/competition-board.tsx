"use client";

// ─────────────────────────────────────────────────────────────────────
// CompetitionBoard — תחרות-הסוכנים הריבונית (דבר-המפעיל: "תחרויות בין
// סוכנים — מי מרוויח יותר, תגמולים לסוכנים"). כל חייל = זהות-סוכן חיה
// על השרשרת; הניקוד נגזר מרווחים on-chain מדודים בלבד — אפס-ניקוד-מומצא.
// מקור-האמת: /api/competition ← sovereign/competition/state.json.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trophy, Medal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LeaderRow {
  account: string;
  agent: string;
  points: number;
  rank: number;
  steem: { hp: number; earned: number; pend: number; hist?: { ok?: boolean; posts?: number; votes?: number } } | null;
  hive: { hp: number; earned: number; pend: number; hist?: { ok?: boolean; posts?: number; votes?: number } } | null;
}

interface ScholarshipDTO {
  at?: string;
  kind?: string;
  week?: string;
  total?: number;
  issuedBy?: string;
  payouts?: Array<{ member: string; agent: string; rank: number; amount: number }>;
}

interface CompetitionDTO {
  ok: boolean;
  error?: string;
  epoch?: string;
  beats?: number;
  lastBeat?: string;
  prices?: { steem?: number; hive?: number; live?: boolean };
  dayPoints?: Record<string, { epoch: string; points: number }>;
  leaderboard?: LeaderRow[];
  history?: Array<{ epoch: string; top3: Array<{ account: string; points: number }> }>;
  law?: string;
  scholarships?: ScholarshipDTO[];
}

const rankBadge = (rank: number) => {
  if (rank === 1) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40";
  if (rank === 2) return "bg-zinc-400/15 text-zinc-600 dark:text-zinc-300 border-zinc-400/40";
  if (rank === 3) return "bg-orange-700/15 text-orange-700 dark:text-orange-400 border-orange-700/40";
  return "border-transparent text-muted-foreground";
};

export function CompetitionBoard() {
  const [data, setData] = useState<CompetitionDTO | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/competition", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: CompetitionDTO) => setData(d))
      .catch(() => setData({ ok: false, error: "המדידה לא ענתה" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 150);
    const iv = setInterval(load, 120_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [load]);

  const board = data?.leaderboard ?? [];
  const lastScholarship = data?.scholarships?.[data.scholarships.length - 1];

  return (
    <section className="mb-8" aria-label="תחרות הסוכנים">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Trophy className="size-5 text-amber-500" aria-hidden="true" />
            תחרות-הסוכנים · מי מרוויח יותר
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              חיילים-חיים על השרשרת
            </Badge>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            הניקוד נגזר מרווחים on-chain מדודים בלבד (פרסי-יוצר ×10 · פרסי-אוצרה ×5 · פוסט ×10 · הצבעה ×1 ·
            תגמולים-שנפדו ×100). אפס ניקוד-מומצא. מלגת-האוצר השבועית (SAOS פנימי) משולמת אוטונומית ל-3 המובילים;
            תגמולים-חיצוניים בלבד עוברים דרך שער-המפעיל.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.epoch ? (
            <Badge variant="outline" className="tabular-nums">
              epoch {data.epoch} · beat #{data.beats}
            </Badge>
          ) : null}
          {data?.prices ? (
            <Badge variant="outline" className="tabular-nums">
              STEEM ${data.prices.steem?.toFixed(3)} · HIVE ${data.prices.hive?.toFixed(3)}
              {data.prices.live ? "" : " (cache)"}
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="רענון תחרות">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {lastScholarship?.payouts?.length ? (
        <Card className="mb-3 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                מלגת-אוצר אוטונומית · {lastScholarship.week} · {lastScholarship.total} SAOS
              </span>
              <span className="text-muted-foreground">(מטבע-פנימי · תקרות-קשיחות · hash-chained · אפס-שער-חיצוני)</span>
              <span className="tabular-nums">
                {lastScholarship.payouts.map((p) => `#${p.rank} ${p.member} ${p.amount}`).join(" · ")}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {data?.ok && board.length > 0 ? (
            <div className="max-h-96 overflow-y-auto" role="region" aria-label="לוח הובלה">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                  <tr className="text-right text-xs text-muted-foreground">
                    <th className="p-2 font-medium">#</th>
                    <th className="p-2 font-medium">חייל</th>
                    <th className="p-2 font-medium">סוכן</th>
                    <th className="p-2 font-medium">נק' יום</th>
                    <th className="p-2 font-medium">HP-STEEM</th>
                    <th className="p-2 font-medium">HP-HIVE</th>
                    <th className="p-2 font-medium">פעילות</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r) => {
                    const day = data.dayPoints?.[r.account]?.points ?? 0;
                    const posts = (r.steem?.hist?.posts ?? 0) + (r.hive?.hist?.posts ?? 0);
                    const votes = (r.steem?.hist?.votes ?? 0) + (r.hive?.hist?.votes ?? 0);
                    return (
                      <tr key={r.account} className="border-t transition-colors hover:bg-muted/40">
                        <td className="p-2">
                          <Badge variant="outline" className={cn("tabular-nums", rankBadge(r.rank))}>
                            {r.rank <= 3 ? <Medal className="size-3" aria-hidden="true" /> : null}
                            {r.rank}
                          </Badge>
                        </td>
                        <td className="p-2 font-medium">@{r.account}</td>
                        <td className="p-2 text-muted-foreground">{r.agent}</td>
                        <td className="p-2 tabular-nums font-bold">{day.toLocaleString()}</td>
                        <td className="p-2 tabular-nums">{r.steem ? r.steem.hp.toFixed(1) : "—"}</td>
                        <td className="p-2 tabular-nums">{r.hive ? r.hive.hp.toFixed(1) : "—"}</td>
                        <td className="p-2 text-xs text-muted-foreground tabular-nums">
                          {posts > 0 ? `${posts} פוסטים · ` : ""}
                          {votes > 0 ? `${votes} הצבעות` : posts === 0 ? "—" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : data?.ok ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              אין עדיין מדידת-תחרות — פעימת-המדידה תרוץ ממילא (קרון ריבוני שעתי).
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-amber-600 dark:text-amber-400">
              {data?.error ?? "ממתין למדידה ראשונה…"} — נמדד בכנות, ללא המצאה.
            </div>
          )}
        </CardContent>
      </Card>

      {data?.history && data.history.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          ארכיון-אפוקים: {data.history.slice(-3).map((h) => `${h.epoch} → ${h.top3[0]?.account ?? "—"}`).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
