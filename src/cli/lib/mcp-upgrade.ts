import { getRepoRoot } from "./git.js";
import { runUpgradeApply } from "./upgrade-apply.js";
import { runUpgradePlan } from "./upgrade-plan.js";
import { GapmanUserError } from "./user-error.js";

export interface UpgradePlanMcpInput {
  msn_id?: string;
  dry_run?: boolean;
}

export function handleUpgradePlan(input: UpgradePlanMcpInput = {}): Record<string, unknown> {
  const repoRoot = getRepoRoot();
  try {
    return { ...runUpgradePlan({
      repoRoot,
      msn: input.msn_id,
      dryRun: input.dry_run === true,
      json: true,
    }) };
  } catch (e) {
    return mcpErrorBody(e);
  }
}

export function handleUpgradeApply(missionFilePath?: string): Record<string, unknown> {
  const repoRoot = getRepoRoot();
  try {
    return { ...runUpgradeApply({
      repoRoot,
      mission: missionFilePath,
      json: true,
    }) };
  } catch (e) {
    return mcpErrorBody(e);
  }
}

function mcpErrorBody(e: unknown): Record<string, unknown> {
  if (e instanceof GapmanUserError) {
    return { error: e.code, message: e.message, hint: e.hint };
  }
  return { error: "UPGRADE_ERROR", message: e instanceof Error ? e.message : String(e) };
}
