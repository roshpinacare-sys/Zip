// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · ops — קורא פקודות המפעיל מהשרשרת הציבורית (שער הכניסה)
//
// השער (הקונסולה הציבורית /gate.html) משדר custom_json חתום מחשבון
// המפעיל — רשות POSTING בלבד: השרשרת עצמה אוסרת על המפתח הזה להזיז
// כסף, והיא גם זו שאימתה את החתימה בהכללה לבלוק. הלב קורא את
// ההיסטוריה הציבורית (חסר-מפתח) ומבצע פקודות שטרם בוצעו.
//
// דוקטרינה:
//   · ההיסטוריה של השרשרת היא הקבלה — אין מקור סמכות אחר.
//   · אידמפוטנטיות: כל פקודה נושאת id ייחודי; sovereign/ops-log.json
//     (בגיט) מתעד מה בוצע — ריצה חוזרת לעולם לא מבצעת פעמיים.
//   · חלון-זמן: רק פקודות מ-48 השעות האחרונות (היסטוריה ישנה היא
//     ארכיון, לא תור).
//   · תקרה: עד 5 פקודות לפעימה — שיטפון חתום הוא עדיין שיטפון.
//   · פקודת מפעיל מעירה את הרשת: גם במצב SANDBOX-ALIVE (הענן
//     הנסוג) — המפעיל דיבר, הרשת מגיבה בפעימה מלאה ודחיפה.
//   · פקודה לא מוכרת נרשמת כמתעלמת בכנות — לא נופלת, לא מתבצעת.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { rpcV4, STEEM_RPC_NODES } from "@/lib/weave/graphene";
import { db } from "@/lib/db";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";

export const OPS_OP_ID = "saos.weave.ops.v1";
export const OPERATOR_ACCOUNT = (process.env.WEAVE_OPERATOR_ACCOUNT || "headcorner").toLowerCase();
const OPS_LOG_PATH = path.join(process.cwd(), "sovereign", "ops-log.json");
const WINDOW_MS = 48 * 3600 * 1000; // חלון הפקודות
const MAX_PER_BEAT = 5; // תקרה לפעימה
const PAGE = 100; // עומק קריאה לעמוד
const MAX_PAGES = 12; // ~1200 פעולות אחרונות של החשבון

const OWNER = process.env.WEAVE_OWNER || "roshpinacare-sys";

export interface OperatorCommand {
  id: string;
  cmd: string;
  at: string;
  note?: string;
  txid: string;
  block: number | null;
}

export interface ExecutedCommand {
  id: string;
  cmd: string;
  at: string;
  txid: string;
  action: string;
  ok: boolean;
  detail?: string;
  executedAt: string;
}

export interface OperatorOpsResult {
  executed: ExecutedCommand[];
  attSeqs: number[];
  checkpoint: { index: number; root: string } | null;
  skippedOld: number;
  readFrom: string;
}

interface OpsLogFile {
  format: "weave-ops-log-v1";
  operator: string;
  executed: Record<string, ExecutedCommand>;
  updatedAt: string;
}

function loadOpsLog(): OpsLogFile {
  try {
    const raw = JSON.parse(fs.readFileSync(OPS_LOG_PATH, "utf8")) as OpsLogFile;
    if (raw.format === "weave-ops-log-v1" && raw.executed && typeof raw.executed === "object") return raw;
  } catch {
    /* אין עדיין — נולד עכשיו */
  }
  return { format: "weave-ops-log-v1", operator: OPERATOR_ACCOUNT, executed: {}, updatedAt: new Date(0).toISOString() };
}

function saveOpsLog(log: OpsLogFile): void {
  fs.mkdirSync(path.dirname(OPS_LOG_PATH), { recursive: true });
  log.updatedAt = new Date().toISOString();
  fs.writeFileSync(OPS_LOG_PATH, JSON.stringify(log, null, 2) + "\n");
}

/** קריאת היסטוריית הפקודות של המפעיל מהשרשרת הציבורית — חסרת-מפתח לחלוטין */
export async function readOperatorCommands(): Promise<{ commands: OperatorCommand[]; node: string; skippedOld: number }> {
  const cutoff = Date.now() - WINDOW_MS;
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      const found: OperatorCommand[] = [];
      let skippedOld = 0;
      let start = -1;
      let oldestSeen = Infinity;
      let deepest = 0;
      for (let p = 0; p < MAX_PAGES; p++) {
        const hist = await rpcV4<[number, { trx_id: string; block: number; op?: [string, Record<string, unknown>] }]>(
          node,
          "condenser_api.get_account_history",
          [OPERATOR_ACCOUNT, start, PAGE],
        );
        if (!Array.isArray(hist) || !hist.length) break;
        for (const [idx, entry] of hist) {
          if (typeof idx === "number") {
            oldestSeen = Math.min(oldestSeen, idx);
            deepest = Math.max(deepest, 1);
          }
          const op = entry && entry.op;
          if (!op || op[0] !== "custom_json") continue;
          const body = op[1] as { id?: string; json?: string; required_posting_auths?: string[] } | undefined;
          if (!body || body.id !== OPS_OP_ID) continue;
          // רק מהחשבון עצמו — לא פקודות מתחזות ב-required_posting_auths אחר
          if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(OPERATOR_ACCOUNT)) continue;
          let pl: Record<string, unknown>;
          try {
            pl = JSON.parse(String(body.json || "{}"));
          } catch {
            continue;
          }
          if (pl.v !== 1 || typeof pl.cmd !== "string" || typeof pl.id !== "string") continue;
          const atMs = Date.parse(String(pl.at || ""));
          if (!Number.isFinite(atMs)) continue;
          if (atMs < cutoff) {
            skippedOld++;
            continue;
          }
          found.push({
            id: String(pl.id).slice(0, 40),
            cmd: String(pl.cmd).slice(0, 24),
            at: String(pl.at),
            note: typeof pl.note === "string" ? pl.note.slice(0, 180) : undefined,
            txid: String(entry.trx_id || ""),
            block: typeof entry.block === "number" ? entry.block : null,
          });
        }
        if (oldestSeen === Infinity || oldestSeen <= 1) break;
        start = Math.max(1, oldestSeen - 1);
      }
      return { commands: found, node: new URL(node).hostname, skippedOld };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`קריאת פקודות המפעיל נכשלה בכל הצמתים: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** שיגור workflow באמצעות ה-API — מותר רק בענן (יש טוקן) */
async function dispatchWorkflow(repo: string, workflow: string, token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status === 204) return { ok: true, detail: "dispatched" };
    const txt = (await res.text()).slice(0, 120);
    return { ok: false, detail: `HTTP ${res.status} ${txt}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

/**
 * עיבוד פקודות המפעיל — השלב שהלב מריץ בכל פעימה.
 * cloudAgentId: סוכן הענן מה-seal (חותם את אימוץ ה-OPERATOR).
 */
export async function processOperatorCommands(ctx: {
  runner: string;
  cloudAgentId: string;
  gitHead: string;
  repoSlug: string;
  runUrl?: string;
}): Promise<OperatorOpsResult> {
  const result: OperatorOpsResult = { executed: [], attSeqs: [], checkpoint: null, skippedOld: 0, readFrom: "" };
  const { commands, node, skippedOld } = await readOperatorCommands();
  result.readFrom = node;
  result.skippedOld = skippedOld;

  const log = loadOpsLog();
  const pending = commands
    .filter((c) => !log.executed[c.id])
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(0, MAX_PER_BEAT);

  if (pending.length === 0) return result;

  console.log(
    `[weave-ops] ${pending.length} פקודות מפעיל מהשרשרת (@${OPERATOR_ACCOUNT} · ${node} · חלון 48ש׳ · ${skippedOld} ישנות נספרו)`
  );

  const githubToken = process.env.GITHUB_TOKEN || "";
  const opsPat = process.env.WEAVE_OPS_PAT || "";

  for (const cmd of pending) {
    const executed: ExecutedCommand = {
      id: cmd.id,
      cmd: cmd.cmd,
      at: cmd.at,
      txid: cmd.txid,
      action: "",
      ok: false,
      executedAt: new Date().toISOString(),
    };
    try {
      if (cmd.cmd === "ping") {
        // נוכחות חתומה — נרשמת בספר כאימות OPERATOR ומכוסה checkpoint
        const claim =
          `פקודת מפעיל "ping" התקבלה מהשרשרת הציבורית מ-@${OPERATOR_ACCOUNT} — ` +
          `נוכחות חתומה של בעל הרשת, נאספה בפעימת הלב` +
          (cmd.note ? ` · דבר המפעיל: "${cmd.note}"` : "");
        const evidence = [
          `account=@${OPERATOR_ACCOUNT}`,
          `authority=posting (custom_json)`,
          `opId=${OPS_OP_ID}`,
          `txid=${cmd.txid}`,
          cmd.block ? `block=${cmd.block}` : null,
          `cmdId=${cmd.id}`,
          `cmdAt=${cmd.at}`,
          cmd.note ? `note=${cmd.note}` : null,
          `explorer=https://steemscan.com/transaction/${cmd.txid}`,
          `runner=${ctx.runner}`,
          `commit=${ctx.gitHead}`,
          ctx.runUrl ? `run=${ctx.runUrl}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const att = await appendAttestation({
          agentId: ctx.cloudAgentId,
          claim,
          claimType: "OPERATOR",
          evidence,
        });
        result.attSeqs.push(att.seq);
        executed.action = `OPERATOR attestation att${att.seq}`;
        executed.ok = true;
        executed.detail = att.entryHash.slice(0, 18);
        console.log(`[weave-ops] ping → אימות OPERATOR att${att.seq} · txid=${cmd.txid.slice(0, 12)}…`);
      } else if (cmd.cmd === "beat" || cmd.cmd === "anchor") {
        if (ctx.runner === "github-actions" && githubToken) {
          const wf = cmd.cmd === "beat" ? "weave-heart.yml" : "weave-anchor-lines.yml";
          const d = await dispatchWorkflow(ctx.repoSlug, wf, githubToken);
          executed.action = `dispatch ${wf}`;
          executed.ok = d.ok;
          executed.detail = d.detail;
          console.log(`[weave-ops] ${cmd.cmd} → dispatch ${wf}: ${d.ok ? "שוגר ✓" : `נכשל — ${d.detail}`}`);
        } else {
          executed.action = `dispatch ${cmd.cmd} (local — skipped honestly)`;
          executed.ok = true;
          executed.detail = "local runner has no dispatch token";
          console.log(`[weave-ops] ${cmd.cmd} → דילוג-כנה (רץ מקומית, אין טוקן dispatch)`);
        }
      } else if (cmd.cmd === "console") {
        if (ctx.runner === "github-actions" && opsPat) {
          const d = await dispatchWorkflow(`${OWNER}/Console`, "console-publish.yml", opsPat);
          executed.action = "dispatch Console/console-publish";
          executed.ok = d.ok;
          executed.detail = d.detail;
          console.log(`[weave-ops] console → dispatch משואה ציבורית: ${d.ok ? "שוגרה ✓" : `נכשל — ${d.detail}`}`);
        } else {
          executed.action = "dispatch console (no PAT — skipped honestly)";
          executed.ok = true;
          executed.detail = "runner without WEAVE_OPS_PAT";
          console.log(`[weave-ops] console → דילוג-כנה (אין WEAVE_OPS_PAT בסביבה)`);
        }
      } else {
        executed.action = "ignored-unknown-cmd";
        executed.ok = true;
        executed.detail = `cmd="${cmd.cmd}" אינה בסט הפקודות (ping/beat/anchor/console)`;
        console.log(`[weave-ops] פקודה לא מוכרת "${cmd.cmd}" — נרשמה כמתעלמת בכנות`);
      }
    } catch (e) {
      executed.ok = false;
      executed.detail = e instanceof Error ? e.message.slice(0, 160) : String(e);
      console.log(`[weave-ops] פקודה ${cmd.cmd} (${cmd.id}) נכשלה — ${executed.detail}`);
    }
    log.executed[cmd.id] = executed;
    result.executed.push(executed);
  }

  saveOpsLog(log);

  // אימותי OPERATOR שנכתבו — מכוסים מיידי ב-checkpoint (העוגנים יעידו)
  if (result.attSeqs.length > 0) {
    const cp = await createCheckpointNow();
    if (cp) {
      result.checkpoint = { index: cp.index, root: cp.root };
      console.log(`[weave-ops] checkpoint #${cp.index} מכסה את אימותי המפעיל (att ${cp.attFrom}..${cp.attTo})`);
    }
  }
  // ניקוי עדין: רשומות מעל 30 יום מתנקות מה-log (השרשרת + הגיט הם הארכיון)
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const ids = Object.keys(log.executed);
  let pruned = 0;
  for (const id of ids) {
    if (Date.parse(log.executed[id].executedAt) < monthAgo) {
      delete log.executed[id];
      pruned++;
    }
  }
  if (pruned > 0) {
    saveOpsLog(log);
    console.log(`[weave-ops] ${pruned} רשומות בנות-חודש+ נוקו מה-log (השרשרת היא הארכיון)`);
  }

  return result;
}
