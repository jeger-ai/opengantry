export const REL_UPGRADE_TMP = ".gitagent/.upgrade-tmp" as const;
export { UPGRADE_MSN_BAND_MIN, UPGRADE_MSN_BAND_MAX } from "./msn-allocate.js";

export interface UpgradeFileChange {
  path: string;
  action: "add" | "update";
  bytes_before: number | null;
  bytes_after: number;
  sha256_before: string | null;
  sha256_after: string;
}

export interface UpgradePayload {
  from_version: string;
  to_version: string;
  staged_root: typeof REL_UPGRADE_TMP;
  planned_writes: string[];
  skipped_scaffold_only: string[];
  staged_hashes: Record<string, string>;
  created_at: string;
}

export interface UpgradePlanResult {
  status: "planned" | "already_current" | "downgrade_blocked" | "no_changes";
  from_version: string;
  to_version: string;
  installed_source?: string;
  message?: string;
  mission_path?: string;
  mission_rel?: string;
  suggested_human_action?: string;
  planned_writes?: string[];
  skipped_scaffold_only?: string[];
  unchanged?: string[];
  legacy_warning?: string | null;
  file_changes?: UpgradeFileChange[];
  changes_by_category?: Record<string, UpgradeFileChange[]>;
}

export interface RunUpgradePlanOptions {
  repoRoot: string;
  templatesRoot?: string;
  msn?: string;
  dryRun?: boolean;
  json?: boolean;
}
