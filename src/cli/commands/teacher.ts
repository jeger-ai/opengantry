import { getRepoRoot } from "../lib/git.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { CLI_NAME } from "../lib/constants.js";
import {
  REL_TEACHER_ALLOWLIST_LOCAL,
  resolveTeacherEmails,
  writeTeacherAllowlistLocal,
} from "../lib/teacher-identity.js";

export interface TeacherShowOptions {
  json?: boolean;
  cwd?: string;
}

export interface TeacherSetOptions {
  emails: string[];
  cwd?: string;
}

export function runTeacherShow(options: TeacherShowOptions = {}): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace(`${CLI_NAME}: `, "") : String(e));
    setExitCode(2);
    return;
  }

  const resolved = resolveTeacherEmails(repoRoot);
  if (options.json) {
    console.log(JSON.stringify({ ...resolved, repo_root: repoRoot }, null, 2));
    return;
  }

  if (resolved.emails.length === 0) {
    logInfo(`${CLI_NAME} teacher: no allowlist configured`);
    logInfo(`  Run: gapman teacher set "$(git config user.email)"`);
    return;
  }

  logInfo(`${CLI_NAME} teacher: ${resolved.emails.join(", ")}`);
  logInfo(`  source: ${resolved.detail} (${resolved.source})`);
}

export function runTeacherSet(options: TeacherSetOptions): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace(`${CLI_NAME}: `, "") : String(e));
    setExitCode(2);
    return;
  }

  const emails = options.emails.flatMap((e) => e.split(",")).map((e) => e.trim()).filter(Boolean);
  if (emails.length === 0) {
    logError(`${CLI_NAME} teacher set: provide at least one email`);
    setExitCode(2);
    return;
  }

  writeTeacherAllowlistLocal(repoRoot, emails);
  logInfo(`${CLI_NAME} teacher: wrote ${REL_TEACHER_ALLOWLIST_LOCAL}`);
  logInfo(`  emails: ${emails.join(", ")}`);
}
