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

export interface TriageResult {
  action: TriageAction;
  skill_key: string | "NONE";
  risk_tier: string;
  tmvc_roots: string[];
  forbidden_zones: string[];
  reason: string;
}

export interface GateSpec {
  command: string;
  successSubstring: string | null;
}

export interface TraceRow {
  dodId: string;
  traceQuote: string;
  anchor: string;
  status: string;
}

export interface ParsedMission {
  msnId: string | null;
  skillKey: string | null;
  gate: GateSpec | null;
  traceRows: TraceRow[];
  rawPath: string;
}
