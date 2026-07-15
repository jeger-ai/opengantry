import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importLayerSurgeon } from "../lib/surgeons/import-layer.js";
import type { SurgeonContext } from "../lib/surgeons/registry.js";
import type { VerifyPhaseFailure } from "../lib/verify-failure.js";

test("importLayerSurgeon: applies bottom-to-top quarantine from gate JSON", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-surgeon-layer-"));
  const libDir = path.join(dir, "src", "cli", "lib");
  fs.mkdirSync(libDir, { recursive: true });
  const file = path.join(libDir, "bad.ts");
  fs.writeFileSync(
    file,
    `import { runVerify } from "../commands/verify.js";\nimport { runPerimeter } from "../commands/perimeter.js";\nexport const a = runVerify;\nexport const b = runPerimeter;\n`,
    "utf8",
  );

  const gateJson = JSON.stringify({
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
      {
        file: "src/cli/lib/bad.ts",
        rule_id: "RULE-LIB-TO-COMMAND",
        module_specifier: "../commands/perimeter.js",
        bindings: ["runPerimeter"],
        line: 2,
        column: 1,
      },
    ],
  });

  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "gate",
    message: "GATE FAILED",
    exitCode: 1,
    executorLogPath: path.join(dir, "EXECUTOR_LOG.md"),
    gateStdout: gateJson,
    gateStderr: "",
  };

  const context: SurgeonContext = {
    root: dir,
    failure,
    manifest: { schema_version: "0.5.0", skills: {}, path_risks: {}, risk_keywords: [] },
    executorLogPath: path.join(dir, "EXECUTOR_LOG.md"),
    errorCode: "GXT_IMPORT_LAYER_VIOLATION",
  };

  const result = await importLayerSurgeon.applyMutation(context);
  assert.equal(result.mutated, true);
  assert.match(result.summary, /import-layer quarantined: src\/cli\/lib\/bad\.ts/);

  const out = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(out, /from "\.\.\/commands\/verify\.js"/);
  assert.doesNotMatch(out, /from "\.\.\/commands\/perimeter\.js"/);
  assert.match(out, /const runVerify = new Proxy/);
  assert.match(out, /const runPerimeter = new Proxy/);
});
