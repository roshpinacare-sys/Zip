// HIVE-CENSUS — verify-only: does the machine ALREADY hold a key that derives a LIVE HIVE authority?
// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// T-65 (wave grid-never-down + hive-flow) · sibling of probe.cjs / resolve-keys.cjs (R16-a).
// Owner mandate trace 1a12dbe9812eff11: "כן אני מאשר זה המפתח שלי · תצית תפתור תפעיל שלא יהיו
// חסימות · הריבונות מורשית להשתמש בבלוקצ'יין להקים פרויקטים ולבצע ולפתח" + owner trace 1a12de177bf24415
// ("תמצא פתרון להזרים את ה-hive ממי שאישר שיהיה נגיש").
//
// מדוד מראש (2026-10-12 02:2xZ, read-only): כל 13 חשבונות-הצי קיימים ב-Hive עם authorities פעילים
// (headcorner/cashmachine/haran/israelnews/lsa/macrame/siq/tov/wic/wog/woq/corner/treasury).
// Hive fork של Steem — אותו פורמט-מפתח (WIF 0x80, secp256k1, קידומת STM ציבורית בשרשרת).
// אם הכרוך מחזיק את אותם מפתחות-פרטיים — ה-Hive זורם עכשיו. זו המדידה.
//
// החוק (זהה ל-probe.cjs, fail-safe בכל-שכבה):
//   1. verify-only — אפס שידור, אפס כתיבת-סודות, אפס שינוי-רשויות. המדידה היא התוצר.
//   2. אפס חומר-פרטי בלוג/קבלה — WIF-ים לעולם לא מודפסים ולא נכתבים; רק מפתח-ציבורי-נגזר.
//   3. cleanup — /tmp נמחק בסוף-כל-נתיב.
//   4. כנות — DECRYPT-FAILED / NO-MATCH תוצאות-לגיטימיות-מפורסמות (exit 0), לא כישלונות-צינור.
//
// שימוש: NODE_PATH=<steem-lib> node ops/key-census-probe/hive-census.cjs --receipt ops/key-census-probe/hive-receipt.json
'use strict';
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("./probe.cjs");

const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];

async function hiveRpcAny(method, params) {
  const errs = [];
  for (const node of HIVE_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      errs.push(`${new URL(node).host}: no-result`);
    } catch (e) {
      errs.push(`${new URL(node).host}: ${String(e?.message ?? e).slice(0, 60)}`);
    }
  }
  throw new Error(`all-hive-nodes-failed · ${errs.join(" | ")}`);
}

// רשויות-חיות מ-Hive (נתון-ציבורי על-השרשרת) — באותה-צורה ש-P.classify מצפה.
async function hiveChain() {
  const props = await hiveRpcAny("condenser_api.get_dynamic_global_properties", []);
  const accounts = await hiveRpcAny("condenser_api.get_accounts", [P.ROSTER]);
  const livePubs = {};
  const hiveAccounts = {};
  for (const a of accounts || []) {
    if (!a || !a.name) continue;
    livePubs[a.name] = {
      active: (a.active?.key_auths?.[0]?.[0]) || null,
      posting: (a.posting?.key_auths?.[0]?.[0]) || null,
      owner: (a.owner?.key_auths?.[0]?.[0]) || null,
    };
    hiveAccounts[a.name] = {
      exists: true,
      vestingShares: a.vesting_shares || null,
      delegatedVesting: a.delegated_vesting_shares || null,
      receivedVesting: a.received_vesting_shares || null,
    };
  }
  for (const n of P.ROSTER) if (!hiveAccounts[n]) hiveAccounts[n] = { exists: false };
  return { headBlock: props?.head_block_number ?? null, livePubs, hiveAccounts };
}

async function main() {
  const outIdx = process.argv.indexOf("--receipt");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : "ops/key-census-probe/hive-receipt.json";

  const receipt = {
    protocol: "SAOS-HIVE-CENSUS-PROBE/1",
    wave: "T-65 (grid-never-down + hive-flow)",
    at: new Date().toISOString(),
    mode: "verify-only (no broadcast, no secret writes, no authority changes)",
    roster: P.ROSTER,
    hiveChain: null,
    decrypt: { attempts: [], zipFile: null, innerSha256: null, shaOk: null },
    scanned: { files: 0, wifCandidates: 0 },
    matches: [],
    derivedNoMatch: 0,
    verdict: "NO-MATCH",
    honesty: "אפס חומר-פרטי בקבלה: מפתחות-ציבוריים-נגזרים בלבד. סיסמאות env-only; WIF-ים לעולם לא בלוג/דיסק-מחוץ-ל-/tmp. Hive ו-Steem חולקים פורמט-מפתח (fork) — קידומת STM ציבורית בשתי-השרשרות, ההשוואה מול רשויות-חיות-פומביות.",
  };

  const pat = process.env.GH_PAT || "";
  if (!pat) { console.error("[hive-census] GH_PAT missing — honest abort"); process.exit(1); }
  const bundle = JSON.parse(process.env.STEEM_VAULT_PASSES || "{}");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hivec-"));
  fs.chmodSync(work, 0o700);
  try {
    // 1) אמת-חיה של Hive (ציבורי)
    const chain = await hiveChain();
    receipt.hiveChain = { headBlock: chain.headBlock, nodes: HIVE_NODES, accountsSeen: Object.keys(chain.livePubs).length };
    receipt.hiveAccounts = chain.hiveAccounts;
    console.log(`[hive-census] hive head_block=${chain.headBlock} · accounts on hive=${Object.keys(chain.livePubs).length}/${P.ROSTER.length}`);

    // 2) פיענוח כרוך-ה-custody (דפוס resolve-keys.cjs — קרדיט R16-a)
    const steemDir = path.join(work, "steem");
    execFileSync("git", ["clone", "--depth", "1", "--branch", "main",
      `https://x-access-token:${pat}@github.com/roshpinacare-sys/steem.git`, steemDir], { stdio: "pipe" });
    const meta = JSON.parse(fs.readFileSync(path.join(steemDir, "agent", "recovery-meta.json"), "utf8"));

    const zips = [];
    if (meta.keysZipFile && fs.existsSync(path.join(steemDir, meta.keysZipFile))) zips.push({ file: meta.keysZipFile, innerSha: meta.keysZipInnerSha256 });
    try {
      for (const f of fs.readdirSync(path.join(steemDir, "agent", "vault"))) {
        if (/^KEYS-ZIP-.*\.zip\.enc$/.test(f) && !zips.some((z) => z.file.endsWith(f))) zips.push({ file: `agent/vault/${f}`, innerSha: null });
      }
    } catch {}
    zips.sort((a, b) => (b.file.includes("GEN2") ? 1 : 0) - (a.file.includes("GEN2") ? 1 : 0));

    const passes = [
      { name: "gen2", value: bundle?.gen2?.keysZipUnlock || "" },
      { name: "recovery-3", value: bundle?.["recovery-3"]?.keysZipUnlock || "" },
      { name: "meta", value: meta.keysZipPass || "" },
    ].filter((p) => p.value && p.value.length >= 8);

    let decrypted = null;
    for (const z of zips) {
      const decPath = path.join(work, "keys.zip");
      let hit = false;
      for (const pc of passes) {
        receipt.decrypt.attempts.push(`${z.file}:${pc.name}`);
        if (P.decryptTry(path.join(steemDir, z.file), decPath, pc.value, pc.name)) { hit = true; break; }
      }
      if (!hit) continue;
      if (z.innerSha) {
        const actual = execFileSync("sha256sum", [decPath], { encoding: "utf8" }).split(" ")[0];
        receipt.decrypt.innerSha256 = z.innerSha;
        if (actual !== z.innerSha) { console.log(`[hive-census] inner sha mismatch on ${z.file} — refusing`); receipt.decrypt.shaOk = false; continue; }
        receipt.decrypt.shaOk = true;
      }
      receipt.decrypt.zipFile = z.file;
      decrypted = decPath;
      break;
    }
    if (!decrypted) {
      receipt.verdict = "DECRYPT-FAILED";
      fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n");
      console.log(`[hive-census] VERDICT: DECRYPT-FAILED (honest result — receipt written to ${outPath})`);
      return;
    }

    const unzipDir = path.join(work, "unzipped");
    fs.mkdirSync(unzipDir, { recursive: true });
    execFileSync("unzip", ["-o", "-q", decrypted, "-d", unzipDir], { stdio: "pipe" });
    const cands = [];
    receipt.scanned.files = P.scanDir(unzipDir, cands);
    receipt.scanned.wifCandidates = cands.length;

    // 3) classify מול רשויות-Hive החיות — אפס WIF בפלט
    const seen = new Set();
    for (const c of cands) {
      const r = P.classify(c, chain.livePubs);
      if (r.ok) {
        const key = `${r.account}:${r.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        receipt.matches.push({ account: r.account, role: r.role, sourceTag: c.tag, derivedPub: r.derivedPub });
        console.log(`[hive-census] MATCH ${r.account} · ${r.role} · src=${c.tag}`);
      } else if (r.derivedPub) receipt.derivedNoMatch++;
    }

    const roles = {};
    for (const m of receipt.matches) roles[m.role] = (roles[m.role] || 0) + 1;
    receipt.matchSummary = { accounts: new Set(receipt.matches.map((m) => m.account)).size, roles };
    receipt.verdict = receipt.matches.length ? "MATCH-HIVE" : "NO-MATCH";

    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n");
    console.log(`[hive-census] scanned files=${receipt.scanned.files} · wifCandidates=${receipt.scanned.wifCandidates} · derivedNoMatch=${receipt.derivedNoMatch}`);
    console.log(`[hive-census] VERDICT: ${receipt.verdict} · matches=${receipt.matches.length} · accounts=${receipt.matchSummary?.accounts ?? 0} · roles=${JSON.stringify(roles)}`);
    if (receipt.verdict === "MATCH-HIVE") console.log("[hive-census] THE MACHINE HOLDS LIVE HIVE KEYS — hive flows (verify-only proof; operational lanes may now key-gate against hive authorities)");
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error("[hive-census] FATAL:", String(e?.message ?? e)); process.exit(1); });
