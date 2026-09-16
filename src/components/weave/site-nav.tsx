"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Site Nav — הניווט הראשי של האתר.
//
// היררכיה אמיתית: בית · בורסה · המטבעים · קונסולה · המוח · אבולוציה · דוקטרינה.
// ה-HEAD החי ליד הלוגו — השרשרת נוכחת גם בשורת הכתובת של האתר.
// מובייל: תפריט-גשר (Sheet) במקום שורה דחוסה.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { BarChart3, Coins, BrainCircuit, Globe2, History, Home, LayoutDashboard, Menu, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useWeave } from "./store";
import { HashChip } from "./shared";
import { ThemeToggle } from "./theme-toggle";

export type SiteView =
  | "home"
  | "exchange"
  | "holdings"
  | "console"
  | "brain"
  | "doctrine"
  | "evolution";

const NAV: Array<{ view: SiteView; label: string; icon: typeof Home }> = [
  { view: "home", label: "בית", icon: Home },
  { view: "exchange", label: "בורסה", icon: BarChart3 },
  { view: "holdings", label: "המטבעים", icon: Coins },
  { view: "console", label: "קונסולה", icon: LayoutDashboard },
  { view: "brain", label: "המוח הריבוני", icon: BrainCircuit },
  { view: "evolution", label: "אבולוציה", icon: History },
  { view: "doctrine", label: "דוקטרינה", icon: ScrollText },
];

export function SiteNav({
  view,
  onNavigate,
}: {
  view: SiteView;
  onNavigate: (v: SiteView) => void;
}) {
  const { state } = useWeave();
  const headHash = state.data?.headHash ?? null;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (v: SiteView) => {
    onNavigate(v);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b bg-background/85 backdrop-blur-md transition-shadow duration-300",
        scrolled && "shadow-[0_1px_0_0_rgba(0,0,0,0.04)] dark:shadow-none"
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        {/* לוגו — כפתור הבית */}
        <button
          type="button"
          onClick={() => go("home")}
          className="group flex min-w-0 items-center gap-3 text-start"
          aria-label="THE WEAVE — עמוד הבית"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition-transform duration-300 group-hover:scale-105 dark:text-emerald-400"
            aria-hidden="true"
          >
            <Globe2 className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold tracking-tight sm:text-base">
              SAOS · THE WEAVE
            </span>
            <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">
              רשת האימות הריבונית לסוכני AI
            </span>
          </span>
        </button>

        {/* ניווט דסקטופ */}
        <nav aria-label="ניווט ראשי" className="hidden flex-1 justify-center md:flex">
          <div className="flex items-center gap-1 rounded-full border bg-muted/40 p-1">
            {NAV.map((item) => {
              const active = view === item.view;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => go(item.view)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          <HashChip
            value={headHash}
            label="HEAD"
            head={6}
            tail={4}
            className="hidden shrink-0 lg:inline-flex"
          />
          <ThemeToggle />

          {/* תפריט מובייל */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-10 md:hidden"
                aria-label="פתח תפריט"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-4">
              <SheetTitle className="text-sm font-bold">ניווט</SheetTitle>
              <nav aria-label="ניווט ראשי במובייל" className="mt-4 grid gap-2">
                {NAV.map((item) => {
                  const active = view === item.view;
                  return (
                    <button
                      key={item.view}
                      type="button"
                      onClick={() => go(item.view)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-12 items-center gap-3 rounded-lg border px-4 text-sm font-medium transition-colors",
                        active
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-border bg-background hover:bg-muted/50"
                      )}
                    >
                      <item.icon className="size-5" aria-hidden="true" />
                      {item.label}
                    </button>
                  );
                })}
                <div className="mt-3 flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
                  <span className="text-xs text-muted-foreground">שרשרת חיה</span>
                  <HashChip value={headHash} label="HEAD" head={6} tail={4} />
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
