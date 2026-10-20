import test from "node:test";
import assert from "node:assert/strict";
import { LAW_FILES, lawFileToYaml, readLawFile, selectLawFileSource, type LawFileId } from "../src/law-file.js";
import { parseManifestSource } from "../src/manifest.js";
import { parseGxtConfigSource } from "../src/config.js";
import { parseStrictYaml } from "../src/strict-yaml.js";

const manifest = {
  schema_version: "0.5.0",
  skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/ui/"], forbidden_zones: [".gitagent/"] } },
  path_risks: { ".gitagent/": "Tier-3" },
  risk_keywords: ["delete"],
};

test("every law file: YAML first, the 3.x JSON as fallback, equal documents allowed, different fail closed", () => {
  for (const id of Object.keys(LAW_FILES) as LawFileId[]) {
    const file = LAW_FILES[id];
    const doc = { a: 1, b: ["x"] };
    const yaml = lawFileToYaml(file, doc);
    const json = `${JSON.stringify(doc, null, 2)}\n`;
    assert.equal(selectLawFileSource(file, null, null), null, id);
    assert.equal(selectLawFileSource(file, yaml, null)?.rel, file.yaml, id);
    assert.equal(selectLawFileSource(file, null, json)?.rel, file.json, id);
    assert.equal(selectLawFileSource(file, yaml, json)?.kind, "yaml", id);
    assert.throws(() => selectLawFileSource(file, yaml, JSON.stringify({ a: 2 })), new RegExp(`gantry migrate ${id}|both exist and differ`), id);
    const files: Record<string, string> = { [file.json]: json };
    assert.equal(readLawFile(file, (rel) => files[rel] ?? null)?.kind, "json", id);
    assert.ok(yaml.startsWith(`# ${file.purpose}\n`), id);
  }
});

test("the YAML form round-trips through the strict parser; strings stay strings", () => {
  const yaml = lawFileToYaml(LAW_FILES.manifest, manifest);
  assert.deepEqual(parseManifestSource({ rel: LAW_FILES.manifest.yaml, kind: "yaml", text: yaml }), manifest);
  assert.equal(lawFileToYaml(LAW_FILES.manifest, parseStrictYaml(yaml)), yaml);
  assert.deepEqual(parseStrictYaml("a: no\nb: 0.5.0\n"), { a: "no", b: "0.5.0" });
});

test("parseStrictYaml: aliases, duplicate keys and syntax errors throw", () => {
  assert.throws(() => parseStrictYaml("base: &b [a]\nx: *b\n"), /aliases/);
  assert.throws(() => parseStrictYaml("a: 1\na: 2\n"), /unique|duplicate/i);
  assert.throws(() => parseStrictYaml("a: [1\n"));
});

test("the config stays lenient: a broken or non-object file is an empty config", () => {
  const config = { ledger: { mode: "local", signature: "off" } };
  const yaml = lawFileToYaml(LAW_FILES.config, config);
  assert.deepEqual(parseGxtConfigSource({ rel: LAW_FILES.config.yaml, kind: "yaml", text: yaml }), config);
  assert.deepEqual(parseGxtConfigSource({ rel: LAW_FILES.config.json, kind: "json", text: "{ nope" }), {});
  assert.deepEqual(parseGxtConfigSource({ rel: LAW_FILES.config.yaml, kind: "yaml", text: "- not: an object\n" }), {});
});
