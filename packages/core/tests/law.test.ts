import test from "node:test";
import assert from "node:assert/strict";
import { classifyPath, evaluatePaths, isPathUnderRoot, isProtectedPath, law, tighten, unionSorted } from "../src/law.js";

const skill = law({ tier: "Tier-2", allowedRoots: ["src/cli/"], forbiddenZones: [".gitagent/foreman/"], protectedPaths: ["**/.gxt-skill.yaml", ".gitagent/planner/RULES.md"], transportPaths: ["EXECUTOR_LOG.md"] });

test("classifyPath: transport, then forbidden zones, then roots", () => {
  assert.equal(classifyPath(skill, "EXECUTOR_LOG.md"), "transport");
  assert.equal(classifyPath(skill, ".gitagent/foreman/MANIFEST.json"), "forbidden_zone");
  assert.equal(classifyPath(skill, "src/cli/lib/x.ts"), "inside_roots");
  assert.equal(classifyPath(skill, "./src/cli"), "inside_roots");
  assert.equal(classifyPath(skill, "docs/x.md"), "outside_roots");
  assert.equal(isPathUnderRoot("src/cli2/x.ts", "src/cli/"), false);
});

test("tighten unions the sets, narrows the roots and keeps the stricter tier", () => {
  const r = tighten(skill, { tier: "Tier-3", allowedRoots: ["src/cli/lib/"], forbiddenZones: ["templates/"], bannedImports: ["lodash"] });
  assert.deepEqual(r.violations, []);
  assert.equal(r.law.tier, "Tier-3");
  assert.deepEqual(r.law.allowedRoots, ["src/cli/lib/"]);
  assert.deepEqual(r.law.forbiddenZones, [".gitagent/foreman/", "templates/"]);
  assert.deepEqual(r.law.bannedImports, ["lodash"]);
  assert.deepEqual(r.law.protectedPaths, skill.protectedPaths);
});

test("tighten reports roots that widen the upper law or sit in a forbidden zone, and accepts any roots under an empty upper law", () => {
  const widen = tighten(skill, { allowedRoots: ["docs/"] });
  assert.deepEqual(widen.violations, [{ kind: "roots_escape", paths: ["docs/"] }]);
  const forbidden = tighten(law({ allowedRoots: [] }), { allowedRoots: [".gitagent/foreman/"], forbiddenZones: [".gitagent/foreman/"] });
  assert.deepEqual(forbidden.violations, [{ kind: "roots_in_forbidden", paths: [".gitagent/foreman/"] }]);
  const open = tighten(law({}), { allowedRoots: ["anything/"] });
  assert.deepEqual(open.violations, []);
  assert.deepEqual(open.law.allowedRoots, ["anything/"]);
  assert.deepEqual(unionSorted(["b", " ", "a"], ["a"]), ["a", "b"]);
});

test("protected paths use the perimeter glob dialect", () => {
  assert.equal(isProtectedPath(skill, "packages/x/.gxt-skill.yaml"), true);
  assert.equal(isProtectedPath(skill, ".gitagent/planner/RULES.md"), true);
  assert.equal(isProtectedPath(skill, ".gitagent/planner/RULES.md.bak"), false);
});

test("evaluatePaths judges a staged change set in order, one finding per path", () => {
  const findings = evaluatePaths(skill, { kind: "staged", paths: ["src/cli/a.ts", ".gitagent/foreman/MANIFEST.json", "docs/b.md", "EXECUTOR_LOG.md", ".gitagent/planner/RULES.md"] }, { protectedPaths: true });
  // A protected path outside the roots is reported as outside_roots: roots are judged before protection.
  assert.deepEqual(findings, [
    { rule: "forbidden_zone", path: ".gitagent/foreman/MANIFEST.json" },
    { rule: "outside_roots", path: "docs/b.md" },
    { rule: "outside_roots", path: ".gitagent/planner/RULES.md" },
  ]);
  const protectedOnly = evaluatePaths(law({ protectedPaths: ["**/.gxt-skill.yaml"] }), { kind: "range", paths: ["a/.gxt-skill.yaml", "b.ts"], base: "x", head: "y" }, { roots: false, protectedPaths: true });
  assert.deepEqual(protectedOnly, [{ rule: "protected_path", path: "a/.gxt-skill.yaml" }]);
});
