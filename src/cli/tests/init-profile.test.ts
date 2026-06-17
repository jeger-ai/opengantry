import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  validateIntegrationCompat,
} from "../lib/integration-compat.js";
import {
  legacyDefaultInitTargetPaths,
  resolveAssetsFromProfile,
} from "../lib/init-asset-catalog.js";
import { composeIntegrationsDoc, recipeFilesExist } from "../lib/init-compose.js";
import { defaultInitProfile, shouldRunInteractiveWizard, type InitProfile } from "../lib/init-profile.js";
import { canPromptInitOverwrite } from "../lib/init-interactive.js";
import type { IntegrationIdeKey } from "../lib/integration-compat.js";

test("integration compat: all IDE keys have manifest entries and recipes", () => {
  const root = getRepoRoot();
  const templatesRoot = path.join(root, "templates");
  const compat = loadIntegrationCompat(templatesRoot);
  validateIntegrationCompat(compat);
  recipeFilesExist(templatesRoot, compat);
  for (const key of INTEGRATION_IDE_KEYS) {
    assert.ok(compat.integrations[key], key);
  }
});

test("resolveAssetsFromProfile: default catalog covers all core managed paths", () => {
  const fromCatalog = legacyDefaultInitTargetPaths().sort();
  assert.ok(fromCatalog.includes("scripts/validate-gxt.sh"));
  assert.ok(fromCatalog.includes("scripts/gxt-manifest-lib.mjs"));
  assert.ok(fromCatalog.includes("scripts/verify-pr-missions.sh"));
  assert.ok(fromCatalog.includes(".githooks/pre-commit"));
  assert.ok(fromCatalog.includes(".cursor/mcp.json"));
  assert.ok(fromCatalog.length >= 20);
});

test("resolveAssetsFromProfile: claude-code only skips cursor assets", () => {
  const profile: InitProfile = {
    ...defaultInitProfile(),
    ides: ["claude-code"],
  };
  const templatesRoot = path.join(getRepoRoot(), "templates");
  const assets = resolveAssetsFromProfile(profile, loadIntegrationCompat(templatesRoot), templatesRoot);
  const targets = assets.map((a) => a.targetPath);
  assert.ok(targets.includes("CLAUDE.md"));
  assert.ok(!targets.some((t) => t.startsWith(".cursor/")));
});

test("composeIntegrationsDoc: includes selected IDE recipes and docs", () => {
  const root = getRepoRoot();
  const templatesRoot = path.join(root, "templates");
  const profile: InitProfile = {
    ...defaultInitProfile(),
    ides: ["cursor", "claude-code"] as IntegrationIdeKey[],
  };
  const doc = composeIntegrationsDoc(profile, templatesRoot);
  assert.match(doc, /### Cursor/);
  assert.match(doc, /### Claude Code/);
  assert.match(doc, /cursor\.com\/docs/);
  assert.match(doc, /Universal rule/);
});

test("shouldRunInteractiveWizard: false when not TTY or --yes", () => {
  const saved = process.stdout.isTTY;
  try {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    assert.equal(shouldRunInteractiveWizard({ partial: {} }), false);
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    assert.equal(shouldRunInteractiveWizard({ yes: true, partial: {} }), false);
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: saved, configurable: true });
  }
});

test("canPromptInitOverwrite: false when not TTY, --force, or --dry-run", () => {
  const savedOut = process.stdout.isTTY;
  const savedIn = process.stdin.isTTY;
  try {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    assert.equal(canPromptInitOverwrite({}), false);

    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    assert.equal(canPromptInitOverwrite({ force: true }), false);
    assert.equal(canPromptInitOverwrite({ dryRun: true }), false);
    assert.equal(canPromptInitOverwrite({}), true);
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: savedOut, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: savedIn, configurable: true });
  }
});

test("runIntegrationDoctorChecks: warns on deprecated .cursorrules", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-int-"));
  fs.writeFileSync(path.join(dest, ".cursorrules"), "# legacy\n", "utf8");
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), '{"schema_version":"0.5.0","skills":{}}\n', "utf8");
  const templatesRoot = path.join(getRepoRoot(), "templates");
  const { runIntegrationDoctorChecks } = await import("../lib/doctor.js");
  const lines = runIntegrationDoctorChecks(dest, templatesRoot);
  assert.ok(lines.some((l) => l.message.includes("deprecated path .cursorrules")));
});

test("runIntegrationDoctorChecks: AGENTS.md alone does not detect codex-cli", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-codex-"));
  fs.writeFileSync(path.join(dest, "AGENTS.md"), "# agents\n", "utf8");
  fs.mkdirSync(path.join(dest, ".cursor", "rules"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".cursor", "rules", "opengantry-gxt-substrate.mdc"), "---\n", "utf8");
  fs.writeFileSync(path.join(dest, ".cursor", "hooks.json"), '{"version":1,"hooks":{}}\n', "utf8");
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), '{"schema_version":"0.5.0","skills":{}}\n', "utf8");
  const templatesRoot = path.join(getRepoRoot(), "templates");
  const { runIntegrationDoctorChecks } = await import("../lib/doctor.js");
  const lines = runIntegrationDoctorChecks(dest, templatesRoot);
  const wiring = lines.find((l) => l.message.startsWith("detected agent wiring:"));
  assert.ok(wiring);
  assert.match(wiring!.message, /\bcursor\b/);
  assert.doesNotMatch(wiring!.message, /\bcodex-cli\b/);
});
