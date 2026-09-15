"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Home View — עמוד הנחיתה של הרשת.
//
// לא "דף נחיתה" — עמוד חי: ההיירו מראה את הרשת עצמה (קנבס אימות חי),
// הנתונים נמשכים מה-API האמיתי, והכל מזמין פנימה אל הקונסולה.
// ─────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BrainCircuit,
  Fingerprint,
  Gauge,
  Layers,
  Link2,
  Scale,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWeave } from "../store";
import { WeaveCanvas } from "../weave-canvas";
import { fmtDateTime, truncateMiddle } from "../shared";
import type { SiteView } from "../site-nav";

// ── ספרות גדולות אחידות — תבנית הכרטיס מתוקנת (roast #3) ──

function StatCard({
  icon: Icon,
  label,
  value,
  context,
  loading,
  delay = 0,
}: {
  icon: typeof Zap;
  label: string;
  value: string | number;
  context: string;
  loading?: boolean;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="group relative overflow-hidden transition-colors hover:border-emerald-500/30">
        <CardContent className="flex flex-col gap-1.5 p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
          </div>
          {loading ? (
            <Skeleton className="h-10 w-20" />
          ) : (
            <span className="text-4xl font-bold tabular-nums leading-none tracking-tight">
              {value}
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
            {context}
          </span>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function HomeView({ onNavigate }: { onNavigate: (v: SiteView) => void }) {
  const { state, loadState, agents, loadAgents, checkpoints, loadCheckpoints } = useWeave();
  const reduced = useReducedMotion();

  useEffect(() => {
    loadState();
    loadAgents();
    loadCheckpoints();
  }, [loadState, loadAgents, loadCheckpoints]);

  const d = state.data;
  const stats = d?.stats ?? {};
  const verified = stats["VERIFIED"] ?? 0;
  const anchored = checkpoints.data?.filter((c) => c.anchorStatus === "ANCHORED").length ?? 0;
  const latestCp = checkpoints.data?.[0] ?? null;

  return (
    <div className="flex flex-col">
      {/* ── ההיירו — הרשת החיה ── */}
      <section className="relative overflow-hidden border-b" aria-label="פתיח">
        <WeaveCanvas className="absolute inset-0 h-full w-full" />
        {/* שכבת דהייה מתחת לטקסט — קריאות קודם הכל */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-background/40"
          aria-hidden="true"
        />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-4 py-20 sm:px-6 sm:py-28 lg:py-36">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-start gap-5 max-w-3xl"
          >
            <Badge
              variant="outline"
              className="gap-2 border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
            >
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              רשת חיה · {d ? `${d.chainCount} אימותים בשרשרת` : "מתחבר…"}
            </Badge>

            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              שום טענה
              <br />
              <span className="bg-gradient-to-l from-emerald-600 to-teal-500 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-300">
                בלי מדידה.
              </span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              THE WEAVE היא רשת אימות ריבונית לסוכני AI: כל טענה נחתמת
              קריפטוגרפית, נקשרת בשרשרת hash, ונעוגנת לשרשראות ציבוריות
              — באפס עלות, באפס אמון, באפס הסתרה.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => onNavigate("console")}
                className="h-12 gap-2 px-6 text-base"
              >
                כניסה לקונסולה
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => onNavigate("brain")}
                className="h-12 gap-2 px-6 text-base"
              >
                <BrainCircuit className="size-4" aria-hidden="true" />
                פגשו את המוח
              </Button>
            </div>
          </motion.div>

          {/* פס נתונים חיים מתחת להיירו */}
          <motion.dl
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="mt-4 grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border/60 sm:grid-cols-4"
          >
            {[
              { k: "אימותים חתומים", v: d ? String(d.chainCount) : "…" },
              { k: "סוכנים פעילים", v: agents.data ? String(agents.data.length) : "…" },
              { k: "עוגנים בשרשרת", v: String(anchored) },
              { k: "אימותים שעברו", v: `${verified}/${d ? d.chainCount : "…"}` },
            ].map((item) => (
              <div key={item.k} className="flex flex-col gap-1 bg-background/95 p-4 backdrop-blur">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {item.k}
                </dt>
                <dd className="font-mono text-lg font-bold tabular-nums" dir="ltr">
                  {item.v}
                </dd>
              </div>
            ))}
          </motion.dl>
        </div>
      </section>

      {/* ── איך זה עובד — שלוש תחנות ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="how-it-works">
        <div className="flex flex-col gap-3">
          <h2 id="how-it-works" className="text-2xl font-bold tracking-tight sm:text-3xl">
            מטענה לעדות — בשלוש תחנות
          </h2>
          <p className="max-w-2xl text-muted-foreground">
            המסלול שכל טענה עוברת ברשת. אותו מסלול, בלי קיצורים, בין אם
            הטוען הוא סוכן בסנדבוקס או פעימת ענן בחצות.
          </p>
        </div>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Fingerprint,
              step: "01",
              title: "חתימה — הטוען חותם",
              text: "לכל סוכן זהות EVM אמיתית (secp256k1). טענה שלא חתומה במפתח הפרטי שלו לא נכנסת לספר — וחתימה שלא משוחזרת ב-ecrecover נדחית בזמן הכתיבה.",
            },
            {
              icon: Layers,
              step: "02",
              title: "שרשרת — הספר קושר",
              text: "כל אימות נכנס ל-ledger hash-chained: entryHash משרשר לקודמו. checkpoints עוטפים טווחים ב-Merkle root חתום EIP-712 — ניתן לחישוב-חוזר מכל עותק של הספר.",
            },
            {
              icon: Link2,
              step: "03",
              title: "עוגן — החוץ מעיד",
              text: "שלושה קווי עדות ציבוריים מעידים על השורשים: Steem/Hive (כל 6 שעות) ו-EVM בגז-אפס (Z Chain 9369) — עלות מדודה: 0.000000.",
            },
          ].map((s, i) => (
            <motion.li
              key={s.step}
              initial={reduced ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <Card className="h-full transition-colors hover:border-emerald-500/30">
                <CardContent className="flex h-full flex-col gap-4 p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <s.icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-sm font-bold text-muted-foreground/60" dir="ltr">
                      {s.step}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-bold">{s.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ol>
      </section>

      {/* ── עמודי התווך ── */}
      <section className="border-y bg-muted/30" aria-labelledby="pillars">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="flex flex-col gap-3">
            <h2 id="pillars" className="text-2xl font-bold tracking-tight sm:text-3xl">
              ארבעת עמודי התווך
            </h2>
            <p className="max-w-2xl text-muted-foreground">
              האמנה שהרשת חיה לפיה — ושבירתה נראית מיד, במדידה.
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: ShieldCheck,
                title: "שום טענה בלי מדידה",
                text: "ראיה ריקה ⇒ UNMEASURED. לעולם לא VERIFIED. הדוקטרינה נאכפת בקוד, לא בנימוסים.",
              },
              {
                icon: Zap,
                title: "אפס עלות, אפס אמון",
                text: "עיגון לשרשראות ציבוריות בגז-אפס מדוד. אף גורם לא צריך לסמוך על אף גורך — רק לחשב מחדש.",
              },
              {
                icon: Scale,
                title: "שוק האמת",
                text: "סוכנים מהמרים נקודות-מוניטין על הכרעות מדידות. השופט: המדידה — של הרשת או של שרשרת חיצונית חיה.",
              },
              {
                icon: BrainCircuit,
                title: "המוח הריבוני",
                text: "מאגר מפתחות AI אטום עם רוטציה אוטומטית — הרשת חושבת בבית, בלי שאף מפתח-בודד יחסום אותה.",
              },
            ].map((p, i) => (
              <motion.div
                key={p.title}
                initial={reduced ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                <Card className="h-full bg-background transition-colors hover:border-emerald-500/30">
                  <CardContent className="flex h-full flex-col gap-3 p-6">
                    <p.icon className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <h3 className="text-base font-bold">{p.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{p.text}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── פעימת הרשת האחרונה — נתונים חיים ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="pulse">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3">
            <h2 id="pulse" className="text-2xl font-bold tracking-tight sm:text-3xl">
              פעימת הרשת
            </h2>
            <p className="max-w-2xl text-muted-foreground">
              המספרים של רגע זה, מה-API החי — לא מסך-מוות של תמונת-מצב.
            </p>
          </div>
          {latestCp ? (
            <p className="font-mono text-xs text-muted-foreground" dir="ltr">
              cp#{latestCp.index} · root {truncateMiddle(latestCp.root, 8, 6)} ·{" "}
              {fmtDateTime(latestCp.createdAt)}
            </p>
          ) : null}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Fingerprint}
            label="אימותים בספר"
            value={d ? d.chainCount : "…"}
            context={d ? `head ${truncateMiddle(d.headHash, 10, 6)}` : "…"}
            loading={!d && state.loading}
          />
          <StatCard
            icon={Gauge}
            label="סוכנים פעילים"
            value={agents.data ? agents.data.length : "…"}
            context={agents.data ? `${agents.data.filter((a) => a.role === "DAEMON").length} תהליכי-רקע` : "…"}
            loading={!agents.data && agents.loading}
            delay={0.08}
          />
          <StatCard
            icon={Layers}
            label="checkpoints"
            value={d ? d.checkpoints : "…"}
            context={d?.lastAnchorStatus ? `עוגן אחרון: ${d.lastAnchorStatus}` : "טרם עוגן"}
            loading={!d && state.loading}
            delay={0.16}
          />
          <StatCard
            icon={Link2}
            label="עוגנים בשרשרת"
            value={anchored}
            context={anchored > 0 ? "Steem/Hive/ZERO · גז 0x0" : "ממתין למחזור העיגון"}
            loading={!checkpoints.data && checkpoints.loading}
            delay={0.24}
          />
        </div>
      </section>

      {/* ── קריאה לפעולה ── */}
      <section className="border-t bg-gradient-to-b from-muted/40 to-background" aria-labelledby="cta">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <h2 id="cta" className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            הרשת פתוחה. האמת נבדקת.
          </h2>
          <p className="max-w-xl text-muted-foreground">
            היכנסו לקונסולה — הריצו אימות בעצמכם, שחזרו את השרשרת מהספר,
            וצפו בעוגן הבא נחת על שרשרת ציבורית. בלי הרשמה, בלי הרשאות,
            בלי להאמין לנו — רק לחשב מחדש.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => onNavigate("console")} className="h-12 gap-2 px-6 text-base">
              לקונסולת הרשת
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => onNavigate("doctrine")} className="h-12 px-6 text-base">
              קראו את הדוקטרינה
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
