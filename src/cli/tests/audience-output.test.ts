import test from "node:test";
import assert from "node:assert/strict";
import {
  filterTaggedStepsForAudience,
  formatAudienceNextStep,
  resolveAudience,
  type AudienceNextStep,
} from "../lib/audience-output.js";

test("filterTaggedStepsForAudience: preserves concrete mission-specific steps", () => {
  const concrete: AudienceNextStep[] = [
    {
      audience: "teacher",
      step: 'Teacher: git add .gitagent/missions/MSN-0015.foo.yaml && git commit -m "[MSN-0015] legislate mission"',
    },
    {
      audience: "worker",
      step: 'eval "$(gantry runtime env --mission .gitagent/missions/MSN-0015.foo.yaml)"',
    },
    {
      audience: "verifier",
      step: "gantry verify --mission .gitagent/missions/MSN-0015.foo.yaml",
    },
  ];
  const workerSteps = filterTaggedStepsForAudience("worker", concrete);
  assert.ok(workerSteps.some((s) => s.includes("MSN-0015.foo.yaml")));
  assert.ok(workerSteps.every((s) => !s.includes("<file>.yaml")));

  const verifierSteps = filterTaggedStepsForAudience("verifier", concrete);
  assert.equal(verifierSteps.length, 1);
  assert.match(verifierSteps[0]!, /MSN-0015\.foo\.yaml/);
});

test("filterTaggedStepsForAudience: falls back to role defaults when no computed steps", () => {
  const defaults = filterTaggedStepsForAudience("platform", []);
  assert.ok(defaults.some((s) => s.includes("core.hooksPath")));
});

test("formatAudienceNextStep: worker and teacher prefixes", () => {
  assert.match(formatAudienceNextStep("gantry verify --mission x.yaml", "worker"), /^Constraint:/);
  assert.match(
    formatAudienceNextStep('git commit -m "[MSN-0001] legislate"', "teacher"),
    /Teacher:|git commit/,
  );
});

test("resolveAudience: env fallback when CLI omitted", () => {
  const r = resolveAudience(undefined, "verifier");
  assert.equal(r.audience, "verifier");
});

test("filterTaggedStepsForAudience: dedupes identical teacher steps", () => {
  const duped: AudienceNextStep[] = [
    {
      audience: "teacher",
      step: 'Teacher: git add m.yaml && git commit -m "[MSN-9001] legislate mission"',
    },
    {
      audience: "teacher",
      step: 'Teacher: git add m.yaml && git commit -m "[MSN-9001] legislate mission"',
    },
  ];
  const steps = filterTaggedStepsForAudience("teacher", duped);
  assert.equal(steps.length, 1);
});
