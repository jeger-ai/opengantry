import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
    throw new Error("gapman: not inside a git repository");
  }
}

export function gitRevParse(ref: string, root: string): string {
  return execSync(`git rev-parse --verify ${JSON.stringify(`${ref}^{commit}`)}`, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function readFileSafe(root: string, rel: string): string | null {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export function pathExists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}
