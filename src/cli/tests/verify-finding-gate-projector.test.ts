import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { projectGateFindings } from "../lib/verify-finding-gate-projector.js";
import type { GateFailure } from "../lib/verify-failure.js";

describe("verify-finding-gate-projector", () => {
  it("projects import-layer JSON violations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-proj-"));
    const report = JSON.stringify({
      schema_version: 1,
      ok: false,
      violations: [
        {
          file: "src/cli/lib/foo.ts",
          rule_id: "import-layer",
          module_specifier: "../commands/bar.js",
          bindings: ["x"],
          line: 3,
          column: 1,
        },
      ],
    });
    const failure: GateFailure = {
      ok: false,
      phase: "gate",
      message: "gate failed",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      gateStdout: report,
      gateStderr: "",
      gateExitCode: 1,
    };
    const findings = projectGateFindings(root, failure, "run gate");
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.offending_file, "src/cli/lib/foo.ts");
    assert.equal(findings[0]!.line, 3);
    assert.equal(findings[0]!.rule_id, "import-layer");
    assert.ok(findings[0]!.fingerprint);
  });

  it("projects banned-import stderr lines", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-ban-"));
    const failure: GateFailure = {
      ok: false,
      phase: "gate",
      message: "gate failed",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      gateStderr: 'src/bad.ts: banned import "fs"',
      gateExitCode: 1,
    };
    const findings = projectGateFindings(root, failure, "run gate");
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.offending_file, "src/bad.ts");
    assert.equal(findings[0]!.rule_id, "banned-import");
  });

  it("omits evidence on ENOENT without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-enoent-"));
    const report = JSON.stringify({
      schema_version: 1,
      ok: false,
      violations: [
        {
          file: "missing/deleted.ts",
          rule_id: "import-layer",
          module_specifier: "../x.js",
          bindings: [],
          line: 1,
          column: 1,
        },
      ],
    });
    const failure: GateFailure = {
      ok: false,
      phase: "gate",
      message: "gate failed",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      gateStdout: report,
      gateExitCode: 1,
    };
    const findings = projectGateFindings(root, failure, "run gate");
    assert.equal(findings[0]!.evidence, undefined);
    assert.equal(findings[0]!.offending_file, "missing/deleted.ts");
  });
});
