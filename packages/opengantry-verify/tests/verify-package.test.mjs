// MSN-0342: the slim @jeger-ai/opengantry-verify package — shape, bin, library API and type declarations.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// These tests run git in temp repos; an inherited GIT_DIR (git sets it for hooks in a linked worktree) would point
// that git at the real repository.
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) {
  delete process.env[key];
}

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const BIN = path.join(pkgDir, "dist", "cli.js");

/** The library API, in the order src/cli/verify-lib.ts exports it (runtime values only). */
const API = [
  "COMMITLY_GATE_SCHEMA",
  "DEFAULT_VERIFY_BASELINE",
  "DEFAULT_VERIFY_CONTRACT",
  "GITHUB_ACTIONS_ISSUER",
  "GantryUserError",
  "VERIFY_BASELINE_SCHEMA",
  "VERIFY_CONTRACT_SCHEMA",
  "VERIFY_RESULT_SCHEMA",
  "adaptPlan",
  "checkKeylessSignature",
  "checkVerifyResult",
  "parseVerifyContract",
  "runVerifyContract",
  "signVerifyResultKeyless",
  "verifyResultJUnit",
  "verifyResultSarif",
  "writeVerifyBaseline",
];

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
}

/** A repo whose verify.yaml allows app/ only, with one commit on top of the base. */
function repo(work) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-pkg-")));
  git(dir, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "app", "a.py"), "a\n");
  fs.writeFileSync(path.join(dir, "verify.yaml"), "schema: opengantry.verify.v1\nscope: { allowed_paths: [app] }\nchecks: [{ name: ok, run: 'true', expect: exit0 }]\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD");
  for (const [rel, body] of Object.entries(work)) fs.writeFileSync(path.join(dir, rel), body);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "work");
  return { dir, base };
}

test("package.json: the gantry-verify bin, the library export with types, commander and sigstore as dependencies, no install scripts", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const root = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.name, "@jeger-ai/opengantry-verify");
  assert.equal(pkg.version, root.version, "released at the version of @jeger-ai/opengantry");
  assert.deepEqual(pkg.bin, { "gantry-verify": "dist/cli.js" });
  assert.deepEqual(pkg.exports, { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } });
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["commander", "sigstore"]);
  assert.equal(pkg.dependencies.sigstore, root.dependencies.sigstore);
  assert.equal(pkg.dependencies.commander, root.dependencies.commander);
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) assert.equal(pkg.scripts[hook], undefined, `no ${hook} script`);
  assert.equal(pkg.engines.node, ">=24");
});

test("bundle: only commander, sigstore (lazily) and Node built-ins are imported at runtime", () => {
  const bare = new Map();
  const files = fs.readdirSync(path.join(pkgDir, "dist"), { recursive: true }).filter((f) => f.endsWith(".js"));
  for (const rel of files) {
    const text = fs.readFileSync(path.join(pkgDir, "dist", rel), "utf8");
    // esbuild emits minified ESM: `import{Command as X}from"commander";` and `import("sigstore")`.
    for (const m of text.matchAll(/(?:^|[;\n])\s*import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g)) {
      if (!m[1].startsWith("node:") && !m[1].startsWith(".")) bare.set(m[1], "static");
    }
    for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!m[1].startsWith("node:") && !m[1].startsWith(".")) bare.set(m[1], bare.get(m[1]) ?? "dynamic");
    }
  }
  assert.deepEqual(Object.fromEntries([...bare].sort()), { commander: "static", sigstore: "dynamic" });
  assert.ok(!files.some((f) => fs.readFileSync(path.join(pkgDir, "dist", f), "utf8").includes('from"#')), "no #core/#git/#verify specifier survives bundling");
});

test("npm pack ships dist and README; dist holds the bin, the library, its chunks and declarations only", () => {
  const dry = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json"], { cwd: pkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
  const files = dry.files.map((f) => f.path);
  for (const required of ["README.md", "package.json", "dist/cli.js", "dist/index.js", "dist/index.d.ts", "dist/types/verify/run.d.ts"]) {
    assert.ok(files.includes(required), `${required} is published`);
  }
  const strays = files.filter((f) => !/^(README\.md|package\.json|dist\/(cli\.js|index\.js|index\.d\.ts|chunks\/[\w-]+\.js|types\/(core|git|verify)\/[\w/-]+\.d\.ts))$/.test(f));
  assert.deepEqual(strays, []);
  assert.ok(dry.size < 512 * 1024, `packed size ${String(dry.size)} bytes stays under 512 KiB`);
});

test("gantry-verify: the contract as its argument; exit 0 pass, 1 fail, SARIF on stdout (MSN-0342)", () => {
  const ok = repo({ "app/a.py": "b\n" });
  const pass = spawnSync(process.execPath, [BIN, "--base", ok.base], { cwd: ok.dir, encoding: "utf8" });
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stderr, /^verify: PASS$/m);

  const bad = repo({ "README.md": "x\n" });
  const fail = spawnSync(process.execPath, [BIN, "verify.yaml", "--base", bad.base, "--format", "sarif"], { cwd: bad.dir, encoding: "utf8" });
  assert.equal(fail.status, 1, fail.stderr);
  assert.deepEqual(JSON.parse(fail.stdout).runs[0].results.map((r) => r.ruleId), ["verify/outside-allowed-paths"]);

  const version = spawnSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
  assert.equal(version.stdout.trim(), JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version);
  const usage = spawnSync(process.execPath, [BIN, "--base", ok.base, "--sign"], { cwd: ok.dir, encoding: "utf8" });
  assert.equal(usage.status, 2, "usage errors exit 2");
});

test("library: the documented API, and runVerifyContract judges a change in process (MSN-0342)", async () => {
  const lib = await import(pathToFileURL(path.join(pkgDir, "dist", "index.js")).href);
  assert.deepEqual(Object.keys(lib).sort(), API);
  const { dir, base } = repo({ "app/a.py": "b\n" });
  const result = lib.runVerifyContract({ cwd: dir, base });
  assert.equal(result.schema, lib.VERIFY_RESULT_SCHEMA);
  assert.equal(result.status, "pass");
  assert.match(lib.verifyResultJUnit(result), /<testsuite name="gantry-verify-contract"/);
  assert.throws(() => lib.runVerifyContract({ cwd: dir, base: "no-such-ref" }), (e) => e instanceof lib.GantryUserError && e.code === "GXT_VERIFY_BASE_INVALID");
});

test("types: a consumer type-checks against dist/index.d.ts through the package exports (MSN-0342)", () => {
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-types-"));
  const scope = path.join(consumer, "node_modules", "@jeger-ai");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(pkgDir, path.join(scope, "opengantry-verify"), "dir");
  fs.symlinkSync(path.join(repoRoot, "node_modules", "sigstore"), path.join(consumer, "node_modules", "sigstore"), "dir");
  fs.symlinkSync(path.join(repoRoot, "node_modules", "@types"), path.join(consumer, "node_modules", "@types"), "dir");
  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "nodenext", moduleResolution: "nodenext", target: "es2023", strict: true, noEmit: true, skipLibCheck: false, types: ["node"] }, files: ["use.ts"] }),
  );
  fs.writeFileSync(
    path.join(consumer, "use.ts"),
    [
      'import { runVerifyContract, verifyResultSarif, type VerifyContractResult, type KeylessSignature } from "@jeger-ai/opengantry-verify";',
      'const result: VerifyContractResult = runVerifyContract({ cwd: ".", base: "HEAD~1", mode: "quick" });',
      'const status: "pass" | "fail" = result.status;',
      "const sig = result.signature as KeylessSignature | undefined;",
      'export const out = [status, sig?.kind, verifyResultSarif(result, "1").version];',
      "",
    ].join("\n"),
  );
  const tsc = spawnSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", consumer], { encoding: "utf8" });
  assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
});
