import { GantryUserError } from "#core/user-error.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Set by the launcher only in the host wrapper's environment. */
export const CAGE_HOST_STATE_ENV = "GANTRY_CAGE_HOST_STATE";

interface HostGitContext {
  root: string;
  stateDir: string;
  gitDir: string;
  indexFile: string;
  commonDir: string;
  worktreeGitDir: string;
  hooksDir: string;
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

function identityPath(value: unknown): string {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value || value.includes("\0")) {
    throw new Error("cage: host Git identity requires normalized absolute paths");
  }
  return value;
}

/** The launcher supplies and protects this directory across runs, including during recovery. */
export function trustedCageGit(cwd: string): HostGitContext | null {
  const configured = process.env[CAGE_HOST_STATE_ENV];
  if (configured === undefined) return null;
  if (process.platform !== "linux") throw new Error("cage: host Git isolation requires Linux");
  const stateDir = identityPath(configured);
  const st = fs.statSync(stateDir);
  if (fs.realpathSync(stateDir) !== stateDir || !st.isDirectory() || st.uid !== process.geteuid!() || (st.mode & 0o077) !== 0) {
    throw new Error("cage: host state must be a private directory owned by the host wrapper");
  }
  const identity = path.join(stateDir, "identity.json");
  if (!fs.lstatSync(identity).isFile()) throw new Error("cage: expected regular host identity file");
  const record = JSON.parse(fs.readFileSync(identity, "utf8")) as Record<string, unknown>;
  const root = identityPath(record.root);
  const commonDir = identityPath(record.commonDir);
  const worktreeGitDir = identityPath(record.worktreeGitDir);
  const hooksDir = identityPath(record.hooksDir);
  if (!inside(root, fs.realpathSync(cwd)) || fs.realpathSync(root) !== root ||
      [root, commonDir, worktreeGitDir, hooksDir].some(dir => inside(dir, stateDir) || inside(stateDir, dir))) {
    throw new Error("cage: the worktree and its Git paths must be separate from host state");
  }
  const gitDir = path.join(stateDir, "git");
  if (!fs.lstatSync(gitDir).isDirectory()) throw new Error("cage: missing private Git directory");
  return { root, stateDir, gitDir, indexFile: path.join(gitDir, "index"), commonDir, worktreeGitDir, hooksDir };
}

/** Read the reviewed config blob directly, without transforming bytes through worktree attributes. */
export function hostCageConfigCommitted(host: HostGitContext, filename: string, contents: Buffer): boolean | null {
  const result = spawnSync("/usr/bin/git", ["--git-dir", host.gitDir, "cat-file", "blob", "HEAD:" + filename], {
    cwd: host.stateDir,
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" },
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.equals(contents);
}

/** Serialize startup, recovery and shutdown. Linux releases the inherited open-file-description lock on process exit. */
export async function withHostCageLock<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const host = trustedCageGit(cwd);
  if (!host) return run();
  const fd = fs.openSync(path.join(host.stateDir, "session.lock"),
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const result = spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "ignore", "pipe", fd],
    });
    if (result.error) throw result.error;
    if (result.status === 1) throw new GantryUserError("GXT_CAGE_SESSION_ACTIVE",
      "cage: another session holds the host state lock", "Finish the active cage session before retrying.", 2);
    if (result.status !== 0) throw new Error("cage: cannot acquire exclusive host state lock");
    return await run();
  } finally {
    fs.closeSync(fd);
  }
}
