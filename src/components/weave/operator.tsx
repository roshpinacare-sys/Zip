"use client";

// ─────────────────────────────────────────────────────────────────────
// OPERATOR AUTH · מקום-ההתחברות של המפעיל — גם באדמין, גם בכל האתר.
//
// מקום אחד להתחבר עם המפתח: הקלט נשלח פעם אחת ל-/api/auth/login,
// שם הוא נבדק מול ה-active החי של @headcorner בשרשרת Steem.
// מה שחוזר הוא טוקן-סשן חתום (12 שעות) — ורק הוא נשמר, ב-sessionStorage
// של הלשונית. המפתח עצמו לא נשמר אף-פעם בשום מקום.
//
// כל קריאות האדמין (/api/admin/*) דורשות את הטוקן מרגע זה.
// ─────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  LogOut,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TOKEN_KEY = "saos_operator_token";

// ── איתות-mount ללא setState-באפקט (תבנית קנונית) ─────────────────────
// useSyncExternalStore: ברינדור השרת וברינדור-ההידרציה הראשון נקרא
// getServerSnapshot (false — שלד ניטרלי, זהה ביט-לביט לשרת), ואחרי
// ה-mount נקרא getSnapshot (true). אין מצב-ביניים במקור ה-HTML הראשוני,
// אין tearing, ואין setState סינכרוני בגוף אפקט.
const emptySubscribe = () => () => {};

function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export interface OperatorState {
  status: "checking" | "out" | "in";
  account: string | null;
  publicKey: string | null;
  expiresAt: string | null;
}

interface OperatorCtx extends OperatorState {
  login: (key: string) => Promise<boolean>;
  logout: () => void;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const Ctx = createContext<OperatorCtx | null>(null);

export function useOperator(): OperatorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOperator חייב OperatorProvider");
  return ctx;
}

// ── fetch עם טוקן-המפעיל ─────────────────────────────────────────────

function authedFetchImpl(token: string, input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, cache: "no-store" });
}

// ── Provider ─────────────────────────────────────────────────────────

export function OperatorProvider({ children }: { children: ReactNode }) {
  // אתחול בטוח-SSR: הרינדור הראשון זהה תמיד — "בודק" — גם בשרת וגם
  // בקליינט, בלי קריאת sessionStorage בזמן-הרינדור. ההחלטה בין "לא
  // מחובר"/"מחובר" מתרחשת רק באפקט שאחרי ה-mount — כך עץ ההידרציה
  // לעולם לא נקרע (תיקון hydration-mismatch: בלי סתם שרת≠קליינט).
  const [state, setState] = useState<OperatorState>({
    status: "checking",
    account: null,
    publicKey: null,
    expiresAt: null,
  });

  // בטעינה: בלי טוקן בלשונית — "לא מחובר" מיד; עם טוקן — מאומת מול
  // השרת (הטוקן אולי פג-תוקף). כל מעברי-המצב בתוך ה-flow האסינכרוני —
  // אף setState סינכרוני בגוף האפקט.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      if (!token) {
        if (alive)
          setState({ status: "out", account: null, publicKey: null, expiresAt: null });
        return;
      }
      try {
        const res = await authedFetchImpl(token, "/api/auth/session");
        if (!alive) return;
        if (res.ok) {
          const j = (await res.json()) as {
            account?: string;
            publicKey?: string;
            expiresAt?: string;
          };
          setState({
            status: "in",
            account: j.account ?? "headcorner",
            publicKey: j.publicKey ?? null,
            expiresAt: j.expiresAt ?? null,
          });
        } else {
          sessionStorage.removeItem(TOKEN_KEY);
          setState({ status: "out", account: null, publicKey: null, expiresAt: null });
        }
      } catch {
        if (alive)
          setState({ status: "out", account: null, publicKey: null, expiresAt: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (key: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
        cache: "no-store",
      });
      const j = (await res.json()) as {
        ok: boolean;
        stage?: string;
        reason?: string;
        account?: string;
        publicKey?: string;
        token?: string;
        expiresAt?: string;
      };
      if (!res.ok || !j.ok || !j.token) {
        toast.error("ההתחברות נכשלה", {
          description: j.reason ?? `שלב: ${j.stage ?? res.status}`,
        });
        return false;
      }
      sessionStorage.setItem(TOKEN_KEY, j.token);
      setState({
        status: "in",
        account: j.account ?? "headcorner",
        publicKey: j.publicKey ?? null,
        expiresAt: j.expiresAt ?? null,
      });
      toast.success(`מחובר כ-@${j.account ?? "headcorner"}`, {
        description: "הרשאת ה-active אומתה מול השרשרת · הסשן חי 12 שעות",
      });
      return true;
    } catch (e) {
      toast.error("ההתחברות נכשלה", {
        description: e instanceof Error ? e.message : "שגיאת רשת",
      });
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setState({ status: "out", account: null, publicKey: null, expiresAt: null });
    toast.info("התנתקת מהאדמין");
  }, []);

  const authedFetch = useCallback(
    (input: string, init: RequestInit = {}) => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      return token
        ? authedFetchImpl(token, input, init)
        : Promise.resolve(new Response(JSON.stringify({ ok: false, locked: true }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }));
    },
    []
  );

  const value = useMemo(
    () => ({ ...state, login, logout, authedFetch }),
    [state, login, logout, authedFetch]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── כרטיס-ההתחברות — "המקום להתחבר" ─────────────────────────────────

export function OperatorLoginCard({
  compact = false,
  title = "כניסת מפעיל",
}: {
  compact?: boolean;
  title?: string;
}) {
  const { login } = useOperator();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    try {
      await login(key.trim());
    } finally {
      setBusy(false);
      setKey("");
    }
  }, [key, busy, login]);

  return (
    <Card className="border-[#d4af37]/35 bg-gradient-to-b from-[#d4af37]/[0.07] to-transparent">
      <CardContent className={cn("space-y-4", compact ? "p-4" : "p-6")}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10">
            <KeyRound className="size-5 text-[#d4af37]" aria-hidden />
          </div>
          <div>
            <h2 className={cn("font-bold text-zinc-100", compact ? "text-base" : "text-lg")}>
              {title}
            </h2>
            <p className="text-xs text-zinc-500">
              התחברות עם מפתח ה-active של המפעיל — אימות חי מול השרשרת
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="op-key" className="block text-xs font-semibold text-zinc-400">
            מפתח ה-active (WIF המתחיל ב-5/K/L, או סיסמת-אב של Steemit)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="op-key"
                dir="ltr"
                type={show ? "text" : "password"}
                className="border-zinc-700 bg-zinc-900/70 pr-10 font-mono text-sm placeholder:text-zinc-600"
                placeholder="5K… / L… / סיסמת-אב"
                value={key}
                disabled={busy}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                aria-label={show ? "הסתר מפתח" : "הצג מפתח"}
                className="absolute inset-y-0 right-2 my-auto text-zinc-500 transition-colors hover:text-zinc-300"
                onClick={() => setShow((v) => !v)}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button
              className="bg-[#d4af37] font-bold text-zinc-950 hover:bg-[#e8cd6e]"
              disabled={busy || !key.trim()}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              התחברות
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            המפתח נבדק מול הסמכות החיה של <span className="font-mono">@headcorner</span> בשרשרת
            Steem — ביט מול ביט. לא נשמר לשום מקום, לא נשלח הלאה, ולא חוזר בתשובה. הסשן חתום
            ל-12 שעות.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── תג-מצב קטן (לכלי העליון) ───────────────────────────────────────

export function OperatorPill() {
  const { status, account, logout } = useOperator();
  // אנטי-hydration לפי-פרוטוקול: הרינדור הראשון (שרת + הידרציה) מפיק
  // שלד-דטרמיניסטי ניטרלי בלבד — מצב ביניים ("בודק סשן…") לעולם לא
  // נכנס למקור ה-HTML הראשוני; הוא מוצג רק אחרי mount, בלקוח בלבד.
  const mounted = useMounted();

  if (!mounted)
    return (
      <span
        aria-hidden="true"
        className="inline-block h-[26px] min-w-[86px] animate-pulse rounded-full border border-zinc-800 bg-zinc-900/60"
      />
    );

  if (status === "checking")
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-500">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        <span className="hidden sm:inline">בודק סשן…</span>
      </div>
    );
  if (status === "out")
    return (
      <a
        href="#/admin/command"
        className="flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2.5 py-1 text-[11px] font-semibold text-[#e8cd6e] transition-colors hover:bg-[#d4af37]/20"
        aria-label="כניסת מפעיל — אזור האדמין"
      >
        <KeyRound className="size-3" aria-hidden />
        <span className="hidden sm:inline">כניסת מפעיל</span>
      </a>
    );
  return (
    <button
      type="button"
      onClick={logout}
      className="flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
      aria-label={`מחובר כ-@${account ?? "headcorner"} — לחיצה מתנתקת`}
      title={`מחובר כ-@${account ?? "headcorner"} · לחיצה מתנתקת`}
    >
      <ShieldCheck className="size-3" aria-hidden />
      <span className="hidden sm:inline">מחובר @{account ?? "headcorner"}</span>
      <LogOut className="size-3 sm:hidden" aria-hidden />
    </button>
  );
}

// ── שער-האדמין: עוטף תוכן של תצוגות-אדמין ───────────────────────────

export function AdminGate({ children }: { children: ReactNode }) {
  const { status, account, publicKey, expiresAt, logout } = useOperator();
  // אותו דפוס-mount כמו ב-OperatorPill: טרם-mount — שלד דטרמיניסטי
  // ללא טקסט-ביניים; "בודק סשן-מפעיל…" רק אחרי mount, בלקוח בלבד.
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="mx-auto h-5 w-40 animate-pulse rounded-full bg-zinc-800/60" />
      </div>
    );
  }

  if (status === "checking") {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          בודק סשן-מפעיל…
        </div>
      </div>
    );
  }

  if (status === "out") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <OperatorLoginCard />
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs leading-relaxed text-zinc-500">
          <Lock className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden />
          <span>
            אזור האדמין נעול. הכניסה נעשית רק עם מפתח ה-active של המפעיל — אותו מחזיק
            המפקד בלבד. אין סיסמאות, אין משתמשים: השרשרת עצמה היא ההרשאה.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-600/25 bg-emerald-500/[0.06] px-4 py-3">
        <div className="flex items-center gap-2.5 text-sm">
          <Fingerprint className="size-4 text-emerald-400" aria-hidden />
          <span className="font-semibold text-emerald-300">
            מחובר כ-@{account ?? "headcorner"}
          </span>
          {publicKey && (
            <span className="hidden font-mono text-[11px] text-zinc-500 md:inline" dir="ltr">
              {publicKey.slice(0, 16)}…
            </span>
          )}
          {expiresAt && (
            <span className="text-[11px] text-zinc-500">
              · תקף עד {new Date(expiresAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-zinc-700 text-zinc-400 hover:text-zinc-200"
          onClick={logout}
        >
          <LogOut className="size-3.5" aria-hidden />
          התנתקות
        </Button>
      </div>
      {children}
    </div>
  );
}
