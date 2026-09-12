import type { MissionContract } from "../types.js";

export type { MissionContract } from "../types.js";

/** Effective cage after merging skill roots, mission contract, and org policy (tighten-only). */
export interface EffectiveScope {
  /** Repo-relative TMVC roots (contract narrowing when present, else skill roots). */
  tmvcRoots: string[];
  /** Union of skill, contract, and policy forbidden zones. */
  forbiddenZones: string[];
  /** Bare-specifier allowlist; empty = no allowlist enforced. */
  allowedImports: string[];
  /** Union of contract and policy banned bare specifiers (exact or prefix match). */
  bannedImports: string[];
  allowDynamicSpecifiers: boolean;
  strictRelativeImports: boolean;
  /** True when the mission declared a contract block. */
  hasContract: boolean;
}

export type ContractViolationKind = "banned" | "unlisted" | "dynamic" | "scope_escape";

export interface ContractImportViolation {
  kind: ContractViolationKind;
  /** Repo-relative importing file. */
  file: string;
  line: number;
  column: number;
  /** Specifier text, or the raw expression for dynamic sites. */
  specifier: string;
  detail: string;
}

export const CONTRACT_ARRAY_KEYS = [
  "tmvc_roots",
  "forbidden_zones",
  "allowed_imports",
  "banned_imports",
] as const satisfies readonly (keyof MissionContract)[];

export const CONTRACT_BOOLEAN_KEYS = [
  "allow_dynamic_specifiers",
  "strict_relative_imports",
] as const satisfies readonly (keyof MissionContract)[];
