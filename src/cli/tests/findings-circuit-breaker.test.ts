import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GXT_ERROR } from "#core/error-codes.js";
import { REL_NEXT_REMEDIATION } from "#core/constants.js";
import { verifyFinding } from "#missions/mission-verify/finding.js";
import {
  clearRemediationSnapshot,
  persistVerifyFailure,
  readRemediationSnapshot,
} from "#missions/mission-verify/remediation-pipeline.js";
import { computeFindingsDigest } from "#missions/mission-verify/finding-fingerprint.js";
import { buildVerifyResultPayloadFromPhaseResult } from "#missions/mission-verify/payload.js";
import type { VerifyFailedPayload } from "#missions/mission-verify/payload.js";
import type { ParsedMission } from "#core/mission-types.js";
import type { VerifyPhaseSuccess } from "#missions/mission-verify/engine.js";
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
    envelope_schema_version: 4,
    findings,
  };
}

function minimalMission(root: string, msnId: string): ParsedMission {
  return {
    msnId,
    skillKey: "gantry",
    gate: { command: "true", successSubstring: null, adapter: "generic" },
    virtualCapture: false,
    traceRows: [],
    interrogation: [],
    interrogationSha256: null,
    declaredPaths: [],
    contract: null,
    contractSha256: null,
    dependsOn: [],
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
  };
}

const meta = (msnId: string) => ({ mission_file_path: ".gitagent/missions/m.yaml", msn_id: msnId });

/** Seed the feed with one prior failure whose ring holds `ring`. */
function seedSnapshot(root: string, msnId: string, ring: string[]): void {
  fs.mkdirSync(path.join(root, ".gitagent/tmp"), { recursive: true });
  fs.writeFileSync(
    path.join(root, REL_NEXT_REMEDIATION),
    JSON.stringify({
      schema_version: 2,
      written_at: new Date().toISOString(),
      source: "gantry verify",
      phase: "gate",
      error_code: GXT_ERROR.GATE_FAILED,
      message: "fail",
      msn_id: msnId,
      fix_hints: [],
      next_actions: [],
      digest_ring: ring,
    }),
  );
}

describe("findings circuit breaker", () => {
  it("aborts when digest already in ring", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-hit-"));
    const finding = verifyFinding("gate", "fix", {
      offending_file: "a.ts",
      rule_id: "tsc",
    });
    seedSnapshot(root, "MSN-0001", [computeFindingsDigest([finding])]);
    const payload = persistVerifyFailure(root, sampleFailedPayload([finding]), meta("MSN-0001"));
    assert.equal(payload.error_code, GXT_ERROR.FINDINGS_RECURRED);
    assert.match(payload.fix_hints.at(-1)!, /recurred/);
    assert.match(payload.next_actions.at(-1)!, /Escalate to Planner/);
  });

  it("the prior digest ring is scoped by msn_id", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-"));
    const finding = verifyFinding("gate", "fix");
    seedSnapshot(root, "MSN-0001", [computeFindingsDigest([finding])]);
    const other = persistVerifyFailure(root, sampleFailedPayload([finding]), meta("MSN-0002"));
    assert.equal(other.error_code, GXT_ERROR.GATE_FAILED);
    assert.deepEqual(readRemediationSnapshot(root)?.digest_ring, [computeFindingsDigest([finding])]);
  });

  it("clearRemediationSnapshot clears digest ring", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-tomb-"));
    const finding = verifyFinding("gate", "fix");
    seedSnapshot(root, "MSN-0001", [computeFindingsDigest([finding])]);
    clearRemediationSnapshot(root);
    assert.equal(readRemediationSnapshot(root), null);
    const payload = persistVerifyFailure(root, sampleFailedPayload([finding]), meta("MSN-0001"));
    assert.equal(payload.error_code, GXT_ERROR.GATE_FAILED);
  });

  it("PASS payload build leaves remediation to presenter tombstone", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-pass-"));
    const msnId = "MSN-0001";
    seedSnapshot(root, msnId, ["digest-a"]);
    const mission = minimalMission(root, msnId);
    const payload = buildVerifyResultPayloadFromPhaseResult(root, mission, successPhase(msnId));
    assert.equal(payload.status, "passed");
    assert.ok(readRemediationSnapshot(root));
    clearRemediationSnapshot(root);
    assert.equal(readRemediationSnapshot(root), null);
  });

  it("single persist does not false-trip recurrence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-single-"));
    const finding = verifyFinding("gate", "fix");
    const payload = persistVerifyFailure(root, sampleFailedPayload([finding]), meta("MSN-0099"));
    assert.equal(payload.error_code, GXT_ERROR.GATE_FAILED);
    assert.equal(payload.findings_digest, computeFindingsDigest([finding]));
    const snapshot = readRemediationSnapshot(root);
    assert.equal(snapshot?.error_code, GXT_ERROR.GATE_FAILED);
    assert.equal(snapshot?.digest_ring?.length, 1);
    assert.equal(snapshot?.msn_id, "MSN-0099");
  });

  it("second persist of same digest recurs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-double-"));
    const finding = verifyFinding("gate", "fix");
    const base = sampleFailedPayload([finding]);
    persistVerifyFailure(root, base, meta("MSN-0099"));
    const payload2 = persistVerifyFailure(root, base, meta("MSN-0099"));
    assert.equal(payload2.error_code, GXT_ERROR.FINDINGS_RECURRED);
    assert.equal(readRemediationSnapshot(root)?.error_code, GXT_ERROR.FINDINGS_RECURRED);
  });

  it("a failure without msn_id never recurs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-init-"));
    const base = sampleFailedPayload();
    persistVerifyFailure(root, base, { mission_file_path: "m.yaml" });
    assert.equal(persistVerifyFailure(root, base, { mission_file_path: "m.yaml" }).error_code, GXT_ERROR.GATE_FAILED);
  });

  it("the ring keeps the last four digests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-ring-cap-"));
    const payloads = [1, 2, 3, 4, 5].map((n) => sampleFailedPayload([verifyFinding("gate", `fix ${String(n)}`, { rule_id: `r${String(n)}` })]));
    for (const p of payloads) persistVerifyFailure(root, p, meta("MSN-0099"));
    const ring = readRemediationSnapshot(root)?.digest_ring ?? [];
    assert.deepEqual(ring, payloads.slice(1).map((p) => computeFindingsDigest(p.findings)));
    assert.equal(persistVerifyFailure(root, payloads[0]!, meta("MSN-0099")).error_code, GXT_ERROR.GATE_FAILED);
  });
});
