/**
 * competition-beat.mjs — פעימת-תחרות-סוכנים ריבונית
 * מודד רווחים on-chain אמיתיים לכל חייל-סוכן (STEEM + HIVE), מחשב ניקוד,
 * מעדכן לוח-הובלה (state.json) ומצרף scores.jsonl. אפס-מפתחות, קריאה-בלבד.
 *
 * Usage: bun scripts/competition-beat.mjs [--dry]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const STATE_DIR = process.env.COMP_STATE_DIR || (await import("node:path")).default.resolve(process.cwd(), "sovereign", "competition");
const REGISTRY = `${STATE_DIR}/registry.json`;
const STATE = `${STATE_DIR}/state.json`;
const SCORES = `${STATE_DIR}/scores.jsonl`;
const LEDGER = `${STATE_DIR}/rewards-ledger.jsonl`;

const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {
  version: 1, beats: 0, epoch: null, prices: {}, vestRatio: {}, snapshot: {}, leaderboard: [], history: [], lastBeat: null,
};

const now = new Date();
const epoch = now.toISOString().slice(0, 10);
const W = state.epoch !== epoch ? 1 : 0; // rollover flag

// ── helpers ──────────────────────────────────────────────────────────
async function rpc(base, method, params) {
  const res = await fetch(base, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error).slice(0, 120));
  return j.result;
}
const num = (s) => parseFloat(String(s ?? "0"));

async function getPrices() {
  const cached = { steem: state.prices?.steem ?? 0.14, hive: state.prices?.hive ?? 0.18, at: now.toISOString() };
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem,hive&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j?.steem?.usd) cached.steem = j.steem.usd;
    if (j?.hive?.usd) cached.hive = j.hive.usd;
    cached.live = true;
  } catch { cached.live = false; }
  return cached;
}

async function getVestRatio() {
  const out = {};
  for (const [chain, base] of [["steem", "https://api.steemit.com"], ["hive", "https://api.hive.blog"]]) {
    try {
      const g = await rpc(base, "condenser_api.get_dynamic_global_property", []);
      out[chain] = num(g.total_vesting_fund_steem) / num(g.total_vesting_shares);
    } catch { out[chain] = state.vestRatio?.[chain] ?? 0.0005; }
  }
  return out;
}

const HISTORY_FILTER = new Set(["author_reward", "curation_reward", "comment", "vote", "claim_reward_balance"]);
async function scanHistory(base, account) {
  const acc = { author: 0, curation: 0, posts: 0, votes: 0, claims: 0, ok: false };
  try {
    const hist = await rpc(base, "condenser_api.get_account_history", [account, -1, 100]);
    for (const [, entry] of hist) {
      const [type, val] = entry.op || [];
      if (!HISTORY_FILTER.has(type)) continue;
      acc.ok = true;
      if (type === "author_reward") acc.author++;
      else if (type === "curation_reward") acc.curation++;
      else if (type === "comment") { if (!val?.parent_author) acc.posts++; else acc.posts++; }
      else if (type === "vote") acc.votes++;
      else if (type === "claim_reward_balance") acc.claims++;
    }
  } catch { /* honest degradation — rewards-only this beat */ }
  return acc;
}

// ── measure ──────────────────────────────────────────────────────────
const prices = await getPrices();
const vestRatio = await getVestRatio();
const rows = [];

for (const member of registry.roster) {
  if (member.active === false) { rows.push({ account: member.account, agent: member.agent, active: false }); continue; }
  const row = { account: member.account, agent: member.agent, active: true, chains: {} };
  for (const chain of member.chains) {
    const base = chain === "steem" ? "https://api.steemit.com" : "https://api.hive.blog";
    try {
      const [a] = await rpc(base, "condenser_api.get_accounts", [[member.account]]);
      if (!a) { row.chains[chain] = { ok: false, reason: "no-account" }; continue; }
      const pend = {
        token: num(chain === "steem" ? a.reward_steem_balance : a.reward_hive_balance),
        debt: num(a.reward_sbd_balance ?? a.reward_hbd_balance),
        vest: num(a.reward_vesting_balance),
      };
      const hist = await scanHistory(base, member.account);
      const key = `${chain}:${member.account}`;
      const prev = state.snapshot?.[key] ?? {};
      const pendUsdNow = pend.token * prices[chain] + pend.debt * (chain === "steem" ? prices.steem : prices.hive) * 1.0 + pend.vest * vestRatio[chain] * prices[chain];
      const prevUsd = prev.pendUsd ?? pendUsdNow;
      const usdEarnedDelta = Math.max(0, prevUsd - pendUsdNow) + Math.max(0, pendUsdNow - prevUsd) * 0; // claimed rewards shrink pending → counted as earned
      const vestDelta = Math.max(0, num(a.vesting_shares) - (prev.vesting ?? num(a.vesting_shares)));
      row.chains[chain] = {
        ok: true,
        hp: +(num(a.vesting_shares) * vestRatio[chain]).toFixed(3),
        pendingUsd: +pendUsdNow.toFixed(4),
        earnedUsdDelta: +(Math.max(0, prevUsd - pendUsdNow)).toFixed(4), // pending dropped = claimed into wallet
        vestDelta: +vestDelta.toFixed(3),
        history: hist,
      };
      state.snapshot[key] = { pendUsd: pendUsdNow, vesting: num(a.vesting_shares), at: now.toISOString() };
    } catch (e) {
      row.chains[chain] = { ok: false, reason: String(e.message).slice(0, 80) };
    }
  }
  // points
  let points = 0;
  const s = row.chains.steem, h = row.chains.hive;
  for (const c of [s, h]) {
    if (!c?.ok) continue;
    points += c.earnedUsdDelta * 100;
    points += (c.history.author || 0) * 10 + (c.history.curation || 0) * 5 + (c.history.posts || 0) * 10 + (c.history.votes || 0) * 1;
  }
  row.points = +points.toFixed(2);
  rows.push(row);
}

// ── leaderboard ──────────────────────────────────────────────────────
const board = rows.filter((r) => r.active).map((r) => ({
  account: r.account, agent: r.agent, points: r.points,
  steem: r.chains.steem ? { hp: r.chains.steem.hp, earned: r.chains.steem.earnedUsdDelta, pend: r.chains.steem.pendingUsd, hist: r.chains.steem.history } : null,
  hive: r.chains.hive ? { hp: r.chains.hive.hp, earned: r.chains.hive.earnedUsdDelta, pend: r.chains.hive.pendingUsd, hist: r.chains.hive.history } : null,
})).sort((x, y) => y.points - x.points);
board.forEach((b, i) => (b.rank = i + 1));

// epoch rollover → archive
if (W && state.epoch && state.leaderboard.length) {
  state.history.push({ epoch: state.epoch, top3: state.leaderboard.slice(0, 3).map((b) => ({ account: b.account, agent: b.agent, points: b.points })) });
  if (state.history.length > 90) state.history = state.history.slice(-90);
  // FIX(task-13-audit): dayPoints הוא אובייקט {account: {...}} — לא מערך;
  // for..of-על-אובייקט קורס (נמדד: סבב-חצות 00:17 FAIL) — Object.values.
  for (const b of Object.values(state.dayPoints ?? {})) b.pointsCarried = 0;
}
// accumulate day points
state.dayPoints = state.dayPoints ?? {};
for (const b of board) {
  const d = (state.dayPoints[b.account] ??= { epoch, points: 0 });
  if (d.epoch !== epoch) { d.epoch = epoch; d.points = 0; }
  d.points = +(d.points + b.points).toFixed(2);
}

state.epoch = epoch;
state.prices = { steem: prices.steem, hive: prices.hive, at: prices.at, live: !!prices.live };
state.vestRatio = vestRatio;
state.leaderboard = board;
state.beats = (state.beats ?? 0) + 1;
state.lastBeat = now.toISOString();

// weekly stipend allocation (Sunday 00Z beat) — LEDGER ONLY, payout GATED
if (now.getUTCDay() === 0 && now.getUTCHours() === 0 && state.beats > 1 && board.length >= 3) {
  const pool = 1.0; // USD-equivalent pool v1 (sovereign stipend, tiny by design)
  const alloc = board.slice(0, 3).map((b, i) => ({ rank: i + 1, account: b.account, agent: b.agent, usd: +(pool * [0.5, 0.3, 0.2][i]).toFixed(3), status: "GATED-until-operator" }));
  appendFileSync(LEDGER, JSON.stringify({ at: now.toISOString(), kind: "weekly-stipend", poolUsd: pool, alloc }) + "\n");
}

appendFileSync(SCORES, JSON.stringify({ at: now.toISOString(), epoch, beat: state.beats, prices: { steem: prices.steem, hive: prices.hive }, top3: board.slice(0, 3).map((b) => ({ rank: b.rank, account: b.account, points: b.points })), allPoints: board.map((b) => ({ account: b.account, points: b.points })) }) + "\n");

if (!process.argv.includes("--dry")) {
  writeFileSync(STATE, JSON.stringify(state, null, 1));
}

// console table
console.log("=== COMPETITION BEAT #" + state.beats + " · epoch " + epoch + " · steem $" + prices.steem + " · hive $" + prices.hive + (prices.live ? "" : " (cached)") + " ===");
for (const b of board) {
  const day = state.dayPoints[b.account]?.points ?? 0;
  console.log(
    String(b.rank).padStart(2), b.account.padEnd(13), b.agent.padEnd(14),
    "pts:" + String(b.points).padStart(7), "day:" + String(day).padStart(8),
    "SHP:" + String(b.steem?.hp ?? "—").padStart(9), "HHP:" + String(b.hive?.hp ?? "—").padStart(8),
    "earnS:" + (b.steem?.earned ?? 0), "earnH:" + (b.hive?.earned ?? 0),
    b.steem?.history?.ok ? "h✓" : "", b.hive?.history?.ok ? "h✓" : ""
  );
}
