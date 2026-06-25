import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_CLI_SKILL_KEY,
  LEGACY_CLI_SKILL_KEY,
  manifestHasSkill,
  resolveManifestSkillKey,
} from "../lib/skill-key.js";
import type { Manifest } from "../lib/types.js";

const manifestGantryOnly: Manifest = {
  schema_version: "0.5.0",
  skills: {
    gantry: {
      desc: "cli",
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [],
    },
  },
  path_risks: {},
  risk_keywords: [],
};

const manifestGapmanOnly: Manifest = {
  ...manifestGantryOnly,
  skills: {
    gapman: {
      desc: "cli",
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [],
    },
  },
};

test("resolveManifestSkillKey: legacy gapman maps to gantry manifest key", () => {
  assert.equal(resolveManifestSkillKey(manifestGantryOnly, LEGACY_CLI_SKILL_KEY), CANONICAL_CLI_SKILL_KEY);
  assert.equal(manifestHasSkill(manifestGantryOnly, LEGACY_CLI_SKILL_KEY), true);
});

test("resolveManifestSkillKey: gantry maps to legacy gapman manifest key", () => {
  assert.equal(resolveManifestSkillKey(manifestGapmanOnly, CANONICAL_CLI_SKILL_KEY), LEGACY_CLI_SKILL_KEY);
  assert.equal(manifestHasSkill(manifestGapmanOnly, CANONICAL_CLI_SKILL_KEY), true);
});

test("resolveManifestSkillKey: unknown key unchanged", () => {
  assert.equal(resolveManifestSkillKey(manifestGantryOnly, "ui"), "ui");
  assert.equal(manifestHasSkill(manifestGantryOnly, "ui"), false);
});
