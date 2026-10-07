/**
 * web-vault-rescan.mjs — תחיית-כספת-האתר מהשרשרת (מבטל את מחזור-המוות)
 * סורק את היסטוריית חשבון-האחסון (cashmachine) על STEEM+HIVE, אוסף custom_json
 * (saos.web.v1 / saos.web.c.v1), בונה מניפסטים מדויקים בסכימת WebManifestRecord,
 * וכותב אותם ל-zip/sovereign/web/manifests/ — השרשרת היא הגיבוי, הגיט הוא המקום.
 * READ-ONLY על השרשרת. Usage: bun zip/scripts/web-vault-rescan.mjs
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const MP = "/home/z/my-project";
const OUT = `${MP}/zip/sovereign/web/manifests`;
const WEB_ACCOUNT = process.env.WEB_STEEM_ACCOUNT || "cashmachine";
const WEB_OP_ID = "saos.web.v1";
const WEB_CHUNK_OP_ID = "saos.web.c.v1";
const PAGE = 100;

async function historyScan(chain) {
  const base = chain === "steem" ? "https://api.steemit.com" : "https://api.hive.blog";
  const call = (method, params) =>
    fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Array.isArray(params) ? { jsonrpc: "2.0", id: 1, method, params } : { jsonrpc: "2.0", id: 1, method, params }) })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 100)); return j.result; });

  const idx = null; void idx; // (condenser probe לא-נחוץ — account_history_api מדוד)
  // absolute newest index
  const acc = (await call("condenser_api.get_accounts", [[WEB_ACCOUNT]]))[0];
  let start = -1;
  const manifests = new Map(); // hash -> {manifest, manifestChain, manifestOp, chunks:Map}
  let pages = 0, entries = 0, reachedBeginning = false, skipped = 0, skippedWindows = 0;

  while (pages < 3000) {
    // אילוצי-צומת: limit≤100 (STEEM); start ≥ limit-1 (או -1). דפדוף-אחורה מהחדש לישן.
    // STEEM: ה-condenser שבור בצמתים הציבוריים (Bad Cast גלובלי) — account_history_api העוקף המדוד.
    const limit = start === -1 ? PAGE : Math.min(PAGE, start + 1);
    let arr = null;
    try {
      const hist = chain === "steem"
        ? (await call("account_history_api.get_account_history", { account: WEB_ACCOUNT, start, limit })).history
        : await call("condenser_api.get_account_history", [WEB_ACCOUNT, start, limit]);
      arr = hist || [];
    } catch (winErr) {
      // חלון-שבור (אופ לא-ניתן-לפירוק) — סריקת-יחידות על החלון, דילוג כנה על רשומה שנכשלת בגפה
      if (start === -1) throw winErr;
      const lo = Math.max(0, start - limit + 1);
      arr = [];
      for (let ss = start; ss >= lo; ss--) {
        try {
          const one = chain === "steem"
            ? (await call("account_history_api.get_account_history", { account: WEB_ACCOUNT, start: ss, limit: 1 })).history
            : await call("condenser_api.get_account_history", [WEB_ACCOUNT, ss, 1]);
          if (one?.[0]) arr.push(one[0]);
        } catch { skipped++; }
      }
      skippedWindows++;
    }
    if (arr.length === 0) { reachedBeginning = true; break; }
    arr.sort((a, b) => a[0] - b[0]);
    for (const [i, entry] of arr) {
      entries++;
      // שתי צורות: condenser (op:[type,val]) ו-appbase (op:{type,value})
      let type, val;
      if (Array.isArray(entry.op)) { [type, val] = entry.op; }
      else { type = entry.op?.type?.replace(/_operation$/, ""); val = entry.op?.value; }
      if (type !== "custom_json") continue;
      const id = val?.id, json = val?.json;
      if (id !== WEB_OP_ID && id !== WEB_CHUNK_OP_ID) continue;
      let pl; try { pl = JSON.parse(json); } catch { continue; }
      // מניפסט נושא sha256; צ'אנק נושא h + i + d
      const hash = String(pl.sha256 || pl.h || "");
      if (!hash) continue;
      const e = manifests.get(hash) ?? { manifest: null, manifestChain: null, manifestOp: null, chunks: new Map() };
      if (id === WEB_OP_ID) {
        e.manifest = { v: 1, protocol: "saos-web/1", name: String(pl.name || ""), sha256: hash, bytes: Number(pl.bytes || 0), mime: String(pl.mime || "application/octet-stream"), entry: pl.entry ? String(pl.entry) : undefined, b64len: Number(pl.s || 0), chunkSize: 0, mode: "chunks", by: WEB_ACCOUNT, at: String(pl.at || "") };
        e.manifestChain = chain;
        e.manifestOp = { block: entry.block ?? null, txid: entry.trx_id ?? null };
      } else {
        const ci = Number(pl.i);
        if (Number.isFinite(ci) && typeof pl.d === "string") e.chunks.set(ci, { i: ci, chars: pl.d.length, block: entry.block ?? null, txid: entry.trx_id ?? null });
      }
      manifests.set(hash, e);
    }
    const minIdx = arr[0][0];
    if (minIdx === 0) { reachedBeginning = true; break; }
    start = minIdx - 1;
    pages++;
  }
  return { manifests, pages, entries, reachedBeginning, skipped, skippedWindows };
}

mkdirSync(OUT, { recursive: true });
const summary = [];
for (const chain of ["steem", "hive"]) {
  try {
    const t0 = Date.now();
    const { manifests, pages, entries, reachedBeginning, skipped, skippedWindows } = await historyScan(chain);
    for (const [hash, e] of manifests) {
      if (!e.manifest) continue; // chunks without manifest — pending, skip until manifest seen
      const chunks = [...e.chunks.values()].sort((a, b) => a.i - b.i);
      const chars = chunks.reduce((s, c) => s + c.chars, 0);
      const rec = {
        manifest: e.manifest,
        status: chars >= e.manifest.b64len ? "complete" : "partial",
        chain: { manifestOp: e.manifestOp, chunks },
        verifiedAt: new Date().toISOString(),
        note: `rebuilt-from-${chain}-history by web-vault-rescan (${pages}p/${entries}e/${reachedBeginning ? "full" : "budget"})`,
      };
      const fp = path.join(OUT, `${hash}.json`);
      const existing = existsSync(fp) ? JSON.parse(readFileSync(fp, "utf8")) : null;
      if (!existing || (existing.status !== "complete" && rec.status === "complete")) writeFileSync(fp, JSON.stringify(rec, null, 1));
      summary.push({ chain, hash: hash.slice(0, 12) + "…", name: e.manifest.name, status: rec.status, chunks: chunks.length, chars, b64len: e.manifest.b64len, file: existsSync(fp) ? "written" : "kept" });
    }
    console.log(`[${chain}] pages:${pages} entries:${entries} full:${reachedBeginning} skipped:${skipped} brokenWindows:${skippedWindows} hashes:${manifests.size} ${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`[${chain}] SCAN-FAIL ${String(err.message).slice(0, 120)}`);
  }
}
writeFileSync(`${OUT}/../rescan-report.json`, JSON.stringify({ at: new Date().toISOString(), account: WEB_ACCOUNT, summary }, null, 1));
console.log("manifests written:", summary.length);
for (const s of summary) console.log(" ", s.chain, s.hash, s.name, s.status, "chunks:" + s.chunks, `${s.chars}/${s.b64len}`, s.file);
