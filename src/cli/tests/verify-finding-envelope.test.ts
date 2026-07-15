import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeInitFailure,
  normalizeVerifyPhaseFailure,
  toVerifyFailedPayload,
} from "../lib/verify-failure-normalize.js";
import { buildSarifDocument } from "../lib/verify-export.js";
import { GantryUserError } from "../lib/errors.js";

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
      const payload = toVerifyFailedPayload(normalized, failure);
      assert.equal(payload.envelope_schema_version, 2);
      assert.ok(payload.findings.length >= 1);
      const finding = payload.findings[0]!;
      assert.equal(finding.failed_gate, name);
      assert.ok(finding.resolution_hint.length > 0);
      const roundTrip = JSON.parse(JSON.stringify(payload));
      assert.ok(roundTrip.findings[0].failed_gate);
    });
  }

  it("emits init finding", () => {
    const normalized = normalizeInitFailure(new GantryUserError("PARSE", "bad mission"));
    const payload = toVerifyFailedPayload(normalized);
    assert.equal(payload.findings[0]!.failed_gate, "init");
  });

  it("maps findings to SARIF results", () => {
    const normalized = normalizeVerifyPhaseFailure({
      failure: phases[0]!.failure,
      missionArg: "m.yaml",
      options: {},
    });
    const payload = toVerifyFailedPayload(normalized, phases[0]!.failure);
    const sarif = buildSarifDocument(payload);
    const results = (sarif.runs as Array<{ results: Array<{ properties: { resolution_hint: string } }> }>)[0]!
      .results;
    assert.ok(results[0]!.properties.resolution_hint.length > 0);
  });
});
