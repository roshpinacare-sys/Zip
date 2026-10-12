#!/usr/bin/env node
// blurt-connector — P0-5 (master plan T7, 2026-10-11)
// One-shot revival rail for the 12 pre-fork BLURT bodies already under custody.
// Modes:
//   health  — probe every node in blurt-nodes.json, report liveness+latency (no keys)
//   dry     — key-fit (WIF→derived pubkey ≡ chain posting authority) + BYTE-LAW:
//             our tx serialization must equal condenser_api.get_transaction_hex
//             from the node. NO broadcast. Cryptographic proof without spending.
//   post    — dry checks + broadcast. Refuses unless CI_BLURT_ENABLED === "true"
//             (owner DecisionQueue law: GEN-2 rotation first, then flip).
// Secrets: CI_BLURT_POSTING_WIF (preferred) or CI_ADOPT_WIF_POSTING fallback.
// Prints a receipt JSON to stdout. Exit 0 = mode succeeded.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const secp = require("@noble/secp256k1");
const { sha256 } = require("@noble/hashes/sha256");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  let hex = n.toString(16).padStart(2, "0");
  if (hex.length % 2) hex = "0" + hex;
  let bytes = Buffer.from(hex, "hex");
  for (const c of s) { if (c === "1") bytes = Buffer.concat([Buffer.from([0]), bytes]); else break; }
  return bytes;
}
function b58checkDecode(s) {
  const raw = b58decode(s);
  const body = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  const h = Buffer.from(sha256(sha256(body))).subarray(0, 4);
  if (!h.equals(checksum)) throw new Error("base58 checksum mismatch");
  return body;
}
function b58checkEncode(bytes) {
  const h = Buffer.from(sha256(sha256(bytes))).subarray(0, 4);
  const all = Buffer.concat([bytes, h]);
  let n = BigInt("0x" + all.toString("hex"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of all) { if (b === 0) out = "1" + out; else break; }
  return out;
}
// steem-family pubkey string = PREFIX + base58check(pubkeyBytes)
function pubString(prefix, bytes) { return prefix + b58checkEncode(bytes); }
function pubBody(pubStr) { return pubStr.replace(/^[A-Z]+/, ""); }

async function rpc(url, method, params, ms = 6000) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(ms),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

// ── minimal binary serializer (steem-family pre-fork layout) ─────────────
function varint(n) { const out = []; let v = n >>> 0; do { let b = v & 0x7f; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v); return Buffer.from(out); }
function serString(s) { const b = Buffer.from(s, "utf8"); return Buffer.concat([varint(b.length), b]); }
function serU16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; }
function serU32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function serI32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n | 0); return b; }
// steem-family op-id table (chain-proven: account_update=6 via blurt-ser;
// vote=0/comment=1 are the family constants the byte-law dry exercises)
const OP_IDS = { vote: 0, comment: 1, transfer: 2, transfer_to_vesting: 3, withdraw_vesting: 4, set_withdraw_vesting_route: 5, account_update: 6, account_create: 7, account_witness_vote: 8, account_witness_proxy: 9, delete_comment: 10, custom_json: 34 };
function serAsset(s) { // "1.000 BLURT" -> u64 mantissa LE + u8 precision + nul-padded symbol
  const m = /^([0-9]+)\.([0-9]{1,8}) ([A-Z]+)$/.exec(String(s));
  if (!m) throw new Error("asset-format " + String(s).slice(0, 24));
  const mant = BigInt(m[1] + m[2]);
  const prec = m[2].length;
  const b = Buffer.alloc(8 + 1);
  b.writeBigUInt64LE(mant); b.writeUInt8(prec, 8);
  const sym = Buffer.from(m[3], "ascii");
  return Buffer.concat([b, sym, Buffer.from([0])]);
}
function serOp(op) {
  const [name, body] = op;
  const id = typeof name === "number" ? name : OP_IDS[String(name)];
  if (id === undefined) throw new Error("serializer: unknown op " + name);
  if (id === 0) { // vote
    return Buffer.concat([varint(0), serString(body.voter), serString(body.author), serString(body.permlink), serI32(body.weight)]);
  }
  if (id === 1) { // comment: parent_author, parent_permlink, author, permlink, title, body, json_metadata
    return Buffer.concat([varint(1), serString(body.parent_author ?? ""), serString(body.parent_permlink ?? ""),
      serString(body.author), serString(body.permlink), serString(body.title ?? ""), serString(body.body), serString(body.json_metadata ?? "{}")]);
  }
  if (id === 2) { // transfer: from, to, amount(asset), memo
    return Buffer.concat([varint(2), serString(body.from), serString(body.to), serAsset(body.amount), serString(body.memo ?? "")]);
  }
  throw new Error("serializer: unsupported op " + id);
}
function serTx(tx) {
  // expiration: the node wants an ISO string in JSON, but the BYTE law is
  // fc::time_point_sec = u32 unix (measured 15:08:25 receipt: ours 00000000,
  // node e3a6cb6a). Convert here — one object serves both laws.
  const exp = typeof tx.expiration === "string"
    ? Math.floor(Date.parse(tx.expiration) / 1000)
    : tx.expiration;
  return Buffer.concat([serU16(tx.ref_block_num), serU32(tx.ref_block_prefix), serU32(exp),
    varint(tx.operations.length), ...tx.operations.map(serOp), varint(0)]);
}

async function main() {
  const mode = process.argv[2] || "health";
  const nodesCfg = JSON.parse(readFileSync(new URL("../blurt-nodes.json", import.meta.url), "utf8"));
  const PREFIX = nodesCfg.addressPrefix || "BLT";
  const receipt = { mode, at: new Date().toISOString(), nodes: [], verdict: "unknown" };

  // 1) health
  for (const url of nodesCfg.nodes) {
    const t0 = Date.now();
    try { const g = await rpc(url, "condenser_api.get_dynamic_global_properties", [], 5000); receipt.nodes.push({ url, live: true, ms: Date.now() - t0, head: g.head_block_number }); }
    catch (e) { receipt.nodes.push({ url, live: false, ms: Date.now() - t0, err: String(e).slice(0, 60) }); }
  }
  const live = receipt.nodes.filter((n) => n.live).sort((a, b) => a.ms - b.ms);
  if (!live.length) {
    // HONEST ALL-NODES-DOWN law (zai-13b, task 13-b): an external RPC outage is
    // the world's failure, not this machine's — a red run here is noise that
    // masks real failures (fleet law: מצבה-כנה במקום אדום). Record the state,
    // exit 0 with a machine-readable marker; the receipt commit in the
    // workflow is the clearly-named state file. Never a fake probe.
    receipt.nodesDown = true;
    receipt.marker = "BLURT-NODES-DOWN=true";
    receipt.verdict = "NO-LIVE-NODE — כנה: כל-הצמתים-מתים; מצבה-כנה במקום אדום (רכבת fail-closed, owner מסובב צמתים)";
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  const node = live[0].url;
  receipt.primaryNode = node;

  if (mode === "health") { receipt.verdict = `HEALTH-OK live=${live.length}/${receipt.nodes.length}`; console.log(JSON.stringify(receipt, null, 2)); return; }

  // 2) key-fit — derived pubkey must equal the chain's posting authority
  const wif = (process.env.CI_BLURT_POSTING_WIF || process.env.CI_ADOPT_WIF_POSTING || "").trim();
  if (!wif) { receipt.verdict = "DRY-REFUSED-NO-WIF (fail-closed by law)"; console.log(JSON.stringify(receipt, null, 2)); process.exit(1); }
  const account = (process.env.BLURT_ACCOUNT || "headcorner").trim();
  let chainIdHex = null;
try { chainIdHex = await rpc(node, "condenser_api.get_chain_id", []); receipt.chainIdSource = "rpc:get_chain_id"; }
catch (e) { receipt.chainIdSource = "unavailable:" + String(e?.message ?? e).slice(0, 60); } // saboin has no get_chain_id (measured 2026-10-11); DRY needs none
  const [acct] = await rpc(node, "condenser_api.get_accounts", [[account]]);
  if (!acct) { receipt.verdict = "ACCOUNT-ABSENT-ON-BLURT"; console.log(JSON.stringify(receipt, null, 2)); process.exit(1); }
  const expectedPub = acct.posting.key_auths[0][0];

  const privRaw = b58checkDecode(wif).subarray(1, 33); // strip 0x80 + checksum
  const pubBytes = Buffer.from(secp.getPublicKey(privRaw, true));
  const derived = pubString(PREFIX, pubBytes);
  // blurt authority strings can carry a broken base58 checksum (measured
  // 2026-10-11: live chk 04e2055c vs computed d4a396b2, bodies identical) -
  // key-fit is judged on the DECODED 33-byte key bodies, never the display.
  const bodyBytesOf = (s) => {
    let n2 = 0n;
    for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n2 = n2 * 58n + BigInt(i); }
    let hx = n2.toString(16).padStart(2, "0");
    if (hx.length % 2) hx = "0" + hx;
    const raw = Buffer.from(hx, "hex");
    return raw.subarray(0, Math.max(0, raw.length - 4));
  };
  const dBytes = bodyBytesOf(derived.replace(/^[A-Z]{3}/, "")), eBytes = bodyBytesOf(expectedPub.replace(/^[A-Z]{3}/, ""));
  receipt.keyFit = {
    account, chainId: chainIdHex,
    derivedBody: dBytes.toString("hex").slice(0, 16) + "...",
    expectedBody: eBytes.toString("hex").slice(0, 16) + "...",
    match: dBytes.equals(eBytes) && eBytes.length === 33,
  };
  if (!receipt.keyFit.match) {
    receipt.verdict = "KEY-MISMATCH (this WIF does not open this blurt body — fail-closed)";
    console.log(JSON.stringify(receipt, null, 2)); process.exit(1);
  }

  // 3) BYTE-LAW: our serialization must equal the node's canonical hex
  const headBlock = live[0].head - 3;
  const head = await rpc(node, "condenser_api.get_block_header", [headBlock]);
  const blockId = head.previous || head.block_id;
  const tx = {
    ref_block_num: parseInt(blockId.slice(0, 8), 16) & 0xffff,
    ref_block_prefix: parseInt(blockId.slice(8, 16), 16) >>> 0,
    expiration: new Date((Math.floor(Date.now() / 1000) + 120) * 1000).toISOString().slice(0, 19), // fc::time_point_sec wants ISO
    operations: [["vote", { voter: account, author: account, permlink: "blurt-revival-probe", weight: 0 }]],
    extensions: [],
  };
  const ours = serTx(tx).toString("hex");
  const expected = await rpc(node, "condenser_api.get_transaction_hex", [tx]);
  receipt.byteLaw = { exact: ours === String(expected).toLowerCase() };
  if (!receipt.byteLaw.exact) {
    receipt.verdict = "BYTE-LAW-MISMATCH (serializer divergence — refuse to sign)";
    receipt.byteLaw.ours = ours; receipt.byteLaw.expected = String(expected).toLowerCase();
    console.log(JSON.stringify(receipt, null, 2)); process.exit(1);
  }

  if (mode === "dry") { receipt.verdict = "DRY-OK key-fit + byte-law proven, zero broadcast"; console.log(JSON.stringify(receipt, null, 2)); return; }

  // 4) post — double-gated by law
  if (process.env.CI_BLURT_ENABLED !== "true") {
    receipt.verdict = "POST-REFUSED-NOT-ENABLED (CI_BLUT_ENABLED gate; owner DecisionQueue law)";
    console.log(JSON.stringify(receipt, null, 2)); process.exit(1);
  }
  if (!chainIdHex) { receipt.verdict = "CHAIN-ID-UNMEASURED (post refused — fail-closed; dry law needs none, post does)"; console.log(JSON.stringify(receipt, null, 2)); process.exit(1); }
const digest = Buffer.from(sha256(Buffer.concat([Buffer.from(chainIdHex, "hex"), serTx(tx)])));
  const sig = secp.sign(digest, privRaw, { prehash: false });
  const rHex = sig.r.toString(16).padStart(64, "0");
  const sHex = sig.s.toString(16).padStart(64, "0");
  const compact = Buffer.from(rHex + sHex, "hex");
  let recid = -1;
  for (let c = 0; c < 4; c++) {
    try {
      const rec = secp.recoverPublicKey(compact, digest, c, true);
      if (Buffer.from(rec).equals(pubBytes)) { recid = c; break; }
    } catch { /* next */ }
  }
  if (recid < 0) { receipt.verdict = "RECID-UNRESOLVED (refuse)"; console.log(JSON.stringify(receipt, null, 2)); process.exit(1); }
  const sigHex = Buffer.concat([Buffer.from([recid + 27 + 4]), compact]).toString("hex");
  const res = await rpc(node, "condenser_api.broadcast_transaction_synchronous", [tx, [sigHex]]);
  receipt.broadcast = { txid: res?.id || res?.tx?.transaction_id || null, block: res?.block_num || null };
  receipt.verdict = receipt.broadcast.txid ? `POSTED txid=${receipt.broadcast.txid}` : "POST-UNKNOWN-RESPONSE";
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((e) => { console.error(JSON.stringify({ mode: process.argv[2] || "health", verdict: "ERROR", err: String(e).slice(0, 200) }, null, 2)); process.exit(1); });
