#!/usr/bin/env node
// vault-drip.mjs - R314b (2026-10-11): chain-judged posting WIF from the git vault.
// Law: the vault IS the credential delivery; blurt was never re-keyed to GEN-2
// (R267: GEN-1 fits 4/4 live blurt authorities), so the drip tries BOTH eras
// (GEN-2 then GEN-1), sha-pins each archive, chain-judges every candidate
// generation against the LIVE blurt posting authority (keyless saboin RPC),
// and emits ONLY the fitting WIF to stdout. Wipe on every path. Fail-closed.
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const ACCOUNT = String(process.argv[2] ?? "headcorner").trim();
const ENGINE = String(process.argv[3] ?? "/tmp/engine").trim();
const TMP = "/tmp/vdrip";
const RPC = "https://blurt-rpc.saboin.com";
const fail = (v, r) => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } console.error(JSON.stringify({ verdict: v, reason: String(r).slice(0, 600) })); process.exit(1); };

const sha256hex = (b) => crypto.createHash("sha256").update(b).digest("hex");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58checkEncode(bytes) {
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(bytes).digest()).digest().subarray(0, 4);
  const all = Buffer.concat([bytes, h]);
  let n = BigInt("0x" + all.toString("hex")), out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of all) { if (b === 0) out = "1" + out; else break; }
  return out;
}
function wifPriv(w) {
  let n2 = 0n;
  for (const ch of w) { const i = B58.indexOf(ch); if (i < 0) throw new Error("b58"); n2 = n2 * 58n + BigInt(i); }
  let hx = n2.toString(16).padStart(2, "0");
  if (hx.length % 2) hx = "0" + hx;
  const raw = Buffer.from(hx, "hex");
  const body = raw.subarray(0, raw.length - 4);
  const h = crypto.createHash("sha256").update(crypto.createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  if (!h.equals(raw.subarray(raw.length - 4))) throw new Error("wif-checksum");
  if (body[0] !== 0x80) throw new Error("wif-prefix");
  let key = body.subarray(1);
  if (key.length === 33 && key[32] === 0x01) key = key.subarray(0, 32); // compressed-WIF flag byte (measured: GEN-2 flat is 52-char K/L)
  if (key.length !== 32) throw new Error("bad-key-length-" + key.length);
  return key;
}

// eras: GEN-2 (recovery meta) then GEN-1 (its era meta) - same flat shape each.
const ERAS = [
  { name: "GEN-2", meta: ["agent/recovery-meta.json", "agent/vault/recovery-meta.json"] },
  { name: "GEN-1", meta: ["agent/vault/GEN-1-ERA-META.json"] },
];
function loadEra(era) {
  for (const p of era.meta) {
    try { return { ...JSON.parse(fs.readFileSync(path.join(ENGINE, p), "utf8")), __name: era.name }; } catch { /* next path */ }
  }
  return null;
}
function candidatesFrom(era) { // decrypt (sha-pinned) -> candidate posting wifs; wipe after
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  const enc = fs.readFileSync(path.join(ENGINE, era.keysZipFile));
  const outerPin = String(era.keysZipSha256 ?? "");
  if (outerPin && sha256hex(enc) !== outerPin) throw new Error(era.__name + "-outer-sha-mismatch");
  fs.writeFileSync(path.join(TMP, "k.enc"), enc, { mode: 0o600 });
  execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
    "-in", path.join(TMP, "k.enc"), "-out", path.join(TMP, "inner.zip"),
    "-pass", "pass:" + era.keysZipPass], { stdio: ["ignore", "ignore", "pipe"] });
  const innerPin = String(era.keysZipInnerSha256 ?? "");
  const inner = fs.readFileSync(path.join(TMP, "inner.zip"));
  if (innerPin && sha256hex(inner) !== innerPin) throw new Error(era.__name + "-inner-sha-mismatch");
  execFileSync("unzip", ["-o", "-q", path.join(TMP, "inner.zip"), "agent/keys/vault.json", "-d", TMP],
    { stdio: ["ignore", "ignore", "pipe"] });
  const vault = JSON.parse(fs.readFileSync(path.join(TMP, "agent", "keys", "vault.json"), "utf8"));
  fs.rmSync(TMP, { recursive: true, force: true }); // wipe BEFORE any judging
  const acc = (vault.accounts ?? []).find((x) => x.username === ACCOUNT || x.name === ACCOUNT || x.account === ACCOUNT);
  if (!acc) throw new Error(era.__name + "-account-absent");
  const cands = [...(acc.gens ?? []).map((g) => ({ gen: String(g?.gen ?? era.__name + "?"), wif: String(g?.wif ?? "").trim() })),
    { gen: era.__name + "-flat", wif: String(acc?.keys?.steem?.posting?.wif ?? acc?.keys?.posting?.wif ?? "").trim() }]
    .filter((c) => c.wif.length >= 51);
  if (!cands.length) throw new Error(era.__name + "-no-posting-wif");
  return cands;
}

async function chainJudge(priv) { // noble takes the decoded key bytes directly
  const pub = Buffer.from(secp.getPublicKey(priv, true));
  const blt = "BLT" + b58checkEncode(pub);
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[ACCOUNT]] }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json();
  if (j.error) throw new Error(String(j.error?.message ?? "rpc").slice(0, 80));
  const live = j.result?.[0]?.posting?.key_auths?.[0]?.[0] ?? "";
  // blurt authority strings can carry a BROKEN base58 checksum (measured
  // 2026-10-11: live chk 04e2055c vs computed d4a396b2 on identical body) -
  // the lawful judge is the KEY BYTES, not the display string.
  const bodyOf = (s) => {
    let n2 = 0n;
    for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("b58"); n2 = n2 * 58n + BigInt(i); }
    let hx = n2.toString(16).padStart(2, "0");
    if (hx.length % 2) hx = "0" + hx;
    const raw = Buffer.from(hx, "hex");
    return raw.subarray(0, Math.max(0, raw.length - 4)); // strip checksum tail
  };
  const liveBody = live ? bodyOf(live.replace(/^[A-Z]{3}/, "")) : Buffer.alloc(0);
  const myBody = pub;
  return { blt, live, match: myBody.equals(liveBody) && liveBody.length === 33 };
}

if (!fs.existsSync(path.join(ENGINE, "agent"))) fail("ENGINE-TREE-ABSENT", ENGINE);
const secp = await import("@noble/secp256k1");
const tried = [];
let chosen = null;
for (const eraDef of ERAS) {
  const era = loadEra(eraDef);
  if (!era || !era.keysZipPass || !era.keysZipFile) { tried.push({ era: eraDef.name, skipped: "meta-absent" }); continue; }
  let cands;
  try { cands = candidatesFrom(era); } catch (e) { tried.push({ era: eraDef.name, err: String(e?.message ?? e).slice(0, 80) }); continue; }
  for (const c of cands) {
    let priv = null;
    try {
      priv = wifPriv(c.wif);
      tried.push({ gen: c.gen, decode: "ok", privLen: priv.length, isBuf: Buffer.isBuffer(priv) });
    } catch (e) { tried.push({ gen: c.gen, decode: "FAIL", err: String(e?.message ?? e).slice(0, 60) }); continue; }
    try {
      const j = await chainJudge(priv);
      tried.push({ gen: c.gen, judged: true, match: j.match, derived: j.blt, live: j.live });
      if (j.match) { chosen = c; break; }
    } catch (e) { tried.push({ gen: c.gen, judge: "FAIL", err: String(e?.message ?? e).slice(0, 60), ename: e?.name ?? null }); }
  }
  if (chosen) break;
}
if (!chosen) fail("NO-GEN-FITS-CHAIN", JSON.stringify(tried));
console.log(chosen.wif);
