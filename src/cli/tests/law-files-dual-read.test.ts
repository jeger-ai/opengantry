import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAW_FILES, lawFileToYaml } from "#core/law-file.js";
import type { Manifest } from "#core/manifest.js";
import { loadPolicyPointer } from "#plane/policy-resolve.js";
import { loadManifest, manifestExists, manifestRelPath } from "../lib/manifest.js";
import { loadGxtConfig } from "../lib/gxt-config.js";
import { loadTrustedAutomationRules } from "../lib/trusted-automation.js";
import { architecturePointerPath, loadArchitecturePointer } from "../lib/arch/external/architecture-pointer.js";
import { runOrgPolicyDoctorChecks } from "../lib/policy/policy-doctor.js";
import { runLawFileFormDoctorChecks, writeLawFileYaml } from "../lib/law-files.js";
import { migratedManifest } from "../commands/migrate.js";

const M = LAW_FILES.manifest;
const manifest: Manifest = {
  schema_version: "0.5.0",
  skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/ui/"], forbidden_zones: [".gitagent/"] } },
  path_risks: {},
  risk_keywords: [],
  perimeter_protected: ["**/.gxt-skill.yaml", M.json, ".gitagent/planner/RULES.md"],
};
const config = {
  ledger: { mode: "local" as const, signature: "off" as const },
  trusted_automation: {
    rules: [{ id: "bots", allowed_actors: ["bot@example.com"], allowed_paths: [".github/workflows/**"], allowed_structural_changes: ["workflow_version_pin"], max_net_loc: 5 }],
  },
};
const pointer = { schema_version: "0.1.0", kind: "file", location: "docs/ARCHITECTURE.md", read_hint: "Read it." };
const policy = { schema_version: "1.0.0", source: { kind: "git", url: "", ref: "refs/heads/main" }, bundle_path: "ORG-POLICY.yaml", pinned_commit: "", bundle_sha256: "" };

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-law-files-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return root;
}

test("every loader reads the 3.x JSON form and doctor names its migrate verb; the YAML form wins", () => {
  const legacy = repo({
    [M.json]: JSON.stringify(manifest),
    [LAW_FILES.config.json]: JSON.stringify(config),
    [LAW_FILES["architecture-pointer"].json]: JSON.stringify(pointer),
    [LAW_FILES["policy-pointer"].json]: JSON.stringify(policy),
  });
  assert.equal(manifestRelPath(legacy), M.json);
  assert.deepEqual(loadManifest(legacy), manifest);
  assert.deepEqual(loadGxtConfig(legacy), config);
  assert.equal(loadTrustedAutomationRules(legacy).length, 1);
  assert.equal(loadArchitecturePointer(legacy).kind, "file");
  assert.ok(architecturePointerPath(legacy).endsWith("ARCHITECTURE.pointer.json"));
  assert.equal(loadPolicyPointer(legacy).kind, "scaffold");
  assert.ok(runOrgPolicyDoctorChecks(legacy).some((l) => l.message === `${LAW_FILES["policy-pointer"].json}: scaffold (unpinned)`));
  const warned = runLawFileFormDoctorChecks(legacy).map((l) => l.message.split("run gantry migrate ")[1]?.split(" ")[0]);
  assert.deepEqual(warned, ["manifest", "config", "architecture-pointer", "policy-pointer"]);

  const current = repo({});
  writeLawFileYaml(current, "manifest", manifest);
  writeLawFileYaml(current, "config", config);
  writeLawFileYaml(current, "architecture-pointer", pointer);
  writeLawFileYaml(current, "policy-pointer", policy);
  assert.equal(manifestRelPath(current), M.yaml);
  assert.deepEqual(loadManifest(current), manifest);
  assert.deepEqual(loadGxtConfig(current), config);
  assert.equal(loadTrustedAutomationRules(current)[0]?.id, "bots");
  assert.deepEqual(loadArchitecturePointer(current), pointer);
  assert.deepEqual(runOrgPolicyDoctorChecks(current), [{ level: "ok", message: `${LAW_FILES["policy-pointer"].yaml}: scaffold (unpinned)` }]);
  assert.deepEqual(runLawFileFormDoctorChecks(current), []);
});

test("absent files: the loaders name the YAML form; both forms present and different fail closed everywhere", () => {
  const none = repo({});
  assert.equal(manifestExists(none), false);
  assert.equal(manifestRelPath(none), M.yaml);
  assert.throws(() => loadManifest(none), /missing \.gitagent\/foreman\/MANIFEST\.yaml/);
  assert.deepEqual(loadGxtConfig(none), {});
  assert.throws(() => loadArchitecturePointer(none), /ARCHITECTURE\.pointer\.yaml missing/);
  assert.deepEqual(runOrgPolicyDoctorChecks(none), [{ level: "ok", message: `${LAW_FILES["policy-pointer"].yaml}: absent (opt-in)` }]);

  const both = repo({
    [M.json]: JSON.stringify({ ...manifest, risk_keywords: ["delete"] }),
    [M.yaml]: lawFileToYaml(M, manifest),
    [LAW_FILES.config.json]: JSON.stringify({ ledger: { mode: "off" } }),
    [LAW_FILES.config.yaml]: lawFileToYaml(LAW_FILES.config, config),
    [LAW_FILES["architecture-pointer"].json]: JSON.stringify({ ...pointer, kind: "unset", location: "" }),
    [LAW_FILES["architecture-pointer"].yaml]: lawFileToYaml(LAW_FILES["architecture-pointer"], pointer),
    [LAW_FILES["policy-pointer"].json]: JSON.stringify({ ...policy, bundle_path: "OTHER.yaml" }),
    [LAW_FILES["policy-pointer"].yaml]: lawFileToYaml(LAW_FILES["policy-pointer"], policy),
  });
  for (const load of [() => loadManifest(both), () => loadGxtConfig(both), () => loadTrustedAutomationRules(both), () => loadArchitecturePointer(both), () => loadPolicyPointer(both)]) {
    assert.throws(load, /GXT_LAW_FILE_AMBIGUOUS|both exist and differ/);
  }
});

test("a broken YAML form names the file it read", () => {
  const broken = repo({
    [LAW_FILES.config.yaml]: "trusted_automation: [\n",
    [LAW_FILES["architecture-pointer"].yaml]: "kind: [\n",
    [LAW_FILES["policy-pointer"].yaml]: "source: [\n",
  });
  assert.throws(() => loadTrustedAutomationRules(broken), /invalid YAML in \.gitagent\/config\.yaml/);
  assert.throws(() => loadArchitecturePointer(broken), /ARCHITECTURE\.pointer\.yaml is not valid YAML/);
  assert.throws(() => loadPolicyPointer(broken), /POLICY\.pointer\.yaml is not valid YAML/);
});

test("migratedManifest: the YAML path joins perimeter_protected next to the JSON one, once", () => {
  const first = migratedManifest(manifest);
  assert.deepEqual(first.changes, [`perimeter_protected now lists ${M.yaml}`]);
  assert.deepEqual(first.doc.perimeter_protected, ["**/.gxt-skill.yaml", M.yaml, M.json, ".gitagent/planner/RULES.md"]);
  assert.deepEqual(migratedManifest(first.doc).changes, []);
  assert.deepEqual(migratedManifest({ ...manifest, perimeter_protected: undefined }).changes, []);
});
