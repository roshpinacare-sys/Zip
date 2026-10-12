#!/usr/bin/env node
/* decision-truth.mjs — עורק-אמת-ההכרעות (H-series · zai-code-3 · Sandbox)
 * ═══════════════════════════════════════════════════════════════════════════
 * דרישת-בעלים (trace 1a12cf891f8dad2d, מילה-במילה): "לבדוק מה לא מחובר ...
 * מתאמן ובודק את עצמו בלי לסמוך על טענות יש לנו דרך לאמת ... להפוך מתיאור
 * למעשים אוטונומית ריבונית למעשה"
 *
 * החוק-החדש (H): צו-הריבונות (T14 CHARTER R1) דורש אימות-עצמאי — ואין אימות
 *   עצמאי להכרעות עצמן. העורק-הזה סוגר-את-זה. לכל הכרעה ENFORCED:
 *   · כל-מספר-עדות נמדד-מחדש-עצמאית (אותו-נוסחה, ריצה-עצמאית, מקורות-פומביים)
 *   · EXECUTION-EXISTENCE: להכרעה-שאוכפת-מדיניות חייב-להיות צרכן-מדוד —
 *     ENFORCED בלי צרכן = UNEXECUTED (תיאור, לא מעשה — והכנות-חוק)
 *   · עדויות-שהעולם-עבר-מעליהן = STALE-TRUTH (מחזור-ה-RE-MEASURE חייב-להכריע-מחדש)
 *   · מקור-שנפל = UNVERIFIABLE — כנות, לעולם לא "זיוף" (403/429/timeout אינם פשע)
 *   · וגם: לב-ההכרעות עצמו מקבל-שעון — sovereign-decider שקט >90 דק׳ = דגל.
 *
 * אפס-סודות · אפס-תלות-חוץ (stdlib בלבד) · fail-closed · provenance בכל-קבלה.
 * תחום (אנטי-דריסות): קריאה-בלבד של ops/sovereign/DECIDER/** (T14 בבעלות);
 *   כתיבה אך-ורק-ל-ops/decision-truth/**.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.OUT_DIR || join(ROOT, "ops", "decision-truth");
const DECIDER_STATE = join(ROOT, "ops", "sovereign", "DECIDER", "state.json");
const FLOW_MAP = join(ROOT, "ops", "flow", "flow-map.json");
const WORK_ORDERS = join(ROOT, "ops", "office", "work-orders.json");
const DECIDER_WF = "sovereign-decider.yml";
const LEDGER_MAX = 60;

const RAW = "https://raw.githubusercontent.com/roshpinacare-sys";
const STEEM_RPC = "https://api.steemit.com";
const FLEET = ["cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const TREASURY_TOL = 1.0;   // SP — כמו חוק-התאמת-המשואה של T14 עצמו
const OPERATOR_TOL = 2.0;   // SP — דריפת-מכפיל בין-פעימות
const DECIDER_STALL_S = 90 * 60;

const NOW = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const out = (s) => console.log(s);
const GH = {
  headers: {
    Accept: "application/vnd.github+json",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  },
};

async function fetchJson(url, timeoutMs = 20000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { headers: GH.headers, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { http: r.status, ok: false };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function steemRpc(method, params) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(STEEM_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.result ? j.result : null;
  } catch { return null; }
}

function readLocalJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

// ── מדידת-שרשרת עצמאית: אותו-נוסחה-של-T14, ריצה-עצמאית (R1: אימות ≠ העתקה) ──
async function measureChain() {
  const gp = await steemRpc("condenser_api.get_dynamic_global_properties", []);
  const accs = await steemRpc("condenser_api.get_accounts", [["headcorner", ...FLEET]]);
  if (!gp || !Array.isArray(accs) || accs.length !== FLEET.length + 1) return null;
  const tvs = parseFloat(String(gp.total_vesting_shares || "0"));
  const tvf = parseFloat(String(gp.total_vesting_fund_steem || "0"));
  if (!tvs || !tvf) return null;
  const mult = tvf / tvs;
  const sp = (a) => {
    const v = parseFloat(String(a.vesting_shares || "0"));
    const d = parseFloat(String(a.delegated_vesting_shares || "0"));
    const r = parseFloat(String(a.received_vesting_shares || "0"));
    return Math.round((v - d + r) * mult * 10) / 10;
  };
  const by = new Map(accs.map((a) => [a.name, a]));
  const ops = {};
  for (const n of FLEET) { const a = by.get(n); if (a) ops[n] = sp(a); }
  return {
    head: gp.head_block_number ?? null,
    mult,
    treasuryNetSp: sp(by.get("headcorner")),
    operatorsSp: ops,
    measuredAt: NOW(),
  };
}

// ── חילוץ-עדויות (דטרמיניסטי — אף פרשנות-חופשית) ──
export function parseFirstSp(heText) {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*SP/.exec(String(heText || ""));
  return m ? parseFloat(m[1]) : null;
}
export function parseFlowClaim(heText) {
  const t = String(heText || "");
  const o = /orphans=(\d+)/.exec(t);
  const g = /ghosts=(\d+)/.exec(t);
  return { orphans: o ? parseInt(o[1], 10) : null, ghosts: g ? parseInt(g[1], 10) : null };
}
export function parseIds(heText) {
  const t = String(heText || "");
  const set = new Set();
  for (const m of t.matchAll(/WO-[A-Za-z0-9_-]+/g)) set.add(m[0]);
  return [...set];
}
export function numWithin(actual, claimed, tol) {
  if (actual === null || actual === undefined || claimed === null || claimed === undefined) return false;
  return Math.abs(Number(actual) - Number(claimed)) <= tol;
}

// ── סיווג-אמת להכרעה (טהור — נבדק-ב-selftest) ──
export function truthFromChecks(checks) {
  const bad = (k) => (checks || []).some((c) => c.result === k);
  if (!checks || checks.length === 0) return "UNVERIFIABLE";
  if (bad("mismatch")) return "STALE-TRUTH";
  if (bad("unexecuted")) return "UNEXECUTED";
  if (bad("unverifiable")) return "UNVERIFIABLE";
  return "VERIFIED";
}

// ── סריקת-צרכנים (EXECUTION-EXISTENCE) ──
function localCorpusFiles() {
  const files = [];
  const pushDir = (dir, exts) => {
    try {
      for (const f of readdirSync(dir)) {
        if (exts.some((e) => f.endsWith(e))) files.push(join(dir, f));
      }
    } catch { /* dir missing — honest skip */ }
  };
  pushDir(join(ROOT, "engine"), [".mjs"]);
  pushDir(join(ROOT, ".github", "workflows"), [".yml", ".yaml"]);
  pushDir(join(ROOT, "ops"), [".md"]);
  for (const a of ["zai-code-2", "zai-code-3", "zai-code-4", "zai-code-5", "zai-fix", "zai-revive-10", "zai-sec-1a12af86", "zai-verifier"]) {
    const p = join(ROOT, "ops", "agents", a, "README.md");
    if (existsSync(p)) files.push(p);
  }
  return files.filter((f) => !f.includes(join("ops", "sovereign", "DECIDER")) && !f.endsWith("decision-truth.mjs"));
}
function fileMentions(path, keywords) {
  try {
    const t = readFileSync(path, "utf8");
    return keywords.filter((k) => t.includes(k));
  } catch { return []; }
}
async function scanConsumers(keywords, log) {
  const hits = [];
  for (const f of localCorpusFiles()) {
    const ks = fileMentions(f, keywords);
    if (ks.length) hits.push({ where: "sandbox:" + f.slice(ROOT.length + 1), via: ks });
  }
  const remote = [
    ["domain:index.html", `${RAW}/Domain/main/index.html`],
    ["domain:office3d/index.html", `${RAW}/Domain/main/office3d/index.html`],
  ];
  for (const [name, url] of remote) {
    try {
      const r = await fetch(url, { headers: GH.headers });
      if (r.ok) {
        const t = await r.text();
        const ks = keywords.filter((k) => t.includes(k));
        if (ks.length) hits.push({ where: name, via: ks });
      } else { log(`  consumer-scan ${name}: http ${r.status} (honest skip)`); }
    } catch { log(`  consumer-scan ${name}: fetch failed (honest skip)`); }
  }
  return hits;
}

// ── selftest — וקטורים דטרמיניסטיים, fail-closed ──
export function selftest() {
  const v = [];
  const eq = (name, a, b) => v.push({ name, ok: JSON.stringify(a) === JSON.stringify(b) });
  const is = (name, cond) => v.push({ name, ok: !!cond });
  eq("parse-sp", parseFirstSp("אוצרה נמדדת 2925.6 SP (ראש 110357634, מכפיל 0.000620205)"), 2925.6);
  eq("parse-sp-absent", parseFirstSp("אין-מספר-כאן"), null);
  eq("parse-flow", parseFlowClaim("orphans=0 · ghosts=2 (flow-map.json, F-series — צריכה בלבד)"), { orphans: 0, ghosts: 2 });
  eq("parse-wos", parseIds("עבודות-פתוחות: WO-FleetHQ-reds, WO-saos-runtime-reds"), ["WO-FleetHQ-reds", "WO-saos-runtime-reds"]);
  is("tol-within", numWithin(2926.1, 2925.6, 1.0));
  is("tol-exceeds", !numWithin(2930.0, 2925.6, 1.0));
  is("tol-null-honest", !numWithin(null, 2925.6, 1.0));
  eq("truth-verified", truthFromChecks([{ result: "ok" }, { result: "ok" }]), "VERIFIED");
  eq("truth-stale", truthFromChecks([{ result: "ok" }, { result: "mismatch" }]), "STALE-TRUTH");
  eq("truth-unexecuted", truthFromChecks([{ result: "ok" }, { result: "unexecuted" }]), "UNEXECUTED");
  eq("truth-unverifiable", truthFromChecks([{ result: "unverifiable" }]), "UNVERIFIABLE");
  eq("truth-empty", truthFromChecks([]), "UNVERIFIABLE");
  is("overall-pass", overallOf([{ truth: "VERIFIED" }, { truth: "VERIFIED" }], { stalled: false }) === "PASS");
  is("overall-alerts", overallOf([{ truth: "UNEXECUTED" }], { stalled: false }) === "PASS_WITH_ALERTS");
  is("overall-stall", overallOf([{ truth: "VERIFIED" }], { stalled: true }) === "PASS_WITH_ALERTS");
  is("overall-stall-unknown", overallOf([{ truth: "VERIFIED" }], { stalled: null }) === "PASS");
  const bad = v.filter((x) => !x.ok);
  return { ok: bad.length === 0, vectors: v.length, bad };
}
export function overallOf(decisions, heartbeat) {
  const truths = (decisions || []).map((d) => d.truth);
  if (truths.some((t) => t !== "VERIFIED")) return "PASS_WITH_ALERTS";
  return heartbeat && heartbeat.stalled === true ? "PASS_WITH_ALERTS" : "PASS";
}

// ── עורק הפעימה ──
async function run() {
  const t0 = Date.now();
  const logs = [];
  const log = (s) => { out(s); logs.push(s); };
  log(`== decision-truth · ${NOW()} ==`);

  // 0) שער-עצמי
  const st = selftest();
  log(`selftest: ${st.vectors} vectors, ok=${st.ok}${st.bad.length ? " BAD: " + st.bad.map((b) => b.name).join(",") : ""}`);

  // 1) פנקס-ההכרעות (מקומי — checkout טרי)
  const decider = readLocalJson(DECIDER_STATE);
  if (!decider || !Array.isArray(decider.decisions) || decider.decisions.length === 0) {
    const verdict = {
      schema: "sandbox/decision-truth/1", generatedAt: NOW(), overall: "FAIL",
      reason: "decider state unreadable or empty - the sovereignty's book is missing (red, honest)",
      provenance: provenance(), selftest: st,
    };
    writeBooks(verdict, logs);
    out("DECIDER-STATE-MISSING — FAIL (honest)");
    process.exit(1);
  }
  const stateAgeMin = Math.max(0, Math.round((Date.now() - Date.parse(decider.generatedAt || NOW())) / 60000));
  log(`decider state: generatedAt=${decider.generatedAt} age=${stateAgeMin}min decisions=${decider.decisions.length}`);

  // 2) מדידות-עצמאיות (כולן keyless פומביות)
  const [chain, beaconR, foremanR, deciderRuns] = await Promise.all([
    measureChain(),
    fetchJson(`${RAW}/sovereign-beacon/main/state.json`),
    fetchJson(`${RAW}/FleetHQ/main/office/state/office-state.json`),
    fetchJson(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || "roshpinacare-sys/Sandbox"}/actions/workflows/${DECIDER_WF}/runs?per_page=1`),
  ]);
  const beaconPulse = beaconR && beaconR.ok ? (beaconR.data.lastPulse || {}) : null;
  const foreman = foremanR && foremanR.ok ? foremanR.data : null;
  const faultedAgents = foreman && Array.isArray(foreman.agents)
    ? foreman.agents.filter((a) => a.state === "error").map((a) => a.id)
    : null;
  const lastDeciderRun = deciderRuns && deciderRuns.ok && deciderRuns.data.workflow_runs ? deciderRuns.data.workflow_runs[0] : null;
  const deciderAgeS = lastDeciderRun ? Math.round((Date.now() - Date.parse(lastDeciderRun.created_at)) / 1000) : null;
  const heartbeat = {
    workflow: DECIDER_WF, lastRunAt: lastDeciderRun ? lastDeciderRun.created_at : null,
    ageS: deciderAgeS,
    stalled: deciderRuns && deciderRuns.ok ? (lastDeciderRun ? deciderAgeS > DECIDER_STALL_S : true) : null,
  };
  log(`chain: ${chain ? `head=${chain.head} treasury=${chain.treasuryNetSp}SP` : "UNVERIFIABLE (rpc down)"}`);
  log(`beacon: ${beaconPulse ? `pulse=${beaconPulse.treasuryNetSp}SP` : "UNVERIFIABLE"}`);
  log(`foreman faulted agents now: ${faultedAgents ? JSON.stringify(faultedAgents) : "UNVERIFIABLE"}`);
  log(`decider heartbeat: ${heartbeat.lastRunAt || "none"} age=${deciderAgeS ?? "?"}s stalled=${heartbeat.stalled}`);

  const flow = readLocalJson(FLOW_MAP);
  const wos = readLocalJson(WORK_ORDERS);
  const flowSummary = flow && flow.summary ? flow.summary : null;
  const wosById = new Map(Array.isArray(wos) ? wos.map((w) => [w.id, w]) : []);
  log(`flow summary: ${flowSummary ? `nodes=${flowSummary.nodes} edges=${flowSummary.edges} orphans=${flowSummary.orphans}` : "missing"}`);
  log(`work-orders: ${Array.isArray(wos) ? wos.map((w) => w.id).join(", ") : "missing"}`);

  // 3) אימות-פר-הכרעה
  const decisions = [];
  for (const d of decider.decisions) {
    const checks = [];
    const claim = (law, result, detail) => checks.push({ law, result, detail });
    const evidenceText = JSON.stringify(d.evidence || []);

    if (d.id === "D1-econ-treasury-floor") {
      // א. עקביות-פנימית-של-המדיניות (טהור — אין-דריפה)
      const pol = d.policy || {};
      const floors = pol.operatorInterimFloors || [];
      const tierFloor = { 1: 75, 2: 30, 3: 20 };
      const tierOk = floors.length === FLEET.length && floors.every((f) => tierFloor[f.tier] === f.interimFloorSp);
      claim("policy-internal-consistency", tierOk ? "ok" : "mismatch",
        `interimFloors=${floors.length}/${FLEET.length} tier-mapping=${tierOk ? "ok" : "broken"}`);
      // ב. בסיס-אוצרה — מדידה-עצמאית מול העדות + המשואה
      const claimedSp = parseFirstSp((d.evidence || [])[0] || "");
      const chainOk = chain && numWithin(chain.treasuryNetSp, claimedSp, TREASURY_TOL);
      claim("treasury-basis-fresh-measure", chain ? (chainOk ? "ok" : "mismatch") : "unverifiable",
        `claimed=${claimedSp} fresh=${chain ? chain.treasuryNetSp : null} tol=${TREASURY_TOL}`);
      const beaconOk = beaconPulse && numWithin(beaconPulse.treasuryNetSp, chain ? chain.treasuryNetSp : null, TREASURY_TOL);
      claim("beacon-vs-fresh", beaconPulse ? (beaconOk ? "ok" : "mismatch") : "unverifiable",
        `beacon=${beaconPulse ? beaconPulse.treasuryNetSp : null}`);
      // ג. בסיס-מפעילים — מדידה-עצמאית מול measuredSp בפנקס (דריפה-מותרת)
      if (chain && chain.operatorsSp) {
        const drift = floors
          .map((f) => ({ op: f.operator, policySp: f.measuredSp, freshSp: chain.operatorsSp[f.operator] }))
          .filter((x) => typeof x.freshSp === "number" && !numWithin(x.freshSp, x.policySp, OPERATOR_TOL));
        claim("operators-basis", drift.length === 0 ? "ok" : "mismatch",
          drift.length === 0 ? `all ${floors.length} operators within ±${OPERATOR_TOL}SP` : JSON.stringify(drift.slice(0, 4)));
        const below = floors.filter((f) => typeof chain.operatorsSp[f.operator] === "number" && chain.operatorsSp[f.operator] < f.interimFloorSp - OPERATOR_TOL).map((f) => f.operator);
        const declared = pol.operatorsBelowInterimFloor || [];
        const same = below.length === declared.length && below.every((b) => declared.includes(b));
        claim("below-floor-list", same ? "ok" : "mismatch", `fresh-below=${JSON.stringify(below)} declared=${JSON.stringify(declared)}`);
      } else {
        claim("operators-basis", "unverifiable", "no fresh chain measure");
      }
      // ד. EXECUTION-EXISTENCE — הצד-ה-keyless-האוכף-עכשיו: מנועי-התשואה חיים
      const consumers = await scanConsumers(["operatingFloorSp", "interimFloorSp", "operatorInterimFloors", "D1-econ-treasury-floor"], log);
      log(`  D1 consumer scan: ${consumers.length} hits`);
      if (consumers.length === 0) {
        claim("execution-existence", "unexecuted",
          "ENFORCED policy with zero measured consumers in the estate corpus - description, not action (route: fleet-yield T-45 curation floors + owner P0 for keyed top-ups)");
      } else {
        claim("execution-existence", "ok", JSON.stringify(consumers.slice(0, 3)));
      }
      const yieldEngines = (d.policy && d.policy.yieldEngines) || {};
      claim("yield-engines-declared", yieldEngines && yieldEngines.dex ? "ok" : "mismatch",
        `dex=${yieldEngines.dex || "none"} curation=${yieldEngines.curation || "none"}`);
    }

    if (d.id === "D2-eng-errors") {
      const routed = parseIds(evidenceText);
      const missing = routed.filter((w) => !wosById.has(w));
      claim("routed-orders-exist", routed.length === 0 ? "unverifiable" : (missing.length === 0 ? "ok" : "mismatch"),
        `routed=${JSON.stringify(routed)} missing=${JSON.stringify(missing)}`);
      const untracked = routed.filter((w) => { const o = wosById.get(w); return o && !("status" in o); });
      claim("orders-status-tracking", untracked.length === 0 ? "ok" : "unverifiable",
        untracked.length === 0 ? "all routed orders carry status" : `orders without status field (done-ness unverifiable): ${JSON.stringify(untracked)} - route: growth engine add status lifecycle`);
      // FleetHQ reds re-measure (public Actions API): reds persist = WO subject still present;
      // reds cleared = world moved past the routed order (mismatch -> STALE).
      const runs = await fetchJson("https://api.github.com/repos/roshpinacare-sys/FleetHQ/actions/runs?per_page=60");
      if (runs.ok) {
        const since = Date.now() - 48 * 3600 * 1000;
        const reds = (runs.data.workflow_runs || []).filter((r) => r.conclusion === "failure" && Date.parse(r.created_at) >= since).length;
        claim("fleethq-reds-persist", reds > 0 ? "ok" : "mismatch",
          reds > 0 ? `failure runs in last 48h: ${reds} - routed WO-FleetHQ-reds subject persists (work pending)` : "0 failure runs in 48h - WO-FleetHQ-reds satisfied, world moved past the decision - RE-MEASURE");
      } else {
        claim("fleethq-reds-persist", "unverifiable", `fleet runs http ${runs.status || "?"}`);
      }
      // The commanded fix: faulted agents still faulted = fix NOT executed (honest UNEXECUTED)
      const still = faultedAgents;
      if (still === null) {
        claim("faulted-agents-fix", "unverifiable", "foreman source down");
      } else {
        const evLine = (d.evidence || []).find((e) => String(e).includes("סוכנים בתקלה"));
        const claimedSet = evLine
          ? String(evLine).split(":").slice(1).join(":").split(",").map((s) => s.trim()).filter(Boolean)
          : null;
        if (claimedSet && claimedSet.length && claimedSet.every((n) => still.includes(n))) {
          claim("faulted-agents-fix", "unexecuted", `all claimed faulted agents still faulted NOW (${JSON.stringify(still)}) - the routed fix has not happened - route: engineering lanes`);
        } else if (still.length === 0) {
          claim("faulted-agents-fix", "mismatch", "foreman reports zero faulted agents NOW - fix landed, world moved past the decision - RE-MEASURE");
        } else {
          claim("faulted-agents-fix", "mismatch", `claimed=${JSON.stringify(claimedSet)} fresh=${JSON.stringify(still)} - world changed since decision - RE-MEASURE`);
        }
      }
    }

    if (d.id === "D3-flow-weave") {
      const claimed = parseFlowClaim(evidenceText);
      const freshOrphans = flowSummary ? flowSummary.orphans : null;
      const freshGhosts = flowSummary && typeof flowSummary.ghosts === "number" ? flowSummary.ghosts : null;
      const orphanOk = numWithin(freshOrphans, claimed.orphans, 0);
      const ghostOk = numWithin(freshGhosts, claimed.ghosts, 0);
      claim("orphans-fresh", freshOrphans === null ? "unverifiable" : (orphanOk ? "ok" : "mismatch"), `claimed=${claimed.orphans} fresh=${freshOrphans}`);
      if (freshGhosts === null) {
        claim("ghosts-fresh", "unverifiable", "flow summary lacks ghost count");
      } else if (claimed.ghosts > 0 && freshGhosts >= claimed.ghosts) {
        claim("ghost-handling-executed", "unexecuted", `decision commands handling ${claimed.ghosts} ghosts; fresh=${freshGhosts} unchanged - the routed fix (digest repoint, office lane) has not landed yet`);
      } else if (ghostOk) {
        claim("ghosts-fresh", "ok", `claimed=${claimed.ghosts} fresh=${freshGhosts}`);
      } else {
        claim("ghosts-fresh", "mismatch", `claimed=${claimed.ghosts} fresh=${freshGhosts} - world moved past the decision - RE-MEASURE should retire or re-decide`);
      }
    }

    // חוק-גנרי: טריות-פנקס-ההכרעה
    claim("decider-state-age", stateAgeMin <= 120 ? "ok" : "mismatch", `state age ${stateAgeMin}min (limit 120)`);

    const truth = truthFromChecks(checks);
    decisions.push({
      id: d.id, area: d.area, status: d.status, priority: d.priority,
      decidedAt: d.decidedAt || null, truth, checks,
      note: truth === "VERIFIED" ? "evidence re-measured independently + execution present"
        : truth === "STALE-TRUTH" ? "world moved past published evidence - T14 RE-MEASURE must re-decide (honest cycle)"
        : truth === "UNEXECUTED" ? "ENFORCED without a measured consumer - description vs action gap (routed via ledger)"
        : "source down - honest, never forged",
    });
    log(`  ${d.id}: ${truth} (${checks.map((c) => c.law + "=" + c.result).join(" ")})`);
  }

  const overall = overallOf(decisions, heartbeat);
  const verdict = {
    schema: "sandbox/decision-truth/1",
    generatedAt: NOW(),
    durationMs: Date.now() - t0,
    overall,
    charter: "ops/sovereign/DECIDER/CHARTER.md",
    law: "H: every ENFORCED decision must re-measure its evidence independently AND show a measured consumer; stale evidence = STALE-TRUTH; no consumer = UNEXECUTED; source down = UNVERIFIABLE (never forged)",
    decider: { generatedAt: decider.generatedAt, stateAgeMin, heartbeat },
    measures: {
      chain: chain ? { head: chain.head, treasuryNetSp: chain.treasuryNetSp, mult: chain.mult } : null,
      beaconPulse: beaconPulse ? { treasuryNetSp: beaconPulse.treasuryNetSp } : null,
      faultedAgentsNow: faultedAgents,
      flowSummary: flowSummary ? { nodes: flowSummary.nodes, edges: flowSummary.edges, orphans: flowSummary.orphans, ghosts: flowSummary.ghostSources ? flowSummary.ghostSources.length : null } : null,
      workOrderIds: Array.isArray(wos) ? wos.map((w) => w.id) : null,
    },
    decisions,
    provenance: provenance(),
    selftest: { vectors: st.vectors, ok: st.ok },
  };
  writeBooks(verdict, logs);
  out(`OVERALL: ${overall}`);
  process.exit(overall === "FAIL" ? 1 : 0);
}

function provenance() {
  return {
    runId: process.env.GITHUB_RUN_ID || null,
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    sha: process.env.GITHUB_SHA || null,
    engine: "engine/decision-truth.mjs (H-series, zai-code-3)",
    generatedAt: NOW(),
  };
}

function writeBooks(verdict, logs) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "verdict.json"), JSON.stringify(verdict, null, 1) + "\n");
  const lp = join(OUT_DIR, "log.jsonl");
  const entry = JSON.stringify({
    at: verdict.generatedAt, overall: verdict.overall,
    decisions: (verdict.decisions || []).map((d) => `${d.id}:${d.truth}`),
    deciderStalled: verdict.decider ? verdict.decider.heartbeat.stalled : null,
    provenance: { runId: verdict.provenance.runId, sha: verdict.provenance.sha },
  });
  let lines = [];
  try { lines = readFileSync(lp, "utf8").split("\n").filter(Boolean); } catch { }
  lines.push(entry);
  writeFileSync(lp, lines.slice(-LEDGER_MAX).join("\n") + "\n");
  try { appendFileSync(join(OUT_DIR, "run.log"), logs.join("\n") + "\n"); } catch { }
}

if (process.argv.includes("--selftest")) {
  const st = selftest();
  out(`selftest: ${st.vectors} vectors ok=${st.ok}`);
  if (st.bad.length) { out(st.bad.map((b) => `FAIL ${b.name}`).join("\n")); process.exit(1); }
  process.exit(0);
} else {
  run().catch((e) => { out("ENGINE-ERROR: " + (e && e.stack || e)); process.exit(1); });
}
