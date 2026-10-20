import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_CLI_SKILL_KEY, manifestHasSkill } from "#missions/skill-key.js";
import type { Manifest } from "#core/manifest.js";

const manifest: Manifest = {
  schema_version: "0.5.0",
  skills: {
    gantry: { desc: "cli", trust_threshold: "Tier-2", tmvc_roots: ["src/cli/"], forbidden_zones: [] },
  },
  path_risks: {},
  risk_keywords: [],
};

test("manifestHasSkill: the key itself, no alias (the legacy CLI alias left in 4.0)", () => {
  assert.equal(CANONICAL_CLI_SKILL_KEY, "gantry");
  assert.equal(manifestHasSkill(manifest, "gantry"), true);
  assert.equal(manifestHasSkill(manifest, "ui"), false);
});
