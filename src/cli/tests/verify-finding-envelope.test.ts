import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { initFailurePayload, verifyFailure } from "#missions/mission-verify/payload.js";
import type { GateFailure, VerifyPhaseFailure } from "#missions/mission-verify/failure.js";
import { buildSarifDocument } from "#missions/mission-verify/export.js";
import { GantryUserError } from "#core/user-error.js";
import { GXT_ERROR } from "#core/error-codes.js";
import type { ParsedMission } from "#core/mission-types.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION } from "#missions/mission-verify/finding.js";

const root = path.resolve("/repo");

function envelopeMission(repoRoot = root): ParsedMission {
  return {
    msnId: "MSN-0001",
    skillKey: "gantry",
    gate: { command: "npm test", successSubstring: null, adapter: "generic" },
    virtualCapture: false,
    traceRows: [],
    interrogation: [],
    interrogationSha256: null,
    declaredPaths: [],
    contract: null,
    contractSha256: null,
    dependsOn: [],
    rawPath: path.join(repoRoot, ".gitagent/missions/MSN-0001.yaml"),
  };
}

const gateFailure: GateFailure = {
  ok: false,
  phase: "gate",
  message: "gate failed",
  exitCode: 1,
  executorLogPath: "EXECUTOR_LOG.md",
  gateCommand: "npm test",
  gateOutput: "FAIL",
  gateExitCode: 1,
};

describe("verify failure envelope", () => {
  const phases: { name: string; failure: VerifyPhaseFailure }[] = [
    { name: "gate", failure: gateFailure },
    {
      name: "trace",
      failure: {
        ok: false,
        phase: "trace",
        message: "missing quote",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
        traceKind: "quote_missing",
        traceQuote: "DoD 1",
        declaredLine: 7,
      },
    },
    {
      name: "git_proof",
      failure: {
        ok: false,
        phase: "git_proof",
        message: "no planner stamp",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
      },
    },
  ];

  for (const { name, failure } of phases) {
    it(`emits structured finding for ${name} failure`, () => {
      const { payload } = verifyFailure(root, envelopeMission(), failure);
      assert.equal(payload.envelope_schema_version, VERIFY_ENVELOPE_SCHEMA_VERSION);
      assert.ok(payload.findings.length >= 1);
      const finding = payload.findings[0]!;
      assert.equal(finding.failed_gate, name);
      assert.ok(finding.resolution_hint.length > 0);
      assert.ok(finding.fingerprint.length > 0);
      assert.ok(finding.semantic_fingerprint.length > 0);
      if (name === "trace") {
        assert.equal(finding.line, 7);
      }
      const roundTrip = JSON.parse(JSON.stringify(payload));
      assert.ok(roundTrip.findings[0].failed_gate);
    });
  }

  it("gate payload carries the gate output and code; the human text its headline", () => {
    const failure = verifyFailure(root, envelopeMission(), { ...gateFailure, gateOutput: "fail out\nfail err" });
    assert.equal(failure.payload.error_code, GXT_ERROR.GATE_FAILED);
    assert.equal(failure.payload.stdout, "fail out\nfail err");
    assert.equal(failure.payload.failures, undefined);
    assert.equal(failure.headline, "verify: GATE FAILED");
    assert.ok(failure.payload.fix_hints.length > 0);
    assert.ok(failure.payload.next_actions.length > 0);
  });

  it("trace payload lists the DoD failure", () => {
    const failure = verifyFailure(root, envelopeMission(), {
      ok: false,
      phase: "trace",
      message: "Ambiguous match",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
      traceKind: "ambiguous",
      traceQuote: "DoD 1 MSN-0001: quote",
    });
    assert.equal(failure.payload.error_code, GXT_ERROR.TRACE_AMBIGUOUS);
    assert.deepEqual(failure.payload.failures, ["DoD trace: Ambiguous match"]);
  });

  it("trace_pending falls back to one trace finding from the first hint", () => {
    const { payload, tagged_steps } = verifyFailure(root, envelopeMission(), {
      ok: false,
      phase: "trace_pending",
      message: "pending",
      exitCode: 1,
      executorLogPath: "EXECUTOR_LOG.md",
    });
    assert.equal(payload.error_code, GXT_ERROR.TRACE_PENDING);
    assert.ok(payload.next_actions.length >= 2);
    assert.equal(payload.findings.length, 1);
    assert.equal(payload.findings[0]!.failed_gate, "trace");
    assert.equal(payload.findings[0]!.resolution_hint, payload.fix_hints[0]);
    assert.ok(tagged_steps && tagged_steps.length > 0);
  });

  for (const [name, file, line, evidence] of [
    ["projects import-layer JSON violations with evidence", "src/cli/lib/foo.ts", 3, "import { x } from \"../commands/bar.js\";"],
    ["omits evidence on ENOENT without throwing", "missing/deleted.ts", 1, undefined],
  ] as const) {
    it(`gate: ${name}`, () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-proj-"));
      fs.mkdirSync(path.join(repo, "src/cli/lib"), { recursive: true });
      fs.writeFileSync(path.join(repo, "src/cli/lib/foo.ts"), "\n\nimport { x } from \"../commands/bar.js\";\n");
      const violation = { file, rule_id: "import-layer", module_specifier: "../commands/bar.js", bindings: ["x"], line, column: 1 };
      const gateOutput = JSON.stringify({ schema_version: 1, ok: false, violations: [violation] });
      const { payload } = verifyFailure(repo, envelopeMission(repo), { ...gateFailure, gateOutput });
      assert.equal(payload.error_code, GXT_ERROR.IMPORT_LAYER_VIOLATION);
      assert.equal(payload.findings.length, 1);
      assert.equal(payload.findings[0]!.offending_file, file);
      assert.equal(payload.findings[0]!.line, line);
      assert.equal(payload.findings[0]!.rule_id, "import-layer");
      assert.equal(payload.findings[0]!.evidence, evidence);
      assert.ok(payload.findings[0]!.fingerprint);
    });
  }

  it("emits init finding", () => {
    const payload = initFailurePayload(new GantryUserError("PARSE", "bad mission"));
    assert.equal(payload.phase, "init");
    assert.equal(payload.findings[0]!.failed_gate, "init");
  });

  it("maps findings to SARIF results with rule_id", () => {
    const { payload } = verifyFailure(root, envelopeMission("/m"), gateFailure);
    const sarif = buildSarifDocument(payload, "0.0.0-test");
    const results = (sarif.runs as Array<{ results: Array<{ properties: { resolution_hint: string } }> }>)[0]!
      .results;
    assert.ok(results[0]!.properties.resolution_hint.length > 0);
  });
});
