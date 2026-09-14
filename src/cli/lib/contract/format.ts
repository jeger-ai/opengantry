import type { EffectiveScope, MissionContract } from "./contract-types.js";
import type { ProposedGate } from "./propose-gate.js";

function csv(values: readonly string[] | undefined, empty: string): string {
  return values && values.length > 0 ? values.join(", ") : empty;
}

export interface CageFormatInput {
  tmvcRoots?: readonly string[];
  forbiddenZones?: readonly string[];
  allowedImports?: readonly string[];
  bannedImports?: readonly string[];
  allowDynamicSpecifiers?: boolean;
  strictRelativeImports?: boolean;
  emptyRoots?: string;
  emptyForbidden?: string;
  emptyAllowed?: string;
  emptyBanned?: string;
  gate?: ProposedGate | null;
}

/** Four cage lists + flags. Check, show, and propose share this. */
export function formatCage(input: CageFormatInput): string {
  const lines = [
    "Scope:",
    `  ${csv(input.tmvcRoots, input.emptyRoots ?? "(inherit skill roots)")}`,
    "Forbidden:",
    `  ${csv(input.forbiddenZones, input.emptyForbidden ?? "(none beyond skill/policy)")}`,
  ];
  if (input.gate !== undefined) {
    lines.push("Gate:", `  ${input.gate?.command ?? "(unchanged)"}`);
  }
  lines.push(
    "Allowed Imports:",
    `  ${csv(input.allowedImports, input.emptyAllowed ?? "(any bare specifier)")}`,
    "Banned Imports:",
    `  ${csv(input.bannedImports, input.emptyBanned ?? "(none)")}`,
  );
  if (input.allowDynamicSpecifiers === true) lines.push("Dynamic specifiers: allowed");
  if (input.strictRelativeImports === true) lines.push("Strict relative imports: on");
  return lines.join("\n");
}

export function formatContractBlock(contract: MissionContract, gate?: ProposedGate | null): string {
  return formatCage({
    tmvcRoots: contract.tmvc_roots,
    forbiddenZones: contract.forbidden_zones,
    allowedImports: contract.allowed_imports,
    bannedImports: contract.banned_imports,
    allowDynamicSpecifiers: contract.allow_dynamic_specifiers,
    strictRelativeImports: contract.strict_relative_imports,
    gate: gate ?? null,
  });
}

export function formatEffectiveScope(scope: EffectiveScope, gate?: ProposedGate | null): string {
  return formatCage({
    tmvcRoots: scope.tmvcRoots,
    forbiddenZones: scope.forbiddenZones,
    allowedImports: scope.allowedImports,
    bannedImports: scope.bannedImports,
    allowDynamicSpecifiers: scope.allowDynamicSpecifiers,
    strictRelativeImports: scope.strictRelativeImports,
    emptyRoots: "(none)",
    emptyForbidden: "(none)",
    emptyAllowed: "(any)",
    emptyBanned: "(none)",
    gate,
  });
}
