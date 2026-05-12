import { spawnSync } from "node:child_process";
import type { GateSpec } from "./types.js";

const MAX_IO_BUFFER_BYTES = 20 * 1024 * 1024;

export interface GateRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

function shellForPlatform(): boolean | string {
  return process.platform === "win32" ? true : "/bin/sh";
}

export function runGate(workingDirectory: string, spec: GateSpec): GateRunResult {
  const proc = spawnSync(spec.command, {
    cwd: workingDirectory,
    shell: shellForPlatform(),
    encoding: "utf8",
    maxBuffer: MAX_IO_BUFFER_BYTES,
    env: process.env,
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

export function gatePassed(result: GateRunResult, successSubstring: string | null): boolean {
  if (result.exitCode !== 0) return false;
  if (successSubstring && !result.combined.includes(successSubstring)) return false;
  return true;
}
