// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Live Cloud Layer — האמת מהענן, בלי תלות בסנדבוקס.
//
// הסנדבוקס מת וחי מחדש — הרשת בענן ממשיכה לפעום. שכבה זו שולפת
// את האמת החיה מהמראה הציבורית (Console repo) ומה-API של גיטהאב,
// עם מטמון קצר (60 ש') כדי לא להציף. הסודות (PAT) נשארים צד-שרת
// בלבד — אף תשובה לעולם לא מחזירה אותם.
// ─────────────────────────────────────────────────────────────────────

import { readFile } from "fs/promises";
import path from "path";

const OWNER = "roshpinacare-sys";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/Console/main`;
const GH_API = "https://api.github.com";

// ── מטמון פשוט בזיכרון (TTL לכל מפתח) ─────────────────────────────

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

async function fetchJsonCached<T>(
  key: string,
  url: string,
  init?: RequestInit,
  ttlMs = 60_000
): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "the-weave-live/1.0",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`ענן השיב ${res.status} עבור ${key}`);
    }
    const value = (await res.json()) as T;
    cache.set(key, { at: now, value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

// ── המראה הציבורית (mirror.json) — נגזרת אמת, בלי סודות ────────────

export interface MirrorAttestation {
  seq: number;
  type: string;
  status: string;
  at: string;
  agentName: string;
  claim: string;
}
export interface MirrorCheckpoint {
  index: number;
  root: string;
  attFrom: number;
  attTo: number;
  at: string;
  anchoredOn: string[];
}
export interface MirrorAgent {
  name: string;
  role: string;
  status: string;
  address: string;
  attestations: number;
  lastAttestationSeq: number | null;
  lastAttestationAt: string | null;
}
export interface MirrorBrain {
  fingerprint: string;
  status: string;
  lastCode: string;
  verifiedAt: string;
}
export interface MirrorStats {
  attestations: number;
  checkpoints: number;
  agents: number;
  brainKeys: number;
  brainLive: number;
  attByStatus: Record<string, number>;
  headHash: string;
}
export interface Mirror {
  format: string;
  generatedAt: string;
  stats: MirrorStats;
  agents: MirrorAgent[];
  attestations: MirrorAttestation[];
  checkpoints: MirrorCheckpoint[];
  anchorLines: { steem?: unknown[]; zero?: unknown[]; [k: string]: unknown[] | undefined };
  market: Array<{ seq: number; kind: string; at: string; summary: string }>;
  brain: MirrorBrain[];
}

export function getMirror(): Promise<Mirror> {
  return fetchJsonCached<Mirror>("mirror", `${RAW_BASE}/mirror.json`, undefined, 60_000);
}

// ── עד השרשרת הציבורית (status.json — Steem public RPC) ─────────────

export interface ChainStatus {
  format: string;
  generatedAt: string;
  source: { kind: string; node: string; account: string; opId: string };
  freshness: { verdict: string; ageHours: number; thresholdHours: number; cadence: string };
  witness: {
    account: string;
    opId: string;
    txid: string;
    block: number;
    explorer: string;
    at: string;
    checkpoint: number;
    root: string;
    attFrom: number;
    attTo: number;
    attestations: number;
    headHash: string;
    commit: string;
  };
}

export function getChainStatus(): Promise<ChainStatus> {
  return fetchJsonCached<ChainStatus>("status", `${RAW_BASE}/status.json`, undefined, 60_000);
}

// ── רישום הסוכנים הציבורי (agents/registry.json) ────────────────────

export interface RegistryAgent {
  id: string;
  name: string;
  repo: string;
  visibility: string;
  schedule: string;
  layer: string;
  role: { en: string; he: string };
  input: { en: string; he: string };
  output: { en: string; he: string };
  state: string;
  stats?: {
    runs_sampled: number;
    success: number;
    failure: number;
    other: number;
    successRate: number;
    avgDurS: number;
  };
  lastRun?: { at: string; conclusion: string };
}
export interface AgentsRegistry {
  ok: boolean;
  generatedAt: string;
  source: string;
  reposTotal: number;
  reposWithAgents: string[];
  reposIdle: string[];
  agents: RegistryAgent[];
}

export function getAgentsRegistry(): Promise<AgentsRegistry> {
  return fetchJsonCached<AgentsRegistry>(
    "registry",
    `${RAW_BASE}/agents/registry.json`,
    undefined,
    120_000
  );
}

// ── מצב הסוכן הציבורי (agent/state.json) — הנחיות ופאזה ──────────────

export interface AgentStatePublic {
  format: string;
  phase: string;
  standingOrders: Array<{ id: string; en?: string; he?: string }>;
  [k: string]: unknown;
}

export function getAgentState(): Promise<AgentStatePublic> {
  return fetchJsonCached<AgentStatePublic>(
    "agent-state",
    `${RAW_BASE}/agent/state.json`,
    undefined,
    120_000
  );
}

// ── ספר הבקשות הציבורי (agent/requests.json) ─────────────────────────

export interface AgentRequestsPublic {
  requests: Array<{ id: string; status: string }>;
  [k: string]: unknown;
}

export function getAgentRequests(): Promise<AgentRequestsPublic> {
  return fetchJsonCached<AgentRequestsPublic>(
    "agent-requests",
    `${RAW_BASE}/agent/requests.json`,
    undefined,
    120_000
  );
}

// ── תוצאות האימות העצמאי (agent/verify/results.json) ─────────────────

export interface VerifyResultsPublic {
  summary: { total: number; passed: number; failed: number; verdict: string };
  [k: string]: unknown;
}

export function getVerifyResults(): Promise<VerifyResultsPublic> {
  return fetchJsonCached<VerifyResultsPublic>(
    "verify-results",
    `${RAW_BASE}/agent/verify/results.json`,
    undefined,
    120_000
  );
}

// ── ה-PAT — מה-remote של הגיט, צד-שרת בלבד ──────────────────────────

let cachedToken: string | null | undefined;

export async function getGhToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    const cfg = await readFile(path.join(process.cwd(), ".git/config"), "utf8");
    const m = cfg.match(/x-access-token:([^@]+)@/);
    cachedToken = m ? m[1] : null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

// ── GitHub API — פעילות ריפואים וריצות ─────────────────────────────

export interface RepoInfo {
  name: string;
  pushedAt: string;
  private: boolean;
  archived: boolean;
}

export async function getRepos(): Promise<RepoInfo[]> {
  const token = await getGhToken();
  const repos = await fetchJsonCached<Array<{ name: string; pushed_at: string; private: boolean; archived: boolean }>>(
    "repos",
    `${GH_API}/user/repos?per_page=100&sort=pushed&affiliation=owner`,
    token ? { headers: { Authorization: `token ${token}` } } : undefined,
    120_000
  );
  return repos.map((r) => ({
    name: r.name,
    pushedAt: r.pushed_at,
    private: r.private,
    archived: r.archived,
  }));
}

export interface WorkflowRunInfo {
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  event: string;
  htmlUrl: string;
}

export async function getRecentRuns(repo: string, perPage = 5): Promise<WorkflowRunInfo[]> {
  const token = await getGhToken();
  const data = await fetchJsonCached<{ workflow_runs?: Array<{
    name: string; status: string; conclusion: string | null; created_at: string; event: string; html_url: string;
  }> }>(
    `runs:${repo}`,
    `${GH_API}/repos/${OWNER}/${repo}/actions/runs?per_page=${perPage}`,
    token ? { headers: { Authorization: `token ${token}` } } : undefined,
    60_000
  );
  return (data.workflow_runs ?? []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    event: r.event,
    htmlUrl: r.html_url,
  }));
}

// ── הפעלת סוכן ענן (workflow dispatch) — היד של המפעיל ───────────────

export const DISPATCHABLE: Array<{ repo: string; workflow: string; label: string; description: string }> = [
  { repo: "Zip", workflow: "weave-heart.yml", label: "פעימת לב", description: "אימות שרשרת + קומיט פעימה + הזנקת קווי העוגן" },
  { repo: "Zip", workflow: "weave-anchor-lines.yml", label: "קווי עוגן", description: "עיגון Steem/Hive/ZERO לצ'קפוינט האחרון" },
  { repo: "Zip", workflow: "weave-ecosystem.yml", label: "סריקת אקוסיסטם", description: "מדידת שכפול בכל 14 הריפואים" },
  { repo: "steem", workflow: "cloud-heart.yml", label: "לב הצי", description: "פעימת saosnet live מול RPC ציבורי" },
  { repo: "saos-dex", workflow: "dex-beat.yml", label: "פעימת בורסה", description: "חישוב שוק + פרסום נתוני DEX" },
  { repo: "saos-dex", workflow: "dex-grid.yml", label: "גריד חוץ", description: "ריצת הגריד החיצוני — ספר STEEM/SBD החי, ממיין מחדש ומפרסם לקונסולה" },
  { repo: "Console", workflow: "agents-watch.yml", label: "רענון רישום סוכנים", description: "עדכון registry מה-API של גיטהאב" },
  { repo: "Console", workflow: "dex-watch.yml", label: "סריקת הפקדות", description: "סריקת TRON/ETH/SOL/BTC אחר כסף נכנס" },
];

export async function dispatchWorkflow(repo: string, workflow: string): Promise<void> {
  const allowed = DISPATCHABLE.some((d) => d.repo === repo && d.workflow === workflow);
  if (!allowed) throw new Error("סוכן זה אינו ברשימת ההפעלה המאושרת");
  const token = await getGhToken();
  if (!token) throw new Error("אין אסמכתה צד-שרת לגיטהאב — לא ניתן להפעיל");
  const res = await fetch(
    `${GH_API}/repos/${OWNER}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "the-weave-live/1.0",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  if (!res.ok && res.status !== 202) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`גיטהאב סירב (${res.status}): ${body}`);
  }
}

// ── חישוב חיות מהמראה (בלי DB מקומי) ────────────────────────────────

export function computeVitalityFromMirror(mirror: Mirror): {
  atts24h: number;
  atts7d: number;
  checkpoints24h: number;
  lastAttAgeMin: number;
  aliveDays: number;
} {
  const now = Date.now();
  const at = (iso: string) => new Date(iso).getTime();
  const atts = mirror.attestations;
  const cps = mirror.checkpoints;
  const atts24h = atts.filter((a) => now - at(a.at) < 86_400_000).length;
  const atts7d = atts.filter((a) => now - at(a.at) < 7 * 86_400_000).length;
  const checkpoints24h = cps.filter((c) => now - at(c.at) < 86_400_000).length;
  const lastAttAgeMin = atts.length
    ? Math.max(0, Math.round((now - at(atts[0].at)) / 60_000))
    : -1;
  const first = atts.length ? at(atts[atts.length - 1].at) : now;
  const aliveDays = Math.max(1, Math.round((now - first) / 86_400_000));
  return { atts24h, atts7d, checkpoints24h, lastAttAgeMin, aliveDays };
}
