import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configFloorViolations,
  FLOOR_RULES,
  TIER_RANK,
  trustTierRank,
} from "../lib/policy/policy-resolve.js";
import { pullOrgPolicy } from "../lib/policy/policy-fetch.js";
import type { PolicyConfigFloor } from "../lib/policy/policy-types.js";
import { REL_POLICY_POINTER } from "../lib/constants.js";
import { getRepoRoot } from "../lib/git.js";
import { gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import { sampleOrgPolicyYaml } from "./test-org-fixtures.js";

test("FLOOR_RULES: table covers signature, ledger, telemetry, and break-glass", () => {
  assert.deepEqual(
    FLOOR_RULES.map((r) => r.label),
    [
      "planner_signature",
      "receipt_signature",
      "ledger_signature",
      "ledger.mode",
      "flight_telemetry.body_mode",
      "break_glass.require_ledger_entry",
    ],
  );
  assert.equal(TIER_RANK["Tier-2"], 2);
  assert.equal(trustTierRank("Tier-3"), 3);
  assert.equal(trustTierRank("custom"), 0);
});

test("configFloorViolations: reports only when local is weaker than floor", () => {
  const floor: PolicyConfigFloor = { planner_signature: "require", ledger_mode: "local" };
  assert.ok(configFloorViolations(floor, { planner_signature: "off", ledger_mode: "off" }).length >= 2);
  assert.equal(configFloorViolations(floor, { planner_signature: "require", ledger_mode: "local" }).length, 0);
});

test("configFloorViolations: stronger local is not a violation; weaker floor cannot loosen", () => {
  assert.equal(
    configFloorViolations({ ledger_mode: "off" }, { ledger_mode: "local" }).length,
    0,
  );
  assert.ok(
    configFloorViolations(
      { flight_telemetry: { body_mode: "hash_only" } },
      { flight_telemetry: { body_mode: "full" } },
    ).length >= 1,
  );
});

test("configFloorViolations: skip unset signature floors", () => {
  assert.equal(configFloorViolations({}, { planner_signature: "off" }).length, 0);
});

test("policy-fetch: uses git init + fetch --depth 1 and has no copyTree", () => {
  const src = fs.readFileSync(path.join(getRepoRoot(), "src/cli/lib/policy/policy-fetch.ts"), "utf8");
  assert.match(src, /fetch", "--depth", "1"/);
  assert.match(src, /FETCH_HEAD:\$\{pointer\.bundle_path\}/);
  assert.doesNotMatch(src, /function copyTree/);
});

test("pullOrgPolicy: caches only the bundle file", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "og-policy-pull-"));
  const policyRepo = path.join(base, "policy");
  const consumer = path.join(base, "consumer");
  fs.mkdirSync(policyRepo);
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(policyRepo, "ORG-POLICY.yaml"), sampleOrgPolicyYaml(), "utf8");
  fs.writeFileSync(path.join(policyRepo, "EXTRA.md"), "not-cached\n", "utf8");
  gitInitCommit(policyRepo, "chore: policy", PLANNER_EMAIL);

  fs.mkdirSync(path.join(consumer, ".gitagent", "planner"), { recursive: true });
  fs.mkdirSync(path.join(consumer, ".gitagent", "foreman"), { recursive: true });
  fs.copyFileSync(
    path.join(getRepoRoot(), ".gitagent/planner/ORG-POLICY.schema.yaml"),
    path.join(consumer, ".gitagent/planner/ORG-POLICY.schema.yaml"),
  );
  fs.writeFileSync(
    path.join(consumer, REL_POLICY_POINTER),
    `${JSON.stringify(
      {
        schema_version: "1.0.0",
        source: { kind: "git", url: policyRepo, ref: "HEAD" },
        bundle_path: "ORG-POLICY.yaml",
        pinned_commit: "",
        bundle_sha256: "",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = pullOrgPolicy(consumer);
  assert.ok(fs.existsSync(result.cache_path));
  const cacheDir = path.dirname(result.cache_path);
  assert.equal(fs.existsSync(path.join(cacheDir, "EXTRA.md")), false);
  assert.equal(fs.existsSync(path.join(cacheDir, ".git")), false);
  assert.ok(result.pinned_commit.length >= 40);
});
