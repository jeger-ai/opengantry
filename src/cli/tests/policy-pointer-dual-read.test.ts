import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REL_POLICY_POINTER_JSON, REL_POLICY_POINTER_YAML } from "#core/constants.js";
import { policyPointerToYaml } from "#core/policy-pointer-file.js";
import { loadPolicyPointer, policyPointerRel } from "#plane/policy-resolve.js";
import { runOrgPolicyDoctorChecks } from "../lib/policy/policy-doctor.js";

const scaffold = {
  schema_version: "1.0.0",
  source: { kind: "git", url: "", ref: "refs/heads/main" },
  bundle_path: "ORG-POLICY.yaml",
  pinned_commit: "",
  bundle_sha256: "",
};

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-policy-pointer-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return root;
}

test("loadPolicyPointer: the 3.x JSON form is still read and doctor says so; the YAML form wins; absent names the YAML form", () => {
  const onlyJson = repo({ [REL_POLICY_POINTER_JSON]: JSON.stringify(scaffold) });
  assert.equal(loadPolicyPointer(onlyJson).kind, "scaffold");
  assert.equal(policyPointerRel(onlyJson), REL_POLICY_POINTER_JSON);
  const lines = runOrgPolicyDoctorChecks(onlyJson);
  assert.ok(lines.some((l) => l.message === `${REL_POLICY_POINTER_JSON}: scaffold (unpinned)`));
  assert.ok(lines.some((l) => l.level === "warn" && l.message.includes("gantry migrate policy-pointer")));
  const onlyYaml = repo({ [REL_POLICY_POINTER_YAML]: policyPointerToYaml(scaffold) });
  assert.equal(loadPolicyPointer(onlyYaml).kind, "scaffold");
  assert.deepEqual(runOrgPolicyDoctorChecks(onlyYaml), [{ level: "ok", message: `${REL_POLICY_POINTER_YAML}: scaffold (unpinned)` }]);
  assert.deepEqual(runOrgPolicyDoctorChecks(repo({})), [{ level: "ok", message: `${REL_POLICY_POINTER_YAML}: absent (opt-in)` }]);
});

test("loadPolicyPointer: both forms present and different fail closed; a broken YAML form names the file", () => {
  const both = repo({ [REL_POLICY_POINTER_JSON]: JSON.stringify({ ...scaffold, bundle_path: "OTHER.yaml" }), [REL_POLICY_POINTER_YAML]: policyPointerToYaml(scaffold) });
  assert.throws(() => loadPolicyPointer(both), /GXT_LAW_FILE_AMBIGUOUS|both exist and differ/);
  const broken = repo({ [REL_POLICY_POINTER_YAML]: "source: [\n" });
  assert.throws(() => loadPolicyPointer(broken), /POLICY\.pointer\.yaml is not valid YAML/);
});
