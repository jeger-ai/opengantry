import { setExitCode } from "../lib/cli-io.js";
import { runUserCommand, runUserCommandAsync, type CommandPresentation } from "../lib/command-boundary.js";
import { contractViolationCode, formatContractViolation, scanContractImports } from "../lib/contract/contract-scan.js";
import type { ContractImportViolation, EffectiveScope } from "../lib/contract/contract-types.js";
import { resolveEffectiveScope, resolveEffectiveScopeForMission } from "../lib/contract/effective-scope.js";
import { GantryUserError } from "../lib/errors.js";
import { parseMissionFile, resolvePinnedMission } from "../lib/missions/parser.js";
import { contractSha256, normalizeContract } from "../lib/contract/contract-hash.js";
import { formatContractBlock, formatEffectiveScope } from "../lib/contract/format.js";
import { TYPESAFE_API_KEY_ENV } from "../lib/contract/preflight-jev.js";
import { isPreflightProvider, runPreflight } from "../lib/contract/preflight.js";
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
    formatEffectiveScope(scope),
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
  /** Host-supplied float[1536] JSON. Absent: propose stays a pure read. */
  embeddingFile?: string;
}

export async function runContractPropose(options: ContractProposeCliOptions): Promise<void> {
  await runUserCommandAsync({ json: options.json }, async (): Promise<CommandPresentation> => {
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
    resolveEffectiveScope({ manifest: workspace.manifest, skillKey: resolved.skillKey, contract });
    const sha = contractSha256(contract);
    const embeddingFile = options.embeddingFile?.trim();
    // Load sqlite-vec only for this side path so other commands (including packed init) stay free of the native module.
    const driftWarnings = embeddingFile
      ? (await import("../lib/contract/contract-drift.js")).indexProposedContract({
          root: workspace.root,
          contractSha256: sha,
          embeddingFile,
        })
      : undefined;
    const human = [formatContractBlock(contract, proposed.gate), "", "Rationale:", ...proposed.rationale.map((r) => `  - ${r}`)];
    if (driftWarnings && driftWarnings.length > 0) human.push("", ...driftWarnings);
    return {
      json: {
        ok: true,
        skill_key: resolved.skillKey,
        contract,
        contract_sha256: sha,
        gate: proposed.gate,
        rationale: proposed.rationale,
        block: formatContractBlock(contract, proposed.gate),
        ...(driftWarnings ? { drift_warnings: driftWarnings } : {}),
      },
      human,
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

export interface ContractPreflightCliOptions {
  intent: string;
  paths?: string[];
  provider?: string;
}

/** JSON-only advisory classifier. Always writes structured stdout. */
export async function runContractPreflight(options: ContractPreflightCliOptions): Promise<void> {
  await runUserCommandAsync({ json: true }, async (): Promise<CommandPresentation> => {
    const provider = options.provider ?? "heuristic";
    if (!isPreflightProvider(provider)) {
      throw new GantryUserError(
        "INVALID_ARGUMENT",
        `contract preflight: unknown provider ${provider}`,
        "Use heuristic or jev",
        2,
      );
    }
    const workspace = loadWorkspace();
    const result = await runPreflight({
      root: workspace.root,
      manifest: workspace.manifest,
      intent: options.intent,
      paths: options.paths,
      provider,
      apiKey: process.env[TYPESAFE_API_KEY_ENV],
    });
    return { json: { status: "ok", ...result } };
  });
}
