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
 * - `managed_strict`: drift is a conflict unless `--force` is provided.
 */
export const INIT_ASSETS: readonly InitAsset[] = [
  { targetPath: ".gitagent/foreman/MANIFEST.json", mode: "scaffold_only" },
  { targetPath: ".gitagent/teacher/RULES.md", mode: "scaffold_only" },
  { targetPath: ".gitagent/missions/README.md", mode: "scaffold_only" },
  { targetPath: "skills/ui-ralph.md", mode: "scaffold_only" },
  { targetPath: "skills/logic-ralph.md", mode: "scaffold_only" },
  { targetPath: "skills/substrate-ralph.md", mode: "scaffold_only" },
  { targetPath: "AGENTS.md", mode: "scaffold_only" },
  { targetPath: ".github/workflows/gxt-validate.yml", mode: "managed_strict" },
  { targetPath: "scripts/validate-gxt.sh", mode: "managed_strict", executable: true },
  { targetPath: ".githooks/post-checkout", mode: "managed_strict", executable: true },
  { targetPath: ".cursor/rules/opengantry-gxt-substrate.mdc", mode: "managed_strict" },
  { targetPath: ".gitagent/teacher/MISSION.schema.yaml", mode: "managed_strict" },
  { targetPath: ".gitagent/teacher/WORKER_LOG.template.md", mode: "managed_strict" },
] as const;
