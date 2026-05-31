import path from "node:path";
import { REL_UPGRADE_TMP } from "./upgrade-plan.js";

/** Absolute path to the upgrade staging directory under repo root. */
export function upgradeTmpAbs(repoRoot: string): string {
  return path.join(repoRoot, REL_UPGRADE_TMP.split("/").join(path.sep));
}

/** Absolute staged path for a repo-relative target path. */
export function upgradeStageAbs(repoRoot: string, targetRel: string): string {
  return path.join(upgradeTmpAbs(repoRoot), targetRel.split("/").join(path.sep));
}
