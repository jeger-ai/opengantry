import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  boundedEnvironmentProblem,
  checkIntegrity,
  fetchUrlProblem,
  layoutFindings,
  planFetches,
  redirectProblem,
  tarballFindings,
  type InstallFetch,
  type LayoutListing,
} from "../src/dependency-install.js";
import { parseNpmLockfile, type NpmGraph } from "../src/dependency-graph.js";
import { inspectNpmTarball, type TarballContents } from "../src/dependency-tarball.js";
import { dependencyInstallProblem } from "../src/schemas/dependency-install-schema.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";

/** Issue #355 slice 4 (MSN-0387): the pure half of `gantry npm ci`. */

const REG = "https://registry.npmjs.org/";

// --- a minimal ustar writer, so the tests can build hostile archives -------------------------------------------

interface Entry {
  path: string;
  body?: string;
  type?: string;
  prefix?: string;
}

function header(name: string, size: number, type: string, prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100, "latin1");
  h.write("0000000\0", 108, "latin1");
  h.write("0000000\0", 116, "latin1");
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write(type, 156, "latin1");
  h.write("ustar\0", 257, "latin1");
  h.write("00", 263, "latin1");
  h.write(prefix, 345, 155, "utf8");
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return h;
}

function tgz(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? "");
    parts.push(header(e.path, body.length, e.type ?? "0", e.prefix), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

const pkgJson = (m: Record<string, unknown>) => JSON.stringify({ name: "a", version: "1.0.0", ...m });
const pack = (m: Record<string, unknown> = {}, extra: Entry[] = []) => tgz([{ path: "package/package.json", body: pkgJson(m) }, { path: "package/index.js", body: "" }, ...extra]);

function contents(buf: Buffer): TarballContents {
  const r = inspectNpmTarball(buf);
  assert.ok(r.ok, r.ok ? "" : r.detail);
  return r.contents;
}

// --- tarball ---------------------------------------------------------------------------------------------------

test("a tarball is read without unpacking: manifest, binding.gyp, shrinkwrap and bundled node_modules", () => {
  const c = contents(pack({}, [{ path: "package/binding.gyp", body: "{}" }, { path: "package/npm-shrinkwrap.json", body: "{}" }, { path: "package/node_modules/x/index.js", body: "" }]));
  assert.equal(JSON.parse(c.manifest).name, "a");
  assert.deepEqual([c.bindingGyp, c.shrinkwrap, c.nodeModules], [true, true, true]);
  const plain = contents(pack());
  assert.deepEqual([plain.bindingGyp, plain.shrinkwrap, plain.nodeModules], [false, false, false]);
  // The top folder need not be named "package" (npm strips the first component), and pax and ustar prefixes count.
  assert.ok(inspectNpmTarball(tgz([{ path: "other/package.json", body: pkgJson({}) }])).ok);
  const pax = tgz([{ path: "PaxHeader", type: "x", body: "28 path=package/binding.gyp\n" }, { path: "ignored", body: "{}" }, { path: "package/package.json", body: pkgJson({}) }]);
  assert.equal(contents(pax).bindingGyp, true);
  assert.equal(contents(tgz([{ path: "package.json", prefix: "package", body: pkgJson({}) }])).manifest, pkgJson({}));
});

test("a malformed or ambiguous tarball is refused, never guessed", () => {
  const refused = (buf: Buffer, re: RegExp) => {
    const r = inspectNpmTarball(buf);
    assert.equal(r.ok, false);
    assert.match((r as { detail: string }).detail, re);
  };
  refused(tgz([{ path: "package/../../etc/x", body: "" }, { path: "package/package.json", body: pkgJson({}) }]), /leaves the package folder/);
  refused(tgz([{ path: "/abs/package.json", body: pkgJson({}) }]), /leaves the package folder/);
  refused(tgz([{ path: "package/package.json", body: pkgJson({}) }, { path: "other/package.json", body: pkgJson({}) }]), /more than one top folder/);
  refused(tgz([{ path: "package/package.json", body: pkgJson({}) }, { path: "package/package.json", body: pkgJson({ version: "2.0.0" }) }]), /appears twice/);
  refused(tgz([{ path: "package/index.js", body: "" }]), /no package.json/);
  refused(tgz([{ path: "package/dev", type: "3" }, { path: "package/package.json", body: pkgJson({}) }]), /unsupported type/);
  refused(Buffer.from("not gzip"), /gzip/);
  const broken = gzipSync(Buffer.concat([header("package/package.json", 5, "0").fill(0x31, 0, 1), Buffer.alloc(1536)]));
  refused(broken, /checksum/);
});

test("tarball limits bound the work", () => {
  const r = inspectNpmTarball(pack(), { maxCompressedBytes: 10, maxUnpackedBytes: 1 << 20, maxEntries: 10, maxManifestBytes: 1 << 20 });
  assert.equal(r.ok, false);
  const many = tgz([{ path: "package/package.json", body: pkgJson({}) }, ...Array.from({ length: 5 }, (_, i) => ({ path: `package/f${String(i)}`, body: "" }))]);
  assert.equal(inspectNpmTarball(many, { maxCompressedBytes: 1 << 20, maxUnpackedBytes: 1 << 20, maxEntries: 3, maxManifestBytes: 1 << 20 }).ok, false);
  const bomb = gzipSync(Buffer.alloc(4 << 20));
  assert.equal(inspectNpmTarball(bomb, { maxCompressedBytes: 1 << 20, maxUnpackedBytes: 1 << 20, maxEntries: 10, maxManifestBytes: 1 << 20 }).ok, false);
});

// --- integrity -------------------------------------------------------------------------------------------------

test("integrity: every strong hash must match; sha1-only is weak; nothing readable is invalid", () => {
  const bytes = Buffer.from("tarball");
  const b64 = (alg: string, b: Buffer) => createHash(alg).update(b).digest("base64");
  assert.equal(checkIntegrity(`sha512-${b64("sha512", bytes)}`, bytes).status, "match");
  assert.equal(checkIntegrity(`sha256-${b64("sha256", bytes)} sha1-${b64("sha1", bytes)}`, bytes).status, "match");
  assert.equal(checkIntegrity(`sha512-${b64("sha512", Buffer.from("other"))}`, bytes).status, "mismatch");
  assert.equal(checkIntegrity(`sha512-${b64("sha512", bytes)} sha256-${b64("sha256", Buffer.from("other"))}`, bytes).status, "mismatch");
  assert.equal(checkIntegrity(`sha1-${b64("sha1", bytes)}`, bytes).status, "weak");
  assert.equal(checkIntegrity("sha512-", bytes).status, "invalid");
  assert.equal(checkIntegrity(null, bytes).status, "invalid");
});

// --- URLs ------------------------------------------------------------------------------------------------------

test("fetch URLs stay under a policy registry; redirects stay on a policy registry origin", () => {
  assert.equal(fetchUrlProblem(`${REG}a/-/a-1.0.0.tgz`, [REG]), null);
  assert.match(fetchUrlProblem("https://registry.npmjs.org.evil.example/a/-/a-1.0.0.tgz", [REG])!, /not under a policy registry/);
  assert.match(fetchUrlProblem("https://user:pw@registry.npmjs.org/a/-/a-1.0.0.tgz", [REG])!, /credentials/);
  assert.match(fetchUrlProblem("http://registry.npmjs.org/a/-/a-1.0.0.tgz", [REG])!, /https/);
  assert.match(fetchUrlProblem(`${REG}a/-/a-1.0.0.tgz?x=1`, [REG])!, /query/);
  assert.match(fetchUrlProblem("https://registry.example/mirror-other/a.tgz", ["https://registry.example/mirror/"])!, /not under/);

  const from = `${REG}a/-/a-1.0.0.tgz`;
  assert.equal(redirectProblem(from, "/a/-/a-1.0.0-copy.tgz", [REG]), null);
  assert.match(redirectProblem(from, "https://evil.example/a.tgz", [REG])!, /outside the policy registries/);
  assert.match(redirectProblem(from, "https://registry.npmjs.org:8443/a.tgz", [REG])!, /outside/);
  assert.match(redirectProblem(from, "http://registry.npmjs.org/a.tgz", [REG])!, /instead of https/);
  assert.match(redirectProblem(from, "https://u:p@registry.npmjs.org/a.tgz", [REG])!, /credentials/);
});

// --- plan ------------------------------------------------------------------------------------------------------

const lockOf = (pkgs: Record<string, unknown>, rootExtra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "app", version: "1.0.0", ...rootExtra }, ...pkgs } });
const entry = (name: string, version: string, extra: Record<string, unknown> = {}) => ({ version, resolved: `${REG}${name}/-/${name}-${version}.tgz`, integrity: `sha512-${name}`, ...extra });

function graphOf(lock: string, manifest?: string): NpmGraph {
  const r = parseNpmLockfile(lock, manifest ? { manifest } : {});
  assert.equal(r.status, "ok", r.status === "hold" ? r.detail : "");
  return (r as { graph: NpmGraph }).graph;
}

test("planFetches takes registry tarballs only; root lifecycle scripts and other sources refuse", () => {
  const lock = lockOf({ "node_modules/a": entry("a", "1.0.0", { hasInstallScript: true }), "node_modules/l": { resolved: "vendor/l", link: true }, "vendor/l": { name: "l", version: "1.0.0" } });
  const { fetches, reasons } = planFetches(graphOf(lock), lock, [REG]);
  assert.deepEqual(fetches, [{ location: "node_modules/a", name: "a", version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: "sha512-a", installScript: true }]);
  assert.deepEqual(reasons.map((r) => [r.code, r.location]).sort(), [["source_not_materializable", "node_modules/l"], ["source_not_materializable", "vendor/l"]]);

  const manifest = JSON.stringify({ name: "app", version: "1.0.0", scripts: { postinstall: "node evil.js" } });
  const withRoot = planFetches(graphOf(lockOf({}), manifest), lockOf({}), [REG]);
  assert.deepEqual(withRoot.reasons.map((r) => r.code), ["root_lifecycle_unsupported"]);

  const other = lockOf({ "node_modules/a": { ...entry("a", "1.0.0"), resolved: "https://evil.example/a/-/a-1.0.0.tgz" } });
  assert.deepEqual(planFetches(graphOf(other), other, [REG]).reasons.map((r) => r.code), ["fetch_refused"]);
});

// --- tarball against the lockfile ------------------------------------------------------------------------------

const fetchA: InstallFetch = { location: "node_modules/a", name: "a", version: "1.0.0", resolved: `${REG}a/-/a-1.0.0.tgz`, integrity: "sha512-a", installScript: false };
const nodeA = (installScript = false, extra: Record<string, unknown> = {}) => graphOf(lockOf({ "node_modules/a": entry("a", "1.0.0", { ...(installScript ? { hasInstallScript: true } : {}), ...extra }) })).nodes[0]!;

test("a tarball must agree with its lockfile node: identity, install scripts, bundles, shrinkwrap", () => {
  assert.deepEqual(tarballFindings(fetchA, nodeA(), contents(pack())).reasons, []);
  const codes = (c: TarballContents, installScript = false) => tarballFindings(fetchA, nodeA(installScript), c).reasons.map((r) => r.code);
  assert.deepEqual(codes(contents(pack({ version: "1.0.1" }))), ["tarball_identity_mismatch"]);
  assert.deepEqual(codes(contents(pack({ name: "evil-a" }))), ["tarball_identity_mismatch"]);
  // A script the lockfile did not declare, and a declared one the tarball does not have, both hold.
  assert.deepEqual(codes(contents(pack({ scripts: { postinstall: "node x.js" } }))), ["install_script_mismatch"]);
  assert.deepEqual(codes(contents(pack()), true), ["install_script_mismatch"]);
  // binding.gyp is npm's implicit `node-gyp rebuild`, unless gypfile is false or an install script exists.
  assert.deepEqual(codes(contents(pack({}, [{ path: "package/binding.gyp", body: "{}" }]))), ["install_script_mismatch"]);
  assert.deepEqual(codes(contents(pack({ gypfile: false }, [{ path: "package/binding.gyp", body: "{}" }]))), []);
  const declared = tarballFindings(fetchA, nodeA(true), contents(pack({ scripts: { postinstall: "x", preinstall: "y", test: "z" } })));
  assert.deepEqual([declared.reasons, declared.installScripts], [[], ["postinstall", "preinstall"]]);
  assert.deepEqual(codes(contents(pack({ bundleDependencies: ["x"] }))), ["tarball_bundled"]);
  assert.deepEqual(codes(contents(pack({}, [{ path: "package/node_modules/x/index.js", body: "" }]))), ["tarball_bundled"]);
  assert.deepEqual(codes(contents(pack({}, [{ path: "package/npm-shrinkwrap.json", body: "{}" }]))), ["tarball_shrinkwrap"]);
  assert.deepEqual(codes({ manifest: "[1]", bindingGyp: false, shrinkwrap: false, nodeModules: false, entries: 1 }), ["tarball_malformed"]);
});

// --- layout ----------------------------------------------------------------------------------------------------

test("the installed tree must be exactly the admitted graph", () => {
  const g = graphOf(
    lockOf({
      "node_modules/a": entry("a", "1.0.0"),
      "node_modules/a/node_modules/t": entry("t", "1.0.0"),
      "node_modules/fsevents": entry("fsevents", "2.3.3", { optional: true, os: ["darwin"] }),
    }),
  );
  const exact: LayoutListing = {
    packages: [
      { location: "node_modules/a", name: "a", version: "1.0.0", symlink: false },
      { location: "node_modules/a/node_modules/t", name: "t", version: "1.0.0", symlink: false },
    ],
    bins: [{ path: "node_modules/.bin/a", target: "node_modules/a/cli.js" }],
    other: [],
  };
  assert.deepEqual(layoutFindings(g, exact), { reasons: [], skipped: ["node_modules/fsevents"] });
  const codes = (l: Partial<LayoutListing>) => layoutFindings(g, { ...exact, ...l }).reasons.map((r) => r.code);
  assert.deepEqual(codes({ packages: [...exact.packages, { location: "node_modules/extra", name: "extra", version: "1.0.0", symlink: false }] }), ["layout_unexpected"]);
  assert.deepEqual(codes({ packages: exact.packages.slice(0, 1) }), ["layout_missing"]);
  assert.deepEqual(codes({ packages: [{ ...exact.packages[0]!, version: "1.0.1" }, exact.packages[1]!] }), ["layout_mismatch"]);
  assert.deepEqual(codes({ packages: [{ ...exact.packages[0]!, symlink: true }, exact.packages[1]!] }), ["layout_unexpected"]);
  assert.deepEqual(codes({ other: ["node_modules/.hooks"] }), ["layout_unexpected"]);
  assert.deepEqual(codes({ bins: [{ path: "node_modules/.bin/a", target: null }] }), ["bin_link_outside"]);
  assert.deepEqual(codes({ bins: [{ path: "node_modules/.bin/a", target: "src/evil.js" }] }), ["bin_link_outside"]);
  assert.deepEqual(codes({ bins: [{ path: "node_modules/.bin/a", target: "node_modules/.bin/b" }] }), ["bin_link_outside"]);
});

// --- bounded environment ---------------------------------------------------------------------------------------

test("no environment counts as bounded until the capability matrix records a proven prevention cell", () => {
  assert.match(boundedEnvironmentProblem(null)!, /no bounded environment/);
  for (const row of admissionCapabilityReport().rows.filter((r) => r.family === "dependency.materialize")) {
    assert.notEqual(boundedEnvironmentProblem({ capabilityId: row.capabilityId }), null, row.capabilityId);
  }
  assert.match(boundedEnvironmentProblem({ capabilityId: "ubuntu-26.04-x64/claude-code/process.spawn" })!, /not a dependency.materialize cell/);
  assert.match(boundedEnvironmentProblem({ capabilityId: "made-up/dependency.materialize" })!, /not a dependency.materialize cell/);
});

// --- receipt ---------------------------------------------------------------------------------------------------

test("the receipt schema is closed and cannot claim prevention", () => {
  const receipt = {
    schema: "opengantry.dependency-install.v1",
    outcome: "refused",
    enforcement: "enforce",
    prevention: false,
    preventive_capability: null,
    direct_installers_blocked: false,
    base: null,
    head: null,
    directory: ".",
    lockfile: null,
    inputs: null,
    npm: null,
    admission: null,
    packages: [],
    scripts: [],
    reasons: [{ code: "policy_missing", severity: "hold", location: null, detail: "x" }],
  };
  assert.equal(dependencyInstallProblem(receipt), null);
  assert.notEqual(dependencyInstallProblem({ ...receipt, prevention: true }), null);
  assert.notEqual(dependencyInstallProblem({ ...receipt, preventive_capability: "ubuntu-26.04-x64/claude-code/dependency.materialize" }), null);
  assert.notEqual(dependencyInstallProblem({ ...receipt, direct_installers_blocked: true }), null);
  assert.notEqual(dependencyInstallProblem({ ...receipt, extra: 1 }), null);
  assert.notEqual(dependencyInstallProblem({ ...receipt, scripts: [{ location: "x", scripts: ["prepare"], status: "ran" }] }), null);
});
