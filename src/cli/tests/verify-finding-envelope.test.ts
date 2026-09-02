import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeInitFailure,
  normalizeVerifyPhaseFailure,
} from "../lib/verify-failure-normalize.js";
import { buildFindingsForFailure, toVerifyFailedPayload } from "../lib/verify-payload.js";
import { buildSarifDocument } from "../lib/verify-export.js";
import { GantryUserError } from "../lib/errors.js";
import { VERIFY_ENVELOPE_SCHEMA_VERSION } from "../lib/verify-finding.js";

describe("verify failure envelope", () => {
  const phases = [
    {
      name: "gate",
      failure: {
        ok: false as const,
        phase: "gate" as const,
        message: "gate failed",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
        gateCommand: "npm test",
        gateStdout: "",
        gateStderr: "FAIL",
        gateExitCode: 1,
      },
    },
    {
      name: "trace",
      failure: {
        ok: false as const,
        phase: "trace" as const,
        message: "trace failed",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
        traceKind: "quote_missing" as const,
        traceReason: "missing quote",
        traceQuote: "DoD 1",
        declaredLine: 7,
      },
    },
    {
      name: "git_proof",
      failure: {
        ok: false as const,
        phase: "git_proof" as const,
        message: "git proof failed",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
        gitProofMessage: "no planner stamp",
      },
    },
    {
      name: "defensive",
      failure: {
        ok: false as const,
        phase: "defensive" as const,
        message: "defensive failed",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
        defensiveReason: "net_loc budget exceeded",
      },
    },
    {
      name: "kpi",
      failure: {
        ok: false as const,
        phase: "kpi" as const,
        message: "kpi failed",
        exitCode: 1,
        executorLogPath: "EXECUTOR_LOG.md",
        kpiKind: "threshold" as const,
        kpiReason: "metric over threshold",
        kpiReportPath: ".gitagent/kpi/MSN-0001.json",
      },
    },
  ];

  for (const { name, failure } of phases) {
    it(`emits structured finding for ${name} failure`, () => {
      const normalized = normalizeVerifyPhaseFailure({
        failure,
        missionArg: ".gitagent/missions/MSN-0001.yaml",
        options: {},
      });
      const findings = buildFindingsForFailure("", normalized, failure);
      const payload = toVerifyFailedPayload(normalized, failure, findings);
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

  it("emits init finding", () => {
    const normalized = normalizeInitFailure(new GantryUserError("PARSE", "bad mission"));
    const findings = buildFindingsForFailure("", normalized);
    const payload = toVerifyFailedPayload(normalized, undefined, findings);
    assert.equal(payload.findings[0]!.failed_gate, "init");
  });

  it("maps findings to SARIF results with rule_id", () => {
    const failure = phases[0]!.failure;
    const normalized = normalizeVerifyPhaseFailure({
      failure,
      missionArg: "m.yaml",
      options: {},
    });
    const findings = buildFindingsForFailure("", normalized, failure);
    const payload = toVerifyFailedPayload(normalized, failure, findings);
    const sarif = buildSarifDocument(payload);
    const results = (sarif.runs as Array<{ results: Array<{ properties: { resolution_hint: string } }> }>)[0]!
      .results;
    assert.ok(results[0]!.properties.resolution_hint.length > 0);
  });
});
