import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git/git.js";
import {
  checkArchBoundariesForFiles,
  layerForFile,
  loadTargetArchitecture,
  resolveArchScanRoots,
  targetArchitectureMigrationHint,
  validateTargetArchitecture,
} from "../lib/arch/cage/target-architecture.js";

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
  assert.equal(layerForFile(spec, "src/cli/lib/gate.ts"), "lib");
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

test("loadTargetArchitecture: loads repository dogfood file", () => {
  const root = getRepoRoot();
  const spec = loadTargetArchitecture(root);
  assert.equal(spec.schema_version, "0.3.0");
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

test("targetArchitectureMigrationHint: warns on legacy schema", () => {
  assert.match(targetArchitectureMigrationHint("0.1.0") ?? "", /scan_roots/);
  assert.equal(targetArchitectureMigrationHint("0.2.0"), null);
});
