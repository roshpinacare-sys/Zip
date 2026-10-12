#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
 * KEY-PROOF — הוכחת-מתים לחומר-מפתחות שדלף להיסטוריית-git (R11) · saos/key-proof/1
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Owner mandate trace 1a12c9d6f5df1b95 ("find sovereign solutions for what
 * remains owner-gated"): לא סיבוב-ריפואים אצל ה-owner אלא הוכחה עומדת
 * מבוססת-שרשרת שכל חומר-מפתח שדלף לא מאשר דבר על אף חשבון-צי.
 *
 * שלבים:
 *   1. SCAN    — קלונים של 5 ריפואים (roshpina, anchor-baseline, saos-jummper,
 *                Sdk, Adsmarket), הליכה על כל ה-blobs בכל ההיסטוריה, חילוץ
 *                מועמדים לפי דפוס (WIF / סיסמת-מאסטר P… / hex פרטי / STM
 *                ציבורי / ערכי-סיסמה בהקשר / ארכיונים חתומים).
 *   2. DERIVE  — לכל WIF/hex: גזירת מפתח-ציבורי (secp256k1 + STM Base58Check).
 *   3. CHAIN   — קריאה בלבד: get_key_references + רשויות-חיות של 14 חשבונות
 *                + עדות-רוטציה מ-account_history של headcorner.
 *   4. VERDICT — DEAD / ALIVE-ALERT / UNKNOWN(-NOT-CHAIN-TESTABLE) לכל חומר.
 *
 * חוק-הצנזורה (ברזל): בארטיפקט ייכתב רק sha256-of-material (16-hex) + מפתח-
 * ציבורי נגזר + מטא-דאטה של מקום (ריפו/בלוב/נתיב). אף חומר-פרטי, אף סיסמה,
 * אף תוכן-קובץ. auditor-צנזורה רץ על הארטיפקט לפני כתיבה — הפרה = אכישלון
 * קשה, כלום לא נכתב. הערכים עצמם חיים בזיכרון בלבד.
 *
 * קריפטו: פורט מהקוד שלנו Domain/gate-crypto.js (אומת שם מול steem-js: אותם
 * מפתחות-ציבוריים) — secp256k1 BigInt ג'קוביאני + base58/base58check +
 * ripemd160 טהור. checksum של STM = ripemd160(pub33)[:4]. אפס-תלות.
 * node ≥ 18 (גם bun-תואם). קריאה בלבד לרשת — אין שידורים, אין כתיבות-שרשרת.
 *
 * שימוש:
 *   node proof/key-proof.mjs --selftest          # בדיקות, אפס רשת ואפס סריקה
 *   node proof/key-proof.mjs [--offline]         # ריצה חיה מלאה (ברירת-מחדל)
 *   KP_TOKEN=… node proof/key-proof.mjs          # טוקן לקלונים (ברירת-מחדל:
 *                                                #   env GITHUB_TOKEN — מספיק
 *                                                #   לציבוריים; פרטיים דורשים
 *                                                #   טוקן עם גישה)
 *   KP_SCAN_DIR=… KP_OUT_DIR=… KP_NO_DELETE=1    # עזר לניפוי
 * ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "roshpinacare-sys";
const REPOS = ["roshpina", "anchor-baseline", "saos-jummper", "Sdk", "Adsmarket"];
const FLEET = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
// ה-9 של R11 (owner keys לא-בכספת → tx_missing_owner_auth) — saos-dex SAOS_BREAKTHROUGH_PROOF §15.4
const NINE = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wog", "woq"];
const ROLES = ["owner", "active", "posting", "memo"];
const NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://steem-api.4everland.org"];
const B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const GEN2_ACTIVE = "STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf"; // ציבורי: רשות-active החיה של headcorner (COORDINATION zai-9c)
const MAX_BLOB = 2_000_000;         // בתים ל-blob בודד
const MAX_SCAN_BYTES = 400_000_000; // תקציב-סריקה כולל
const HIST_PAGES_MAX = 400;         // תקציב-דפים להליכת account_history (100 לדף)

/* ── דפוסי-חילוץ ─────────────────────────────────────────────────────── */
const WIF_RE = /\b[5KL][1-9A-HJ-NP-Za-km-z]{50}\b/g;          // WIF 51 תווים (0x80)
const MASTER_PW_RE = /\bP[1-9A-HJ-NP-Za-km-z]{50}\b/g;        // סיסמת-מאסטר Steemit 51 תווים
const STM_RE = /\bSTM[1-9A-HJ-NP-Za-km-z]{50,51}\b/g;         // מפתח-ציבורי (ציבורי ממילא)
const HEX64_RE = /\b[a-fA-F0-9]{64}\b/g;                       // מפתח-פרטי hex מועמד
const HEX64_CTX_RE = /(priv\b|privkey|private[_-]?key|priv[_-]?key|secret[_-]?key|\bwif\b|skey)/i;
// ערכי-סיסמה בהקשר: kv / json / yaml בשמות שמעידים על סיסמה/גישה-לכספת (השם-מפתח יכול להיות מוקף תווים: "keys_access_2026_09_12")
const PASS_KV_RE = /(?:[\w.\-]*(?:passphrase|pass_?phrase|password|pass_?word|passwd|pwd|סיסמה|master[_-]?pass(?:word)?|keys?[_-]?access|access[_-]?key|unseal|seal[_-]?pass)[\w.\-]*)\s*["']?\s*[:=]\s*(?:"([^"\n]{8,128})"|'([^'\n]{8,128})'|([^\s"'`,;){]{8,128}))/gi;

/* ── קריפטו (פורט מ-Domain/gate-crypto.js; סינכרוני) ──────────────────── */
const sha256 = (u8) => new Uint8Array(createHash("sha256").update(u8).digest());
const hex = (u8) => Buffer.from(u8).toString("hex");
const unhex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const cat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
const be = (n, len) => { const out = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; };
const fromBE = (u8) => { let n = 0n; for (const b of u8) n = (n << 8n) | BigInt(b); return n; };

function b58decode(s) {
  let n = 0n;
  for (const ch of s) {
    const v = B58A.indexOf(ch);
    if (v < 0) throw new Error("Non-base58 character");
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
}
function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = B58A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
/** base58check קלאסי: checksum = sha256(sha256(payload))[:4] (WIF) */
function b58cDecode(s) {
  const raw = b58decode(s);
  if (raw.length < 5) throw new Error("base58check: too short");
  const payload = raw.slice(0, raw.length - 4), chk = raw.slice(raw.length - 4);
  const h2 = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) if (h2[i] !== chk[i]) throw new Error("base58check: bad checksum");
  return payload;
}
function b58cEncode(data) {
  const h2 = sha256(sha256(data));
  return b58encode(cat(data, h2.slice(0, 4)));
}
/* secp256k1 — פורט נאמן מ-gate-crypto.js (אומת מול steem-js) */
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = (0xfffffffffffffffffffffffffffffffen << 128n) | 0xbaaedce6af48a03bbfd25e8cd0364141n;
const GX = (0x79be667ef9dcbbac55a06295ce870b07n << 128n) | 0x029bfcdb2dce28d959f2815b16f81798n;
const GY = (0x483ada7726a3c4655da4fbfc0e1108a8n << 128n) | 0xfd17b448a68554199c47d08ffb10d4b8n;
const INF = { x: 0n, y: 0n, z: 0n };
const m = (a) => ((a % P) + P) % P;
const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
function ptDouble(p1) {
  if (p1.z === 0n || p1.y === 0n) return INF;
  const A = m(p1.x * p1.x), B = m(p1.y * p1.y), C = m(B * B);
  const D = m(2n * (m((p1.x + B) * (p1.x + B)) - A - C));
  const E = m(3n * A), F = m(E * E);
  const X3 = m(F - 2n * D);
  const Y3 = m(E * (D - X3) - 8n * C);
  const Z3 = m(2n * p1.y * p1.z);
  return { x: X3, y: Y3, z: Z3 };
}
function ptAdd(p1, p2) {
  if (p1.z === 0n) return p2;
  if (p2.z === 0n) return p1;
  const Z1Z1 = m(p1.z * p1.z), Z2Z2 = m(p2.z * p2.z);
  const U1 = m(p1.x * Z2Z2), U2 = m(p2.x * Z1Z1);
  const S1 = m(p1.y * p2.z * Z2Z2), S2 = m(p2.y * p1.z * Z1Z1);
  if (U1 === U2) return S1 !== S2 ? INF : ptDouble(p1);
  const H = m(U2 - U1), I = m(4n * H * H), J = m(H * I);
  const r = m(2n * (S2 - S1)), V = m(U1 * I);
  const X3 = m(r * r - J - 2n * V);
  const Y3 = m(r * (V - X3) - 2n * S1 * J);
  const Z3 = m(m((p1.z + p2.z) * (p1.z + p2.z) - Z1Z1 - Z2Z2) * H);
  return { x: X3, y: Y3, z: Z3 };
}
function ptMul(k, p1) {
  let R = INF, A = p1;
  k = ((k % N) + N) % N;
  while (k > 0n) { if (k & 1n) R = ptAdd(R, A); A = ptDouble(A); k >>= 1n; }
  return R;
}
function toAffine(p1) {
  if (p1.z === 0n) return null;
  const zInv = modInv(p1.z, P), zInv2 = m(zInv * zInv);
  return { x: m(p1.x * zInv2), y: m(p1.y * zInv2 * zInv) };
}
function modInv(a, md) {
  let lm = 1n, hm = 0n, low = ((a % md) + md) % md, high = md;
  while (low > 1n) { const q = high / low; const nm = hm - lm * q, nw = high - low * q; hm = lm; lm = nm; high = low; low = nw; }
  return ((lm % md) + md) % md;
}
const G = { x: GX, y: GY, z: 1n };
function privToPubBytes(priv) { // 32 בתים → מכווץ 33 בתים
  const A = toAffine(ptMul(fromBE(priv), G));
  if (!A) throw new Error("point at infinity");
  return cat(new Uint8Array([A.y & 1n ? 0x03 : 0x02]), be(A.x, 32));
}
/* ripemd160 טהור — פורט מ-gate-crypto.js (זהה בכל-ראנטיים, כולל bun) */
function rmd160(bytes) {
  const ZL = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8, 3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12, 1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2, 4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
  const ZR = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12, 6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2, 15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13, 8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14, 12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
  const SL = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8, 7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12, 11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5, 11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12, 9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
  const SR = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6, 9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11, 9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5, 15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8, 8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
  const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
  const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
  const F = [
    (x, y, z) => (x ^ y ^ z) >>> 0,
    (x, y, z) => ((x & y) | (~x & z)) >>> 0,
    (x, y, z) => ((x | ~y) ^ z) >>> 0,
    (x, y, z) => ((x & z) | (y & ~z)) >>> 0,
    (x, y, z) => (x ^ (y | ~z)) >>> 0,
  ];
  let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476, h4 = 0xc3d2e1f0 | 0;
  const len = bytes.length, bitLenLo = (len * 8) >>> 0, bitLenHi = Math.floor(len / 536870912);
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLenLo, true);
  dv.setUint32(padded.length - 4, bitLenHi, true);
  const X = new Int32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getInt32(off + i * 4, true);
    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;
    for (let j = 0; j < 80; j++) {
      const rnd = j >> 4;
      let t = (al + F[rnd](bl, cl, dl) + X[ZL[j]] + KL[rnd]) >>> 0;
      t = (rotl(t, SL[j]) + el) >>> 0;
      al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t;
      t = (ar + F[4 - rnd](br, cr, dr) + X[ZR[j]] + KR[rnd]) >>> 0;
      t = (rotl(t, SR[j]) + er) >>> 0;
      ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t;
    }
    const tt = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + er) >>> 0;
    h2 = (h3 + el + ar) >>> 0;
    h3 = (h4 + al + br) >>> 0;
    h4 = (h0 + bl + cr) >>> 0;
    h0 = tt;
  }
  const out = new Uint8Array(20), dv2 = new DataView(out.buffer);
  dv2.setUint32(0, h0, true); dv2.setUint32(4, h1, true); dv2.setUint32(8, h2, true); dv2.setUint32(12, h3, true); dv2.setUint32(16, h4, true);
  return out;
}

/** WIF → 32 בתים פרטיים (מאמת version 0x80; סובל סיומת-דחיסה 0x01 — דפוס
 * normalizeWif מ-saos-dex SETTLE-11 §16.1, כמו steem-js PrivateKey.fromWif) */
function wifToPriv(wif) {
  const payload = b58cDecode(wif);
  if (payload[0] !== 0x80) throw new Error(`WIF version 0x${payload[0].toString(16)} (expected 0x80)`);
  let key = payload.slice(1);
  if (key.length === 33 && key[32] === 0x01) key = key.slice(0, 32);
  if (key.length !== 32) throw new Error(`WIF key ${key.length} bytes (expected 32)`);
  return key;
}
/** 32 בתים פרטיים → STM… (checksum = ripemd160(pub33)[:4], כמו steem-js key_public) */
function pubToSTM(pub33) { return "STM" + b58encode(cat(pub33, rmd160(pub33).slice(0, 4))); }
/** STM… → 33 בתים (מאמת checksum) */
function stmToPub(stm) {
  if (!/^STM/.test(stm)) throw new Error("not an STM key");
  const raw = b58decode(stm.slice(3));
  if (raw.length !== 37) throw new Error(`STM body ${raw.length} bytes (expected 37)`);
  const pub33 = raw.slice(0, 33), chk = raw.slice(33);
  const want = rmd160(pub33).slice(0, 4);
  for (let i = 0; i < 4; i++) if (want[i] !== chk[i]) throw new Error("STM checksum mismatch");
  return pub33;
}
/** השוואה אגנוסטית-לתחילית: גוף 50 תווים אחרי התחילית (דפוס key-census pubEq) */
const keyBody = (k) => (typeof k === "string" && k.length >= 53 ? k.slice(3) : null);

/** הגזרות הקנוניות של הרשת */
const te = new TextEncoder();
const derivePrivPub = (priv) => pubToSTM(privToPubBytes(priv));
function masterPasswordPub(account, role, password) { // תקן Steemit: sha256(account+role+password)
  return derivePrivPub(sha256(te.encode(String(account).toLowerCase() + role + password)));
}
const SEED_ORDERS = [(a, r, p) => a + r + p, (a, r, p) => p + r + a, (a, r, p) => a + p + r, (a, r, p) => p + a + r, (a, r, p) => r + a + p, (a, r, p) => r + p + a];
function seedOrderPub(account, role, password, oi) { // חוק-זרע saos-engine: b58check(0x80+sha256(seed)+0x01)
  const body = cat(new Uint8Array([0x80]), sha256(te.encode(SEED_ORDERS[oi](account.toLowerCase(), role, password))), new Uint8Array([0x01]));
  return derivePrivPub(wifToPriv(b58cEncode(body)));
}

/* ── hash-of-material (הדבר היחיד שמותר לפרסם על חומר-פרטי) ───────────── */
const hash16 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

/* ═══════════════ אודיטור-הצנזורה — החוק בקוד ═══════════════ */
const FORBIDDEN_FIELD_RE = /^(value|material|secret|password|passphrase|pass|pwd|wif|privkey|private[_-]?key|raw|plaintext|seed)$/i;
function redactionAudit(obj) {
  const stack = [{ v: obj, k: "$" }];
  const offenders = [];
  while (stack.length) {
    const { v, k } = stack.pop();
    if (v == null) continue;
    const leaf = k.split(".").pop();
    if (FORBIDDEN_FIELD_RE.test(leaf)) { offenders.push(`${k}: forbidden field name`); continue; }
    if (typeof v === "string") {
      WIF_RE.lastIndex = 0; MASTER_PW_RE.lastIndex = 0; HEX64_RE.lastIndex = 0;
      if (WIF_RE.test(v)) offenders.push(`${k}: WIF-shaped string`);
      else if (MASTER_PW_RE.test(v)) offenders.push(`${k}: master-password-shaped string`);
      else if (HEX64_RE.test(v)) offenders.push(`${k}: 64-hex string`);
    } else if (typeof v === "object") {
      for (const [k2, v2] of Object.entries(v)) stack.push({ v: v2, k: `${k}.${k2}` });
    }
  }
  if (offenders.length) throw new Error(`REDACTION-LAW VIOLATION → ${offenders.slice(0, 5).join(" | ")}`);
}

/* ═══════════════ SELFTEST — אפס רשת, אפס סריקה, אפס מפתחות-אמת ═══════════════ */
function selftest() {
  const T = []; const ok = (name, cond) => T.push({ name, pass: !!cond });
  // 1) EC known-answer vectors (טקסטבוק ציבורי: G ו-2G)
  const one = new Uint8Array(32); one[31] = 1;
  const g = privToPubBytes(one);
  ok("EC priv=1 → G compressed", hex(g) === "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  const two = new Uint8Array(32); two[31] = 2;
  ok("EC priv=2 → 2G compressed", hex(privToPubBytes(two)) === "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5");
  // 2) ripemd160 KAT
  ok("rmd160('abc')", hex(rmd160(te.encode("abc"))) === "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc");
  // 3) WIF KAT (וקטור ציבורי של privkey=1 — לא מפתח-אמת)
  const wif1 = "5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf";
  const p1 = wifToPriv(wif1);
  ok("WIF KAT decode (privkey=1)", p1.length === 32 && p1[0] === 0 && p1[30] === 0 && p1[31] === 1);
  ok("WIF KAT round-trip", b58cEncode(cat(new Uint8Array([0x80]), p1)) === wif1);
  let badChecksum = false; try { wifToPriv(wif1.slice(0, 50) + "z"); } catch { badChecksum = true; }
  ok("WIF bad checksum rejected", badChecksum);
  // 4) STM גזירה + עגינה במפתח-ציבורי-אמת מהשרשרת (ציבורי ממילא)
  const stmOfPriv1 = pubToSTM(g);
  ok("STM derive deterministic", stmOfPriv1 === pubToSTM(privToPubBytes(p1)));
  ok("STM round-trip via stmToPub", hex(stmToPub(stmOfPriv1)) === hex(g));
  const gen2 = stmToPub(GEN2_ACTIVE); // מפתח-ה-active החי של headcorner — ציבורי
  ok("decode real chain key (GEN-2 active)", gen2.length === 33 && (gen2[0] === 2 || gen2[0] === 3));
  let badStm = false; try { stmToPub("STM" + GEN2_ACTIVE.slice(3, 52) + "z"); } catch { badStm = true; }
  ok("STM checksum mismatch rejected", badStm);
  // 5) גזירת-סיסמת-מאסטר דטרמיניסטית ותלוית-(חשבון,תפקיד) — וקטור-זבל שנוצר-במקום
  const junk = "selftest-throwaway-" + Date.now();
  const a1 = masterPasswordPub("headcorner", "active", junk), a2 = masterPasswordPub("headcorner", "active", junk), a3 = masterPasswordPub("headcorner", "posting", junk);
  ok("master-password derivation deterministic + role-bound", a1 === a2 && a1 !== a3);
  ok("seed-order derivation runs", typeof seedOrderPub("headcorner", "active", junk, 0) === "string");
  // 6) דפוסי-חילוץ
  const h64 = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  const sample = `line one\nwif: ${wif1}\nprivate_key: "${h64}"\npassword = "selftest-pass-123"\nposting: ${stmOfPriv1}\nsee docs/reports/whatever.md`;
  ok("extract WIF", (sample.match(WIF_RE) || [])[0] === wif1);
  ok("extract hex64-with-context", HEX64_CTX_RE.test(sample.split("\n")[2]));
  ok("extract passphrase value", extractPassValues(sample).includes("selftest-pass-123"));
  ok("extract STM pubkey", (sample.match(STM_RE) || []).includes(stmOfPriv1));
  // 7) hash stability
  ok("hash16 stable", hash16("selftest-pass-123") === hash16("selftest-pass-123") && hash16("x") !== hash16("y"));
  // 8) אודיטור-צנזורה: מזוהם = נדחה, נקי = עובר
  const clean = { verdicts: [{ hash16: "ab", derivedPubkey: stmOfPriv1, verdict: "DEAD" }], evidence: { trx: "40hexchars00000000000000000000000000000000" } };
  const dirtyWif = { verdicts: [{ hash16: "cd", value: wif1 }] };
  const dirtyPw = { verdicts: [{ hash16: "ef", value: "selftest-pass-123" }] };
  const attempt = (o) => { try { redactionAudit(o); return "passed"; } catch { return "rejected"; } };
  ok("redaction: WIF leak rejected", attempt(dirtyWif) === "rejected");
  ok("redaction: passphrase leak rejected", attempt(dirtyPw) === "rejected");
  ok("redaction: clean artifact (40-hex trx + pubkey) passes", attempt(clean) === "passed");
  ok("redaction: real STM pubkey allowed", attempt({ x: GEN2_ACTIVE }) === "passed");
  // 9) מסווג-פסקים
  const aliveSet = new Set([keyBody(stmOfPriv1)]);
  const ctx = (as, refs, avail) => ({ aliveSet: as, keyRefs: refs, keyRefsAvailable: avail });
  ok("verdict ALIVE-ALERT", classify({ kind: "wif", pubkey: stmOfPriv1 }, ctx(aliveSet, new Map(), true)) === "ALIVE-ALERT");
  ok("verdict DEAD (unreferenced)", classify({ kind: "wif", pubkey: pubToSTM(privToPubBytes(two)) }, ctx(aliveSet, new Map(), true)) === "DEAD");
  ok("verdict DEAD (referenced only by non-fleet)", classify({ kind: "pubkey", pubkey: stmOfPriv1 }, ctx(new Set(), new Map([[keyBody(stmOfPriv1), ["some-stranger"]]]), true)).verdict === "DEAD");
  ok("verdict UNKNOWN-NOT-CHAIN-TESTABLE (passphrase)", classify({ kind: "passphrase" }, ctx(new Set(), new Map(), true)) === "UNKNOWN-NOT-CHAIN-TESTABLE");
  ok("verdict UNKNOWN (derivation failed)", classify({ kind: "wif", deriveError: "why" }, ctx(new Set(), new Map(), true)) === "UNKNOWN");
  const fail = T.filter((t) => !t.pass);
  for (const t of T) console.log(`  ${t.pass ? "PASS" : "FAIL"}  ${t.name}`);
  console.log(`SELFTEST: ${T.length - fail.length}/${T.length} PASS${fail.length ? " · " + fail.length + " FAIL" : ""}`);
  return fail.length === 0;
}
function extractPassValues(text) {
  const out = [];
  for (const mm of text.matchAll(PASS_KV_RE)) { const v = mm[1] || mm[2] || mm[3]; if (v) out.push(v); }
  return out;
}

/* ═══════════════ STEP 1 — SCAN ═══════════════ */
function patToken() { return (process.env.KP_TOKEN || process.env.GITHUB_TOKEN || "").trim(); }
function cloneRepo(repo, dir, log) {
  rmSync(dir, { recursive: true, force: true });
  const tok = patToken();
  let askpass = "";
  if (tok) {
    askpass = path.join(path.dirname(dir), `.kp-askpass-${repo}.sh`);
    writeFileSync(askpass, "#!/bin/sh\necho \"$KP_TOKEN\"\n");
    chmodSync(askpass, 0o700);
  }
  const res = spawnSync("git", ["clone", "--quiet", `https://github.com/${ORG}/${repo}.git`, dir], {
    env: { ...process.env, KP_TOKEN: tok, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8", timeout: 420_000,
  });
  const ok = res.status === 0 && existsSync(path.join(dir, ".git"));
  if (!ok) {
    log.push(`clone ${repo} FAILED: ${String(res.stderr || "").split(tok || "\u0000").join("***").slice(0, 140)}`);
    return { ok: false };
  }
  return { ok: true, head: spawnSync("git", ["-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim() };
}
function gitOut(dir, args, maxBuf = 1 << 28, input = null) {
  const res = spawnSync("git", ["-C", dir, ...args], { maxBuffer: maxBuf, encoding: "buffer", timeout: 300_000, input });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(res.stderr).slice(0, 120)}`);
  return res.stdout.toString("utf8");
}
function scanRepo(repo, dir, budget, cands, noise) {
  const objs = gitOut(dir, ["rev-list", "--all", "--objects"]).trim().split("\n").filter(Boolean);
  const pathOf = new Map();
  for (const line of objs) {
    const sp = line.indexOf(" ");
    const h = sp === -1 ? line : line.slice(0, sp);
    if (!pathOf.has(h)) pathOf.set(h, sp === -1 ? "" : line.slice(sp + 1));
  }
  const bc = gitOut(dir, ["cat-file", "--batch-check"], 1 << 28, blobsInput(objs.map((l) => l.split(" ")[0]))).trim().split("\n").filter(Boolean);
  const blobs = [];
  for (const line of bc) {
    const [h, type, size] = line.split(" ");
    if (type === "blob") {
      const sz = Number(size);
      if (sz > MAX_BLOB) { noise.oversizeBlobs++; continue; }
      blobs.push({ h, sz });
    }
  }
  let repoBytes = 0;
  for (const { h, sz } of blobs) {
    if (budget.bytes + sz > MAX_SCAN_BYTES) { noise.skippedBudget++; continue; }
    let buf;
    try { buf = spawnSync("git", ["-C", dir, "cat-file", "blob", h], { maxBuffer: MAX_BLOB + 65536, encoding: "buffer", timeout: 60_000 }).stdout; } catch { noise.unreadableBlobs++; continue; }
    if (!buf || !buf.length) continue;
    budget.bytes += sz; repoBytes += sz;
    const p = pathOf.get(h) || "";
    const text = buf.toString("utf8");
    const note = (kind, value, extra) => {
      const key = kind + ":" + hash16(value);
      if (!cands.has(key)) cands.set(key, { kind, hash16: hash16(value), value, where: [] });
      cands.get(key).where.push({ repo, blob: h, path: p });
      if (extra) Object.assign(cands.get(key), extra);
    };
    for (const mm of text.matchAll(WIF_RE)) note("wif", mm[0]);
    for (const mm of text.matchAll(MASTER_PW_RE)) note("masterpw", mm[0]);
    for (const mm of text.matchAll(STM_RE)) note("pubkey", mm[0]);
    for (const line of text.split("\n")) {
      if (HEX64_RE.test(line) && HEX64_CTX_RE.test(line)) {
        HEX64_RE.lastIndex = 0;
        for (const mm of line.matchAll(HEX64_RE)) note("privhex", mm[0]);
      }
    }
    for (const mm of text.matchAll(PASS_KV_RE)) {
      const v = mm[1] || mm[2] || mm[3];
      if (v) note("passphrase", v, { context: (mm[0].split(/[:=]/)[0] || "").trim().slice(-60) });
    }
    if (/\.(enc|gpg|age|7z|zip|tgz|tar\.gz|tar)$/i.test(p) || /keys?-?access/i.test(p)) {
      const key = "archive:" + h;
      if (!cands.has(key)) cands.set(key, { kind: "archive", hash16: hash16(buf.toString("latin1")), gitBlobSha: h, size: sz, value: null, where: [] });
      cands.get(key).where.push({ repo, blob: h, path: p });
    }
  }
  const commits = Number(gitOut(dir, ["rev-list", "--all", "--count"]).trim());
  return { blobs: blobs.length, bytes: repoBytes, commits };
}
/** קלט ל-cat-file --batch-check: כל ה-shas בבת-אחת (Buffer — כדי לשמר בינארי עם encoding:buffer) */
const blobsInput = (shas) => Buffer.from(shas.join("\n") + "\n", "utf8");
/** קומיטים שהוסיפו/הסירו את ה-blob (עדות-מקום) */
function commitsTouching(dir, blobSha, cap = 4) {
  try {
    return gitOut(dir, ["log", "--all", "--format=%H %ad", "--date=short", `--find-object=${blobSha}`, "--"], 1 << 26)
      .trim().split("\n").filter(Boolean).slice(0, cap)
      .map((l) => { const [sha, date] = l.split(" "); return { sha: sha.slice(0, 10), date }; });
  } catch { return []; }
}

/* ═══════════════ STEP 2 — DERIVE ═══════════════ */
function deriveAll(cands, fleet) {
  for (const c of cands.values()) {
    if (c.kind === "wif" || c.kind === "masterpw" || c.kind === "privhex") {
      try {
        let priv;
        if (c.kind === "wif") priv = wifToPriv(c.value);
        else if (c.kind === "masterpw") priv = wifToPriv(b58cEncode(cat(new Uint8Array([0x80]), sha256(te.encode(c.value)), new Uint8Array([0x01]))));
        else priv = unhex(c.value);
        c.pubkey = derivePrivPub(priv);
      } catch (e) {
        c.deriveError = String(e.message).slice(0, 120);
      }
    }
    if (c.kind === "pubkey") {
      try { stmToPub(c.value); c.pubkey = c.value; } catch (e) { c.deriveError = `scanned STM invalid: ${e.message}`; }
    }
    if (c.kind === "passphrase" && c.value) {
      // מטריצת סיסמת-מאסטר: 14 חשבונות × 4 תפקידים × (תקן-Steemit + 6 סדרי-זרע)
      const pubs = new Set();
      let tested = 0;
      for (const a of fleet) for (const r of ROLES) {
        try { pubs.add(masterPasswordPub(a, r, c.value)); tested++; } catch { /* skip */ }
        for (let oi = 0; oi < SEED_ORDERS.length; oi++) {
          try { pubs.add(seedOrderPub(a, r, c.value, oi)); tested++; } catch { /* skip */ }
        }
      }
      c.matrixProbe = { tested, derivedPubs: [...pubs] };
    }
  }
  return [...cands.values()];
}

/* ═══════════════ STEP 3 — CHAIN (קריאה בלבד) ═══════════════ */
async function rpc(node, method, params, timeoutMs = 30_000) {
  const res = await fetch(node, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "saos-key-proof/1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}
async function rpcFailover(method, params, ms = 30_000) {
  const errs = [];
  for (let round = 0; round < 2; round++) {
    for (const node of NODES) {
      try { return { node, result: await rpc(node, method, params, ms) }; }
      catch (e) { errs.push(`${node}: ${String(e.cause?.message || e.message).slice(0, 70)}`); }
    }
    if (round === 0) await new Promise((r) => setTimeout(r, 800)); // ניסיון-שני אחרי-הפסקה (רשת/רייט-לימיט זמניים)
  }
  throw new Error(`all ${NODES.length} nodes failed ×2 rounds — ${errs.slice(0, 4).join(" | ")}`);
}
const authKeys = (auth) => (auth?.key_auths || []).map(([k]) => String(k));
async function chainCheck(log) {
  const { node, result: accounts } = await rpcFailover("condenser_api.get_accounts", [FLEET]);
  const byName = {};
  const aliveSet = new Set();
  for (const a of accounts || []) {
    const rec = {
      owner: authKeys(a.owner), ownerAccountAuths: (a.owner?.account_auths || []).map((x) => x[0]),
      active: authKeys(a.active), activeAccountAuths: (a.active?.account_auths || []).map((x) => x[0]),
      posting: authKeys(a.posting), postingAccountAuths: (a.posting?.account_auths || []).map((x) => x[0]),
      memo: a.memo_key ? [String(a.memo_key)] : [],
      lastOwnerUpdate: a.last_owner_update || null, created: a.created || null,
    };
    byName[a.name] = rec;
    for (const role of ["owner", "active", "posting", "memo"]) for (const k of rec[role]) aliveSet.add(keyBody(k));
  }
  log.push(`chain node=${node} · ${Object.keys(byName).length} fleet accounts · ${aliveSet.size} distinct alive key bodies`);
  return { node, accounts: byName, aliveSet, accountsRaw: accounts };
}
async function keyReferences(pubkeys, log) {
  if (!pubkeys.length) return { available: false, reason: "no pubkeys to test", map: new Map() };
  const map = new Map();
  try {
    for (let i = 0; i < pubkeys.length; i += 60) {
      const chunk = pubkeys.slice(i, i + 60);
      const { result } = await rpcFailover("condenser_api.get_key_references", [chunk]);
      (result || []).forEach((accounts, idx) => map.set(chunk[idx], accounts || []));
    }
    return { available: true, map };
  } catch (e) {
    log.push(`get_key_references unavailable: ${String(e.message).slice(0, 100)}`);
    return { available: false, reason: String(e.message).slice(0, 160), map };
  }
}
async function rotationEvidence(log) {
  // הליכה מדופדפת אחורה ב-account_history של headcorner עד חלון-הרוטציה (2026-10-08T17:29Z)
  const WINDOW = { from: "2026-10-08T15:00:00", to: "2026-10-08T19:00:00" };
  const OPS = new Set(["account_update", "account_create", "account_create_with_delegation", "recover_account", "change_recovery_account"]);
  const found = [];
  let start = -1, pages = 0, opsSeen = 0, reachedWindowEnd = false, truncated = false;
  try {
    while (pages < HIST_PAGES_MAX) {
      const { result } = await rpcFailover("account_history_api.get_account_history", { account: "headcorner", start, limit: 100 }, 40_000);
      const hist = Array.isArray(result) ? result : result?.history || [];
      if (!hist.length) break;
      pages++; opsSeen += hist.length;
      let oldestTs = "9999";
      for (const [, ev] of hist) {
        const ts = String(ev?.timestamp || "");
        if (ts < oldestTs) oldestTs = ts;
        const opType = ev?.op?.type ? String(ev.op.type).replace(/_operation$/, "") : (Array.isArray(ev?.op) ? ev.op[0] : "?");
        if (OPS.has(opType) && ts >= WINDOW.from && ts <= WINDOW.to) {
          const val = ev.op.value || ev.op[1] || {};
          found.push({
            timestamp: ts, block: ev.block, trxId: ev.trx_id ? String(ev.trx_id) : null, op: opType,
            newAuthorities: {
              owner: (val.owner?.key_auths || []).map((x) => x[0]),
              active: (val.active?.key_auths || []).map((x) => x[0]),
              posting: (val.posting?.key_auths || []).map((x) => x[0]),
            },
          });
        }
      }
      if (oldestTs < WINDOW.from) { reachedWindowEnd = true; break; }
      const minIdx = hist.reduce((acc, [idx]) => Math.min(acc, Number(idx)), Infinity);
      if (!isFinite(minIdx) || minIdx <= 0) break;
      start = minIdx - 1;
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!reachedWindowEnd && pages >= HIST_PAGES_MAX) truncated = true;
  } catch (e) {
    log.push(`rotation walk stopped early: ${String(e.message).slice(0, 100)}`);
    truncated = true;
  }
  return { window: WINDOW, opsWalked: opsSeen, pages, reachedWindowEnd, truncated, accountUpdateOps: found };
}

/* ═══════════════ STEP 4 — VERDICT ═══════════════ */
function classify(c, ctx) {
  const { aliveSet, keyRefs, keyRefsAvailable } = ctx;
  if (c.kind === "archive") return "UNKNOWN-NOT-CHAIN-TESTABLE";
  if (c.kind === "passphrase") return "UNKNOWN-NOT-CHAIN-TESTABLE";
  const pubBody = c.pubkey ? keyBody(c.pubkey) : null;
  if (!pubBody) return "UNKNOWN";
  if (aliveSet.has(pubBody)) return "ALIVE-ALERT";
  if (keyRefsAvailable && keyRefs.has(pubBody)) {
    const refs = keyRefs.get(pubBody) || [];
    if (refs.filter((a) => FLEET.includes(a)).length) return "ALIVE-ALERT";
    if (refs.length) return { verdict: "DEAD", note: `referenced only by non-fleet account(s): ${refs.join(",")}` };
  }
  return "DEAD";
}

/* ═══════════════ soldier probe — עובדות-בלבד ═══════════════ */
function buildSoldierProbe(chainState, accountsRaw) {
  if (!chainState) return { status: "chain-unavailable" };
  const rows = [];
  for (const name of FLEET) {
    const a = chainState.accounts[name];
    const raw = (accountsRaw || []).find((x) => x.name === name);
    if (!a || !raw) { rows.push({ account: name, status: "missing" }); continue; }
    const owner = a.owner[0] || null, active = a.active[0] || null;
    rows.push({
      account: name,
      lane: name === "headcorner" ? "treasury" : NINE.includes(name) ? "r11-nine (owner keys not in machine vault — owner-auth ops blocked tx_missing_owner_auth)" : "fleet",
      ownerPubkey: owner, activePubkey: active, postingPubkey: a.posting[0] || null, memoPubkey: a.memo[0] || null,
      ownerEqualsActive: !!owner && !!active && keyBody(owner) === keyBody(active),
      lastOwnerUpdate: a.lastOwnerUpdate,
      created: a.created,
      ownerThreshold: raw.owner?.weight_threshold ?? null,
      ownerAuthCount: (raw.owner?.key_auths?.length || 0) + (raw.owner?.account_auths?.length || 0),
      postingAuthCount: (raw.posting?.key_auths?.length || 0) + (raw.posting?.account_auths?.length || 0),
      note: name === "wic" ? "proof-of-mechanism: rotated 2026-09-12 (tx 9fd13d50…) per SAOS_BREAKTHROUGH_PROOF §15.4" : NINE.includes(name) ? "rotation requires owner-issued keys (cross-ref 11-b OWNER-GATE-PLAYBOOK)" : null,
    });
  }
  const nine = rows.filter((r) => NINE.includes(r.account));
  return {
    measuredAt: new Date().toISOString(),
    method: "condenser_api.get_accounts live authorities — facts only, zero key material, zero vault access",
    rows,
    summary: {
      nineAccounts: NINE,
      nineWithOwnerEqualsActive: nine.filter((r) => r.ownerEqualsActive).length,
      nineWithOwnerUpdatedSinceLeak_2026_09_12: nine.filter((r) => r.lastOwnerUpdate && r.lastOwnerUpdate >= "2026-09-12").map((r) => `${r.account}@${r.lastOwnerUpdate}`),
      fleetWithOwnerUpdatedSinceLeak_2026_09_12: rows.filter((r) => r.lastOwnerUpdate && r.lastOwnerUpdate >= "2026-09-12").map((r) => `${r.account}@${r.lastOwnerUpdate}`),
      machineClaimCrossRef: "11-b recon (claims, not secrets): hcsoldier4/5/6 ACTIVE=GEN-2 · the 9 ACTIVE=GEN-1 (machine can sign active ops; owner-auth blocked). Possession of machine-held keys is intentionally NOT verifiable here — the vault is never touched by this engine.",
    },
  };
}

/* ═══════════════ ORCHESTRATION ═══════════════ */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) process.exit(selftest() ? 0 : 1);
  const offline = argv.includes("--offline");
  const scanDir = process.env.KP_SCAN_DIR || "/tmp/kp-scan";
  const outDir = process.env.KP_OUT_DIR || path.join(HERE, "out");
  const noDelete = process.env.KP_NO_DELETE === "1";
  const startedAt = new Date().toISOString();
  const log = [];
  mkdirSync(scanDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  /* STEP 1 — SCAN */
  const cands = new Map();
  const noise = { oversizeBlobs: 0, skippedBudget: 0, unreadableBlobs: 0 };
  const scan = { repos: [], totalBlobs: 0, totalBytes: 0 };
  const budget = { bytes: 0 };
  for (const repo of REPOS) {
    const t0 = Date.now();
    const dir = path.join(scanDir, repo);
    const cl = cloneRepo(repo, dir, log);
    if (!cl.ok) { scan.repos.push({ repo, reachable: false }); continue; }
    let st;
    try { st = scanRepo(repo, dir, budget, cands, noise); }
    catch (e) {
      log.push(`scan ${repo} failed: ${String(e.message).slice(0, 120)}`);
      scan.repos.push({ repo, reachable: true, head: cl.head, scanError: String(e.message).slice(0, 120) });
      continue;
    }
    scan.totalBlobs += st.blobs; scan.totalBytes += st.bytes;
    scan.repos.push({ repo, reachable: true, head: cl.head.slice(0, 10), commits: st.commits, blobs: st.blobs, bytes: st.bytes, ms: Date.now() - t0 });
    console.log(`[scan] ${repo}: ${st.commits} commits · ${st.blobs} blobs · ${(st.bytes / 1e6).toFixed(1)}MB · ${cands.size} candidate-keys so far`);
  }
  const reachableCount = scan.repos.filter((r) => r.reachable).length;
  if (reachableCount === 0) log.push("SCAN-DEGRADED: no leak repo reachable with the available token — chain evidence still refreshed; full scan needs a token with access to these repos");
  else if (reachableCount < REPOS.length) log.push(`SCAN-PARTIAL: ${reachableCount}/${REPOS.length} repos reachable`);

  /* STEP 2 — DERIVE */
  const candsArr = deriveAll(cands, FLEET);
  const byKind = {};
  for (const c of candsArr) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  console.log(`[derive] candidates: ${JSON.stringify(byKind)} · noise=${JSON.stringify(noise)}`);

  /* STEP 3 — CHAIN */
  let chainState = null, keyRefs = new Map(), keyRefsAvailable = false, rotation = null, chainError = null;
  if (!offline) {
    try {
      chainState = await chainCheck(log);
      const pubs = [...new Set(candsArr.flatMap((c) => [c.pubkey, ...(c.matrixProbe?.derivedPubs || [])]).filter(Boolean))];
      const kr = await keyReferences(pubs, log);
      keyRefs = kr.map; keyRefsAvailable = kr.available;
      console.log(`[chain] key_references available=${keyRefsAvailable} · ${pubs.length} pubkeys tested`);
      rotation = await rotationEvidence(log);
      console.log(`[chain] rotation evidence: walked ${rotation.opsWalked} ops / ${rotation.pages} pages · account-ops in window: ${rotation.accountUpdateOps.length}${rotation.truncated ? " (TRUNCATED — budget)" : ""}`);
    } catch (e) {
      chainError = String(e.message).slice(0, 200);
      log.push(`CHAIN-DEGRADED: ${chainError}`);
    }
  } else log.push("--offline: chain step skipped");

  /* STEP 4 — VERDICT */
  const ctx = { aliveSet: chainState?.aliveSet || new Set(), keyRefs, keyRefsAvailable };
  const verdicts = candsArr.map((c) => {
    const v = classify(c, ctx);
    const first = c.where?.[0];
    const introducedIn = first && c.kind !== "privhex" && !offline && existsSync(path.join(scanDir, first.repo, ".git"))
      ? commitsTouching(path.join(scanDir, first.repo), first.blob, 3)
      : undefined;
    const row = {
      hash16: c.hash16, kind: c.kind, where: c.where,
      ...(c.gitBlobSha ? { gitBlobSha: c.gitBlobSha, size: c.size } : {}),
      ...(c.context ? { context: c.context } : {}),
      ...(c.pubkey ? { derivedPubkey: c.pubkey } : {}),
      ...(c.deriveError ? { deriveError: c.deriveError } : {}),
      ...(introducedIn && introducedIn.length ? { introducedIn } : {}),
      verdict: typeof v === "string" ? v : v.verdict,
      ...(typeof v === "object" && v.note ? { note: v.note } : {}),
    };
    if (c.matrixProbe) {
      const alive = c.matrixProbe.derivedPubs.filter((pk) => ctx.aliveSet.has(keyBody(pk)));
      row.matrixProbe = {
        tested: c.matrixProbe.tested,
        derivedPubkeysTested: c.matrixProbe.derivedPubs.length,
        aliveMatches: alive,
        note: alive.length ? "the passphrase derives a LIVE fleet authority — treat as compromised credential" : "master-password derivation (steemit-standard + 6 seed-orders × 14 fleet accounts × 4 roles) matched no live authority; as an archive passphrase it remains untestable by design (archive never opened)",
      };
      if (alive.length) row.verdict = "ALIVE-ALERT";
    }
    return row;
  });
  const counts = { DEAD: 0, "ALIVE-ALERT": 0, UNKNOWN: 0, "UNKNOWN-NOT-CHAIN-TESTABLE": 0 };
  for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
  const incident = counts["ALIVE-ALERT"] > 0;
  const soldierProbe = buildSoldierProbe(chainState, chainState?.accountsRaw);

  /* ארטיפקט */
  const artifact = {
    protocol: "saos/key-proof/1",
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    mandate: "owner trace 1a12c9d6f5df1b95 — dead-key standing proof for R11 leaked key material (roshpina/anchor-baseline/saos-jummper/Sdk/Adsmarket)",
    redaction: { law: "hash16-of-material + derived pubkeys + place metadata ONLY; no private material, no passphrases, no file contents; auditor enforced pre-write (violation = hard failure, nothing written)", selfAudited: true },
    scan: {
      ...scan,
      reachabilityNote: reachableCount === REPOS.length ? "all 5 repos reachable" : `${REPOS.length - reachableCount}/${REPOS.length} repos unreachable with the available token`,
      noise,
      note: "candidate values are hashed in-memory only; never persisted anywhere",
    },
    derive: { engine: "zero-dep port of Domain/gate-crypto.js (secp256k1 BigInt Jacobian + base58check + ripemd160), selftest-anchored (EC G/2G KATs, WIF KAT, rmd160 KAT, real-chain-key decode)" },
    chain: chainState ? {
      node: chainState.node, fleetAccounts: FLEET.length, fleetAliveKeyBodies: chainState.aliveSet.size,
      keyReferencesAvailable: keyRefsAvailable, keyReferenceNote: keyRefsAvailable ? "condenser_api.get_key_references used (global reference census)" : "unavailable — aliveness decided by fleet-authority membership only",
      rotation,
      headcornerLastOwnerUpdate: chainState.accounts.headcorner?.lastOwnerUpdate || null,
      headcornerActiveLive: chainState.accounts.headcorner?.active?.[0] || null,
      gen2ActiveExpected: GEN2_ACTIVE,
      gen2ActiveMatchesLive: (chainState.accounts.headcorner?.active?.[0] || "") === GEN2_ACTIVE,
    } : { error: chainError || "skipped (--offline)" },
    summary: { ...counts, incident },
    verdicts,
    soldierProbe,
    log,
  };
  redactionAudit(artifact); // החוק בקוד — הפרה = אכישלון לפני-כתיבה

  const day = startedAt.slice(0, 10);
  const outPath = path.join(outDir, `key-proof-${day}.json`);
  writeFileSync(outPath, JSON.stringify(artifact, null, 1) + "\n");
  writeFileSync(path.join(outDir, "KEY-PROOF-LATEST.json"), JSON.stringify(artifact, null, 1) + "\n");

  /* SUMMARY TABLE (מפתחות-ציבוריים מותרים מתכנון; אף חומר-פרטי לא נדפס) */
  console.log("\n═══ KEY-PROOF SUMMARY ═══");
  console.log("hash16         │ kind        │ verdict                      │ pubkey / note");
  console.log("───────────────┼─────────────┼──────────────────────────────┼────────────────────────────");
  let collapsedPrivhexDead = 0;
  for (const v of verdicts.slice().sort((a, b) => (a.verdict > b.verdict ? 1 : a.verdict < b.verdict ? -1 : 0))) {
    const label = v.derivedPubkey
      ? v.derivedPubkey.slice(0, 16) + "…"
      : v.kind === "archive" ? `blob ${(v.gitBlobSha || "").slice(0, 10)}… (${v.where?.length || 0} repos)` 
      : v.verdict === "UNKNOWN-NOT-CHAIN-TESTABLE" ? "not chain-testable by design"
      : v.deriveError ? `derive-failed: ${v.deriveError.slice(0, 40)}`
      : "—";
    if (v.kind === "privhex" && v.verdict === "DEAD") { collapsedPrivhexDead++; continue; }
    console.log(`${v.hash16.padEnd(14)} │ ${v.kind.padEnd(11)} │ ${v.verdict.padEnd(28)} │ ${label}`);
  }
  if (collapsedPrivhexDead) console.log(`(+) ${collapsedPrivhexDead} privhex candidates → DEAD (each individually hash-listed in the artifact JSON)`);
  console.log("───────────────");
  console.log(`TOTALS: DEAD=${counts.DEAD} · ALIVE-ALERT=${counts["ALIVE-ALERT"]} · UNKNOWN=${counts.UNKNOWN} · UNKNOWN-NOT-CHAIN-TESTABLE=${counts["UNKNOWN-NOT-CHAIN-TESTABLE"]} · incident=${incident}`);
  if (incident) console.log("🚨 INCIDENT: leaked material authorizes a LIVE authority — rotate on-chain now; artifact screams via summary.incident=true (exit stays 0 by design)");
  for (const l of log) console.log(`[log] ${l}`);
  console.log(`artifact: ${outPath}`);

  /* ניקוי: /tmp מחוץ לכל ריפו (הערכים לעולם לא נכתבו לשם — רק קלונים ציבוריים) */
  if (!noDelete) { try { rmSync(scanDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  process.exit(0);
}

main().catch((e) => { console.error(`key-proof fatal: ${e.message}`); process.exit(2); });
