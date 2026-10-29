import { GXT_ERROR, type GxtErrorCode } from "#core/error-codes.js";
import { lawFileRelAt } from "#git/repo-text.js";
import {
  configFloorViolations,
  resolveOrgPolicy,
  type OrgPolicyResolveResult,
} from "#plane/policy-resolve.js";
import { checkMissionDependencies, type DependencyCheckResult } from "#plane/deps-resolve.js";
import { localConfigFloor } from "../gxt-config.js";
import type { CodedFailure } from "./failure.js";
import { verifyFinding } from "./finding.js";
import type { PhaseContext } from "./phase-steps.js";

type PolicyPhaseOutcome = { kind: "ok" } | { kind: "fail"; failure: CodedFailure<"policy"> };

type DependenciesPhaseOutcome =
  | { kind: "ok" }
  | { kind: "fail"; failure: CodedFailure<"dependencies"> };

function policyFailure(input: PhaseContext, code: GxtErrorCode, message: string): CodedFailure<"policy"> {
  return {
    ok: false,
    phase: "policy",
    message: code === GXT_ERROR.POLICY_FLOOR_VIOLATION ? `${code}: ${message}` : message,
    exitCode: 1,
    executorLogPath: input.executorLogPath,
    code,
    findings: [
      verifyFinding("policy", message, {
        offending_file: lawFileRelAt(input.root, "policy-pointer"),
        rule_id: code,
      }),
    ],
  };
}

export function evaluatePolicyPhase(
  input: PhaseContext,
  resolve: (root: string) => OrgPolicyResolveResult = resolveOrgPolicy,
): PolicyPhaseOutcome {
  const resolved = resolve(input.root);
  if (!resolved.ok) {
    return { kind: "fail", failure: policyFailure(input, resolved.code, resolved.message) };
  }
  if (!resolved.present || !resolved.bundle) return { kind: "ok" };
  const violations = configFloorViolations(resolved.bundle.config_floor ?? {}, localConfigFloor(input.root));
  if (violations.length > 0) {
    return {
      kind: "fail",
      failure: policyFailure(input, GXT_ERROR.POLICY_FLOOR_VIOLATION, violations[0]!),
    };
  }
  return { kind: "ok" };
}

export function evaluateDependenciesPhase(input: PhaseContext): DependenciesPhaseOutcome {
  const failed = checkMissionDependencies(input.root, input.mission).find(
    (r): r is Extract<DependencyCheckResult, { code: Exclude<DependencyCheckResult["code"], "ok"> }> =>
      r.code !== "ok",
  );
  if (!failed) return { kind: "ok" };
  return {
    kind: "fail",
    failure: {
      ok: false,
      phase: "dependencies",
      message: `${failed.code}: ${failed.message}`,
      exitCode: 1,
      executorLogPath: input.executorLogPath,
      code: failed.code,
      findings: [
        verifyFinding("dependencies", failed.message, {
          offending_file: input.mission.rawPath,
          rule_id: failed.code,
        }),
      ],
    },
  };
}
