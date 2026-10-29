import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getRepoRoot } from "#git/git.js";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  validateIntegrationCompat,
} from "#missions/integration-compat.js";
import {
  resolveAssetsFromProfile,
} from "#missions/init/init-asset-catalog.js";
import { composeIntegrationsDoc, recipeFilesExist } from "#missions/init/init-compose.js";
import { defaultInitProfile, shouldRunInteractiveWizard, type InitProfile } from "#missions/init/init-profile.js";
import { canPromptInitOverwrite } from "../init/init-interactive.js";
import type { IntegrationIdeKey } from "#missions/integration-compat.js";

test("integration compat: all IDE keys have manifest entries and recipes", () => {
  const root = getRepoRoot();
  const templatesRoot = path.join(root, "templates");
  const compat = loadIntegrationCompat(templatesRoot);
  validateIntegrationCompat(compat);
  recipeFilesExist(templatesRoot, compat);
  for (const key of INTEGRATION_IDE_KEYS) {
    assert.ok(compat.integrations[key], key);
    assert.ok(compat.integrations[key].bootstrap_mode, `${key} bootstrap_mode`);
  }
});

test("resolveAssetsFromProfile: default catalog covers all core managed paths", () => {
  const templatesRoot = path.join(getRepoRoot(), "templates");
  const fromCatalog = resolveAssetsFromProfile(
    defaultInitProfile(),
    loadIntegrationCompat(templatesRoot),
    templatesRoot,
  )
    .map((a) => a.targetPath)
    .sort();
  assert.ok(fromCatalog.includes(".github/workflows/gxt-validate.yml"));
  assert.ok(fromCatalog.includes("scripts/gxt-runtime-env.sh"));
  assert.ok(!fromCatalog.includes("scripts/validate-gxt.sh"), "validate-gxt.sh moved into gantry ci (ADR-0052 step 5b)");
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
