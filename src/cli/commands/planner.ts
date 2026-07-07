import { getRepoRoot } from "../lib/git.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { CLI_NAME } from "../lib/constants.js";
import {
  REL_PLANNER_ALLOWLIST_LOCAL,
  resolvePlannerEmails,
  writePlannerAllowlistLocal,
} from "../lib/planner-identity.js";

export interface PlannerShowOptions {
  json?: boolean;
  cwd?: string;
}

export interface PlannerSetOptions {
  emails: string[];
  cwd?: string;
}

export function runPlannerShow(options: PlannerShowOptions = {}): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace(`${CLI_NAME}: `, "") : String(e));
    setExitCode(2);
    return;
  }

  const resolved = resolvePlannerEmails(repoRoot);
  if (options.json) {
    console.log(JSON.stringify({ ...resolved, repo_root: repoRoot }, null, 2));
    return;
  }

  if (resolved.emails.length === 0) {
    logInfo(`${CLI_NAME} planner: no allowlist configured`);
    logInfo(`  Run: gantry planner set "$(git config user.email)"`);
    return;
  }

  logInfo(`${CLI_NAME} planner: ${resolved.emails.join(", ")}`);
  logInfo(`  source: ${resolved.detail} (${resolved.source})`);
}

export function runPlannerSet(options: PlannerSetOptions): void {
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
    logError(`${CLI_NAME} planner set: provide at least one email`);
    setExitCode(2);
    return;
  }

  writePlannerAllowlistLocal(repoRoot, emails);
  logInfo(`${CLI_NAME} planner: wrote ${REL_PLANNER_ALLOWLIST_LOCAL}`);
  logInfo(`  emails: ${emails.join(", ")}`);
}
