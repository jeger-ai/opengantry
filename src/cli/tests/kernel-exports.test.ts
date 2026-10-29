import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createRequire } from "node:module";

import { evaluateScope, isPromoteClassFunctionId } from "#missions/kernel-evaluate-scope.js";
import type { Manifest } from "#core/manifest.js";
import type { ParsedMission } from "#core/mission-types.js";

test("kernel exports: package subpaths resolve after build", () => {
  const require = createRequire(import.meta.url);
  const root = path.resolve(import.meta.dirname, "../../..");
  const kernelPath = path.join(root, "dist/cli/kernel.js");
  assert.ok(fs.existsSync(kernelPath), "dist/cli/kernel.js must exist — run npm run build");
  const kernel = require(kernelPath) as {
    evaluateScope: typeof evaluateScope;
    verifyMission: (input: { repoRoot: string; missionRelPath: string }) => Promise<unknown>;
    loadGovernanceBundle: (repoRoot: string, missionRelPath: string) => unknown;
  };
  assert.equal(typeof kernel.evaluateScope, "function");
  assert.equal(typeof kernel.verifyMission, "function");
  assert.equal(typeof kernel.loadGovernanceBundle, "function");
});

test("evaluateScope: inside tmvc allowed", () => {
  const manifest: Manifest = {
    schema_version: "0.5.0",
    skills: {
      gantry: {
        desc: "test",
        trust_threshold: "Tier-2",
        tmvc_roots: ["src/cli/"],
        forbidden_zones: [".gitagent/foreman/"],
        gate_commands: ["npm test"],
      },
    },
    path_risks: {},
    risk_keywords: [],
    perimeter_protected: [],
  };
  const mission = {
    skillKey: "gantry",
    msnId: "MSN-0154",
    gateCommand: "npm test",
    rawPath: ".gitagent/missions/t.yaml",
    traceRows: [],
  } as unknown as ParsedMission;
  const result = evaluateScope({
    manifest,
    mission,
    repoRelPath: "src/cli/kernel.ts",
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "allowed");
});

test("isPromoteClassFunctionId detects promote patterns", () => {
  assert.equal(isPromoteClassFunctionId("demo::promote"), true);
  assert.equal(isPromoteClassFunctionId("git::push"), true);
  assert.equal(isPromoteClassFunctionId("math::add"), false);
});
