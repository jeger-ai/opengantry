import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitOutput } from "#git/git.js";
import { verifyFactoryCandidate } from "#verify/run.js";
import type { VerifyInput } from "#verify/run.js";

const label = "ui/label";
const assertion = "checks/label";
const manifest = ".gitagent/foreman/MANIFEST.yaml";
const gate = "a".repeat(64);

function fixture(t: TestContext, initialAssertion: string | Buffer = 'expect(button).toEqual("Settings")') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => gitOutput(root, args).trim();
  const write = (file: string, body: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  };
  function commit() {
    git("add", "-A");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
      "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  }
  git("init", "-q");
  write(label, "Settings");
  write(assertion, initialAssertion);
  write("src/cli/tool", "old");
  write(manifest, "policy");
  write(".gitignore", "*.local\n");
  const base = commit();
  const job = { repository: "demo", workItem: "rename", attempt: "1", record: "approval", base };
  function input(candidate: string): VerifyInput {
    return {
      schema: "opengantry.factory.verify.v1", job,
      authorization: { ...job, allowed: [label], gates: [gate] }, candidate,
      policy: { base, forbidden: [manifest, ".github/workflows"], tier2: ["src/cli"], tier3: ["auth"],
        protectedChecks: [assertion], executableChanges: [] },
      inventory: { candidate, dirty: [] }, evidence: [{ candidate, record: job.record, gate, passed: true }], amendments: [],
    };
  }
  return { root, write, git, commit, input, base };
}

test("approved rename passes; inventory, evidence and approval must belong to this candidate and job", t => {
  const f = fixture(t);
  f.write(label, "Preferences");
  const input = f.input(f.commit());
  assert.equal(verifyFactoryCandidate(f.root, input).eligible, true);
  for (const [code, mutate] of [
    ["authorization_mismatch", (v: VerifyInput) => { v.authorization.attempt = "another"; }],
    ["dirty_handoff", (v: VerifyInput) => { v.inventory.dirty.push("ui/untracked"); }],
    ["stale_inventory", (v: VerifyInput) => { v.inventory.candidate = f.base; }],
    ["policy_mismatch", (v: VerifyInput) => { v.policy.base = v.candidate; }],
    ["gate_unsatisfied", (v: VerifyInput) => { v.evidence[0]!.passed = false; }],
    ["gate_unsatisfied", (v: VerifyInput) => { v.evidence[0]!.candidate = f.base; }],
  ] as const) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.deepEqual(verifyFactoryCandidate(f.root, changed).findings.map(row => row.code), [code]);
  }
  assert.throws(() => verifyFactoryCandidate(f.root, { ...input, risk_keywords: ["safe"] }));
});

test("declaring policy or workflow files cannot authorize them; scope violations accumulate", t => {
  const f = fixture(t);
  for (const file of [manifest, ".github/workflows/build", "ui/extra", "src/cli/tool"]) f.write(file, "changed");
  const v = f.input(f.commit());
  v.authorization.allowed.push(manifest, ".github/workflows/build");
  assert.deepEqual(verifyFactoryCandidate(f.root, v).findings, [
    { code: "forbidden", subject: manifest }, { code: "forbidden", subject: ".github/workflows/build" },
    { code: "undeclared", subject: "src/cli/tool" }, { code: "tier2_trace_review", subject: "src/cli/tool" },
    { code: "undeclared", subject: "ui/extra" },
  ]);
});

test("moving a Tier 2 file retains its source obligations", t => {
  const f = fixture(t);
  f.git("mv", "src/cli/tool", "ui/tool");
  const v = f.input(f.commit());
  v.authorization.allowed.push("ui/tool");
  assert.deepEqual(verifyFactoryCandidate(f.root, v).findings, [
    { code: "undeclared", subject: "src/cli/tool" }, { code: "tier2_trace_review", subject: "src/cli/tool" },
  ]);
});

test("tree modes block symlink, gitlink and executable changes at approved paths", t => {
  const f = fixture(t);
  fs.chmodSync(path.join(f.root, label), 0o755);
  fs.symlinkSync("../src/cli/tool", path.join(f.root, "ui/link"));
  f.git("update-index", "--add", "--cacheinfo", "160000," + f.base + ",ui/module");
  f.git("add", label, "ui/link");
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", "-c", "commit.gpgsign=false", "commit", "-qm", "modes");
  const v = f.input(f.git("rev-parse", "HEAD"));
  v.authorization.allowed.push("ui/module", "ui/link");
  assert.deepEqual(verifyFactoryCandidate(f.root, v).findings.map(row => row.code),
    ["executable_change", "restricted_entry", "restricted_entry"]);
});

test("approval covers exactly one literal in a pinned assertion", t => {
  const f = fixture(t);
  const newCheck = 'expect(button).toEqual("Preferences")';
  f.write(assertion, newCheck);
  const v = f.input(f.commit());
  v.authorization.allowed.push(assertion);
  assert.equal(verifyFactoryCandidate(f.root, v).findings[0]?.code, "protected_check");
  v.amendments.push({ record: v.job.record, approver: "owner", path: assertion,
    baseBlob: f.git("rev-parse", f.base + ":" + assertion), offset: newCheck.indexOf('"'),
    oldLiteral: "Settings", newLiteral: "Preferences" });
  assert.equal(verifyFactoryCandidate(f.root, v).eligible, true);
  f.write(assertion, newCheck.replace("button", "other"));
  const changed = f.input(f.commit());
  changed.authorization = v.authorization;
  changed.amendments = v.amendments;
  assert.equal(verifyFactoryCandidate(f.root, changed).findings[0]?.code, "protected_check");
});

test("trusted inventory catches a loose file; repair constructs a clean candidate from the base", t => {
  const f = fixture(t);
  f.write(label, "Preferences");
  f.write("ui/incidental", "extra");
  const rejected = f.input(f.commit());
  f.write("ui/loose", "input");
  f.write("ui/worker.local", "ignored build input");
  f.git("config", "factory.worker", "yes");
  rejected.inventory.dirty = f.git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  assert.deepEqual(verifyFactoryCandidate(f.root, rejected).findings, [
    { code: "dirty_handoff", subject: "ui/loose" }, { code: "undeclared", subject: "ui/incidental" },
  ]);
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "factory-clean-"));
  t.after(() => fs.rmSync(clean, { recursive: true, force: true }));
  gitOutput(clean, ["clone", "-q", "--no-local", f.root, "."]);
  gitOutput(clean, ["checkout", "-q", "--detach", f.base]);
  gitOutput(clean, ["restore", "--source", rejected.candidate, "--staged", "--worktree", "--", label]);
  gitOutput(clean, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
    "-c", "commit.gpgsign=false", "commit", "-qm", "repair"]);
  const repaired = f.input(gitOutput(clean, ["rev-parse", "HEAD"]).trim());
  assert.equal(fs.existsSync(path.join(clean, "ui/loose")), false);
  assert.equal(fs.existsSync(path.join(clean, "ui/incidental")), false);
  assert.equal(fs.existsSync(path.join(clean, "ui/worker.local")), false);
  assert.throws(() => gitOutput(clean, ["config", "--local", "--get", "factory.worker"]));
  repaired.evidence[0]!.passed = fs.readFileSync(path.join(clean, label), "utf8") === "Preferences";
  assert.equal(verifyFactoryCandidate(clean, { ...repaired, evidence: rejected.evidence }).eligible, false);
  assert.equal(verifyFactoryCandidate(clean, repaired).eligible, true);
});

test("Tier 3, ambiguous paths, missing gates and duplicate evidence fail closed", t => {
  const f = fixture(t);
  f.write("auth/action", "change");
  f.write("authentic/label", "change");
  const v = f.input(f.commit());
  v.authorization.allowed.push("auth/action", "authentic/label");
  const result = () => verifyFactoryCandidate(f.root, v);
  assert.deepEqual(result().findings, [{ code: "tier3_review", subject: "auth/action" }]);
  v.evidence.push({ ...v.evidence[0]! });
  assert.ok(result().findings.some(row => row.code === "gate_unsatisfied"));
  v.authorization.gates = [];
  assert.throws(result);
  v.authorization.gates = [gate];
  for (const unsafe of ["../label", "/ui/label", "ui//label", "ui/./label", ".git/config", "ui\\label"]) {
    v.authorization.allowed = [unsafe];
    assert.throws(result);
  }
});

test("a gitlink pointer update on an already allowed path still blocks", t => {
  const f = fixture(t);
  f.git("update-index", "--add", "--cacheinfo", "160000," + f.base + ",ui/module");
  const commitIndex = () => {
    f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", "-c", "commit.gpgsign=false", "commit", "-qm", "pointer");
    return f.git("rev-parse", "HEAD");
  };
  const base = commitIndex();
  f.git("update-index", "--cacheinfo", "160000," + base + ",ui/module");
  const v = f.input(commitIndex());
  v.job.base = v.authorization.base = v.policy.base = base;
  v.authorization.allowed.push("ui/module");
  assert.deepEqual(verifyFactoryCandidate(f.root, v).findings, [{ code: "restricted_entry", subject: "ui/module" }]);
});

test("literal approvals preserve exact bytes, UTF-16 offsets, BOM and empty values", t => {
  const prefix = "\uFEFF🚦�: ";
  for (const [oldLiteral, newLiteral] of [["", "ready"], ["ready", ""], ["ready", "�"]] as const) {
    const f = fixture(t, prefix + JSON.stringify(oldLiteral));
    const evaluate = (bytes: Buffer) => {
      f.write(assertion, bytes);
      const v = f.input(f.commit());
      v.authorization.allowed.push(assertion);
      v.amendments.push({ record: v.job.record, approver: "owner", path: assertion,
        baseBlob: f.git("rev-parse", f.base + ":" + assertion), offset: prefix.length, oldLiteral, newLiteral });
      return verifyFactoryCandidate(f.root, v);
    };
    const valid = Buffer.from(prefix + JSON.stringify(newLiteral));
    assert.equal(evaluate(valid).eligible, true);
    const pos = valid.indexOf(Buffer.from("�"));
    const malformed = Buffer.concat([valid.subarray(0, pos), Buffer.from([0xff]), valid.subarray(pos + 3)]);
    assert.equal(evaluate(malformed).findings[0]?.code, "protected_check");
  }
});

test("an invalid UTF-8 base cannot authorize a text amendment", t => {
  const f = fixture(t, Buffer.from([0xff, 34, 97, 34]));
  f.write(assertion, '�"b"');
  const v = f.input(f.commit());
  v.authorization.allowed.push(assertion);
  v.amendments.push({ record: v.job.record, approver: "owner", path: assertion,
    baseBlob: f.git("rev-parse", f.base + ":" + assertion), offset: 1, oldLiteral: "a", newLiteral: "b" });
  assert.equal(verifyFactoryCandidate(f.root, v).findings[0]?.code, "protected_check");
});
