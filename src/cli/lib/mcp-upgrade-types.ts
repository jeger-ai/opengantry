import type { McpErrorBody } from "./mcp-legislation-types.js";
import type { UpgradeApplyResult } from "./upgrade-apply.js";
import type { UpgradePlanResult } from "./upgrade-plan.js";

export type UpgradePlanMcpResult = UpgradePlanResult | { status: "error"; error: McpErrorBody };

export type UpgradeApplyMcpResult = UpgradeApplyResult | { status: "error"; error: McpErrorBody };
