import { errorMessage } from "./cli-io.js";
import { getRepoRoot } from "./git.js";
import type { McpErrorBody } from "./mcp-governance.js";
import type { UpgradeApplyResult } from "./upgrade-apply.js";
import type { UpgradePlanResult } from "./upgrade-plan.js";
import { runUpgradeApply } from "./upgrade-apply.js";
import { runUpgradePlan } from "./upgrade-plan.js";
import { GapmanUserError } from "./errors.js";

export type UpgradePlanMcpResult = UpgradePlanResult | { status: "error"; error: McpErrorBody };

export type UpgradeApplyMcpResult = UpgradeApplyResult | { status: "error"; error: McpErrorBody };

export interface UpgradePlanMcpInput {
  msn_id?: string;
  dry_run?: boolean;
}

function mcpErrorBody(e: unknown): { status: "error"; error: McpErrorBody } {
  if (e instanceof GapmanUserError) {
    return {
      status: "error",
      error: { code: e.code, message: e.message, retryable: false },
    };
  }
  return {
    status: "error",
    error: { code: "UPGRADE_ERROR", message: errorMessage(e), retryable: false },
  };
}

export function handleUpgradePlan(input: UpgradePlanMcpInput = {}): UpgradePlanMcpResult {
  const repoRoot = getRepoRoot();
  try {
    return runUpgradePlan({
      repoRoot,
      msn: input.msn_id,
      dryRun: input.dry_run === true,
      json: true,
    });
  } catch (e) {
    return mcpErrorBody(e);
  }
}

export async function handleUpgradeApply(missionFilePath?: string): Promise<UpgradeApplyMcpResult> {
  const repoRoot = getRepoRoot();
  try {
    return await runUpgradeApply({
      repoRoot,
      mission: missionFilePath,
      json: true,
    });
  } catch (e) {
    return mcpErrorBody(e);
  }
}
