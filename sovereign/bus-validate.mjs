#!/usr/bin/env node
/**
 * bus-validate.mjs — FLEET BUS health check (task 11-c, zero dependencies).
 *
 * Reads bus-registry.json, fetches every registered feed live (10s timeout),
 * and renders an honest health table:
 *   GREEN  — reachable + parses + shape sane + fresh (≤ stalenessWarningHours)
 *   AMBER  — reachable + parses, but stale (> warning hours) or shape drift
 *   RED    — producer unreachable or unparseable (hard fail → exit 1)
 *   GREY   — private-raw feed and no GH_TOKEN in env (honest unknown, skipped)
 *
 * Exit code: 0 = all public producers reachable (green-or-honestly-amber);
 *            1 = at least one public producer is RED (unreachable/dead).
 *            Private GREY never hard-fails — "unknown" must stay honest.
 *
 * Usage:
 *   node bus-validate.mjs [path/to/bus-registry.json] [--json] [--selftest]
 *   GH_TOKEN=<pat> node bus-validate.mjs        # also validates private-raw feeds
 *
 * Laws honored (see FLEET-BUS-SPEC-2026-10-11.md):
 *   - zero dependencies (stdlib fetch, node >= 18)
 *   - read-only: this tool never writes anywhere
 *   - honest: a stale feed is reported stale, never silenced
 *   - {utc-date} URL templates resolve with per-feed day offsets
 *   - secrets: GH_TOKEN is read from env, never printed, never logged
 */
"use strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const TIMEOUT_MS = 10_000;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/* ── core: validate one registry ─────────────────────────────────────── */
export async function validateRegistry(reg, opts = {}) {
  const _fetch = opts.fetchImpl || fetch;
  const now = opts.now ? opts.now.getTime() : Date.now();
  const token = opts.token || process.env.GH_TOKEN || "";
  const rows = [];

  for (const feed of reg.feeds || []) {
    const row = {
      id: feed.id, tier: feed.tier || "?", exposure: feed.exposure || "public",
      http: null, bytes: null, ageH: null, verdict: "GREY", note: "",
    };
    try {
      const urls = resolveUrls(feed);
      let res = null, lastErr = null, usedUrl = urls[0];
      for (const u of urls) {
        try {
          const headers = {};
          if (feed.exposure === "private-raw") {
            if (!token) { row.note = "private-raw · אין GH_TOKEN — דילוג כנה"; rows.push(row); res = "skip"; break; }
            headers["Authorization"] = `token ${token}`;
          }
          res = await _fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS), headers });
          usedUrl = u;
          if (res.status === 200) break; // first offset that lives wins
          lastErr = new Error(`http ${res.status}`);
        } catch (e) { lastErr = e; }
      }
      if (res === "skip") continue;
      row.http = res.status;
      const body = await res.text();
      row.bytes = body.length;
      if (res.status !== 200) {
        row.verdict = "RED";
        row.note = `בלתי-נגיש (${lastErr ? lastErr.message : res.status})`;
        rows.push(row); continue;
      }
      /* parse + shape sanity */
      let doc = null;
      const isJsonFeed = !/markdown|text\//i.test(String(feed.schema || ""));
      if (isJsonFeed) {
        try { doc = JSON.parse(body); }
        catch { row.verdict = "RED"; row.note = "גוף לא-JSON"; rows.push(row); continue; }
      }
      const shapeMiss = isJsonFeed ? shapeCheck(doc, feed) : textCheck(body, feed);
      /* freshness */
      const at = extractTs(doc, body, feed, now);
      if (at != null) row.ageH = Math.max(0, (now - at.getTime()) / 3600e3);
      const warnH = Number(feed.stalenessWarningHours || 24);
      if (shapeMiss) {
        row.verdict = "AMBER"; row.note = `סטיית-מבנה: חסר ${shapeMiss}`;
      } else if (row.ageH == null) {
        row.verdict = "AMBER"; row.note = "אין חותמת-זמן מזוהה";
      } else if (row.ageH > warnH) {
        row.verdict = "AMBER"; row.note = `ישן: ${row.ageH.toFixed(1)}h > ${warnH}h (כנה, לא מושתק)`;
      } else {
        row.verdict = "GREEN"; row.note = "חי וטרי";
      }
      if (feed.exposure === "private-raw") row.note += " · private-raw (token)";
    } catch (e) {
      row.verdict = "RED"; row.note = `חריגה: ${String(e && e.message || e).slice(0, 60)}`;
    }
    rows.push(row);
  }

  const counts = { GREEN: 0, AMBER: 0, RED: 0, GREY: 0 };
  for (const r of rows) counts[r.verdict]++;
  const hardFail = counts.RED > 0;
  return { rows, counts, hardFail, exitCode: hardFail ? 1 : 0, at: new Date(now).toISOString() };
}

/* ── helpers ─────────────────────────────────────────────────────────── */
function resolveUrls(feed) {
  const tpl = String(feed.url || "");
  const res = feed.resolve;
  if (!res || !tpl.includes(res.placeholder)) return [tpl];
  return (res.offsetsDays || [0]).map((off) => {
    const d = new Date(Date.now() - off * 86400e3);
    const p = (x) => (x < 10 ? "0" : "") + x;
    const iso = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    return tpl.split(res.placeholder).join(iso);
  });
}
function shapeCheck(doc, feed) {
  const fields = feed.shape || [];
  for (const f of fields) {
    if (f.includes("|")) {
      if (!f.split("|").some((k) => doc && doc[k] !== undefined)) return f;
    } else if (!doc || doc[f] === undefined) return f;
  }
  if (feed.schema && doc && typeof doc.schema === "string" && doc.schema !== feed.schema) {
    return `schema=${doc.schema} (ציפינו ${feed.schema})`;
  }
  return null;
}
function textCheck(body, feed) {
  if (/markdown/i.test(String(feed.schema || ""))) {
    return body.includes("## ") ? null : "אין רשומות '## '";
  }
  return null;
}
function extractTs(doc, body, feed, now) {
  const f = String(feed.freshnessField || "");
  if (doc) {
    for (const k of f.split("|").map((s) => s.trim())) {
      if (doc[k]) { const d = new Date(doc[k]); if (!isNaN(d)) return d; }
    }
    // generic fallback over common names
    for (const k of ["publishedAt", "generatedAt", "updatedAt", "at", "savedAt", "checkedAt"]) {
      if (doc[k]) { const d = new Date(doc[k]); if (!isNaN(d)) return d; }
    }
  }
  // markdown / raw-text fallback: last ISO stamp in the body
  const m = String(body).match(ISO_RE);
  if (m && m.length) { const d = new Date(m[m.length - 1]); if (!isNaN(d)) return d; }
  return null;
}

/* ── reporting ───────────────────────────────────────────────────────── */
export function renderTable(out) {
  const W = { id: 24, verdict: 6, http: 5, bytes: 8, ageH: 7 };
  const line = (s, n) => String(s).slice(0, n).padEnd(n);
  const head = `${line("feed", W.id)} ${line("מצב", W.verdict)} ${line("http", W.http)} ${line("bytes", W.bytes)} ${line("age-h", W.ageH)} הערה`;
  const rows = out.rows.map((r) =>
    `${line(r.id, W.id)} ${line(r.verdict, W.verdict)} ${line(r.http ?? "—", W.http)} ${line(r.bytes ?? "—", W.bytes)} ${line(r.ageH == null ? "—" : r.ageH.toFixed(1), W.ageH)} ${r.note}`
  );
  const sum = `סיכום: ${out.counts.GREEN} ירוק · ${out.counts.AMBER} כתום-כנה · ${out.counts.RED} אדום · ${out.counts.GREY} אפור-לא-ידוע · מדידה ${out.at} · exit=${out.exitCode}`;
  return [head, "-".repeat(head.length), ...rows, "", sum].join("\n");
}

/* ── selftest: local fixture server, fully offline ───────────────────── */
async function selftest() {
  const now = new Date("2026-10-11T20:00:00Z");
  const fixtures = {
    "/fresh.json": JSON.stringify({ schema: "t/1", generatedAt: "2026-10-11T19:00:00Z", ok: true }),
    "/stale.json": JSON.stringify({ generatedAt: "2026-10-09T20:00:00Z" }), // 48h old
    "/broken.json": "{{{ not json",
    "/shape-miss.json": JSON.stringify({ hello: 1 }),
    "/notime.json": JSON.stringify({ hello: 1, extra: 2 }),
    "/private.json": JSON.stringify({ schema: "m/1", generatedAt: "2026-10-11T18:00:00Z", verdict: "OK" }),
    "/fresh-2026-10-11.json": JSON.stringify({ generatedAt: "2026-10-11T17:00:00Z" }),
  };
  const srv = http.createServer((req, res) => {
    if (req.url === "/private.json" && req.headers["x-test-auth"] !== "yes") {
      res.writeHead(404); res.end("not found"); return;
    }
    if (fixtures[req.url]) { res.writeHead(200); res.end(fixtures[req.url]); return; }
    res.writeHead(404); res.end("not found");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const reg = {
    feeds: [
      { id: "t-fresh", url: `${base}/fresh.json`, schema: "t/1", shape: ["schema", "generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt" },
      { id: "t-stale", url: `${base}/stale.json`, shape: ["generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt" },
      { id: "t-dead", url: `${base}/missing.json`, shape: [], stalenessWarningHours: 24 },
      { id: "t-broken", url: `${base}/broken.json`, shape: [], stalenessWarningHours: 24 },
      { id: "t-shape", url: `${base}/shape-miss.json`, shape: ["schema"], stalenessWarningHours: 24 },
      { id: "t-notime", url: `${base}/notime.json`, shape: [], stalenessWarningHours: 24 },
      { id: "t-private", url: `${base}/private.json`, exposure: "private-raw", shape: ["verdict"], stalenessWarningHours: 24, freshnessField: "generatedAt" },
      { id: "t-dated", url: `${base}/fresh-{utc-date}.json`, shape: ["generatedAt"], stalenessWarningHours: 24, freshnessField: "generatedAt", resolve: { placeholder: "{utc-date}", offsetsDays: [0, 1] } },
    ],
  };
  const fakeFetch = (url, o = {}) => {
    const h = o.headers || {};
    if (h.Authorization) { /* token present → pass through as-is */ }
    return fetch(url, o);
  };
  // private feed: server 404s without the special header; our validator sends
  // an Authorization header when a token exists — simulate that handshake by
  // mapping "token" to the header the fixture server accepts.
  const out = await validateRegistry(reg, {
    now, token: "x", fetchImpl: (url, o = {}) => {
      const oo = { ...o, headers: { ...(o.headers || {}), "x-test-auth": o.headers && o.headers.Authorization ? "yes" : "no" } };
      return fakeFetch(url, oo);
    },
  });
  const want = { "t-fresh": "GREEN", "t-stale": "AMBER", "t-dead": "RED", "t-broken": "RED", "t-shape": "AMBER", "t-notime": "AMBER", "t-private": "GREEN", "t-dated": "GREEN" };
  let pass = 0, fail = 0;
  for (const r of out.rows) {
    const ok = want[r.id] === r.verdict;
    ok ? pass++ : fail++;
    console.log(`  ${ok ? "PASS" : "FAIL"} · ${r.id} → ${r.verdict} (ציפינו ${want[r.id]}) ${r.note}`);
  }
  // exit-code law
  const exitOk = out.exitCode === (out.counts.RED > 0 ? 1 : 0);
  console.log(`  ${exitOk ? "PASS" : "FAIL"} · exit-code law (RED=${out.counts.RED} → exit ${out.exitCode})`);
  exitOk ? pass++ : fail++;
  srv.close();
  console.log(`selftest: ${pass} PASS / ${fail} FAIL`);
  return fail === 0;
}

/* ── main ────────────────────────────────────────────────────────────── */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const ok = await selftest();
    process.exit(ok ? 0 : 1);
  }
  const regPath = args.find((a) => !a.startsWith("--")) || path.join(path.dirname(new URL(import.meta.url).pathname), "bus-registry.json");
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  } catch (e) {
    console.error(`לא ניתן לקרוא מרשם: ${regPath} (${e.message})`);
    process.exit(1);
  }
  const out = await validateRegistry(reg, {});
  console.log(renderTable(out));
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 1));
  process.exit(out.exitCode);
}
main().catch((e) => { console.error("bus-validate crashed:", e); process.exit(1); });
