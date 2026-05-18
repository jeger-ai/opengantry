import { spawnSync } from "node:child_process";

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Run git in repository root (`git -C root ...args`). */
export function gitRun(repoRoot: string, args: string[], maxBuffer = 32 * 1024 * 1024): GitRunResult {
  const r = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer,
  });
  return {
    ok: r.status === 0,
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" ? r.stderr : "",
    status: r.status,
  };
}

export function gitRunOk(
  repoRoot: string,
  args: string[],
  maxBuffer = 32 * 1024 * 1024,
): { ok: boolean; stdout: string } {
  const r = gitRun(repoRoot, args, maxBuffer);
  return { ok: r.ok, stdout: r.stdout };
}

export function gitRevParse(repoRoot: string, ref: string): string | null {
  const r = gitRunOk(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export function gitHead(repoRoot: string): string | null {
  const r = gitRunOk(repoRoot, ["rev-parse", "HEAD"]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}
