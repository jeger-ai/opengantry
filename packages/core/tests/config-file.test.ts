import test from "node:test";
import assert from "node:assert/strict";
import { gxtConfigToYaml, parseGxtConfigSource, selectGxtConfigSource } from "../src/config-file.js";
import { REL_GXT_CONFIG_JSON, REL_GXT_CONFIG_YAML } from "../src/constants.js";
import type { GxtConfigShape } from "../src/config.js";

const config: GxtConfigShape = { ledger: { mode: "local", signature: "off" }, trusted_automation: { rules: [] } };
const json = `${JSON.stringify(config, null, 2)}\n`;
const yaml = gxtConfigToYaml(config);

test("config dual-read: YAML first, JSON fallback, same document allowed, different fails closed", () => {
  assert.equal(selectGxtConfigSource(null, null), null);
  assert.equal(selectGxtConfigSource(null, json)?.rel, REL_GXT_CONFIG_JSON);
  assert.equal(selectGxtConfigSource(yaml, json)?.rel, REL_GXT_CONFIG_YAML);
  assert.throws(() => selectGxtConfigSource(yaml, JSON.stringify({ ledger: { mode: "off" } })), /GXT_LAW_FILE_AMBIGUOUS|both exist and differ/);
});

test("config dual-read: the YAML form parses to the same shape; a broken file is an empty config", () => {
  assert.deepEqual(parseGxtConfigSource({ rel: REL_GXT_CONFIG_YAML, kind: "yaml", text: yaml }), config);
  assert.deepEqual(parseGxtConfigSource({ rel: REL_GXT_CONFIG_JSON, kind: "json", text: "{ nope" }), {});
  assert.deepEqual(parseGxtConfigSource({ rel: REL_GXT_CONFIG_YAML, kind: "yaml", text: "- not: an object\n" }), {});
});
