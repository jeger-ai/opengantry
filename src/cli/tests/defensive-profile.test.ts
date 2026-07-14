import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDefensiveProfile,
  resolveDefensiveProfile,
  GUARD_SEVERITIES,
} from "../lib/defensive-profile.js";
import {
  buildDefensiveProfileFromPreset,
  parseDefensiveProfilePreset,
} from "../lib/defensive-profile-presets.js";
import { countAssertionTokens } from "../lib/defensive-guard.js";
import { mergeDefensiveProfileIntoConfigBody } from "../lib/init-defensive-profile.js";

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

test("validateDefensiveProfile: accepts preset and severity", () => {
  const cfg = validateDefensiveProfile({
    enabled: true,
    preset: "balanced_partner",
    guards: {
      file_scope: { enabled: true, severity: "warn", max_files: 20 },
      churn_ratio: { enabled: true, max_ratio: 0.7 },
    },
  });
  assert.equal(cfg.preset, "balanced_partner");
  assert.equal(cfg.guards?.file_scope?.severity, "warn");
  assert.equal(cfg.guards?.churn_ratio?.max_ratio, 0.7);
});

test("validateDefensiveProfile: rejects invalid severity", () => {
  assert.throws(
    () =>
      validateDefensiveProfile({
        enabled: true,
        guards: { net_loc_budget: { enabled: true, severity: "fatal" } },
      }),
    /block, warn, or audit/,
  );
  assert.deepEqual(GUARD_SEVERITIES, ["block", "warn", "audit"]);
});

test("resolveDefensiveProfile: fail-closed when profile disabled", () => {
  const resolved = resolveDefensiveProfile({});
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.net_loc_budget, null);
  assert.equal(resolved.file_scope, null);
});

test("resolveDefensiveProfile: preset supplies warn severity for balanced_partner", () => {
  const resolved = resolveDefensiveProfile({
    defensive_profile: buildDefensiveProfileFromPreset("balanced_partner"),
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.net_loc_budget?.severity, "warn");
  assert.equal(resolved.file_scope?.severity, "warn");
  assert.equal(resolved.net_loc_budget?.config.max_net_loc, 500);
});

test("buildDefensiveProfileFromPreset: enables all guards", () => {
  const cfg = buildDefensiveProfileFromPreset("strict_enterprise");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.preset, "strict_enterprise");
  assert.equal(cfg.guards?.net_loc_budget?.enabled, true);
  assert.equal(cfg.guards?.file_scope?.enabled, true);
  assert.equal(cfg.guards?.churn_ratio?.enabled, true);
  assert.equal(cfg.guards?.test_to_code?.enabled, true);
});

test("parseDefensiveProfilePreset: rejects unknown preset", () => {
  assert.throws(() => parseDefensiveProfilePreset("yolo"), /strict_enterprise/);
});

test("countAssertionTokens: counts assert and expect patterns", () => {
  const src = `
    assert.equal(x, 1);
    expect(foo).toBe(2);
    assert.strictEqual(a, b);
  `;
  assert.equal(countAssertionTokens(src), 3);
});

test("mergeDefensiveProfileIntoConfigBody: injects preset", () => {
  const template = JSON.stringify({ trusted_automation: { rules: [] } }, null, 2);
  const merged = mergeDefensiveProfileIntoConfigBody(template, "lean_scratchpad");
  const parsed = JSON.parse(merged) as { defensive_profile: { preset: string; enabled: boolean } };
  assert.equal(parsed.defensive_profile.preset, "lean_scratchpad");
  assert.equal(parsed.defensive_profile.enabled, true);
});
