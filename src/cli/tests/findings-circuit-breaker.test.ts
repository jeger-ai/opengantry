import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { verifyFinding } from "../lib/verify-finding.js";
import {
  applyFindingsRecurrence,
  loadPriorDigestRing,
  persistFailedVerifyRemediation,
  tombstoneRemediationSnapshot,
} from "../lib/verify-remediation-pipeline.js";
import { computeFindingsDigest } from "../lib/verify-finding-fingerprint.js";
import { buildVerifyResultPayloadFromPhaseResult } from "../lib/verify-payload.js";
import type { VerifyFailedPayload } from "../lib/verify-payload.js";
import type { ParsedMission } from "../lib/types.js";
import type { VerifyPhaseSuccess } from "../lib/verify-engine.js";
import {
  REMEDIATION_SCHEMA_VERSION,
  readRemediationSnapshot,
  writeRemediationSnapshot,
} from "../lib/context-feed-store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function sampleFailedPayload(findings = [verifyFinding("gate", "fix it")]): VerifyFailedPayload {
  return {
    status: "failed",
    phase: "gate",
    message: "gate failed",
    error_code: GXT_ERROR.GATE_FAILED,
    fix_hints: ["rerun"],
    next_actions: [],
    exit_code: 1,
    envelope_schema_version: 3,
    findings,
  };
}

function minimalMission(root: string, msnId: string): ParsedMission {
  return {
    msnId,
    skillKey: "gantry",
    gate: { command: "true", successSubstring: null },
    kpiGate: null,
    virtualCapture: false,
    llmVerifiers: [],
    aggregators: [],
    traceRows: [],
    interrogation: [],
    interrogationSha256: null,
    declaredPaths: [],
    rawPath: path.join(root, ".gitagent/missions/m.yaml"),
  };
}

function successPhase(msnId: string): VerifyPhaseSuccess {
  return {
    ok: true,
    outcome: "full",
    proofMsnId: msnId,
    executorLogPath: "EXECUTOR_LOG.md",
    traceWarnings: [],
    phaseTimings: [],
  };
}

describe("findings circuit breaker", () => {
  it("aborts when digest already in ring", () => {
    const finding = verifyFinding("gate", "fix", {
      offending_file: "a.ts",
      rule_id: "tsc",
    });
    const digest = computeFindingsDigest([finding]);
    const priorRing = [digest];
    const { payload, recurred } = applyFindingsRecurrence(
      sampleFailedPayload([finding]),
      [finding],
      priorRing,
    );
    assert.equal(recurred, true);
    assert.equal(payload.error_code, GXT_ERROR.FINDINGS_RECURRED);
  });

  it("loadPriorDigestRing scopes by msn_id", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-"));
    writeRemediationSnapshot(root, {
      schema_version: REMEDIATION_SCHEMA_VERSION,
      written_at: new Date().toISOString(),
      source: "gantry verify",
      phase: "gate",
      error_code: GXT_ERROR.GATE_FAILED,
      message: "fail",
      msn_id: "MSN-0001",
      fix_hints: [],
      next_actions: [],
      digest_ring: ["abc"],
    });
    assert.deepEqual(loadPriorDigestRing(root, "MSN-0001"), ["abc"]);
    assert.deepEqual(loadPriorDigestRing(root, "MSN-0002"), []);
  });

  it("tombstoneRemediationSnapshot clears digest ring", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-tomb-"));
    const digest = "abc123";
    writeRemediationSnapshot(root, {
      schema_version: REMEDIATION_SCHEMA_VERSION,
      written_at: new Date().toISOString(),
      source: "gantry verify",
      phase: "gate",
      error_code: GXT_ERROR.GATE_FAILED,
      message: "fail",
      msn_id: "MSN-0001",
      fix_hints: [],
      next_actions: [],
      digest_ring: [digest],
    });
    tombstoneRemediationSnapshot(root);
    assert.equal(readRemediationSnapshot(root), null);
    assert.deepEqual(loadPriorDigestRing(root, "MSN-0001"), []);
  });

  it("PASS payload build leaves remediation to presenter tombstone", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-pass-"));
    const msnId = "MSN-0001";
    writeRemediationSnapshot(root, {
      schema_version: REMEDIATION_SCHEMA_VERSION,
      written_at: new Date().toISOString(),
      source: "gantry verify",
      phase: "gate",
      error_code: GXT_ERROR.GATE_FAILED,
      message: "fail",
      msn_id: msnId,
      fix_hints: [],
      next_actions: [],
      digest_ring: ["digest-a"],
    });
    const mission = minimalMission(root, msnId);
    const payload = buildVerifyResultPayloadFromPhaseResult(
      root,
      mission,
      {},
      successPhase(msnId),
    );
    assert.equal(payload.status, "passed");
    assert.ok(readRemediationSnapshot(root));
    tombstoneRemediationSnapshot(root);
    assert.equal(readRemediationSnapshot(root), null);
  });

  it("single persist does not false-trip recurrence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-single-"));
    const finding = verifyFinding("gate", "fix");
    const mission = minimalMission(root, "MSN-0099");
    const { payload } = persistFailedVerifyRemediation({
      root,
      mission,
      missionRel: ".gitagent/missions/m.yaml",
      payload: sampleFailedPayload([finding]),
      findings: [finding],
    });
    assert.equal(payload.error_code, GXT_ERROR.GATE_FAILED);
    assert.equal(loadPriorDigestRing(root, "MSN-0099").length, 1);
    const snapshot = readRemediationSnapshot(root);
    assert.equal(snapshot?.error_code, GXT_ERROR.GATE_FAILED);
  });

  it("second persist of same digest recurs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-double-"));
    const finding = verifyFinding("gate", "fix");
    const mission = minimalMission(root, "MSN-0099");
    const base = sampleFailedPayload([finding]);
    persistFailedVerifyRemediation({
      root,
      mission,
      missionRel: ".gitagent/missions/m.yaml",
      payload: base,
      findings: [finding],
    });
    const { payload: payload2 } = persistFailedVerifyRemediation({
      root,
      mission,
      missionRel: ".gitagent/missions/m.yaml",
      payload: base,
      findings: [finding],
    });
    assert.equal(payload2.error_code, GXT_ERROR.FINDINGS_RECURRED);
  });
});
