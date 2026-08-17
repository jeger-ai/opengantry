import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRequire } from "node:module";

import { evaluateScope, isPromoteClassFunctionId } from "../lib/kernel-evaluate-scope.js";
import {
  mintVerdictToken,
  verifyVerdictToken,
} from "../lib/verdict-token.js";
import type { PepperKeyringEntry } from "../lib/pepper-keyring.js";
import type { Manifest, ParsedMission } from "../lib/types.js";

test("kernel exports: package subpaths resolve after build", () => {
  const require = createRequire(import.meta.url);
  const root = path.resolve(import.meta.dirname, "../../..");
  const kernelPath = path.join(root, "dist/cli/kernel.js");
  assert.ok(fs.existsSync(kernelPath), "dist/cli/kernel.js must exist — run npm run build");
  const kernel = require(kernelPath) as {
    evaluateScope: typeof evaluateScope;
    verifyMission: (input: { repoRoot: string; missionRelPath: string }) => unknown;
    verifyVerdictToken: typeof verifyVerdictToken;
    loadGovernanceBundle: (repoRoot: string, missionRelPath: string) => unknown;
    buildVerdictExpectedClaims: (repoRoot: string, missionRelPath: string) => unknown;
    verdictClaimsFor: (repoRoot: string, missionRelPath: string) => unknown;
    resolveOrgId: (repoRoot: string) => string;
  };
  assert.equal(typeof kernel.evaluateScope, "function");
  assert.equal(typeof kernel.verifyMission, "function");
  assert.equal(typeof kernel.verifyVerdictToken, "function");
  assert.equal(typeof kernel.loadGovernanceBundle, "function");
  assert.equal(typeof kernel.buildVerdictExpectedClaims, "function");
  assert.equal(typeof kernel.verdictClaimsFor, "function");
  assert.equal(typeof kernel.resolveOrgId, "function");
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

test("verdict-token: mint and verify round-trip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-vt-"));
  const keyringFile = path.join(dir, "pepper-keyring.json");
  const entries: PepperKeyringEntry[] = [
    { org_id: "org-test", pepper_version: 1, pepper: "test-pepper-secret" },
  ];
  fs.writeFileSync(keyringFile, JSON.stringify(entries), { mode: 0o600 });
  const expected = {
    msn_id: "MSN-0154",
    mission_sha256: "abc123",
    findings_digest: "digest",
    gate_command: "npm test",
    org_id: "org-test",
  };
  const token = mintVerdictToken({
    ...expected,
    keyringPath: keyringFile,
    ttlSeconds: 60,
  });
  assert.ok(verifyVerdictToken({ token, expected, keyringPath: keyringFile }));
  assert.equal(
    verifyVerdictToken({
      token,
      expected: { ...expected, findings_digest: "wrong" },
      keyringPath: keyringFile,
    }),
    false,
  );
});
