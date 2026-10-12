#!/usr/bin/env node
/**
 * gate.mjs — EVO-WINDOWS STALENESS GATE (zai-13d · trace 1a12d186d2f8b86d)
 * WO-unwired-evo-windows P2 — the honest Sandbox-side tombstone-measurer.
 *
 * WHY THIS SHAPE (measured, 2026-10-11):
 *   The reef→evo-windows engine lives in Domain/agents/ (evo-windows.cjs,
 *   CR-0033 PULLED-SCHEDULE desk) and its books are consumed there by
 *   agents/pulse.cjs:141 as evidence. The books' single room is Domain —
 *   so the honest act available to a Sandbox lane is NOT a forked book
 *   (ONE-room law) but a weekly keyless MEASUREMENT of the truth:
 *   how stale are the books, and is the engine still alive.
 *
 * CHECKS (fail-open — the gate reports, it never chases; verdicts always exit 0):
 *   V-EVO-BOOK-FRESH   Domain/agents/evo-windows.json committed age vs law
 *                      (engine cadenceHours=20h → GREEN ≤48h · AMBER ≤168h ·
 *                      RED >168h · UNKNOWN on fetch/parse fail). Reports
 *                      lastComplete (CARRY-LAW: pulse joins it at any age),
 *                      windowCount/completeCount, nextDueAt.
 *   V-EVO-DESK-BOOK    Domain/agents/reef-harness-evo.json (the CR-0030
 *                      child desk book) — informational: at + winner label.
 *   V-EVO-ENGINE-ALIVE white-box pins of the engine's exported cores
 *                      (decide/classifyOutcome — side-effect-free require)
 *                      + one live invocation with EVO_WINDOWS_SKIP_RUN=1 in
 *                      a throwaway shallow clone (PULLED-SCHEDULE: exactly
 *                      one decision, one appended row — windows+1 or RED).
 *                      Zero writes outside the temp dir. Zero keys. Zero
 *                      network beyond the public clone/raw fetch.
 *
 * HOUSE LAWS MIRRORED (fresh-oracle, zai-12b): selftest-gate before live;
 * union receipt keeps prior runs (cap 12) and never rewrites history;
 * secrets-audit before every write (finding = abort, nothing written);
 * readback verification after write; RED published loudly, exit stays 0.
 *
 * Usage: node ops/evo-windows-staleness/gate.mjs [--selftest]
 */
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECEIPT = path.join(HERE, "..", "..", "receipts", "evo-windows-staleness-latest.json");
const VERDICT_MD = path.join(HERE, "verdict.md");
const DOMAIN_RAW = "https://raw.githubusercontent.com/roshpinacare-sys/Domain/main/agents/";
const DOMAIN_GIT = "https://github.com/roshpinacare-sys/Domain.git";
const AT = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/* ── verdict ladder (documented law — see header) ── */
export function ageVerdict(ageH) {
  if (ageH == null || !Number.isFinite(ageH)) return "UNKNOWN";
  if (ageH <= 48) return "GREEN";
  if (ageH <= 168) return "AMBER";
  return "RED";
}
export function bookAgeHours(book) {
  if (!book || !book.at) return null;
  const t = Date.parse(book.at);
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : null;
}
export function lastCompleteAgeHours(book) {
  const lc = book && Array.isArray(book.windows) ? [...book.windows].reverse().find((r) => r.status === "WINDOW-COMPLETE") : null;
  if (!lc || !lc.at) return { row: null, ageH: null };
  const t = Date.parse(lc.at);
  return { row: lc, ageH: Number.isFinite(t) ? (Date.now() - t) / 3600000 : null };
}

/* ── keyless fetch (cache-bust; honest UNKNOWN on failure) ── */
async function fetchJson(url, { timeoutMs = 12000, tries = 2 } = {}) {
  let lastErr = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "roshpinacare-staleness-gate/1 (zai-13d)" },
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      return { ok: true, json: await res.json() };
    } catch (e) { lastErr = String(e && e.message).slice(0, 80); }
  }
  return { ok: false, err: lastErr };
}

/* ── secrets auditor (house law: finding = abort, nothing written) ── */
export function secretsScan(text) {
  const pats = [
    ["gh-token", /gh[pousr]_[A-Za-z0-9]{30,}/],
    ["wif-shape", /\b5[HJK][1-9A-HJ-NP-Za-km-z]{47,52}\b/],
    ["steem-key", /STM[0-9a-zA-Z]{50}/],
    ["generic-assign", /\b(SA_FLEET_KEYS|STEEM_ACTIVE_WIF|postingWif|ZIP_PAT|BUS_TOKEN)\b\s*[:=]\s*['"][^'"]{8,}/],
  ];
  const found = [];
  for (const [name, re] of pats) if (re.test(text)) found.push(name);
  return found;
}

/* ── union receipt (history never rewritten; runs cap 12) ── */
export function unionReceipt(prior, run, cap = 12) {
  const runs = Array.isArray(prior && prior.runs) ? [...prior.runs, run].slice(-cap) : [run];
  const latest = runs[runs.length - 1];
  return {
    ok: true,
    at: latest.at,
    agent: "evo-windows-staleness-gate v1 (zai-13d — WO-unwired-evo-windows: weekly keyless staleness tombstone over the Domain/agents evo chain)",
    summary: latest.summary,
    runs,
    note: "prior runs preserved verbatim (append-only, cap 12). The book's single room is Domain — this gate measures truth, it does not fork books.",
  };
}

/* ── verdict.md (Hebrew, honest) ── */
export function buildVerdictMd(run) {
  const icon = { GREEN: "🟢", AMBER: "🟡", RED: "🔴", UNKNOWN: "⚪" };
  const lines = [
    `# מצבה-טריות evo-windows — ${run.at}`,
    ``,
    `WO-unwired-evo-windows (zai-13d): שרשרת reef→evo-windows חיה ב-Domain/agents (חדר-אחד — אין-כפילות-ספרים); זהו מדיד-האמת השבועי שלה, לא עותק.`,
    ``,
  ];
  for (const c of run.checks) {
    lines.push(`- ${icon[c.verdict] || "⚪"} **${c.id}** — ${c.verdict}: ${c.detail}`);
  }
  lines.push(``, `פסק-מסכם: ${run.summary.GREEN}G · ${run.summary.AMBER}A · ${run.summary.RED}R · ${run.summary.UNKNOWN}U — מדידה-כנה fail-open (exit 0 תמיד; השער מדווח, לא רודף).`);
  if (run.summary.RED > 0) lines.push(``, `🔴 אדום-מפורסם = הצלחת-השער: האמת גלויה לצרכני-pulse; התיקון (cron-בעלים ב-Domain או קבלה) הוא צעד-בעלים, לא צעד-סוכן.`);
  return lines.join("\n") + "\n";
}

/* ── the engine-alive probe (white-box pins + one SKIP_RUN invocation) ── */
export function engineAliveProbe(tempDir) {
  const AG = path.join(tempDir, "agents");
  const pinsScript = path.join(tempDir, "pins.cjs");
  fs.writeFileSync(pinsScript, `
const m = require(${JSON.stringify(path.join(AG, "evo-windows.cjs"))});
const A = (c, msg) => { if (!c) { console.error("PIN-FAIL: " + msg); process.exit(1); } };
A(m.decide({ force: true, skipRun: false, historyLast: null, seededAt: null, evoBookFresh: false, hasDeskRuntime: true }).kind === "RUN", "force→RUN");
A(m.decide({ force: true, skipRun: true, historyLast: null, seededAt: null, evoBookFresh: false, hasDeskRuntime: true }).mode === "FORCED", "force beats skip (mode FORCED)");
A(m.decide({ force: false, skipRun: true, historyLast: null, seededAt: null, evoBookFresh: false, hasDeskRuntime: true }).kind === "SKIPPED-EVAL-CONTEXT", "skipRun→SKIPPED-EVAL-CONTEXT");
A(m.decide({ force: false, skipRun: false, historyLast: { at: new Date().toISOString() }, seededAt: null, evoBookFresh: false, hasDeskRuntime: true }).kind === "SKIPPED-TOO-SOON", "too-soon within cadence");
A(m.decide({ force: false, skipRun: false, historyLast: null, seededAt: null, evoBookFresh: true, hasDeskRuntime: true }).kind === "BOOTSTRAP-SEEDED", "fresh desk book seeds cadence");
A(m.classifyOutcome(null).status === "WINDOW-NO-WINNER", "no book → WINDOW-NO-WINNER");
const oc = m.classifyOutcome({ winner: { label: "v1-incumbent" }, serve_windows: { shim: { verified_dead: true }, reef: { verified_dead: true } } });
A(oc.status === "INCUMBENT-RETAINED" && oc.leakCheck === "PASS", "incumbent retained + leak PASS");
console.log("PINS-OK");
`);
  const pins = spawnSync(process.execPath, [pinsScript], { encoding: "utf8", timeout: 30000 });
  if (pins.status !== 0) return { ok: false, why: `white-box pins failed: ${(pins.stderr || pins.stdout || "no output").trim().slice(0, 120)}` };
  const committed = JSON.parse(fs.readFileSync(path.join(AG, "evo-windows.json"), "utf8"));
  const run = spawnSync(process.execPath, ["agents/evo-windows.cjs"], {
    cwd: tempDir, encoding: "utf8", timeout: 60000,
    env: { ...process.env, EVO_WINDOWS_SKIP_RUN: "1" },
  });
  if (run.status !== 0) return { ok: false, why: `engine invocation exit ${run.status} (fail-soft law expected exit 0)` };
  const book = JSON.parse(fs.readFileSync(path.join(AG, "evo-windows.json"), "utf8"));
  const appended = book.windowCount === committed.windowCount + 1;
  const honestSkip = book.decisionKind === "SKIPPED-EVAL-CONTEXT";
  if (!appended || !honestSkip) {
    return { ok: false, why: `PULLED-SCHEDULE violated: windows ${committed.windowCount}→${book.windowCount} (append-only +1 expected), decisionKind=${book.decisionKind}` };
  }
  return { ok: true, why: `7 white-box pins PASS · live SKIP_RUN invocation booked ${book.windowCount} (was ${committed.windowCount}), decisionKind=${book.decisionKind}, exit 0` };
}

/* ── selftest (offline vectors — gate must be able to fail CI honestly) ── */
function selftest() {
  const T = (c, m) => { if (!c) { console.log(`FAIL ${m}`); process.exitCode = 1; } else console.log(`PASS ${m}`); };
  const now = Date.now();
  const h = (x) => x * 3600000;
  T(ageVerdict(0) === "GREEN" && ageVerdict(47.9) === "GREEN", "verdict ladder: fresh ≤48h GREEN");
  T(ageVerdict(48.1) === "AMBER" && ageVerdict(168) === "AMBER", "verdict ladder: 48–168h AMBER");
  T(ageVerdict(168.1) === "RED" && ageVerdict(174.6) === "RED", "verdict ladder: >168h RED (the WO's 7-8d state)");
  T(ageVerdict(NaN) === "UNKNOWN" && ageVerdict(null) === "UNKNOWN", "verdict ladder: non-number → UNKNOWN");
  T(bookAgeHours(null) === null && bookAgeHours({ at: "garbage" }) === null, "bookAge: absent/garbage → null (no invention)");
  T(Math.abs(bookAgeHours({ at: new Date(now - h(2)).toISOString() }) - 2) < 0.1, "bookAge: 2h-old book measures ~2");
  const lc = lastCompleteAgeHours({ windows: [{ status: "SKIPPED-EVAL-CONTEXT", at: new Date(now - h(1)).toISOString() }, { status: "WINDOW-COMPLETE", at: new Date(now - h(5)).toISOString() }] });
  T(lc.row && lc.row.status === "WINDOW-COMPLETE" && Math.abs(lc.ageH - 5) < 0.1, "lastComplete: last WINDOW-COMPLETE found among skip rows (CARRY-LAW row)");
  T(lastCompleteAgeHours({ windows: [{ status: "SKIPPED-TOO-SOON", at: new Date(now - h(1)).toISOString() }] }).row === null, "lastComplete: none-ever → null row (pulse mode CADENCE-ONLY)");
  T(secretsScan("clean receipt text").length === 0, "secrets scan: clean text → 0 findings");
  T(secretsScan("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234567890 inside").includes("gh-token"), "secrets scan: gh-token caught");
  const seeded = { runs: [{ at: "2026-10-04T00:00:00Z", summary: { GREEN: 1, AMBER: 0, RED: 0, UNKNOWN: 0 } }] };
  const run = { at: AT(), summary: { GREEN: 2, AMBER: 0, RED: 1, UNKNOWN: 0 } };
  const u1 = unionReceipt(seeded, run);
  T(u1.runs.length === 2 && u1.runs[0].at === "2026-10-04T00:00:00Z", "union receipt: prior run preserved verbatim");
  const many = { runs: Array.from({ length: 12 }, (_, i) => ({ at: `2026-10-0${(i % 9) + 1}T00:00:00Z` })) };
  const u2 = unionReceipt(many, run);
  T(u2.runs.length === 12 && u2.runs[11].at === run.at, "union receipt: cap 12, latest kept, history append-only");
  const u3 = unionReceipt(null, run);
  T(u3.runs.length === 1, "union receipt: null prior → fresh book (first run)");
  const md = buildVerdictMd({ at: run.at, checks: [{ id: "V-EVO-BOOK-FRESH", verdict: "RED", detail: "x" }], summary: run.summary });
  T(md.includes("WO-unwired-evo-windows") && md.includes("RED"), "verdict.md: Hebrew builder carries WO id + verdict");
  console.log(process.exitCode ? "SELFTEST: FAIL" : "SELFTEST: ALL GREEN");
}

/* ── live gate ── */
async function live() {
  const run = { at: AT(), trigger: process.env.GITHUB_EVENT_NAME ? "workflow_dispatch" : "local", checks: [], summary: { GREEN: 0, AMBER: 0, RED: 0, UNKNOWN: 0 } };
  const push = (id, verdict, detail) => { run.checks.push({ id, verdict, detail }); run.summary[verdict]++; console.log(`[${verdict}] ${id} — ${detail}`); };

  /* 1+2: keyless book fetches (the single-room truth in Domain) */
  const bookRes = await fetchJson(DOMAIN_RAW + "evo-windows.json");
  if (bookRes.ok) {
    const book = bookRes.json;
    const bookAge = bookAgeHours(book);
    const lc = lastCompleteAgeHours(book);
    const verdict = ageVerdict(lc.ageH != null ? lc.ageH : bookAge);
    push("V-EVO-BOOK-FRESH", verdict,
      `book.at ${book.at} (${bookAge == null ? "?" : bookAge.toFixed(1) + "h"}) · cadence ${book.cadenceHours}h · windows ${book.windowCount} (complete ${book.completeCount}) · lastComplete ${lc.row ? lc.row.at + ` (${lc.ageH.toFixed(1)}h)` : "none-ever (pulse mode CADENCE-ONLY)"} · nextDue ${book.nextDueAt || "—"} · ladder GREEN≤48h/AMBER≤168h/RED>168h`);
  } else {
    push("V-EVO-BOOK-FRESH", "UNKNOWN", `fetch failed: ${bookRes.err} — honest degradation, no invention`);
  }
  const deskRes = await fetchJson(DOMAIN_RAW + "reef-harness-evo.json");
  if (deskRes.ok) {
    const d = deskRes.json;
    push("V-EVO-DESK-BOOK", "GREEN",
      `CR-0030 desk book present: at ${d.at || "?"} · winner ${d.winner ? d.winner.label : "none-yet"} · rows ${Array.isArray(d.rows) ? d.rows.length : "?"} (informational — the child's measured state)`);
  } else {
    push("V-EVO-DESK-BOOK", "UNKNOWN", `fetch failed: ${deskRes.err} (desk book absent/stale is honest — no winner measured yet)`);
  }

  /* 3: engine-alive probe — throwaway clone, white-box pins + one SKIP_RUN row */
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evo-probe-"));
    const clone = spawnSync("git", ["clone", "--depth", "1", "--quiet", DOMAIN_GIT, tmp], { encoding: "utf8", timeout: 90000 });
    if (clone.status !== 0) throw new Error(`clone failed: ${(clone.stderr || "").trim().slice(0, 90)}`);
    const probe = engineAliveProbe(tmp);
    push("V-EVO-ENGINE-ALIVE", probe.ok ? "GREEN" : "RED", probe.why);
  } catch (e) {
    push("V-EVO-ENGINE-ALIVE", "UNKNOWN", `probe infrastructure failed: ${String(e && e.message).slice(0, 110)} — honest degradation`);
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  }

  /* write path: secrets-audit → union receipt → readback (house law) */
  const prior = fs.existsSync(RECEIPT) ? JSON.parse(fs.readFileSync(RECEIPT, "utf8")) : null;
  const receipt = unionReceipt(prior, run);
  const md = buildVerdictMd(run);
  const audit = secretsScan(JSON.stringify(receipt) + md);
  if (audit.length) {
    console.error(`SECRETS-AUDIT ABORT (${audit.join(",")}): nothing written — fix the payload, never redact silently`);
    return;
  }
  fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + "\n");
  fs.writeFileSync(VERDICT_MD, md);
  const rb = JSON.parse(fs.readFileSync(RECEIPT, "utf8"));
  console.log(`readback: receipt ok=${rb.ok} runs=${rb.runs.length} · verdict.md ${fs.statSync(VERDICT_MD).size}B`);
  console.log(`SUMMARY ${run.at}: GREEN=${run.summary.GREEN} AMBER=${run.summary.AMBER} RED=${run.summary.RED} UNKNOWN=${run.summary.UNKNOWN}`);
  if (run.summary.RED > 0) console.log("🔴 RED published — the gate's success is the truth being visible; the fix is an owner step (Domain-side cron or honest retirement), never a lane fork");
  if (run.summary.UNKNOWN > 0) console.log("⚪ UNKNOWN present — will re-measure next run");
  process.exit(0);
}

if (process.argv.includes("--selftest")) { selftest(); process.exit(process.exitCode || 0); }
live().catch((e) => { console.error(`[gate] fatal (fail-open): ${String(e && e.message).slice(0, 140)}`); process.exit(0); });
