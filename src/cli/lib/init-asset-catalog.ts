import path from "node:path";
import type { InitAsset } from "./init-assets.js";
import type { IntegrationCompatManifest } from "./integration-compat.js";
import type { InitProfile } from "./init-profile.js";

export type InitAssetTag =
  | "core"
  | "skill-minimal"
  | "skill-specimen"
  | "hooks"
  | "ci"
  | "runtime"
  | "cursor"
  | "claude-code"
  | "codex-cli"
  | "opencode"
  | "junie"
  | "antigravity"
  | "cline"
  | "aider"
  | "openhands";

export interface InitAssetSpec extends InitAsset {
  /** Template path relative to templates/ (defaults to targetPath). */
  templatePath?: string;
  tags: InitAssetTag[];
}

const CORE_ASSETS: InitAssetSpec[] = [
  { targetPath: ".gitagent/foreman/MANIFEST.json", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/foreman/BYPASS.sha256", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/RULES.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/missions/README.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "AGENTS.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/ARCHITECTURE-DISCOVERY.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/ARCHITECTURE-ACCESS.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/MISSION-ARCHITECT.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "docs/ARCHITECTURE.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/teacher/MISSION.schema.yaml", mode: "managed_strict", tags: ["core"] },
  { targetPath: ".gitagent/teacher/WORKER_LOG.template.md", mode: "managed_strict", tags: ["core"] },
  { targetPath: "scripts/validate-gxt.sh", mode: "managed_strict", executable: true, tags: ["core"] },
];

const SKILL_ASSETS: InitAssetSpec[] = [
  { targetPath: "skills/ui.md", mode: "scaffold_only", tags: ["skill-minimal", "skill-specimen"] },
  { targetPath: "skills/logic.md", mode: "scaffold_only", tags: ["skill-minimal", "skill-specimen"] },
  { targetPath: "skills/gapman.md", mode: "scaffold_only", tags: ["skill-specimen"] },
  { targetPath: "skills/substrate.md", mode: "scaffold_only", tags: ["skill-specimen"] },
];

const HOOK_ASSETS: InitAssetSpec[] = [
  { targetPath: ".githooks/post-checkout", mode: "managed_strict", executable: true, tags: ["hooks"] },
  { targetPath: ".githooks/pre-push", mode: "managed_strict", executable: true, tags: ["hooks"] },
];

const CI_ASSETS: InitAssetSpec[] = [
  {
    targetPath: ".github/workflows/gxt-validate.yml",
    mode: "managed_strict",
    tags: ["ci"],
  },
];

const RUNTIME_ASSETS: InitAssetSpec[] = [
  { targetPath: "scripts/gxt-runtime-env.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-resolve-mission.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-pin-mission.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-cursor-env.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
];

const CURSOR_ASSETS: InitAssetSpec[] = [
  {
    targetPath: ".cursor/rules/opengantry-gxt-substrate.mdc",
    mode: "managed_strict",
    tags: ["cursor"],
  },
  { targetPath: ".cursor/hooks.json", mode: "managed_strict", tags: ["cursor"] },
  {
    targetPath: ".cursor/hooks/gxt-before-shell.sh",
    mode: "managed_strict",
    executable: true,
    tags: ["cursor"],
  },
  {
    targetPath: ".cursor/hooks/gxt-session-start.sh",
    mode: "managed_strict",
    executable: true,
    tags: ["cursor"],
  },
];

const IDE_PACK_ASSETS: InitAssetSpec[] = [
  {
    targetPath: "CLAUDE.md",
    templatePath: "integrations/claude-code/CLAUDE.md",
    mode: "scaffold_only",
    tags: ["claude-code"],
  },
  {
    targetPath: ".codex/config.toml",
    templatePath: "integrations/codex-cli/.codex/config.toml",
    mode: "scaffold_only",
    tags: ["codex-cli"],
  },
  {
    targetPath: "opencode.json",
    templatePath: "integrations/opencode/opencode.json",
    mode: "scaffold_only",
    tags: ["opencode"],
  },
  {
    targetPath: ".junie/guidelines.md",
    templatePath: "integrations/junie/.junie/guidelines.md",
    mode: "scaffold_only",
    tags: ["junie"],
  },
  {
    targetPath: ".agent/rules/gxt.md",
    templatePath: "integrations/antigravity/.agent/rules/gxt.md",
    mode: "scaffold_only",
    tags: ["antigravity"],
  },
  {
    targetPath: ".clinerules/gxt.md",
    templatePath: "integrations/cline/.clinerules/gxt.md",
    mode: "scaffold_only",
    tags: ["cline"],
  },
  {
    targetPath: ".aider.conf.yml",
    templatePath: "integrations/aider/.aider.conf.yml",
    mode: "scaffold_only",
    tags: ["aider"],
  },
  {
    targetPath: ".openhands/microagents/gxt.md",
    templatePath: "integrations/openhands/.openhands/microagents/gxt.md",
    mode: "scaffold_only",
    tags: ["openhands"],
  },
];

export const INIT_ASSET_CATALOG: readonly InitAssetSpec[] = [
  ...CORE_ASSETS,
  ...SKILL_ASSETS,
  ...HOOK_ASSETS,
  ...CI_ASSETS,
  ...RUNTIME_ASSETS,
  ...CURSOR_ASSETS,
  ...IDE_PACK_ASSETS,
];

function skillTag(profile: InitProfile): InitAssetTag {
  return profile.skillsPreset === "minimal" ? "skill-minimal" : "skill-specimen";
}

function assetMatchesProfile(asset: InitAssetSpec, profile: InitProfile): boolean {
  const skill = skillTag(profile);
  const activeTags = new Set<InitAssetTag>([
    "core",
    skill,
    "runtime",
    ...(profile.gitHooks ? (["hooks"] as InitAssetTag[]) : []),
    ...(profile.ciWorkflow ? (["ci"] as InitAssetTag[]) : []),
    ...profile.ides,
  ]);
  return asset.tags.some((t) => activeTags.has(t));
}

export function resolveAssetsFromProfile(
  profile: InitProfile,
  _compat: IntegrationCompatManifest,
): InitAssetSpec[] {
  void _compat;
  return INIT_ASSET_CATALOG.filter((a) => assetMatchesProfile(a, profile));
}

export function templatePathForAsset(asset: InitAssetSpec): string {
  return (asset.templatePath ?? asset.targetPath).split("/").join(path.sep);
}

/** Legacy default profile asset target paths (non-TTY / --yes parity). */
export function legacyDefaultInitTargetPaths(): string[] {
  return resolveAssetsFromProfile(
    {
      ides: ["cursor"],
      integrationsDocPath: "docs/INTEGRATIONS.md",
      skillsPreset: "specimen",
      gitHooks: true,
      ciWorkflow: true,
      architectureSource: "unset",
    },
    { schema_version: "1", opengantry_version: "0.8.1", integrations: {} as never },
  ).map((a) => a.targetPath);
}
