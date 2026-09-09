import { GXT_ERROR, type GxtErrorCode } from "./gxt-error-codes.js";
import { REL_POLICY_POINTER } from "./constants.js";
import { checkMissionDependencies, type DependencyCheckResult } from "./deps/deps-resolve.js";
import {
  configFloorViolations,
  localConfigFloor,
  resolveOrgPolicy,
  type OrgPolicyResolveResult,
} from "./policy/policy-resolve.js";
import type { DependenciesFailure, PolicyFailure } from "./verify-failure.js";
import { verifyFinding } from "./verify-finding.js";
import type { PhaseContext } from "./verify-phase-steps.js";

export type PolicyPhaseOutcome = { kind: "ok" } | { kind: "fail"; failure: PolicyFailure };

export type DependenciesPhaseOutcome =
  | { kind: "ok" }
  | { kind: "fail"; failure: DependenciesFailure };

function policyFailure(input: PhaseContext, code: GxtErrorCode, message: string): PolicyFailure {
  return {
    ok: false,
    phase: "policy",
    message: code === GXT_ERROR.POLICY_FLOOR_VIOLATION ? `${code}: ${message}` : message,
    exitCode: 1,
    executorLogPath: input.executorLogPath,
    policyCode: code,
    findings: [
      verifyFinding("policy", message, {
        offending_file: REL_POLICY_POINTER,
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
  const results = checkMissionDependencies(input.root, input.mission);
  const failed = results.find(
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
      dependencyCode: failed.code,
      findings: [
        verifyFinding("dependencies", failed.message, {
          offending_file: input.mission.rawPath,
          rule_id: failed.code,
        }),
      ],
    },
  };
}
