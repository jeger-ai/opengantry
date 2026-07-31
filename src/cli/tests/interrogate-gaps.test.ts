import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadManifest } from "../lib/manifest.js";
import { computeGaps } from "../lib/interrogate/gaps.js";
import { stableFindingId } from "../lib/interrogate/findings.js";
import { writeManifest } from "./test-fixtures.js";

test("computeGaps: non-allowlisted gate yields missing_test_criteria", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-gate-"));
  writeManifest(root, {
    gantry: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [],
      gate_commands: ["npm test"],
    },
  });
  const manifest = loadManifest(root);
  const gate = "npm run custom-gate";
  const findings = computeGaps({
    root,
    manifest,
    intent: "Add CLI flag",
    skillKey: "gantry",
    gateCommand: gate,
    gateSuccessSubstring: "PASS",
    paths: [],
  });
  const id = stableFindingId("missing_test_criteria", `gate:${gate}`);
  const match = findings.find((f) => f.finding_id === id);
  assert.ok(match);
  assert.equal(match!.kind, "missing_test_criteria");
});

test("computeGaps: unmapped paths grouped by path_risks tier (separate findings)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-tier-"));
  writeManifest(
    root,
    {
      gantry: {
        trust_threshold: "Tier-2",
        tmvc_roots: ["src/cli/"],
        forbidden_zones: [],
        gate_commands: ["npm test"],
      },
    },
    { "src/cli/": "Tier-2", ".gitagent/": "Tier-3" },
  );
  const manifest = loadManifest(root);
  const findings = computeGaps({
    root,
    manifest,
    intent: "Touch paths",
    skillKey: "gantry",
    gateCommand: "npm test",
    gateSuccessSubstring: null,
    paths: ["src/cli/foo.ts", ".gitagent/planner/foo.md"],
  });
  const boundaries = findings.filter((f) => f.kind === "undefined_boundary");
  assert.equal(boundaries.length, 2);
  assert.ok(boundaries.some((f) => f.risk_tier === "Tier-2"));
  assert.ok(boundaries.some((f) => f.risk_tier === "Tier-3"));
});
