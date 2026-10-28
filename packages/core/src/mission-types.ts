/** Mission, triage and gate types shared by every package (ADR-0052 step 5c-i; pure). */
import type { MissionContract } from "./contract-types.js";
import type { NormalizedTraceStatus } from "./trace-status.js";
import type { InterrogationRow } from "./interrogation.js";
import type { GateAdapterId } from "./gate-adapter.js";

export type TriageAction = "DIRECT_EXECUTION" | "LEGISLATIVE_ESCALATION";

/** Non-binding ADR hint from `.gitagent/out-of-scope/` (triage does not route on this). */
export interface AdrHint {
  id: string;
  title?: string;
  note: string;
}

export interface TriageResult {
  action: TriageAction;
  skill_key: string | "NONE";
  risk_tier: string;
  tmvc_roots: string[];
  forbidden_zones: string[];
  reason: string;
  /** 0–1 routing confidence (1 = single unambiguous skill match). */
  confidence: number;
  /** Human-readable signals that informed routing. */
  match_reasons: string[];
  /** Optional; never changes `action` — Planner resolves ADRs during legislation. */
  adr_hints?: AdrHint[];
}

export interface GateSpec {
  command: string;
  successSubstring: string | null;
  /** Always set in memory; YAML/token writers omit `generic`. */
  adapter: GateAdapterId;
}

export interface TraceRow {
  dodId: string;
  traceQuote: string;
  anchor: string;
  status: NormalizedTraceStatus;
}

export interface MissionDependencySpec {
  repo: string;
  ref?: string;
  msn_id: string;
  require?: {
    verify_status?: "passed";
    signed?: boolean;
    max_age_days?: number;
  };
  expected_repository_hash?: string;
}

/** Fallback MSN when a mission has no id (CLI defaults, ledger rows). */
export function msnIdOrDefault(mission: { msnId?: string | null } | null | undefined): string {
  return mission?.msnId ?? "MSN-0000";
}

export interface ParsedMission {
  msnId: string | null;
  skillKey: string | null;
  gate: GateSpec | null;
  /** Opt-in ephemeral gate capture under .gitagent/virtual/ (issue #68). */
  virtualCapture: boolean;
  traceRows: TraceRow[];
  interrogation: InterrogationRow[];
  interrogationSha256: string | null;
  declaredPaths: string[];
  dependsOn: MissionDependencySpec[];
  /** Normalized contract block, or null when the mission declares none. */
  contract: MissionContract | null;
  contractSha256: string | null;
  rawPath: string;
}

/** Structured mission on disk (YAML), validated by gantry */
export interface YamlMission {
  msn_id?: string;
  msnId?: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string | null;
  gate_adapter?: GateAdapterId;
  virtual_capture?: boolean;
  trace_rows?: Array<{
    dod_id: string;
    trace_quote: string;
    anchor: string;
    status: string;
  }>;
  interrogation?: Array<{
    finding_id: string;
    kind: string;
    question: string;
    hypothesis: string;
    operator_answer: string;
    adr_refs?: string[];
  }>;
  interrogation_sha256?: string;
  declared_paths?: string[];
  depends_on?: MissionDependencySpec[];
  contract?: MissionContract;
  contract_sha256?: string;
}
