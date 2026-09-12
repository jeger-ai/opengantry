import { setExitCode } from "../lib/cli-io.js";
import { runUserCommand, type CommandPresentation } from "../lib/command-boundary.js";
import { contractViolationCode, formatContractViolation, scanContractImports } from "../lib/contract/contract-scan.js";
import type { ContractImportViolation, EffectiveScope } from "../lib/contract/contract-types.js";
import { resolveEffectiveScopeForMission } from "../lib/contract/effective-scope.js";
import { GantryUserError } from "../lib/errors.js";
import { parseMissionFile, resolvePinnedMission } from "../lib/missions/parser.js";
import { contractSha256, normalizeContract } from "../lib/contract/contract-hash.js";
import { formatContractBlock } from "../lib/contract/format.js";
import { proposeContract } from "../lib/contract/propose.js";
import { resolveSkillKeyForLegislation } from "../lib/legislate.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface ContractCheckCliOptions {
  mission?: string;
  json?: boolean;
  /** Restrict the import scan to these repo-relative files. */
  files?: string[];
}

function scopeJson(scope: EffectiveScope): Record<string, unknown> {
  return {
    tmvc_roots: scope.tmvcRoots,
    forbidden_zones: scope.forbiddenZones,
    allowed_imports: scope.allowedImports,
    banned_imports: scope.bannedImports,
    allow_dynamic_specifiers: scope.allowDynamicSpecifiers,
    strict_relative_imports: scope.strictRelativeImports,
    has_contract: scope.hasContract,
  };
}

function humanLines(missionRel: string, scope: EffectiveScope, violations: readonly ContractImportViolation[]): string[] {
  const lines = [
    `contract check: ${missionRel}${scope.hasContract ? "" : " (no contract block — effective scope from skill/policy)"}`,
    `  tmvc_roots: ${scope.tmvcRoots.join(", ") || "(none)"}`,
    `  forbidden_zones: ${scope.forbiddenZones.join(", ") || "(none)"}`,
    `  allowed_imports: ${scope.allowedImports.join(", ") || "(any)"}`,
    `  banned_imports: ${scope.bannedImports.join(", ") || "(none)"}`,
  ];
  if (violations.length === 0) {
    lines.push("contract check: OK — no import-site violations");
    return lines;
  }
  lines.push(`contract check: ${String(violations.length)} violation(s):`);
  for (const v of violations) lines.push(`  ${formatContractViolation(v)}`);
  return lines;
}

/** Read-only: resolve the effective cage for a mission and scan import sites (ADR-0022 containment). */
export function runContractCheck(options: ContractCheckCliOptions): void {
  runUserCommand({ json: options.json }, (): CommandPresentation => {
    const workspace = loadWorkspace();
    const missionRel = options.mission?.trim() || resolvePinnedMission(workspace.root);
    if (!missionRel) {
      throw new GantryUserError(
        "MISSION_REQUIRED",
        "gantry contract check: pass --mission <path> or pin a mission first",
        "gantry pin --mission .gitagent/missions/<file>.yaml",
        2,
      );
    }
    const mission = parseMissionFile(workspace.root, missionRel);
    const scope = resolveEffectiveScopeForMission(workspace.root, workspace.manifest, mission);
    const violations = scanContractImports(
      workspace.root,
      scope,
      options.files && options.files.length > 0 ? { files: options.files } : {},
    );
    if (violations.length > 0) setExitCode(1);
    return {
      json: {
        ok: violations.length === 0,
        mission: missionRel,
        msn_id: mission.msnId,
        contract_sha256: mission.contractSha256,
        scope: scopeJson(scope),
        violations: violations.map((v) => ({ ...v, code: contractViolationCode(v.kind) })),
      },
      human: humanLines(missionRel, scope, violations),
    };
  });
}

export interface ContractProposeCliOptions {
  intent: string;
  skillKey?: string;
  paths?: string[];
  json?: boolean;
}

export function runContractPropose(options: ContractProposeCliOptions): void {
  runUserCommand({ json: options.json }, (): CommandPresentation => {
    const workspace = loadWorkspace();
    const resolved = resolveSkillKeyForLegislation({
      root: workspace.root,
      manifest: workspace.manifest,
      intent: options.intent,
      skillKey: options.skillKey,
    });
    if (!resolved.ok) {
      throw new GantryUserError("INVALID_ARGUMENT", `contract propose: ${resolved.reason}`, undefined, 2);
    }
    const proposed = proposeContract({
      root: workspace.root,
      manifest: workspace.manifest,
      intent: options.intent,
      skillKey: resolved.skillKey,
      paths: options.paths,
    });
    const contract = normalizeContract(proposed.contract);
    return {
      json: {
        ok: true,
        skill_key: resolved.skillKey,
        contract,
        contract_sha256: contractSha256(contract),
        gate: proposed.gate,
        rationale: proposed.rationale,
        block: formatContractBlock(contract, proposed.gate),
      },
      human: [formatContractBlock(contract, proposed.gate), "", "Rationale:", ...proposed.rationale.map((r) => `  - ${r}`)],
    };
  });
}

export interface ContractShowCliOptions {
  mission?: string;
  json?: boolean;
}

export function runContractShow(options: ContractShowCliOptions): void {
  runUserCommand({ json: options.json }, (): CommandPresentation => {
    const workspace = loadWorkspace();
    const missionRel = options.mission?.trim() || resolvePinnedMission(workspace.root);
    if (!missionRel) {
      throw new GantryUserError("MISSION_REQUIRED", "gantry contract show: pass --mission <path> or pin a mission first", undefined, 2);
    }
    const mission = parseMissionFile(workspace.root, missionRel);
    const contract = mission.contract ?? {};
    return {
      json: { ok: true, mission: missionRel, msn_id: mission.msnId, contract, contract_sha256: mission.contractSha256 },
      human: formatContractBlock(contract, mission.gate ? { command: mission.gate.command, successSubstring: mission.gate.successSubstring } : null),
    };
  });
}
