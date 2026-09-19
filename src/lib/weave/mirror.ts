// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · mirror - המראה הציבורית של הרשת (Task 27)
//
// הבעיה שהמראה פותרת: הפלטפורמה החיה (הסוכנים, הספר, השוק, המוח)
// רצה עד עכשיו רק בסנדבוקס (localhost:3000). מוות של הסביבה = החזות
// כולה נעלמת למרות שכל האמת חיה בגיט ובשרשרת.
//
// הפתרון: הלב (בענן, בכל פעימה - גם ב-SANDBOX-ALIVE) בונה מראה
// נגזרת-ציבורית של מצב הרשת ומפרסם אותה לריפו הציבורי Console
// (mirror.json) דרך WEAVE_OPS_PAT. הקונסולה מציגה אותה ב-net.html -
// והרשת כולה נראית לכל אחד, מכל מקום, בלי שום סנדבוקס.
//
// מה נכנס למראה: אמת נגזרת בלבד - סוכנים (בלי מפתחות), אימותים
// (טענות קצוצות), checkpoints (שורשים ציבוריים) + קווי עוגן, אירועי
// שוק, סטטוס המוח (בלי גושי הצופן - הם חיים בספר בלבד).
// מה לא נכנס לעולם: devKeyHex, pubKeyHex, encKey/keyIv/keyTag, חתימות
// גולמיות, כל סוד. שער-הסודות של הרשת רץ על התוכן לפני כל פרסום.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { secretGate, filterKnownHashes } from "../../../scripts/weave-gate";

const OWNER = process.env.WEAVE_OWNER || "roshpinacare-sys";
const CONSOLE_REPO = `${OWNER}/Console`;
/* src/lib/weave · שלוש רמות למעלה הוא שורש הריפו. תיקון אמת (Task 28):
 * "..", ".." הביא ל-src/ - המראה פורסמה מ-Task 27 בלי קווי עוגן וקבצי
 * הקונסולה לא נמצאו בכלל. נבדק במקום (probe: existsSync). */
const ROOT = path.resolve(__dirname, "..", "..", "..");

/** חוק הטיפוגרפיה של המפעיל (R20): אף מקף-אמה ואף חץ-גליף בטקסט הנראה.
 * ההיסטוריה החתומה בספר נשארת בדיוק כפי שנחתמה; המראה היא שכבת
 * תצוגה נגזרת - היא מנרמלת לתצוגה בלבד, בלי לגעת בספר. */
const plainText = (s: string): string =>
  s.replace(/\u2014/g, "-").replace(/[\u2190-\u21ff]/g, "\u00b7");

export interface MirrorPublishResult {
  published: boolean;
  reason: string;
  bytes?: number;
}

interface LineAnchor {
  checkpoint: number;
  root: string;
  at: string;
  txids?: { steem?: string | null; hive?: string | null };
  txid?: string;
}

/** בניית המראה - אמת נגזרת מה-DB ומקווי העוגן, אפס סודות */
export async function buildConsoleMirror(): Promise<Record<string, unknown>> {
  const [agents, attestations, checkpoints, marketEvents, brainKeys, attTotal, cpTotal, discoveryAtts] = await Promise.all([
    db.agent.findMany({ orderBy: { name: "asc" } }),
    db.attestation.findMany({ orderBy: { seq: "desc" }, take: 120 }),
    db.checkpoint.findMany({ orderBy: { index: "desc" }, take: 30 }),
    db.marketEvent.findMany({ orderBy: { seq: "desc" }, take: 15 }),
    db.brainKey.findMany(),
    db.attestation.count(),
    db.checkpoint.count(),
    db.attestation.findMany({ where: { claimType: "DISCOVERY" }, orderBy: { seq: "desc" }, take: 20, select: { seq: true, createdAt: true, claim: true, evidence: true } }),
  ]);

  // קווי העוגן - אילו checkpoints כבר העידו, ובאילו שרשרות
  const steemLine = readLineFile("steem-line.json");
  const zeroLine = readLineFile("zero-line.json");
  const anchoredMap = new Map<number, string[]>();
  const markAnchored = (cp: number, chain: string) => {
    const cur = anchoredMap.get(cp) || [];
    if (!cur.includes(chain)) cur.push(chain);
    anchoredMap.set(cp, cur);
  };
  for (const a of steemLine) markAnchored(a.checkpoint, "steem");
  for (const a of zeroLine) markAnchored(a.checkpoint, "zero");

  const agentActivity = new Map<string, { count: number; lastSeq: number | null; lastAt: string | null }>();
  for (const a of agents) {
    const last = await db.attestation.findFirst({ where: { agentId: a.id }, orderBy: { seq: "desc" } });
    const count = await db.attestation.count({ where: { agentId: a.id } });
    agentActivity.set(a.name, {
      count,
      lastSeq: last?.seq ?? null,
      lastAt: last?.createdAt?.toISOString() ?? null,
    });
  }

  const attByStatus: Record<string, number> = {};
  for (const a of await db.attestation.groupBy({ by: ["status"], _count: true })) {
    attByStatus[a.status] = a._count;
  }

  return {
    format: "weave-console-mirror-v1",
    generatedAt: new Date().toISOString(),
    source: "the sovereign ledger (Zip repo, cloud heart beat)",
    doctrine: "derived public truth - no keys, no vault blocks, no secrets; the ledger and the chains remain the source of truth",
    stats: {
      attestations: attTotal,
      checkpoints: cpTotal,
      agents: agents.length,
      brainKeys: brainKeys.length,
      brainLive: brainKeys.filter((b) => b.status === "verified").length,
      attByStatus,
      headHash: attestations[0]?.entryHash ?? null,
    },
    agents: agents.map((a) => {
      const act = agentActivity.get(a.name) || { count: 0, lastSeq: null, lastAt: null };
      return {
        name: a.name,
        role: plainText(a.role),
        status: a.status,
        address: a.ethAddress,
        attestations: act.count,
        lastAttestationSeq: act.lastSeq,
        lastAttestationAt: act.lastAt,
      };
    }),
    attestations: attestations.map((a) => ({
      seq: a.seq,
      type: a.claimType,
      status: a.status,
      at: a.createdAt.toISOString(),
      agentName: agents.find((x) => x.id === a.agentId)?.name ?? "?",
      claim: plainText(a.claim.length > 300 ? a.claim.slice(0, 297) + "\u2026" : a.claim),
    })),
    checkpoints: checkpoints.map((c) => ({
      index: c.index,
      root: c.root,
      attFrom: c.attFrom,
      attTo: c.attTo,
      at: c.createdAt.toISOString(),
      anchoredOn: anchoredMap.get(c.index) || [],
    })),
    anchorLines: {
      steem: steemLine.slice(-5).map((a) => ({
        checkpoint: a.checkpoint,
        at: a.at,
        txid: a.txids?.steem ?? null,
        hiveTxid: a.txids?.hive ?? null,
      })),
      zero: zeroLine.slice(-5).map((a) => ({
        checkpoint: a.checkpoint,
        at: a.at,
        txid: a.txid ?? null,
        explorer: a.txid ? `https://zscan.live/tx/${a.txid}` : null,
      })),
    },
    market: marketEvents.map((m) => {
      let payloadSummary = "";
      try {
        const p = JSON.parse(m.payload) as Record<string, unknown>;
        payloadSummary = plainText(`#${p.marketSeq ?? "?"} ${String(p.reason ?? p.outcome ?? "").slice(0, 60)}`);
      } catch {
        payloadSummary = plainText(m.payload.slice(0, 60));
      }
      return { seq: m.seq, kind: m.kind, at: m.createdAt.toISOString(), summary: payloadSummary };
    }),
    brain: brainKeys.map((b) => ({
      fingerprint: b.fingerprint,
      status: b.status,
      lastCode: b.lastCode,
      verifiedAt: b.verifiedAt?.toISOString() ?? null,
    })),
    /* גילויים ריבוניים - מתכונים ציבוריים שכל אחד משחזר בדפדפן שלו
     * (acid.html). ההוכחה נחלצת משורת ה-evidence של אימות DISCOVERY -
     * הרשת מעידה רק על גילויים שהיא עצמה שחזרה בענן. */
    discoveries: discoveryAtts
      .map((a) => {
        const m = /proof=(\{[^}]*\})/.exec(a.evidence || "");
        if (!m) return null;
        try {
          const p = JSON.parse(m[1]) as Record<string, unknown>;
          if (typeof p.t !== "string" || typeof p.s !== "number" || typeof p.h !== "string") return null;
          const tx = /txid=([0-9a-f]{20,64})/.exec(a.evidence || "");
          return {
            seq: a.seq,
            at: a.createdAt.toISOString(),
            taskId: p.t,
            seed: p.s,
            gens: typeof p.g === "number" ? p.g : null,
            pop: typeof p.p === "number" ? p.p : null,
            hash: p.h,
            ev: typeof p.ev === "string" ? p.ev : null,
            txid: tx ? tx[1] : null,
            claim: plainText(a.claim.length > 160 ? a.claim.slice(0, 157) + "\u2026" : a.claim),
          };
        } catch {
          return null;
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null),
  };
}

function readLineFile(name: string): LineAnchor[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "sovereign", name), "utf8")) as { anchors?: LineAnchor[] };
    return Array.isArray(raw.anchors) ? raw.anchors : [];
  } catch {
    return [];
  }
}

/** שער-הסודות על תוכן המראה - ברזל, בדיוק כמו כל דחיפה של הרשת */
function gateMirror(text: string): void {
  const leak = secretGate(filterKnownHashes(text));
  if (leak) throw new Error(`מראה נחסמה בשער-הסודות: ${leak} - לא מפורסם כלום`);
}

/** פרסום לריפו הציבורי - PUT אטומי של הקובץ, רק כשהתוכן השתנה */
export async function publishConsoleMirror(): Promise<MirrorPublishResult> {
  const mirror = await buildConsoleMirror();
  const text = JSON.stringify(mirror, null, 2) + "\n";
  gateMirror(text); // השער רץ תמיד - גם בסביבה בלי PAT, התוכן נבדק

  const pat = process.env.WEAVE_OPS_PAT || "";
  if (!pat) return { published: false, reason: "אין WEAVE_OPS_PAT בסביבה - דילוג-כנה (המראה מתפרסמת רק מהענן) - השער עבר" };

  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`https://api.github.com${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };

  // הקובץ הקיים - פרסום רק כשיש שינוי אמיתי (לא כל פעימה מחדש)
  const cur = await api("GET", `/repos/${CONSOLE_REPO}/contents/mirror.json?ref=main`);
  if (cur.status === 200 && cur.json && typeof cur.json.content === "string") {
    const curText = Buffer.from(cur.json.content, "base64").toString("utf8");
    if (curText.trim() === text.trim()) {
      return { published: false, reason: "המראה כבר עדכנית - אין שינוי לפרסם", bytes: text.length };
    }
  }

  const put = await api("PUT", `/repos/${CONSOLE_REPO}/contents/mirror.json`, {
    message: `weave-mirror: ${mirror.generatedAt as string} · ${(mirror.stats as Record<string, number>).attestations} att · ${(mirror.stats as Record<string, number>).checkpoints} cp · derived public truth`,
    content: Buffer.from(text, "utf8").toString("base64"),
    sha: cur.status === 200 && cur.json ? String(cur.json.sha || "") : undefined,
    branch: "main",
  });
  if (put.status !== 200 && put.status !== 201) {
    return { published: false, reason: `פרסום נכשל (HTTP ${put.status}) - ${(put.json?.message as string || "").slice(0, 80)}` };
  }
  return { published: true, reason: "פורסם", bytes: text.length };
}

/* ═════════════════════════════════════════════════════════════════════
 * נכסי הקונסולה - סנכרון ריבוני (Task 28)
 *
 * הבעיה: הקבצים הכתובים-יד (gate.html, acid.html…) חיים בריפו הריבוני
 * (console/) אך פורסמו ידנית לריפו הציבורי Console. הידניות היא תלות
 * בסנדבוקס - מי שמחזיק את הסוד לוחץ את הכפתור. ה-PAT של הסנדבוקס
 * אף נמחק (מדידה: upload/pat.env מוחלף ב-placeholder) - הענן הוא
 * המחזיק היחיד בסוד מעתה.
 *
 * הפתרון: הלב עצמו מסנכרן את הקבצים - בכל פעימה, מה-clone של הריפו
 * הריבוני אל הריפו הציבורי, דרך WEAVE_OPS_PAT (Actions Secret). מקור
 * האמת: הגיט. שער-הסודות רץ על כל קובץ לפני פרסום. פרסום רק בשינוי
 * אמיתי (השוואת תוכן מול הקיים) - תקציב ה-API נשמר.
 * ═════════════════════════════════════════════════════════════════════ */

/** הקבצים הכתובים-יד שמקורם בריפו הריבוני - הלב מסנכרן אותם החוצה.
 * (index.html/status.json נולדים בריפו הציבורי עצמו ע"י render.mjs -
 * לא נוגעים בהם.)
 *
 * ריפוי R58 (מרוץ 11:08): דור הממשק הקודם (gate/net/acid/acid-engine/money)
 * יצא מהמחזור - הם מוגשים כ-stub הפניה שנולד בציבורי ואסור שיהיה להם
 * מקור ריבוני בכלל (G4). הרשימה כוללת מעתה רק קבצים שהצד הציבורי לעולם
 * לא כותב בעצמו - עריכה ישירה בציבורי תידרס על-ידי הסנכרון בכוונה
 * (הקנוני הוא הריבוני; זה בדיוק הלקח של Task 28).
 * agent/* ו-truth/* נולדים בציבורי (סוכנים/verify/מכונת האמת כותבים
 * שם) - אינם ברשימה ולעולם לא יידרסו מכאן. */
const CONSOLE_ASSETS = [
  "wallet.html",
  "gate-crypto.js",
  "saos-live.js",
  "render.mjs",
  "README.md",
  "sitemap.xml",
];

export interface ConsoleAssetsResult {
  published: string[];
  unchanged: string[];
  failed: string[];
  reason?: string;
}

export async function publishConsoleAssets(): Promise<ConsoleAssetsResult> {
  const pat = process.env.WEAVE_OPS_PAT || "";
  if (!pat) {
    return { published: [], unchanged: [], failed: [], reason: "אין WEAVE_OPS_PAT בסביבה - דילוג-כנה (הסנכרון רץ מהענן)" };
  }

  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`https://api.github.com${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };

  const published: string[] = [];
  const unchanged: string[] = [];
  const failed: string[] = [];
  for (const file of CONSOLE_ASSETS) {
    try {
      const localPath = path.join(ROOT, "console", file);
      if (!fs.existsSync(localPath)) {
        failed.push(`${file}:missing-in-sovereign-repo`); // מקור חסר - נרשם, לא מוסתר
        continue;
      }
      const text = fs.readFileSync(localPath, "utf8");
      // שער-הסודות על כל קובץ לפני שהוא יוצא החוצה - ברזל
      const leak = secretGate(filterKnownHashes(text));
      if (leak) throw new Error(`${file}: ${leak}`);

      const cur = await api("GET", `/repos/${CONSOLE_REPO}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=main`);
      if (cur.status === 200 && cur.json && typeof cur.json.content === "string") {
        const curText = Buffer.from(String(cur.json.content), "base64").toString("utf8");
        if (curText.trim() === text.trim()) {
          unchanged.push(file);
          continue;
        }
      }
      const put = await api("PUT", `/repos/${CONSOLE_REPO}/contents/${file.split("/").map(encodeURIComponent).join("/")}`, {
        message: `weave-console-assets: ${file} - synced from the sovereign repo (console/)`,
        content: Buffer.from(text, "utf8").toString("base64"),
        sha: cur.status === 200 && cur.json ? String(cur.json.sha || "") : undefined,
        branch: "main",
      });
      if (put.status === 200 || put.status === 201) {
        published.push(file);
      } else {
        // כשל-פרסום נרשם בכנות - לעולם לא "ללא שינוי" (תווית שקר נתפסה בביקורת)
        failed.push(`${file}:HTTP${put.status}:${String(put.json?.message || "").slice(0, 80)}`);
      }
    } catch (e) {
      failed.push(`${file}:${e instanceof Error ? e.message.slice(0, 80) : String(e)}`); // כשל בקובץ אחד לא עוצר את השאר
      console.log(`[console-assets] ${file}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
  }
  return { published, unchanged, failed };
}
