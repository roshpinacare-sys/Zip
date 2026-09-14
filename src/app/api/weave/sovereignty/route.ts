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
const ANCHOR_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "weave-anchor.yml");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "beat-report.json");
const SEAL_META_PATH = path.join(ROOT, "sovereign", "weave-seal.meta.json");
const LEAVES_PATH = path.join(ROOT, "sovereign", "anchor-baseline.leaves.json");
const TOOLKIT_LEAVES_PATH = path.join(ROOT, "sovereign", "toolkit-baseline.leaves.json");
const STEEM_LINE_PATH = path.join(ROOT, "sovereign", "steem-line.json");
const ANCHOR_REPORT_PATH = path.join(ROOT, "sovereign", "anchor-report.json");
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
    const anchorArmed = fs.existsSync(ANCHOR_WORKFLOW_PATH);
    const sealMeta = readJson(SEAL_META_PATH);
    const beatReport = readJson(REPORT_PATH) as BeatReportShape | null;
    const ledgerFile = readJson(LEDGER_PATH) as LedgerShape | null;
    const leaves = readJson(LEAVES_PATH);
    const toolkitLeaves = readJson(TOOLKIT_LEAVES_PATH);
    const steemLine = readJson(STEEM_LINE_PATH);
    const anchorReport = readJson(ANCHOR_REPORT_PATH);

    // ── 2. ה-DB המקומי מול הספר בקובץ ──
    const [lastAtt, count, cloudAgent, sovStages, anchorAtts] = await Promise.all([
      db.attestation.findFirst({ orderBy: { seq: "desc" } }),
      db.attestation.count(),
      db.agent.findUnique({ where: { name: "weave-cloud-heart" } }),
      db.planStage.findMany({
        where: { code: { startsWith: "SOV-" } },
        orderBy: { sortOrder: "asc" },
      }),
      db.attestation.count({ where: { claimType: "ANCHOR" } }),
    ]);
    const anchorAttsRows = await db.attestation.findMany({
      where: { claimType: "ANCHOR" },
      orderBy: { seq: "desc" },
      take: 5,
      select: { seq: true, claim: true, evidence: true, createdAt: true },
    });
    const toolkitAtt = await db.attestation.findFirst({
      where: { claimType: "AUDIT", evidence: { contains: "toolkit-baseline" } },
      orderBy: { seq: "desc" },
      select: { seq: true, claim: true, evidence: true, createdAt: true },
    });
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

    // ── 5. מפת הפערים — משוקפת מ-SOVEREIGNTY.md (2026-09-14: G2/G3/G4 נסגרו במדידה) ──
    const gaps = [
      {
        id: "G1",
        title: "עיגון on-chain בפועל (EVM-1/EVM-2)",
        missing: "חותם ממומן + RPC — עד עכשיו LOCAL",
        path: "workflow_dispatch + מפתח ב-Secrets; txid חוזר לספר",
      },
      {
        id: "G2",
        title: "קו Steem/Hive מהספר — נסגר 2026-09-14 16:57Z",
        missing: "—",
        path: "נסגר: weave-anchor — root ה-checkpoint כ-custom_json (saos.weave.core.v1, posting) על Steem+Hive; ה-txids חוזרים לספר כאימות ANCHOR חתום",
      },
      {
        id: "G3",
        title: "משמרת מפתחות בייצור — נסגר 2026-09-14 16:10Z",
        missing: "—",
        path: "נסגר: WEAVE_SEAL_PASSPHRASE ב-Actions Secrets (.env.local ל-runner; הסיסמה לא בגיט) — הוכח בענן (att 13)",
      },
      {
        id: "G4",
        title: "איחול-עצמי (SOV-3) — נסגר 2026-09-14 16:10Z",
        missing: "—",
        path: "נסגר: אימות BUILD מ-runner ענן נקי (att 13) — השער נסגר עליו",
      },
      {
        id: "G5",
        title: "קונסולה בלי סנדבוקס",
        missing: "ה-UI רץ על dev-server מקומי",
        path: "ריפו נפרד ל-Pages (הוחנה בהוראת המפעיל — ייפתח בהמשך) + Actions service ל-API",
      },
      {
        id: "G6",
        title: "איחוד האקוסיסטם (R1) — נסגר 2026-09-14",
        missing: "—",
        path: "נסגר: מדידה מלאה לפני/אחרי (dup 0.5959→0.0537, יעד <0.2) · 828 מצבתות-מצביע ב-11 ריפואים · הקנון: anchor-baseline/steem · התוכן לא נמחק — ההיסטוריה בגיט · steem (73) במעבר נפרד",
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
        steemLine: steemLine
          ? {
              exists: true,
              account: (steemLine.account as string) ?? null,
              opId: (steemLine.opId as string) ?? null,
              authority: "posting (אפס סיכון הון — הרמה המאושרת ל-L2)",
              anchorsTotal: Array.isArray(steemLine.anchors) ? (steemLine.anchors as unknown[]).length : 0,
              last: steemLine.last
                ? {
                    checkpoint: ((steemLine.last as Record<string, unknown>).checkpoint as number) ?? null,
                    root: ((steemLine.last as Record<string, unknown>).root as string) ?? null,
                    at: ((steemLine.last as Record<string, unknown>).at as string) ?? null,
                    txids: ((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>) ?? null,
                    attSeq: ((steemLine.last as Record<string, unknown>).attSeq as number) ?? null,
                    explorer: {
                      steem: ((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>)?.steem
                        ? `https://steemscan.com/transaction/${((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>).steem}`
                        : null,
                      hive: ((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>)?.hive
                        ? `https://hiveblockexplorer.com/tx/${((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>).hive}`
                        : null,
                    },
                  }
                : null,
              workflowArmed: anchorArmed,
              schedule: anchorArmed ? "יומי 07:17Z + workflow_dispatch" : null,
              custody: "WEAVE_STEEM_WIF — Actions Secret (הענן) + .env.local (ה-runner); המקור בכספת הצי; לעולם לא בגיט",
              anchorAttestationsTotal: anchorAtts,
              lastAnchorAttestations: anchorAttsRows.map((a) => ({
                seq: a.seq,
                claim: a.claim,
                evidence: a.evidence,
                createdAt: a.createdAt,
              })),
              lastReportMode: (anchorReport as Record<string, unknown>)?.mode ?? null,
            }
          : { exists: false, workflowArmed: anchorArmed },
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
        toolkit: toolkitLeaves
          ? {
              derived: true,
              fileCount: (toolkitLeaves.fileCount as number) ?? null,
              totalBytes: (toolkitLeaves.totalBytes as number) ?? null,
              root: (toolkitLeaves.root as string) ?? null,
              derivedAt: (toolkitLeaves.derivedAt as string) ?? null,
              custody: "Project-files (ה-zips המקוריים) + השלמות ניתנת לאימות מול השורש בספר",
              attestation: toolkitAtt
                ? { seq: toolkitAtt.seq, claim: toolkitAtt.claim, createdAt: toolkitAtt.createdAt }
                : null,
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
