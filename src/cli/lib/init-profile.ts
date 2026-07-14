import path from "node:path";
import type { IntegrationIdeKey } from "./integration-compat.js";
import {
  parseDefensiveProfilePreset,
  type DefensiveProfilePresetName,
} from "./defensive-profile-presets.js";

export type SkillsPreset = "minimal" | "specimen";

/** Where code architecture docs live — unset means agents must ask before implementing. */
export type ArchitectureSourceKind = "unset" | "file" | "directory" | "external";

export interface InitProfile {
  ides: IntegrationIdeKey[];
  integrationsDocPath: string;
  skillsPreset: SkillsPreset;
  gitHooks: boolean;
  ciWorkflow: boolean;
  architectureSource: ArchitectureSourceKind;
  architectureLocation?: string;
  architectureAccessRequired?: boolean;
  architectureCredentialSlot?: string;
  architectureAuthHint?: string;
  /** Selected defensive profile preset; undefined = prompt/default, null = explicit skip */
  defensiveProfilePreset?: DefensiveProfilePresetName | null;
}

export const DEFAULT_INTEGRATIONS_DOC_PATH = "docs/INTEGRATIONS.md";

export function defaultInitProfile(): InitProfile {
  return {
    ides: ["cursor"],
    integrationsDocPath: DEFAULT_INTEGRATIONS_DOC_PATH,
    skillsPreset: "specimen",
    gitHooks: true,
    ciWorkflow: true,
    architectureSource: "unset",
  };
}

export function parseArchitectureSource(raw: string): ArchitectureSourceKind {
  if (raw === "unset" || raw === "file" || raw === "directory" || raw === "external") {
    return raw;
  }
  throw new Error("init: --arch-source must be unset, file, directory, or external");
}

export function parseIdesCsv(raw: string): IntegrationIdeKey[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("init: --ides requires at least one IDE key");
  return parts as IntegrationIdeKey[];
}

export function validateIntegrationsDocPath(repoRoot: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("init: integrations doc path must not contain ..");
  if (path.isAbsolute(normalized)) throw new Error("init: integrations doc path must be repo-relative");
  const abs = path.resolve(repoRoot, normalized);
  const rootResolved = path.resolve(repoRoot);
  if (abs !== rootResolved && !abs.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error("init: integrations doc path escapes repo root");
  }
  return normalized;
}

export function profileFromCliFlags(opts: {
  ides?: string;
  docsPath?: string;
  skills?: string;
  hooks?: boolean;
  noHooks?: boolean;
  ci?: boolean;
  noCi?: boolean;
  archSource?: string;
  archLocation?: string;
  defensiveProfile?: string;
  noDefensiveProfile?: boolean;
}): Partial<InitProfile> {
  const partial: Partial<InitProfile> = {};
  if (opts.ides) partial.ides = parseIdesCsv(opts.ides);
  if (opts.docsPath) partial.integrationsDocPath = opts.docsPath.replace(/\\/g, "/");
  if (opts.skills === "minimal" || opts.skills === "specimen") partial.skillsPreset = opts.skills;
  if (opts.noHooks) partial.gitHooks = false;
  else if (opts.hooks) partial.gitHooks = true;
  if (opts.noCi) partial.ciWorkflow = false;
  else if (opts.ci) partial.ciWorkflow = true;
  if (opts.archSource) partial.architectureSource = parseArchitectureSource(opts.archSource);
  if (opts.archLocation) partial.architectureLocation = opts.archLocation.replace(/\\/g, "/");
  if (opts.noDefensiveProfile) partial.defensiveProfilePreset = null;
  else if (opts.defensiveProfile) {
    partial.defensiveProfilePreset = parseDefensiveProfilePreset(opts.defensiveProfile);
  }
  return partial;
}

export function mergeInitProfile(base: InitProfile, partial: Partial<InitProfile>): InitProfile {
  return {
    ides: partial.ides ?? base.ides,
    integrationsDocPath: partial.integrationsDocPath ?? base.integrationsDocPath,
    skillsPreset: partial.skillsPreset ?? base.skillsPreset,
    gitHooks: partial.gitHooks ?? base.gitHooks,
    ciWorkflow: partial.ciWorkflow ?? base.ciWorkflow,
    architectureSource: partial.architectureSource ?? base.architectureSource,
    architectureLocation: partial.architectureLocation ?? base.architectureLocation,
    architectureAccessRequired: partial.architectureAccessRequired ?? base.architectureAccessRequired,
    architectureCredentialSlot: partial.architectureCredentialSlot ?? base.architectureCredentialSlot,
    architectureAuthHint: partial.architectureAuthHint ?? base.architectureAuthHint,
    defensiveProfilePreset:
      partial.defensiveProfilePreset !== undefined
        ? partial.defensiveProfilePreset
        : base.defensiveProfilePreset,
  };
}

export function hasFullCliProfile(partial: Partial<InitProfile>): boolean {
  return (
    partial.ides !== undefined &&
    partial.integrationsDocPath !== undefined &&
    partial.skillsPreset !== undefined &&
    partial.gitHooks !== undefined &&
    partial.ciWorkflow !== undefined
  );
}

export function shouldRunInteractiveWizard(options: {
  yes?: boolean;
  partial: Partial<InitProfile>;
}): boolean {
  if (options.yes) return false;
  if (!process.stdout.isTTY) return false;
  if (hasFullCliProfile(options.partial)) return false;
  return true;
}
