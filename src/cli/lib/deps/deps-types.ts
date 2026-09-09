export interface MissionDependency {
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

export type DependencyCheckCode =
  | "ok"
  | "GXT_DEPENDENCY_UNFETCHED"
  | "GXT_DEPENDENCY_UNSATISFIED"
  | "GXT_DEPENDENCY_UNSIGNED"
  | "GXT_DEPENDENCY_STALE"
  | "GXT_DEPENDENCY_ORG_MISMATCH";

export interface DependencyCheckResult {
  repo: string;
  msn_id: string;
  code: DependencyCheckCode;
  message: string;
}
