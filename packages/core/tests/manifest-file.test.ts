import test from "node:test";
import assert from "node:assert/strict";
import { manifestToYaml, parseManifestSource, selectManifestSource } from "../src/manifest-file.js";
import { parseStrictYaml } from "../src/strict-yaml.js";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "../src/constants.js";

const manifest = {
  schema_version: "0.5.0",
  skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/ui/"], forbidden_zones: [".gitagent/"] } },
  path_risks: { ".gitagent/": "Tier-3" },
  risk_keywords: ["delete"],
};
const json = `${JSON.stringify(manifest, null, 2)}\n`;
const yaml = manifestToYaml(manifest);

test("selectManifestSource: YAML first, JSON as the 3.x fallback, nothing when absent", () => {
  assert.equal(selectManifestSource(null, null), null);
  assert.equal(selectManifestSource(yaml, null)?.rel, REL_MANIFEST_YAML);
  assert.equal(selectManifestSource(null, json)?.rel, REL_MANIFEST_JSON);
  assert.equal(selectManifestSource(yaml, json)?.kind, "yaml");
});

test("selectManifestSource: both present and different fails closed", () => {
  const other = `${JSON.stringify({ ...manifest, risk_keywords: ["schema"] }, null, 2)}\n`;
  assert.throws(() => selectManifestSource(yaml, other), /GXT_LAW_FILE_AMBIGUOUS|both exist and differ/);
});

test("manifestToYaml round-trips through the strict parser and keeps strings strings", () => {
  const parsed = parseManifestSource({ rel: REL_MANIFEST_YAML, kind: "yaml", text: yaml });
  assert.deepEqual(parsed, manifest);
  assert.equal(yaml, manifestToYaml(parsed));
  assert.deepEqual(parseStrictYaml("a: no\nb: 0.5.0\n"), { a: "no", b: "0.5.0" });
});

test("parseStrictYaml: aliases, duplicate keys and syntax errors throw", () => {
  assert.throws(() => parseStrictYaml("base: &b [a]\nx: *b\n"), /aliases/);
  assert.throws(() => parseStrictYaml("a: 1\na: 2\n"), /unique|duplicate/i);
  assert.throws(() => parseStrictYaml("a: [1\n"));
});
