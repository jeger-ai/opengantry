import test from "node:test";
import assert from "node:assert/strict";
import {
  gateOutputIndicatesBannedImport,
  parseBannedImportGateOutput,
} from "../lib/banned-import-violation.js";

test("parseBannedImportGateOutput: parses check-imports stderr lines", () => {
  const text = `src/bad.ts: banned import "axios"
other noise
src/other.ts: banned import "lodash/esm"
`;
  const violations = parseBannedImportGateOutput(text);
  assert.equal(violations.length, 2);
  assert.deepEqual(violations[0], { file: "src/bad.ts", specifier: "axios" });
  assert.deepEqual(violations[1], { file: "src/other.ts", specifier: "lodash/esm" });
});

test("gateOutputIndicatesBannedImport: true when pattern present", () => {
  assert.equal(gateOutputIndicatesBannedImport('foo.ts: banned import "x"'), true);
  assert.equal(gateOutputIndicatesBannedImport("gate failed"), false);
});
