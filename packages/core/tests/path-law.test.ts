import test from "node:test";
import assert from "node:assert/strict";
import { judgePath, pathLaw, tightenPathLaw, type PathLawRule } from "../src/path-law.js";

// Today's cage rule table (packages/cage/src/cage-rules.ts) written as a path law: the fixture step 3 ports onto.
const deny = (id: string, source: string, patterns: string[], extra: Partial<PathLawRule> = {}): PathLawRule => ({ id, source, patterns, effect: "deny", overridable: true, ...extra });
const floor: PathLawRule[] = [
  deny("ci_config", "builtin", [".github/workflows", ".gitlab-ci.yml", ".circleci", "azure-pipelines.yml"]),
  deny("git_control", "builtin", [".git/config", ".git/hooks"], { overridable: false }),
  deny("cage_config", "builtin", [".cage.yaml"], { overridable: false }),
  deny("manifest_forbidden_zone", "manifest", ["secrets"]),
  deny("secrets", "builtin", ["**/.env", "**/.env.*"], { except: ["**/.env.example"] }),
  { id: "lockfile", source: "builtin", patterns: ["**/package-lock.json", "**/yarn.lock"], effect: "report", overridable: true },
  deny("cage_protect", "cage_yaml", ["**/*.pem"]),
  { id: "cage_protect", source: "cage_yaml", patterns: ["docs/notes"], effect: "report", overridable: true },
];
const freeze: PathLawRule[] = [
  deny("lockfile", "builtin", ["**/package-lock.json", "**/yarn.lock"]),
  deny("dependency_manifest", "builtin", ["**/package.json", "**/requirements*.txt"], { except: ["**/vendor/**"] }),
];
const cage = pathLaw({ rules: floor });
const rule = (law = cage, path: string, overrides: string[] = []) => judgePath(law, path, overrides);

test("cage floor: built-in, manifest and .cage.yaml rules with their modes and sources", () => {
  assert.deepEqual(rule(cage, ".github/workflows/ci.yml"), { rule: "ci_config", source: "builtin", effect: "deny", overridden: false });
  assert.equal(rule(cage, ".env")?.rule, "secrets");
  assert.equal(rule(cage, "app/.env.local")?.rule, "secrets");
  assert.equal(rule(cage, "app/.env.example"), null);
  assert.deepEqual(rule(cage, "secrets/k.txt"), { rule: "manifest_forbidden_zone", source: "manifest", effect: "deny", overridden: false });
  assert.deepEqual(rule(cage, "web/package-lock.json"), { rule: "lockfile", source: "builtin", effect: "report", overridden: false });
  assert.deepEqual(rule(cage, "certs/a.pem"), { rule: "cage_protect", source: "cage_yaml", effect: "deny", overridden: false });
  assert.equal(rule(cage, "docs/notes/a.md")?.effect, "report");
  assert.equal(rule(cage, "src/app.ts"), null);
  assert.equal(rule(cage, "package.json"), null, "manifests are free until dependencies are frozen");
});

test("a dependency freeze adds deny rules; the strictest effect outranks the report rule, vendor stays free", () => {
  const frozen = pathLaw({ rules: [...floor, ...freeze] });
  assert.deepEqual(rule(frozen, "package-lock.json"), { rule: "lockfile", source: "builtin", effect: "deny", overridden: false });
  assert.equal(rule(frozen, "package.json")?.rule, "dependency_manifest");
  assert.equal(rule(frozen, "py/requirements-dev.txt")?.rule, "dependency_manifest");
  assert.equal(rule(frozen, "vendor/x/package.json"), null);
});

test("overrides lower an overridable deny to report and never touch harness rules", () => {
  assert.deepEqual(rule(cage, ".github/workflows/ci.yml", [".github/workflows"]), { rule: "ci_config", source: "builtin", effect: "report", overridden: true });
  assert.equal(rule(cage, ".cage.yaml", [".cage.yaml"])?.effect, "deny");
  assert.equal(rule(cage, ".git/hooks/pre-push", [".git"])?.effect, "deny");
  const overlap = pathLaw({ rules: [...floor, deny("cage_protect", "cage_yaml", [".git/hooks"])] });
  assert.deepEqual(rule(overlap, ".git/hooks/x", [".git/hooks"]), { rule: "git_control", source: "builtin", effect: "deny", overridden: false });
  assert.equal(rule(cage, "web/package-lock.json", ["web"])?.overridden, false, "a report rule is not overridden");
});

test("a scope is an area: outside it is denied, a rule on the same path keeps its own name, overrides relax it", () => {
  const scoped = pathLaw({ rules: floor, areas: [{ id: "out_of_scope", source: "cage_yaml", patterns: ["src/**"], overridable: true }] });
  assert.equal(rule(scoped, "src/a/b.ts"), null);
  assert.deepEqual(rule(scoped, "README.md"), { rule: "out_of_scope", source: "cage_yaml", effect: "deny", overridden: false });
  assert.equal(rule(scoped, ".github/workflows/ci.yml")?.rule, "ci_config");
  assert.equal(rule(scoped, "docs/notes/a.md")?.rule, "out_of_scope", "deny outranks the report rule");
  assert.deepEqual(rule(scoped, "README.md", ["README.md"]), { rule: "out_of_scope", source: "cage_yaml", effect: "report", overridden: true });
  const both = pathLaw({ areas: [...scoped.areas, { id: "out_of_scope", source: "flag", patterns: ["src/a"], overridable: true }] });
  assert.equal(rule(both, "src/a/x.ts"), null);
  assert.equal(rule(both, "src/b/x.ts")?.source, "flag", "areas intersect: neither list widens the other");
});

// Today's mission classification (law.test.ts) as a path law: transport, forbidden zones, roots, perimeter.
const skill = pathLaw({
  areas: [{ id: "outside_roots", source: "skill", patterns: ["src/cli/"], overridable: false }],
  rules: [
    deny("forbidden_zone", "skill", [".gitagent/foreman/"], { overridable: false }),
    { id: "protected_path", source: "skill", patterns: ["**/.gxt-skill.yaml", ".gitagent/planner/RULES.md"], effect: "planner", overridable: false },
  ],
  exempt: ["EXECUTOR_LOG.md"],
});

test("mission scope: transport is exempt, then forbidden zones, then roots, then the perimeter", () => {
  assert.equal(rule(skill, "EXECUTOR_LOG.md"), null);
  assert.equal(rule(skill, ".gitagent/foreman/MANIFEST.yaml")?.rule, "forbidden_zone");
  assert.equal(rule(skill, "src/cli/lib/x.ts"), null);
  assert.equal(rule(skill, "./src/cli"), null);
  assert.equal(rule(skill, "docs/x.md")?.rule, "outside_roots");
  assert.equal(rule(skill, "src/cli2/x.ts")?.rule, "outside_roots");
  assert.deepEqual(rule(skill, "src/cli/a/.gxt-skill.yaml"), { rule: "protected_path", source: "skill", effect: "planner", overridden: false });
  assert.equal(rule(skill, ".gitagent/planner/RULES.md")?.rule, "outside_roots", "deny outranks planner");
});

test("tightenPathLaw appends levels: a lower level narrows and can never widen or add exemptions", () => {
  const contract = tightenPathLaw(skill, {
    areas: [{ id: "outside_roots", source: "contract", patterns: ["src/cli/lib/", "docs/"], overridable: false }],
    rules: [deny("forbidden_zone", "contract", ["src/cli/lib/secret/"], { overridable: false })],
  });
  assert.equal(rule(contract, "src/cli/lib/a.ts"), null);
  assert.equal(rule(contract, "src/cli/x.ts")?.source, "contract");
  assert.equal(rule(contract, "docs/a.md")?.source, "skill", "the contract's wider area does not reopen docs/");
  assert.equal(rule(contract, "src/cli/lib/secret/k.ts")?.source, "contract");
  assert.equal(rule(contract, ".gitagent/foreman/x")?.source, "skill", "upper rules come first among equals");
  assert.deepEqual(contract.exempt, ["EXECUTOR_LOG.md"]);
  assert.equal(rule(pathLaw(), "anything/at/all"), null);
});
