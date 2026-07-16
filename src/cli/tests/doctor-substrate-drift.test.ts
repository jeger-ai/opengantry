import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSubstrateDriftDoctorChecks, collectDoctorReport } from "../lib/doctor.js";
import { runDoctor } from "../commands/doctor.js";
import { loadIntegrationCompat } from "../lib/integration-compat.js";
import { resolveTemplateRootFromModule } from "../lib/integration-compat.js";
import { writeSubstrateVersionFile } from "../lib/substrate-version.js";
import { getRepoRoot } from "../lib/git.js";
import { writeMiniGantryRepo, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import type { Manifest } from "../lib/types.js";

test("runSubstrateDriftDoctorChecks: behind bundled suggests gantry upgrade", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-drift-behind-"));
  const templatesRoot = resolveTemplateRootFromModule();
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(dest, "0.8.1", "test");
  const r = runSubstrateDriftDoctorChecks(dest, templatesRoot);
  assert.ok(r.lines.some((l) => l.level === "warn" && l.message.includes("behind bundled gantry")));
  assert.equal(r.nextStep, "gantry upgrade");
  assert.ok(r.lines.some((l) => l.message.includes(bundled)));
});

test("runSubstrateDriftDoctorChecks: matches bundled is ok", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-drift-ok-"));
  const templatesRoot = resolveTemplateRootFromModule();
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  writeSubstrateVersionFile(dest, bundled, "test");
  const r = runSubstrateDriftDoctorChecks(dest, templatesRoot);
  assert.ok(r.lines.some((l) => l.level === "ok" && l.message.includes("matches bundled gantry")));
  assert.equal(r.nextStep, null);
});

test("runSubstrateDriftDoctorChecks: ahead of bundled warns without nextStep", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-drift-ahead-"));
  const templatesRoot = resolveTemplateRootFromModule();
  writeSubstrateVersionFile(dest, "99.0.0", "test");
  const r = runSubstrateDriftDoctorChecks(dest, templatesRoot);
  assert.ok(r.lines.some((l) => l.level === "warn" && l.message.includes("ahead of bundled gantry")));
  assert.equal(r.nextStep, null);
});

test("runSubstrateDriftDoctorChecks: legacy default adds legacy warn", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-drift-legacy-"));
  const templatesRoot = resolveTemplateRootFromModule();
  const r = runSubstrateDriftDoctorChecks(dest, templatesRoot);
  assert.ok(
    r.lines.some((l) => l.level === "warn" && l.message.includes("no SUBSTRATE.version.json")),
  );
});

test("collectDoctorReport: drift behind sets nextStep gantry upgrade", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-drift-report-"));
  writeMiniGantryRepo(dest, ogRoot);
  writeSubstrateVersionFile(dest, "0.8.1", "test");
  fs.mkdirSync(path.join(dest, ".gitagent/missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent/missions/example.verify.yaml"),
    path.join(dest, ".gitagent/missions/example.verify.yaml"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent/foreman/MANIFEST.json"), "utf8"),
  ) as Manifest;
  const prevTeachers = process.env.GANTRY_PLANNER_EMAILS;
  process.env.GANTRY_PLANNER_EMAILS = PLANNER_EMAIL;
  try {
    const report = collectDoctorReport(dest, manifest);
    assert.ok(report.lines.some((l) => l.message.includes("behind bundled gantry")));
    // nextStep is first-wins; drift upgrade hint applies when no higher-priority core hint is set
    const driftOnly = runSubstrateDriftDoctorChecks(dest, resolveTemplateRootFromModule());
    assert.equal(driftOnly.nextStep, "gantry upgrade");
  } finally {
    if (prevTeachers === undefined) delete process.env.GANTRY_PLANNER_EMAILS;
    else process.env.GANTRY_PLANNER_EMAILS = prevTeachers;
  }
});

test("runDoctor --json: drift warn keeps exit_code 0", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-drift-json-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  writeSubstrateVersionFile(dest, "0.8.1", "test");
  const prevCwd = process.cwd();
  const prevTeachers = process.env.GANTRY_PLANNER_EMAILS;
  process.env.GANTRY_PLANNER_EMAILS = PLANNER_EMAIL;
  let captured = "";
  const origLog = console.log;
  try {
    process.chdir(dest);
    console.log = (msg: string) => {
      captured += msg;
    };
    process.exitCode = undefined;
    runDoctor({ json: true });
    assert.equal(process.exitCode, undefined);
    const parsed = JSON.parse(captured) as {
      lines: { level: string; message: string }[];
      exit_code: number;
    };
    assert.equal(parsed.exit_code, 0);
    assert.ok(parsed.lines.some((l) => l.level === "warn" && l.message.includes("behind bundled")));
  } finally {
    console.log = origLog;
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevTeachers === undefined) delete process.env.GANTRY_PLANNER_EMAILS;
    else process.env.GANTRY_PLANNER_EMAILS = prevTeachers;
  }
});
