export const PREFLIGHT_PROVIDERS = ["heuristic", "jev"] as const;
export type PreflightProvider = (typeof PREFLIGHT_PROVIDERS)[number];

export const PREFLIGHT_MIN_CONFIDENCE = 0.5;

export type JevFallbackReason =
  | "malformed_response"
  | "unexpected_choice"
  | "transport_error"
  | "timeout"
  | "invalid_probability";

export interface TmvcRootCandidate {
  path: string;
  score: number;
}

export interface PreflightResult {
  provider: PreflightProvider;
  skill_key: string | null;
  skill_confidence: number;
  tmvc_root_candidates: TmvcRootCandidate[];
  escalate: boolean;
  rationale: string[];
}

export function isPreflightProvider(value: string): value is PreflightProvider {
  return (PREFLIGHT_PROVIDERS as readonly string[]).includes(value);
}

export function jevFallbackRationale(reason: JevFallbackReason): string {
  return `jev_fallback: ${reason}`;
}
