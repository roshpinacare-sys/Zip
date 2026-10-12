// RESOLVE-KEYS — מפענח-כרוך-ה-GEN-2 בזמן-ריצה ומוציא קובץ-מפתחות-0700 לצרכנים-באותו-job
// ════════════════════════════════════════════════════════════════════════════════════════
// R16-a · owner mandate trace 1a12dbe9812eff11. אח של key-census-probe (probe.cjs — מספק
// את-כל-הפנימיים): מפענח את כרוך-ה-custody, מתאים מול-הרשויות-החיות, וכותב לקובץ-פלט
// {account: {active, posting}} — לעולם לא מדפיס WIF, לעולם לא כותב מחוץ-לקובץ-היעד.
// הקובץ חי רק-בתוך-ה-job (0700) ונמחק בסופו. צרכנים: grids/escrow-payroll.mjs --keys-file.
//
// שימוש: NODE_PATH=<steem-lib> node ops/key-census-probe/resolve-keys.cjs --out /tmp/fk.json
'use strict';
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("./probe.cjs");

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  if (!outPath) { console.error("resolve-keys: --out חובה (fail-closed)"); process.exit(2); }

  const pat = process.env.GH_PAT || "";
  if (!pat) { console.error("resolve-keys: GH_PAT missing — honest abort"); process.exit(1); }
  const bundle = JSON.parse(process.env.STEEM_VAULT_PASSES || "{}");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rkeys-"));
  fs.chmodSync(work, 0o700);
  try {
    const livePubs = await P.liveAuthorities();
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
        if (P.decryptTry(path.join(steemDir, z.file), decPath, pc.value, pc.name)) { hit = true; break; }
      }
      if (!hit) continue;
      if (z.innerSha) {
        const actual = execFileSync("sha256sum", [decPath], { encoding: "utf8" }).split(" ")[0];
        if (actual !== z.innerSha) { console.log(`[resolve-keys] inner sha mismatch on ${z.file} — refusing`); continue; }
      }
      decrypted = decPath;
      break;
    }
    if (!decrypted) { console.error("resolve-keys: decrypt failed on all known passes — honest abort (fail-closed)"); process.exit(1); }

    const unzipDir = path.join(work, "unzipped");
    fs.mkdirSync(unzipDir, { recursive: true });
    execFileSync("unzip", ["-o", "-q", decrypted, "-d", unzipDir], { stdio: "pipe" });
    const cands = [];
    P.scanDir(unzipDir, cands);

    const map = {};
    let matched = 0;
    for (const c of cands) {
      const r = P.classify(c, livePubs);
      if (r.ok) {
        matched++;
        map[r.account] = map[r.account] || {};
        map[r.account][r.role] = c.wif;
      }
    }
    fs.writeFileSync(outPath, JSON.stringify(map) + "\n");
    fs.chmodSync(outPath, 0o600);
    const accounts = Object.keys(map);
    console.log(`[resolve-keys] matched ${matched} live keys across ${accounts.length} accounts → ${outPath} (0600, job-only)`);
    for (const a of accounts) console.log(`[resolve-keys] ${a}: ${Object.keys(map[a]).join("+")}`);
    if (accounts.length === 0) { console.error("resolve-keys: no live matches — honest abort"); process.exit(1); }
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}
main().catch((e) => { console.error("[resolve-keys] FATAL:", String(e?.message ?? e)); process.exit(1); });
