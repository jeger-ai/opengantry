import { checkMissionDependencies } from "./deps/deps-resolve.js";
import { verifyLedgerChain } from "./ledger/ledger-chain.js";
import { parseMissionFile } from "./missions/parser.js";
import { resolveMissionArg } from "./mission-arg.js";
import { toMcpError, type McpErrorBody } from "./mcp-governance-shared.js";
import { orgPolicySnapshot, resolveOrgPolicy } from "./policy/policy-resolve.js";
import { loadWorkspace } from "./workspace.js";

export type OrgMcpResult<T> = ({ status: "ok" } & T) | { status: "error"; error: McpErrorBody };

function orgOk<T>(value: T): OrgMcpResult<T> {
  return { status: "ok", ...value };
}

function orgErr<T>(e: unknown): OrgMcpResult<T> {
  return { status: "error", error: toMcpError(e) };
}

export function handlePolicyStatus(): OrgMcpResult<{ effective: ReturnType<typeof orgPolicySnapshot> }> {
  try {
    const { root } = loadWorkspace();
    const resolved = resolveOrgPolicy(root);
    if (!resolved.ok) {
      return {
        status: "error",
        error: { code: resolved.code, message: resolved.message, retryable: true },
      };
    }
    return orgOk({ effective: orgPolicySnapshot(resolved) });
  } catch (e) {
    return orgErr(e);
  }
}

export function handleLedgerVerify(
  requireSignatures = false,
): OrgMcpResult<ReturnType<typeof verifyLedgerChain>> {
  try {
    const { root } = loadWorkspace();
    return orgOk(verifyLedgerChain(root, undefined, { requireSignatures }));
  } catch (e) {
    return orgErr(e);
  }
}

export function handleDepsCheck(missionFilePath?: string): OrgMcpResult<{
  mission_file_path: string;
  results: ReturnType<typeof checkMissionDependencies>;
}> {
  try {
    const { root } = loadWorkspace();
    const resolved = resolveMissionArg(root, missionFilePath);
    const mission = parseMissionFile(root, resolved.missionRel);
    const results = checkMissionDependencies(root, mission);
    return orgOk({ mission_file_path: resolved.missionRel, results });
  } catch (e) {
    return orgErr(e);
  }
}
