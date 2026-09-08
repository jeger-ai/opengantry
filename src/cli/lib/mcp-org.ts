import { errorMessage } from "./cli-io.js";
import { checkMissionDependency } from "./deps/deps-resolve.js";
import { verifyLedgerChain } from "./ledger/ledger-verify.js";
import { parseMissionFile } from "./missions/parser.js";
import { resolveMissionArg } from "./mission-arg.js";
import { resolveEffectivePolicy } from "./policy/policy-resolve.js";
import { loadWorkspace } from "./workspace.js";

export type OrgMcpResult = { status: "ok"; [k: string]: unknown } | { status: "error"; message: string };

export function handlePolicyStatus(): OrgMcpResult {
  try {
    const { root } = loadWorkspace();
    return { status: "ok", effective: resolveEffectivePolicy(root) };
  } catch (e) {
    return { status: "error", message: errorMessage(e) };
  }
}

export function handleLedgerVerify(requireSignatures = false): OrgMcpResult {
  try {
    const { root } = loadWorkspace();
    return { status: "ok", ...verifyLedgerChain(root, undefined, { requireSignatures }) };
  } catch (e) {
    return { status: "error", message: errorMessage(e) };
  }
}

export function handleDepsCheck(missionFilePath?: string): OrgMcpResult {
  try {
    const { root } = loadWorkspace();
    const resolved = resolveMissionArg(root, missionFilePath);
    const mission = parseMissionFile(root, resolved.missionRel);
    const results = (mission.dependsOn ?? []).map((d) => checkMissionDependency(root, d));
    return { status: "ok", mission_file_path: resolved.missionRel, results };
  } catch (e) {
    return { status: "error", message: errorMessage(e) };
  }
}
