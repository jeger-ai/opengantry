import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiableMissionPath } from "#missions/dirty-missions.js";

test("isVerifiableMissionPath: excludes missions README", () => {
  assert.equal(isVerifiableMissionPath(".gitagent/missions/README.md"), false);
  assert.equal(isVerifiableMissionPath(".gitagent/missions/MSN-0001.foo.yaml"), true);
});

