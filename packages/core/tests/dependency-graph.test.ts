import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffNpmGraphs, nodeIdentity, parseNpmLockfile, type NpmGraph, type NpmGraphResult } from "../src/dependency-graph.js";

type Packages = Record<string, unknown>;

const REG = "https://registry.npmjs.org/";
const reg = (name: string, version: string, extra: Record<string, unknown> = {}) => ({
  version,
  resolved: `${REG}${name}/-/${name.slice(name.indexOf("/") + 1)}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
  ...extra,
});
const lockText = (packages: Packages, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages, ...extra });

function graph(result: NpmGraphResult): NpmGraph {
  assert.equal(result.status, "ok", result.status === "hold" ? `${result.code}: ${result.detail}` : "");
  return (result as { graph: NpmGraph }).graph;
}

function hold(result: NpmGraphResult, code: string, detail?: RegExp): void {
  assert.equal(result.status, "hold");
  if (result.status !== "hold") return;
  assert.equal(result.code, code, result.detail);
  if (detail) assert.match(result.detail, detail);
}

const node = (g: NpmGraph, location: string) => g.nodes.find((n) => n.location === location)!;

const BASE: Packages = {
  "": { name: "app", version: "1.0.0", dependencies: { a: "^1.0.0" }, devDependencies: { d: "^1.0.0" } },
  "node_modules/a": reg("a", "1.0.0", { dependencies: { t: "^2.0.0" } }),
  "node_modules/t": reg("t", "2.0.0"),
  "node_modules/d": reg("d", "1.0.0", { dev: true }),
};

test("dependency graph: direct and transitive registry nodes with identity, source and integrity (MSN-0378)", () => {
  const g = graph(parseNpmLockfile(lockText(BASE)));
  assert.equal(g.schema, "opengantry.npm-dependency-graph.v1");
  assert.equal(g.lockfileVersion, 3);
  assert.deepEqual(g.nodes.map((n) => n.location), ["node_modules/a", "node_modules/d", "node_modules/t"]);
  const a = node(g, "node_modules/a");
  assert.deepEqual(a.source, { kind: "registry", ref: REG, credentials: false });
  assert.equal(a.integrity, "sha512-a-1.0.0");
  assert.equal(a.direct, true);
  assert.deepEqual(a.edges, { dependencies: { t: "^2.0.0" } });
  assert.equal(node(g, "node_modules/t").direct, false, "transitive");
  assert.deepEqual(node(g, "node_modules/d").flags, ["dev"]);
  assert.match(g.digest, /^[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(BASE).reverse());
  assert.equal(graph(parseNpmLockfile(lockText(reordered))).digest, g.digest, "digest does not depend on key order");
});

test("dependency graph: an npm alias keeps the installed name apart from the resolved identity (MSN-0378)", () => {
  const packages = { ...BASE, "": { name: "app", dependencies: { a: "^1.0.0", lodash: "npm:evil-lodash@1.0.0" } }, "node_modules/lodash": reg("evil-lodash", "1.0.0", { name: "evil-lodash" }) };
  const g = graph(parseNpmLockfile(lockText(packages)));
  const n = node(g, "node_modules/lodash");
  assert.equal(n.name, "evil-lodash");
  assert.equal(n.alias, "lodash");
  assert.equal(n.direct, true, "declared under its alias");
  assert.match(nodeIdentity(n), /^evil-lodash@1\.0\.0 registry:/);

  const honest = graph(parseNpmLockfile(lockText({ ...packages, "node_modules/lodash": reg("lodash", "1.0.0") })));
  const change = diffNpmGraphs(honest, g).changes.find((c) => c.location === "node_modules/lodash")!;
  assert.equal(change.change, "updated");
  assert.ok(change.fields.includes("name") && change.fields.includes("alias"), change.fields.join(","));
});

test("dependency graph: git, URL, file and custom-registry sources are told apart; credentials never enter the graph (MSN-0378)", () => {
  const packages: Packages = {
    "": { name: "app", dependencies: { g: "github:o/g", u: "https://x", f: "file:vendor/f.tgz", "@s/x": "^1.0.0" } },
    "node_modules/g": { version: "1.0.0", resolved: "git+ssh://git@github.com/o/g.git#0123456789abcdef0123456789abcdef01234567" },
    "node_modules/u": { version: "1.0.0", resolved: "https://user:s3cret@files.example/u.tgz", integrity: "sha512-u" },
    "node_modules/f": { version: "1.0.0", resolved: "file:vendor/f.tgz", integrity: "sha512-f" },
    "node_modules/@s/x": { version: "1.0.0", resolved: "https://npm.corp.example/repo/@s%2fx/-/x-1.0.0.tgz", integrity: "sha512-x" },
    "node_modules/nr": { version: "1.0.0" },
  };
  const g = graph(parseNpmLockfile(lockText(packages)));
  assert.deepEqual(node(g, "node_modules/g").source, { kind: "git", ref: "git+ssh://git@github.com/o/g.git#0123456789abcdef0123456789abcdef01234567", credentials: false });
  assert.equal(node(g, "node_modules/g").integrity, null, "git dependencies carry no integrity");
  assert.deepEqual(node(g, "node_modules/u").source, { kind: "url", ref: "https://files.example/u.tgz", credentials: true });
  assert.equal(node(g, "node_modules/f").source.kind, "file");
  assert.deepEqual(node(g, "node_modules/@s/x").source, { kind: "registry", ref: "https://npm.corp.example/repo/", credentials: false });
  assert.equal(node(g, "node_modules/nr").source.kind, "unresolved");
  assert.doesNotMatch(JSON.stringify(g), /s3cret/);

  const lookalike = graph(parseNpmLockfile(lockText({ "": {}, "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org.evil.example/a/-/a-1.0.0.tgz?x=1", integrity: "sha512-a" } })));
  assert.equal(node(lookalike, "node_modules/a").source.kind, "url", "a query string is not a registry tarball");
  const otherHost = graph(parseNpmLockfile(lockText({ "": {}, "node_modules/a": { version: "1.0.0", resolved: "https://registry.npmjs.org.evil.example/a/-/a-1.0.0.tgz", integrity: "sha512-a" } })));
  assert.equal(node(otherHost, "node_modules/a").source.ref, "https://registry.npmjs.org.evil.example/", "the canonical origin, not a prefix");
});

test("dependency graph: missing integrity stays null and shows as an integrity change (MSN-0378)", () => {
  const before = graph(parseNpmLockfile(lockText(BASE)));
  const { integrity: _dropped, ...noIntegrity } = reg("t", "2.0.0");
  const after = graph(parseNpmLockfile(lockText({ ...BASE, "node_modules/t": noIntegrity })));
  assert.equal(node(after, "node_modules/t").integrity, null);
  assert.deepEqual(diffNpmGraphs(before, after).changes.map((c) => [c.location, c.fields]), [["node_modules/t", ["integrity"]]]);
});

test("dependency graph: workspaces, workspace links, hoisted workspace dependencies and local folders (MSN-0378)", () => {
  const packages: Packages = {
    "": { name: "mono", workspaces: ["packages/*"], dependencies: { outside: "file:../outside" } },
    "packages/a": { name: "@mono/a", version: "0.1.0", dependencies: { w: "^1.0.0" } },
    "node_modules/@mono/a": { resolved: "packages/a", link: true },
    "node_modules/w": reg("w", "1.0.0"),
    "packages/a/node_modules/n": reg("n", "1.0.0"),
    "../outside": { version: "1.0.0" },
    "node_modules/outside": { resolved: "../outside", link: true },
    "../outside/node_modules/inner": { version: "2.0.0", dev: true },
  };
  const g = graph(parseNpmLockfile(lockText(packages)));
  assert.deepEqual(g.root.workspaces, ["packages/*"]);
  assert.deepEqual(node(g, "packages/a").source, { kind: "workspace", ref: "packages/a", credentials: false });
  assert.deepEqual(node(g, "node_modules/@mono/a").source, { kind: "link", ref: "packages/a", credentials: false });
  assert.equal(node(g, "node_modules/w").direct, true, "hoisted, declared by a workspace");
  assert.equal(node(g, "packages/a/node_modules/n").direct, false, "not declared by its workspace");
  assert.deepEqual(node(g, "../outside").source, { kind: "local", ref: "../outside", credentials: false });
  assert.equal(node(g, "node_modules/outside").direct, true);
  assert.deepEqual(node(g, "../outside/node_modules/inner").source, { kind: "external", ref: "../outside/node_modules/inner", credentials: false });
  assert.equal(node(g, "../outside/node_modules/inner").direct, false);
});

test("dependency graph: this repository's own lockfiles parse without a hold (npm format canary, MSN-0378)", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  for (const dir of [".", "examples/iii-integration"]) {
    const read = (f: string) => readFileSync(join(root, dir, f), "utf8");
    const g = graph(parseNpmLockfile(read("package-lock.json"), { manifest: read("package.json") }));
    assert.equal(g.lockfileVersion, 3, dir);
    assert.ok(g.nodes.some((n) => n.direct && n.source.kind === "registry"), dir);
    assert.ok(!g.nodes.some((n) => n.source.kind === "unresolved"), `${dir}: every installed node resolves`);
  }
});

test("dependency graph: lifecycle scripts from the root manifest and hasInstallScript, and what a diff reports (MSN-0378)", () => {
  const manifest = (scripts: Record<string, string>) => JSON.stringify({ name: "app", scripts });
  const before = graph(parseNpmLockfile(lockText(BASE), { manifest: manifest({ test: "node --test" }) }));
  assert.deepEqual(before.root.lifecycleScripts, {});
  assert.equal(graph(parseNpmLockfile(lockText(BASE))).root.lifecycleScripts, null, "no manifest given");

  const after = graph(
    parseNpmLockfile(lockText({ ...BASE, "node_modules/t": reg("t", "2.0.0", { hasInstallScript: true }) }), {
      manifest: manifest({ test: "node --test", postinstall: "node evil.js" }),
    }),
  );
  assert.deepEqual(after.root.lifecycleScripts, { postinstall: "node evil.js" });
  const diff = diffNpmGraphs(before, after);
  assert.deepEqual(diff.root, ["lifecycleScripts"]);
  assert.deepEqual(diff.newInstallScripts, ["node_modules/t"]);
  assert.deepEqual(diff.changes.map((c) => [c.location, c.fields]), [["node_modules/t", ["installScript"]]]);
});

test("dependency graph: diff separates direct additions, transitive additions, updates, removals and hoisting moves (MSN-0378)", () => {
  const before = graph(parseNpmLockfile(lockText(BASE)));
  const after = graph(
    parseNpmLockfile(
      lockText({
        "": { name: "app", version: "1.0.0", dependencies: { a: "^1.1.0", b: "^1.0.0" } },
        "node_modules/a": reg("a", "1.1.0", { dependencies: { t: "^2.0.0" } }),
        "node_modules/a/node_modules/t": reg("t", "2.0.0"),
        "node_modules/b": reg("b", "1.0.0", { dependencies: { c: "^1.0.0" } }),
        "node_modules/c": reg("c", "1.0.0"),
      }),
    ),
  );
  const diff = diffNpmGraphs(before, after);
  assert.equal(diff.schema, "opengantry.npm-dependency-graph-diff.v1");
  assert.deepEqual(
    diff.changes.map((c) => [c.change, c.location, c.direct]),
    [
      ["updated", "node_modules/a", true],
      ["added", "node_modules/a/node_modules/t", false],
      ["added", "node_modules/b", true],
      ["added", "node_modules/c", false],
      ["removed", "node_modules/d", true],
      ["removed", "node_modules/t", false],
    ],
  );
  assert.deepEqual(diff.root, ["edges"]);
  assert.deepEqual(
    diff.newIdentities.map((id) => id.split(" ")[0]),
    ["a@1.1.0", "b@1.0.0", "c@1.0.0"],
    "t moved under a but its identity is not new",
  );
  assert.equal(diffNpmGraphs(before, before).changes.length, 0);
});

test("dependency graph: a lockfileVersion 2 legacy tree that agrees passes, one that disagrees holds (MSN-0378)", () => {
  const legacy = { a: { version: "1.0.0", resolved: BASE["node_modules/a"] && `${REG}a/-/a-1.0.0.tgz`, integrity: "sha512-a-1.0.0" }, t: { version: "2.0.0" }, d: { version: "1.0.0", dev: true } };
  assert.equal(parseNpmLockfile(lockText(BASE, { lockfileVersion: 2, dependencies: legacy })).status, "ok");
  hold(parseNpmLockfile(lockText(BASE, { lockfileVersion: 2, dependencies: { ...legacy, t: { version: "2.0.0", resolved: "https://evil.example/t.tgz" } } })), "inconsistent_lockfile", /resolved/);
  hold(parseNpmLockfile(lockText(BASE, { lockfileVersion: 2, dependencies: { ...legacy, t: { version: "9.9.9" } } })), "inconsistent_lockfile", /version/);
  hold(parseNpmLockfile(lockText(BASE, { lockfileVersion: 2, dependencies: { ...legacy, ghost: { version: "1.0.0" } } })), "inconsistent_lockfile", /no packages entry/);
  hold(parseNpmLockfile(lockText(BASE, { dependencies: legacy })), "lossy_entry", /lockfileVersion 3 with a legacy/);
});

test("dependency graph: malformed, unsupported and lossy lockfiles hold explicitly (MSN-0378)", () => {
  hold(parseNpmLockfile("{ not json"), "malformed_json");
  hold(parseNpmLockfile("[]"), "unsupported_lockfile");
  hold(parseNpmLockfile(lockText(BASE, { lockfileVersion: 1 })), "unsupported_lockfile", /lockfileVersion 1/);
  hold(parseNpmLockfile(JSON.stringify({ lockfileVersion: 3 })), "unsupported_lockfile", /root entry/);
  hold(parseNpmLockfile(lockText(BASE, { overrides: {} })), "lossy_entry", /unknown top-level field overrides/);
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/t": reg("t", "2.0.0", { scripts: { postinstall: "x" } }) })), "lossy_entry", /unknown field scripts/);
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/t": reg("t", "2.0.0", { integrity: 1 }) })), "lossy_entry", /integrity is not a string/);
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/t": reg("t", "2.0.0", { hasInstallScript: "yes" }) })), "lossy_entry", /hasInstallScript/);
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/t": reg("t", "2.0.0", { dependencies: { x: 1 } }) })), "lossy_entry", /dependencies/);
  hold(parseNpmLockfile(lockText({ ...BASE, "": { name: "app", bogus: true } })), "lossy_entry", /unknown field bogus/);
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/": reg("x", "1.0.0") })), "lossy_entry");
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/@s": reg("x", "1.0.0") })), "lossy_entry", /package name/);
  hold(parseNpmLockfile(lockText({ ...BASE, "/abs/node_modules/x": reg("x", "1.0.0") })), "lossy_entry", /relative/);
  hold(parseNpmLockfile(lockText({ ...BASE, "node_modules/x": { version: "1.0.0", resolved: "not a url" } })), "lossy_entry", /resolved/);
  hold(parseNpmLockfile(lockText(BASE), { manifest: JSON.stringify({ scripts: { postinstall: 1 } }) }), "lossy_entry", /scripts.postinstall/);
});

test("dependency graph: oversized, too large and too deep lockfiles hold within the bounds (MSN-0378)", () => {
  const big = lockText({ ...BASE, "node_modules/pad": reg("pad", "1.0.0", { license: "x".repeat(20 * 1024 * 1024) }) });
  hold(parseNpmLockfile(big), "lockfile_too_large", /20971520 bytes/);

  const many: Packages = { "": {} };
  for (let i = 0; i <= 10_000; i += 1) many[`node_modules/p${i}`] = reg(`p${i}`, "1.0.0");
  hold(parseNpmLockfile(lockText(many)), "too_many_nodes", /10000/);
  delete many["node_modules/p0"];
  assert.equal(parseNpmLockfile(lockText(many)).status, "ok", "exactly 10,000 nodes is within the bound");

  const deep = `${"node_modules/x/".repeat(33)}node_modules/x`;
  hold(parseNpmLockfile(lockText({ "": {}, [deep]: reg("x", "1.0.0") })), "too_deep", /32/);
  hold(parseNpmLockfile(lockText(BASE), { limits: { maxNodes: 2 } }), "too_many_nodes");

  let tree: Record<string, unknown> = { version: "1.0.0" };
  for (let i = 0; i < 40; i += 1) tree = { version: "1.0.0", dependencies: { x: tree } };
  // The legacy walk is bounded too: it stops at the first level packages does not have.
  hold(parseNpmLockfile(lockText({ "": {}, "node_modules/x": reg("x", "1.0.0") }, { lockfileVersion: 2, dependencies: { x: tree } })), "inconsistent_lockfile");
});
