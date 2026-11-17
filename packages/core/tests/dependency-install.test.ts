import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
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
  assert.deepEqual(codes({ manifest: "[1]", bindingGyp: false, shrinkwrap: false, nodeModules: false, entries: 1, files: 1 }), ["tarball_malformed"]);
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

// --- tarball: never less than npm extracts (review round, PR #371) ---------------------------------------------

interface RawHeader {
  name: string;
  size: number;
  type?: string;
  prefix?: string;
  linkpath?: string;
  magic?: string;
}

function raw(o: RawHeader): Buffer {
  const h = Buffer.alloc(512);
  h.write(o.name, 0, 100, "utf8");
  h.write("0000644\0", 100, "latin1");
  h.write("0000000\0", 108, "latin1");
  h.write("0000000\0", 116, "latin1");
  h.write(`${o.size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write(o.type ?? "0", 156, "latin1");
  h.write(o.linkpath ?? "", 157, 100, "utf8");
  h.write(o.magic ?? "ustar\u000000", 257, "latin1");
  h.write(o.prefix ?? "", 345, 155, "utf8");
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return h;
}

const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
const file = (name: string, body: string | Buffer, o: Partial<RawHeader> = {}) => {
  const b = Buffer.from(body);
  return [raw({ name, size: b.length, ...o }), pad(b)];
};
const paxBody = (records: [string, string][]) =>
  Buffer.from(
    records
      .map(([k, v]) => {
        const rest = ` ${k}=${v}\n`;
        let len = Buffer.byteLength(rest);
        len += String(len + String(len).length).length;
        return `${String(len)}${rest}`;
      })
      .join(""),
  );
const pax = (records: [string, string][], type = "x") => {
  const b = paxBody(records);
  return [raw({ name: "PaxHeader/x", size: b.length, type }), pad(b)];
};
const END = Buffer.alloc(1024);
const gz = (parts: Buffer[]) => gzipSync(Buffer.concat(parts));
const clean = pkgJson({});
const scripted = pkgJson({ scripts: { postinstall: "node -e 1" } });

/** Hostile and benign archives; `refuse` says what gantry must do. */
const FIXTURES: Record<string, { tgz: Buffer; refuse: RegExp | null }> = {
  // The reviewer's proof of concept: one zero block, then the entries npm still extracts.
  single_zero_block: { tgz: gz([...file("package/package.json", clean), Buffer.alloc(512), ...file("package/package.json", scripted), ...file("package/binding.gyp", "{}"), END]), refuse: /single zero block/ },
  // pax size=0 over an entry whose ustar size spans further headers: npm reads the inner headers.
  pax_size_hides_headers: {
    tgz: (() => {
      const inner = Buffer.concat([...file("package/package.json", scripted), ...file("package/binding.gyp", "{}")]);
      return gz([...file("package/package.json", clean), ...pax([["size", "0"]]), raw({ name: "package/README", size: inner.length }), inner, END]);
    })(),
    refuse: /pax size 0 disagrees/,
  },
  pax_global: { tgz: gz([...pax([["comment", "x"]], "g"), ...file("package/package.json", clean), END]), refuse: /unsupported type "g"/ },
  pax_unknown_keyword: { tgz: gz([...pax([["SCHILY.fflags", "x"]]), ...file("package/package.json", clean), END]), refuse: /keyword "SCHILY.fflags"/ },
  pax_dangling: { tgz: gz([...file("package/package.json", clean), ...pax([["path", "package/binding.gyp"]]), END]), refuse: /not followed by an entry/ },
  pax_path_benign: { tgz: gz([...pax([["path", "package/lib/long.js"]]), ...file("ignored-name", "x"), ...file("package/package.json", clean), END]), refuse: null },
  pax_non_ascii_over_binding_gyp: { tgz: gz([...pax([["path", "package/résumé.js"]]), ...file("package/binding.gyp", "{}"), ...file("package/package.json", clean), END]), refuse: /not harmless/ },
  pax_non_ascii_benign: { tgz: gz([...pax([["path", "package/résumé.js"]]), ...file("package/resume.js", "x"), ...file("package/package.json", clean), END]), refuse: null },
  gnu_long_name: { tgz: gz([...file("././@LongLink", "package/binding.gyp\0", { type: "L" }), ...file("package/x", "{}"), ...file("package/package.json", clean), END]), refuse: /unsupported type "L"/ },
  gnu_long_link: { tgz: gz([...file("././@LongLink", "target\0", { type: "K" }), ...file("package/package.json", clean), END]), refuse: /unsupported type "K"/ },
  dot_slash_prefix: { tgz: gz([...file("./package/package.json", clean), END]), refuse: /"\." path component/ },
  duplicate_by_case: { tgz: gz([...file("package/package.json", clean), ...file("package/Package.json", scripted), END]), refuse: /appears twice/ },
  duplicate_by_nfc: { tgz: gz([...file("package/package.json", clean), ...file("package/café.js", "1"), ...file("package/café.js", "2"), END]), refuse: /appears twice/ },
  duplicate_exact: { tgz: gz([...file("package/package.json", clean), ...file("package/index.js", "1"), ...file("package/index.js", "2"), END]), refuse: /appears twice/ },
  double_slash: { tgz: gz([...file("package/package.json", clean), ...file("package//binding.gyp", "{}"), END]), refuse: /empty or "\." path component/ },
  backslash_root: { tgz: gz([...file("package/package.json", clean), ...file("package/\\binding.gyp", "{}"), END]), refuse: /backslash/ },
  drive_root: { tgz: gz([...file("package/package.json", clean), ...file("package/C:binding.gyp", "{}"), END]), refuse: /drive-like/ },
  upper_case_binding_gyp: { tgz: gz([...file("package/package.json", clean), ...file("package/Binding.GYP", "{}"), END]), refuse: null },
  file_inside_file: { tgz: gz([...file("package/package.json", clean), ...file("package/lib", "x"), ...file("package/lib/a.js", "y"), END]), refuse: /inside a file/ },
  trailing_garbage_tar: { tgz: gz([...file("package/package.json", clean), END, ...file("package/binding.gyp", "{}")]), refuse: /after the end-of-archive marker/ },
  trailing_zeros_tar: { tgz: gz([...file("package/package.json", clean), END, Buffer.alloc(4096)]), refuse: null },
  trailing_gzip_bytes: { tgz: Buffer.concat([gz([...file("package/package.json", clean), END]), Buffer.alloc(16)]), refuse: /after the gzip data/ },
  directory_with_size: {
    tgz: (() => {
      const inner = Buffer.concat([...file("package/binding.gyp", "{}")]);
      return gz([...file("package/package.json", clean), raw({ name: "package/lib/", size: inner.length, type: "5" }), inner, END]);
    })(),
    refuse: /folder or link with a size/,
  },
  file_with_folder_slash: { tgz: gz([...file("package/package.json", clean), ...file("package/lib/", "x")]), refuse: /names a folder/ },
  empty_name: { tgz: gz([...file("package/package.json", clean), ...file("", "x"), END]), refuse: /without a path/ },
  link_without_target: { tgz: gz([...file("package/package.json", clean), raw({ name: "package/l", size: 0, type: "2" }), END]), refuse: /link without one/ },
  linkpath_on_file: {
    tgz: (() => {
      const inner = Buffer.concat([...file("package/binding.gyp", "{}")]);
      return gz([...file("package/package.json", clean), raw({ name: "package/x", size: inner.length, linkpath: "y" }), inner, END]);
    })(),
    refuse: /link target on a non-link/,
  },
  name_bytes_after_nul: { tgz: gz([...file("package/package.json", clean), ...file("package/a\0\nbinding.gyp", "{}"), END]), refuse: /after the terminating NUL/ },
  gnu_magic_ignores_prefix: { tgz: gz([...file("package.json", clean, { prefix: "package", magic: "ustar  \0" }), ...file("package/index.js", ""), END]), refuse: /top level|more than one top/ },
  symlink_benign: { tgz: gz([...file("package/package.json", clean), raw({ name: "package/l", size: 0, type: "2", linkpath: "index.js" }), ...file("package/index.js", ""), END]), refuse: null },
  plain: { tgz: gz([raw({ name: "package/", size: 0, type: "5" }), ...file("package/package.json", clean), ...file("package/lib/a.js", "a"), END]), refuse: null },
};

test("hostile tarballs that would hide entries from inspection are refused", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    const r = inspectNpmTarball(f.tgz);
    if (f.refuse === null) assert.ok(r.ok, `${name}: ${r.ok ? "" : r.detail}`);
    else {
      assert.equal(r.ok, false, `${name} must be refused`);
      assert.match((r as { detail: string }).detail, f.refuse, name);
    }
  }
  const upper = inspectNpmTarball(FIXTURES.upper_case_binding_gyp!.tgz);
  assert.ok(upper.ok && upper.contents.bindingGyp, "a case-insensitive file system places Binding.GYP where npm looks for binding.gyp");
  const paxPath = inspectNpmTarball(FIXTURES.pax_path_benign!.tgz);
  assert.ok(paxPath.ok && paxPath.contents.files === 2);
});

/** The package.json of npm's own tar (the one the npm on PATH bundles). */
function npmTarDir(): string {
  const npmBin = execFileSync(process.platform === "win32" ? "where" : "which", ["npm"], { encoding: "utf8" }).split("\n")[0]!.trim();
  const npmRoot = path.dirname(path.dirname(fs.realpathSync(npmBin)));
  return createRequire(path.join(npmRoot, "package.json")).resolve("tar/package.json");
}

/** Extract as pacote does (strip 1, files only, links skipped), in a child: a tar crash fails npm, so nothing counts. */
const EXTRACT = `const tar = require("node:module").createRequire(process.argv[1])("tar");
tar.x({ file: process.argv[2], cwd: process.argv[3], strip: 1, noChmod: true, noMtime: true, preserveOwner: false,
  filter: (_p, e) => !/Link$/.test(e.type) && /File$/.test(e.type), onwarn: () => {} }).catch(() => process.exit(3));`;

function countFiles(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}

test("differential: gantry never sees less than npm's tar extracts", () => {
  const tarDir = npmTarDir();
  const hidden: string[] = [];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-tar-diff-"));
  try {
    for (const [name, f] of Object.entries(FIXTURES)) {
      const archive = path.join(work, `${name}.tgz`);
      const dest = path.join(work, name);
      fs.writeFileSync(archive, f.tgz);
      fs.mkdirSync(dest);
      try {
        execFileSync(process.execPath, ["-e", EXTRACT, tarDir, archive, dest], { stdio: "ignore" });
      } catch {
        // npm's tar crashed or failed: npm fails the install
      }
      const r = inspectNpmTarball(f.tgz);
      const at = (p: string) => path.join(dest, p);
      const extracted = { files: countFiles(dest), manifest: fs.existsSync(at("package.json")) ? fs.readFileSync(at("package.json"), "utf8") : null, gyp: fs.existsSync(at("binding.gyp")), shrinkwrap: fs.existsSync(at("npm-shrinkwrap.json")), bundled: fs.existsSync(at("node_modules")) };
      if (!r.ok) {
        if (extracted.gyp) hidden.push(name);
        continue;
      }
      assert.ok(r.contents.files >= extracted.files, `${name}: gantry saw ${String(r.contents.files)} files, npm extracted ${String(extracted.files)}`);
      assert.equal(r.contents.manifest, extracted.manifest, `${name}: the package.json npm extracts is the one gantry read`);
      assert.ok(r.contents.bindingGyp || !extracted.gyp, `${name}: npm extracted a binding.gyp gantry missed`);
      assert.ok(r.contents.shrinkwrap || !extracted.shrinkwrap, `${name}: npm extracted a shrinkwrap gantry missed`);
      assert.ok(r.contents.nodeModules || !extracted.bundled, `${name}: npm extracted node_modules gantry missed`);
    }
    // npm's tar does extract a binding.gyp gantry would otherwise have missed: these refusals are not vacuous.
    for (const name of ["single_zero_block", "pax_size_hides_headers", "gnu_long_name", "double_slash", "backslash_root", "drive_root", "directory_with_size", "linkpath_on_file"]) {
      assert.ok(hidden.includes(name), `${name}: npm extracts a hidden binding.gyp`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("a redirect stays under a policy registry's base path, not just its origin", () => {
  const mirror = "https://registry.example/mirror/";
  const from = `${mirror}a/-/a-1.0.0.tgz`;
  assert.equal(redirectProblem(from, "/mirror/a/-/a-1.0.0-copy.tgz", [mirror]), null);
  assert.equal(redirectProblem(from, "../b/-/b-1.0.0.tgz", [mirror]), null);
  assert.match(redirectProblem(from, "/other-tenant/a.tgz", [mirror])!, /outside the policy registries/);
  assert.match(redirectProblem(from, "/mirror-other/a.tgz", [mirror])!, /outside the policy registries/);
  assert.match(redirectProblem(from, "/mirror/../admin/a.tgz", [mirror])!, /outside the policy registries/);
  assert.match(redirectProblem(from, "/mirror/%2e%2e/admin/a.tgz", [mirror])!, /outside the policy registries/);
});
