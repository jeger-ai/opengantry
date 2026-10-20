import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../src/canonical-json.js";
import { GXT_ERROR, gxtCodeFromGantryUserError } from "../src/error-codes.js";
import { GantryUserError, isGantryUserError } from "../src/user-error.js";
import { validateManifestShape } from "../src/manifest.js";
import { pathMatchesGlobPattern, patternCoversPath } from "../src/path-glob.js";
import { REL_MANIFEST_JSON, MSN_ID_PATTERN } from "../src/constants.js";

test("canonicalJson sorts keys at every depth", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test("GantryUserError maps internal codes to stable GXT codes", () => {
  const e = new GantryUserError("INVALID_ARGUMENT", "bad flag", "pass --x", 2);
  assert.ok(isGantryUserError(e));
  assert.equal(e.gxtCode, GXT_ERROR.INVALID_ARGUMENT);
  assert.equal(e.exitCode, 2);
  assert.equal(gxtCodeFromGantryUserError("GXT_CAGE_CONFIG_INVALID"), "GXT_CAGE_CONFIG_INVALID");
  assert.equal(gxtCodeFromGantryUserError("NOT_A_KNOWN_CODE"), GXT_ERROR.VERIFY_FAILED);
});

test("validateManifestShape accepts a minimal manifest and rejects a missing skill field", () => {
  const ok = { schema_version: "0.5.0", skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: [] } }, path_risks: {}, risk_keywords: [] };
  validateManifestShape(ok);
  assert.throws(
    () => validateManifestShape({ ...ok, skills: { ui: { trust_threshold: "Tier-1", tmvc_roots: [] } } }),
    /forbidden_zones/,
  );
});

test("one path matcher: globs match whole paths; a pattern covers the path or a folder above it", () => {
  assert.equal(pathMatchesGlobPattern("src/a/b.ts", "src/**"), true);
  assert.equal(pathMatchesGlobPattern("docs/x.md", "src/**"), false);
  assert.equal(pathMatchesGlobPattern("a/b/c.ts", "a/**.ts"), true);
  assert.equal(pathMatchesGlobPattern(".\\src\\x.ts", "src/*.ts"), true);
  assert.equal(pathMatchesGlobPattern("src", "src/**"), false);
  assert.equal(patternCoversPath(".gitagent/registry/", ".gitagent/registry/env.yaml"), true);
  assert.equal(patternCoversPath(".gitagent/registry", ".gitagent/registry-old/x"), false);
  assert.equal(patternCoversPath("**/.gxt-skill.yaml", "src/db/.gxt-skill.yaml"), true);
  assert.equal(patternCoversPath("**/.gxt-skill.yaml", "src/db/x.gxt-skill.yaml"), false);
  assert.equal(patternCoversPath("src/*", "src/a/b/c.ts"), true);
  assert.equal(patternCoversPath(".", "anything/at/all"), true);
});

test("constants are the law paths the CLI reads", () => {
  assert.equal(REL_MANIFEST_JSON, ".gitagent/foreman/MANIFEST.json");
  assert.ok(MSN_ID_PATTERN.test("MSN-0282"));
});
