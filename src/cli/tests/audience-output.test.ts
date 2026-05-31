import test from "node:test";
import assert from "node:assert/strict";
import { filterNextStepsForAudience } from "../lib/audience-output.js";

test("filterNextStepsForAudience: preserves concrete mission-specific steps", () => {
  const concrete = [
    "Teacher: git add .gitagent/missions/MSN-0015.foo.yaml && git commit -m \"[MSN-0015] legislate mission\"",
    "eval \"$(gapman runtime env --mission .gitagent/missions/MSN-0015.foo.yaml)\"",
    "gapman verify --mission .gitagent/missions/MSN-0015.foo.yaml",
  ];
  const workerSteps = filterNextStepsForAudience("worker", concrete);
  assert.ok(workerSteps.some((s) => s.includes("MSN-0015.foo.yaml")));
  assert.ok(workerSteps.every((s) => !s.includes("<file>.yaml")));

  const verifierSteps = filterNextStepsForAudience("verifier", concrete);
  assert.equal(verifierSteps.length, 1);
  assert.match(verifierSteps[0]!, /MSN-0015\.foo\.yaml/);
});

test("filterNextStepsForAudience: falls back to role defaults when no computed steps", () => {
  const defaults = filterNextStepsForAudience("platform", []);
  assert.ok(defaults.some((s) => s.includes("core.hooksPath")));
});
