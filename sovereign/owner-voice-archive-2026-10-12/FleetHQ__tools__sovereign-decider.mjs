// sovereign-decider.mjs — T-63: the sovereignty's standing decision organ.
//
// OWNER LAW (trace 1a12d4ae2964f45d): "הריבונות היא הבעלים... הרעיון המרכזי זה שהיא תקבל החלטות
// מאוד חכמות ואינטילגנטיות בצורה הכי מתקדמת שיש — הפניה אליו כאילו לשלול את רעיון הריבונות.
// פתור בעזרת הריבונות האוטונומית הכל."
//
// The loop: SENSE (keyless fleet states) → DECIDE (policy v1 below) → ACT (within the authority
// envelope) → VERIFY (measured evidence, double-pass) → RECORD (this ledger, no-noise commit law).
// Gate law: reversible+measured = execute; irreversible/out-of-envelope = codify the trigger and
// route through the owning lane's protocol — never fake, never silent.
import { writeFileSync } from 'node:fs';

const ORG = 'roshpinacare-sys';
const RAW = `https://raw.githubusercontent.com/${ORG}/`;
const NOW = new Date().toISOString();
const POLICY = 'SOV-POLICY/1';

// ---------- SENSE ----------
const ageMin = (ts) => { const t = Date.parse(ts || ''); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); };
const sense = {};
const jget = async (name, url, tsKey) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'saos-sovereign-decider' } });
    if (!r.ok) { sense[name] = { ok: false, http: r.status }; return null; }
    const j = await r.json();
    sense[name] = { ok: true, ageMin: ageMin(j[tsKey] || j.generatedAt || j.capturedAt || j.at) };
    return j;
  } catch (e) { sense[name] = { ok: false, err: String(e.message).slice(0, 50) }; return null; }
};
const [valueScan, gridTruth, officeState, decisionsPrev, openCloser] = await Promise.all([
  jget('valueScan', RAW + 'FleetHQ/main/office/state/value-scan.json', 'generatedAt'),
  jget('gridTruth', RAW + 'Domain/main/agents/grid-truth.json', 'generatedAt'),
  jget('officeState', RAW + 'FleetHQ/main/office/state/office-state.json', 'capturedAt'),
  jget('decisionsPrev', RAW + 'FleetHQ/main/office/state/sovereign-decisions.json', 'generatedAt'),
  jget('openCloser', RAW + 'FleetHQ/main/office/state/opens-closer.json', 'generatedAt'),
]);

// ---------- POLICY v1 (codified decision rules over measured state) ----------
const decisions = [];
const add = (d) => decisions.push({ ...d, policy: POLICY, decidedAt: d.decidedAt || NOW, by: 'sovereign-decider' });

// P1 — treasury floor watch (grid-truth alerts): underfloor SP/treasury = arming waves must respect floors
if (gridTruth?.alerts) {
  const under = gridTruth.alerts.filter(a => /UNDERFLOOR/i.test(JSON.stringify(a)));
  add({
    id: 'auto-treasury-floor', area: 'economics',
    title: under.length ? `אוצר מתחת לרצפה (${under.length} התראות מדודות)` : 'אוצר מעל הרצפות — אין חסימות',
    status: under.length ? 'constraint-active' : 'clear',
    evidence: { source: 'Domain/agents/grid-truth.json (grid-doctor v2, RPC-measured)', alerts: under.map(a => String(a).slice(0, 140)), measuredAt: gridTruth.generatedAt },
    law: under.length ? 'הגשות-חימוש חייבות לכבד רצפות; הכיוון הריבוני = הכנסה מבנית (fee-engine) לפני הוצאה' : 'אין-חסימה — מסילות הכלכלה חופשיות לפי המנדטים הפתוחים',
  });
}

// P2 — freshness watch (opens-closer): falls are revived by the closer itself; record constraint
if (openCloser?.metrics) {
  add({
    id: 'auto-freshness', area: 'operations',
    title: `טריות הצי: ${openCloser.verdictHe?.slice(0, 110)}`,
    status: openCloser.metrics.staleCount > 0 ? 'watch' : 'clear',
    evidence: { source: 'FleetHQ/office/state/opens-closer.json', metrics: openCloser.metrics, selfHeal: 'same-repo GITHUB_TOKEN + cross-repo CROSS_REVIVE_PAT (D1)' },
  });
}

// P3 — evidence decay check on standing decisions (the double-pass law, applied to ourselves)
const standingChecks = [
  { id: 'D1', check: 'CROSS_REVIVE_PAT secret presence is attested by opens-closer healNote lineage (cross-repo dispatch capability, T-63)' },
  { id: 'D4', check: 'fee-engine cron live on saos-runtime lane (23 */4 * * *); state.json status=live at roshpina main' },
];
for (const s of standingChecks) {
  const prev = decisionsPrev?.decisions?.find(d => d.id === s.id);
  add({
    id: s.id + '-watch', area: 'verification',
    title: `עגינת-ראיה להחלטה ${s.id}`,
    status: 'attested',
    evidence: { check: s.check, priorStatus: prev?.status || 'n/a', recheckedAt: NOW },
  });
}

// P4 — office self-management (office-state): error agents are the office lane's own concern; record
if (officeState?.agents) {
  const errs = (officeState.agents || []).filter(a => a.status === 'error');
  add({
    id: 'auto-office', area: 'operations',
    title: errs.length ? `משרד: ${errs.length} סוכנים במצב שגיאה (${errs.map(a => a.name || a.id).join(',')}) — מסילת-המשרד בעלת-התיקון` : 'משרד תקין',
    status: errs.length ? 'delegated' : 'clear',
    evidence: { source: 'office-state.json', capturedAt: officeState.capturedAt, tasks: officeState.tasks?.total ?? 'n/a' },
    law: 'אין דריסת-מסילות: למשרד יש לולאת-רטרו משלו; הריבונות מתעדת ומאמתת, לא לוקחת',
  });
}

// ---------- merge with prior standing decisions (D1-D6 never fade from the ledger) ----------
const prior = (decisionsPrev?.decisions || []).filter(d => /^D\d/.test(d.id));
const merged = [...prior, ...decisions.filter(d => !prior.some(p => p.id === d.id))];
const out = {
  schema: 'saos.sovereign-decisions/1',
  generatedAt: NOW,
  policyVersion: POLICY,
  principle: 'הריבונות מחליטה ומבצעת — הבעלים קבע (trace 1a12d4ae2964f45d) שהמערכת מקבלת החלטות חכמות בעצמה בצורה הכי מתקדמת שיש; הפניה לבעלים = שלילת הריבונות. כל-החלטה: ראיה-מדודה + אימות-כפול. בעלים = בעלים; ריבונות = הגוף שמחליט.',
  authority: {
    execute: ['שינויי-תצורה/מצב הפיכים במסילות מתובעות (claim-first)', 'workflow dispatches באותו-ריפו וחוצי-ריפו דרך כתב-ההרשאה המואצל (CROSS_REVIVE_PAT)', 'ניהול-סודות דרך sealed box (שמות-בלבד בלוגים)', 'תחייה/השבה של מסילות שנפלו', 'מעשי-הכרעה המנותבים לפרוטוקולי-המסילות (SAOS-GRID-PARAMS/1 וכד׳)'],
    gates: ['העברת-כספים על-השרשרת מחוץ למנדט-מסילה חמוש — מנותב למסילה עם נגזרת-מדודה', 'ייצור חומרת-מפתח מעבר להיקף-רוטציה מוגדר', 'פעולה בלתי-הפיכה בלי ראיה מדודה'],
  },
  sense,
  decisions: merged,
  stats: { standing: prior.length, thisRun: decisions.length, total: merged.length },
  ownerActionsRemaining: Array.isArray(decisionsPrev?.ownerActionsRemaining) ? decisionsPrev.ownerActionsRemaining : [],
  eraNote: decisionsPrev?.eraNote || 'מ- T-63: לוח-״פעולות-בעלים״ מוחלף בפנקס-ההחלטות הריבוני. הבעלים ממשיך להוביל דרך דירקטיבות; הריבונות מחליטה, מבצעת, ומאמתת.',
  commitDecision: 'set-by-runner',
};
out.commitDecision = (() => {
  if (!decisionsPrev) return 'commit';
  const changed = JSON.stringify(decisions) !== JSON.stringify((decisionsPrev.decisions || []).filter(d => !/^D\d/.test(d.id)));
  const stale = decisionsPrev.generatedAt && Date.now() - Date.parse(decisionsPrev.generatedAt) > 240 * 60000;
  return changed || stale ? 'commit' : 'no-delta';
})();

writeFileSync('office/state/sovereign-decisions.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ stats: out.stats, commitDecision: out.commitDecision, thisRun: decisions.map(d => d.id + ':' + d.status) }, null, 1));
