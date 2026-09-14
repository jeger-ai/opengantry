import test from "node:test";
import assert from "node:assert/strict";
import {
  blankComments,
  extractBindingsFromSnippet,
  extractImportSites,
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

test("blankComments: preserves strings and templates; blanks real comments", () => {
  const src = [
    'const url = "https://example.com";',
    'const fake = "/*not a comment*/";',
    "const tmpl = `// still string`;",
    'import real from "keep";',
    '// import("commented-out")',
    'const x = require("zod");',
  ].join("\n");
  const blanked = blankComments(src);
  assert.match(blanked, /https:\/\/example.com/);
  assert.match(blanked, /\/\*not a comment\*\//);
  assert.match(blanked, /\/\/ still string/);
  assert.equal(extractImportSites(src).some((s) => s.spec === "commented-out"), false);
  assert.ok(extractImportSpecifiers(src).includes("zod"));
  assert.ok(extractImportSpecifiers(src).includes("keep"));
});
