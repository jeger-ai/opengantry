/**
 * CLI-level tests for `gantry arch check` (the lib is covered by
 * target-architecture.test.ts; this pins the command path).
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { runArchCheckCommand } from "../commands/arch.js";
import { writeMiniGantryRepo, gitInitCommit } from "./test-fixtures.js";
import { captureConsole, PLANNER_EMAIL } from "./test-shared.js";

function inRepo<T>(dest: string, fn: () => T): T {
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    return fn();
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
}

const ARCH_SPEC_YAML = `schema_version: "0.2.0"
scan_roots:
  - src/**
languages:
  - typescript
layers:
  - id: lib
    globs:
      - src/lib/**
rules:
  - id: RULE-LIB-COMMANDER
    from_layer: lib
    forbid_specifier_substring: commander
`;

function makeArchRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-check-cli-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  fs.writeFileSync(path.join(dest, "TARGET_ARCHITECTURE.yaml"), ARCH_SPEC_YAML, "utf8");
  fs.mkdirSync(path.join(dest, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "lib", "clean.ts"), "export const x = 1;\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  return dest;
}

test("arch check command: clean file reports OK with exit 0", () => {
  const dest = makeArchRepo();
  inRepo(dest, () => {
    const { output } = captureConsole(() => {
      runArchCheckCommand({ cwd: dest, files: ["src/lib/clean.ts"] });
    });
    assert.match(output.stdout, /arch check: OK/);
    assert.equal(process.exitCode, undefined);
  });
});

test("arch check command: rule violation prints location and exits 1", () => {
  const dest = makeArchRepo();
  fs.writeFileSync(
    path.join(dest, "src", "lib", "bad.ts"),
    `import { Command } from "commander";\nexport const x = Command;\n`,
    "utf8",
  );
  inRepo(dest, () => {
    const { output } = captureConsole(() => {
      runArchCheckCommand({ cwd: dest, files: ["src/lib/bad.ts"] });
    });
    assert.match(output.stdout, /1 violation\(s\)/);
    assert.match(output.stdout, /RULE-LIB-COMMANDER/);
    assert.equal(process.exitCode, 1);
  });
});

test("arch check command: --json emits schema_version payload", () => {
  const dest = makeArchRepo();
  inRepo(dest, () => {
    const { output } = captureConsole(() => {
      runArchCheckCommand({ cwd: dest, files: ["src/lib/clean.ts"], json: true });
    });
    const payload = JSON.parse(output.stdout) as Record<string, unknown>;
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.violations, []);
  });
});

test("arch check command: auto-walks scan_roots when no file args", () => {
  const dest = makeArchRepo();
  inRepo(dest, () => {
    const { output } = captureConsole(() => {
      runArchCheckCommand({ cwd: dest, files: [] });
    });
    assert.match(output.stdout, /arch check: OK/);
    assert.equal(process.exitCode, undefined);
  });
});

test("arch check command: outside a git repo exits 2", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-check-norepo-"));
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    process.exitCode = undefined;
    const { output } = captureConsole(() => {
      runArchCheckCommand({ cwd: dest, files: ["src/lib/clean.ts"] });
    });
    assert.ok(output.stderr.length > 0);
    assert.equal(process.exitCode, 2);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
  }
});
