import fs from "node:fs";
import path from "node:path";
import { GIT_CONFIG_ALLOWED_SIGNERS, REL_PLANNER_SIGNING_PUB } from "./constants.js";
import { gitConfigGet, gitConfigSet, gitRunOk } from "./git.js";

/** `git log --format=%G?` signature letter for a commit. */
export type GitSignatureStatus = "G" | "U" | "B" | "X" | "Y" | "R" | "E" | "N" | string;

export function gitCommitSignatureStatus(repoRoot: string, commitRef: string): GitSignatureStatus {
  const result = gitRunOk(repoRoot, ["log", "-1", `--format=%G?`, commitRef]);
  if (!result.ok) return "N";
  const status = result.stdout.trim();
  return status.length > 0 ? status.charAt(0) : "N";
}

/** Good signature per git (%G? = G or U). */
export function isGoodGitSignatureStatus(status: GitSignatureStatus): boolean {
  return status === "G" || status === "U";
}

export interface PlannerStampSignatureCheck {
  ok: boolean;
  status: GitSignatureStatus;
}

export function checkPlannerStampSignature(
  repoRoot: string,
  commitHash: string,
): PlannerStampSignatureCheck {
  const status = gitCommitSignatureStatus(repoRoot, commitHash);
  return { ok: isGoodGitSignatureStatus(status), status };
}

export interface AllowedSignersConfig {
  present: boolean;
  configured: boolean;
  path: string | null;
}

/** Point git at PLANNER.signing.pub when present so SSH commit signatures verify. */
export function ensurePlannerAllowedSignersFile(repoRoot: string): AllowedSignersConfig {
  const abs = path.join(repoRoot, REL_PLANNER_SIGNING_PUB);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { present: false, configured: false, path: null };
  }
  const ok = gitConfigSet(repoRoot, GIT_CONFIG_ALLOWED_SIGNERS, REL_PLANNER_SIGNING_PUB);
  const current = gitConfigGet(repoRoot, GIT_CONFIG_ALLOWED_SIGNERS);
  return {
    present: true,
    configured: ok && current === REL_PLANNER_SIGNING_PUB,
    path: REL_PLANNER_SIGNING_PUB,
  };
}
