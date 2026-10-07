#!/usr/bin/env bun
/**
 * blurt-key-derive-prove — הוכחת-מפתח-BLURT בנגזרת-ציבורית (אפס-שידור, אפס-הדפסת-סוד)
 *
 * רקע (דבר-המפעיל, "חיילים-מתים"): BLURT הוכח-חי ב-r184 (blurt-rail-proof.json,
 * txid 35f28817… active-authority headcorner) — המפתח "קיים-בכספת-האם,
 * pubKey-זהה-לשרשרת" (rail-exec.ts:507). הסקריפט הזה מוכיח אם נגזרת-ה-WIF-הקיים
 * (STEEM/HIVE active) מתאימה ל-authority-החי על BLURT:
 *   1. טוען WIF מתוך .env (לעולם לא מדפיס)
 *   2. גוזר פאבליקי (steem.auth.wifToPublic) — מנטרל STM→BLT
 *   3. קורא condenser_api.get_accounts["headcorner"] מ-rpc.blurt.blog
 *   4. משווה מול active.key_auths → MATCH/NO-MATCH בלבד בלוג
 *
 * Usage: bun scripts/blurt-key-derive-prove.mjs
 */

import { readFileSync } from "node:fs";
import * as steem from "steem";

const ENV_PATH = "/home/z/my-project/saos-dex/.env";
const ACCOUNT = process.env.PROVE_ACCOUNT || "headcorner";
const RPC = "https://rpc.blurt.blog";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv(ENV_PATH);
const candidates = [
  ["STEEM_ACTIVE_WIF", env.STEEM_ACTIVE_WIF],
  ["HIVE_ACTIVE_WIF", env.HIVE_ACTIVE_WIF],
].filter(([, v]) => !!v);

if (candidates.length === 0) {
  console.error("[blurt-prove] ✗ אין-WIF-פעיל-ב-.env לגזירה");
  process.exit(1);
}

const res = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "condenser_api.get_accounts",
    params: [[ACCOUNT]],
  }),
});
const j = await res.json();
const acc = j?.result?.[0];
if (!acc) {
  console.error(`[blurt-prove] ✗ חשבון ${ACCOUNT} לא-נמצא-על-BLURT`);
  process.exit(1);
}
const chainActiveKeys = (acc.active?.key_auths || []).map((k) => k[0]);
const chainPostingKeys = (acc.posting?.key_auths || []).map((k) => k[0]);
console.log(`[blurt-prove] ${ACCOUNT}@BLURT active.key_auths=${chainActiveKeys.length} posting=${chainPostingKeys.length}`);

let anyMatch = false;
for (const [name, wif] of candidates) {
  try {
    const pub = steem.auth.wifToPublic(wif); // STM…-prefix
    const blt = "BLT" + pub.slice(3);
    const stm = "STM" + pub.slice(3);
    const activeMatch = chainActiveKeys.includes(blt) || chainActiveKeys.includes(stm);
    const postingMatch = chainPostingKeys.includes(blt) || chainPostingKeys.includes(stm);
    console.log(
      `[blurt-prove] ${name}: pub=${blt.slice(0, 12)}… active=${activeMatch ? "MATCH✓" : "no"} posting=${postingMatch ? "MATCH✓" : "no"}`
    );
    if (activeMatch) anyMatch = true;
  } catch (e) {
    console.error(`[blurt-prove] ${name}: גזירה-נכשלה (${e.message})`);
  }
}
console.log(anyMatch ? "[blurt-prove] VERDICT: PROVED — BLURT_ACTIVE_WIF=STEEM_ACTIVE_WIF-תקף" : "[blurt-prove] VERDICT: NO-MATCH — נדרש-חומר-אחר");
process.exit(anyMatch ? 0 : 2);
