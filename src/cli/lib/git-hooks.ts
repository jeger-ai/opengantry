import fs from "node:fs";
import path from "node:path";
import { gitConfigGet, gitConfigSet, gitRunOk } from "./git.js";

/** Local git config that makes `.githooks/pre-commit` pass `--strict`. */
export const TMVC_GUARD_STRICT_KEY = "gxt.tmvcGuardStrict";

/** Tracked hooks directory `gantry init` installs and `core.hooksPath` must name. */
export const TRACKED_HOOKS_PATH = ".githooks";

const PRE_COMMIT_REL = `${TRACKED_HOOKS_PATH}/pre-commit`;

export interface HooksStatus {
  strictArmed: boolean;
  hooksPath: string | null;
  preCommitPresent: boolean;
}

export type HooksInstallResult =
  | { ok: true; alreadyInstalled: boolean; hooksPath: string }
  | { ok: false; message: string };

function localConfig(repoRoot: string, key: string): string | null {
  const result = gitRunOk(repoRoot, ["config", "--local", "--get", key]);
  if (!result.ok || !result.stdout.trim()) return null;
  return result.stdout.trim();
}

export function readHooksStatus(repoRoot: string): HooksStatus {
  return {
    strictArmed: localConfig(repoRoot, TMVC_GUARD_STRICT_KEY) === "true",
    hooksPath: gitConfigGet(repoRoot, "core.hooksPath"),
    preCommitPresent: fs.existsSync(path.join(repoRoot, PRE_COMMIT_REL)),
  };
}

/**
 * Arm strict staged-TMVC enforcement on the tracked pre-commit hook.
 * Does not rewrite the hook file. Refuses when Git would run a different hooks path.
 */
export function installTmvcStrictHook(repoRoot: string): HooksInstallResult {
  if (!fs.existsSync(path.join(repoRoot, PRE_COMMIT_REL))) {
    return { ok: false, message: "hooks install: missing .githooks/pre-commit — run gantry init" };
  }

  const hooksPath = gitConfigGet(repoRoot, "core.hooksPath");
  if (hooksPath !== null && hooksPath !== TRACKED_HOOKS_PATH) {
    return {
      ok: false,
      message: `hooks install: core.hooksPath=${hooksPath} (expected ${TRACKED_HOOKS_PATH}). Strict mode was not armed.`,
    };
  }

  if (hooksPath === null && !gitConfigSet(repoRoot, "core.hooksPath", TRACKED_HOOKS_PATH)) {
    return { ok: false, message: "hooks install: failed to set core.hooksPath=.githooks" };
  }

  const alreadyInstalled = localConfig(repoRoot, TMVC_GUARD_STRICT_KEY) === "true";
  if (!alreadyInstalled && !gitConfigSet(repoRoot, TMVC_GUARD_STRICT_KEY, "true")) {
    return { ok: false, message: "hooks install: failed to set gxt.tmvcGuardStrict" };
  }

  return { ok: true, alreadyInstalled, hooksPath: TRACKED_HOOKS_PATH };
}

/** Clear the local strict key only. `core.hooksPath` stays as the operator left it. */
export function uninstallTmvcStrictHook(repoRoot: string): { removed: boolean } {
  if (localConfig(repoRoot, TMVC_GUARD_STRICT_KEY) === null) return { removed: false };
  return { removed: gitRunOk(repoRoot, ["config", "--local", "--unset", TMVC_GUARD_STRICT_KEY]).ok };
}
