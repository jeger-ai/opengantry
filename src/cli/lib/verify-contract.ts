import YAML from "yaml";
import { errorMessage } from "./cli-io.js";
import { contractSha256, normalizeContract } from "./contract/contract-hash.js";
import { contractViolationCode, formatContractViolation, scanContractImports } from "./contract/contract-scan.js";
import type { ContractImportViolation, EffectiveScope, MissionContract } from "./contract/contract-types.js";
import { resolveEffectiveScopeForMission } from "./contract/effective-scope.js";
import { isGantryUserError } from "./errors.js";
import { GXT_ERROR, type GxtErrorCode } from "./gxt-error-codes.js";
import { SHALLOW_HISTORY_HINT } from "./perimeter.js";
import type { ContractFailure } from "./verify-failure.js";
import { verifyFinding, type VerifyFinding } from "./verify-finding.js";
import { readMissionAtCommit, resolvePlannerStampHash } from "./verify-interrogation.js";
import type { PhaseContext } from "./verify-phase-steps.js";

export type ContractPhaseOutcome = { kind: "ok"; skipped: boolean } | { kind: "fail"; failure: ContractFailure };

export interface ContractPhaseInput extends PhaseContext {
  proofMsnId: string;
  missionRel: string;
}

/** Contract digest as sealed in a mission blob: null = no contract, undefined = unparseable. */
export function stampedContractDigest(body: string): string | null | undefined {
  try {
    const doc = YAML.parse(body) as { contract?: unknown; contract_sha256?: unknown };
    if (doc.contract === undefined || doc.contract === null) return null;
    if (typeof doc.contract !== "object") return undefined;
    return contractSha256(normalizeContract(doc.contract as MissionContract));
  } catch {
    return undefined;
  }
}

function contractFailure(
  input: ContractPhaseInput,
  code: GxtErrorCode,
  message: string,
  findings: VerifyFinding[] = [],
): ContractPhaseOutcome {
  return {
    kind: "fail",
    failure: {
      ok: false,
      phase: "contract",
      message: `${code}: ${message}`,
      exitCode: 1,
      executorLogPath: input.executorLogPath,
      contractCode: code,
      findings:
        findings.length > 0
          ? findings
          : [verifyFinding("contract", message, { offending_file: input.missionRel, rule_id: code })],
    },
  };
}

/** Compare the working-tree contract digest with the digest sealed at the Planner stamp. */
function checkSeal(input: ContractPhaseInput): ContractPhaseOutcome | null {
  const stampHash = resolvePlannerStampHash(input.root, input.proofMsnId, input.options.scanDepth);
  if (!stampHash) return null;
  const body = readMissionAtCommit(input.root, stampHash, input.missionRel);
  if (body === null) {
    if (input.mission.contract === null) return null;
    return contractFailure(
      input,
      GXT_ERROR.CONTRACT_TAMPERED,
      `cannot read mission at Planner stamp ${stampHash} to verify the contract seal — ${SHALLOW_HISTORY_HINT}`,
    );
  }
  const stamped = stampedContractDigest(body);
  const current = input.mission.contractSha256;
  if (stamped === undefined) {
    return contractFailure(input, GXT_ERROR.CONTRACT_TAMPERED, "cannot parse contract block from Planner stamp blob");
  }
  if (stamped === null && current === null) return null;
  if (stamped === null) {
    return contractFailure(input, GXT_ERROR.CONTRACT_TAMPERED, "contract block added after Planner stamp");
  }
  if (current === null || input.mission.contract === null) {
    return contractFailure(input, GXT_ERROR.CONTRACT_TAMPERED, "contract block removed after Planner stamp");
  }
  if (stamped !== current) {
    return contractFailure(input, GXT_ERROR.CONTRACT_TAMPERED, `contract changed after Planner stamp ${stampHash}`);
  }
  return null;
}

function violationFindings(violations: readonly ContractImportViolation[]): VerifyFinding[] {
  return violations.map((v) =>
    verifyFinding("contract", v.detail, {
      offending_file: v.file,
      line: v.line,
      start_column: v.column,
      rule_id: contractViolationCode(v.kind),
      evidence: v.specifier,
    }),
  );
}

function scanCage(input: ContractPhaseInput, scope: EffectiveScope): ContractPhaseOutcome | null {
  const violations = scanContractImports(input.root, scope);
  if (violations.length === 0) return null;
  const first = violations[0]!;
  return contractFailure(
    input,
    contractViolationCode(first.kind),
    `${String(violations.length)} import site(s) violate the mission contract; first: ${formatContractViolation(first)}`,
    violationFindings(violations),
  );
}

/**
 * Verify `contract` phase (after git_proof): the contract block must match the Planner stamp blob,
 * the effective scope must be a tighten-only narrowing, and every import site under the cage must
 * respect allowed/banned/dynamic/scope rules. Missions without a contract only run the seal check.
 */
export function evaluateContractPhase(input: ContractPhaseInput): ContractPhaseOutcome {
  const sealFailure = checkSeal(input);
  if (sealFailure) return sealFailure;
  if (input.mission.contract === null) return { kind: "ok", skipped: true };

  let scope: EffectiveScope;
  try {
    scope = resolveEffectiveScopeForMission(input.root, input.manifest, input.mission);
  } catch (e) {
    const code = isGantryUserError(e) && e.code.startsWith("GXT_CONTRACT_") ? (e.code as GxtErrorCode) : GXT_ERROR.CONTRACT_SCOPE_ESCAPE;
    return contractFailure(input, code, errorMessage(e).replace(`${code}: `, ""));
  }
  const scanFailure = scanCage(input, scope);
  if (scanFailure) return scanFailure;
  return { kind: "ok", skipped: false };
}
