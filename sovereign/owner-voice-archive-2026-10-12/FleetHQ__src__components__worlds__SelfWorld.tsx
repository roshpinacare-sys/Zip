/**
 * SelfWorld.tsx — עולם-העצמי: המשרד בודק את עצמו, בלי לסמוך על טענות. [zai-14]
 * ---------------------------------------------------------------------------
 * מציג את שלוש ההוכחות העומדות של האורגניזם (trace 1a12cf8c33f87d71):
 *   · האורקל-הטרי — בתים ציבוריים == בתים מחויבים (sha256, drift = אדום)
 *   · חיבוריות — מה לא מחובר, נמדד (connectivity-audit: יתומים/ארטיפקטים/כלים)
 *   · קבלת-אתחול — גיל כנה; stale מוצג כ-stale, לעולם לא מולבש כטרי
 * אין מצב-מדומה: מקור שנפל נכתב כנפל. כל הנתונים מגשר-האמת /api/worlds-state.
 */
'use client';

import type { WorldsPayload } from '@/lib/worlds/types';

function Chip({ tone, children }: { tone: 'ok' | 'bad' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'border-[color:var(--ok)]/40 bg-[color:var(--ok)]/10 text-[color:var(--ok)]'
      : tone === 'bad'
        ? 'border-red-500/40 bg-red-500/10 text-red-400'
        : 'border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink-3)]';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`}>{children}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)]/70 p-3" dir="rtl">
      <h3 className="mb-2 text-[12px] font-bold tracking-wide text-[color:var(--ink)]">{title}</h3>
      {children}
    </section>
  );
}

export function SelfWorld({ p }: { p: WorldsPayload | null }) {
  const oracle = p?.freshOracle?.data;
  const conn = p?.connectivity?.data;
  const boot = p?.bootVerify;

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4" dir="rtl">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-extrabold text-[color:var(--ink)]">עצמי — המשרד בודק את עצמו</h2>
          <span className="text-[10.5px] text-[color:var(--ink-3)]">מקור: /api/worlds-state · אין טענות — רק בתים</span>
        </header>

        {/* האורקל-הטרי */}
        <Section title="האורקל-הטרי · בתים ציבוריים מול מחויבים">
          {oracle?.summary ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Chip tone={oracle.summary.verdict === 'FRESH' ? 'ok' : 'bad'}>
                  {oracle.summary.verdict === 'FRESH' ? 'טרי' : 'סוטה/שבור'} · {oracle.summary.match}/{oracle.summary.checked} MATCH
                </Chip>
                <span className="text-[10px] text-[color:var(--ink-3)]">
                  drift={oracle.summary.drift ?? '?'} · missing={oracle.summary.missing ?? '?'} · חוק: אין ירוק בלי שוויון-בתים
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {(oracle.results ?? []).map((r) => (
                  <li key={r.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--line)]/60 bg-[color:var(--surface-2)]/50 px-2 py-1.5">
                    <Chip tone={r.verdict === 'MATCH' ? 'ok' : 'bad'}>{r.verdict}</Chip>
                    <span className="text-[11.5px] font-semibold text-[color:var(--ink)]">{r.name}</span>
                    <span className="font-mono text-[10px] text-[color:var(--ink-3)]" dir="ltr">
                      live={r.liveSha16 ?? '—'} / git={r.committedSha16 ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[11.5px] text-[color:var(--ink-3)]">
              {p?.freshOracle?.error ?? 'האורקל טרם רץ — fresh-oracle.yml יריץ אותו כל 30 דק׳ (כנות: אין נתונים זה מצב)'}
            </p>
          )}
        </Section>

        {/* חיבוריות */}
        <Section title="חיבוריות · מה לא מחובר (נמדד, לא נטען)">
          {conn?.graph ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Chip tone={(conn.graph.trueOrphanCount ?? 0) === 0 ? 'ok' : 'bad'}>
                  יתומים-אמיתיים: {conn.graph.trueOrphanCount ?? 0}
                </Chip>
                <Chip tone="muted">קבצי-קוד {conn.graph.codeFiles ?? '?'} · נגישים {conn.graph.reachable ?? '?'}</Chip>
                <Chip tone="muted">ספריית-UI {conn.graph.libraryCount ?? 0} · סקאפולד {conn.graph.scaffoldCount ?? 0}</Chip>
              </div>
              {(conn.artifacts?.unwired?.length ?? 0) > 0 && (
                <div className="mb-1.5">
                  <span className="text-[11px] font-semibold text-[color:var(--ink-2)]">ארטיפקטים ללא צרכן:</span>
                  <ul className="mt-1 flex flex-col gap-1">
                    {conn.artifacts!.unwired!.map((a) => (
                      <li key={a.path} className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-2 py-1">
                        <span className="font-mono text-[10.5px] text-[color:var(--ink)]" dir="ltr">{a.path}</span>
                        <span className="text-[10px] text-[color:var(--ink-3)]">{a.bytes}B · sha16 {a.sha16}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(conn.tools?.unwiredCI?.length ?? 0) > 0 && (
                <p className="text-[11px] text-[color:var(--ink-2)]">
                  כלים מחוץ ל‑CI: <span className="font-mono text-[10.5px]" dir="ltr">{conn.tools!.unwiredCI!.join(', ')}</span>
                </p>
              )}
              <p className="mt-1.5 text-[10px] text-[color:var(--ink-3)]">משטח-מוצר: {(conn.productSurface?.routes ?? []).join(' · ')}</p>
            </>
          ) : (
            <p className="text-[11.5px] text-[color:var(--ink-3)]">
              {p?.connectivity?.error ?? 'ביקורת-החיבוריות טרם פורסמה — office-ci יריץ אותה בכל דחיפה'}
            </p>
          )}
        </Section>

        {/* קבלת-אתחול */}
        <Section title="קבלת-אתחול · גיל כנה">
          {boot?.ok && boot.data ? (
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={boot.data.all_ok ? 'ok' : 'bad'}>{boot.data.all_ok ? 'אתחול תקין' : 'אתחול עם כשלים'}</Chip>
              <Chip tone={(boot.ageH ?? 999) > 24 ? 'bad' : 'muted'}>
                {(boot.ageH ?? 999) > 24 ? `חייבת-התחדשות: גיל ${boot.ageH} שע׳` : `גיל ${boot.ageH} שע׳`}
              </Chip>
              <span className="text-[10px] text-[color:var(--ink-3)]">
                הקבלה הזו הייתה יתומה (אף קורא) — עכשיו חיה כאן; office-selfcheck מחדש אותה כל 30 דק׳
              </span>
            </div>
          ) : (
            <p className="text-[11.5px] text-[color:var(--ink-3)]">{boot?.error ?? 'קבלת-האתחול לא זמינה — כנות מלאה'}</p>
          )}
        </Section>

        <footer className="pb-2 text-[10px] leading-relaxed text-[color:var(--ink-3)]" dir="rtl">
          הלולאה העומדת: office-selfcheck מאתחל את המשרד על הספרים האמיתיים (Domain/agents · truth), מריץ את סוויטת-האבטחה מול הבוט-החי, את ביקורת-החיבוריות ואת האורקל-הטרי — ומדווח בקבלות שנוסעות על הגיט.
        </footer>
      </div>
    </div>
  );
}
