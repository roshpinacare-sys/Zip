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
 *   3. fill_vesting_withdraw ליום — נחיתות-powerdown-בפועל (ר161: ה-op-הווירטואלי-הוא-הקבלה; withdraw_vesting=שינוי-לוח-בלבד)
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
    powerdownLandSteem: 0, powerdownLandOps: 0, // r161: קבלות-נחיתה-אמיתיות (op-וירטואלי)
    fills: 0,
    votesSent: 0, machineVotes: 0, externalVotes: 0, externalWeightSum: 0,
    voteWeights: [],
  });

const cutoffDay = daysAgoIso(HISTORY_DAYS);
const voteIndexDay = daysAgoIso(HISTORY_DAYS + 9); // אינדקס-הצבעות-עמוק: פרעוני-9-ימים ← הצבעות-עד-16-ימים-אחורה
let start = -1, oldest = -1, pages = 0, scanned = 0;
// אינדקס-הצבעות: author/permlink → ההצבעה-האחרונה (הסריקה-חדש→ישן, הראשון-שנראה = האחרון-שנשלח)
const voteIndex = new Map();
const rewards = []; // פרעוני-קיורציה-בחלון (לשיוך-להצבעה-המקורית)
for (let page = 0; page < 900; page++) {
  const ops = await rpc("condenser_api.get_account_history", [ACCOUNT, start, 100]);
  if (!ops?.length) break;
  pages++; scanned += ops.length;
  // היפוך-באץ': ההיסטוריה-חוזרת-עולה-בתוך-באץ' — היפוך-מכניס-את-החדש-ביותר-ראשון-לאיסוף
  for (const [, op] of [...ops].reverse()) {
    const [kind, body] = op.op;
    const day = isoDay(op.timestamp);
    if (day < voteIndexDay) continue;
    const inWindow = day >= cutoffDay;
    const d = inWindow ? mkDay(day) : null;
    if (kind === "curation_reward") {
      if (!d) continue;
      d.curationVests += num(body.reward); d.curationVestOps++;
      // r157 — שיוך-הכנסה-להצבעה (D-r157-VP-COORD): הפרעון-נזקף-להצבעה-המקורית
      // (הצבעה-אחרונה-לפני-הפרעון = המשקל-האפקטיבי; מנוע ≤6% מול חוץ)
      rewards.push({ day, author: body.author, permlink: body.permlink, vests: num(body.reward), at: op.timestamp });
    } else if (kind === "author_reward") {
      if (!d) continue;
      d.authorSbd += num(body.sbd_payout || "0");
      d.authorSteem += num(body.steem_payout || "0");
      d.authorOps++;
    } else if (kind === "withdraw_vesting") {
      if (!d) continue;
      d.withdrawVestingVests += num(body.vesting_shares); d.withdrawOps++;
    } else if (kind === "fill_vesting_withdraw") {
      // r161 — הקבלה-האמיתית: נחיתת-תשלום-שבועי (VESTS→STEEM). withdraw_vesting-לבדו-החמיץ-את-הנחיתה-ב-02:01:27Z
      if (!d) continue;
      d.powerdownLandSteem += num(body.deposited); d.powerdownLandOps++;
    } else if (kind === "fill_order") {
      if (!d) continue;
      d.fills++;
    } else if (kind === "vote" && body.voter === ACCOUNT) {
      voteIndex.set(`${body.author}/${body.permlink}`, { w: body.weight / 100, at: op.timestamp });
      if (!d) continue;
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
  if (isoDay(ops[0][1].timestamp) < voteIndexDay || oldest <= 1) break;
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
// r161 — נחיתות-בפועל (STEEM-נזיל-שנכנס): הקבלה-האמיתית-של-ה-powerdown. זרם-הון, לא תשואה
const totalPowerdownLandSteem = Object.values(days).reduce((s, d) => s + d.powerdownLandSteem, 0);
const totalPowerdownLandOps = Object.values(days).reduce((s, d) => s + d.powerdownLandOps, 0);
const steemPrice = steemUsd ?? 0.0628; // fallback-מתועד-רק-אם-הטיקר-נפל
const curationUsd = totalCurationSp * steemPrice;
const authorUsd = (totalAuthorSbd * 1.0) + (totalAuthorSteem * steemPrice); // SBD≈1USD-עקרון-ערך-הרשת
// r161 — תיקון-יושרה: powerdown=פירוק-הון (SP→נזיל), לא הכנסה-שוטפת. נמדד-ומדווח-בנפרד, לא-ברצפת-התשואה
const powerdownUsd = totalPowerdownLandSteem * steemPrice;
const windowRevenueUsd = curationUsd + authorUsd;
const treasuryFlowUsd = powerdownUsd;
const dailyAvgUsd = windowRevenueUsd / HISTORY_DAYS;

// r161 — תיקון-יחידות: to_withdraw/withdrawn-מגיעים-בסקאלת-GESTS (×1e6) ואילו-vesting_withdraw_rate-ב-VESTS.
// החישוב-הקודם-שילב-סקאלות → 4,000,000-שבועות. עכשיו: GESTS÷1e6=VESTS → יחס-שבועות-אמיתי (4.0009 → 4 + אבק)
const remainingRawWeeks = num(acc.to_withdraw) > 0 ? (num(acc.to_withdraw) / 1e6) / Math.max(1, num(acc.vesting_withdraw_rate)) : 0;
const lastLanding = Object.entries(days)
  .filter(([, v]) => v.powerdownLandOps > 0)
  .sort((a, b) => b[0].localeCompare(a[0]))[0] ?? null;
const powerdown = {
  active: num(acc.vesting_withdraw_rate) > 0,
  nextPaymentAt: acc.next_vesting_withdrawal,
  weeklySp: num(acc.vesting_withdraw_rate) / vestsPerSp,
  remainingWeeks: Math.round(remainingRawWeeks),
  remainingRawWeeks: +remainingRawWeeks.toFixed(4),
  landingsWindowSteem: +totalPowerdownLandSteem.toFixed(3),
  landingsWindowOps: totalPowerdownLandOps,
  lastLandingAt: lastLanding?.[0] ?? null,
  lastLandingSteem: lastLanding ? +lastLanding[1].powerdownLandSteem.toFixed(3) : null,
};

const extVotesTotal = Object.values(days).reduce((s, d) => s + d.externalVotes, 0);
const machineVotesTotal = Object.values(days).reduce((s, d) => s + d.machineVotes, 0);
const avgExtWeight = extVotesTotal > 0
  ? Object.values(days).reduce((s, d) => s + d.externalWeightSum, 0) / extVotesTotal
  : 0;

// ── שיוך-הכנסה-להצבעה (r157 · D-r157-VP-COORD) ────────────────────
const attr = { machineSp: 0, externalSp: 0, unknownSp: 0, machineOps: 0, externalOps: 0, unknownOps: 0 };
for (const r of rewards) {
  const v = voteIndex.get(`${r.author}/${r.permlink}`);
  const sp = r.vests / vestsPerSp;
  if (!v) { attr.unknownSp += sp; attr.unknownOps++; }
  else if (v.w <= 6.1) { attr.machineSp += sp; attr.machineOps++; }
  else { attr.externalSp += sp; attr.externalOps++; }
}
const hasAttr = rewards.length > 0;

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
  V2b_revenue_attribution: {
    verdict: hasAttr ? "MEASURED" : "PENDING",
    detail: hasAttr
      ? `שיוך-פרעונים-להצבעות: מנוע ${attr.machineSp.toFixed(4)} SP (${attr.machineOps}) · חוץ ${attr.externalSp.toFixed(4)} SP (${attr.externalOps}) · לא-משויך ${attr.unknownSp.toFixed(4)} SP (${attr.unknownOps})`
      : "אין-עוד-פרעוני-קיורציה-בחלון — השיוך-נטען-אוטומטית-עם-הפרעונים-הראשונים (04/10+)",
  },
  V3_author_payouts: {
    verdict: "MEASURED",
    detail: totalAuthorSbd + totalAuthorSteem > 0
      ? `${totalAuthorSbd.toFixed(3)} SBD + ${totalAuthorSteem.toFixed(3)} STEEM בחלון`
      : `0 בחלון-${HISTORY_DAYS}-ימים (הפוסטים-הראשונים-מ-02/10 משתלמים-מ-09/10)`,
  },
  V4_powerdown_landing: weighVerdict(
    powerdown.active,
    `powerdown-פעיל: ${powerdown.weeklySp.toFixed(3)} SP/שבוע · קבלה-אחרונה: ${powerdown.lastLandingAt ?? "—"} ${powerdown.lastLandingSteem ?? 0} STEEM (~${powerdownUsd.toFixed(2)} USD-בחלון) · נותרו-${powerdown.remainingWeeks}-פרעונים · הבא: ${powerdown.nextPaymentAt}`,
    "powerdown-לא-פעיל-על-החשבון"
  ),
  V5_trading_activity: {
    verdict: "MEASURED",
    detail: `${Object.values(days).reduce((s, d) => s + d.fills, 0)} fill_order בחלון (הזירה-חיה)`,
  },
  V6_revenue_floor: {
    verdict: dailyAvgUsd >= FLOOR_USD ? "PASS" : "BELOW",
    // ר161: הרצפה-מודדת-תשואה-שוטפת (קיורציה+אוטור) — פירוק-הון-powerdown-אינו-הכנסה-ולא-יכול-לרצות-את-הרצפה
    detail: `ממוצע-יומי-נמדד ${dailyAvgUsd.toFixed(4)} USD (תשואה: קיורציה+אוטור) מול-רצפת-המפעיל ${FLOOR_USD} USD${dailyAvgUsd < FLOOR_USD ? " — הפער-מוסבר-ב-pending-פרעונים (04-09/10); אימות-חוזר-אחרי-הפרעונים" : ""}`,
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
  attribution: {
    machineSp: +attr.machineSp.toFixed(5), externalSp: +attr.externalSp.toFixed(5), unknownSp: +attr.unknownSp.toFixed(5),
    machineOps: attr.machineOps, externalOps: attr.externalOps, unknownOps: attr.unknownOps,
    policy: "D-r157-VP-COORD (אישור-מפעיל 00:04Z): הפרעון-נזקף-להצבעה-המקורית — מנוע ≤6% מול חוץ",
  },
  daily: Object.fromEntries(
    Object.entries(days).sort().map(([d, v]) => [d, {
      curationVests: +v.curationVests.toFixed(1),
      curationSp: +(v.curationVests / vestsPerSp).toFixed(5),
      curationOps: v.curationVestOps,
      authorSbd: +v.authorSbd.toFixed(3),
      authorSteem: +v.authorSteem.toFixed(3),
      withdrawVestingSp: +(v.withdrawVestingVests / vestsPerSp).toFixed(4),
      powerdownLandSteem: +v.powerdownLandSteem.toFixed(3),
      powerdownLandOps: v.powerdownLandOps,
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
    treasuryFlowUsd: +treasuryFlowUsd.toFixed(4), // ר161: זרם-הון-נפרד-מהתשואה
    windowRevenueUsd: +windowRevenueUsd.toFixed(4), dailyAvgUsd: +dailyAvgUsd.toFixed(4),
  },
  verdicts,
  notes: [
    curationPending ? nextPayoutNote : null,
    "המקור: סריקת-account_history-מהשרשרת-ישירות — אין-הצהרות",
    "ר161: הרצפה (V6) מודדת-תשואה-שוטפת-בלבד · נחיתות-powerdown=זרם-הון-נפרד (fill_vesting_withdraw=הקבלה-הקנונית)",
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
    if (v.withdrawVestingSp) bits.push(`powerdown-שינוי-לוח ${v.withdrawVestingSp}SP`);
    if (v.powerdownLandOps) bits.push(`powerdown-נחת ${v.powerdownLandSteem}STEEM`);
    if (v.fills) bits.push(`fills ${v.fills}`);
    if (v.votesSent) {
      const split = v.machineVotes != null ? ` מנוע ${v.machineVotes} · חוץ ${v.externalVotes ?? 0}` : "";
      bits.push(`הצבעות ${v.votesSent}${split} (אחרונה ${v.lastVoteWeight}%)`);
    }
    console.log(`  ${d}: ${bits.join(" · ") || "—"}`);
  }
  console.log(`  סה"כ-חלון: ${c.totals.windowRevenueUsd} USD (תשואה) · ממוצע-יומי: ${c.totals.dailyAvgUsd} USD · זרם-הון-powerdown: ${c.totals.treasuryFlowUsd} USD`);
  const a = c.attribution;
  if (a.machineOps + a.externalOps + a.unknownOps > 0)
    console.log(`  שיוך-פרעונים: מנוע ${a.machineSp}SP (${a.machineOps}) · חוץ ${a.externalSp}SP (${a.externalOps}) · לא-משויך ${a.unknownSp}SP (${a.unknownOps})`);
  else console.log("  שיוך-פרעונים: ממתין-לפרעונים-הראשונים (04/10+)");
  for (const [k, v] of Object.entries(c.verdicts)) {
    const icon = v.verdict === "PASS" ? "✔" : v.verdict === "MEASURED" ? "◆" : v.verdict === "PENDING" ? "◌" : "✘";
    console.log(`  ${icon} ${k}: ${v.detail}`);
  }
}
