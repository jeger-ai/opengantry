import test from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_ADOPTION_DOC,
  onboardingRuntimeEnvHint,
  onboardingStartHint,
  onboardingStatusHint,
  onboardingVerifyHint,
} from "../lib/onboarding-flow.js";

test("onboarding hints: align with v0.9.0 adoption loop", () => {
  const mission = ".gitagent/missions/MSN-0001.example.yaml";
  assert.match(onboardingRuntimeEnvHint(mission), /runtime env --mission/);
  assert.match(onboardingVerifyHint(mission), /--fix/);
  assert.match(onboardingVerifyHint(mission), /MSN-0001\.example\.yaml/);
  assert.match(onboardingStatusHint(), /--json/);
  assert.match(onboardingStartHint(), /gapman start/);
  assert.equal(ONBOARDING_ADOPTION_DOC, "docs/ADOPTION.md");
});
