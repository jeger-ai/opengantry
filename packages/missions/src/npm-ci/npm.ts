import { inspectNpmTarball, nodeTarProblem, type TarballInspection } from "#core/dependency-tarball.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/** npm runs with a fresh home, cache and configuration. The selected toolchain must be outside the candidate repository. */
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
  tarVersion(): string | null;
  inspectTarball(bytes: Buffer): TarballInspection;
  /** The running node's real path is inside the repository: nothing is run. */
  readonly nodeInRepository: boolean;
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
  // "..tools" is a folder inside root; only "..", "../…" and an absolute result (another drive) leave it.
  return !(rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
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
  // A node inside the repository would put a repository folder first on npm's PATH, and run npm-cli.js itself.
  if (repo !== null && inside(real(execPath) ?? path.resolve(execPath), repo)) return null;
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

/** The `tar` npm's pacote resolves, by its `package.json`, for an npm at `<root>/bin/npm-cli.js`. */
function bundledTar(npmPath: string | null) {
  if (npmPath === null || !/[\\/]bin[\\/]npm-cli\.js$/.test(npmPath)) return null;
  try {
    const root = path.dirname(path.dirname(npmPath));
    const pacote = createRequire(path.join(root, "node_modules", "pacote", "package.json"));
    const manifest = fs.realpathSync(pacote.resolve("tar/package.json"));
    if (!inside(manifest, root)) return null;
    const { version } = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (typeof version !== "string") return null;
    return { version, list() {
      const entry = fs.realpathSync(pacote.resolve("tar"));
      if (!inside(entry, path.dirname(manifest))) throw new Error("npm tar entry outside its package");
      return pacote(entry).list as NonNullable<Parameters<typeof inspectNpmTarball>[2]>;
    } };
  } catch {
    return null;
  }
}

/** A time limit that only tightens (MSN-0393): a positive integer below `def`, else `def`. 0, NaN or a fraction never disables or lengthens a timeout. */
export function tightenLimit(def: number, limit: number | undefined): number {
  return limit !== undefined && Number.isInteger(limit) && limit > 0 ? Math.max(1, Math.min(def, limit)) : def;
}

/**
 * An npm runner whose configuration, cache and environment live under `work` (created, empty). `repo` is the
 * repository's top folder: no npm and no PATH entry inside it is used.
 */
export function isolatedNpm(work: string, registry?: string, repo?: string, execPath: string = process.execPath, timeoutLimitMs?: number): IsolatedNpm {
  const timeoutMs = tightenLimit(TIMEOUT_MS, timeoutLimitMs);
  const repoReal = repo ? (real(repo) ?? path.resolve(repo)) : null;
  const nodeInRepository = repoReal !== null && inside(real(execPath) ?? path.resolve(execPath), repoReal);
  const npmPath = nodeInRepository ? null : resolveNpm({ execPath, repo: repoReal });
  for (const d of ["home", "cache", "tmp"]) fs.mkdirSync(path.join(work, d), { recursive: true });
  const userconfig = path.join(work, "npmrc-user");
  const globalconfig = path.join(work, "npmrc-global");
  fs.writeFileSync(userconfig, "");
  fs.writeFileSync(globalconfig, "");
  const env: NodeJS.ProcessEnv = { PATH: cleanPath(process.env.PATH ?? "", repoReal, execPath), HOME: path.join(work, "home"), TMPDIR: path.join(work, "tmp"), LANG: "C" };
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
    const [cmd, argv] = npmPath.endsWith(".js") ? [execPath, ["--single-threaded", npmPath, ...all]] : [npmPath, all]; // npm can deadlock in V8 worker teardown after it finished (MSN-0393)
    const r = spawnSync(cmd, argv, { cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ? `npm ${args[0] ?? ""} did not exit within ${String(timeoutMs)} ms and was killed` : (r.error?.message ?? r.stderr ?? "") };
  };
  const tmp = path.join(work, "tmp");
  return {
    path: npmPath,
    nodeInRepository,
    tarVersion: () => bundledTar(npmPath)?.version ?? null,
    inspectTarball(bytes) {
      const tar = bundledTar(npmPath);
      const problem = nodeTarProblem(tar?.version ?? null);
      if (!tar || problem) return { ok: false, detail: problem ?? "missing npm tar" };
      try {
        const list = tar.list();
        if (typeof list !== "function") return { ok: false, detail: "npm tar list unavailable" };
        return inspectNpmTarball(bytes, undefined, list);
      } catch {
        return { ok: false, detail: "cannot load npm tar list" };
      }
    },
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
