/**
 * soldier-vault-verify.mjs — אימות-חי של כספת-החיילים ההיסטורית (NVX) מול STEEM ו-HIVE
 * READ-ONLY: אף-שידור, אף-הדפסת-סוד. WIFs נשארים ממוסכים.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as steem from "/home/z/my-project/zip/node_modules/steem/lib/index.js";

const VAULT = "/home/z/fleet-tmp/nvx-vault-extracted.json";
const vault = JSON.parse(readFileSync(VAULT, "utf8"));

function wifToPub(wif, prefix) {
  try {
    // steem.auth.wifToPublic uses STM prefix by default; monkey-patch via address prefix
    const old = steem.config.get("address_prefix");
    steem.config.set("address_prefix", prefix);
    const pub = steem.auth.wifToPublic(wif);
    steem.config.set("address_prefix", old);
    return pub;
  } catch (e) {
    return null;
  }
}

async function getAccounts(rpc, names) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [names] }),
  });
  const j = await res.json();
  return j?.result || [];
}

const names = vault.accounts.map((a) => a.username);
const steemAccs = await getAccounts("https://api.steemit.com", names);
const hiveAccs = await getAccounts("https://api.hive.blog", names);
const steemMap = new Map(steemAccs.map((a) => [a.name, a]));
const hiveMap = new Map(hiveAccs.map((a) => [a.name, a]));

const matrix = [];
for (const acc of vault.accounts) {
  const row = { account: acc.username, steem: {}, hive: {}, balances: {} };
  const s = steemMap.get(acc.username);
  const h = hiveMap.get(acc.username);
  for (const role of ["owner", "active", "posting", "memo"]) {
    const wif = acc?.keys?.[role]?.wif;
    if (!wif) { row.steem[role] = "NO-WIF"; row.hive[role] = "NO-WIF"; continue; }
    const pubS = wifToPub(wif, "STM");
    const pubH = wifToPub(wif, "STM"); // HIVE uses STM prefix too on chain auths
    const chainS = s ? {
      owner: (s.owner?.key_auths || []).map((k) => k[0]),
      active: (s.active?.key_auths || []).map((k) => k[0]),
      posting: (s.posting?.key_auths || []).map((k) => k[0]),
      memo: [s.memo_key],
    } : null;
    const chainH = h ? {
      owner: (h.owner?.key_auths || []).map((k) => k[0]),
      active: (h.active?.key_auths || []).map((k) => k[0]),
      posting: (h.posting?.key_auths || []).map((k) => k[0]),
      memo: [h.memo_key],
    } : null;
    const mk = (pub, chain, crole) => !pub ? "DERIVE-FAIL" : !chain ? "NO-ACCOUNT" : (chain[crole] || []).includes(pub) ? "MATCH" : "NO-MATCH";
    row.steem[role] = mk(pubS, chainS, role);
    row.hive[role] = mk(pubH, chainH, role);
  }
  if (s) row.balances.steem = { STEEM: s.balance, SBD: s.sbd_balance, HP: s.vesting_shares, reputation: s.reputation };
  if (h) row.balances.hive = { HIVE: h.balance, HBD: h.hbd_balance, HP: h.vesting_shares, reputation: h.reputation };
  if (!s) row.balances.steem = "NO-ACCOUNT";
  if (!h) row.balances.hive = "NO-ACCOUNT";
  matrix.push(row);
}

writeFileSync("/home/z/fleet-tmp/soldier-verify-matrix.json", JSON.stringify(matrix, null, 1));

// print verdict table (no secrets)
console.log("account".padEnd(13), "STEEM(o/a/p/m)".padEnd(30), "HIVE(o/a/p/m)".padEnd(30), "balances");
for (const r of matrix) {
  const fmt = (b) => b && typeof b === "object" ? [b.owner, b.active, b.posting, b.memo].map(x => x === "MATCH" ? "✓" : x === "NO-MATCH" ? "✗" : x === "NO-ACCOUNT" ? "—" : "?").join("/") : typeof b === "string" ? "—" : "—";
  const bs = r.balances.steem && typeof r.balances.steem === "object" ? `${r.balances.steem.STEEM}·${r.balances.steem.SBD}·${r.balances.steem.HP}` : "—";
  const bh = r.balances.hive && typeof r.balances.hive === "object" ? `${r.balances.hive.HIVE}·${r.balances.hive.HBD}·${r.balances.hive.HP}` : "—";
  console.log(r.account.padEnd(13), fmt(r.steem).padEnd(30), fmt(r.hive).padEnd(30), "S:" + bs + " H:" + bh);
}
console.log("\nlegend: owner/active/posting/memo per chain");
