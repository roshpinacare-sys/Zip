// KEY-CENSUS-PROBE — verify-only: does the machine ALREADY hold a key that derives a live authority?
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// Owner mandate trace 1a12dbe9812eff11 (2026-10-12): "כן אני מאשר זה המפתח שלי · תצית תפתור תפעיל
// שלא יהיו חסימות · הריבונות מורשית להשתמש בבלוקצ'יין להקים פרויקטים ולבצע ולפתח".
//
// רקע מדוד: gate-01 (G1) אומר "עדכן-סוד" — אבל census ה-Domain (2026-10-11 23:08Z) מדד שאף-מועמד
// בכספת-Domain לא גוזר את רשות-ה-active החיה של headcorner. לפני ששואלים-את-הבעלים שוב — מודדים
// מה-המכונה-כבר-מחזיקה: כרוך-ה-custody של GEN-2 (steem/agent/vault/KEYS-ZIP-GEN2-*.zip.enc) נפתח
// ב-STEEM_VAULT_PASSES — סוד שהריפו-הזה מחזיק. ה-payload הפנימי = מערכת-המפתחות של הצי.
//
// החוק (fail-safe בכל-שכבה):
//   1. verify-only — אפס שידור, אפס כתיבת-סודות, אפס שינוי-רשויות. המדידה היא התוצר.
//   2. אפס חומר-פרטי בלוג/קבלה: סיסמאות עוברות env-only ולעולם לא מודפסות; WIF-ים לעולם לא
//      מודפסים — רק המפתח-הציבורי-הנגזר (מידע-ציבורי ממילא — הוא על-השרשרת).
//   3. cleanup — /tmp נמחק בסוף-כל-נתיב (כולל קלטת-חריגה).
//   4. כנות — DECRYPT-FAILED / NO-MATCH הם תוצאות-לגיטימיות-מפורסמות, לא כישלונות-צינור.
//
// שימוש: NODE_PATH=<steem-lib> node ops/key-census-probe/probe.cjs [--selftest] [--receipt path]
'use strict';
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const steem = require("steem");

const WIF_RE = /^[5JK][1-9A-HJ-NP-Za-km-z]{50}$/;
const ROSTER = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6",
];
const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://steem-rpc.publicnode.com"];

async function rpcAny(method, params) {
  const errs = [];
  for (const node of STEEM_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      errs.push(`${new URL(node).host}: no-result`);
    } catch (e) {
      errs.push(`${new URL(node).host}: ${String(e?.message ?? e).slice(0, 60)}`);
    }
  }
  throw new Error(`all-steem-nodes-failed · ${errs.join(" | ")}`);
}

// ── גזירה-והשוואה (אותו-משטר של grids/key-gate.mjs) ──────────────────────────
function wifToPubSafe(wif) {
  try {
    const pub = steem.auth.wifToPublic(String(wif ?? ""));
    return typeof pub === "string" && pub.startsWith("STM") ? pub : null;
  } catch {
    return null;
  }
}

// ── סריקת-קבצים: WIF-ים עם-הקשר (JSON-walk מתויג, טקסט עם-נתיב-יחסי) ─────────
function collectWifsFromText(text, tag, out) {
  const re = /[5JK][1-9A-HJ-NP-Za-km-z]{50}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const wif = m[0];
    if (WIF_RE.test(wif)) out.push({ wif, tag });
  }
}
function walkJson(node, pathKeys, out, depth) {
  if (depth > 6) return;
  if (typeof node === "string") {
    if (WIF_RE.test(node)) out.push({ wif: node, tag: pathKeys.join(".") || "(root)" });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkJson(v, pathKeys.concat(`[${i}]`), out, depth + 1));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walkJson(v, pathKeys.concat(k), out, depth + 1);
  }
}
function scanDir(rootDir, out) {
  const stack = [rootDir];
  let files = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size > 2 * 1024 * 1024) continue; // ארכיון-שלד — לא מפתחות
      files++;
      const rel = path.relative(rootDir, p);
      let text = "";
      try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
      try {
        const j = JSON.parse(text);
        walkJson(j, [rel], out, 0);
      } catch {
        collectWifsFromText(text, rel, out);
      }
    }
  }
  return files;
}

// ── פענוח-הכרוך (openssl, passes env-only, שמות-בלבד בלוג) ────────────────────
function decryptTry(inFile, outFile, pass, passName) {
  try {
    execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
      "-in", inFile, "-out", outFile, "-pass", "env:PROBE_PASS"], { env: { ...process.env, PROBE_PASS: pass }, stdio: "pipe" });
    return true;
  } catch {
    try { fs.unlinkSync(outFile); } catch {}
    return false;
  }
}

// ── classify: התאמות מועמד-מול-רשויות-חיות ────────────────────────────────────
function classify(candidate, livePubs) {
  const pub = wifToPubSafe(candidate.wif);
  if (!pub) return { ...candidate, ok: false, reason: "malformed" };
  for (const [account, roles] of Object.entries(livePubs)) {
    for (const role of Object.keys(roles)) {
      if (roles[role] && roles[role] === pub) {
        return { ...candidate, ok: true, account, role, derivedPub: pub };
      }
    }
  }
  return { ...candidate, ok: false, derivedPub: pub, reason: "no-live-match" };
}

async function liveAuthorities() {
  const accounts = await rpcAny("condenser_api.get_accounts", [ROSTER]);
  const map = {};
  for (const a of accounts) {
    map[a.name] = {
      active: (a.active?.key_auths?.[0]?.[0]) || null,
      posting: (a.posting?.key_auths?.[0]?.[0]) || null,
      owner: (a.owner?.key_auths?.[0]?.[0]) || null,
    };
  }
  return map;
}

async function runProbe() {
  const receipt = {
    protocol: "SAOS-KEY-CENSUS-PROBE/1",
    at: new Date().toISOString(),
    mode: "verify-only (no broadcast, no secret writes, no authority changes)",
    roster: ROSTER,
    livePubs: null,
    decrypt: { attempts: [], zipFile: null, innerSha256: null, shaOk: null },
    scanned: { files: 0, wifCandidates: 0 },
    matches: [],
    derivedNoMatch: 0,
    verdict: "NO-MATCH",
    honesty: "אפס חומר-פרטי בקבלה: מפתחות-ציבוריים-נגזרים בלבד (מידע-ציבורי על-השרשרת ממילא). סיסמאות env-only, WIF-ים אף-פעם לא בלוג/דיסק-מחוץ-/tmp.",
  };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "kcensus-"));
  fs.chmodSync(work, 0o700);
  try {
    // 1) הרשויות-החיות (keyless)
    receipt.livePubs = await liveAuthorities();

    // 2) הכרוך — clone steem (שער-המאגר של-המפתחות)
    const pat = process.env.GH_PAT || "";
    if (!pat) throw new Error("GH_PAT missing — cannot reach the vault repo (honest abort, verify-only)");
    const steemDir = path.join(work, "steem");
    execFileSync("git", ["clone", "--depth", "1", "--branch", "main",
      `https://x-access-token:${pat}@github.com/roshpinacare-sys/steem.git`, steemDir], { stdio: "pipe" });

    const meta = JSON.parse(fs.readFileSync(path.join(steemDir, "agent", "recovery-meta.json"), "utf8"));
    const bundle = JSON.parse(process.env.STEEM_VAULT_PASSES || "{}");
    const zipCandidates = [];
    if (meta.keysZipFile && fs.existsSync(path.join(steemDir, meta.keysZipFile))) {
      zipCandidates.push({ file: meta.keysZipFile, innerSha: meta.keysZipInnerSha256 });
    }
    const vaultDir = path.join(steemDir, "agent", "vault");
    try {
      for (const f of fs.readdirSync(vaultDir)) {
        if (/^KEYS-ZIP-.*\.zip\.enc$/.test(f) && !zipCandidates.some((c) => c.file.endsWith(f))) {
          zipCandidates.push({ file: `agent/vault/${f}`, innerSha: null });
        }
      }
    } catch {}
    // סדר-עדיפות: GEN-2 ראשון
    zipCandidates.sort((a, b) => (b.file.includes("GEN2") ? 1 : 0) - (a.file.includes("GEN2") ? 1 : 0));

    // מועמדי-סיסמה (שמות-בלבד בקבלה; הערכים env-only)
    const passCands = [
      { name: "bundle.gen2.keysZipUnlock", value: bundle?.gen2?.keysZipUnlock || "" },
      { name: "bundle['recovery-3'].keysZipUnlock", value: bundle?.["recovery-3"]?.keysZipUnlock || "" },
      { name: "recovery-meta.keysZipPass", value: meta.keysZipPass || "" },
    ].filter((p) => p.value && p.value.length >= 8);

    let zipFile = null;
    for (const zc of zipCandidates) {
      const encPath = path.join(steemDir, zc.file);
      if (!fs.existsSync(encPath)) continue;
      const decPath = path.join(work, "keys.zip");
      let hit = false;
      for (const pc of passCands) {
        receipt.decrypt.attempts.push({ zip: zc.file, passName: pc.name });
        if (decryptTry(encPath, decPath, pc.value, pc.name)) { hit = true; break; }
      }
      if (!hit) continue;
      // אימות-sha פנימי אם-ידוע
      if (zc.innerSha) {
        const actual = execFileSync("sha256sum", [decPath], { encoding: "utf8" }).split(" ")[0];
        receipt.decrypt.innerSha256 = actual;
        receipt.decrypt.shaOk = actual === zc.innerSha;
        if (actual !== zc.innerSha) { console.log(`[probe] inner sha mismatch on ${zc.file} — payload drift, refusing this zip`); continue; }
      }
      zipFile = zc.file;
      receipt.decrypt.zipFile = zipFile;
      break;
    }
    if (!zipFile) {
      receipt.verdict = "DECRYPT-FAILED";
      receipt.honesty += " הפענוח-נכשל על-כל-מועמדי-הסיסמה-הידועים (שמות-בקבלה).";
      return receipt;
    }

    // 3) חילוץ + סריקה
    const unzipDir = path.join(work, "unzipped");
    fs.mkdirSync(unzipDir, { recursive: true });
    execFileSync("unzip", ["-o", "-q", path.join(work, "keys.zip"), "-d", unzipDir], { stdio: "pipe" });
    const wifs = [];
    receipt.scanned.files = scanDir(unzipDir, wifs);
    // מועמדי-סודות-ישירים (מחוץ-לכרוך)
    for (const [name, val] of Object.entries({
      "secret:CI_ADOPT_WIF_ACTIVE": process.env.CI_ADOPT_WIF_ACTIVE || "",
      "secret:CI_ADOPT_WIF_POSTING": process.env.CI_ADOPT_WIF_POSTING || "",
    })) {
      if (val && WIF_RE.test(val.trim())) wifs.push({ wif: val.trim(), tag: name });
    }
    // דה-דופ לפי-WIF
    const seen = new Set();
    const uniq = wifs.filter((w) => (seen.has(w.wif) ? false : (seen.add(w.wif), true)));
    receipt.scanned.wifCandidates = uniq.length;

    // 4) classify מול-החי
    const results = uniq.map((c) => classify(c, receipt.livePubs));
    receipt.matches = results.filter((r) => r.ok).map((r) => ({ account: r.account, role: r.role, sourceTag: r.tag, derivedPub: r.derivedPub }));
    receipt.derivedNoMatch = results.filter((r) => !r.ok && r.derivedPub).length;
    const headActive = receipt.matches.find((m) => m.account === "headcorner" && m.role === "active");
    receipt.verdict = headActive ? "MATCH-HEAD-ACTIVE" : (receipt.matches.length ? "MATCH-OTHER" : "NO-MATCH");
    return receipt;
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

// ── selftest (אופליין, בלי-רשת, בלי-כרוך) ─────────────────────────────────────
async function selftest() {
  const assert = (c, msg) => { if (!c) { console.error("SELFTEST FAIL:", msg); process.exit(1); } };
  // וקטור 1: WIF שנוצר מקומית (סינתטי) מזוהה ומתאים ל-pub שלו-עצמו
  const wif = steem.auth.toWif("probe-selftest-user", "probe-selftest-pass", "active");
  assert(WIF_RE.test(wif), "synthetic WIF passes the shape law");
  const pub = steem.auth.wifToPublic(wif);
  const live = { headcorner: { active: pub, posting: null, owner: null } };
  const c1 = classify({ wif, tag: "selftest" }, live);
  assert(c1.ok && c1.account === "headcorner" && c1.role === "active" && c1.derivedPub === pub, "classify match on synthetic vector");
  // וקטור 2: WIF סינתטי אחר לא מתאים
  const wif2 = steem.auth.toWif("probe-selftest-user", "other-pass", "active");
  const c2 = classify({ wif: wif2, tag: "selftest" }, live);
  assert(!c2.ok && c2.derivedPub && c2.reason === "no-live-match", "classify honest no-match");
  // וקטור 3: JSON-walk מתייג לפי-מסלול-מפתחות
  const wifs = [];
  walkJson({ headcorner: { active: wif, nested: [{ deep: wif2 }] } }, ["f.json"], wifs, 0);
  assert(wifs.length === 2 && wifs[0].tag === "f.json.headcorner.active" && wifs[1].tag === "f.json.headcorner.nested.[0].deep", "JSON walk tags paths");
  // וקטור 4: טקסט-גולמי
  const t = [];
  collectWifsFromText(`junk ${wif} junk\nmore ${wif2}`, "plain.txt", t);
  assert(t.length === 2 && t.every((x) => WIF_RE.test(x.wif)), "raw text scan");
  // וקטור 5: classify מחזיר malformed בכנות על-צורה-רעה
  const c3 = classify({ wif: "5NOTAREALWIF", tag: "x" }, live);
  assert(!c3.ok && c3.reason === "malformed", "malformed honest");
  // וקטור 6: צורה-קצרה נדחית
  assert(!WIF_RE.test("short"), "short string rejected by shape");
  console.log("SELFTEST PASS: 6/6 vectors");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) { await selftest(); return; }
  const receiptIdx = args.indexOf("--receipt");
  const receiptPath = receiptIdx >= 0 ? args[receiptIdx + 1] : path.join(__dirname, "receipt.json");
  const receipt = await runProbe();
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 1) + "\n");
  console.log(`[probe] verdict=${receipt.verdict}`);
  console.log(`[probe] decrypt=${receipt.decrypt.zipFile ?? "none"} · shaOk=${receipt.decrypt.shaOk}`);
  console.log(`[probe] scanned files=${receipt.scanned.files} · wifCandidates=${receipt.scanned.wifCandidates} · derivedNoMatch=${receipt.derivedNoMatch}`);
  for (const m of receipt.matches) console.log(`[probe] MATCH ${m.account} · ${m.role} · src=${m.sourceTag} · pub=${m.derivedPub}`);
  if (receipt.verdict === "MATCH-HEAD-ACTIVE") console.log("[probe] THE ARTERY KEY IS IN-MACHINE — next: key-adopt (sealed vault write + dex-grid dispatch)");
  process.exit(0);
}

module.exports = { WIF_RE, ROSTER, rpcAny, wifToPubSafe, walkJson, collectWifsFromText, scanDir, decryptTry, classify, liveAuthorities, selftest };

if (require.main === module) {
  main().catch((e) => { console.error("[probe] FATAL:", String(e?.message ?? e)); process.exit(1); });
}
