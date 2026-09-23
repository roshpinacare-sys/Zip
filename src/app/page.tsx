"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · האתר — ארכיטקטורת סקציות ב-SPA יחיד (route /).
//
// שש סקציות: בית (התמונה הגדולה) · הרשת · סוכנים · בורסה · ידע · אדמין.
// כל סקציה עשירה מקבלת תתי-תפריט משלה (ראה site-nav). ניתוב hash
// עמוק (#/network/ledger) מאפשר שיתוף קישורים וניווט אחורה.
// מעברי-סקציה עדינים (AnimatePresence), פוטר דביק לתחתית תמיד.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppFooter } from "@/components/weave/footer";
import { OperatorProvider } from "@/components/weave/operator";
import {
  SECTIONS as SECTIONS_LIST,
  SiteNav,
  sectionOf,
  type SiteView,
} from "@/components/weave/site-nav";
import { WeaveProvider } from "@/components/weave/store";
import { AgentsTab } from "@/components/weave/tabs/agents-tab";
import { AnchorTab } from "@/components/weave/tabs/anchor-tab";
import { DashboardTab } from "@/components/weave/tabs/dashboard-tab";
import { EcosystemTab } from "@/components/weave/tabs/ecosystem-tab";
import { LedgerTab } from "@/components/weave/tabs/ledger-tab";
import { MarketTab } from "@/components/weave/tabs/market-tab";
import { PlanTab } from "@/components/weave/tabs/plan-tab";
import { SovereigntyTab } from "@/components/weave/tabs/sovereignty-tab";
import { BrainView } from "@/components/weave/views/brain-view";
import { BrowserView } from "@/components/weave/views/browser-view";
import { DomainsView } from "@/components/weave/views/domains-view";
import { DoctrineView } from "@/components/weave/views/doctrine-view";
import { EvolutionView } from "@/components/weave/views/evolution-view";
import { ExchangeView } from "@/components/weave/views/exchange-view";
import { HoldingsView } from "@/components/weave/views/holdings-view";
import { HomeView } from "@/components/weave/views/home-view";
import { GateView } from "@/components/weave/views/gate-view";
import { HunterView } from "@/components/weave/views/hunter-view";
import { AgentsFleetView } from "@/components/weave/views/agents-fleet-view";
import { KeeperView } from "@/components/weave/views/keeper-view";
import { CharterView } from "@/components/weave/views/charter-view";
import { ArrayView } from "@/components/weave/views/array-view";
import { DefiRouterView } from "@/components/weave/views/defi-router-view";
import { HoldingsAuditView } from "@/components/weave/views/holdings-audit-view";
import { FlywheelView } from "@/components/weave/views/flywheel-view";
import { MoneyMarketView } from "@/components/weave/views/money-market-view";
import { MoneyMoverView } from "@/components/weave/views/money-mover-view";
import { CrossMarketView } from "@/components/weave/views/cross-market-view";
import { EconomyFlowView } from "@/components/weave/views/economy-flow-view";
import { StudentView } from "@/components/weave/views/student-view";
import { PublisherView } from "@/components/weave/views/publisher-view";
import { WebNetView } from "@/components/weave/views/webnet-view";
import {
  AdminCommandView,
  AdminMissionsView,
  AdminServerView,
} from "@/components/weave/views/admin";

// ── ניתוב hash: #/view/section?query=value ──────────────────────────
// החלק שאחרי ? נשמר ב-route.query — כך עובדת הקישורית החכמה של דפדפן
// הסוכנים: ‎/#/browser?s=<slug>‎ משחזר סשן שלם מהשרת בכל דומיין.

interface Route {
  view: SiteView;
  section: string;
  query: Record<string, string>;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const [v, s] = pathPart.split("/");
  const def = SECTIONS_LIST.find((x) => x.view === v);
  const view: SiteView = def ? def.view : "gate";
  const subs = def?.subs ?? [];
  const section = subs.find((x) => x.key === s)?.key ?? subs[0]?.key ?? "";
  const query: Record<string, string> = {};
  if (queryPart) {
    for (const [k, val] of new URLSearchParams(queryPart)) query[k] = val;
  }
  return { view, section, query };
}

function routeHash(route: Route): string {
  return `#/${route.view}${route.section ? `/${route.section}` : ""}`;
}

// ── רינדור סקציה+תת-סקציה ← קומפוננטה ────────────────────────────────

function SectionBody({ view, section, query }: Route) {
  switch (view) {
    case "gate":
      return <GateView />;
    case "array":
      return <ArrayView />;
    case "hunter":
      return <HunterView />;
    case "flywheel":
      return <FlywheelView />;
    case "money-market":
      // המוביל (R81) ראשון · השוק הבין-רשתי (R94) שני · הכלכלה הריבונית (R98) שלישי · ההלוואות אחרונות
      return section === "markets" ? <MoneyMarketView /> : section === "flows" ? <EconomyFlowView /> : section === "cross" ? <CrossMarketView /> : <MoneyMoverView />;
    case "holdings":
      return <HoldingsAuditView section={section} />;
    case "publish":
      return <PublisherView section={section} />;
    case "defi":
      return <DefiRouterView section={section} />;
    case "browser":
      // key לפי הסלאג — מעבר בין קישוריות שמורות מרענן את התצוגה ומשחזר
      return <BrowserView key={query.s ?? "fresh"} sessionSlug={query.s} />;
    case "domains":
      return <DomainsView />;
    case "home":
      return <HomeView />;
    case "network":
      switch (section) {
        case "webnet":
          return <WebNetView />;
        case "ledger":
          return <LedgerTab />;
        case "anchor":
          return <AnchorTab />;
        case "ecosystem":
          return <EcosystemTab />;
        case "plan":
          return <PlanTab />;
        default:
          return <DashboardTab />;
      }
    case "agents":
      return section === "ledger" ? <AgentsTab /> : section === "keeper" ? <KeeperView /> : section === "charter" ? <CharterView /> : section === "student" ? <StudentView /> : <AgentsFleetView />;
    case "exchange":
      switch (section) {
        case "market":
          return <MarketTab />;
        case "holdings":
          return <HoldingsView />;
        default:
          return <ExchangeView />;
      }
    case "knowledge":
      switch (section) {
        case "sovereignty":
          return <SovereigntyTab />;
        case "evolution":
          return <EvolutionView />;
        case "doctrine":
          return <DoctrineView />;
        default:
          return <BrainView />;
      }
    case "admin":
      switch (section) {
        case "missions":
          return <AdminMissionsView />;
        case "server":
          return <AdminServerView />;
        default:
          return <AdminCommandView />;
      }
    default:
      return <GateView />;
  }
}

export default function Page() {
  const [route, setRoute] = useState<Route>({
    view: "gate",
    section: "",
    query: {},
  });
  const reduced = useReducedMotion();

  // סנכרון hash ↔ מצב (כולל ניווט אחורה)
  useEffect(() => {
    const apply = () => setRoute(parseHash());
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const navigate = useCallback((view: SiteView, section?: string) => {
    const subs = sectionOf(view)?.subs ?? [];
    const sec =
      section && subs.some((x) => x.key === section)
        ? section
        : subs[0]?.key ?? "";
    const next: Route = { view, section: sec, query: {} };
    window.history.replaceState(null, "", routeHash(next));
    setRoute(next);
  }, []);

  return (
    <WeaveProvider>
      <OperatorProvider>
      <TooltipProvider delayDuration={150}>
        <div className="flex min-h-screen flex-col">
          <SiteNav view={route.view} section={route.section} onNavigate={navigate} />
          <main className="flex-1" id="main">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${route.view}/${route.section}`}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <SectionBody view={route.view} section={route.section} query={route.query} />
              </motion.div>
            </AnimatePresence>
          </main>
          <AppFooter />
        </div>
      </TooltipProvider>
      </OperatorProvider>
    </WeaveProvider>
  );
}
