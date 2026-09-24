import { runPreflight, type PreflightProvider, type PreflightResult } from "../contract/preflight.js";
import { TYPESAFE_API_KEY_ENV } from "../contract/preflight-jev.js";
import { isGantryUserError } from "../errors.js";
import { mcpError, type McpErrorBody } from "./mcp-governance-shared.js";
import { loadWorkspace } from "../workspace.js";

export interface PreflightContractMcpInput {
  intent: string;
  paths?: string[];
  provider?: PreflightProvider;
}

export type PreflightContractMcpResult =
  | ({ status: "ok" } & PreflightResult)
  | { status: "error"; error: McpErrorBody };

/** Advisory. Never writes mission law. Fail-open Jev errors become heuristic results. */
export async function handlePreflightContract(
  input: PreflightContractMcpInput,
  deps?: { fetchImpl?: typeof fetch; apiKey?: string },
): Promise<PreflightContractMcpResult> {
  try {
    if (!input.intent?.trim()) {
      return mcpError("VALIDATION_ERROR", "intent is required", true);
    }
    const { root, manifest } = loadWorkspace();
    const result = await runPreflight({
      root,
      manifest,
      intent: input.intent.trim(),
      paths: input.paths,
      provider: input.provider,
      apiKey: deps?.apiKey ?? process.env[TYPESAFE_API_KEY_ENV],
      fetchImpl: deps?.fetchImpl,
    });
    return { status: "ok", ...result };
  } catch (e) {
    if (isGantryUserError(e)) {
      return mcpError(e.code, e.message, true);
    }
    return mcpError("INTERNAL_ERROR", e instanceof Error ? e.message : String(e), false);
  }
}
