import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import {
  checkArchBoundariesForFiles,
  layerForFile,
  loadTargetArchitecture,
  validateTargetArchitecture,
} from "../lib/target-architecture.js";

test("validateTargetArchitecture: accepts dogfood spec shape", () => {
  const spec = validateTargetArchitecture({
    schema_version: "0.1.0",
    layers: [{ id: "lib", globs: ["src/cli/lib/**"] }],
    rules: [{ id: "RULE-LIB-COMMANDER", from_layer: "lib", forbid_specifier_substring: "commander" }],
  });
  assert.equal(spec.layers[0]?.id, "lib");
});

test("layerForFile: classifies src/cli paths", () => {
  const root = getRepoRoot();
  const spec = loadTargetArchitecture(root);
  assert.equal(layerForFile(spec, "src/cli/commands/verify.ts"), "command");
  assert.equal(layerForFile(spec, "src/cli/lib/gate.ts"), "lib");
});

test("checkArchBoundariesForFiles: detects lib importing commander", () => {
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
  assert.ok(spec.rules.some((r) => r.id === "RULE-LIB-TO-COMMAND"));
});
