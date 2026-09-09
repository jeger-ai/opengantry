import { GXT_ERROR } from "./gxt-error-codes.js";
import { REL_POLICY_POINTER } from "./constants.js";
import { checkMissionDependencies, type DependencyCheckResult } from "./deps/deps-resolve.js";
import { floorViolations } from "./policy/policy-merge.js";
import { resolveEffectivePolicy, localConfigFloor } from "./policy/policy-resolve.js";
import type { ParsedMission } from "./types.js";
import type { DependenciesFailure, PolicyFailure } from "./verify-failure.js";
import { verifyFinding } from "./verify-finding.js";

export type PolicyPhaseOutcome =
  | { kind: "ok"; warnings: string[] }
  | { kind: "fail"; failure: PolicyFailure };

export type DependenciesPhaseOutcome =
  | { kind: "ok"; warnings: string[] }
  | { kind: "fail"; failure: DependenciesFailure };

export function evaluatePolicyPhase(input: {
  root: string;
  executorLogPath: string;
}): PolicyPhaseOutcome {
  try {
    const effective = resolveEffectivePolicy(input.root);
    if (!effective.present) return { kind: "ok", warnings: [] };
    const violations = floorViolations(effective, localConfigFloor(input.root));
    if (violations.length > 0) {
      return {
        kind: "fail",
        failure: {
          ok: false,
          phase: "policy",
          message: `${GXT_ERROR.POLICY_FLOOR_VIOLATION}: ${violations[0]}`,
          exitCode: 1,
          executorLogPath: input.executorLogPath,
          policyCode: GXT_ERROR.POLICY_FLOOR_VIOLATION,
          findings: [
            verifyFinding("policy", violations[0]!, {
              offending_file: REL_POLICY_POINTER,
              rule_id: GXT_ERROR.POLICY_FLOOR_VIOLATION,
            }),
          ],
        },
      };
    }
    return { kind: "ok", warnings: [] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = message.includes("UNPINNED")
      ? GXT_ERROR.POLICY_UNPINNED
      : message.includes("SIGNATURE")
        ? GXT_ERROR.POLICY_SIGNATURE_INVALID
        : GXT_ERROR.POLICY_DRIFT;
    return {
      kind: "fail",
      failure: {
        ok: false,
        phase: "policy",
        message,
        exitCode: 1,
        executorLogPath: input.executorLogPath,
        policyCode: code,
        findings: [verifyFinding("policy", message, { offending_file: REL_POLICY_POINTER, rule_id: code })],
      },
    };
  }
}

export function evaluateDependenciesPhase(input: {
  root: string;
  mission: ParsedMission;
  executorLogPath: string;
}): DependenciesPhaseOutcome {
  const results = checkMissionDependencies(input.root, input.mission);
  const failed = results.find((r): r is Extract<DependencyCheckResult, { code: Exclude<DependencyCheckResult["code"], "ok"> }> => r.code !== "ok");
  if (!failed) return { kind: "ok", warnings: [] };
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
