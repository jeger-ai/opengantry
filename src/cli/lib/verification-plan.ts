import { createHash } from "node:crypto";

export const VERIFICATION_PLAN_SCHEMA_VERSION = 1 as const;
export const VERIFICATION_PLAN_REL = ".gitagent/verification_plan.json" as const;

export interface VerificationGateCommand {
  rule_id: string;
  command: string;
  description: string;
}

export interface VerificationPlan {
  schema_version: typeof VERIFICATION_PLAN_SCHEMA_VERSION;
  gate_commands: VerificationGateCommand[];
  required_skills: string[];
  provenance_checksum: string;
  rule_ids: string[];
}

export function computeProvenanceChecksum(ruleIds: string[], gateCommands: VerificationGateCommand[]): string {
  const payload = JSON.stringify({
    rule_ids: [...ruleIds].sort(),
    gate_commands: [...gateCommands]
      .map((g) => ({ rule_id: g.rule_id, command: g.command }))
      .sort((a, b) => a.rule_id.localeCompare(b.rule_id)),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function buildVerificationPlan(input: {
  ruleIds: string[];
  gateCommands: VerificationGateCommand[];
  requiredSkills: string[];
}): VerificationPlan {
  const checksum = computeProvenanceChecksum(input.ruleIds, input.gateCommands);
  return {
    schema_version: VERIFICATION_PLAN_SCHEMA_VERSION,
    gate_commands: input.gateCommands,
    required_skills: [...input.requiredSkills].sort(),
    provenance_checksum: checksum,
    rule_ids: [...input.ruleIds].sort(),
  };
}

export function serializeVerificationPlan(plan: VerificationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
