import fs from "node:fs";
import path from "node:path";
import { fromPosix } from "./cli-io.js";
import { gitRunOk } from "./git-repo.js";

export const ENV_TEACHER_EMAILS = "GAPMAN_TEACHER_EMAILS" as const;
export const GIT_CONFIG_TEACHER_EMAILS = "gapman.teacherEmails" as const;

export const REL_TEACHER_ALLOWLIST = ".gitagent/foreman/TEACHER.allowlist" as const;
export const REL_TEACHER_ALLOWLIST_LOCAL = ".gitagent/foreman/TEACHER.allowlist.local" as const;

export type TeacherIdentitySource =
  | "allowlist_file"
  | "allowlist_local"
  | "git_config"
  | "env"
  | "git_user_email"
  | "unset";

export interface ResolvedTeacherIdentity {
  emails: string[];
  source: TeacherIdentitySource;
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

function readGitConfigTeacherEmails(repoRoot: string): string[] {
  const local = gitRunOk(repoRoot, ["config", "--local", "--get", GIT_CONFIG_TEACHER_EMAILS]);
  if (local.ok && local.stdout.trim()) {
    return normalizeEmailList(local.stdout);
  }
  const global = gitRunOk(repoRoot, ["config", "--global", "--get", GIT_CONFIG_TEACHER_EMAILS]);
  if (global.ok && global.stdout.trim()) {
    return normalizeEmailList(global.stdout);
  }
  return [];
}

function readGitUserEmail(repoRoot: string): string | null {
  const local = gitRunOk(repoRoot, ["config", "--local", "--get", "user.email"]);
  if (local.ok && local.stdout.trim()) {
    return local.stdout.trim().toLowerCase();
  }
  return null;
}

/** Legacy env-only parser (tests / explicit CI override). */
export function parseTeacherEmailsFromEnv(): string[] {
  const raw = process.env[ENV_TEACHER_EMAILS];
  if (!raw?.trim()) return [];
  return normalizeEmailList(raw);
}

/**
 * Resolve Teacher legislation allowlist for a repository.
 * Repo-local sources win over shell env so multi-project developers are not cross-contaminated.
 */
export function resolveTeacherEmails(repoRoot: string): ResolvedTeacherIdentity {
  const team = readAllowlistFile(repoRoot, REL_TEACHER_ALLOWLIST);
  const local = readAllowlistFile(repoRoot, REL_TEACHER_ALLOWLIST_LOCAL);
  const mergedFile = [...new Set([...team, ...local])];
  if (mergedFile.length > 0) {
    const sources: string[] = [];
    if (team.length > 0) sources.push(REL_TEACHER_ALLOWLIST);
    if (local.length > 0) sources.push(REL_TEACHER_ALLOWLIST_LOCAL);
    return {
      emails: mergedFile,
      source: local.length > 0 && team.length === 0 ? "allowlist_local" : "allowlist_file",
      detail: sources.join(" + "),
    };
  }

  const fromGitConfig = readGitConfigTeacherEmails(repoRoot);
  if (fromGitConfig.length > 0) {
    return {
      emails: fromGitConfig,
      source: "git_config",
      detail: `git config ${GIT_CONFIG_TEACHER_EMAILS}`,
    };
  }

  const fromEnv = parseTeacherEmailsFromEnv();
  if (fromEnv.length > 0) {
    return {
      emails: fromEnv,
      source: "env",
      detail: ENV_TEACHER_EMAILS,
    };
  }

  const gitEmail = readGitUserEmail(repoRoot);
  if (gitEmail) {
    return {
      emails: [gitEmail],
      source: "git_user_email",
      detail: "git config user.email (implicit single Teacher)",
    };
  }

  return { emails: [], source: "unset", detail: "no Teacher identity configured" };
}

export function serializeTeacherAllowlist(emails: string[]): string {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  return `${unique.join("\n")}\n`;
}

export function writeTeacherAllowlistLocal(repoRoot: string, emails: string[]): void {
  const abs = path.join(repoRoot, fromPosix(REL_TEACHER_ALLOWLIST_LOCAL));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeTeacherAllowlist(emails), "utf8");
}

/** Create gitignored local allowlist from repo git user.email when missing. */
export function ensureTeacherAllowlistOnInit(repoRoot: string): boolean {
  const abs = path.join(repoRoot, fromPosix(REL_TEACHER_ALLOWLIST_LOCAL));
  if (fs.existsSync(abs)) return false;
  const team = readAllowlistFile(repoRoot, REL_TEACHER_ALLOWLIST);
  if (team.length > 0) return false;
  const gitEmail = readGitUserEmail(repoRoot);
  if (!gitEmail) return false;
  writeTeacherAllowlistLocal(repoRoot, [gitEmail]);
  return true;
}

export function teacherIdentitySetupHint(_repoRoot: string): string {
  return [
    `echo "$(git config user.email)" >> ${REL_TEACHER_ALLOWLIST_LOCAL}`,
    `or: git config gapman.teacherEmails "$(git config user.email)"`,
    `or: gapman teacher set "$(git config user.email)"`,
    `# env ${ENV_TEACHER_EMAILS} is CI-only fallback; prefer repo-local config`,
  ].join("\n       ");
}
