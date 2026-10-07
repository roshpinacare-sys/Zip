/**
 * soldier-restore.mjs — שחזור-מפתחות-STEEM לחיילים-המתים (owner-signed account_update)
 * משחזר posting/active/memo לערכים הרשומים בכספת (בעלי-ה-WIFs אצלנו), owner נשאר כמו-שהוא.
 * dry-run כברירת-מחדל; --execute בלבד לשידור-חי. אף-סוד-לא-נדפס.
 */
import { readFileSync } from "node:fs";
import * as steem from "/home/z/my-project/zip/node_modules/steem/lib/index.js";

const VAULT = "/home/z/fleet-tmp/nvx-vault-extracted.json";
const EXECUTE = process.argv.includes("--execute");
const vault = JSON.parse(readFileSync(VAULT, "utf8"));

const auth = (pub) => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });

async function rpc(method, params) {
  const res = await fetch("https://api.steemit.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

const accounts = await rpc("condenser_api.get_accounts", [vault.accounts.map((a) => a.username)]);
const chainMap = new Map(accounts.map((a) => [a.name, a]));

const results = [];
for (const acc of vault.accounts) {
  const row = { account: acc.username, action: "none", steemOwnerMatch: null, planned: {} };
  const k = acc.keys || {};
  const ownerWif = k.owner?.wif;
  const chain = chainMap.get(acc.username);
  if (!ownerWif || !chain) { row.action = "skip(no-owner-wif-or-account)"; results.push(row); continue; }

  // verify vault owner WIF derives a pub that is on the live owner authority
  const ownerPub = steem.auth.wifToPublic(ownerWif);
  const liveOwnerKeys = (chain.owner?.key_auths || []).map((x) => x[0]);
  row.steemOwnerMatch = liveOwnerKeys.includes(ownerPub);
  if (!row.steemOwnerMatch) { row.action = "skip(owner-no-control)"; results.push(row); continue; }

  // current authorities (live) vs vault targets
  const liveActive = (chain.active?.key_auths || []).map((x) => x[0]);
  const livePosting = (chain.posting?.key_auths || []).map((x) => x[0]);
  const liveMemo = chain.memo_key;
  const targetActive = k.active?.pub, targetPosting = k.posting?.pub, targetMemo = k.memo?.pub;
  if (!targetActive || !targetPosting || !targetMemo) { row.action = "skip(vault-incomplete)"; results.push(row); continue; }

  const needsActive = !liveActive.includes(targetActive);
  const needsPosting = !livePosting.includes(targetPosting);
  const needsMemo = liveMemo !== targetMemo;
  if (!needsActive && !needsPosting && !needsMemo) { row.action = "already-restored"; results.push(row); continue; }

  row.planned = { active: needsActive, posting: needsPosting, memo: needsMemo };
  row.action = EXECUTE ? "broadcast" : "dry-run";
  if (EXECUTE) {
    const op = {
      account: acc.username,
      active: auth(targetActive),
      posting: auth(targetPosting),
      memo_key: targetMemo,
      json_metadata: chain.json_metadata || "",
      // owner authority untouched — not passed at all
    };
    try {
      await new Promise((resolve, reject) => {
        steem.broadcast.send(
          { extensions: [], operations: [["account_update", op]] },
          [ownerWif],
          (err, res) => (err ? reject(new Error(String(err).slice(0, 300))) : resolve(res))
        );
      });
      row.result = "OK";
    } catch (e) {
      row.result = "FAIL: " + e.message;
    }
  }
  results.push(row);
}

console.log("account".padEnd(13), "steemOwner", "action".padEnd(12), "planned", "result");
for (const r of results) console.log(r.account.padEnd(13), String(r.steemOwnerMatch).padEnd(9), r.action.padEnd(12), JSON.stringify(r.planned), r.result || "");
