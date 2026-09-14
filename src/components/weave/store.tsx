"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Store — הקשר נתונים משותף לכל הטאבים.
// טעינה עצלה (פעם אחת לכל מקור), רענון כפוי אחרי פעולות, וריכוז
// כל הקריאות POST במקום אחד. fetch יחסי בלבד.
// ─────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentDTO,
  AttestationDTO,
  CheckpointDTO,
  RepoDTO,
  StageDTO,
  VerifyReportDTO,
  WeaveStateDTO,
} from "@/lib/weave/types";
import { apiFetch, errorMessage } from "./api";

export interface Slice<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface TamperResult {
  seq: number;
  field: string;
  before: string;
  after: string;
}

export interface AttestInput {
  agentId: string;
  claim: string;
  claimType: string;
  evidence: string;
}

export interface RegisterAgentInput {
  name: string;
  role: string;
}

export interface CloseStageInput {
  code: string;
  attestationSeq: number;
}

interface WeaveContextValue {
  state: Slice<WeaveStateDTO>;
  attestations: Slice<AttestationDTO[]>;
  attTotal: number;
  agents: Slice<AgentDTO[]>;
  checkpoints: Slice<CheckpointDTO[]>;
  repos: Slice<RepoDTO[]>;
  stages: Slice<StageDTO[]>;
  report: Slice<VerifyReportDTO>;
  loadState: () => void;
  reloadState: () => void;
  loadAttestations: () => void;
  reloadAttestations: () => void;
  loadAgents: () => void;
  reloadAgents: () => void;
  loadCheckpoints: () => void;
  reloadCheckpoints: () => void;
  loadRepos: () => void;
  loadStages: () => void;
  runVerify: () => Promise<VerifyReportDTO>;
  attest: (input: AttestInput) => Promise<AttestationDTO>;
  tamper: (input?: { seq?: number; field?: string }) => Promise<TamperResult>;
  createCheckpoint: () => Promise<CheckpointDTO>;
  registerAgent: (input: RegisterAgentInput) => Promise<AgentDTO>;
  closeStage: (input: CloseStageInput) => Promise<StageDTO>;
}

const WeaveContext = createContext<WeaveContextValue | null>(null);

// ── fetchers ברמת המודול (זהות יציבה עבור useCallback) ──────────────

const fetchState = () =>
  apiFetch<{ state: WeaveStateDTO }>("/api/weave/state").then((r) => r.state);

const fetchAttestations = () =>
  apiFetch<{ total: number; entries: AttestationDTO[] }>(
    "/api/weave/attestations?limit=200"
  );

const fetchAgents = () =>
  apiFetch<{ agents: AgentDTO[] }>("/api/agents").then((r) => r.agents);

const fetchCheckpoints = () =>
  apiFetch<{ checkpoints: CheckpointDTO[] }>("/api/weave/checkpoints").then(
    (r) => r.checkpoints
  );

const fetchRepos = () =>
  apiFetch<{ repos: RepoDTO[] }>("/api/ecosystem").then((r) => r.repos);

const fetchStages = () =>
  apiFetch<{ stages: StageDTO[] }>("/api/plan").then((r) => r.stages);

// ── useSlice: טעינה חד-פעמית + רענון כפוי, עם הגנה מפני קריאות מקבילות ──

function useSlice<T>(fetcher: () => Promise<T>) {
  const [slice, setSlice] = useState<Slice<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const startedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (force: boolean) => {
      if (inFlightRef.current) return;
      if (!force && startedRef.current) return;
      startedRef.current = true;
      inFlightRef.current = true;
      setSlice((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fetcher();
        setSlice({ data, loading: false, error: null });
      } catch (err) {
        setSlice({ data: null, loading: false, error: errorMessage(err) });
      } finally {
        inFlightRef.current = false;
      }
    },
    [fetcher]
  );

  const loadLazy = useCallback(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { slice, loadLazy, reload };
}

export function WeaveProvider({ children }: { children: ReactNode }) {
  const { slice: stateSlice, loadLazy: loadState, reload: reloadState } =
    useSlice(fetchState);
  const { slice: attSlice, loadLazy: loadAttestations, reload: reloadAttestations } =
    useSlice(fetchAttestations);
  const { slice: agentsSlice, loadLazy: loadAgents, reload: reloadAgents } =
    useSlice(fetchAgents);
  const { slice: checkpointsSlice, loadLazy: loadCheckpoints, reload: reloadCheckpoints } =
    useSlice(fetchCheckpoints);
  const { slice: reposSlice, loadLazy: loadRepos } = useSlice(fetchRepos);
  const { slice: stagesSlice, loadLazy: loadStages, reload: reloadStages } =
    useSlice(fetchStages);

  // ── אימות שרשרת (read-only, ניתן להריץ חופשית) ────────────────────
  const [report, setReport] = useState<VerifyReportDTO | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyPromiseRef = useRef<Promise<VerifyReportDTO> | null>(null);

  const runVerify = useCallback((): Promise<VerifyReportDTO> => {
    if (verifyPromiseRef.current) return verifyPromiseRef.current;
    const promise = (async () => {
      setVerifying(true);
      setVerifyError(null);
      try {
        const res = await apiFetch<{ report: VerifyReportDTO }>("/api/weave/verify", {
          method: "POST",
        });
        setReport(res.report);
        return res.report;
      } catch (err) {
        setVerifyError(errorMessage(err));
        throw err;
      } finally {
        setVerifying(false);
        verifyPromiseRef.current = null;
      }
    })();
    verifyPromiseRef.current = promise;
    return promise;
  }, []);

  // ── פעולות ─────────────────────────────────────────────────────────

  const attest = useCallback(
    async (input: AttestInput) => {
      const res = await apiFetch<{ entry: AttestationDTO }>("/api/weave/attest", {
        method: "POST",
        body: JSON.stringify(input),
      });
      reloadAttestations();
      reloadState();
      return res.entry;
    },
    [reloadAttestations, reloadState]
  );

  const tamper = useCallback(
    async (input?: { seq?: number; field?: string }) => {
      const res = await apiFetch<TamperResult>("/api/weave/tamper", {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      });
      reloadAttestations();
      reloadState();
      return res;
    },
    [reloadAttestations, reloadState]
  );

  const createCheckpoint = useCallback(async () => {
    const res = await apiFetch<{ checkpoint: CheckpointDTO }>(
      "/api/weave/checkpoint",
      { method: "POST" }
    );
    reloadCheckpoints();
    reloadState();
    return res.checkpoint;
  }, [reloadCheckpoints, reloadState]);

  const registerAgent = useCallback(
    async (input: RegisterAgentInput) => {
      const res = await apiFetch<{ agent: AgentDTO }>("/api/agents", {
        method: "POST",
        body: JSON.stringify(input),
      });
      reloadAgents();
      reloadState();
      return res.agent;
    },
    [reloadAgents, reloadState]
  );

  const closeStage = useCallback(
    async (input: CloseStageInput) => {
      const res = await apiFetch<{ stage: StageDTO }>("/api/plan/close", {
        method: "POST",
        body: JSON.stringify(input),
      });
      // רענון כפוי — שלב שנסגר חייב להופיע מיד ב-UI (loadStages העצלן לא מספיק)
      void reloadStages();
      return res.stage;
    },
    [reloadStages]
  );

  const value = useMemo<WeaveContextValue>(() => {
    const attData = attSlice.data;
    return {
      state: stateSlice,
      attestations: {
        data: attData ? attData.entries : null,
        loading: attSlice.loading,
        error: attSlice.error,
      },
      attTotal: attData ? attData.total : 0,
      agents: agentsSlice,
      checkpoints: checkpointsSlice,
      repos: reposSlice,
      stages: stagesSlice,
      report: { data: report, loading: verifying, error: verifyError },
      loadState,
      reloadState,
      loadAttestations,
      reloadAttestations,
      loadAgents,
      reloadAgents,
      loadCheckpoints,
      reloadCheckpoints,
      loadRepos,
      loadStages,
      runVerify,
      attest,
      tamper,
      createCheckpoint,
      registerAgent,
      closeStage,
    };
  }, [
    stateSlice,
    attSlice,
    agentsSlice,
    checkpointsSlice,
    reposSlice,
    stagesSlice,
    report,
    verifying,
    verifyError,
    loadState,
    reloadState,
    loadAttestations,
    reloadAttestations,
    loadAgents,
    reloadAgents,
    loadCheckpoints,
    reloadCheckpoints,
    loadRepos,
    loadStages,
    runVerify,
    attest,
    tamper,
    createCheckpoint,
    registerAgent,
    closeStage,
  ]);

  return <WeaveContext.Provider value={value}>{children}</WeaveContext.Provider>;
}

export function useWeave(): WeaveContextValue {
  const ctx = useContext(WeaveContext);
  if (!ctx) {
    throw new Error("useWeave must be used within WeaveProvider");
  }
  return ctx;
}
