import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The npm subprocess for `gantry npm ci` (issue #355 slice 4, ADR-0062 decision 5), isolated from every
 * configuration the candidate could write:
 *
 * - a fresh, empty user and global npmrc and a fresh cache under the run's temp directory, passed as flags (flags
 *   beat project, user, global and environment configuration);
 * - npm itself is `npm-cli.js` beside the running node, never one from the repository or a `node_modules/.bin`
 *   folder (see `resolveNpm`);
 * - a clean environment: only `PATH` (the running node's folder, then absolute entries outside the repository and
 *   outside any `node_modules/.bin`), a temp `HOME` and `TMPDIR`, and `LANG`. No `npm_config_*`, no `NODE_OPTIONS`
 *   (which would load code into npm itself), no proxy or token variables;
 * - `--prefix` set to the staging directory, so npm never walks up to a parent folder's `package.json` or `.npmrc`;
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
  /** The npm run (its real path: `npm-cli.js` beside node, else from PATH), or null. */
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

const BIN_DIR = /(^|[\\/])node_modules[\\/]\.bin([\\/]|$)/;

/** Inside `root` (both real paths), or `root` itself. */
function inside(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function real(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** A PATH entry npm may come from: absolute, no `node_modules/.bin`, not in the repository (its real path too). */
function trustedDir(dir: string, repo: string | null): boolean {
  if (!path.isAbsolute(dir) || BIN_DIR.test(dir)) return false;
  const r = real(dir) ?? dir;
  return !BIN_DIR.test(r) && (repo === null || (!inside(path.resolve(dir), repo) && !inside(r, repo)));
}


/**
 * The npm to run, by real path, or null. First `npm-cli.js` beside the running node (`<prefix>/lib/node_modules/npm`,
 * or `<dir>/node_modules/npm` on Windows), run with that node. Only when there is none, the first executable `npm` on
 * PATH, skipping every `node_modules/.bin` folder (under `npm run` or `npx` the project's own bins come first, and an
 * earlier, unadmitted install may have put an `npm` there) and every folder in the repository. An npm whose real path
 * is in the repository or a `node_modules/.bin` folder is refused. `repo` is the repository's real top folder.
 */
export function resolveNpm(o: { execPath?: string; pathEnv?: string; repo?: string | null } = {}): string | null {
  const execPath = o.execPath ?? process.execPath;
  const repo = o.repo ?? null;
  const ok = (p: string | null): p is string => p !== null && !BIN_DIR.test(p) && (repo === null || !inside(p, repo));
  const nodeDir = path.dirname(execPath);
  for (const cli of [path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")]) {
    const r = real(cli);
    if (ok(r) && fs.statSync(r).isFile()) return r;
  }
  for (const dir of (o.pathEnv ?? process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !trustedDir(dir, repo)) continue;
    const candidate = path.join(dir, "npm");
    try {
      const st = fs.statSync(candidate);
      if (!st.isFile() || (st.mode & 0o111) === 0) continue;
    } catch {
      continue;
    }
    const r = real(candidate);
    if (ok(r)) return r;
  }
  return null;
}

/** PATH for npm: the running node's folder first, then only trusted absolute entries. */
function cleanPath(pathEnv: string, repo: string | null, execPath: string = process.execPath): string {
  const dirs = [path.dirname(execPath), ...pathEnv.split(path.delimiter).filter((d) => d && trustedDir(d, repo))];
  return [...new Set(dirs)].join(path.delimiter);
}

/**
 * An npm runner whose configuration, cache and environment live under `work` (created, empty). `repo` is the
 * repository's top folder: no npm and no PATH entry inside it is used.
 */
export function isolatedNpm(work: string, registry?: string, repo?: string): IsolatedNpm {
  const repoReal = repo ? (real(repo) ?? path.resolve(repo)) : null;
  const npmPath = resolveNpm({ repo: repoReal });
  for (const d of ["home", "cache", "tmp"]) fs.mkdirSync(path.join(work, d), { recursive: true });
  const userconfig = path.join(work, "npmrc-user");
  const globalconfig = path.join(work, "npmrc-global");
  fs.writeFileSync(userconfig, "");
  fs.writeFileSync(globalconfig, "");
  const env: NodeJS.ProcessEnv = { PATH: cleanPath(process.env.PATH ?? "", repoReal), HOME: path.join(work, "home"), TMPDIR: path.join(work, "tmp"), LANG: "C" };
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
    if (npmPath === null) return { status: null, stdout: "", stderr: "no npm beside node or on PATH outside the repository" };
    // --prefix on every command: npm never walks up from cwd to a parent package.json or .npmrc.
    const all = [...args, `--prefix=${cwd}`];
    const [cmd, argv] = npmPath.endsWith(".js") ? [process.execPath, [npmPath, ...all]] : [npmPath, all];
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
