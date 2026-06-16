import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBindingsFromSnippet,
  extractImportSpecifiers,
  extractImportsWithMeta,
  stripSurgeonQuarantineRegions,
} from "../lib/import-scanner.js";

test("extractBindingsFromSnippet: mixed default + named", () => {
  assert.deepEqual(
    extractBindingsFromSnippet('import Logger, { info, debug } from "./logger"'),
    ["Logger", "info", "debug"],
  );
});

test("extractBindingsFromSnippet: named only", () => {
  assert.deepEqual(extractBindingsFromSnippet('import { a, b } from "m"'), ["a", "b"]);
});

test("extractImportsWithMeta: ignores quarantine regions when scrubbing", () => {
  const source = [
    "// GXT-SURGEON-QUARANTINE-START [RULE]",
    'import { bad } from "../commands/verify.js";',
    "// GXT-SURGEON-QUARANTINE-END",
    'import { ok } from "./constants.js";',
  ].join("\n");
  const scrubbed = stripSurgeonQuarantineRegions(source);
  assert.doesNotMatch(scrubbed, /verify\.js/);
  const imports = extractImportsWithMeta(source, true);
  assert.equal(imports.length, 1);
  assert.equal(imports[0]!.spec, "./constants.js");
});

test("extractImportSpecifiers: collects export-from specifiers", () => {
  const specs = extractImportSpecifiers('export { x } from "./foo.js";\nimport "side";\n');
  assert.deepEqual(specs, ["./foo.js", "side"]);
});
