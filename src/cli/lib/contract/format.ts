import type { MissionContract } from "./contract-types.js";
import type { ProposedGate } from "./propose-gate.js";

function csv(values: readonly string[] | undefined, empty: string): string {
  return values && values.length > 0 ? values.join(", ") : empty;
}

/** Compact ~15-line human block for TTY prompt, `gantry contract show`, and MCP chat. */
export function formatContractBlock(contract: MissionContract, gate?: ProposedGate | null): string {
  const lines = [
    "Scope:",
    `  ${csv(contract.tmvc_roots, "(inherit skill roots)")}`,
    "Forbidden:",
    `  ${csv(contract.forbidden_zones, "(none beyond skill/policy)")}`,
    "Gate:",
    `  ${gate?.command ?? "(unchanged)"}`,
    "Allowed Imports:",
    `  ${csv(contract.allowed_imports, "(any bare specifier)")}`,
    "Banned Imports:",
    `  ${csv(contract.banned_imports, "(none)")}`,
  ];
  if (contract.allow_dynamic_specifiers === true) lines.push("Dynamic specifiers: allowed");
  if (contract.strict_relative_imports === true) lines.push("Strict relative imports: on");
  return lines.join("\n");
}
