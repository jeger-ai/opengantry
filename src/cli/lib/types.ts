import type { NormalizedTraceStatus } from "./trace-status.js";

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
  /** Optional; never changes `action` — Teacher resolves ADRs during legislation. */
  adr_hints?: AdrHint[];
}

export interface GateSpec {
  command: string;
  successSubstring: string | null;
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
  traceRows: TraceRow[];
  rawPath: string;
}

/** Structured mission on disk (YAML), validated by gapman */
export interface YamlMission {
  msn_id?: string;
  msnId?: string;
  skill_key: string;
  gate_command: string;
  gate_success_substring?: string | null;
  trace_rows?: Array<{
    dod_id: string;
    trace_quote: string;
    anchor: string;
    status: string;
  }>;
}
