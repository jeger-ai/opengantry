export type InitAssetMode = "scaffold_only" | "managed_strict";

export interface InitAsset {
  targetPath: string;
  mode: InitAssetMode;
  executable?: boolean;
}

/**
 * Managed bootstrap assets copied by `gapman init`.
 *
 * - `scaffold_only`: write only when missing; never overwrite user-edited policy/config.
 * - `managed_strict`: drift is a conflict unless the user confirms overwrite or passes `--force`.
 */
export const INIT_ASSETS: readonly InitAsset[] = [
  { targetPath: ".gitagent/foreman/MANIFEST.json", mode: "scaffold_only" },
  { targetPath: ".gitagent/foreman/BYPASS.sha256", mode: "scaffold_only" },
  { targetPath: ".gitagent/foreman/SUBSTRATE.version.json", mode: "scaffold_only" },
  { targetPath: ".gitagent/teacher/RULES.md", mode: "scaffold_only" },
  { targetPath: ".gitagent/missions/README.md", mode: "scaffold_only" },
  { targetPath: "skills/ui.md", mode: "scaffold_only" },
  { targetPath: "skills/logic.md", mode: "scaffold_only" },
  { targetPath: "skills/gapman.md", mode: "scaffold_only" },
  { targetPath: "skills/substrate.md", mode: "scaffold_only" },
  { targetPath: "AGENTS.md", mode: "scaffold_only" },
  { targetPath: ".gitagent/teacher/ARCHITECTURE-DISCOVERY.md", mode: "scaffold_only" },
  { targetPath: ".gitagent/teacher/ARCHITECTURE-ACCESS.md", mode: "scaffold_only" },
  { targetPath: ".gitagent/teacher/MISSION-ARCHITECT.md", mode: "scaffold_only" },
  { targetPath: "docs/ARCHITECTURE.md", mode: "scaffold_only" },
  { targetPath: ".github/workflows/gxt-validate.yml", mode: "managed_strict" },
  { targetPath: "scripts/validate-gxt.sh", mode: "managed_strict", executable: true },
  { targetPath: ".githooks/post-checkout", mode: "managed_strict", executable: true },
  { targetPath: ".githooks/pre-push", mode: "managed_strict", executable: true },
  { targetPath: ".cursor/rules/opengantry-gxt-substrate.mdc", mode: "managed_strict" },
  { targetPath: ".cursor/hooks.json", mode: "managed_strict" },
  { targetPath: ".cursor/hooks/gxt-before-shell.sh", mode: "managed_strict", executable: true },
  { targetPath: ".cursor/hooks/gxt-session-start.sh", mode: "managed_strict", executable: true },
  { targetPath: "scripts/gxt-runtime-env.sh", mode: "managed_strict", executable: true },
  { targetPath: "scripts/gxt-resolve-mission.sh", mode: "managed_strict", executable: true },
  { targetPath: "scripts/gxt-pin-mission.sh", mode: "managed_strict", executable: true },
  { targetPath: "scripts/gxt-cursor-env.sh", mode: "managed_strict", executable: true },
  { targetPath: ".cursor/mcp.json", mode: "managed_strict" },
  { targetPath: ".gitagent/teacher/MISSION.schema.yaml", mode: "managed_strict" },
  { targetPath: ".gitagent/teacher/WORKER_LOG.template.md", mode: "managed_strict" },
] as const;
