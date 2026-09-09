import test from "node:test";
import assert from "node:assert/strict";
import { emptyEffectivePolicy, floorViolations, mergeTightenOnly } from "../lib/policy/policy-merge.js";
import type { OrgPolicyBundle, PolicyPointer } from "../lib/policy/policy-types.js";

const pointer: PolicyPointer = {
  schema_version: "1.0.0",
  source: { kind: "git", url: "https://example.invalid/p.git", ref: "refs/heads/main" },
  bundle_path: "ORG-POLICY.yaml",
  pinned_commit: "a".repeat(40),
  bundle_sha256: "b".repeat(64),
};

function bundle(floor: OrgPolicyBundle["config_floor"]): OrgPolicyBundle {
  return {
    schema_version: "1.0.0",
    org_id: "org",
    policy_id: "p",
    version: "1",
    config_floor: floor,
  };
}

test("policy-merge: absent bundle is not present", () => {
  const e = mergeTightenOnly(null, null);
  assert.equal(e.present, false);
  assert.deepEqual(e, { ...emptyEffectivePolicy(), pointer: null });
});

test("policy-merge: tighten-only takes the stricter signature tier", () => {
  const effective = mergeTightenOnly(pointer, bundle({ planner_signature: "warn" }), {
    planner_signature: "off",
  });
  assert.equal(effective.config_floor.planner_signature, "warn");
  const tighterLocal = mergeTightenOnly(pointer, bundle({ planner_signature: "warn" }), {
    planner_signature: "require",
  });
  assert.equal(tighterLocal.config_floor.planner_signature, "require");
});

test("policy-merge: policy cannot loosen local ledger.mode or hash_only", () => {
  const localWins = mergeTightenOnly(pointer, bundle({ ledger_mode: "off" }), { ledger_mode: "local" });
  assert.equal(localWins.config_floor.ledger_mode, "local");
  const floorWins = mergeTightenOnly(
    pointer,
    bundle({ flight_telemetry: { body_mode: "hash_only" } }),
    { flight_telemetry: { body_mode: "full" } },
  );
  assert.equal(floorWins.config_floor.flight_telemetry?.body_mode, "hash_only");
});

test("policy-merge: floorViolations reports only when local is weaker", () => {
  const effective = mergeTightenOnly(pointer, bundle({ planner_signature: "require", ledger_mode: "local" }));
  assert.ok(floorViolations(effective, { planner_signature: "off", ledger_mode: "off" }).length >= 2);
  assert.equal(floorViolations(effective, { planner_signature: "require", ledger_mode: "local" }).length, 0);
});
