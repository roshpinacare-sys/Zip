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
import { DoctrineView } from "@/components/weave/views/doctrine-view";
import { EvolutionView } from "@/components/weave/views/evolution-view";
import { ExchangeView } from "@/components/weave/views/exchange-view";
import { HoldingsView } from "@/components/weave/views/holdings-view";
import { HomeView } from "@/components/weave/views/home-view";
import { AgentsFleetView } from "@/components/weave/views/agents-fleet-view";
import {
  AdminCommandView,
  AdminMissionsView,
  AdminServerView,
} from "@/components/weave/views/admin";

// ── ניתוב hash: #/view/section ──────────────────────────────────────

interface Route {
  view: SiteView;
  section: string;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [v, s] = raw.split("/");
  const def = SECTIONS_LIST.find((x) => x.view === v);
  const view: SiteView = def ? def.view : "home";
  const subs = def?.subs ?? [];
  const section = subs.find((x) => x.key === s)?.key ?? subs[0]?.key ?? "";
  return { view, section };
}

function routeHash(route: Route): string {
  return `#/${route.view}${route.section ? `/${route.section}` : ""}`;
}

// ── רינדור סקציה+תת-סקציה ← קומפוננטה ────────────────────────────────

function SectionBody({ view, section }: Route) {
  switch (view) {
    case "home":
      return <HomeView />;
    case "network":
      switch (section) {
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
      return section === "ledger" ? <AgentsTab /> : <AgentsFleetView />;
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
      return <HomeView />;
  }
}

export default function Page() {
  const [route, setRoute] = useState<Route>({ view: "home", section: "" });
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
    const next: Route = { view, section: sec };
    window.history.replaceState(null, "", routeHash(next));
    setRoute(next);
  }, []);

  return (
    <WeaveProvider>
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
                <SectionBody view={route.view} section={route.section} />
              </motion.div>
            </AnimatePresence>
          </main>
          <AppFooter />
        </div>
      </TooltipProvider>
    </WeaveProvider>
  );
}
