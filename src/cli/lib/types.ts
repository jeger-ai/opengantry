import type { NormalizedTraceStatus } from "./trace.js";

export type TrustThreshold = "Tier-1" | "Tier-2" | "Tier-3" | string;

export interface SkillEntry {
  desc?: string;
  trust_threshold: TrustThreshold;
  tmvc_roots: string[];
  forbidden_zones: string[];
}

export interface Manifest {
  schema_version: string;
  skills: Record<string, SkillEntry>;
  path_risks: Record<string, string>;
  risk_keywords: string[];
  /** Globs requiring Teacher-stamped (CI: signed) commits to modify. */
  perimeter_protected?: string[];
}

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
  rawPath: string;
}

/** Structured mission on disk (YAML), validated by gantry */
export interface YamlMission {
  msn_id?: string;
  msnId?: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string | null;
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
}
