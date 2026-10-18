import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REL_MANIFEST_JSON, REL_MANIFEST_YAML } from "#core/constants.js";
import { manifestToYaml } from "#core/manifest-file.js";
import { loadManifest, manifestExists, manifestRelPath, readManifestOrNull } from "../lib/manifest.js";
import { migratedManifest } from "../commands/migrate.js";

const manifest = {
  schema_version: "0.5.0",
  skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/ui/"], forbidden_zones: [".gitagent/"] } },
  path_risks: {},
  risk_keywords: [],
  perimeter_protected: ["**/.gxt-skill.yaml", REL_MANIFEST_JSON, ".gitagent/planner/RULES.md"],
};

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-manifest-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return root;
}

test("loadManifest: the 3.x JSON form is still read; the YAML form wins when both agree", () => {
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const onlyJson = repo({ [REL_MANIFEST_JSON]: json });
  assert.equal(manifestRelPath(onlyJson), REL_MANIFEST_JSON);
  assert.deepEqual(loadManifest(onlyJson), manifest);
  const both = repo({ [REL_MANIFEST_JSON]: json, [REL_MANIFEST_YAML]: manifestToYaml(manifest) });
  assert.equal(manifestRelPath(both), REL_MANIFEST_YAML);
  assert.deepEqual(loadManifest(both), manifest);
  const none = repo({});
  assert.equal(manifestExists(none), false);
  assert.equal(manifestRelPath(none), REL_MANIFEST_YAML);
  assert.throws(() => loadManifest(none), /missing \.gitagent\/foreman\/MANIFEST\.yaml/);
});

test("loadManifest: both forms present and different fail closed; advisory readers get null", () => {
  const changed = { ...manifest, risk_keywords: ["delete"] };
  const root = repo({ [REL_MANIFEST_JSON]: JSON.stringify(manifest), [REL_MANIFEST_YAML]: manifestToYaml(changed) });
  assert.throws(() => loadManifest(root), /GXT_MANIFEST_AMBIGUOUS|both exist and differ/);
  assert.equal(readManifestOrNull(root), null);
});

test("migratedManifest: the YAML path joins perimeter_protected next to the JSON one, once", () => {
  const first = migratedManifest(manifest);
  assert.equal(first.perimeterUpdated, true);
  assert.deepEqual(first.manifest.perimeter_protected, ["**/.gxt-skill.yaml", REL_MANIFEST_YAML, REL_MANIFEST_JSON, ".gitagent/planner/RULES.md"]);
  assert.equal(migratedManifest(first.manifest).perimeterUpdated, false);
  assert.equal(migratedManifest({ ...manifest, perimeter_protected: undefined }).perimeterUpdated, false);
});
