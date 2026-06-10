import {
  assertBypassSecretAuthorized,
  runBreakGlassAudit,
  validateBreakGlassReason,
} from "./break-glass.js";
import { toPosixRel } from "./cli-io.js";
import type { ParsedMission } from "./types.js";
import type { VerifyOptions } from "./verify-types.js";

export interface BreakGlassAuditOk {
  kind: "ok";
  missionRel: string;
  commitSha: string;
  reason: string;
  msnId?: string;
  auditCommit: boolean;
}

export interface BreakGlassAuditFail {
  kind: "fail";
  error: unknown;
}

export type BreakGlassAuditOutcome = BreakGlassAuditOk | BreakGlassAuditFail;

/** Single break-glass audit path shared by human and JSON presenters. */
export function runBreakGlassAuditFlow(
  root: string,
  mission: ParsedMission,
  options: VerifyOptions,
): BreakGlassAuditOutcome {
  try {
    const reason = validateBreakGlassReason(options.breakGlassReason);
    assertBypassSecretAuthorized(root);
    const missionRel = toPosixRel(root, mission.rawPath);
    const commitSha = runBreakGlassAudit(root, {
      reason,
      msnId: mission.msnId,
      missionFile: missionRel,
      commit: options.breakGlassCommit,
      auditCommit: options.auditCommit === true,
    });
    return {
      kind: "ok",
      missionRel,
      commitSha,
      reason,
      msnId: mission.msnId ?? undefined,
      auditCommit: options.auditCommit === true,
    };
  } catch (error) {
    return { kind: "fail", error };
  }
}
