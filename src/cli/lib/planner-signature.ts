import { gitRunOk } from "./git.js";

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
