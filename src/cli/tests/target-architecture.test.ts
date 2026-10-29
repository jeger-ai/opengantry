import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "#git/git.js";
import {
  checkArchBoundariesForFiles,
  layerForFile,
  loadTargetArchitecture,
  resolveArchScanRoots,
  validateTargetArchitecture,
} from "#missions/arch/target-architecture.js";

test("validateTargetArchitecture: accepts dogfood spec shape", () => {
  const spec = validateTargetArchitecture({
    schema_version: "0.1.0",
    layers: [{ id: "lib", globs: ["src/cli/lib/**"] }],
    rules: [{ id: "RULE-LIB-COMMANDER", from_layer: "lib", forbid_specifier_substring: "commander" }],
  });
  assert.equal(spec.layers[0]?.id, "lib");
});

test("validateTargetArchitecture: accepts 0.2.0 with scan_roots", () => {
  const spec = validateTargetArchitecture({
    schema_version: "0.2.0",
    scan_roots: ["src/app/**"],
    languages: ["typescript"],
    layers: [{ id: "lib", globs: ["src/app/lib/**"] }],
    rules: [],
  });
  assert.deepEqual(spec.scan_roots, ["src/app/**"]);
});

test("layerForFile: classifies src/cli paths", () => {
  const root = getRepoRoot();
  const spec = loadTargetArchitecture(root);
  assert.equal(layerForFile(spec, "src/cli/commands/verify.ts"), "command");
  assert.equal(layerForFile(spec, "src/cli/flows/verify-run.ts"), "lib");
});

test("resolveArchScanRoots: prefers explicit scan_roots", () => {
  const spec = validateTargetArchitecture({
    schema_version: "0.2.0",
    scan_roots: ["src/custom/**"],
    layers: [{ id: "lib", globs: ["src/cli/lib/**"] }],
    rules: [],
  });
  assert.deepEqual(resolveArchScanRoots(spec), ["src/custom/**"]);
});

test("checkArchBoundariesForFiles: scans non-dogfood layout via scan_roots", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-adopter-"));
  const libFile = path.join(dest, "src/app/lib/bad.ts");
  fs.mkdirSync(path.dirname(libFile), { recursive: true });
  fs.writeFileSync(libFile, `import { Command } from "commander";\nexport const x = Command;\n`, "utf8");
  const spec = validateTargetArchitecture({
    schema_version: "0.2.0",
    scan_roots: ["src/app/**"],
    layers: [{ id: "lib", globs: ["src/app/lib/**"] }],
    rules: [{ id: "RULE-LIB-COMMANDER", from_layer: "lib", forbid_specifier_substring: "commander" }],
  });
  const result = checkArchBoundariesForFiles(spec, dest, [libFile]);
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.rule_id, "RULE-LIB-COMMANDER");
});

test("checkArchBoundariesForFiles: detects lib importing commander (dogfood layout)", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-check-"));
  const libFile = path.join(dest, "src/cli/lib/bad.ts");
  fs.mkdirSync(path.dirname(libFile), { recursive: true });
  fs.writeFileSync(libFile, `import { Command } from "commander";\nexport const x = Command;\n`, "utf8");
  const spec = validateTargetArchitecture({
    schema_version: "0.1.0",
    layers: [
      { id: "lib", globs: ["src/cli/lib/**"] },
      { id: "command", globs: ["src/cli/commands/**"] },
    ],
    rules: [{ id: "RULE-LIB-COMMANDER", from_layer: "lib", forbid_specifier_substring: "commander" }],
  });
  const result = checkArchBoundariesForFiles(spec, dest, [libFile]);
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.rule_id, "RULE-LIB-COMMANDER");
});

test("checkArchBoundariesForFiles: a package.json subpath import resolves to its layer; an unmapped alias stays other", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-alias-"));
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ imports: { "#b/*": "./dist/packages/b/src/*" } }), "utf8");
  const aFile = path.join(dest, "packages/a/src/x.ts");
  fs.mkdirSync(path.dirname(aFile), { recursive: true });
  fs.writeFileSync(aFile, `import { y } from "#b/y.js";\nimport { z } from "#nowhere/z.js";\nexport const x = [y, z];\n`, "utf8");
  const spec = validateTargetArchitecture({
    schema_version: "0.2.0",
    scan_roots: ["packages/**"],
    layers: [
      { id: "a", globs: ["packages/a/src/**"] },
      { id: "b", globs: ["packages/b/src/**"] },
    ],
    rules: [
      { id: "RULE-A-NO-B", from_layer: "a", forbid_import_layer: "b" },
      { id: "RULE-A-NO-OTHER", from_layer: "a", forbid_import_layer: "other" },
    ],
  });
  const result = checkArchBoundariesForFiles(spec, dest, [aFile]);
  assert.deepEqual(
    result.violations.map((v) => [v.rule_id, v.module_specifier]),
    [["RULE-A-NO-B", "#b/y.js"], ["RULE-A-NO-OTHER", "#nowhere/z.js"]],
  );
});

test("arch check: the dogfood law sees this repository's #pkg imports (ADR-0054 direction)", () => {
  const root = getRepoRoot();
  const dogfood = loadTargetArchitecture(root);
  const spec = { ...dogfood, rules: dogfood.rules.filter((r) => r.kind === "import") };
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-dogfood-alias-"));
  fs.copyFileSync(path.join(root, "package.json"), path.join(dest, "package.json"));
  const planeFile = path.join(dest, "packages/plane/src/probe.ts");
  fs.mkdirSync(path.dirname(planeFile), { recursive: true });
  fs.writeFileSync(planeFile, `import { scopePathLaw } from "#missions/tmvc-path.js";\nexport const probe = scopePathLaw;\n`, "utf8");
  const result = checkArchBoundariesForFiles(spec, dest, [planeFile]);
  assert.deepEqual(result.violations.map((v) => v.rule_id), ["RULE-PLANE-NO-MISSIONS-LAYER"]);
});

test("loadTargetArchitecture: loads repository dogfood file", () => {
  const root = getRepoRoot();
  const spec = loadTargetArchitecture(root);
  assert.equal(spec.schema_version, "0.4.0");
  assert.ok(spec.rules.some((r) => r.kind === "budget"), "structural rules present (ADR-0052 step 3c)");
  assert.ok(spec.rules.some((r) => r.id === "RULE-LIB-TO-COMMAND"));
  assert.ok(spec.rules.some((r) => r.id === "RULE-COMMAND-NO-JSON-STRINGIFY"));
});

test("validateTargetArchitecture: applies_to on an import rule is not mixed", () => {
  const spec = validateTargetArchitecture({
    schema_version: "0.3.0",
    layers: [{ id: "app", globs: ["src/ui/**"] }],
    rules: [
      {
        id: "RULE-UI-DB",
        from_layer: "app",
        applies_to: ["src/ui/**"],
        forbid_import_layer: "database",
      },
    ],
  });
  assert.equal(spec.rules[0]?.kind, "import");
  assert.deepEqual(spec.rules[0]?.applies_to, ["src/ui/**"]);
});

test("validateTargetArchitecture: mixed enforcement fields name the split", () => {
  assert.throws(
    () =>
      validateTargetArchitecture({
        schema_version: "0.3.0",
        layers: [{ id: "app", globs: ["src/**"] }],
        rules: [
          {
            id: "RULE-MIXED",
            from_layer: "app",
            forbid_import_layer: "database",
            forbid_pattern: "secret",
          },
        ],
      }),
    /TARGET_ARCHITECTURE\.yaml: rules\[0\] "RULE-MIXED" sets both import fields and pattern fields\. Split this mixed rule into two distinct YAML entries, one import rule and one pattern rule\./,
  );
});

test("validateTargetArchitecture: applies_to alone is an empty rule", () => {
  assert.throws(
    () =>
      validateTargetArchitecture({
        schema_version: "0.3.0",
        layers: [{ id: "app", globs: ["src/**"] }],
        rules: [{ id: "RULE-EMPTY", from_layer: "app", applies_to: ["src/ui/**"] }],
      }),
    /TARGET_ARCHITECTURE\.yaml: rules\[0\] "RULE-EMPTY" sets neither import fields \(forbid_import_layer, forbid_specifier_substring, forbid_resolved_path_substring\) nor pattern fields \(forbid_pattern, require_pattern\)\./,
  );
});
