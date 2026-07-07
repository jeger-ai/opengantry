import fs from "node:fs";
import path from "node:path";
import { fromPosix } from "./cli-io.js";
import { CLI_NAME } from "./constants.js";
import {
  ENV_PLANNER_EMAILS,
  GIT_CONFIG_PLANNER_EMAILS,
  readEnvWithLegacy,
  readGitConfigWithLegacy,
} from "./config-namespace.js";
import { gitRunOk } from "./git.js";

export { ENV_PLANNER_EMAILS } from "./config-namespace.js";

export const REL_PLANNER_ALLOWLIST = ".gitagent/foreman/PLANNER.allowlist" as const;
export const REL_PLANNER_ALLOWLIST_LOCAL = ".gitagent/foreman/PLANNER.allowlist.local" as const;

export type PlannerIdentitySource =
  | "allowlist_file"
  | "allowlist_local"
  | "git_config"
  | "env"
  | "git_user_email"
  | "unset";

export interface ResolvedPlannerIdentity {
  emails: string[];
  source: PlannerIdentitySource;
  /** Human-readable detail for doctor / errors */
  detail: string;
}

function normalizeEmailList(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((s) => s.replace(/#.*$/, "").trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("@"));
  return [...new Set(parts)];
}

function readAllowlistFile(repoRoot: string, relPath: string): string[] {
  const abs = path.join(repoRoot, fromPosix(relPath));
  if (!fs.existsSync(abs)) return [];
  return normalizeEmailList(fs.readFileSync(abs, "utf8"));
}

function readGitConfigPlannerEmails(repoRoot: string): string[] {
  const raw = readGitConfigWithLegacy(repoRoot, "plannerEmails");
  if (!raw) return [];
  return normalizeEmailList(raw);
}

function readGitUserEmail(repoRoot: string): string | null {
  const local = gitRunOk(repoRoot, ["config", "--local", "--get", "user.email"]);
  if (local.ok && local.stdout.trim()) {
    return local.stdout.trim().toLowerCase();
  }
  return null;
}

/** Legacy env-only parser (tests / explicit CI override). */
export function parsePlannerEmailsFromEnv(): string[] {
  const raw = readEnvWithLegacy("PLANNER_EMAILS");
  if (!raw) return [];
  return normalizeEmailList(raw);
}

/**
 * Resolve Planner legislation allowlist for a repository.
 * Repo-local sources win over shell env so multi-project developers are not cross-contaminated.
 */
export function resolvePlannerEmails(repoRoot: string): ResolvedPlannerIdentity {
  const team = readAllowlistFile(repoRoot, REL_PLANNER_ALLOWLIST);
  const local = readAllowlistFile(repoRoot, REL_PLANNER_ALLOWLIST_LOCAL);
  const mergedFile = [...new Set([...team, ...local])];
  if (mergedFile.length > 0) {
    const sources: string[] = [];
    if (team.length > 0) sources.push(REL_PLANNER_ALLOWLIST);
    if (local.length > 0) sources.push(REL_PLANNER_ALLOWLIST_LOCAL);
    return {
      emails: mergedFile,
      source: local.length > 0 && team.length === 0 ? "allowlist_local" : "allowlist_file",
      detail: sources.join(" + "),
    };
  }

  const fromGitConfig = readGitConfigPlannerEmails(repoRoot);
  if (fromGitConfig.length > 0) {
    return {
      emails: fromGitConfig,
      source: "git_config",
      detail: `git config ${GIT_CONFIG_PLANNER_EMAILS}`,
    };
  }

  const fromEnv = parsePlannerEmailsFromEnv();
  if (fromEnv.length > 0) {
    return {
      emails: fromEnv,
      source: "env",
      detail: ENV_PLANNER_EMAILS,
    };
  }

  const gitEmail = readGitUserEmail(repoRoot);
  if (gitEmail) {
    return {
      emails: [gitEmail],
      source: "git_user_email",
      detail: "git config user.email (implicit single Planner)",
    };
  }

  return { emails: [], source: "unset", detail: "no Planner identity configured" };
}

export function serializePlannerAllowlist(emails: string[]): string {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  return `${unique.join("\n")}\n`;
}

export function writePlannerAllowlistLocal(repoRoot: string, emails: string[]): void {
  const abs = path.join(repoRoot, fromPosix(REL_PLANNER_ALLOWLIST_LOCAL));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializePlannerAllowlist(emails), "utf8");
}

/** Create gitignored local allowlist from repo git user.email when missing. */
export function ensurePlannerAllowlistOnInit(repoRoot: string): boolean {
  const abs = path.join(repoRoot, fromPosix(REL_PLANNER_ALLOWLIST_LOCAL));
  if (fs.existsSync(abs)) return false;
  const team = readAllowlistFile(repoRoot, REL_PLANNER_ALLOWLIST);
  if (team.length > 0) return false;
  const gitEmail = readGitUserEmail(repoRoot);
  if (!gitEmail) return false;
  writePlannerAllowlistLocal(repoRoot, [gitEmail]);
  return true;
}

export function plannerIdentitySetupHint(_repoRoot: string): string {
  return [
    `echo "$(git config user.email)" >> ${REL_PLANNER_ALLOWLIST_LOCAL}`,
    `or: git config ${GIT_CONFIG_PLANNER_EMAILS} "$(git config user.email)"`,
    `or: ${CLI_NAME} planner set "$(git config user.email)"`,
    `# env ${ENV_PLANNER_EMAILS} is CI-only fallback; prefer repo-local config`,
  ].join("\n       ");
}
