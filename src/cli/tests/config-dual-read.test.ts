import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REL_GXT_CONFIG_JSON, REL_GXT_CONFIG_YAML } from "#core/constants.js";
import { loadGxtConfig, writeGxtConfigYaml } from "../lib/gxt-config.js";
import { loadTrustedAutomationRules } from "../lib/trusted-automation.js";
import type { GxtConfigShape } from "#core/config.js";

const config: GxtConfigShape = {
  ledger: { mode: "local", signature: "off" },
  trusted_automation: {
    rules: [{ id: "bots", allowed_actors: ["bot@example.com"], allowed_paths: [".github/workflows/**"], allowed_structural_changes: ["workflow_version_pin"], max_net_loc: 5 }],
  },
};

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-config-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return root;
}

test("loadGxtConfig: the 3.x JSON form is still read; the YAML form wins; both different fails closed", () => {
  const onlyJson = repo({ [REL_GXT_CONFIG_JSON]: JSON.stringify(config) });
  assert.deepEqual(loadGxtConfig(onlyJson), config);
  assert.equal(loadTrustedAutomationRules(onlyJson).length, 1);
  const onlyYaml = repo({});
  writeGxtConfigYaml(onlyYaml, config);
  assert.deepEqual(loadGxtConfig(onlyYaml), config);
  assert.equal(loadTrustedAutomationRules(onlyYaml)[0]?.id, "bots");
  assert.deepEqual(loadGxtConfig(repo({})), {});
  const both = repo({ [REL_GXT_CONFIG_JSON]: JSON.stringify({ ledger: { mode: "off" } }) });
  writeGxtConfigYaml(both, config);
  assert.throws(() => loadGxtConfig(both), /GXT_LAW_FILE_AMBIGUOUS|both exist and differ/);
  assert.throws(() => loadTrustedAutomationRules(both), /both exist and differ/);
});

test("loadTrustedAutomationRules: an invalid YAML form fails with the file named", () => {
  const root = repo({ [REL_GXT_CONFIG_YAML]: "trusted_automation: [\n" });
  assert.throws(() => loadTrustedAutomationRules(root), /invalid YAML in \.gitagent\/config\.yaml/);
});
