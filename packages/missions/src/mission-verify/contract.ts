import YAML from "yaml";
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { contractSha256, normalizeContract } from "../contract/contract-hash.js";
import { contractViolationCode, formatContractViolation, scanContractImports } from "../contract/contract-scan.js";
import type { ContractImportViolation, EffectiveScope, MissionContract } from "#core/contract-types.js";
import { resolveEffectiveScopeForMission } from "../contract/effective-scope.js";
import { GXT_ERROR, type GxtErrorCode } from "#core/error-codes.js";
import { judgePath } from "#core/path-law.js";
import { gitRevParse, gitRun } from "#git/git.js";
import { SHALLOW_HISTORY_HINT } from "../perimeter.js";
import type { CodedFailure } from "./failure.js";
import { verifyFinding, type VerifyFinding } from "./finding.js";
import { readMissionAtCommit, resolvePlannerStampHash } from "./interrogation.js";
import type { PhaseContext } from "./phase-steps.js";
import { missionRunRecord, runRecordRelPath } from "./run-record.js";

type ContractPhaseOutcome = { kind: "ok"; skipped: boolean; warnings?: string[] } | { kind: "fail"; failure: CodedFailure<"contract"> };

interface ContractPhaseInput extends PhaseContext {
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
      code,
      findings:
        findings.length > 0
          ? findings
          : [verifyFinding("contract", message, { offending_file: input.missionRel, rule_id: code })],
    },
  };
}

/** Compare the working-tree contract digest with the digest sealed at the Planner stamp. */
function checkSeal(input: ContractPhaseInput, stampHash: string): ContractPhaseOutcome | null {
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

/** Paths changed from the Planner stamp to the head the evidence binds to (the run record's; HEAD for trace rows and `--record`). */
function changedSinceStamp(input: ContractPhaseInput, stampHash: string): string[] | null {
  const recorded = input.mission.traceRows.length > 0 || input.options.record === true ? undefined : missionRunRecord(input.root, input.proofMsnId)?.head;
  const head = gitRevParse(input.root, typeof recorded === "string" ? recorded : "HEAD");
  const diff = head ? gitRun(input.root, ["diff", "--name-only", "-z", "--no-renames", `${stampHash}..${head}`]) : null;
  return diff?.ok ? diff.stdout.split("\0").filter((l) => l.length > 0) : null;
}

/** The mission's commits under its law (RULES §4): a forbidden zone fails; outside the roots warns, except under `.gitagent/`. */
function judgeChangedPaths(input: ContractPhaseInput, scope: EffectiveScope, stampHash: string): ContractPhaseOutcome {
  const changed = changedSinceStamp(input, stampHash);
  if (!changed) return contractFailure(input, GXT_ERROR.FORBIDDEN_ZONE, `cannot list the paths changed since Planner stamp ${stampHash} — ${SHALLOW_HISTORY_HINT}`);
  const transport = new Set([input.missionRel, runRecordRelPath(input.proofMsnId), "EXECUTOR_LOG.md"]);
  const findings: VerifyFinding[] = [];
  const warnings: string[] = [];
  for (const p of changed.filter((l) => !transport.has(l))) {
    const judged = judgePath(scope.law, p);
    if (judged?.rule === "forbidden_zone") {
      const hint = `${p} is in forbidden zone ${judged.pattern ?? ""} (${judged.source}); revert it or have the Planner re-legislate`;
      findings.push(verifyFinding("contract", hint, { offending_file: p, rule_id: GXT_ERROR.FORBIDDEN_ZONE }));
    } else if (judged?.rule === "outside_roots" && scope.tmvcRoots.length > 0 && !p.startsWith(".gitagent/")) {
      warnings.push(`path outside the mission's TMVC roots changed since the Planner stamp: ${p}`);
    }
  }
  const message = `${String(findings.length)} path(s) changed since the Planner stamp touch a forbidden zone; first: ${findings[0]?.resolution_hint ?? ""}`;
  return findings.length > 0 ? contractFailure(input, GXT_ERROR.FORBIDDEN_ZONE, message, findings) : { kind: "ok", skipped: false, ...(warnings.length > 0 ? { warnings } : {}) };
}

function violationFindings(violations: readonly ContractImportViolation[]): VerifyFinding[] {
  return violations.map((v) =>
    verifyFinding("contract", v.detail, {
      offending_file: v.file,
      line: v.line,
      start_column: v.column,
      rule_id: contractViolationCode(v.kind),
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
 * Verify `contract` phase (after git_proof): the contract block must match the Planner stamp blob, the effective scope
 * must be a tighten-only narrowing, the paths changed since the stamp must stay out of the forbidden zones, and every
 * import site under the cage must respect allowed/banned/dynamic/scope rules. Without a contract, the skill's scope.
 */
export function evaluateContractPhase(input: ContractPhaseInput): ContractPhaseOutcome {
  const stampHash = resolvePlannerStampHash(input.root, input.proofMsnId, input.options.scanDepth, input.missionRel);
  const sealFailure = stampHash ? checkSeal(input, stampHash) : null;
  if (sealFailure) return sealFailure;

  let scope: EffectiveScope;
  try {
    scope = resolveEffectiveScopeForMission(input.root, input.manifest, input.mission);
  } catch (e) {
    const code = isGantryUserError(e) && e.code.startsWith("GXT_CONTRACT_") ? (e.code as GxtErrorCode) : GXT_ERROR.CONTRACT_SCOPE_ESCAPE;
    return contractFailure(input, code, errorMessage(e).replace(`${code}: `, ""));
  }
  const changed = stampHash ? judgeChangedPaths(input, scope, stampHash) : { kind: "ok" as const, skipped: false };
  if (changed.kind === "fail") return changed;
  const ok = { ...changed, skipped: input.mission.contract === null };
  return ok.skipped ? ok : (scanCage(input, scope) ?? ok);
}
