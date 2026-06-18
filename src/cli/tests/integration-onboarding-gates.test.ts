import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import {
  classifyIntegrationProfileState,
  integrationOnboardingBlockers,
  runIntegrationDoctorChecks,
} from "../lib/doctor-integration.js";
import { loadIntegrationCompat } from "../lib/integration-compat.js";
import { writeIntegrationFixtureState } from "./test-fixtures.js";

const templatesRoot = path.join(getRepoRoot(), "templates");

test("integration compat: bootstrap_mode present for all IDE keys", () => {
  const compat = loadIntegrationCompat(templatesRoot);
  assert.equal(compat.integrations.cursor.bootstrap_mode, "hook");
  assert.equal(compat.integrations["claude-code"].bootstrap_mode, "shell_wrapper");
  assert.equal(compat.integrations["codex-cli"].bootstrap_mode, "shell_wrapper");
  assert.equal(compat.integrations.opencode.bootstrap_mode, "shell_wrapper");
});

test("classifyIntegrationProfileState: uninitialized vs configured", () => {
  const uninitialized = fs.mkdtempSync(path.join(os.tmpdir(), "og-int-uninit-"));
  const configured = fs.mkdtempSync(path.join(os.tmpdir(), "og-int-config-"));
  writeIntegrationFixtureState(uninitialized, "uninitialized");
  writeIntegrationFixtureState(configured, "healthy");

  assert.equal(classifyIntegrationProfileState(uninitialized, templatesRoot), "uninitialized");
  assert.equal(classifyIntegrationProfileState(configured, templatesRoot), "configured");
});

test("integrationOnboardingBlockers: uninitialized allows bootstrap pass", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-onboard-uninit-"));
  writeIntegrationFixtureState(dest, "uninitialized");
  const gate = integrationOnboardingBlockers(dest, templatesRoot);
  assert.equal(gate.state, "uninitialized");
  assert.equal(gate.blockers.length, 0);
  assert.ok(gate.notices.some((n) => n.includes("no agent integration files detected")));
});

test("integrationOnboardingBlockers: corrupt configured state blocks", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-onboard-corrupt-"));
  writeIntegrationFixtureState(dest, "corrupt");
  const gate = integrationOnboardingBlockers(dest, templatesRoot);
  assert.equal(gate.state, "configured");
  assert.ok(gate.blockers.some((b) => b.includes("hooks.json version")));
});

test("runIntegrationDoctorChecks: healthy cursor wiring", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-int-healthy-"));
  writeIntegrationFixtureState(dest, "healthy");
  const lines = runIntegrationDoctorChecks(dest, templatesRoot);
  const wiring = lines.find((l) => l.message.startsWith("detected agent wiring:"));
  assert.ok(wiring);
  assert.match(wiring!.message, /\bcursor\b/);
  assert.ok(!lines.some((l) => l.message.includes("hooks.json version 99")));
});
