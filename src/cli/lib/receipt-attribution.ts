import crypto from "node:crypto";
import path from "node:path";

import { CLI_VERSION } from "./constants.js";
import { gitConfigGet, gitRevParse, gitRunOk } from "./git.js";
import type { OrgExportConfig } from "./org-export-config.js";

export type BranchClass = "default" | "non_default";
export type AttestationHarnessMode = "cli" | "mcp" | "ci" | "unknown";

export interface AttestationAgentState {
  name: string;
  version: string;
  harness_mode: AttestationHarnessMode;
}

export function hmacSha256Hex(pepper: string, message: string): string {
  return crypto.createHmac("sha256", pepper).update(message, "utf8").digest("hex");
}

function resolveRepositoryIdentifier(repoRoot: string): string {
  const remote = gitConfigGet(repoRoot, "remote.origin.url");
  if (remote) return remote.trim().toLowerCase();
  return path.basename(repoRoot).toLowerCase();
}

export function resolveRepositoryHash(repoRoot: string, org: OrgExportConfig): string {
  return hmacSha256Hex(org.pepper, resolveRepositoryIdentifier(repoRoot));
}

export function gitCurrentBranch(repoRoot: string): string {
  const r = gitRunOk(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = r.ok ? r.stdout.trim() : "";
  if (!branch || branch === "HEAD") return "detached";
  return branch;
}

export function gitTreeSha(repoRoot: string, ref = "HEAD"): string | null {
  const r = gitRunOk(repoRoot, ["rev-parse", "--verify", `${ref}^{tree}`]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export function gitDefaultBranchName(repoRoot: string): string | null {
  const sym = gitRunOk(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (sym.ok && sym.stdout.trim()) {
    const parts = sym.stdout.trim().split("/");
    const name = parts[parts.length - 1];
    if (name) return name;
  }
  if (gitRevParse(repoRoot, "main")) return "main";
  if (gitRevParse(repoRoot, "master")) return "master";
  return null;
}

export function resolveBranchClass(repoRoot: string, currentBranch: string): BranchClass {
  if (currentBranch === "detached") return "non_default";
  const defaultBranch = gitDefaultBranchName(repoRoot);
  if (!defaultBranch) return "non_default";
  return currentBranch === defaultBranch ? "default" : "non_default";
}

export function resolveBranchHmac(repoRoot: string, org: OrgExportConfig): {
  branch_hmac: string;
  branch_class: BranchClass;
} {
  const current = gitCurrentBranch(repoRoot);
  return {
    branch_hmac: hmacSha256Hex(org.pepper, current),
    branch_class: resolveBranchClass(repoRoot, current),
  };
}

function resolveHarnessMode(explicit?: AttestationHarnessMode): AttestationHarnessMode {
  if (explicit) return explicit;
  if (process.env.CI === "true" || process.env.CI === "1") return "ci";
  if (process.env.GANTRY_HARNESS_MODE?.trim()) {
    const mode = process.env.GANTRY_HARNESS_MODE.trim().toLowerCase();
    if (mode === "cli" || mode === "mcp" || mode === "ci") return mode;
  }
  return "cli";
}

export function resolveAttestationAgent(
  harnessMode?: AttestationHarnessMode,
): AttestationAgentState {
  const name =
    process.env.GANTRY_AGENT_NAME?.trim() ||
    (process.env.CI ? "ci-runner" : "gantry-cli");
  return {
    name,
    version: CLI_VERSION,
    harness_mode: resolveHarnessMode(harnessMode),
  };
}

export function pseudonymizeEmail(email: string, org: OrgExportConfig): string {
  return hmacSha256Hex(org.pepper, email.trim().toLowerCase());
}
