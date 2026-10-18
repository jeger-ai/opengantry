/** Mission, triage, gate and KPI types shared by every package (ADR-0052 step 5c-i; pure). */
import type { MissionContract } from "./contract-types.js";
import type { NormalizedTraceStatus } from "./trace-status.js";
import type { InterrogationRow } from "./interrogation.js";
import type { GateAdapterId } from "./gate-adapter.js";

export type { MissionContract } from "./contract-types.js";
export type { GateAdapterId, TypedGateAdapterId } from "./gate-adapter.js";
export { DEFAULT_GATE_ADAPTER, GATE_ADAPTER_IDS, TYPED_GATE_ADAPTER_IDS, isGateAdapterId, isTypedGateAdapterId } from "./gate-adapter.js";

export type { TrustThreshold, SkillEntry, Manifest } from "./manifest.js";

export type TriageAction = "DIRECT_EXECUTION" | "LEGISLATIVE_ESCALATION";

/** Non-binding ADR hint from `.gitagent/out-of-scope/` (Foreman does not route on this). */
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

export type KpiThresholdOp = "<=" | ">=" | "==" | "<" | ">";

export interface KpiThreshold {
  metric: string;
  op: KpiThresholdOp;
  value: number;
}

export interface KpiGateSpec {
  reportPath: string;
  thresholds: KpiThreshold[];
}

export type KpiAggregatorOp = "max" | "min" | "sum";

export interface KpiAggregator {
  key: string;
  op: KpiAggregatorOp;
  sources: string[];
}

export interface LlmVerifierSpec {
  id: string;
  command: string;
  provider?: string;
  required: boolean;
}

export interface KpiFinding {
  id?: string;
  doc_anchor?: string;
  severity: "info" | "warn" | "error";
  path: string;
  line?: number;
  message: string;
}

export interface KpiReport {
  msn_id: string;
  generated_at: string;
  exit_code: number;
  metrics: Record<string, number | boolean>;
  findings?: KpiFinding[];
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
  kpiGate: KpiGateSpec | null;
  /** Opt-in ephemeral gate capture under .gitagent/virtual/ (issue #68). */
  virtualCapture: boolean;
  llmVerifiers: LlmVerifierSpec[];
  aggregators: KpiAggregator[];
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
  kpi_gate?: {
    report_path?: string;
    thresholds: Array<{ metric: string; op: string; value: number }>;
  };
  llm_verifiers?: Array<{
    id: string;
    command: string;
    provider?: string;
    required?: boolean;
  }>;
  aggregators?: Array<{ key: string; op: string; sources: string[] }>;
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
