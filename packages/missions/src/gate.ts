import { spawnSync } from "node:child_process";
import path from "node:path";
import { withoutGitRepoEnv } from "#git/git.js";
import type { GateSpec } from "#core/mission-types.js";

export const MAX_IO_BUFFER_BYTES = 20 * 1024 * 1024;

interface GateWorkDirOptions {
  cwd?: string;
}

/** Resolve working directory for gate/scan subprocess execution. */
export function resolveGateWorkDir(root: string, options: GateWorkDirOptions = {}): string {
  return options.cwd ? path.resolve(root, options.cwd) : root;
}

interface GateRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

export function shellForPlatform(): boolean | string {
  return process.platform === "win32" ? true : "/bin/sh";
}

export function runGate(workingDirectory: string, spec: GateSpec): GateRunResult {
  const proc = spawnSync(spec.command, {
    cwd: workingDirectory,
    shell: shellForPlatform(),
    encoding: "utf8",
    maxBuffer: MAX_IO_BUFFER_BYTES,
    // A gate run from a linked worktree's hook must not inherit its GIT_DIR (MSN-0266); cwd locates the repo.
    env: withoutGitRepoEnv(),
  });
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  return {
    exitCode: proc.status,
    stdout,
    stderr,
    combined: `${stdout}\n${stderr}`,
  };
}
