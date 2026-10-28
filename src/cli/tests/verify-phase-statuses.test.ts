import test from "node:test";
import assert from "node:assert/strict";
import { verifyPhaseStatuses, type VerifyPhaseSuccess } from "#missions/mission-verify/engine.js";
import type { VerifyPhaseFailure } from "#missions/mission-verify/failure.js";

const success: VerifyPhaseSuccess = { ok: true, outcome: "full", proofMsnId: "MSN-0001", executorLogPath: "EXECUTOR_LOG.md", traceWarnings: [] };

test("verifyPhaseStatuses: a full pass passes every phase", () => {
  assert.ok(verifyPhaseStatuses(success).every((p) => p.status === "passed"));
});

test("verifyPhaseStatuses: a pre-push stub skips gate and trace", () => {
  const rows = verifyPhaseStatuses({ ...success, outcome: "pre_push_stub" });
  assert.deepEqual(rows.filter((p) => p.status === "skipped").map((p) => p.id), ["gate", "trace"]);
});

test("verifyPhaseStatuses: earlier phases pass, the failing one fails, later ones are skipped", () => {
  const failure: VerifyPhaseFailure = { ok: false, phase: "gate", message: "gate failed", exitCode: 1, executorLogPath: "EXECUTOR_LOG.md" };
  assert.deepEqual(
    verifyPhaseStatuses(failure).map((p) => `${p.id}:${p.status}`),
    ["git_proof:passed", "contract:passed", "interrogation:passed", "policy:passed", "dependencies:passed", "gate:failed", "trace:skipped"],
  );
});

test("verifyPhaseStatuses: a run-record failure is the trace phase", () => {
  const failure = { ok: false, phase: "run_record", message: "stale", exitCode: 1, executorLogPath: "EXECUTOR_LOG.md", recordReason: "stale" } as VerifyPhaseFailure;
  assert.equal(verifyPhaseStatuses(failure).find((p) => p.id === "trace")?.status, "failed");
});
