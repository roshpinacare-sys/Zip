// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Sovereignty — סטטוס הריבונות של הרשת (הריפו הוא האמת)
//
// GET /api/weave/sovereignty — מה חי ואיפה:
//   · הלב הענן חמוש? (ה-workflow בריפו)
//   · הפעימה האחרונה (מקומית/ענן) + פסק-דין
//   · הספר בריפו מול ה-DB המקומי (קדימה/פיגור)
//   · ה-seal (קיום + כתובות בלבד — אף סוד)
//   · גזירת העוגנים (anchor-baseline) — אם נרשמה
//   · מפת הפערים (G1..G6) ושערי SOV
// תווית אמת: מצב הריפו נקרא מהקובץ המקומי = LOCAL; הפעימות שבספר = REAL.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";

export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd());
const WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "weave-heart.yml");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "beat-report.json");
const SEAL_META_PATH = path.join(ROOT, "sovereign", "weave-seal.meta.json");
const LEAVES_PATH = path.join(ROOT, "sovereign", "anchor-baseline.leaves.json");
const SOVEREIGNTY_PATH = path.join(ROOT, "SOVEREIGNTY.md");

interface BeatReportShape {
  at?: string;
  runner?: string;
  mode?: string;
  verdict?: string;
  verify?: { checked?: number; sigOk?: number; sigFail?: number; valid?: boolean };
  beat?: { seq?: number; checkpoint?: { index?: number; root?: string } | null } | null;
  gatesClosed?: Array<{ code: string; attSeq: number }>;
}

interface LedgerShape {
  chainCount?: number;
  headHash?: string;
  exportedAt?: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // ── 1. רכיבי הריבונות בקובץ (העתק מקומי של הריפו — LOCAL) ──
    const cloudArmed = fs.existsSync(WORKFLOW_PATH);
    const sealMeta = readJson(SEAL_META_PATH);
    const beatReport = readJson(REPORT_PATH) as BeatReportShape | null;
    const ledgerFile = readJson(LEDGER_PATH) as LedgerShape | null;
    const leaves = readJson(LEAVES_PATH);

    // ── 2. ה-DB המקומי מול הספר בקובץ ──
    const [lastAtt, count, cloudAgent, sovStages] = await Promise.all([
      db.attestation.findFirst({ orderBy: { seq: "desc" } }),
      db.attestation.count(),
      db.agent.findUnique({ where: { name: "weave-cloud-heart" } }),
      db.planStage.findMany({
        where: { code: { startsWith: "SOV-" } },
        orderBy: { sortOrder: "asc" },
      }),
    ]);
    const localHead = lastAtt?.entryHash ?? null;
    const localCount = count;
    const ledgerCount = ledgerFile?.chainCount ?? null;
    const ledgerHead = ledgerFile?.headHash ?? null;

    let repoRelation: "IN-SYNC" | "REPO-AHEAD" | "LOCAL-AHEAD" | "NO-LEDGER" | "HEAD-MISMATCH";
    if (!ledgerFile) {
      repoRelation = "NO-LEDGER";
    } else if (ledgerCount === localCount && ledgerHead === localHead) {
      repoRelation = "IN-SYNC";
    } else if ((ledgerCount ?? 0) > localCount) {
      repoRelation = "REPO-AHEAD";
    } else if ((ledgerCount ?? 0) < localCount) {
      repoRelation = "LOCAL-AHEAD";
    } else {
      repoRelation = "HEAD-MISMATCH";
    }

    // ── 3. git מקומי (בסנדבוקס עשוי להיות בלי remote — אמת מוצהרת) ──
    const remoteUrl = gitOrNull("git remote get-url origin");
    const lastCommit = gitOrNull("git log -1 --format=%H %cI %s");
    const dirtyFiles = gitOrNull("git status --porcelain");

    // ── 4. פסק-דין פעימה אחרון ──
    const lastBeat = beatReport
      ? {
          at: beatReport.at ?? null,
          runner: beatReport.runner ?? null,
          mode: beatReport.mode ?? "full-beat",
          verdict: beatReport.verdict ?? null,
          checked: beatReport.verify?.checked ?? null,
          sigOk: beatReport.verify?.sigOk ?? null,
          beatSeq: beatReport.beat?.seq ?? null,
          checkpoint: beatReport.beat?.checkpoint
            ? {
                index: beatReport.beat.checkpoint.index ?? null,
                root: beatReport.beat.checkpoint.root ?? null,
              }
            : null,
          gatesClosed: beatReport.gatesClosed ?? [],
        }
      : null;

    // ── 5. מפת הפערים — סטטית, משוקפת מ-SOVEREIGNTY.md ──
    const gaps = [
      {
        id: "G1",
        title: "עיגון on-chain בפועל (EVM-1/EVM-2)",
        missing: "חותם ממומן + RPC — עד עכשיו LOCAL",
        path: "workflow_dispatch + מפתח ב-Secrets; txid חוזר לספר",
      },
      {
        id: "G2",
        title: "קו Steem/Hive מהספר הזה",
        missing: "הצי מעיד on-chain; weave-core עדיין לא כותב לשם",
        path: "custom_json מ-root ה-checkpoint דרך seal הצי (Task 79 pattern)",
      },
      {
        id: "G3",
        title: "משמורת מפתחות בייצור",
        missing: "ה-seal בריפו פרטי — מקובל, לא ייצור",
        path: "GitHub Secrets + סיבוב ROTATION מתועד בספר",
      },
      {
        id: "G4",
        title: "איחול-עצמי (SOV-3)",
        missing: "טרם הודגם מ-clone נקי מחוץ לסנדבוקס",
        path: "stranger-revive ב-Actions runner נקי + אימות BUILD",
      },
      {
        id: "G5",
        title: "קונסולה בלי סנדבוקס",
        missing: "ה-UI רץ על dev-server מקומי",
        path: "Pages/static לקריאה + Actions service ל-API",
      },
      {
        id: "G6",
        title: "איחוד האקוסיסטם (R1)",
        missing: "~20 קבצי סטטוס משוכפלים ב-9 ריפוים",
        path: "מדידת שכפול חוזרת (dup<0.2) ואז איחוד",
      },
    ];

    return NextResponse.json({
      ok: true,
      sovereignty: {
        truthLabel: "LOCAL", // קריאת הריפו כאן היא מהעתק מקומי; הפעימות עצמן REAL בספר
        cloud: {
          armed: cloudArmed,
          workflow: cloudArmed ? ".github/workflows/weave-heart.yml" : null,
          schedule: cloudArmed ? "כל 6 שעות + workflow_dispatch" : null,
          authModel: "GITHUB_TOKEN של הריפו (contents:write) — ה-PAT לעולם לא בענן",
        },
        ledger: {
          file: ledgerFile ? "sovereign/ledger.json" : null,
          repoCount: ledgerCount,
          repoHead: ledgerHead,
          exportedAt: ledgerFile?.exportedAt ?? null,
          localCount,
          localHead,
          relation: repoRelation,
        },
        seal: sealMeta
          ? {
              exists: true,
              at: (sealMeta.at as string) ?? null,
              rotatedAt: (sealMeta.rotatedAt as string) ?? null,
              kdf: (sealMeta.kdf as string) ?? null,
              enc: (sealMeta.enc as string) ?? null,
              cloudAddress: (sealMeta.cloudAddress as string) ?? null,
              networkAddress: (sealMeta.networkAddress as string) ?? null,
              custody: sealMeta.passphrase
                ? "LOCAL-LEGACY — הסיסמה עדיין ב-meta בגיט; סבב משמרת: bun scripts/weave-seal.ts --rotate-secret"
                : "REAL — GitHub Actions Secret (הענן) + .env.local (ה-runner הראשי) + כספת המפעיל; הסיסמה לא בגיט",
            }
          : { exists: false },
        cloudAgent: cloudAgent
          ? { name: cloudAgent.name, address: cloudAgent.ethAddress, status: cloudAgent.status }
          : null,
        lastBeat,
        anchors: leaves
          ? {
              derived: true,
              fileCount: (leaves.fileCount as number) ?? null,
              totalBytes: (leaves.totalBytes as number) ?? null,
              root: (leaves.root as string) ?? null,
              source: (leaves.source as Record<string, string>) ?? null,
              derivedAt: (leaves.derivedAt as string) ?? null,
            }
          : { derived: false },
        sovGates: sovStages.map((s) => ({
          code: s.code,
          title: s.title,
          state: s.state,
          attSeq: s.attSeq,
          gate: s.gate,
        })),
        git: {
          remote: remoteUrl ? remoteUrl.replace(/:\/\/[^@]*@/, "://***@") : null,
          lastCommit: lastCommit ? lastCommit.split(" ").slice(0, 3).join(" ") : null,
          dirty: dirtyFiles ? dirtyFiles.split("\n").filter(Boolean).length : 0,
        },
        gaps,
        sovereigntyDoc: fs.existsSync(SOVEREIGNTY_PATH) ? "SOVEREIGNTY.md" : null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
