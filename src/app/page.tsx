"use client";

import {
  Anchor,
  Boxes,
  Globe2,
  LayoutDashboard,
  Map,
  ScrollText,
  Users,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppFooter } from "@/components/weave/footer";
import { AppHeader } from "@/components/weave/header";
import { WeaveProvider } from "@/components/weave/store";
import { AgentsTab } from "@/components/weave/tabs/agents-tab";
import { AnchorTab } from "@/components/weave/tabs/anchor-tab";
import { DashboardTab } from "@/components/weave/tabs/dashboard-tab";
import { EcosystemTab } from "@/components/weave/tabs/ecosystem-tab";
import { LedgerTab } from "@/components/weave/tabs/ledger-tab";
import { PlanTab } from "@/components/weave/tabs/plan-tab";
import { SovereigntyTab } from "@/components/weave/tabs/sovereignty-tab";

const TABS = [
  { value: "dashboard", label: "לוח בקרה", icon: LayoutDashboard },
  { value: "ledger", label: "ספר אימותים", icon: ScrollText },
  { value: "agents", label: "סוכנים", icon: Users },
  { value: "anchor", label: "עוגן EVM", icon: Anchor },
  { value: "ecosystem", label: "אקוסיסטם", icon: Boxes },
  { value: "plan", label: "תוכנית ופרוטוקול", icon: Map },
  { value: "sovereignty", label: "רשת ריבונית", icon: Globe2 },
] as const;

export default function Page() {
  return (
    <WeaveProvider>
      <TooltipProvider delayDuration={150}>
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <main className="flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:py-6">
              <Tabs defaultValue="dashboard" className="gap-4 sm:gap-6">
                <div className="w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
                  <TabsList className="h-auto w-max min-w-full justify-start gap-1 p-1 sm:w-fit">
                    {TABS.map((tab) => (
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
          </main>
          <AppFooter />
        </div>
      </TooltipProvider>
    </WeaveProvider>
  );
}
