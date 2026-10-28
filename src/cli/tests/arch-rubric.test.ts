import test from "node:test";
import assert from "node:assert/strict";
import {
  archOverrideAdvisoryMessage,
  commitSubjectHasArchOverride,
} from "#missions/arch-override.js";

test("arch-override: detects token in commit subject", () => {
  assert.equal(commitSubjectHasArchOverride("[MSN-0001] [GXT-ARCH-OVERRIDE] accept rubric"), true);
  assert.equal(commitSubjectHasArchOverride("[MSN-0001] legislate"), false);
});

test("arch-override: advisory message format", () => {
  assert.match(archOverrideAdvisoryMessage("MSN-0001", "abc123"), /GXT-ARCH-OVERRIDE/);
});
