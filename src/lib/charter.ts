// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Charter — מספנת הצ'רטרים (R89)
//
// הדלת הפתוחה של הרשת לבונים חיצוניים: סוכן ללא גישת-ריפו מקבל
// מהמפעיל טוקן-בונה, ומקים פרויקטים על הרשת דרך החוזה:
//   • הזהות: Agent אמיתי עם כתובת secp256k1 (תקן EVM).
//   • ההקמה: רישום BUILD חתום EIP-191 בספר האימותים hash-chained.
//   • הזיכרון: כל צ'רטר ומסמך מתפרסם לקנון (Defi) — הסנדבוקס
//     מת, הרישות חיות. ה-PAT לעולם לא עוזב את הסנדבוקס.
//   • הטוקן: נשמר SHA-256 בלבד. מי שמחזיק בו פועל בשם הבונה.
//
// דוקטרינת האמת: שום טענה בלי מדידה — כל סעיף חוזה נאכף בקוד
// ומוחזר בכנות (401/403/422), בלי מעבר-שקט.
// ─────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { db } from "@/lib/db";
import { generateIdentity } from "@/lib/weave/evm";

// ── קבועי החוזה ──────────────────────────────────────────────────────

export const CHARTER = {
  tokenPrefix: "wvb_",
  slugPattern: /^[a-z0-9][a-z0-9-]{1,38}$/,
  filePattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/,
  nameMin: 2,
  nameMax: 80,
  purposeMin: 10,
  purposeMax: 4000,
  metaMax: 2000,
  artifactMaxBytes: 48 * 1024,
  projectsPerDay: 6,
  artifactsPerDay: 20,
  canonRepo: "roshpinacare-sys/Defi",
  registryPath: "charter/registry.json",
  projectDir: "charter/projects",
  statuses: ["CHARTERED", "BUILDING", "COMPLETE", "ARCHIVED"] as const,
} as const;

// ── שער-הסודות — זהה לצייד: אף מפתח לא נכנס לקנון ──────────────────

export function secretGate(text: string): string | null {
  if (/github_pat_[A-Za-z0-9_]{20,}/.test(text)) return "github_pat";
  if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(text)) return "gh-token";
  if (/\b5[HJK][1-9A-HJ-NP-Za-km-z]{49,51}\b/.test(text)) return "wif";
  return null;
}

// ── טוקנים ────────────────────────────────────────────────────────────

export function generateBuilderToken(): string {
  return CHARTER.tokenPrefix + randomBytes(24).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface BuilderIdentity {
  agentId: string;
  address: string;
  name: string;
}

/** אימות טוקן-בונה → זהות ה-Agent שמאחוריו (או null — בלי פרטים מדליפים) */
export async function verifyBuilderToken(
  token: string | null | undefined,
): Promise<BuilderIdentity | null> {
  if (!token) return null;
  const row = await db.builderToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { agent: true },
  });
  if (!row || !row.active) return null;
  if (row.agent.status !== "ACTIVE") return null;
  // נגיעה אחרונה — לתצוגת המפעיל בלבד, לא מדדים
  await db.builderToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => undefined);
  return { agentId: row.agentId, address: row.agent.ethAddress, name: row.agent.name };
}

/** הנפקת בונה חדש: זהות EVM טרייה + טוקן. הטוקן חוזר פעם אחת. */
export async function issueBuilder(name: string): Promise<{
  token: string;
  agentId: string;
  address: string;
  prefix: string;
}> {
  const ident = generateIdentity();
  const agent = await db.agent.create({
    data: {
      name,
      role: "BUILDER",
      ethAddress: ident.address,
      pubKeyHex: ident.pubKeyHex,
      devKeyHex: ident.devKeyHex, // DEVNET — כדוקטרינת הסכמה
      status: "ACTIVE",
    },
  });
  const token = generateBuilderToken();
  await db.builderToken.create({
    data: {
      agentId: agent.id,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 10),
    },
  });
  return { token, agentId: agent.id, address: agent.ethAddress, prefix: token.slice(0, 10) };
}

// ── תקציבים — נספרים מה-DB, לא מהזיכרון (האמת במדידה) ───────────────

export async function budgetLeft(
  builderId: string,
): Promise<{ projects: number; artifacts: number }> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [projects, artifacts] = await Promise.all([
    db.charterProject.count({
      where: { builderId, createdAt: { gte: dayStart } },
    }),
    db.charterEvent.count({
      where: {
        kind: "ARTIFACT",
        createdAt: { gte: dayStart },
        project: { builderId },
      },
    }),
  ]);
  return {
    projects: Math.max(0, CHARTER.projectsPerDay - projects),
    artifacts: Math.max(0, CHARTER.artifactsPerDay - artifacts),
  };
}

// ── קנון: פרסום לריפו Defi דרך ה-Contents API ────────────────────────

function resolvePatPath(): string {
  const candidates = [
    process.env.CHARTER_PAT,
    `${process.cwd()}/upload/pat.env`,
    "/home/z/my-project/upload/pat.env",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (readFileSync(c, "utf8").trim()) return c;
    } catch {
      /* המועמד הבא */
    }
  }
  return candidates[0] ?? "";
}

let PAT_FILE: string | null = null;

export function readPat(): string {
  try {
    PAT_FILE = PAT_FILE ?? resolvePatPath();
    return readFileSync(PAT_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function ghHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function jfetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface CanonResult {
  ok: boolean;
  path: string;
  url?: string;
  error?: string;
}

/** פרסום קובץ לקנון (upsert לפי sha קיים). אם אין PAT — דילוג-כנה. */
export async function publishCanon(
  path: string,
  content: string,
  message: string,
): Promise<CanonResult> {
  const pat = readPat();
  if (!pat) {
    return { ok: false, path, error: "אין PAT בסנדבוקס — הקנון לא נכתב (דילוג-כנה)" };
  }
  try {
    let existingSha: string | undefined;
    const cur = await jfetch(
      `https://api.github.com/repos/${CHARTER.canonRepo}/contents/${encodeURIComponent(path)}?ref=main`,
      { headers: ghHeaders(pat) },
      15_000,
    );
    if (cur.status === 200) {
      const j = (await cur.json()) as { sha?: string };
      existingSha = j.sha;
    }
    const put = await jfetch(
      `https://api.github.com/repos/${CHARTER.canonRepo}/contents/${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { ...ghHeaders(pat), "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: Buffer.from(content, "utf8").toString("base64"),
          sha: existingSha,
          branch: "main",
        }),
      },
      30_000,
    );
    if (!put.ok) {
      return { ok: false, path, error: `GitHub ${put.status}` };
    }
    const j = (await put.json().catch(() => ({}))) as { content?: { html_url?: string } };
    return { ok: true, path, url: j.content?.html_url };
  } catch (e) {
    return { ok: false, path, error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

/** קריאת המרשם מהקנון (לריפוי-עצמי אחרי איפוס-סנדבוקס).
 *  R91 (באג חי שנתפס): הריפו פרטי — raw ללא PAT מחזיר 404 והריפוי שתק.
 *  מעתה: ה-Contents API עם ה-PAT (כמו publishCanon), עם נפילה ל-raw
 *  הציבורי אם יום יבוא והריפו ייפתח. */
export async function readCanonRegistry(): Promise<unknown | null> {
  const tryFetch = async (url: string, headers: Record<string, string>): Promise<unknown | null> => {
    try {
      const r = await jfetch(url, { headers }, 15_000);
      if (!r.ok) return null;
      // Contents API מחזיר base64 בעטיפת JSON; raw מחזיר את הקובץ עצמו
      const text = await r.text();
      try {
        const wrapped = JSON.parse(text) as { content?: string; encoding?: string };
        if (wrapped && typeof wrapped.content === "string" && wrapped.encoding === "base64") {
          return JSON.parse(Buffer.from(wrapped.content, "base64").toString("utf8"));
        }
      } catch {
        /* לא עטיפת Contents — זה כנראה raw */
      }
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const pat = readPat();
  if (pat) {
    const viaApi = await tryFetch(
      `https://api.github.com/repos/${CHARTER.canonRepo}/contents/${CHARTER.registryPath}?ref=main`,
      ghHeaders(pat),
    );
    if (viaApi) return viaApi;
  }
  return tryFetch(
    `https://raw.githubusercontent.com/${CHARTER.canonRepo}/main/${CHARTER.registryPath}`,
    { Accept: "application/json" },
  );
}
