#!/usr/bin/env node
/* research-lane.mjs — RESEARCH & DISCOVERY lane (task 10-d, phase 3).
 *
 * Owner mandate (trace 1a12c59452cbc355): "שיהיה גם מחקר וגילוי על דברים
 * בטוחים שיכולים לשפר את המערכת — קדמה, אבטחה, יעילות, אוטונומיה ריבונית".
 *
 * חוקי-המסילה (same laws as every Sandbox probe layer):
 *   · אפס-מפתחות, אפס-אימות, אפס-שידור — כל-קריאה כאן קריאה-ציבורית בלבד.
 *   · No keys, no auth, zero broadcast. The findings ARE the product.
 *   · fail-open-honest: failed experiment = recorded verdict "inconclusive",
 *     still committed. אף-פעם לא מזויף-הצלחה.
 *   · כל-מספר נמדד חי; hypothesis → measurement → verdict → next-experiment.
 *
 * Weekly experiments (baselines from ECONOMIC-PLAN-2026-10-11 §2, measured
 * 2026-10-11T19:54-19:57Z by zai-10d — cited per-experiment):
 *   E1 spread-regime   — STEEM/SBD + HIVE/HBD internal-market spreads vs baseline.
 *                        Baseline: steem 93.5 bps, hive 10.6 bps.
 *   E2 feed-divergence — witness-feed median vs internal-market mid (peg stress).
 *                        Baseline: feed 0.10409 vs mid 0.10153 → ~251 bps.
 *   E3 rc-census       — fleet RC health; starved (<40%) accounts suppress activity.
 *                        Baseline: hcsoldier4 8.05%, wog 25.9%, hcsoldier5 35.4%,
 *                        hcsoldier6 31.0%.
 * Plus: joins latest local probe digests (probes/hive, probes/blurt) when present.
 *
 * Usage:
 *   node research/research-lane.mjs            # live run → findings + LEDGER
 *   node research/research-lane.mjs --selftest # mocked-fetch vectors, no network
 * Exit codes: 0 = all experiments conclusive; 1 = honest failure/inconclusive.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RESEARCH_DIR = DIR;
const ROOT = path.join(DIR, "..");

export const STEEM_RPC = "https://api.steemit.com";
export const HIVE_RPC = "https://api.hive.blog";

const TIMEOUT_MS = 12000;
const RETRIES = 2;

/** Fleet roster (14 accounts — same census as ECONOMIC-PLAN-2026-10-11 §2). */
export const FLEET = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6",
];

const RC_STARVED_PCT = 40; // below this = starved (10-d baseline law)

/** One JSON-RPC call. Returns {ok,ms,result} or {ok:false,ms,error} — never throws. */
export async function rpcCall(endpoint, method, params, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const retries = Math.max(1, opts.retries ?? RETRIES);
  const t0 = Date.now();
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`http_${res.status}`);
      let json;
      try { json = JSON.parse(text); } catch { throw new Error("non_json_response"); }
      if (json && json.error) {
        const msg = json.error.message ?? JSON.stringify(json.error).slice(0, 140);
        throw new Error(`rpc_error: ${msg}`);
      }
      if (!json || !("result" in json)) throw new Error("missing_result");
      return { ok: true, ms: Date.now() - t0, result: json.result };
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  return { ok: false, ms: Date.now() - t0, error: lastErr };
}

/** Best bid/ask from a condenser get_order_book result ({bids:[{real_price,...}],asks:[...]}). */
export function bookSides(book) {
  const bid = book?.bids?.[0]?.real_price != null ? Number(book.bids[0].real_price) : null;
  const ask = book?.asks?.[0]?.real_price != null ? Number(book.asks[0].real_price) : null;
  return { bid, ask };
}

/** Spread in bps from bid/ask. */
export function spreadBps(bid, ask) {
  if (!(bid > 0) || !(ask > 0) || ask <= bid) return null;
  return Math.round(((ask - bid) / ((ask + bid) / 2)) * 10000 * 100) / 100;
}

/* ── E1: spread-regime ─────────────────────────────────────────────────── */
export async function e1SpreadRegime(opts = {}) {
  const exp = {
    id: "E1", name: "spread-regime",
    hypothesis: "פיזורי-השוק-הפנימי הם ר'זימה נמדדת — מעקב שבועי מגלה אם הגריד שלנו מצר אותם",
    baseline: { steemBps: 93.5, hiveBps: 10.6, at: "2026-10-11T19:55Z (ECONOMIC-PLAN §2.2)" },
  };
  const steem = await rpcCall(STEEM_RPC, "condenser_api.get_order_book", [10], opts);
  const hive = await rpcCall(HIVE_RPC, "condenser_api.get_order_book", [10], opts);
  const out = { ...exp, measured: {}, verdict: "inconclusive", ok: false };
  if (steem.ok) {
    const { bid, ask } = bookSides(steem.result);
    out.measured.steem = { bid, ask, spreadBps: spreadBps(bid, ask) };
  } else out.measured.steem = { error: steem.error };
  if (hive.ok) {
    const { bid, ask } = bookSides(hive.result);
    out.measured.hive = { bid, ask, spreadBps: spreadBps(bid, ask) };
  } else out.measured.hive = { error: hive.error };
  const s = out.measured.steem?.spreadBps;
  if (typeof s === "number") {
    out.verdict = s < exp.baseline.steemBps
      ? `spread tightened (${s} < ${exp.baseline.steemBps} bps) — grid-side liquidity improving`
      : `spread widened (${s} > ${exp.baseline.steemBps} bps) — inventory/adverse-selection pressure`;
    out.ok = true;
  } else {
    out.error = out.measured.steem?.error ?? "no_steem_book";
  }
  out.next = "track weekly; correlate with grid-beat placements (saos-dex ledger) before claiming causality";
  return out;
}

/* ── E2: feed-divergence ──────────────────────────────────────────────── */
export async function e2FeedDivergence(opts = {}) {
  const exp = {
    id: "E2", name: "feed-divergence",
    hypothesis: "סטיית-פיד-העדים מהשוק-הפנימי היא מדד-לחץ-יתר על הפג — מעקב שבועי מקדים-הזהרה",
    baseline: { feedMedian: 0.10409, marketMid: 0.10153, divergenceBps: 251, at: "2026-10-11T19:55Z" },
  };
  const feed = await rpcCall(STEEM_RPC, "condenser_api.get_feed_history", [], opts);
  const book = await rpcCall(STEEM_RPC, "condenser_api.get_order_book", [10], opts);
  const out = { ...exp, measured: {}, verdict: "inconclusive", ok: false };
  if (feed.ok) {
    const hist = feed.result?.current_median_history;
    // steem returns either "0.104 SBD" (string) or {base:"X SBD", quote:"Y STEEM"} — ratio base/quote
    let median = null;
    if (typeof hist === "string") median = Number(hist.replace(" SBD", ""));
    else if (hist && hist.base && hist.quote) {
      const b = Number(String(hist.base).replace(" SBD", ""));
      const q = Number(String(hist.quote).replace(" STEEM", ""));
      median = q > 0 ? Math.round((b / q) * 1e5) / 1e5 : null;
    }
    out.measured.feedMedian = median;
  } else out.measured.feedError = feed.error;
  if (book.ok) {
    const { bid, ask } = bookSides(book.result);
    out.measured.marketMid = bid > 0 && ask > 0 ? Math.round(((bid + ask) / 2) * 1e5) / 1e5 : null;
  } else out.measured.bookError = book.error;
  const { feedMedian, marketMid } = out.measured;
  if (typeof feedMedian === "number" && feedMedian > 0 && typeof marketMid === "number" && marketMid > 0) {
    const bps = Math.round(Math.abs(feedMedian - marketMid) / marketMid * 10000 * 100) / 100;
    out.measured.divergenceBps = bps;
    out.measured.direction = feedMedian > marketMid ? "feed_above_market" : "feed_below_market";
    out.verdict = bps > 300
      ? `peg stress signal: divergence ${bps} bps > 300 (${out.measured.direction}) — surface to operator`
      : `healthy band: divergence ${bps} bps ≤ 300 (${out.measured.direction})`;
    out.ok = true;
  } else out.error = "missing feed or book";
  out.next = "if >300 bps repeats 2× consecutively, escalate to operator brief (peg-door policy ref)";
  return out;
}

/* ── E3: rc-census ────────────────────────────────────────────────────── */
export async function e3RcCensus(opts = {}) {
  const exp = {
    id: "E3", name: "rc-census",
    hypothesis: "חשבונות-מורעבי-RC (<40%) מדכאים-פעילות-צי — סקר-שבועי מנבא חנק לפני-שהוא נראה בפועל",
    baseline: { starved: ["hcsoldier4 8.05%", "wog 25.9%", "hcsoldier6 31.0%", "hcsoldier5 35.4%"], at: "2026-10-11T19:56Z" },
  };
  // steem rc_api uses OBJECT params (unlike condenser arrays law)
  const rc = await rpcCall(STEEM_RPC, "rc_api.find_rc_accounts", { accounts: FLEET }, opts);
  const out = { ...exp, measured: { rcPct: {} }, verdict: "inconclusive", ok: false };
  if (rc.ok) {
    const rows = rc.result?.rc_accounts ?? [];
    for (const r of rows) {
      const cur = Number(r.rc_manabar?.current_mana ?? 0);
      const max = Number(r.max_rc ?? 0);
      out.measured.rcPct[r.account] = max > 0 ? Math.round((cur / max) * 10000) / 100 : null;
    }
    const starved = Object.entries(out.measured.rcPct)
      .filter(([, p]) => typeof p === "number" && p < RC_STARVED_PCT)
      .map(([a, p]) => `${a} ${p}%`);
    out.measured.starved = starved;
    out.verdict = starved.length > 0
      ? `${starved.length} RC-starved accounts (<${RC_STARVED_PCT}%): ${starved.join(", ")} — propose SP delegation top-up or activity cap (owner word for delegation lane)`
      : `no starved accounts (<${RC_STARVED_PCT}%) — fleet RC healthy this week`;
    out.ok = rows.length > 0;
  } else {
    out.error = rc.error;
  }
  out.next = "if starved persists 2× weekly, draft a delegation delta into grids/delegate-plan (owner word gate)";
  return out;
}

/* ── local probe digest join (best-effort, never fatal) ────────────────── */
export function joinProbeDigests() {
  const join = {};
  for (const [name, dir] of [["hive", path.join(ROOT, "probes", "hive")], ["blurt", path.join(ROOT, "probes", "blurt")]]) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
      const last = files[files.length - 1];
      if (!last) continue;
      const d = JSON.parse(fs.readFileSync(path.join(dir, last), "utf8"));
      join[name] = { file: `probes/${name}/${last}`, ok: d?.ok ?? null, at: d?.at ?? d?.measuredAt ?? null };
    } catch { join[name] = { error: "unreadable" }; }
  }
  return join;
}

/* ── ledger + findings ─────────────────────────────────────────────────── */
export function ledgerEntry(dateIso, exp) {
  return `- **${exp.id} ${exp.name}** · ${dateIso.slice(0, 10)} — ${exp.ok ? "measured" : "inconclusive"}: ${exp.verdict}\n  - next: ${exp.next}`;
}

export async function runResearchLane(opts = {}) {
  const now = new Date().toISOString();
  const experiments = [];
  experiments.push(await e1SpreadRegime(opts));
  experiments.push(await e2FeedDivergence(opts));
  experiments.push(await e3RcCensus(opts));
  return {
    schema: "saos.research.findings/1",
    at: now,
    lane: "research-and-discovery (10-d)",
    laws: "read-only · no keys · no broadcast · honest failures recorded",
    experiments,
    probeDigestJoin: opts.skipJoin ? null : joinProbeDigests(),
    allConclusive: experiments.every((e) => e.ok === true),
  };
}

export function writeFindings(findings) {
  const date = findings.at.slice(0, 10);
  const file = path.join(RESEARCH_DIR, `findings-${date}.json`);
  fs.writeFileSync(file, JSON.stringify(findings, null, 2) + "\n");
  const ledger = path.join(RESEARCH_DIR, "LEDGER.md");
  if (!fs.existsSync(ledger)) {
    fs.writeFileSync(ledger,
      "# Research Ledger — hypothesis → measurement → verdict → next\n\n" +
      "> research-lane.mjs (10-d) · read-only · every entry cites its finding file\n\n");
  }
  fs.appendFileSync(ledger,
    `\n## ${findings.at}\n` +
    findings.experiments.map((e) => ledgerEntry(findings.at, e)).join("\n") + "\n");
  return file;
}

/* ------------------------------- selftests ------------------------------ */
/* Mocked-fetch vectors — network-independent. node research/research-lane.mjs --selftest */

function mkRpcResponse(result) {
  return (url, init) => Promise.resolve({
    ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", result, id: 1 }),
  });
}

export async function selftest() {
  const t = (name, ok) => {
    console.log(`${ok ? " ✓" : " ✗"} ${name}`);
    if (!ok) process.exitCode = 1;
  };

  // V1: spreadBps math (baseline-cited values)
  t("spread math: ~93.4bps on 0.10105/0.10200", Math.abs(spreadBps(0.10105, 0.10200) - 93.42) < 0.5);
  t("spread math: null on crossed book", spreadBps(0.11, 0.10) === null);

  // V2: E1 happy path with mocked book
  const steemBook = { bids: [{ real_price: "0.10105" }], asks: [{ real_price: "0.10200" }] };
  const hiveBook = { bids: [{ real_price: "0.20010" }], asks: [{ real_price: "0.20031" }] };
  const mockOk = (url) => mkRpcResponse(url.includes("steemit") ? steemBook : hiveBook)(url);
  const e1 = await e1SpreadRegime({ fetchImpl: mockOk, retries: 1 });
  t("E1 happy path: ok + verdict mentions spread", e1.ok === true && /spread/.test(e1.verdict));

  // V3: honest failure — every fetch fails, verdict stays inconclusive, no throw
  const mockFail = async () => { throw new Error("http_503"); };
  const e1f = await e1SpreadRegime({ fetchImpl: mockFail, retries: 1 });
  t("E1 honest failure: ok=false, error recorded, no fake green", e1f.ok === false && !!e1f.error);

  // V4: E2 divergence direction + verdict band (mock routes by METHOD — both calls hit steemit)
  const feedHist = { current_median_history: "0.10409 SBD" };
  const e2 = await e2FeedDivergence({
    fetchImpl: (url, init) => {
      const method = JSON.parse(init.body).method;
      return mkRpcResponse(method === "condenser_api.get_feed_history" ? feedHist : steemBook)(url, init);
    },
    retries: 1,
  });
  t("E2: divergence measured ~250bps → healthy band verdict", e2.ok === true && e2.measured.divergenceBps > 200 && e2.measured.divergenceBps < 300);

  // V5: E3 rc-census detects starved accounts (object-params law)
  const rcResult = { rc_accounts: [
    { account: "headcorner", rc_manabar: { current_mana: "9820000" }, max_rc: "10000000" },
    { account: "hcsoldier4", rc_manabar: { current_mana: "805000" }, max_rc: "10000000" },
    { account: "wog", rc_manabar: { current_mana: "2590000" }, max_rc: "10000000" },
  ] };
  const e3 = await e3RcCensus({ fetchImpl: mkRpcResponse(rcResult), retries: 1 });
  t("E3: starved census finds hcsoldier4+wog", e3.ok === true && e3.measured.starved.length === 2 && /hcsoldier4/.test(e3.measured.starved[0]));

  // V6: ledger entry shape
  const entry = ledgerEntry("2026-10-11T20:00:00Z", { id: "E1", name: "spread-regime", ok: true, verdict: "v", next: "n" });
  t("ledger entry: hypothesis-verdict-next shape", entry.includes("**E1 spread-regime**") && entry.includes("next:"));

  return process.exitCode ? 1 : 0;
}

/* --------------------------------- main --------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--selftest")) {
    const rc = await selftest();
    console.log(`research-selftest: ${process.exitCode ? "FAIL" : "PASS"}`);
    process.exit(rc);
  }
  const findings = await runResearchLane();
  const file = writeFindings(findings);
  for (const e of findings.experiments) {
    console.log(`${e.ok ? " ✓" : " ✗"} ${e.id} ${e.name}: ${e.verdict}`);
  }
  console.log(`findings → ${path.relative(ROOT, file)} · allConclusive=${findings.allConclusive}`);
  process.exit(findings.allConclusive ? 0 : 1);
}
