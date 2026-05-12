import { spawnSync } from "node:child_process";
import type { GateSpec } from "./types.js";

export interface GateRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

export function runGate(cwd: string, spec: GateSpec): GateRunResult {
  const shell = process.platform === "win32" ? true : "/bin/sh";
  const proc = spawnSync(spec.command, {
    cwd,
    shell,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env },
  });
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;
  return {
    exitCode: proc.status,
    stdout,
    stderr,
    combined,
  };
}

export function gatePassed(result: GateRunResult, successSubstring: string | null): boolean {
  if (result.exitCode !== 0) return false;
  if (successSubstring && !result.combined.includes(successSubstring)) return false;
  return true;
}
