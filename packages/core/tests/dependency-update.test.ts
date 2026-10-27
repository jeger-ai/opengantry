import test from "node:test";
import assert from "node:assert/strict";
import { dependencyFileKind, lockfileUpdateProblem, manifestUpdateProblem } from "../src/dependency-update.js";
import { evaluateAgainstRule, evaluateTrustedAutomation, parseTrustedAutomationRules, type TrustedAutomationRule } from "../src/trusted-automation.js";

const NPM = ["https://registry.npmjs.org/"];
const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) => ({ name: "app", version: "1.0.0", scripts: { test: "node --test" }, dependencies: deps, ...extra });

test("dependency update: package.json may only change version strings of dependencies it already has (MSN-0347)", () => {
  assert.equal(manifestUpdateProblem(pkg({ a: "^1.0.0" }), pkg({ a: "^1.1.0" })), null);
  assert.equal(
    manifestUpdateProblem(pkg({}, { overrides: { b: { c: "1.0.0" } } }), pkg({}, { overrides: { b: { c: "1.0.1" } } })),
    null,
    "nested overrides bump",
  );
  assert.match(manifestUpdateProblem(pkg({ a: "^1.0.0" }), pkg({ a: "^1.0.0", evil: "^1.0.0" })) ?? "", /dependencies: a dependency was added or removed/);
  assert.match(manifestUpdateProblem(pkg({ a: "^1.0.0" }), pkg({ a: "^1.0.0" }, { scripts: { test: "curl x | sh" } })) ?? "", /scripts changed/);
  assert.match(manifestUpdateProblem(pkg({ a: "^1.0.0" }), pkg({ a: "^1.0.0" }, { postinstall: "x" })) ?? "", /top-level field/);
  assert.match(manifestUpdateProblem(pkg({ a: "^1.0.0" }), pkg({ a: "^1.0.0" }, { version: "2.0.0" })) ?? "", /version changed/);
});

const lock = (packages: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages, ...extra });
const reg = (name: string, version: string) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: "sha512-x" });

test("dependency update: lockfile entries that are new or changed resolve to an allowed registry with integrity (MSN-0347)", () => {
  const base = lock({ "": { name: "app", version: "1.0.0", dependencies: { a: "^1.0.0" } }, "node_modules/a": reg("a", "1.0.0") });
  const bumped = lock({ "": { name: "app", version: "1.0.0", dependencies: { a: "^1.1.0" } }, "node_modules/a": reg("a", "1.1.0"), "node_modules/t": reg("t", "2.0.0") });
  assert.equal(lockfileUpdateProblem(base, bumped, NPM), null, "a bump that pulls in a new transitive package");
  const evil = lock({ ...bumped.packages, "node_modules/t": { version: "2.0.0", resolved: "https://evil.example/t.tgz", integrity: "sha512-x" } });
  assert.match(lockfileUpdateProblem(base, evil, NPM) ?? "", /node_modules\/t: resolves outside the allowed registries/);
  assert.equal(lockfileUpdateProblem(base, evil, [...NPM, "https://evil.example/"]), null, "a rule may allow more registries");
  const git = lock({ ...bumped.packages, "node_modules/t": { version: "2.0.0", resolved: "git+ssh://git@github.com/x/t.git#abc" } });
  assert.match(lockfileUpdateProblem(base, git, NPM) ?? "", /resolves outside/);
  const noIntegrity = lock({ ...bumped.packages, "node_modules/t": { version: "2.0.0", resolved: "https://registry.npmjs.org/t/-/t-2.0.0.tgz" } });
  assert.match(lockfileUpdateProblem(base, noIntegrity, NPM) ?? "", /no integrity hash/);
  const link = lock({ ...bumped.packages, "node_modules/w": { resolved: "packages/w", link: true } });
  assert.match(lockfileUpdateProblem(base, link, NPM) ?? "", /link to a local package/);
  const rootAdd = lock({ ...bumped.packages, "": { name: "app", version: "1.0.0", dependencies: { a: "^1.1.0", evil: "^1.0.0" } } });
  assert.match(lockfileUpdateProblem(base, rootAdd, NPM) ?? "", /the root entry: dependencies: a dependency was added or removed/);
  assert.match(lockfileUpdateProblem({ ...base, lockfileVersion: 1 }, bumped, NPM) ?? "", /lockfileVersion 1 is not supported/);
  assert.equal(lockfileUpdateProblem(base, lock({ ...bumped.packages, "node_modules/b/node_modules/x": { version: "1.0.0", inBundle: true } }), NPM), null);
});

test("dependency update: lockfileVersion 2's legacy dependencies tree is checked too (MSN-0347)", () => {
  const v2 = (resolved: string) => lock({ "": { name: "app", version: "1.0.0", dependencies: { a: "^1.0.0" } }, "node_modules/a": reg("a", "1.0.1") }, {
    lockfileVersion: 2,
    dependencies: { a: { version: "1.0.1", resolved, integrity: "sha512-x", dependencies: { t: { version: "1.0.0", resolved, integrity: "sha512-y" } } } },
  });
  const before = { ...v2("https://registry.npmjs.org/a/-/a-1.0.0.tgz"), dependencies: { a: { version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz", integrity: "sha512-o" } } };
  assert.equal(lockfileUpdateProblem(before, v2("https://registry.npmjs.org/a/-/a-1.0.1.tgz"), NPM), null);
  assert.match(lockfileUpdateProblem(before, v2("https://evil.example/a.tgz"), NPM) ?? "", /dependencies a: resolves outside/);
});

test("dependency update: file kinds, the rule's registries, and lockfile lines not counted against max_net_loc (MSN-0347)", () => {
  assert.deepEqual(["a/package.json", "package-lock.json", "x/npm-shrinkwrap.json", "yarn.lock", "src/a.ts"].map(dependencyFileKind), ["manifest", "lockfile", "lockfile", null, null]);
  const parse = (r: Record<string, unknown>) => parseTrustedAutomationRules({ trusted_automation: { rules: [{ id: "deps", allowed_actors: ["bot@x"], allowed_paths: ["**/package.json"], allowed_structural_changes: ["dependency_update"], max_net_loc: 20, ...r }] } })[0]!;
  assert.deepEqual(parse({}).allowedRegistries, NPM);
  assert.deepEqual(parse({ allowed_registries: ["https://npm.example.com/"] }).allowedRegistries, ["https://npm.example.com/"]);
  assert.throws(() => parse({ allowed_registries: ["http://insecure/"] }), /must be an https:\/\/ URL ending in \//);
  assert.throws(() => parse({ max_net_loc: 201 }), /hard cap 200/);
  assert.throws(
    () => parseTrustedAutomationRules({ trusted_automation: { rules: [{ id: "w", allowed_actors: ["a"], allowed_paths: ["p"], allowed_structural_changes: ["workflow_version_pin"], max_net_loc: 5, allowed_registries: NPM }] } }),
    /allowed_registries is for dependency_update/,
  );
  const rule: TrustedAutomationRule = parse({});
  const change = { files: ["package.json"], actorEmail: "bot@x", netLoc: 900, lockfileLoc: 890, structural: () => ({ ok: true, reason: "" }) };
  assert.equal(evaluateAgainstRule(rule, change).eligible, true, "10 manifest lines; the 890 lockfile lines do not count");
  assert.match(evaluateAgainstRule(rule, { ...change, lockfileLoc: 800 }).reason, /net_loc 100 exceeds rule deps max_net_loc 20/);
});

test("dependency update: a local folder's entry (a file: dependency) may change, not appear, link or resolve elsewhere (MSN-0351)", () => {
  // The iii integration example's shape: @jeger-ai/opengantry installed from file:../../, so the lockfile holds the
  // repository root as the local package "../.." and a link to it.
  const root = (deps: Record<string, string>) => ({ name: "@jeger-ai/opengantry", version: "4.0.0", dependencies: deps });
  const iii = (local: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    lock({
      "": { name: "example", version: "1.0.0", dependencies: { "@jeger-ai/opengantry": "file:../..", a: "^1.0.0" } },
      "../..": local,
      "node_modules/@jeger-ai/opengantry": { resolved: "../..", link: true },
      "node_modules/a": reg("a", "1.0.0"),
      ...extra,
    });
  const before = iii(root({ commander: "^15.0.0" }));
  assert.equal(lockfileUpdateProblem(before, iii(root({ commander: "^15.0.0", sigstore: "^5.0.0" })), NPM), null, "the repository's own package.json changed");
  assert.match(lockfileUpdateProblem(before, iii(root({}), { "../other": root({}) }), NPM) ?? "", /\.\.\/other: a new local package/);
  assert.match(lockfileUpdateProblem(before, iii({ ...root({}), resolved: "https://evil.example/x.tgz" }), NPM) ?? "", /\.\.\/\.\.: a local package that now links or resolves elsewhere/);
  assert.match(
    lockfileUpdateProblem(before, iii(root({}), { "node_modules/@jeger-ai/opengantry": { resolved: "../../elsewhere", link: true } }), NPM) ?? "",
    /a new or changed link to a local package/,
  );
  assert.match(lockfileUpdateProblem(before, iii(root({}), { "../../node_modules/z": { version: "1.0.0", resolved: "https://evil.example/z.tgz", integrity: "x" } }), NPM) ?? "", /resolves outside the allowed registries/, "an install location under a local folder is judged like any other");
});

test("trusted automation: when no rule allows a change, every rule's reason is reported (MSN-0351)", () => {
  const rules = parseTrustedAutomationRules({
    trusted_automation: {
      rules: [
        { id: "deps", allowed_actors: ["bot@x"], allowed_paths: ["**/package.json"], allowed_structural_changes: ["dependency_update"], max_net_loc: 20 },
        { id: "pins", allowed_actors: ["bot@x"], allowed_paths: [".github/workflows/**"], allowed_structural_changes: ["workflow_version_pin"], max_net_loc: 5 },
      ],
    },
  });
  const verdict = evaluateTrustedAutomation(rules, { files: ["package.json"], actorEmail: "bot@x", netLoc: 4, structural: (r) => ({ ok: false, reason: `rule ${r.id}: no` }) }, "fallback");
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reason, "rule deps: no; path package.json outside rule pins allowed_paths");
});
