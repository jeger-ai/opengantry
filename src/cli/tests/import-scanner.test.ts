import test from "node:test";
import assert from "node:assert/strict";
import {
  blankComments,
  extractBindingsFromSnippet,
  extractImportSites,
} from "#core/import-scanner.js";

test("extractBindingsFromSnippet: mixed default + named", () => {
  assert.deepEqual(
    extractBindingsFromSnippet('import Logger, { info, debug } from "./logger"'),
    ["Logger", "info", "debug"],
  );
});

test("extractBindingsFromSnippet: named only", () => {
  assert.deepEqual(extractBindingsFromSnippet('import { a, b } from "m"'), ["a", "b"]);
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
  assert.ok(extractImportSites(src).some((s) => s.spec === "zod"));
  assert.ok(extractImportSites(src).some((s) => s.spec === "keep"));
});
