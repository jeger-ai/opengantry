import test from "node:test";
import assert from "node:assert/strict";
import { validateDefensiveProfile, resolveDefensiveProfile } from "../lib/defensive-profile.js";

test("validateDefensiveProfile: rejects invalid max_net_loc", () => {
  assert.throws(
    () =>
      validateDefensiveProfile({
        enabled: true,
        guards: { net_loc_budget: { enabled: true, max_net_loc: 0 } },
      }),
    /positive integer/,
  );
});

test("resolveDefensiveProfile: fail-closed when profile disabled", () => {
  const resolved = resolveDefensiveProfile({});
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.net_loc_budget, null);
});

test("resolveDefensiveProfile: guard opt-in with default max", () => {
  const resolved = resolveDefensiveProfile({
    defensive_profile: {
      enabled: true,
      guards: { net_loc_budget: { enabled: true } },
    },
  });
  assert.equal(resolved.net_loc_budget?.max_net_loc, 500);
});
