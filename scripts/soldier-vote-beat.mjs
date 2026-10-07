/**
 * soldier-vote-beat.mjs — מנוע-ההצבעה של החיילים (אוצרה-ריבונית חיה)
 * כל חייל מצביע (posting-authority חיה, נמדד 4/4) על תוכן-טרי של הצי —
 * cross-vote פנימי: אף-הצבעה-עצמית, אף-כפילות, תקציב-יומי מחושב-מהמצב,
 * fail-closed לכל-הצבעה. הרווחים זורמים on-chain → התחרות מודדת אותם.
 *
 * Usage: bun scripts/soldier-vote-beat.mjs [--chain steem|hive|both] [--max N]
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import * as steem from "/home/z/my-project/zip/node_modules/steem/lib/index.js";

const STATE_DIR = path.resolve(process.cwd(), "sovereign", "competition");
const VOTE_STATE = `${STATE_DIR}/soldier-votes-state.json`;
const VOTE_LOG = `${STATE_DIR}/soldier-votes.jsonl`;
// כספת-החיילים — נשלפת מהיסטוריית-הגיט בשחזור (docs: zip/bootstrap/README.md)
const VAULT = process.env.SAOS_SOLDIER_VAULT || "/home/z/fleet-tmp/nvx-vault-extracted.json";

const CAP_PER_CHAIN_PER_DAY = Number(process.env.VOTE_CAP ?? 4);
const WEIGHT = 5000; // 50%
const MAX_AGE_DAYS = 6;

const chainArgIdx = process.argv.indexOf("--chain");
const chainArg = chainArgIdx > -1 ? process.argv[chainArgIdx + 1] : null;
const CHAINS = chainArg === "hive" ? ["hive"] : chainArg === "steem" ? ["steem"] : process.argv.includes("--hive") ? ["hive"] : process.argv.includes("--steem") ? ["steem"] : ["steem", "hive"];
const MAX_PER_RUN = Number(process.argv.includes("--max") ? process.argv[process.argv.indexOf("--max") + 1] : 1);

const vault = JSON.parse(readFileSync(VAULT, "utf8"));
const state = existsSync(VOTE_STATE) ? JSON.parse(readFileSync(VOTE_STATE, "utf8")) : { version: 1, epoch: null, perAccount: {} };
const epoch = new Date().toISOString().slice(0, 10);
if (state.epoch !== epoch) { state.epoch = epoch; state.perAccount = {}; }

const fleetNames = vault.accounts.map((a) => a.username);

function rpcFor(chain) {
  return chain === "steem" ? "https://api.steemit.com" : "https://api.hive.blog";
}
async function rpc(chain, method, params) {
  const res = await fetch(rpcFor(chain), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 140));
  return j.result;
}
function wifFor(account, chain) {
  const acc = vault.accounts.find((a) => a.username === account);
  if (!acc) return null;
  if (chain === "steem") return acc.keys?.steem?.posting?.wif ?? acc.keys?.posting?.wif ?? null;
  return acc.keys?.hive?.posting?.wif ?? acc.keys?.posting?.wif ?? null;
}

async function broadcastVote(chain, voter, wif, author, permlink) {
  if (chain === "steem") {
    return new Promise((resolve, reject) => {
      steem.broadcast.vote(wif, voter, author, permlink, WEIGHT, (err, res) =>
        err ? reject(new Error(String(err).slice(0, 160))) : resolve(res));
    });
  }
  // HIVE — אותו-פרוטוקול חתימה אך chain-id שונה; מנותב לצומת-HIVE עם chain-id מוצב
  const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";
  const oldUrl = steem.api.options?.url;
  const oldChainId = steem.config.get("chain_id");
  steem.api.setOptions({ url: rpcFor(chain), useAppbase: true });
  steem.config.set("chain_id", HIVE_CHAIN_ID);
  try {
    return await new Promise((resolve, reject) => {
      steem.broadcast.vote(wif, voter, author, permlink, WEIGHT, (err, res) =>
        err ? reject(new Error(String(err).slice(0, 160))) : resolve(res));
    });
  } finally {
    if (oldUrl) steem.api.setOptions({ url: oldUrl });
    if (oldChainId !== undefined) steem.config.set("chain_id", oldChainId);
  }
}

function logVote(entry) {
  appendFileSync(VOTE_LOG, JSON.stringify(entry) + "\n");
}

const DEBUG = process.env.VOTE_DEBUG === "1";
const dbg = (m) => { if (DEBUG) console.log("[dbg]", m); };

let totalCast = 0;
for (const chain of CHAINS) {
  let cast = 0; // תקציב-פר-שרשרת (לא גלובלי) — HIVE לא ימצא עצמו ריק אחרי STEEM
  // רוטציה-שעתית של סדר-המצביעים — הוגנות-חלוקה (לא תמיד אותם-ראשונים)
  const offset = (new Date().getUTCHours() + (chain === "hive" ? 5 : 0)) % fleetNames.length;
  const voters = fleetNames.slice(offset).concat(fleetNames.slice(0, offset));
  // מאגר-מועמדים: בלוגים-טריים של הצי
  const candidates = [];
  for (const author of fleetNames) {
    if (!wifFor(author, chain)) continue; // אין מפתח-posting חי — כנות, דילוג
    try {
      const posts = await rpc(chain, "condenser_api.get_discussions_by_blog", [{ tag: author, limit: 5 }]);
      for (const p of posts) {
        const ageD = (Date.now() - new Date(p.created + "Z").getTime()) / 86400e3;
        if (ageD < 0 || ageD > MAX_AGE_DAYS) continue;
        candidates.push({ author: p.author, permlink: p.permlink, ageD: +ageD.toFixed(2) });
      }
    } catch { /* דילוג-כנה על כותב-שנכשל */ }
  }

  for (const voter of voters) {
    const wif = wifFor(voter, chain);
    if (!wif) { dbg(`skip ${voter}: no ${chain} posting wif`); continue; }
    // כנות-מדודה: ה-posting-STEEM של headcorner סובב (owner-חי ≠ כספת) — אין-לנו; דילוג
    if (voter === "headcorner" && chain === "steem") { dbg("skip headcorner/steem: rotated keys (operator-only)"); continue; }
    if (voter === "ynet") { dbg("skip ynet: operator-delegated, no wif"); continue; }
    const st = (state.perAccount[voter] ??= { steem: 0, hive: 0 });
    if ((st[chain] ?? 0) >= CAP_PER_CHAIN_PER_DAY) continue;
    if (cast >= MAX_PER_RUN) break;

    // שלילת-הצבעה-עצמית + שלילת-כפילות מול active_votes
    const pool = candidates.filter((c) => c.author !== voter);
    // סדר-יציב-מעורבב (מזהה-יום+voter) — גיוון בלי-random-לא-יציב
    pool.sort((a, b) => (a.permlink + epoch).localeCompare(b.permlink + epoch));
    for (const c of pool) {
      try {
        const post = await rpc(chain, "condenser_api.get_content", [c.author, c.permlink]); // condenser מחזיר אובייקט, לא מערך
        if (!post || !post.author) { dbg(`no-post ${c.permlink.slice(0,30)}`); continue; }
        if ((post.active_votes || []).some((v) => v.voter === voter)) { dbg(`already-voted ${voter}→${c.author}`); continue; }
        if (post.net_rshares !== 0 && (post.cashout_time === "1969-12-31T23:59:59" || Date.parse(post.cashout_time + "Z") < Date.now())) continue; // כבר-נפד
        try {
          const res = await broadcastVote(chain, voter, wif, c.author, c.permlink);
          st[chain] = (st[chain] ?? 0) + 1;
          cast++;
          const txid = res?.id || res?.transaction_id || null;
          logVote({ at: new Date().toISOString(), chain, voter, author: c.author, permlink: c.permlink, weight: WEIGHT, txid, ok: true });
          console.log(`✓ ${chain} ${voter} → @${c.author}/${c.permlink.slice(0, 32)} (age ${c.ageD}d) txid:${String(txid).slice(0, 10)}`);
        } catch (e) {
          logVote({ at: new Date().toISOString(), chain, voter, author: c.author, permlink: c.permlink, ok: false, err: String(e.message || e).slice(0, 140) });
          console.log(`✗ ${chain} ${voter} → @${c.author}: ${String(e.message || e).slice(0, 90)}`);
        }
        break; // הצבעה-אחת-לחייל-לחריצה
      } catch (e) { dbg(`cand-err ${c.permlink.slice(0,30)}: ${String(e.message||e).slice(0,80)}`); continue; }
    }
  }
  totalCast += cast;
}

writeFileSync(VOTE_STATE, JSON.stringify(state, null, 1));
console.log(`soldier-vote-beat done: cast=${totalCast} epoch=${epoch} chains=[${CHAINS.join(",")}]`);
