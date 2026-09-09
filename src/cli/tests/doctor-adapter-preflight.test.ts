import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findEslintConfig,
  hasEslintJsonFormat,
  resolveNpmScript,
  type CommandRunner,
} from "../lib/adapter-preflight-checks.js";
import { runAdapterPreflightDoctorChecks } from "../lib/doctor-adapter-preflight.js";
import { collectDoctorReport } from "../lib/doctor-core.js";
import { getRepoRoot } from "../lib/git.js";
import { buildProgram } from "../program.js";
import type { Manifest } from "../lib/types.js";
import { gitInitCommit, writeMiniGantryRepo } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

function miniRepo(): { dest: string; ogRoot: string } {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-adapter-preflight-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  return { dest, ogRoot };
}

function writeAdapterMission(dest: string, adapter: "tsc" | "eslint", gateCommand: string): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "adapter.yaml"),
    `msn_id: MSN-0800
skill_key: ui
gate_command: ${JSON.stringify(gateCommand)}
gate_adapter: ${adapter}
trace_rows:
  - dod_id: "1"
    trace_quote: "adapter-preflight"
    anchor: "1"
    status: PASS
`,
    "utf8",
  );
}

function linkPackage(dest: string, ogRoot: string, name: string): void {
  const nm = path.join(dest, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  fs.symlinkSync(path.join(ogRoot, "node_modules", name), path.join(nm, name), "dir");
}

function writeJson(dest: string, rel: string, value: unknown): void {
  fs.writeFileSync(path.join(dest, rel), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadMiniManifest(dest: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8")) as Manifest;
}

function hasLine(
  lines: { level: string; message: string }[],
  level: string,
  snippet: string,
): boolean {
  return lines.some((l) => l.level === level && l.message.includes(snippet));
}

test("resolveNpmScript and hasEslintJsonFormat", () => {
  const scripts = { "lint:json": "eslint --format json src", lint: "eslint src" };
  assert.deepEqual(resolveNpmScript("npm run lint:json", scripts), {
    kind: "script",
    name: "lint:json",
    body: "eslint --format json src",
  });
  assert.deepEqual(resolveNpmScript("npm run lint -- --format json", scripts), {
    kind: "script",
    name: "lint",
    body: "eslint src --format json",
  });
  assert.deepEqual(resolveNpmScript("npm run missing", scripts), {
    kind: "missing",
    name: "missing",
  });
  assert.deepEqual(resolveNpmScript("npx eslint --format json", scripts), {
    kind: "direct",
    command: "npx eslint --format json",
  });
  assert.equal(hasEslintJsonFormat("eslint --format json src"), true);
  assert.equal(hasEslintJsonFormat("eslint --format=json src"), true);
  assert.equal(hasEslintJsonFormat("eslint -f json src"), true);
  assert.equal(hasEslintJsonFormat("eslint src"), false);
});

test("findEslintConfig: flat, legacy, missing", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-eslint-config-"));
  assert.equal(findEslintConfig(dest), "missing");
  fs.writeFileSync(path.join(dest, ".eslintrc.json"), "{}\n", "utf8");
  assert.equal(findEslintConfig(dest), "legacy");
  fs.writeFileSync(path.join(dest, "eslint.config.js"), "export default [];\n", "utf8");
  assert.equal(findEslintConfig(dest), "flat");
});

test("adapter preflight skipped when only generic missions", () => {
  const { dest } = miniRepo();
  const report = collectDoctorReport(dest, loadMiniManifest(dest));
  assert.equal(hasLine(report.lines, "ok", "no tsc/eslint missions declared (skipped)"), true);
  assert.equal(report.lines.some((l) => l.level === "fail" && l.message.includes("typescript")), false);
});

test("tsc mission without typescript fails", () => {
  const { dest } = miniRepo();
  writeAdapterMission(dest, "tsc", "npx tsc --noEmit --pretty false");
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "fail", "typescript package not resolvable"), true);
  assert.equal(r.nextStep, "npm install --save-dev typescript");
});

test("tsc mission malformed tsconfig fails parse", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "tsc", "npx tsc --noEmit --pretty false");
  linkPackage(dest, ogRoot, "typescript");
  fs.writeFileSync(path.join(dest, "tsconfig.json"), "{ not json", "utf8");
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "fail", "tsconfig.json"), true);
});

test("tsc mission valid tsconfig is ok", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "tsc", "npx tsc --noEmit --pretty false");
  linkPackage(dest, ogRoot, "typescript");
  writeJson(dest, "tsconfig.json", { compilerOptions: { strict: true }, include: [] });
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "ok", "typescript"), true);
  assert.equal(hasLine(r.lines, "ok", "tsconfig.json parseable"), true);
  assert.equal(r.lines.some((l) => l.level === "fail"), false);
});

test("eslint mission missing lint:json script fails", () => {
  const { dest } = miniRepo();
  writeAdapterMission(dest, "eslint", "npm run lint:json");
  writeJson(dest, "package.json", { scripts: {} });
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "fail", "npm script lint:json is not defined"), true);
});

test("eslint mission script without --format json fails", () => {
  const { dest } = miniRepo();
  writeAdapterMission(dest, "eslint", "npm run lint:json");
  writeJson(dest, "package.json", { scripts: { "lint:json": "eslint src" } });
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "fail", "must run eslint --format json"), true);
});

test("eslint npm run lint -- --format json concatenates onto script body", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "eslint", "npm run lint -- --format json");
  linkPackage(dest, ogRoot, "eslint");
  writeJson(dest, "package.json", { scripts: { lint: "eslint src", "lint:json": "eslint --format json src" } });
  fs.writeFileSync(path.join(dest, "eslint.config.js"), "export default [];\n", "utf8");
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(r.lines.some((l) => l.level === "fail" && l.message.includes("must run eslint --format json")), false);
  assert.equal(r.lines.some((l) => l.level === "fail"), false);
});

test("eslint npx gate_command fails when npx is missing", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "eslint", "npx eslint --format json src");
  linkPackage(dest, ogRoot, "eslint");
  writeJson(dest, "package.json", { scripts: { "lint:json": "eslint --format json src" } });
  fs.writeFileSync(path.join(dest, "eslint.config.js"), "export default [];\n", "utf8");
  const runCommand: CommandRunner = (spec) => {
    if (spec.command === "npx" && spec.args?.[0] === "--version") {
      return { status: 1, stdout: "", stderr: "npx: not found" };
    }
    return { status: 0, stdout: "10.0.0\n", stderr: "" };
  };
  const r = runAdapterPreflightDoctorChecks(dest, { runCommand });
  assert.equal(hasLine(r.lines, "fail", "npx not available on PATH"), true);
});

test("eslint mission with lint:json and flat config is ok", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "eslint", "npm run lint:json");
  linkPackage(dest, ogRoot, "eslint");
  writeJson(dest, "package.json", { scripts: { "lint:json": "eslint --format json src/**/*.ts" } });
  fs.writeFileSync(path.join(dest, "eslint.config.js"), "export default [];\n", "utf8");
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "ok", "eslint"), true);
  assert.equal(hasLine(r.lines, "ok", "eslint flat config present"), true);
  assert.equal(hasLine(r.lines, "ok", "lint:json maps to eslint --format json"), true);
  assert.equal(r.lines.some((l) => l.level === "fail"), false);
});

test("eslint legacy eslintrc warns", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "eslint", "npx eslint --format json src");
  linkPackage(dest, ogRoot, "eslint");
  writeJson(dest, "package.json", { scripts: { "lint:json": "eslint --format json src" } });
  writeJson(dest, ".eslintrc.json", {});
  const r = runAdapterPreflightDoctorChecks(dest);
  assert.equal(hasLine(r.lines, "warn", "legacy .eslintrc"), true);
});

test("--gate-adapter tsc forces checks with no typed missions", () => {
  const { dest } = miniRepo();
  const r = runAdapterPreflightDoctorChecks(dest, { forceAdapter: "tsc" });
  assert.equal(hasLine(r.lines, "fail", "typescript package not resolvable"), true);
});

test("Commander --gate-adapter .choices() rejects unknown ids", () => {
  const program = buildProgram();
  process.exitCode = undefined;
  assert.throws(
    () => program.parse(["doctor", "--gate-adapter", "nope"], { from: "user" }),
    (err: unknown) => err instanceof Error && /Allowed choices are tsc, eslint/.test(err.message),
  );
  assert.equal(process.exitCode, 2);
  process.exitCode = undefined;
});

test("baseline tsc warns with injected runner and keeps no fail", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "tsc", "npx tsc --noEmit --pretty false");
  linkPackage(dest, ogRoot, "typescript");
  writeJson(dest, "tsconfig.json", { compilerOptions: { strict: true }, include: [] });
  const runCommand: CommandRunner = (spec) => {
    if (spec.args?.[0] === "--version") return { status: 0, stdout: "10.0.0\n", stderr: "" };
    if (spec.args?.[0] === "tsc") {
      return {
        status: 1,
        stdout: "src/foo.ts(1,2): error TS2322: Type 'string' is not assignable.\n",
        stderr: "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = runAdapterPreflightDoctorChecks(dest, { baseline: true, runCommand });
  assert.equal(hasLine(r.lines, "warn", "baseline tsc: 1 pre-existing diagnostics"), true);
  assert.equal(r.lines.some((l) => l.level === "fail"), false);
});

test("baseline eslint skips non-npm/npx/node gate_command without shell", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "eslint", "eslint --format json src");
  linkPackage(dest, ogRoot, "eslint");
  writeJson(dest, "package.json", { scripts: { "lint:json": "eslint --format json src" } });
  fs.writeFileSync(path.join(dest, "eslint.config.js"), "export default [];\n", "utf8");
  const r = runAdapterPreflightDoctorChecks(dest, { baseline: true });
  assert.equal(hasLine(r.lines, "warn", "baseline eslint skipped"), true);
  assert.equal(r.lines.some((l) => l.level === "fail"), false);
});

test("baseline eslint warns from canned json and stays warn-only", () => {
  const { dest, ogRoot } = miniRepo();
  writeAdapterMission(dest, "eslint", "npm run lint:json");
  linkPackage(dest, ogRoot, "eslint");
  writeJson(dest, "package.json", { scripts: { "lint:json": "eslint --format json src" } });
  fs.writeFileSync(path.join(dest, "eslint.config.js"), "export default [];\n", "utf8");
  const runCommand: CommandRunner = (spec) => {
    if (spec.command === "npm" && spec.args?.[0] === "run") {
      return {
        status: 1,
        stdout: JSON.stringify([
          {
            filePath: "src/bar.ts",
            messages: [{ ruleId: "no-undef", severity: 2, message: "x", line: 3, column: 1 }],
          },
        ]),
        stderr: "",
      };
    }
    return { status: 0, stdout: "10.0.0\n", stderr: "" };
  };
  const r = runAdapterPreflightDoctorChecks(dest, { baseline: true, runCommand });
  assert.equal(hasLine(r.lines, "warn", "baseline eslint: 1 pre-existing errors"), true);
  assert.equal(r.lines.some((l) => l.level === "fail"), false);
});
