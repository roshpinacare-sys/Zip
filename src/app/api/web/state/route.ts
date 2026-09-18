// ─────────────────────────────────────────────────────────────────────
// /api/web/state — מצב רשת-האחסון: חבילות, משימות, מד RC חי.
// אינדקס הריפו הוא נוחות בלבד — כל אימות אמת עובר דרך /api/web/verify.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import path from "path";
import {
  probeStorageRc,
  webRepoPaths,
  anchorCapabilities,
  WEB_ACCOUNT,
  type WebManifestRecord,
  type WebInboxJob,
} from "@/lib/web/netstore";

export const dynamic = "force-dynamic";

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const root = process.cwd();
  const paths = webRepoPaths(root);

  // חבילות שפורסמו (מניפסטים שנכתבו על-ידי הענן אחרי אימות שרשרת)
  const packages: WebManifestRecord[] = [];
  try {
    for (const f of await readdir(paths.manifests)) {
      if (!f.endsWith(".json")) continue;
      const rec = await readJsonSafe<WebManifestRecord>(path.join(paths.manifests, f));
      if (rec?.manifest?.sha256) packages.push(rec);
    }
  } catch {
    /* ספרייה ריקה — אין חבילות עדיין */
  }
  packages.sort((a, b) => (b.manifest.at || "").localeCompare(a.manifest.at || ""));

  // משימות הממתינות לשידור ענן
  const inbox: WebInboxJob[] = [];
  try {
    for (const d of await readdir(paths.inbox)) {
      const job = await readJsonSafe<WebInboxJob>(path.join(paths.inbox, d, "job.json"));
      if (job) inbox.push(job);
    }
  } catch {
    /* אין דואר נכנס */
  }
  inbox.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const rc = await probeStorageRc();

  return NextResponse.json({
    ok: true,
    account: WEB_ACCOUNT,
    at: new Date().toISOString(),
    rc,
    packages,
    inbox,
    caps: anchorCapabilities(),
  });
}
