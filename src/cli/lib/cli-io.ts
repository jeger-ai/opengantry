import path from "node:path";
import { CLI_NAME } from "./constants.js";

export function logInfo(message: string): void {
  console.log(message);
}

export function logWarn(message: string): void {
  console.error(`${CLI_NAME}: warning: ${message}`);
}

export function logError(message: string): void {
  console.error(`${CLI_NAME}: ${message}`);
}

/** Relative path for user-facing messages */
export function formatRepoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath);
}

export function setExitCode(code: number): void {
  process.exitCode = code;
}
