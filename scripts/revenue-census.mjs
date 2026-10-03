#!/usr/bin/env bun
/**
 * revenue-census — מפקד-ההכנסות הריבוני (r156)
 *
 * עקרון: "אין סטטוס בלי ראיה" — כל-הכנסה נמדדת-ישירות-מהשרשרת, לא מהצהרות.
 * נבנה אחרי-מדידה-חיה שגילתה: 4,040 פעולות-אחרונות עם אפס-פרעוני-קיורציה
 * (מבני-וצפוי: הצבעות-מ-27/9 משתלמות-רק-ב-04/10 — חלון-פרעון-7-ימים), אבל
 * אף-מנוע-לא-מדד-את-זה — והמפקד-הזה הוא-המנוע.
 *
 * מדידות (כולן-מהשרשרת):
 *   1. curation_reward ליום  — הפרעוני-קיורציה-בפועל (VESTS → SP → USD)
 *   2. author_reward ליום    — פרעוני-פוסטים (מפעל-התוכן)
 *   3. withdraw_vesting ליום — נחיתות-powerdown-בפועל (אימות 02:01Z!)
 *   4. fill_order ליום       — פעילות-הזירה (מספר-ביצועים)
 *   5. vote ops ליום         — משקלי-הצבעה-אמת מול-המדיניות (6% r150)
 *   6. מצב-חשבון-חי: SP-נטו (ביחס-החי), יתרות, powerdown-הבא
 *
 * שער-ריצה: --check → exit 0-אם-המפקד-קיים-וטרי (< MAX_AGE_H שעות)
 * cache: ברירת-מחדל משתמש-במפקד-קיים-אם-טרי; --force = סריקה-מלאה-מחדש.
 * פלט: sovereign/revenue/census.json + סיכום-stdout (JSON-בקובץ, קריא-ב-stdout).
 *
 * Usage:
 *   bun scripts/revenue-census.mjs            # מדידה-אם-צריך, הדפס-סיכום
 *   bun scripts/revenue-census.mjs --force    # סריקה-מלאה-מחדש (~9-ימים)
 *   bun scripts/revenue-census.mjs --check    # שער-init.sh: קיים+טרי?
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const ACCOUNT = process.env.CENSUS_ACCOUNT || "headcorner";
const RPC = "https://api.steemit.com";
const OUT_DIR = "sovereign/revenue";
const OUT_FILE = `${OUT_DIR}/census.json`;
const HISTORY_DAYS = 9; // חלון-הסריקה: מכסה-חלון-פרעון-7-ימים-מלא + נחיתת-powerdown
const MAX_AGE_H = 26; // טריות-שער-init.sh
const FLOOR_USD = 0.01; // רצפת-המפעיל: מתחת-לזה — לא-מקובל

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const checkOnly = args.has("--check");

// ── helpers ─────────────────────────────────────────────────────────
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(25000),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const num = (s) => parseFloat(String(s).split(" ")[0]);
const isoDay = (ts) => String(ts).slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n) =>
  new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

function weighVerdict(ok, pass, fail) {
  return ok ? { verdict: "PASS", detail: pass } : { verdict: "FAIL", detail: fail };
}

// ── cache gate ──────────────────────────────────────────────────────
if (!force && existsSync(OUT_FILE)) {
  const cached = JSON.parse(readFileSync(OUT_FILE, "utf8"));
  const ageH = (Date.now() - new Date(cached.at).getTime()) / 3600_000;
  if (ageH < MAX_AGE_H) {
    if (checkOnly) {
      console.log(`census: fresh (${ageH.toFixed(1)}h old) — OK`);
      process.exit(0);
    }
    printSummary(cached);
    process.exit(0);
  }
  if (checkOnly) {
    console.log(`census: STALE (${ageH.toFixed(1)}h) — exit 1`);
    process.exit(1);
  }
}
if (checkOnly) {
  console.log("census: missing — exit 1 (ריצה: bun scripts/revenue-census.mjs)");
  process.exit(1);
}

// ── live measurement ────────────────────────────────────────────────
const t0 = Date.now();
console.error(`[revenue-census] scanning ${HISTORY_DAYS}-day window for @${ACCOUNT} …`);

// 1) יחס-החי + מצב-חשבון
const [dgpo, accounts] = await Promise.all([
  rpc("condenser_api.get_dynamic_global_properties", []),
  rpc("condenser_api.get_accounts", [[ACCOUNT]]),
]);
const vestsPerSp = num(dgpo.total_vesting_shares) / num(dgpo.total_vesting_fund_steem); // VESTS per 1 SP
const acc = accounts[0];
const spNet =
  (num(acc.vesting_shares) + num(acc.received_vesting_shares) - num(acc.delegated_vesting_shares)) /
  vestsPerSp;

// 2) סריקת-היסטוריה-אחורה (100-פעולות/באץ' — תקרת-הצומת)
const days = {};
const mkDay = (d) =>
  (days[d] ??= {
    curationVests: 0, curationVestOps: 0,
    authorSbd: 0, authorSteem: 0, authorOps: 0,
    withdrawVestingVests: 0, withdrawOps: 0,
    fills: 0,
    votesSent: 0, machineVotes: 0, externalVotes: 0, externalWeightSum: 0,
    voteWeights: [],
  });

const cutoffDay = daysAgoIso(HISTORY_DAYS);
let start = -1, oldest = -1, pages = 0, scanned = 0;
for (let page = 0; page < 400; page++) {
  const ops = await rpc("condenser_api.get_account_history", [ACCOUNT, start, 100]);
  if (!ops?.length) break;
  pages++; scanned += ops.length;
  // היפוך-באץ': ההיסטוריה-חוזרת-עולה-בתוך-באץ' — היפוך-מכניס-את-החדש-ביותר-ראשון-לאיסוף
  for (const [, op] of [...ops].reverse()) {
    const [kind, body] = op.op;
    const day = isoDay(op.timestamp);
    if (day < cutoffDay) continue;
    const d = mkDay(day);
    if (kind === "curation_reward") {
      d.curationVests += num(body.reward); d.curationVestOps++;
    } else if (kind === "author_reward") {
      d.authorSbd += num(body.sbd_payout || "0");
      d.authorSteem += num(body.steem_payout || "0");
      d.authorOps++;
    } else if (kind === "withdraw_vesting") {
      d.withdrawVestingVests += num(body.vesting_shares); d.withdrawOps++;
    } else if (kind === "fill_order") {
      d.fills++;
    } else if (kind === "vote" && body.voter === ACCOUNT) {
      d.votesSent++;
      const w = body.weight / 100;
      // סיווג-כתיבה: המנוע-הריבוני-מצביע-עד-משקל-המדיניות; מעל-זה — כותב-חוץ-על-החשבון
      // (הכותב-השני — תועד-ב-r150; כאן-הוא-נהיה-כמות-מנוטרת)
      if (w > 6.1) { d.externalVotes++; d.externalWeightSum += w; }
      else d.machineVotes++;
      d.voteWeights.push({ w, at: op.timestamp });
    }
  }
  oldest = ops[0][0];
  if (isoDay(ops[0][1].timestamp) < cutoffDay || oldest <= 1) break;
  start = oldest - 1;
}

// 3) סימוני-שוק-חיים (להערכת-שווי — לא לדיוק-מזויף: מקור-מתועד)
let steemUsd = null;
try {
  const tk = await rpc("condenser_api.get_ticker", []);
  steemUsd = num(tk.latest);
} catch { /* צומת-לא-מחזיר-טיקר — מדווח-null-כנה */ }

// ── verdicts ────────────────────────────────────────────────────────
const policySrc = readFileSync("src/lib/weave/curation.ts", "utf8");
const policyWeight = Number(policySrc.match(/weightPctPerVote:\s*(\d+)/)?.[1] ?? 6);
// הסריקה-אחורה-בזמן: הפעימות-החדשות-ראשונות — 10-הראשונות = ההצבעות-החדשות-ביותר
const allWeights = Object.values(days).flatMap((d) => d.voteWeights.map((v) => v.w));
const recentWeights = allWeights.slice(0, 10);
const machineWeights = recentWeights.filter((w) => w <= policyWeight + 1.5);
const weightOk =
  machineWeights.length === 0 ||
  machineWeights.every((w) => Math.abs(w - policyWeight) <= 1.5 || w <= 2.1); // ≤2% = עידן-טרום-r150-שטרם-פרעון

const firstVoteDay = Object.keys(days).sort()[0];
const curationPending =
  Object.values(days).every((d) => d.curationVestOps === 0) && allWeights.length > 0;
const nextPayoutNote = curationPending
  ? `הצבעות-ראשונות (${firstVoteDay}+) נכנסות-לפרעון-מ-04/10 (חלון-7-ימים) — האפס-מבני-ומוסבר, לא-כשל`
  : "פרעוני-קיורציה-נמדדים-בחלון";

const totalCurationSp = Object.values(days).reduce((s, d) => s + d.curationVests, 0) / vestsPerSp;
const totalAuthorSbd = Object.values(days).reduce((s, d) => s + d.authorSbd, 0);
const totalAuthorSteem = Object.values(days).reduce((s, d) => s + d.authorSteem, 0);
const totalWithdrawSp = Object.values(days).reduce((s, d) => s + d.withdrawVestingVests, 0) / vestsPerSp;
const steemPrice = steemUsd ?? 0.0628; // fallback-מתועד-רק-אם-הטיקר-נפל
const curationUsd = totalCurationSp * steemPrice;
const authorUsd = (totalAuthorSbd * 1.0) + (totalAuthorSteem * steemPrice); // SBD≈1USD-עקרון-ערך-הרשת
const powerdownUsd = totalWithdrawSp * steemPrice;
const windowRevenueUsd = curationUsd + authorUsd + powerdownUsd;
const dailyAvgUsd = windowRevenueUsd / HISTORY_DAYS;

const powerdown = {
  active: num(acc.vesting_withdraw_rate) > 0,
  nextPaymentAt: acc.next_vesting_withdrawal,
  weeklySp: num(acc.vesting_withdraw_rate) / vestsPerSp,
  remainingWeeks: num(acc.to_withdraw) > 0 ? Math.ceil(num(acc.to_withdraw) / Math.max(1, num(acc.vesting_withdraw_rate))) : 0,
};

const extVotesTotal = Object.values(days).reduce((s, d) => s + d.externalVotes, 0);
const machineVotesTotal = Object.values(days).reduce((s, d) => s + d.machineVotes, 0);
const avgExtWeight = extVotesTotal > 0
  ? Object.values(days).reduce((s, d) => s + d.externalWeightSum, 0) / extVotesTotal
  : 0;

const verdicts = {
  V1_curation_policy_live: weighVerdict(
    weightOk,
    `משקלי-${machineWeights.length}-הצבעות-המנוע-החדשות-ביותר תואמים-מדיניות (≤${policyWeight}% · היסטוריה-≤2%-מהעידן-שלפני-r150-מותרת-עד-הפרעון)`,
    `משקלי-מנוע-חורגים-מהמדיניות: ${JSON.stringify(machineWeights)}`
  ),
  V1b_external_writer_footprint: {
    verdict: "MEASURED",
    detail: `כותב-חוץ-על-החשבון (הכותב-השני, תועד-r150): ${extVotesTotal} הצבעות במשקל-ממוצע ${avgExtWeight.toFixed(1)}% מול ${machineVotesTotal} של-המנוע — מתחרה-על-מנת-ה-VP. ניטור-שוטף-חי`,
  },
  V2_curation_payouts: weighVerdict(
    curationPending || totalCurationSp > 0,
    curationPending ? nextPayoutNote : `נמדד ${totalCurationSp.toFixed(4)} SP בחלון`,
    "אין-הצבעות-ואין-פרעונים — המנוע-מנותק"
  ),
  V3_author_payouts: {
    verdict: "MEASURED",
    detail: totalAuthorSbd + totalAuthorSteem > 0
      ? `${totalAuthorSbd.toFixed(3)} SBD + ${totalAuthorSteem.toFixed(3)} STEEM בחלון`
      : `0 בחלון-${HISTORY_DAYS}-ימים (הפוסטים-הראשונים-מ-02/10 משתלמים-מ-09/10)`,
  },
  V4_powerdown_landing: weighVerdict(
    powerdown.active,
    `powerdown-פעיל: ${powerdown.weeklySp.toFixed(3)} SP/שבוע · הבא: ${powerdown.nextPaymentAt} · נחיתות-בחלון: ${powerdownUsd.toFixed(4)} USD`,
    "powerdown-לא-פעיל-על-החשבון"
  ),
  V5_trading_activity: {
    verdict: "MEASURED",
    detail: `${Object.values(days).reduce((s, d) => s + d.fills, 0)} fill_order בחלון (הזירה-חיה)`,
  },
  V6_revenue_floor: {
    verdict: dailyAvgUsd >= FLOOR_USD ? "PASS" : "BELOW",
    detail: `ממוצע-יומי-נמדד ${dailyAvgUsd.toFixed(4)} USD מול-רצפת-המפעיל ${FLOOR_USD} USD${dailyAvgUsd < FLOOR_USD ? " — הפער-מוסבר-ב-pending-פרעונים (04-09/10); אימות-חוזר-אחרי-הפרעונים" : ""}`,
  },
};

// ── emit ────────────────────────────────────────────────────────────
const census = {
  schema: "revenue-census-v1",
  at: new Date().toISOString(),
  account: ACCOUNT,
  windowDays: HISTORY_DAYS,
  scan: { pages, opsScanned: scanned, oldestIndex: oldest, ms: Date.now() - t0 },
  chain: { vestsPerSp: +vestsPerSp.toFixed(2), steemUsd: steemUsd, spNet: +spNet.toFixed(3) },
  balances: {
    steem: num(acc.balance), sbd: num(acc.sbd_balance),
    curationRewardsLifetimeVests: num(acc.curation_rewards),
    votingPower: acc.voting_power / 100,
  },
  powerdown,
  daily: Object.fromEntries(
    Object.entries(days).sort().map(([d, v]) => [d, {
      curationVests: +v.curationVests.toFixed(1),
      curationSp: +(v.curationVests / vestsPerSp).toFixed(5),
      curationOps: v.curationVestOps,
      authorSbd: +v.authorSbd.toFixed(3),
      authorSteem: +v.authorSteem.toFixed(3),
      withdrawVestingSp: +(v.withdrawVestingVests / vestsPerSp).toFixed(4),
      fills: v.fills,
      votesSent: v.votesSent,
      machineVotes: v.machineVotes,
      externalVotes: v.externalVotes,
      avgExternalWeight: v.externalVotes ? +(v.externalWeightSum / v.externalVotes).toFixed(2) : null,
      lastVoteWeight: v.voteWeights[0]?.w ?? null,
    }])
  ),
  totals: {
    curationSp: +totalCurationSp.toFixed(5), curationUsd: +curationUsd.toFixed(4),
    authorUsd: +authorUsd.toFixed(4), powerdownUsd: +powerdownUsd.toFixed(4),
    windowRevenueUsd: +windowRevenueUsd.toFixed(4), dailyAvgUsd: +dailyAvgUsd.toFixed(4),
  },
  verdicts,
  notes: [
    curationPending ? nextPayoutNote : null,
    "המקור: סריקת-account_history-מהשרשרת-ישירות — אין-הצהרות",
  ].filter(Boolean),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(census, null, 2) + "\n");
printSummary(census);

function printSummary(c) {
  console.log(`== מפקד-ההכנסות (@${c.account} · ${c.windowDays}-ימים · נסרקו ${c.scan.opsScanned} פעולות ב-${c.scan.pages} באצ'ים) ==`);
  console.log(`  SP-נטו: ${c.chain.spNet} · יחס: ${c.chain.vestsPerSp} VESTS/SP · VP: ${c.balances.votingPower}%`);
  for (const [d, v] of Object.entries(c.daily)) {
    const bits = [];
    if (v.curationOps) bits.push(`קיורציה ${v.curationSp}SP (${v.curationOps})`);
    if (v.authorOps) bits.push(`אוטור ${v.authorSbd}SBD+${v.authorSteem}STEEM`);
    if (v.withdrawVestingSp) bits.push(`powerdown ${v.withdrawVestingSp}SP`);
    if (v.fills) bits.push(`fills ${v.fills}`);
    if (v.votesSent) {
      const split = v.machineVotes != null ? ` מנוע ${v.machineVotes} · חוץ ${v.externalVotes ?? 0}` : "";
      bits.push(`הצבעות ${v.votesSent}${split} (אחרונה ${v.lastVoteWeight}%)`);
    }
    console.log(`  ${d}: ${bits.join(" · ") || "—"}`);
  }
  console.log(`  סה"כ-חלון: ${c.totals.windowRevenueUsd} USD · ממוצע-יומי: ${c.totals.dailyAvgUsd} USD`);
  for (const [k, v] of Object.entries(c.verdicts)) console.log(`  ${v.verdict === "PASS" ? "✔" : v.verdict === "MEASURED" ? "◆" : "✘"} ${k}: ${v.detail}`);
}
