// ─────────────────────────────────────────────────────────────────────────────
// THE WEAVE · heartbeat — חיות-מסילת-הלב (mainnet) נמדדת, לא נטענת
//
// Task 18 · לקח-הפורנזיקה (מדידה חיה 2026-10-08): עוגני h25/h26 — שנקראו
// בחזרה GREEN ב-Task 17 — התגלו כבני-26-יום. זהות-העיגון מורעבת-גז
// (יתרה נמדדה ≈ 3.7e-7 ETH). המסילה לא מתה-מבחירה — היא רעבה. מעכשיו
// decide() מודד את זה בכל שעה: אפס-דופק ⇒ QUEUE למפעיל (חוק-פיצול-המטבע:
// הזרמת-גז = כסף-חיצוני = רק-המפעיל).
//
// שיטה (keyless, אפס-סודות, אפס-שידור):
//   · קריאה-חוזרת של טקס-הבסל (עוגן h26, אומת בייט-מול-בייט) → זהות-העיגון
//   · נונסה מול-בלוק-הבסל מול-עכשיו: אפס-טקסים-חדשים = אפס-דופק (מדידה)
//   · יתרת-הזהות: הוכחת-הרעב (לא ניחוש)
//   · אם-נוצרו-טקסים: סריקה אחורה מה-HEAD אחרי self-tx (to==from) עם
//     calldata 36B = root(32B)‖height(4B) — העוגנים-החדשים נמצאים ומדודים
//
// פסיקות: ALIVE · STALE (מעבר-סף-גיל) · STARVED (אפס-טקסים + יתרה≈0)
// · UNMEASURED (כשל-רשת — כנות, לא אפס-מומצא).
// ─────────────────────────────────────────────────────────────────────────────

const BASELINE_TXID = "0x87c490aed4d07d373c554029e437275ed152b1f46514dd9eae492a944134722b"; // עוגן h26 (ריפו-פרטי — ה-txid המלא כאן בלבד)
const BASELINE_HEIGHT = 26;
const DEFAULT_SCAN_BACK = 300;
const DEFAULT_THRESHOLD_HOURS = 48;
const RPCS = [
  "https://eth.llamarpc.com",
  "https://eth.drpc.org",
  "https://cloudflare-eth.com",
  "https://rpc.ankr.com/eth",
];

export type HeartbeatVerdict = "ALIVE" | "STALE" | "STARVED" | "UNMEASURED";

export interface HeartbeatAnchor {
  block: number;
  root: string;
  height: number;
}

export interface HeartbeatLiveness {
  at: string;
  ok: boolean; // נמדד (גם STALE הוא מדידה-תקפה); UNMEASURED = לא נמדד
  verdict: HeartbeatVerdict;
  identityCensored: string;
  baselineHeight: number;
  baselineAgeHours: number | null;
  newTxsSinceBaseline: number | null;
  balanceEth: number | null;
  latestAnchor: HeartbeatAnchor | null;
  noteHe: string;
}

async function rpcCall<T>(method: string, params: unknown[], timeoutMs = 9000): Promise<T | null> {
  for (const rpc of RPCS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      const j = (await res.json()) as { result?: T };
      if (j.result !== undefined && j.result !== null) return j.result;
    } catch {
      clearTimeout(t);
    }
  }
  return null;
}

export async function heartbeatLiveness(
  opts: { scanBack?: number; thresholdHours?: number } = {},
): Promise<HeartbeatLiveness> {
  const at = new Date().toISOString();
  const scanBack = opts.scanBack ?? DEFAULT_SCAN_BACK;
  const thresholdHours = opts.thresholdHours ?? DEFAULT_THRESHOLD_HOURS;

  const base: Omit<HeartbeatLiveness, "ok" | "verdict" | "noteHe"> = {
    at,
    identityCensored: "?",
    baselineHeight: BASELINE_HEIGHT,
    baselineAgeHours: null,
    newTxsSinceBaseline: null,
    balanceEth: null,
    latestAnchor: null,
  };

  try {
    // 0) זהות-העיגון מטקס-הבסל
    const tx = await rpcCall<{ from: string; blockNumber: string }>("eth_getTransactionByHash", [BASELINE_TXID]);
    if (!tx?.from) return { ...base, ok: false, verdict: "UNMEASURED", noteHe: "טקס-הבסל לא נשלף — אין-מדידה (fail-closed)" };
    const identity = String(tx.from).toLowerCase();
    const identityCensored = `${identity.slice(0, 10)}…${identity.slice(-6)}`;
    const anchorBlock = parseInt(String(tx.blockNumber), 16);

    // 1) גיל-הבסל
    const headHex = await rpcCall<string>("eth_blockNumber", []);
    const head = parseInt(String(headHex ?? ""), 16);
    if (!Number.isFinite(head)) return { ...base, ok: false, verdict: "UNMEASURED", identityCensored, noteHe: "HEAD לא נמדד — אין-מדידה" };
    const blk = await rpcCall<{ timestamp: string }>("eth_getBlockByNumber", ["0x" + anchorBlock.toString(16), false]);
    const baseTs = parseInt(String(blk?.timestamp ?? "0"), 16);
    const baselineAgeHours = baseTs ? Math.round(((Date.now() / 1000 - baseTs) / 3600) * 100) / 100 : null;

    // 2) נונסה + יתרה — הוכחת-הרעב
    const nonceAt = parseInt((await rpcCall<string>("eth_getTransactionCount", [identity, "0x" + anchorBlock.toString(16)])) ?? "", 16);
    const nonceNow = parseInt((await rpcCall<string>("eth_getTransactionCount", [identity, "latest"])) ?? "", 16);
    const balWei = await rpcCall<string>("eth_getBalance", [identity, "latest"]);
    const balanceEth = balWei ? parseInt(String(balWei), 16) / 1e18 : null;
    const newTxs = Number.isFinite(nonceAt) && Number.isFinite(nonceNow) ? nonceNow - nonceAt : null;

    if (newTxs == null) {
      return { ...base, ok: false, verdict: "UNMEASURED", identityCensored, baselineAgeHours, balanceEth, noteHe: "נונסה לא נמדדה — אין-מדידה" };
    }

    // 3) איתור-עוגנים-חדשים (רק אם-יש מה למצוא)
    let latestAnchor: HeartbeatAnchor | null = null;
    if (newTxs > 0) {
      const found: HeartbeatAnchor[] = [];
      for (let b = head; b > head - scanBack && found.length < newTxs; b--) {
        const full = await rpcCall<{ transactions: Array<{ from: string | null; to: string | null; input: string }> }>(
          "eth_getBlockByNumber",
          ["0x" + b.toString(16), true],
        );
        for (const t of full?.transactions ?? []) {
          const input = String(t.input ?? "");
          if (input.length !== 74) continue; // root(32B)‖height(4B) בדיוק
          if (!t.from || String(t.to ?? "").toLowerCase() !== String(t.from).toLowerCase()) continue;
          const raw = Buffer.from(input.slice(2), "hex");
          found.push({ block: b, root: "0x" + raw.slice(0, 32).toString("hex"), height: raw.readUInt32BE(32) });
        }
      }
      found.sort((a, b) => a.height - b.height);
      latestAnchor = found.length ? found[found.length - 1] : null;
    }

    // 4) פסיקה
    const starved = newTxs === 0 && balanceEth != null && balanceEth < 1e-6;
    const withinThreshold = baselineAgeHours != null && baselineAgeHours <= thresholdHours;
    if (newTxs > 0 && latestAnchor) {
      return {
        ...base, ok: true, verdict: "ALIVE", identityCensored, baselineAgeHours, newTxsSinceBaseline: newTxs, balanceEth, latestAnchor,
        noteHe: `הלב חי: עוגן h${latestAnchor.height} (בלוק ${latestAnchor.block}) — נמדד חי מהשרשרת`,
      };
    }
    if (starved) {
      return {
        ...base, ok: true, verdict: "STARVED", identityCensored, baselineAgeHours, newTxsSinceBaseline: 0, balanceEth,
        noteHe: `המסילה מורעבת: אפס-עוגנים ${baselineAgeHours?.toFixed(0) ?? "?"}ש' + יתרה ${balanceEth?.toExponential(1)} ETH — הזרמת-גז = המפעיל (QUEUE)`,
      };
    }
    if (!withinThreshold) {
      return {
        ...base, ok: true, verdict: "STALE", identityCensored, baselineAgeHours, newTxsSinceBaseline: newTxs, balanceEth, latestAnchor,
        noteHe: `אפס-דופק ${baselineAgeHours?.toFixed(0) ?? "?"}ש' (סף ${thresholdHours}ש') — נדרשת-החלטת-מפעיל`,
      };
    }
    return {
      ...base, ok: true, verdict: "ALIVE", identityCensored, baselineAgeHours, newTxsSinceBaseline: newTxs, balanceEth, latestAnchor,
      noteHe: `הלב בתוך-הסף (${baselineAgeHours?.toFixed(1)}ש' מתוך ${thresholdHours}ש') — אפס-עוגנים-חדשים אך טרם-עבר-סף`,
    };
  } catch (e) {
    return { ...base, ok: false, verdict: "UNMEASURED", noteHe: `סורק-הלב נכשל: ${String((e as Error)?.message ?? e).slice(0, 100)}` };
  }
}
