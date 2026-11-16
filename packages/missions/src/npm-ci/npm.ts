import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The npm subprocess for `gantry npm ci` (issue #355 slice 4, ADR-0062 decision 5), isolated from every
 * configuration the candidate could write:
 *
 * - a fresh, empty user and global npmrc and a fresh cache under the run's temp directory, passed as flags (flags
 *   beat project, user, global and environment configuration);
 * - a clean environment: only `PATH`, a temp `HOME` and `TMPDIR`, and `LANG`. No `npm_config_*`, no `NODE_OPTIONS`
 *   (which would load code into npm itself), no proxy or token variables;
 * - `--ignore-scripts` and `--offline` on every command that installs: npm reads tarballs only from the cache the
 *   executor seeded with verified bytes and never contacts a registry;
 * - run in a staging directory that holds only the checked `package.json` and lockfile, so no project `.npmrc` exists.
 *
 * These are defense in depth around the executor's own checks, not a confinement boundary.
 */

export interface NpmRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface IsolatedNpm {
  /** The npm executable found on PATH (its real path), or null. */
  readonly path: string | null;
  /** `npm --version`, or null when npm is missing or fails. */
  version(): string | null;
  /** Seed the isolated cache with local tarball files (content-addressed by their integrity). */
  cacheAdd(files: readonly string[]): NpmRun;
  /** `npm ci --offline --ignore-scripts` in a directory holding only `package.json` and the lockfile. */
  ciOffline(cwd: string): NpmRun;
  /** `npm rebuild` with scripts enabled: runs the install scripts of every installed package, unconfined. */
  rebuildUnconfined(cwd: string): NpmRun;
}

const TIMEOUT_MS = 10 * 60 * 1000;
const CACHE_ADD_BATCH = 200;

/** The first executable `npm` on PATH, by its real path; null when there is none. */
function resolveNpm(pathEnv: string = process.env.PATH ?? ""): string | null {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "npm");
    try {
      const st = fs.statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return fs.realpathSync(candidate);
    } catch {
      // not here
    }
  }
  return null;
}

/** An npm runner whose configuration, cache and environment live under `work` (created, empty). */
export function isolatedNpm(work: string, registry?: string): IsolatedNpm {
  const npmPath = resolveNpm();
  for (const d of ["home", "cache", "tmp"]) fs.mkdirSync(path.join(work, d), { recursive: true });
  const userconfig = path.join(work, "npmrc-user");
  const globalconfig = path.join(work, "npmrc-global");
  fs.writeFileSync(userconfig, "");
  fs.writeFileSync(globalconfig, "");
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: path.join(work, "home"), TMPDIR: path.join(work, "tmp"), LANG: "C" };
  const config = [
    `--userconfig=${userconfig}`,
    `--globalconfig=${globalconfig}`,
    `--cache=${path.join(work, "cache")}`,
    ...(registry ? [`--registry=${registry}`] : []),
    "--no-update-notifier",
    "--no-audit",
    "--no-fund",
    "--loglevel=warn",
  ];
  const run = (args: readonly string[], cwd: string): NpmRun => {
    if (npmPath === null) return { status: null, stdout: "", stderr: "npm is not on PATH" };
    const [cmd, argv] = npmPath.endsWith(".js") ? [process.execPath, [npmPath, ...args]] : [npmPath, [...args]];
    const r = spawnSync(cmd, argv, { cwd, env, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.error ? r.error.message : (r.stderr ?? "") };
  };
  const tmp = path.join(work, "tmp");
  return {
    path: npmPath,
    version: () => {
      const r = run(["--version", ...config], tmp);
      return r.status === 0 ? r.stdout.trim() : null;
    },
    cacheAdd: (files) => {
      for (let i = 0; i < files.length; i += CACHE_ADD_BATCH) {
        const r = run(["cache", "add", ...files.slice(i, i + CACHE_ADD_BATCH), ...config, "--offline", "--ignore-scripts"], tmp);
        if (r.status !== 0) return r;
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    ciOffline: (cwd) => run(["ci", ...config, "--offline", "--ignore-scripts"], cwd),
    rebuildUnconfined: (cwd) => run(["rebuild", ...config, "--offline", "--no-ignore-scripts", "--foreground-scripts"], cwd),
  };
}
