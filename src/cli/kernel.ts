/**
 * Curated in-process API for external runtimes (iii worker, daemons).
 * Do not deep-import dist/cli/lib/* — use this entry only.
 */
export {
  evaluateScope,
  evaluateFunctionScope,
  isPromoteClassFunctionId,
  type EvaluateScopeInput,
  type ScopeEvaluationResult,
  type ScopeEvaluationKind,
} from "#missions/kernel-evaluate-scope.js";

export {
  mintVerdictToken,
  verifyVerdictToken,
  VERDICT_TOKEN_SCHEMA_VERSION,
  type VerdictTokenPayload,
  type MintVerdictTokenInput,
  type VerifyVerdictTokenInput,
} from "#missions/verdict-token.js";
export {
  buildVerdictExpectedClaims,
  verdictClaimsFor,
  clearVerdictClaimsCache,
  PASSED_FINDINGS_DIGEST,
  type VerdictExpectedClaims,
} from "#missions/verdict-expected.js";
export { resolveOrgId } from "#plane/org-export-config.js";
export type { VerifyOptions } from "./lib/verify/verify-options.js";
export type { GateExecAdapter, GateExecContext, GateExecutionResult } from "#missions/gate-adapters/gate-adapter-types.js";
export type { VerifyResultPayload } from "./lib/verify/verify-payload.js";
export { buildVerifyResultPayload } from "./lib/verify/verify-payload.js";

import type { Manifest } from "#core/manifest.js";
import type { ParsedMission } from "#core/mission-types.js";
import { parseMissionFile } from "#missions/missions/parser.js";
import { loadManifest } from "#missions/manifest.js";
import type { VerifyOptions } from "./lib/verify/verify-options.js";
import type { VerifyResultPayload } from "./lib/verify/verify-payload.js";
import { buildVerifyResultPayload } from "./lib/verify/verify-payload.js";

export interface VerifyMissionInput {
  repoRoot: string;
  missionRelPath: string;
  options?: VerifyOptions;
}

/** Run full verify phases in-process and return structured JSON payload. */
export async function verifyMission(input: VerifyMissionInput): Promise<VerifyResultPayload> {
  const manifest = loadManifest(input.repoRoot);
  const mission = parseMissionFile(input.repoRoot, input.missionRelPath);
  const options = input.options ?? {};
  return buildVerifyResultPayload(input.repoRoot, manifest, mission, options);
}

/** Load manifest + mission for middleware scope checks (no verify run). */
export function loadGovernanceBundle(repoRoot: string, missionRelPath: string) {
  return {
    manifest: loadManifest(repoRoot),
    mission: parseMissionFile(repoRoot, missionRelPath),
  };
}

export type { Manifest, ParsedMission };
