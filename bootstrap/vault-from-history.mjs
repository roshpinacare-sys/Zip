#!/usr/bin/env bun
// ═══════════════════════════════════════════════════════════════════════════
// VAULT-FROM-HISTORY — הפעלת-המפתח-הראשי מהגיט (Task 11 · הוראת-המפעיל:
// "יש אוטונומיה שצריכה לדעת להפעיל את המפתח הראשי והכל בלעדיי")
//
// הכספת-הסוברנית (nvx/agent/keys/vault.json — 12 חיילים) חיה בהיסטוריה-של
// steem (blob 15ffd23f). הסקריפט הזה הוא היד-האוטונומית: כל-מכונה-חדשה,
// רק-גיט-והסריקה-הזאת → הכספת-חוזרת-חיה. אפס-מפעיל, אפס-סנדבוקס.
//
// Usage:
//   bun bootstrap/vault-from-history.mjs           ← חילוץ-אם-חסר (idempotent)
//   bun bootstrap/vault-from-history.mjs --force   ← חילוץ-תמיד
//
// חוקים: התוצר chmod 600 · המפתחות-לעולם-לא-נדפסים-ליומן (רק-ספירות-וסוגי-מפתח)
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const STEEM_DIR = process.env.VAULT_STEEM_DIR ?? "/home/z/steem";
const ZIP_DIR = process.env.VAULT_ZIP_DIR ?? "/home/z/my-project/zip";
const OUT = process.env.SAOS_SOLDIER_VAULT ?? "/home/z/fleet-tmp/nvx-vault-extracted.json";
const FORCE = process.argv.includes("--force");
const EXPECT_MIN_ACCOUNTS = 12;

// צורות-מפתח-לגיטימיות (ללא-הדפסה): 5K/5J STEEM-WIF, STM/STH/TST ציבוריים
const KEY_FIELD_HINTS = ["posting", "active", "memo", "owner"];

function log(msg) { console.log(`[vault-from-history] ${msg}`); }

function listBlobs(repoDir) {
  // rev-list --objects → batch-check → blobs<300KB (הכספת ~14KB)
  const revs = execSync("git rev-list --all --objects", { cwd: repoDir, maxBuffer: 512 * 1024 * 1024, timeout: 120_000 })
    .toString().split("\n");
  const shas = new Set();
  for (const line of revs) {
    const t = line.trim();
    if (!t) continue;
    const sha = t.slice(0, t.indexOf(" ") === -1 ? t.length : t.indexOf(" "));
    if (/^[0-9a-f]{40}$/.test(sha)) shas.add(sha);
  }
  if (!shas.size) return [];
  const bs = execSync("git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize)'",
    { cwd: repoDir, maxBuffer: 512 * 1024 * 1024, input: [...shas].join("\n"), timeout: 180_000 }).toString();
  return bs.split("\n")
    .filter((l) => l.includes(" blob ") && parseInt(l.split(" ").pop()) < 300_000)
    .map((l) => l.split(" ")[0]);
}

function parseVault(content) {
  // הכספת = JSON עם accounts[] שכל-אחד-עם username + צרופות-מפתח (או wif-ים)
  let d;
  try { d = JSON.parse(content); } catch { return null; }
  const accs = d?.accounts;
  if (!Array.isArray(accs) || accs.length < 3) return null;
  const good = accs.filter((a) => {
    if (!a?.username) return false;
    const bag = a.keys ?? a.wifs ?? a.keypairs ?? a;
    return KEY_FIELD_HINTS.some((k) => k in (bag ?? {}));
  });
  if (good.length < 3) return null;
  return { parsed: d, score: good.length, total: accs.length };
}

function extract() {
  const repos = [STEEM_DIR, ZIP_DIR].filter((r) => fs.existsSync(path.join(r, ".git")));
  if (!repos.length) { log("✗ אין-ריפו-גיט-זמין-לסריקה"); process.exit(1); }
  let best = null;
  for (const repo of repos) {
    log(`סורק ${path.basename(repo)} (היסטוריה-מלאה)…`);
    let blobs;
    try { blobs = listBlobs(repo); } catch (e) { log(`  ⚠ סריקה-נכשלה: ${String(e.message).slice(0, 80)}`); continue; }
    log(`  ${blobs.length} blobs מועמדים`);
    for (const sha of blobs) {
      try {
        const content = execSync(`git cat-file -p ${sha}`, { cwd: repo, maxBuffer: 8 * 1024 * 1024, timeout: 20_000 }).toString();
        const v = parseVault(content);
        if (v && (!best || v.score > best.score)) {
          best = { content, score: v.score, total: v.total, repo: path.basename(repo), sha: sha.slice(0, 8) };
          if (best.score >= EXPECT_MIN_ACCOUNTS) break; // המקסימום-הידוע
        }
      } catch { /* blob-חריג — דלג */ }
    }
    if (best?.score >= EXPECT_MIN_ACCOUNTS) break;
  }
  if (!best) { log("✗ כספת-לא-נמצאה-בהיסטוריה (אף-blob-לא-תואם-מבנה)"); process.exit(2); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, best.content, { mode: 0o600 });
  log(`✓ כספת-שוחזרה: ${OUT}`);
  log(`  מקור: ${best.repo}@blob:${best.sha} · חיילים-תקינים: ${best.score}/${best.total}`);
  return best;
}

// ─── ראשי ────────────────────────────────────────────────────────────────────
if (!FORCE && fs.existsSync(OUT)) {
  try {
    const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const n = existing?.accounts?.length ?? 0;
    log(`כספת-כבר-חיה-ב-${OUT} (${n} חיילים) — idempotent, לא-נוגעים (--force-לחילוץ-מחדש)`);
    if (n < 3) { log("⚠ כספת-קיימת-שבורה — מחלץ-מחדש"); extract(); }
    process.exit(0);
  } catch { log("⚠ כספת-קיימת-לא-קריאה — מחלץ-מחדש"); extract(); }
} else {
  const v = extract();
  if (v.score < EXPECT_MIN_ACCOUNTS) { log(`⚠ הושגו ${v.score} חיילים (< ${EXPECT_MIN_ACCOUNTS}) — ממשיך-בכנות`); process.exit(0); }
}
