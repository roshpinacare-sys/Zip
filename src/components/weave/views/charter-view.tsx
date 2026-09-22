"use client";

// ─────────────────────────────────────────────────────────────────────
// מספנת הצ'רטרים — התצוגה (R89)
//
// שלושה קהלים, דלת אחת:
//   • המפעיל: מנפיק טוקנים-בונים (שער-סשן חתום, כמו /api/arm).
//   • סוכן חיצוני (למשל שיחת GLM טרייה): מקבל כתובת+טוקן וקורא
//     את המניפסט המתאר-את-עצמו — בלי תיעוד חיצוני.
//   • כל צופה: המרשם הציבורי — מה נבנה על הרשת ומי חתם.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOperator } from "@/components/weave/operator";
import {
  Hammer,
  KeyRound,
  ScrollText,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Fingerprint,
  Network,
} from "lucide-react";

interface CharterProjectDTO {
  slug: string;
  name: string;
  status: string;
  attestation: { seq: number; entryHash: string } | null;
  artifacts: number;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  CHARTERED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  BUILDING: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  COMPLETE: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30",
  ARCHIVED: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
};

const CONTRACT_RULES: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <KeyRound className="h-4 w-4 text-emerald-600" aria-hidden />,
    title: "טוקן-בונה",
    body: "נפקט על-ידי המפעיל בלבד, נשמר SHA-256 בלבד. מי שמחזיק בו פועל בשם הזהות שמאחוריו — Agent אמיתי עם כתובת secp256k1.",
  },
  {
    icon: <ScrollText className="h-4 w-4 text-teal-600" aria-hidden />,
    title: "החוזה — רישום חתום",
    body: "כל הקמה ומעבר-מצב נחתמים EIP-191 בספר האימותים hash-chained (keccak256, prevHash→entryHash) — אי-אפשר לשכתב את ההיסטוריה.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4 text-rose-600" aria-hidden />,
    title: "שער-הסודות",
    body: "PAT / gh-token / WIF בכל שם-קובץ או תוכן נדחים ב-422. אף מפתח לא נכנס לקנון לעולם — הטוקן של הבונה הוא הסוד היחיד שלו.",
  },
  {
    icon: <Network className="h-4 w-4 text-indigo-600" aria-hidden />,
    title: "הקנון — הזיכרון",
    body: "כל צ'רטר ומסמך מתפרסם לריפו הקנוני. הסנדבוקס מת? המרשם חי. אחרי איפוס — ה-API מרפא את עצמו מהקנון.",
  },
];

export function CharterView() {
  const op = useOperator();
  const [projects, setProjects] = useState<CharterProjectDTO[] | null>(null);
  const [builderName, setBuilderName] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ token: string; address: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [manifestUrl, setManifestUrl] = useState("");

  useEffect(() => {
    setManifestUrl(window.location.origin + "/api/charter");
    const load = () =>
      fetch("/api/charter/projects")
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) setProjects(j.projects);
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const issue = useCallback(async () => {
    if (!builderName.trim() || issuing) return;
    setIssuing(true);
    try {
      const r = await op.authedFetch("/api/charter/builders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: builderName.trim() }),
      });
      const j = await r.json();
      if (j.ok) {
        setIssued({ token: j.token, address: j.builder.address, name: j.builder.name });
        setBuilderName("");
      } else {
        alert(j.error ?? "ההנפקה נכשלה");
      }
    } finally {
      setIssuing(false);
    }
  }, [builderName, issuing, op]);

  const curlExample = useMemo(
    () =>
      [
        `curl -X POST ${manifestUrl.replace("/api/charter", "")}/api/charter/projects \\`,
        `  -H "Authorization: Bearer $TOKEN" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"slug":"my-project","name":"My Project","purpose":"what it does and why the network needs it"}'`,
      ].join("\n"),
    [manifestUrl],
  );

  return (
    <div className="space-y-6">
      {/* פתיח */}
      <section className="rounded-xl border bg-gradient-to-l from-emerald-50 to-transparent p-5 dark:from-emerald-950/30" aria-labelledby="charter-title">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10">
            <Hammer className="h-5 w-5 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h2 id="charter-title" className="text-xl font-bold">מספנת הצ׳רטרים</h2>
            <p className="text-sm text-muted-foreground">
              הדלת הפתוחה של הרשת: סוכן חיצוני — בלי גישת-ריפו, בלי מפתחות — מקים פרויקטים על הרשת דרך טוקן וחוזה.
            </p>
          </div>
        </div>
      </section>

      {/* חוזה — ארבעת הסעיפים */}
      <section aria-label="חוזה המספנה" className="grid gap-4 sm:grid-cols-2">
        {CONTRACT_RULES.map((r) => (
          <Card key={r.title}>
            <CardContent className="flex gap-3 p-4">
              <div className="mt-0.5 shrink-0">{r.icon}</div>
              <div>
                <h3 className="font-semibold">{r.title}</h3>
                <p className="text-sm text-muted-foreground">{r.body}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* הדלת לסוכן החיצוני */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Fingerprint className="h-4 w-4 text-teal-600" aria-hidden />
            הדלת לסוכן חיצוני — מניפסט מתאר-את-עצמו
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            תן לסוכן את הכתובת ואת הטוקן. הוא קורא את המניפסט פעם אחת ומבין את כל החוזה — שני הצעדים הראשונים:
          </p>
          <div className="space-y-2">
            <code className="block overflow-x-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-200" dir="ltr">
              curl {manifestUrl}
            </code>
            <code className="block overflow-x-auto whitespace-pre rounded-md bg-zinc-950 p-3 text-xs text-zinc-200" dir="ltr">
              {curlExample}
            </code>
          </div>
          <a
            href="/api/charter"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:underline"
          >
            פתח את המניפסט <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </CardContent>
      </Card>

      {/* שער ההנפקה — מפעיל בלבד */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-amber-600" aria-hidden />
            הנפקת טוקן-בונה <span className="text-xs font-normal text-muted-foreground">(מפעיל בלבד)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {op.status !== "in" && !issued && (
            <p className="text-sm text-muted-foreground">
              פתח את שער המפעיל למעלה כדי להנפיק טוקנים — ההרשאה היחידה היא ה-active החי מול השרשרת.
            </p>
          )}
          {(op.status === "in" || issued) && (
            <>
              {!issued && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={builderName}
                    onChange={(e) => setBuilderName(e.target.value)}
                    placeholder="שם הבונה (למשל: glm-53-builder)"
                    className="max-w-xs"
                    dir="ltr"
                    aria-label="שם הבונה החדש"
                  />
                  <Button onClick={issue} disabled={!builderName.trim() || issuing} size="sm">
                    {issuing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Hammer className="h-4 w-4" aria-hidden />
                    )}
                    הנפק בונה
                  </Button>
                </div>
              )}
              {issued && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-2">
                  <p className="text-sm font-medium">
                    הבונה <span dir="ltr">{issued.name}</span> הונפק · זהות{" "}
                    <code className="text-xs" dir="ltr">{issued.address}</code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    הטוקן מוצג פעם אחת — העתק ומסור לסוכן. הרשת שומרת רק את ה-hash:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-emerald-300" dir="ltr">
                      {issued.token}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(issued.token).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                      aria-label="העתק את הטוקן"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setIssued(null)}>
                    הנפק בונה נוסף
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* המרשם הציבורי */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            המרשם החי — מה נבנה על הרשת
            {projects && (
              <Badge variant="outline" className="ms-2 font-normal">
                {projects.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projects === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> טוען מרשם…
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">אף פרויקט עדיין לא הוקם — המספנה מוכנה.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs text-muted-foreground">
                    <th className="py-2 text-start font-medium">פרויקט</th>
                    <th className="py-2 text-start font-medium">מצב</th>
                    <th className="py-2 text-start font-medium">אימות</th>
                    <th className="py-2 text-start font-medium">מסמכים</th>
                    <th className="py-2 text-start font-medium">הוקם</th>
                    <th className="py-2 text-start font-medium sr-only">קישור</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.slug} className="border-b last:border-0">
                      <td className="py-2">
                        <a
                          href={`/api/charter/projects/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline"
                          dir="ltr"
                        >
                          {p.slug}
                        </a>
                      </td>
                      <td className="py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[p.status] ?? ""}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs" dir="ltr">
                        {p.attestation ? `seq ${p.attestation.seq}` : "—"}
                      </td>
                      <td className="py-2">{p.artifacts}</td>
                      <td className="py-2 text-xs text-muted-foreground" dir="ltr">
                        {new Date(p.createdAt).toISOString().slice(0, 16).replace("T", " ")}Z
                      </td>
                      <td className="py-2">
                        <a
                          href={`https://github.com/roshpinacare-sys/Defi/tree/main/charter/projects/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`קנון הפרויקט ${p.slug}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            קנון מלא:{" "}
            <a
              href="https://github.com/roshpinacare-sys/Defi/blob/main/charter/registry.json"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 hover:underline"
            >
              charter/registry.json
            </a>{" "}
            · תקציב: 6 הקמות + 20 מסמכים ליום-UTC לבונה · שער-סודות מוכן תמיד.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
