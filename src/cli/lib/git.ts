import { execSync } from "node:child_process";
import path from "node:path";
import { CLI_NAME } from "./constants.js";

export function getRepoRoot(cwd = process.cwd()): string {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) throw new Error("empty root");
    return path.resolve(cwd, out);
  } catch {
    throw new Error(`${CLI_NAME}: not inside a git repository`);
  }
}
