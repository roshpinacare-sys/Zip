#!/usr/bin/env node
/**
 * rotate.mjs — fleet-rotation phase A (T-67, owner directive trace 1a12fa8a24c05655).
 *
 * MANDATE: the army-account credentials matched by census-v2 (receipt 2026-10-12T03:18Z)
 * derive from material that was publicly recoverable since 2026-09-12 (R11 ALIVE-ALERT).
 * Owner law tonight: "no keys in public, no exposed secrets — they must not breach us."
 * Phase A rotates EVERYTHING EXPOSED except owner authorities (recovery window):
 *   - 10 steem quads accounts: active + posting + memo (owner-signed, owner field absent)
 *   - 3 hcsoldier accounts: active + posting (active-signed)
 *   - 9 hive accounts: active + posting (active-signed)
 * Phase B (owner-authority rotation) = separate explicit dispatch after phase A receipts verify.
 *
 * LAWS HONORED:
 *  - byte-law: node get_transaction_hex must equal local serialization (rot3-broadcast.mjs)
 *  - consensus-form: digest = sha256(chainId || serialized-minus-tx-level-ext-byte) (node-oracle 2026-10-08)
 *  - self-verify: secp256k1 verify before any broadcast
 *  - chain-judge pre + post: no rotation without live authority match; no success claim without RPC proof
 *  - incremental custody: new material sealed to repo secrets IMMEDIATELY after each account
 *  - recoverability: owner keys untouched in phase A -> owner can always restore active/posting/memo
 *  - zero material in logs: fingerprints only (first 8 chars of pubkeys, sha-prefix of WIFs)
 *
 * Modes:
 *   --selftest              offline vectors, zero network
 *   --match  OUT.json       open vault archives (bundle passes, env-only) + chain-judge -> matched map
 *   --rotate MATCH.json OUT.json  rotate roster∩matched, broadcast, verify, incremental custody
 */
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";

const STEEM_DIR = process.env.ROT_STEEM_DIR || path.resolve("steem-engine");
const TX = await import(path.resolve(STEEM_DIR, "mini-services/saos-engine/steemtx.mjs"));
const P = (await import(path.resolve(import.meta.dirname, "../key-census-probe/probe.cjs"))).default;
const secp = await import("@noble/secp256k1");
const { sha256 } = await import("@noble/hashes/sha256");

const RPCS = {
  steem: ["https://api.steemit.com", "https://api.steemitdev.com", "https://steem.foxleycoin.com"],
  hive: ["https://api.hive.blog", "https://api.openhive.network", "https://hived.emre.sh"],
};

const STEEM_QUADS = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const STEEM_ACT = ["hcsoldier4", "hcsoldier5", "hcsoldier6"];
const HIVE_ACT = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];

function fp(s) { return crypto.createHash("sha256").update(String(s), "utf8").digest("hex").slice(0, 8); }
function pubFp(pub) { return String(pub).slice(0, 12); }
function log(o) { console.log(typeof o === "string" ? o : JSON.stringify(o)); }

async function rpcFor(chain, method, params) {
  let lastErr = null;
  for (const url of RPCS[chain]) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      if (j.error) { lastErr = new Error(String(j.error.message || "rpc error").slice(0, 120)); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all rpc endpoints failed for " + chain);
}

async function getAccount(chain, name) {
  const res = await rpcFor(chain, "condenser_api.get_accounts", [[name]]);
  return (res && res[0]) || null;
}

async function dgpo(chain) { return rpcFor(chain, "condenser_api.get_dynamic_global_properties", []); }

const auth = (pub) => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });

/* house WIF form: 37-byte era (0x80 + 32B key + 4B chk, NO compressed flag) —
 * the steem-lib wifToPublic (used by census/custody chain-judges) mis-strips
 * the 38-byte flag form (measured: 33-byte warning + wrong pub). Same private
 * value, same on-chain compressed pubkey; only the wrapper differs. */
const sha256dLocal = (b) => Buffer.from(sha256(Buffer.from(sha256(b))));
function wif37(priv32) {
  const body = Buffer.concat([Buffer.from([0x80]), Buffer.from(priv32)]);
  const chk = sha256dLocal(body).slice(0, 4);
  return TX.b58encode(Buffer.concat([body, chk]));
}
function newKey() {
  const priv = crypto.randomBytes(32);
  const wif = wif37(priv);
  const pub = TX.pubkeyFromSeed(priv);
  const back = TX.wifDecode(wif);
  if (!back || Buffer.from(back).toString("hex") !== priv.toString("hex")) throw new Error("wif roundtrip failed");
  if (P.wifToPubSafe(wif) !== pub) throw new Error("pub derivation mismatch wif vs seed");
  return { priv, wif, pub };
}

/* ── byte-law + broadcast, the rot3-proven path ─────────────────────────── */
async function broadcastOp(chain, op, opsName, signingWif) {
  const dgpo0 = await dgpo(chain);
  const headNum = dgpo0.head_block_number;
  const idBytes = Buffer.from(String(dgpo0.head_block_id), "hex");
  const exp = Math.floor(Date.now() / 1000) + 60;
  const chainId = chain === "steem" ? Buffer.alloc(32) : Buffer.from(TX.HIVE_CHAIN_ID);
  const tx = TX.buildTx({ ops: [[opsName, op]], dgpo: dgpo0, wifs: [], ttlSec: 60, chainId });
  const nodeHex = await rpcFor(chain, "condenser_api.get_transaction_hex", [{
    ref_block_num: headNum & 0xffff,
    ref_block_prefix: idBytes.readUInt32LE(4),
    expiration: new Date(exp * 1000).toISOString().slice(0, 19),
    operations: [[opsName, op]],
    extensions: [],
  }]);
  const byteMatch = nodeHex === tx.serializedHex;
  if (!byteMatch) throw new Error("byte-law FAIL nodeLen=" + (nodeHex.length / 2) + " myLen=" + (tx.serializedHex.length / 2));
  const bin = Buffer.from(tx.serializedHex, "hex");
  const digest = sha256(Buffer.concat([chainId, bin.slice(0, bin.length - 1)]));
  const sig = TX.signDigest(Buffer.from(digest), signingWif);
  const secret = TX.wifDecode(signingWif);
  const selfOk = secp.verify(sig.slice(1), digest, Buffer.from(secp.getPublicKey(Buffer.from(secret), true)));
  if (!selfOk) throw new Error("signature self-verify FAIL");
  const b = await rpcFor(chain, "condenser_api.broadcast_transaction_synchronous", [{ ...tx.json, signatures: [sig.toString("hex")] }]);
  const txid = String((b && (b.id || (b.result && b.result.id))) || "");
  if (!txid) throw new Error("broadcast answered without id (honest)");
  return { txid, digestHex: Buffer.from(digest).toString("hex").slice(0, 16) };
}

async function verifyAuthority(chain, name, expect, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const a = await getAccount(chain, name);
    if (a) {
      const ok = expect.every((e) => {
        const cur = e.role === "memo" ? a.memo_key : (a[e.role] || {}).key_auths?.[0]?.[0];
        return cur === e.pub;
      });
      if (ok) return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/* ── selftest ───────────────────────────────────────────────────────────── */
function selftest() {
  const k1 = newKey();
  if (!/^[5JK][1-9A-HJ-NP-Za-km-z]{50}$/.test(k1.wif)) throw new Error("wif shape");
  const a = { weight_threshold: 1, account_auths: [], key_auths: [[k1.pub, 1]] };
  if (a.key_auths.length !== 1) throw new Error("authority shape");
  const op = { account: "selftest-account", active: a, posting: a, memo_key: k1.pub, json_metadata: "{}" };
  if (op.account.length < 3 || op.json_metadata === undefined) throw new Error("op shape");
  const k2 = newKey();
  if (k1.wif === k2.wif || k1.pub === k2.pub) throw new Error("randomness");
  const priv32 = Buffer.alloc(32); priv32[31] = 1;
  const wif1 = wif37(priv32);
  if (Buffer.from(TX.wifDecode(wif1))[31] !== 1) throw new Error("KAT roundtrip");
  if (P.wifToPubSafe(wif37(priv32)) !== TX.pubkeyFromSeed(priv32)) throw new Error("wif37 vs chain-lib pub mismatch");
  log({ selftest: "PASS", vectors: 6 });
}

/* ── match: open archives + chain-judge ─────────────────────────────────── */
async function matchMode(outPath) {
  const bundle = JSON.parse(process.env.STEEM_VAULT_PASSES || "null");
  if (!bundle) { log("ABORT: STEEM_VAULT_PASSES absent"); process.exit(1); }
  const passRefs = [];
  for (const era of ["gen2", "recovery-3"]) {
    if (bundle[era] && bundle[era].keysZipUnlock) passRefs.push({ ref: era + ".keysZipUnlock", pass: bundle[era].keysZipUnlock });
    if (bundle[era] && bundle[era].keysBackupUnlock) passRefs.push({ ref: era + ".keysBackupUnlock", pass: bundle[era].keysBackupUnlock });
  }
  if (!passRefs.length) { log("ABORT: bundle has no usable unlock passes"); process.exit(1); }
  const vaultDir = path.join(STEEM_DIR, "agent", "vault");
  const encFiles = fs.readdirSync(vaultDir).filter((f) => f.endsWith(".enc"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rot2-"));
  const wifs = [];
  let opened = [];
  for (const f of encFiles) {
    const src = path.join(vaultDir, f);
    const dec = path.join(work, f.replace(/\.enc$/, ""));
    let hit = null;
    for (const pr of passRefs) {
      try {
        P.decryptTry(src, dec, pr.pass, pr.ref);
        hit = pr.ref; break;
      } catch (e) { /* try next */ }
    }
    if (!hit) { log({ archive: f, opened: false }); continue; }
    opened.push(f);
    const extDir = path.join(work, "x-" + f.replace(/\.enc$/, ""));
    fs.mkdirSync(extDir, { recursive: true });
    const magic = fs.readFileSync(dec).subarray(0, 2).toString();
    try {
      if (magic === "PK") execFileSync("unzip", ["-o", "-q", dec, "-d", extDir]);
      else execFileSync("tar", ["xf", dec, "-C", extDir]);
    } catch (e) { log({ archive: f, extract: "fail", err: String(e).slice(0, 60) }); continue; }
    P.scanDir(extDir, wifs);
  }
  log({ archivesOpened: opened.length, of: encFiles.length, wifCandidates: wifs.length });
  const wifsHive = wifs.slice(); // same material may feed both chains (fork-era keys)
  const rosterNames = [...new Set([...STEEM_QUADS, ...STEEM_ACT, ...HIVE_ACT])];
  const live = {};
  live.steem = await liveAuthoritiesChain("steem", rosterNames);
  live.hive = await liveAuthoritiesChain("hive", rosterNames);
  const matched = { steem: {}, hive: {}, meta: { opened, at: new Date().toISOString() } };
  const roster = [
    ...STEEM_QUADS.map((a) => ({ chain: "steem", account: a, roles: ["active", "posting", "memo"] })),
    ...STEEM_ACT.map((a) => ({ chain: "steem", account: a, roles: ["active", "posting"] })),
    ...HIVE_ACT.map((a) => ({ chain: "hive", account: a, roles: ["active", "posting"] })),
  ];
  let cov = 0;
  for (const r of roster) {
    const acc = live[r.chain][r.account];
    if (!acc) { log({ roster: r.chain + ":" + r.account, live: "absent" }); continue; }
    for (const role of r.roles) {
      const want = role === "memo" ? acc.memo_key : (acc[role] || {}).key_auths?.[0]?.[0];
      if (!want) continue;
      const pool = r.chain === "steem" ? wifs : wifsHive;
      const hit = pool.find((c) => P.wifToPubSafe(c.wif) === want);
      if (hit) {
        matched[r.chain][r.account] = matched[r.chain][r.account] || {};
        matched[r.chain][r.account][role] = hit.wif;
        cov++;
      }
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(matched, null, 1), { mode: 0o600 });
  fs.chmodSync(outPath, 0o600);
  log({ coverage: cov, steemAccounts: Object.keys(matched.steem).length, hiveAccounts: Object.keys(matched.hive).length, out: "written-0600" });
  const need = STEEM_QUADS.length * 3 + STEEM_ACT.length * 2 + HIVE_ACT.length * 2;
  if (cov < need) { log({ VERDICT: "PARTIAL-COVERAGE", have: cov, need, note: "rotate only what matched; unexplained gaps are honest red" }); }
}

async function liveAuthoritiesChain(chain, names) {
  const out = {};
  const res = await rpcFor(chain, "condenser_api.get_accounts", [names]);
  for (const a of res || []) {
    out[a.name] = {
      owner: { key_auths: [[a.owner.key_auths[0][0], 1]] },
      active: { key_auths: [[a.active.key_auths[0][0], 1]] },
      posting: { key_auths: [[a.posting.key_auths[0][0], 1]] },
      memo_key: a.memo_key,
      json_metadata: a.json_metadata || "",
    };
  }
  return out;
}

/* ── rotate ─────────────────────────────────────────────────────────────── */
async function rotateMode(matchPath, outPath) {
  const matched = JSON.parse(fs.readFileSync(matchPath, "utf8"));
  const GH = process.env.GH_PAT || "";
  const rot = { at: new Date().toISOString(), phase: "A", accounts: [], custody: { puts: [] } };

  async function custodyPut(acc) {
    if (!GH) return;
    const H = { Authorization: "Bearer " + GH, Accept: "application/vnd.github+json" };
    const sodium = await import("libsodium-wrappers");
    await sodium.ready;
    for (const repo of ["steem", "saos-runtime", "Domain"]) {
      try {
        const pkr = await fetch("https://api.github.com/repos/roshpinacare-sys/" + repo + "/actions/secrets/public-key", { headers: H });
        if (!pkr.ok) throw new Error("pk HTTP " + pkr.status);
        const pk = await pkr.json();
        const sealed = sodium.crypto_box_seal(Buffer.from(JSON.stringify({ rot2: acc.material, at: acc.at })), Buffer.from(pk.key, "base64"));
        const r = await fetch("https://api.github.com/repos/roshpinacare-sys/" + repo + "/actions/secrets/ROT2_FLEET_KEYS", {
          method: "PUT", headers: { ...H, "Content-Type": "application/json" },
          body: JSON.stringify({ encrypted_value: Buffer.from(sealed).toString("base64"), key_id: pk.key_id }),
        });
        if (r.status !== 201 && r.status !== 204) throw new Error("PUT HTTP " + r.status);
        acc.custody.push(repo);
      } catch (e) {
        acc.custodyError = String(e.message || e).slice(0, 80);
      }
    }
  }

  function materialFor(chain, account) {
    const m = matched[chain][account] || {};
    const roles = Object.keys(m);
    if (!roles.length) return null;
    const keys = {};
    for (const role of roles) {
      const k = newKey();
      keys[role] = { wif: k.wif, pub: k.pub };
    }
    return keys;
  }

  async function rotateOne(chain, account, signerRolePriority) {
    const entry = { chain, account, at: new Date().toISOString() };
    const live0 = await getAccount(chain, account);
    if (!live0) { entry.verdict = "SKIP-ABSENT-ON-CHAIN"; rot.accounts.push(entry); return; }
    entry.jsonMetaKept = true;
    const m = (matched[chain] || {})[account] || {};
    // chain-judge every matched wif against LIVE authority before anything
    for (const role of Object.keys(m)) {
      const want = role === "memo" ? live0.memo_key : (live0[role] || {}).key_auths?.[0]?.[0];
      if (P.wifToPubSafe(m[role]) !== want) {
        entry.verdict = "SKIP-CHAIN-JUDGE-FAIL";
        entry.detail = role + " fingerprint=" + fp(m[role]);
        rot.accounts.push(entry);
        return;
      }
    }
    // signer: owner if matched, else active
    let signerWif = null, signerRole = null;
    for (const r of signerRolePriority) {
      if (m[r]) { signerWif = m[r]; signerRole = r; break; }
    }
    if (!signerWif) { entry.verdict = "SKIP-NO-SIGNER"; rot.accounts.push(entry); return; }
    entry.signerRole = signerRole;
    // material: rotate exactly the matched roles
    const newKeys = {};
    for (const role of Object.keys(m)) newKeys[role] = newKey();
    const op = { account, json_metadata: live0.json_metadata || "" };
    if (newKeys.active) op.active = auth(newKeys.active.pub); else op.active = JSON.parse(JSON.stringify(live0.active));
    if (newKeys.posting) op.posting = auth(newKeys.posting.pub); else op.posting = JSON.parse(JSON.stringify(live0.posting));
    op.memo_key = newKeys.memo ? newKeys.memo.pub : live0.memo_key;
    entry.oldPubFp = {
      active: pubFp(live0.active.key_auths[0][0]),
      posting: pubFp(live0.posting.key_auths[0][0]),
      memo: pubFp(live0.memo_key),
    };
    try {
      const b = await broadcastOp(chain, op, "account_update", signerWif);
      entry.txid = b.txid.slice(0, 18);
      entry.digestFp = b.digestHex;
    } catch (e) {
      entry.verdict = "FAIL-BROADCAST";
      entry.error = String(e.message || e).slice(0, 140);
      rot.accounts.push(entry);
      return;
    }
    entry.newPubFp = {};
    for (const role of Object.keys(newKeys)) entry.newPubFp[role] = pubFp(newKeys[role].pub);
    const expect = Object.keys(newKeys).map((role) => ({ role, pub: newKeys[role].pub }));
    entry.chainVerified = await verifyAuthority(chain, account, expect);
    entry.verdict = entry.chainVerified ? "ROTATED-VERIFIED" : "ROTATED-VERIFY-PENDING";
    entry.material = {};
    for (const role of Object.keys(newKeys)) entry.material[role] = { wif: newKeys[role].wif, pub: newKeys[role].pub };
    entry.at = new Date().toISOString();
    rot.accounts.push(entry);
    // incremental custody BEFORE next account
    await custodyPut(entry);
    fs.writeFileSync(outPath, JSON.stringify(rot, null, 1), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  }

  for (const a of STEEM_QUADS) await rotateOne("steem", a, ["owner", "active"]);
  for (const a of STEEM_ACT) await rotateOne("steem", a, ["active"]);
  for (const a of HIVE_ACT) await rotateOne("hive", a, ["active"]);

  const ok = rot.accounts.filter((x) => x.verdict === "ROTATED-VERIFIED").length;
  const pend = rot.accounts.filter((x) => x.verdict === "ROTATED-VERIFY-PENDING").length;
  const skip = rot.accounts.filter((x) => String(x.verdict || "").startsWith("SKIP")).length;
  const fail = rot.accounts.filter((x) => String(x.verdict || "").startsWith("FAIL")).length;
  rot.summary = { rotatedVerified: ok, verifyPending: pend, skipped: skip, failed: fail, total: rot.accounts.length };
  fs.writeFileSync(outPath, JSON.stringify(rot, null, 1), { mode: 0o600 });
  fs.chmodSync(outPath, 0o600);
  log({ PHASE_A_SUMMARY: rot.summary });
  if (ok + pend === 0) { log("VERDICT: NOTHING-ROTATED (honest red — inspect skips/fails)"); process.exit(2); }
}

/* ── main ───────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) { selftest(); process.exit(0); }
if (argv.includes("--match")) { await matchMode(argv[argv.indexOf("--match") + 1]); process.exit(0); }
if (argv.includes("--rotate")) { await rotateMode(argv[argv.indexOf("--rotate") + 1], argv[argv.indexOf("--rotate") + 2]); process.exit(0); }
log("usage: rotate.mjs --selftest | --match OUT | --rotate MATCH OUT");
process.exit(1);
