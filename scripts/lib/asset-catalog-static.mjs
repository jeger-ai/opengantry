/** Hand-tuned static assets — source of truth for core/skills/hooks/ci/runtime. */
export const STATIC_ASSETS = [
  { targetPath: ".gitagent/foreman/MANIFEST.json", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/foreman/BYPASS.sha256", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/foreman/SUBSTRATE.version.json", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/planner/RULES.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/missions/README.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/config.json", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "AGENTS.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/planner/ARCHITECTURE-DISCOVERY.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/planner/ARCHITECTURE-ACCESS.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/planner/MISSION-ARCHITECT.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "docs/ARCHITECTURE.md", mode: "scaffold_only", tags: ["core"] },
  { targetPath: "TARGET_ARCHITECTURE.yaml", mode: "scaffold_only", tags: ["core"] },
  { targetPath: ".gitagent/planner/MISSION.schema.yaml", mode: "managed_strict", tags: ["core"] },
  { targetPath: ".gitagent/planner/KPI-REPORT.schema.yaml", mode: "managed_strict", tags: ["core"] },
  { targetPath: ".gitagent/planner/EXECUTOR_LOG.template.md", mode: "managed_strict", tags: ["core"] },
  { targetPath: "scripts/validate-gxt.sh", mode: "managed_strict", executable: true, tags: ["core"] },
  { targetPath: "scripts/gxt-manifest-lib.mjs", mode: "managed_strict", executable: true, tags: ["core"] },
  { targetPath: "scripts/lib/glob-match.mjs", mode: "managed_strict", tags: ["core"] },
  { targetPath: "scripts/lib/manifest-validate.mjs", mode: "managed_strict", tags: ["core"] },
  { targetPath: "scripts/lib/trusted-automation.mjs", mode: "managed_strict", tags: ["core"] },
  { targetPath: "skills/ui.md", mode: "scaffold_only", tags: ["skill-minimal", "skill-specimen"] },
  { targetPath: "skills/logic.md", mode: "scaffold_only", tags: ["skill-minimal", "skill-specimen"] },
  { targetPath: "skills/gantry.md", mode: "scaffold_only", tags: ["skill-specimen"] },
  { targetPath: "skills/substrate.md", mode: "scaffold_only", tags: ["skill-specimen"] },
  { targetPath: ".githooks/post-checkout", mode: "managed_strict", executable: true, tags: ["hooks"] },
  { targetPath: ".githooks/pre-commit", mode: "managed_strict", executable: true, tags: ["hooks"] },
  { targetPath: ".githooks/pre-push", mode: "managed_strict", executable: true, tags: ["hooks"] },
  { targetPath: ".github/workflows/gxt-validate.yml", mode: "managed_strict", tags: ["ci"] },
  { targetPath: "scripts/verify-pr-missions.sh", mode: "managed_strict", executable: true, tags: ["ci"] },
  { targetPath: "scripts/gxt-runtime-env.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-resolve-mission.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-pin-mission.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-cursor-env.sh", mode: "managed_strict", executable: true, tags: ["runtime"] },
  { targetPath: "scripts/gxt-shell-agent.sh", mode: "managed_strict", executable: true, tags: ["runtime", "claude-code", "codex-cli", "opencode"] },
];

/** Repo-only scripts — never ship via init catalog (OpenGantry specimen dev gates). */
export const REPO_ONLY_SCRIPTS = [
  "check-changed-code.sh",
  "check-import-layers.mjs",
  "check-lib-cycles.mjs",
  "dev-validate-core.sh",
  "dev-validate.sh",
  "npm-pack-check.sh",
  "validate-mcp-dogfood.mjs",
  "validate-mcp-dogfood.sh",
  "gen-asset-catalog.mjs",
  "gen-version.mjs",
];

/** @param {string} fileNameOrRel */
export function isRepoOnlyScript(fileNameOrRel) {
  const base = fileNameOrRel.split("/").pop() ?? fileNameOrRel;
  return REPO_ONLY_SCRIPTS.includes(base);
}

export const IDE_DISCOVERY_RULES = {
  cursor: { mode: "managed_strict", scanDir: ".cursor", targetPrefix: ".cursor" },
  default: { mode: "scaffold_only", scanSubdir: "integrations/{key}", templatePrefix: "integrations/{key}" },
};
