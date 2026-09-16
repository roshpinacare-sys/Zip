"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · האתר — ארכיטקטורת עמודים ב-SPA יחיד (route /).
//
// חמישה עמודים: בית (נחיתה חיה) · קונסולה (8 טאבים) · המוח · אבולוציה · דוקטרינה.
// מעברי-עמוד עדינים (AnimatePresence), פוטר דביק לתחתית תמיד.
// ─────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppFooter } from "@/components/weave/footer";
import { SiteNav, type SiteView } from "@/components/weave/site-nav";
import { WeaveProvider } from "@/components/weave/store";
import { AgentsTab } from "@/components/weave/tabs/agents-tab";
import { AnchorTab } from "@/components/weave/tabs/anchor-tab";
import { DashboardTab } from "@/components/weave/tabs/dashboard-tab";
import { EcosystemTab } from "@/components/weave/tabs/ecosystem-tab";
import { ExchangeView } from "@/components/weave/views/exchange-view";
import { HoldingsView } from "@/components/weave/views/holdings-view";
import { LedgerTab } from "@/components/weave/tabs/ledger-tab";
import { MarketTab } from "@/components/weave/tabs/market-tab";
import { PlanTab } from "@/components/weave/tabs/plan-tab";
import { SovereigntyTab } from "@/components/weave/tabs/sovereignty-tab";
import { BrainView } from "@/components/weave/views/brain-view";
import { DoctrineView } from "@/components/weave/views/doctrine-view";
import { EvolutionView } from "@/components/weave/views/evolution-view";
import { HomeView } from "@/components/weave/views/home-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Anchor,
  Boxes,
  LayoutDashboard,
  Map,
  Scale,
  ScrollText,
  Users,
} from "lucide-react";

const CONSOLE_TABS = [
  { value: "dashboard", label: "לוח בקרה", icon: LayoutDashboard },
  { value: "ledger", label: "ספר אימותים", icon: ScrollText },
  { value: "market", label: "שוק האמת", icon: Scale },
  { value: "agents", label: "סוכנים", icon: Users },
  { value: "anchor", label: "עוגן EVM", icon: Anchor },
  { value: "ecosystem", label: "אקוסיסטם", icon: Boxes },
  { value: "plan", label: "תוכנית ופרוטוקול", icon: Map },
  { value: "sovereignty", label: "רשת ריבונית", icon: ScrollText },
] as const;

function ConsoleView() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Tabs defaultValue="dashboard" className="gap-4 sm:gap-6">
        <div className="w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
          <TabsList className="h-auto w-max min-w-full justify-start gap-1 p-1 sm:w-fit">
            {CONSOLE_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-11 gap-1.5 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm"
              >
                <tab.icon />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="dashboard">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="market">
          <MarketTab />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsTab />
        </TabsContent>
        <TabsContent value="anchor">
          <AnchorTab />
        </TabsContent>
        <TabsContent value="ecosystem">
          <EcosystemTab />
        </TabsContent>
        <TabsContent value="plan">
          <PlanTab />
        </TabsContent>
        <TabsContent value="sovereignty">
          <SovereigntyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function Page() {
  const [view, setView] = useState<SiteView>("home");
  const reduced = useReducedMotion();

  return (
    <WeaveProvider>
      <TooltipProvider delayDuration={150}>
        <div className="flex min-h-screen flex-col">
          <SiteNav view={view} onNavigate={setView} />
          <main className="flex-1" id="main">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {view === "home" ? <HomeView onNavigate={setView} /> : null}
                {view === "exchange" ? <ExchangeView /> : null}
                {view === "holdings" ? <HoldingsView /> : null}
                {view === "console" ? <ConsoleView /> : null}
                {view === "brain" ? <BrainView /> : null}
                {view === "doctrine" ? <DoctrineView /> : null}
                {view === "evolution" ? <EvolutionView /> : null}
              </motion.div>
            </AnimatePresence>
          </main>
          <AppFooter />
        </div>
      </TooltipProvider>
    </WeaveProvider>
  );
}
