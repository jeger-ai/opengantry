import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPROVAL_REFS,
  DependencyPolicyError,
  canonicalRegistry,
  dependencyPolicyRevision,
  mergeDependencyPolicy,
  parseDependencyPolicy,
  type DependencyPolicy,
} from "../src/dependency-policy.js";
import { NPM_GRAPH_LIMITS } from "../src/dependency-graph.js";

const DIGEST = "a".repeat(64);

const minimal = (extra: Record<string, unknown> = {}) => ({
  schema: "opengantry.dependency-policy.v1",
  mode: "enforce",
  ecosystems: { npm: { lockfile_versions: [2, 3], npm_version: "11.6.2" } },
  registries: ["https://registry.npmjs.org/"],
  ...extra,
});

function refused(raw: unknown, detail: RegExp): void {
  assert.throws(() => parseDependencyPolicy(raw), (e: unknown) => e instanceof DependencyPolicyError && detail.test(e.message));
}

test("dependency policy: a minimal section parses with fail-closed defaults (MSN-0382)", () => {
  const p = parseDependencyPolicy(minimal());
  assert.equal(p.schema, "opengantry.dependency-policy.v1");
  assert.equal(p.mode, "enforce");
  assert.deepEqual(p.npm, { lockfileVersions: [2, 3], npmVersion: "11.6.2" });
  assert.deepEqual(p.registries, ["https://registry.npmjs.org/"]);
  assert.equal(p.approvedBaselineDigest, null);
  assert.deepEqual(p.approvalRefs, DEFAULT_APPROVAL_REFS);
  assert.equal(p.lifecycle, "deny", "lifecycle scripts are denied unless the policy says allow-approved");
  assert.deepEqual(p.sources, { git: "hold", url: "hold", fileOutsideWorkspaces: "hold", bundled: "hold" });
  assert.deepEqual(p.limits, NPM_GRAPH_LIMITS);
});

test("dependency policy: every documented field is read (MSN-0382)", () => {
  const p = parseDependencyPolicy(
    minimal({
      mode: "audit",
      approved_baseline_digest: DIGEST,
      approval_refs: ["approvals/deps/"],
      lifecycle: { default: "allow-approved" },
      sources: { git: "hold", url: "hold", file_outside_workspaces: "hold", bundled: "hold" },
      limits: { max_lockfile_bytes: 1024, max_nodes: 10, max_depth: 4 },
    }),
  );
  assert.equal(p.mode, "audit");
  assert.equal(p.approvedBaselineDigest, DIGEST);
  assert.deepEqual(p.approvalRefs, ["approvals/deps/"]);
  assert.equal(p.lifecycle, "allow-approved");
  assert.deepEqual(p.limits, { maxLockfileBytes: 1024, maxNodes: 10, maxDepth: 4 });
});

test("dependency policy: unknown keys, wrong types, other schemas and aliases are refused (MSN-0382)", () => {
  refused("x", /must be a mapping/);
  refused(minimal({ extra: 1 }), /unknown key "extra"/);
  refused(minimal({ schema: "opengantry.dependency-policy.v2" }), /schema must be opengantry\.dependency-policy\.v1/);
  refused(minimal({ mode: "warn" }), /mode must be audit or enforce/);
  refused({ ...minimal(), mode: undefined }, /mode must be audit or enforce/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [2, 3], npm_version: "11.6.2" }, pip: {} } }), /ecosystems: unknown key "pip"/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [1, 3], npm_version: "11.6.2" } } }), /lockfile_versions/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [], npm_version: "11.6.2" } } }), /lockfile_versions/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [3, 3], npm_version: "11.6.2" } } }), /lockfile_versions/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [3], npm_version: "^11.6.2" } } }), /npm_version must be an exact 11\.x version/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [3], npm_version: "10.9.0" } } }), /npm_version must be an exact 11\.x version/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [3], npm_version: 11 } } }), /npm_version must be an exact 11\.x version/);
  refused(minimal({ ecosystems: { npm: { lockfile_versions: [3] } } }), /npm_version must be an exact 11\.x version/);
  refused(minimal({ registries: "https://registry.npmjs.org/" }), /registries must be a list/);
  refused(minimal({ approved_baseline_digest: "abc" }), /approved_baseline_digest must be a sha256/);
  refused(minimal({ approval_refs: ["/abs/"] }), /approval_refs\[0\]/);
  refused(minimal({ approval_refs: ["../up/"] }), /approval_refs\[0\]/);
  refused(minimal({ approval_refs: ["no-trailing-slash"] }), /approval_refs\[0\]/);
  refused(minimal({ lifecycle: { default: "allow" } }), /lifecycle\.default must be deny or allow-approved/);
  refused(minimal({ lifecycle: { default: "deny", allow: [] } }), /lifecycle: unknown key "allow"/);
  refused(minimal({ sources: { git: "allow" } }), /sources\.git must be hold/);
  refused(minimal({ sources: { link: "hold" } }), /sources: unknown key "link"/);
  refused(minimal({ limits: { max_nodes: "10" } }), /limits\.max_nodes must be a positive integer/);
  refused(minimal({ limits: { max_nodes: 0 } }), /limits\.max_nodes must be a positive integer/);
});

test("dependency policy: limits can only be lowered below the parser bounds (MSN-0382)", () => {
  refused(minimal({ limits: { max_nodes: NPM_GRAPH_LIMITS.maxNodes + 1 } }), /limits\.max_nodes must be at most 10000/);
  refused(minimal({ limits: { max_depth: 33 } }), /limits\.max_depth must be at most 32/);
  refused(minimal({ limits: { max_lockfile_bytes: NPM_GRAPH_LIMITS.maxLockfileBytes + 1 } }), /max_lockfile_bytes must be at most/);
});

test("dependency policy: registries are canonical bases, never prefixes; credentials, queries and plain http refuse (MSN-0382)", () => {
  assert.equal(canonicalRegistry("https://registry.npmjs.org"), "https://registry.npmjs.org/");
  assert.equal(canonicalRegistry("https://REGISTRY.npmjs.org:443/"), "https://registry.npmjs.org/");
  assert.equal(canonicalRegistry("https://npm.corp.example/repo"), "https://npm.corp.example/repo/");
  assert.notEqual(canonicalRegistry("https://registry.npmjs.org.evil.example/"), canonicalRegistry("https://registry.npmjs.org/"));
  for (const [bad, why] of [
    ["https://user:pw@registry.npmjs.org/", /credentials/],
    ["https://token@registry.npmjs.org/", /credentials/],
    ["https://registry.npmjs.org/?a=1", /query or fragment/],
    ["https://registry.npmjs.org/#x", /query or fragment/],
    ["http://registry.npmjs.org/", /https/],
    ["file:///tmp/registry/", /https/],
    ["registry.npmjs.org", /not a URL/],
  ] as const) {
    assert.throws(() => canonicalRegistry(bad), (e: unknown) => e instanceof DependencyPolicyError && why.test(e.message), bad);
  }
  refused(minimal({ registries: ["https://user:pw@registry.npmjs.org/"] }), /registries\[0\].*credentials/);
  const p = parseDependencyPolicy(minimal({ registries: ["https://registry.npmjs.org", "https://registry.npmjs.org/"] }));
  assert.deepEqual(p.registries, ["https://registry.npmjs.org/"], "duplicates collapse after canonicalization");
});

test("dependency policy: the revision is the sha256 of the normalized section and ignores spelling (MSN-0382)", () => {
  const a = parseDependencyPolicy(minimal({ registries: ["https://registry.npmjs.org"] }));
  const b = parseDependencyPolicy(minimal({ registries: ["https://registry.npmjs.org/"], lifecycle: { default: "deny" } }));
  assert.match(dependencyPolicyRevision(a), /^[0-9a-f]{64}$/);
  assert.equal(dependencyPolicyRevision(a), dependencyPolicyRevision(b));
  const c = parseDependencyPolicy(minimal({ approved_baseline_digest: DIGEST }));
  assert.notEqual(dependencyPolicyRevision(a), dependencyPolicyRevision(c), "a new baseline is a new policy revision");
});

const floor = (extra: Record<string, unknown> = {}): DependencyPolicy =>
  parseDependencyPolicy(
    minimal({
      mode: "audit",
      registries: ["https://registry.npmjs.org/", "https://npm.corp.example/repo/"],
      lifecycle: { default: "allow-approved" },
      limits: { max_nodes: 500 },
      ...extra,
    }),
  );

test("dependency policy: merging is tighten-only (MSN-0382)", () => {
  const local = parseDependencyPolicy(
    minimal({
      mode: "audit",
      ecosystems: { npm: { lockfile_versions: [3], npm_version: "11.6.2" } },
      registries: ["https://registry.npmjs.org/", "https://registry.npmjs.org.evil.example/"],
      lifecycle: { default: "allow-approved" },
      limits: { max_nodes: 9000, max_depth: 8 },
    }),
  );
  const m = mergeDependencyPolicy(floor({ mode: "enforce" }), local)!;
  assert.equal(m.mode, "enforce", "enforce wins over audit");
  assert.deepEqual(m.registries, ["https://registry.npmjs.org/"], "registries are intersected");
  assert.deepEqual(m.npm.lockfileVersions, [3], "lockfile versions are intersected");
  assert.equal(m.limits.maxNodes, 500, "the lower limit wins");
  assert.equal(m.limits.maxDepth, 8, "the lower limit wins");
  assert.equal(m.lifecycle, "allow-approved");
  const denied = mergeDependencyPolicy(floor(), parseDependencyPolicy(minimal({ lifecycle: { default: "deny" } })))!;
  assert.equal(denied.lifecycle, "deny", "deny wins over allow-approved");
  const looser = mergeDependencyPolicy(floor({ mode: "enforce", lifecycle: { default: "deny" } }), local)!;
  assert.equal(looser.mode, "enforce", "a local audit cannot loosen an enforcing floor");
  assert.equal(looser.lifecycle, "deny", "a local allow-approved cannot loosen a deny floor");
});

test("dependency policy: a merge cannot add a registry, a baseline or an approval location the floor does not allow (MSN-0382)", () => {
  const extraRegistry = parseDependencyPolicy(minimal({ registries: ["https://registry.yarnpkg.com/"] }));
  assert.deepEqual(mergeDependencyPolicy(floor(), extraRegistry)!.registries, [], "a registry outside the floor is dropped, not added");
  const withBaseline = floor({ approved_baseline_digest: DIGEST });
  const other = parseDependencyPolicy(minimal({ approved_baseline_digest: "b".repeat(64) }));
  assert.throws(() => mergeDependencyPolicy(withBaseline, other), /approved_baseline_digest differs from the floor/);
  assert.equal(mergeDependencyPolicy(withBaseline, parseDependencyPolicy(minimal()))!.approvedBaselineDigest, null, "dropping the baseline is tighter");
  // Review round (PR #366, finding 2): this line used to assert that the merge returned the added digest, the bug
  // the title forbids. A local baseline the floor does not name is refused, also when there is no floor at all.
  const added = parseDependencyPolicy(minimal({ approved_baseline_digest: DIGEST }));
  assert.throws(() => mergeDependencyPolicy(floor(), added), /the floor names no baseline; a local section cannot add one/);
  assert.throws(() => mergeDependencyPolicy(null, added), /the floor names no baseline; a local section cannot add one/);
  const refs = mergeDependencyPolicy(floor({ approval_refs: ["a/", "b/"] }), parseDependencyPolicy(minimal({ approval_refs: ["b/", "c/"] })))!;
  assert.deepEqual(refs.approvalRefs, ["b/"], "approval locations are intersected");
  const pin = parseDependencyPolicy(minimal({ ecosystems: { npm: { lockfile_versions: [3], npm_version: "11.7.0" } } }));
  assert.throws(() => mergeDependencyPolicy(floor(), pin), /npm_version differs from the floor/);
});

test("dependency policy: a missing side inherits the other; nothing on both sides is no section (MSN-0382)", () => {
  const f = floor();
  assert.equal(mergeDependencyPolicy(null, null), null);
  assert.deepEqual(mergeDependencyPolicy(f, null), f, "a task contract without the section inherits the floor");
  assert.deepEqual(mergeDependencyPolicy(null, f), f);
});
