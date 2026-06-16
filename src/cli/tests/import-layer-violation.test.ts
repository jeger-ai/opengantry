import test from "node:test";
import assert from "node:assert/strict";
import {
  gateOutputIndicatesImportLayer,
  parseImportLayerGateJson,
} from "../lib/import-layer-violation.js";

test("parseImportLayerGateJson: valid failure report", () => {
  const json = JSON.stringify({
    schema_version: 1,
    ok: false,
    violations: [
      {
        file: "src/cli/lib/bad.ts",
        rule_id: "RULE-LIB-TO-COMMAND",
        module_specifier: "../commands/verify.js",
        bindings: ["runVerify"],
        line: 1,
        column: 1,
      },
    ],
  });
  const report = parseImportLayerGateJson(json);
  assert.ok(report);
  assert.equal(report!.ok, false);
  assert.equal(report!.violations.length, 1);
  assert.equal(report!.violations[0]!.rule_id, "RULE-LIB-TO-COMMAND");
});

test("parseImportLayerGateJson: rejects malformed payload", () => {
  assert.equal(parseImportLayerGateJson("not json"), null);
  assert.equal(parseImportLayerGateJson('{"schema_version":2,"ok":false,"violations":[]}'), null);
  assert.equal(
    parseImportLayerGateJson('{"schema_version":1,"ok":false,"violations":[{"file":"x"}]}'),
    null,
  );
});

test("gateOutputIndicatesImportLayer: true only for non-empty failure report", () => {
  const failJson = JSON.stringify({
    schema_version: 1,
    ok: false,
    violations: [
      {
        file: "a.ts",
        rule_id: "RULE-LIB-TO-COMMAND",
        module_specifier: "../commands/x.js",
        bindings: ["x"],
        line: 1,
        column: 1,
      },
    ],
  });
  const okJson = JSON.stringify({ schema_version: 1, ok: true, violations: [] });
  assert.equal(gateOutputIndicatesImportLayer(failJson), true);
  assert.equal(gateOutputIndicatesImportLayer(okJson), false);
});
